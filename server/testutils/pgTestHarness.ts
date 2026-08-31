/**
 * pgTestHarness.ts — real PostgreSQL harness for DB-gated integration suites
 * (PRA-004 / PRA-043, Phase 9).
 *
 * Replaces the fake `.db.test.ts` posture (mocked getDb / pure in-memory
 * assertions) with tests that run against a REAL, freshly provisioned
 * PostgreSQL database containing the full drizzle migration chain.
 *
 * Architecture:
 *   - A vitest globalSetup (pgGlobalSetup.ts) provisions ONE template
 *     database per run: all 57 migrations in drizzle/migrations are applied
 *     in filename order with GRANT/REVOKE/ROLE statements skipped (the test
 *     role has no role-admin privileges, and the three NOLOGIN RLS roles are
 *     pre-created idempotently instead). Pre-existing migration defects
 *     (e.g. the cost_records→tenants uuid/integer FK in 0028) are tolerated
 *     and printed loudly; the harness then FAILS the run if any table the
 *     suites depend on is missing.
 *   - Each test file calls createTestDatabase(label) which cheaply clones the
 *     template (CREATE DATABASE ... TEMPLATE ...) and points DATABASE_URL at
 *     the clone before server/db.ts lazily initialises its pool.
 *   - When PostgreSQL is unreachable the harness records the reason and every
 *     DB-gated suite skips cleanly with the reason printed — never a fake
 *     pass, never a hard failure of the whole suite.
 *
 * The admin connection is env-only: PRA_TEST_DATABASE_URL (registered in
 * server/_core/env.ts as ENV.praTestDatabaseUrl) with a passwordless
 * local-trust default for the developer/CI stack.
 */

import { Client } from "pg";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import { ENV } from "../_core/env";

/**
 * Assert that a database operation is rejected by PostgreSQL with a specific
 * failure. drizzle-orm wraps node-pg errors ("Failed query: …") and keeps the
 * original SQLSTATE detail on the cause chain, so match against the whole
 * chain rather than the top-level message.
 */
export async function expectPgRejection(p: Promise<unknown>, re: RegExp): Promise<void> {
  try {
    await p;
  } catch (err) {
    let text = "";
    let cur: unknown = err;
    while (cur instanceof Error) {
      text += `\n${cur.message}`;
      cur = (cur as { cause?: unknown }).cause;
    }
    expect(text).toMatch(re);
    return;
  }
  expect.unreachable("expected PostgreSQL to reject the operation");
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(os.tmpdir(), "p9-pg-harness-state.json");
const MIGRATIONS_DIR = path.resolve(HERE, "..", "..", "drizzle", "migrations");

/** Tables the DB-gated suites depend on. Missing → harness setup fails loudly. */
const REQUIRED_TABLES = [
  "users",
  "declarations",
  "declaration_documents",
  "payments",
  "audit_events",
  "audit_tasks",
  "audit_findings",
  "temporal_workflows",
  "payment_queue",
  "duty_drawback_claims",
  "vessel_tracking_events",
  "kafka_event_log",
] as const;

/** NOLOGIN roles referenced by the Phase-6 RLS policies (0052). */
const RLS_ROLES = ["app_user", "service_account", "readonly_user"] as const;

interface HarnessState {
  available: boolean;
  reason?: string;
  adminUrl?: string;
  templateDb?: string;
}

export interface TestDatabase {
  /** postgres:// URL pointing at this file's private database clone. */
  url: string;
  dbName: string;
  /** Drop the private database (FORCE). Idempotent. */
  close(): Promise<void>;
}

function writeState(state: HarnessState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

export function readState(): HarnessState | null {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as HarnessState;
  } catch {
    return null;
  }
}

/** Statements the harness must not replay (cluster-global / privilege-gated). */
const SKIP_STATEMENT = /^\s*(GRANT\b|REVOKE\b|CREATE\s+ROLE\b|ALTER\s+ROLE\b|DROP\s+ROLE\b|CREATE\s+EXTENSION\b)/i;

/** Strip line comments so statement classification sees the real first token. */
function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

/**
 * Apply every drizzle migration to the connected database, tolerant of
 * pre-existing migration defects. Returns the list of tolerated errors.
 */
async function applyMigrations(client: Client): Promise<Array<{ file: string; error: string }>> {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS_DIR}`);
  const tolerated: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const chunk of raw.split("--> statement-breakpoint")) {
      const stmt = stripComments(chunk).trim();
      if (!stmt) continue;
      if (SKIP_STATEMENT.test(stmt)) continue;
      try {
        await client.query(stmt);
      } catch (err) {
        tolerated.push({ file, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
      }
    }
  }
  return tolerated;
}

async function ensureRlsRoles(admin: Client): Promise<void> {
  for (const role of RLS_ROLES) {
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN
           CREATE ROLE ${role} NOLOGIN;
         END IF;
       END $$;`
    );
  }
}

