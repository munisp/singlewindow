/**
 * PRA-068 (Phase 9) — env-validation sweep gate.
 *
 * Every process.env.<NAME> read in server production code must be registered
 * in the central registry (server/_core/env.ts). This test fails the suite
 * on any scattered unregistered read, so the sweep cannot regress. It also
 * asserts the fail-closed production posture: no secret-shaped ENV entry
 * carries a non-empty default, and validateProductionConfig rejects a
 * production boot missing any of the PRA-068-critical secrets when they are
 * required.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { ENV, validateProductionConfig } from "./_core/env";

const SERVER_DIR = path.resolve(__dirname);
const ENV_TS = path.join(SERVER_DIR, "_core", "env.ts");

/** Test files and the DB-gated test harness may read test-only env freely. */
function isTestCode(rel: string): boolean {
  return rel.endsWith(".test.ts") || rel.startsWith(`testutils${path.sep}`);
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

describe("env-validation sweep (PRA-068)", () => {
  it("every process.env read in server production code is registered in env.ts", () => {
    const envSrc = fs.readFileSync(ENV_TS, "utf8");
    const registered = new Set(
      [...envSrc.matchAll(/process\.env\.([A-Z_0-9]+)/g)].map((m) => m[1])
    );
    const scattered: string[] = [];
    for (const file of walk(SERVER_DIR)) {
      const rel = path.relative(SERVER_DIR, file);
      if (isTestCode(rel)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
        const name = m[1];
        // NODE_ENV / VITEST are runtime-owned, not configuration.
        if (name === "NODE_ENV" || name === "VITEST") continue;
        if (!registered.has(name)) {
          scattered.push(`${rel}: process.env.${name}`);
        }
      }
    }
    expect(
      scattered,
      `unregistered env reads (register in server/_core/env.ts):\n${scattered.join("\n")}`
    ).toEqual([]);
  });

  it("no secret-shaped ENV entry has a non-empty default", () => {
    const envSrc = fs.readFileSync(ENV_TS, "utf8");
    const offenders: string[] = [];
    for (const m of envSrc.matchAll(/process\.env\.([A-Z_0-9]+)\s*\?\?\s*"([^"]+)"/g)) {
      const [, name, def] = m;
      // Endpoint URLs (e.g. NIGERIA_ID_TOKEN_URL) are not secrets; the sweep
      // targets hardcoded secret VALUES.
      const looksLikeEndpoint = /^(https?|postgres(ql)?|redis|amqp|kafka|grpc)/i.test(def);
      if (/(SECRET|PASSWORD|_KEY|TOKEN)/.test(name) && !/_URL$/.test(name) && def !== "" && !looksLikeEndpoint) {
        offenders.push(`${name} has a hardcoded default`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("production boot still fails closed on missing critical configuration", () => {
    expect(() =>
      validateProductionConfig({
        ...ENV,
        databaseUrl: "",
        cookieSecret: "",
        keycloakClientSecret: "",
        caddyAskSecret: "",
      })
    ).toThrow(/Production configuration rejected/);
  });

  it("central registry is populated (sweep registry landed)", () => {
    // Spot-check entries from each sweep category.
    expect(ENV).toHaveProperty("piiEncryptionKey");
    expect(ENV).toHaveProperty("mojaloopWebhookSecret");
    expect(ENV).toHaveProperty("opensearchUrl");
    expect(ENV).toHaveProperty("geoEnvelopeTrustKeys");
    expect(ENV).toHaveProperty("permifyUrl");
  });
});
