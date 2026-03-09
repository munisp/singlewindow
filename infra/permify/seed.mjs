#!/usr/bin/env node
/**
 * seed.mjs — Permify relationship tuple seeder for TradeGateway NGSWTP
 *
 * Pushes the authorization schema and seed tuples to a running Permify instance.
 * Usage:
 *   node infra/permify/seed.mjs [--host http://localhost:3476] [--tenant t1]
 *
 * What it does:
 *   1. Writes the schema from schema.perm to Permify
 *   2. Creates a default tenant if needed
 *   3. Seeds demo relationship tuples for each role
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────────────────────
const PERMIFY_HOST = process.env.PERMIFY_HOST || "http://localhost:3476";
const TENANT_ID    = process.env.PERMIFY_TENANT || "tradegateway";
const SCHEMA_PATH  = join(__dirname, "schema.perm");

// ── Helpers ───────────────────────────────────────────────────────────────────
async function permifyRequest(path, method = "GET", body = null) {
  const url = `${PERMIFY_HOST}${path}`;
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Permify ${method} ${url} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

// ── Step 1: Create / verify tenant ───────────────────────────────────────────
async function ensureTenant() {
  console.log(`[permify-seed] Ensuring tenant: ${TENANT_ID}`);
  try {
    await permifyRequest(`/v1/tenants/${TENANT_ID}`, "GET");
    console.log(`[permify-seed] Tenant ${TENANT_ID} already exists`);
  } catch {
    await permifyRequest("/v1/tenants", "POST", { id: TENANT_ID, name: "TradeGateway NGSWTP" });
    console.log(`[permify-seed] Created tenant ${TENANT_ID}`);
  }
}

// ── Step 2: Write schema ──────────────────────────────────────────────────────
async function writeSchema() {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  console.log(`[permify-seed] Writing schema (${schema.length} chars)`);
  const result = await permifyRequest(
    `/v1/tenants/${TENANT_ID}/schemas/write`,
    "POST",
    { schema }
  );
  console.log(`[permify-seed] Schema written. Version: ${result.schema_version}`);
  return result.schema_version;
}

// ── Step 3: Write relationship tuples ────────────────────────────────────────
async function writeTuples(tuples) {
  const chunks = [];
  for (let i = 0; i < tuples.length; i += 50) {
    chunks.push(tuples.slice(i, i + 50));
  }

  let written = 0;
  for (const chunk of chunks) {
    await permifyRequest(
      `/v1/tenants/${TENANT_ID}/relationships/write`,
      "POST",
      {
        metadata: { schema_version: "" },
        tuples: chunk,
      }
    );
    written += chunk.length;
  }
  console.log(`[permify-seed] Wrote ${written} relationship tuples`);
}

// ── Seed data ─────────────────────────────────────────────────────────────────
// Demo users for each role (in production these come from Keycloak)
const DEMO_USERS = {
  admin:              "user:admin-001",
  trader:             "user:trader-001",
  customs_officer:    "user:customs-001",
  oga_officer:        "user:oga-001",
  finance_officer:    "user:finance-001",
  port_operator:      "user:port-001",
  auditor:            "user:auditor-001",
  compliance_officer: "user:compliance-001",
  inspector:          "user:inspector-001",
};

function tuple(entity, relation, subject) {
  return { entity, relation, subject };
}

const SEED_TUPLES = [
  // ── Organization membership ─────────────────────────────────────────────
  tuple({ type: "organization", id: "tradegateway" }, "admin",  DEMO_USERS.admin),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.trader),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.customs_officer),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.oga_officer),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.finance_officer),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.port_operator),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.auditor),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.compliance_officer),
  tuple({ type: "organization", id: "tradegateway" }, "member", DEMO_USERS.inspector),

  // ── Demo declaration (id: decl-1001) ────────────────────────────────────
  tuple({ type: "declaration", id: "decl-1001" }, "owner",           DEMO_USERS.trader),
  tuple({ type: "declaration", id: "decl-1001" }, "customs_officer", DEMO_USERS.customs_officer),
  tuple({ type: "declaration", id: "decl-1001" }, "admin",           DEMO_USERS.admin),

  // ── Demo OGA permit (id: permit-2001) ───────────────────────────────────
  tuple({ type: "permit", id: "permit-2001" }, "oga_officer",       DEMO_USERS.oga_officer),
  tuple({ type: "permit", id: "permit-2001" }, "declaration_owner", DEMO_USERS.trader),
  tuple({ type: "permit", id: "permit-2001" }, "admin",             DEMO_USERS.admin),

  // ── Demo payment invoice (id: inv-5001) ─────────────────────────────────
  tuple({ type: "payment", id: "inv-5001" }, "owner",           DEMO_USERS.trader),
  tuple({ type: "payment", id: "inv-5001" }, "finance_officer", DEMO_USERS.finance_officer),
  tuple({ type: "payment", id: "inv-5001" }, "admin",           DEMO_USERS.admin),

  // ── Demo trader profile (id: profile-42) ────────────────────────────────
  tuple({ type: "profile", id: "profile-42" }, "owner",    DEMO_USERS.trader),
  tuple({ type: "profile", id: "profile-42" }, "reviewer", DEMO_USERS.customs_officer),
  tuple({ type: "profile", id: "profile-42" }, "admin",    DEMO_USERS.admin),

  // ── Demo cargo (id: cargo-1001) ─────────────────────────────────────────
  tuple({ type: "cargo", id: "cargo-1001" }, "declaration_owner", DEMO_USERS.trader),
  tuple({ type: "cargo", id: "cargo-1001" }, "port_operator",     DEMO_USERS.port_operator),
  tuple({ type: "cargo", id: "cargo-1001" }, "inspector",         DEMO_USERS.inspector),
  tuple({ type: "cargo", id: "cargo-1001" }, "admin",             DEMO_USERS.admin),

  // ── Demo security alert (id: alert-001) ─────────────────────────────────
  tuple({ type: "security_alert", id: "alert-001" }, "analyst", DEMO_USERS.compliance_officer),
  tuple({ type: "security_alert", id: "alert-001" }, "admin",   DEMO_USERS.admin),

  // ── Demo AEO application (id: aeo-42) ───────────────────────────────────
  tuple({ type: "aeo_application", id: "aeo-42" }, "applicant", DEMO_USERS.trader),
  tuple({ type: "aeo_application", id: "aeo-42" }, "reviewer",  DEMO_USERS.customs_officer),
  tuple({ type: "aeo_application", id: "aeo-42" }, "admin",     DEMO_USERS.admin),

  // ── Demo audit record (id: audit-001) ───────────────────────────────────
  tuple({ type: "audit_record", id: "audit-001" }, "subject", DEMO_USERS.trader),
  tuple({ type: "audit_record", id: "audit-001" }, "auditor", DEMO_USERS.auditor),
  tuple({ type: "audit_record", id: "audit-001" }, "admin",   DEMO_USERS.admin),

  // ── Demo drawback claim (id: drawback-001) ──────────────────────────────
  tuple({ type: "drawback_claim", id: "drawback-001" }, "claimant",        DEMO_USERS.trader),
  tuple({ type: "drawback_claim", id: "drawback-001" }, "finance_officer", DEMO_USERS.finance_officer),
  tuple({ type: "drawback_claim", id: "drawback-001" }, "admin",           DEMO_USERS.admin),

  // ── Demo sanctions entry (id: sanctions-001) ────────────────────────────
  tuple({ type: "sanctions_entry", id: "sanctions-001" }, "compliance_officer", DEMO_USERS.compliance_officer),
  tuple({ type: "sanctions_entry", id: "sanctions-001" }, "admin",              DEMO_USERS.admin),

  // ── System config ────────────────────────────────────────────────────────
  tuple({ type: "system", id: "tradegateway" }, "admin", DEMO_USERS.admin),
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[permify-seed] Connecting to Permify at ${PERMIFY_HOST}`);

  try {
    await ensureTenant();
    await writeSchema();
    await writeTuples(SEED_TUPLES);
    console.log("[permify-seed] ✓ Seed complete");
  } catch (err) {
    console.error("[permify-seed] ✗ Seed failed:", err.message);
    console.error("[permify-seed] Make sure Permify is running: docker compose up -d permify");
    process.exit(1);
  }
}

main();