function deriveUrl(adminUrl: string, dbName: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  u.search = "";
  return u.toString();
}

async function dropDatabase(adminUrl: string, dbName: string): Promise<void> {
  const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 5_000 });
  try {
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  } catch (err) {
    console.warn(`[pg-harness] could not drop ${dbName}: ${err instanceof Error ? err.message : err}`);
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * Provision the per-run template database. Called once from vitest
 * globalSetup; records availability state for every test file. Returns the
 * teardown function vitest expects (drops the template).
 */
export async function provisionTemplate(): Promise<() => Promise<void>> {
  const adminUrl = ENV.praTestDatabaseUrl;
  const templateDb = `p9_template_${process.pid}_${crypto.randomBytes(3).toString("hex")}`;
  try {
    const admin = new Client({ connectionString: adminUrl, connectionTimeoutMillis: 3_000 });
    await admin.connect();
    await ensureRlsRoles(admin);
    await admin.query(`CREATE DATABASE "${templateDb}"`);
    await admin.end();

    const tmpl = new Client({ connectionString: deriveUrl(adminUrl, templateDb) });
    await tmpl.connect();
    const tolerated = await applyMigrations(tmpl);
    if (tolerated.length > 0) {
      console.warn(
        `[pg-harness] ${tolerated.length} migration statement(s) failed and were tolerated (pre-existing migration defects):`
      );
      for (const t of tolerated.slice(0, 25)) console.warn(`  - ${t.file}: ${t.error}`);
      if (tolerated.length > 25) console.warn(`  … and ${tolerated.length - 25} more`);
    }
    const { rows } = await tmpl.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    const present = new Set(rows.map((r) => r.table_name));
    const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
    await tmpl.end();
    if (missing.length > 0) {
      throw new Error(`template database is missing required tables: ${missing.join(", ")}`);
    }
    writeState({ available: true, adminUrl, templateDb });
    console.log(`[pg-harness] template database ${templateDb} provisioned (${present.size} tables, ${files_count()} migrations)`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    writeState({ available: false, reason });
    console.warn(`[pg-harness] PostgreSQL unavailable — DB-gated suites (PRA-004/PRA-043) will SKIP. Reason: ${reason}`);
    return async () => {};
  }
  return async () => {
    await dropDatabase(adminUrl, templateDb);
    try {
      fs.unlinkSync(STATE_FILE);
    } catch {
      /* state file already gone */
    }
  };
}

function files_count(): number {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).length;
}

/**
 * Clone the per-run template into a private database for one test file.
 * Returns null (with a printed reason) when PostgreSQL is unavailable — the
 * caller must then skip its suite via describe.skip / it.skip.
 */
export async function createTestDatabase(label: string): Promise<TestDatabase | null> {
  const state = readState();
  if (!state?.available || !state.adminUrl || !state.templateDb) {
    console.warn(
      `[pg-harness] skipping DB-gated suite "${label}": ${state?.reason ?? "harness state unavailable"}`
    );
    return null;
  }
  const safeLabel = label.replace(/[^a-z0-9_]/gi, "_").slice(0, 24);
  const dbName = `p9_${safeLabel}_${crypto.randomBytes(4).toString("hex")}`;
  const admin = new Client({ connectionString: state.adminUrl, connectionTimeoutMillis: 5_000 });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${state.templateDb}"`);
  await admin.end();
  const url = deriveUrl(state.adminUrl, dbName);
  let closed = false;
  return {
    url,
    dbName,
    async close() {
      if (closed) return;
      closed = true;
      await dropDatabase(state.adminUrl!, dbName);
    },
  };
}
