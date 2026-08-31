/**
 * Phase 10 WP-2b — MSW port-call verification end-to-end against the LIVE
 * NPA e-SEN sandbox + REAL PostgreSQL (no mocks anywhere on the path under
 * test).
 *
 * Proves the GAP-MSW-ESEN / PORT_CALL_UNAVAILABLE closure:
 *   1. sandbox reachable but NPA_ESEN_* env absent  → PORT_CALL_UNAVAILABLE
 *      (fail-closed, gap disclosed, visit honestly created unverified);
 *   2. env configured + e-SEN registered in the sandbox → createVisit
 *      advances PORT_CALL_UNAVAILABLE → VERIFIED (portCallVerified=true,
 *      upstream "npa-esen") via /v1/port-calls/verify;
 *   3. IMO/port mismatch → honest PORT_CALL_UNVERIFIED (sandbox answers
 *      verified:false / NOT_FOUND — never an error, never fabricated);
 *   4. sandbox DOWN (connection refused) → PORT_CALL_UNAVAILABLE again
 *      (AdapterTransportError → honest unavailable, visit still created
 *      unverified).
 *
 * Gates: AGENCY_SANDBOX_BASE_URLS (boot via scripts/agency-sandbox-e2e.sh)
 * AND PostgreSQL (server/testutils/pgTestHarness.ts). Both absent → skips
 * cleanly. Evidence records are appended to AGENCY_SANDBOX_EVIDENCE_OUT for
 * the signed conformance report.
 */
import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createTestDatabase } from "./testutils/pgTestHarness";

// Synthetic TEST-ONLY MSW envelope key (per run; never production material).
const testKey = generateKeyPairSync("ed25519");
process.env.MSW_ENVELOPE_SIGNING_KEY = (testKey.privateKey.export({ format: "jwk" }) as { d: string }).d;
process.env.MSW_ENVELOPE_KEY_ID = "0";

const BASE_URLS: Record<string, string> = process.env.AGENCY_SANDBOX_BASE_URLS
  ? JSON.parse(process.env.AGENCY_SANDBOX_BASE_URLS)
  : {};
const ESEN_URL = BASE_URLS["npa-esen"] ?? "";
const PLATFORM_SIGNING_KEY = process.env.AGENCY_SANDBOX_PLATFORM_SIGNING_KEY ?? "";
const PLATFORM_KEY_ID = process.env.AGENCY_SANDBOX_PLATFORM_KEY_ID ?? "1";
const EVIDENCE_OUT = process.env.AGENCY_SANDBOX_EVIDENCE_OUT ?? "";

const tdb = await createTestDatabase("msw_portcall_e2e");
if (tdb) process.env.DATABASE_URL = tdb.url;
const ready = Boolean(tdb && ESEN_URL && PLATFORM_SIGNING_KEY);
if (!ready) {
  console.warn(
    `[msw-portcall-e2e] SKIPPING: ${!tdb ? "PostgreSQL unavailable" : ""} ${
      !ESEN_URL ? "AGENCY_SANDBOX_BASE_URLS[npa-esen] unset" : ""
    } ${!PLATFORM_SIGNING_KEY ? "AGENCY_SANDBOX_PLATFORM_SIGNING_KEY unset" : ""}`.trim()
  );
}
const describeLive = ready ? describe : describe.skip;

const ENV_NAMES = ["NPA_ESEN_URL", "NPA_ESEN_TOKEN", "NPA_ESEN_SIGNING_KEY", "NPA_ESEN_KEY_ID"] as const;
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of ENV_NAMES) {
    SAVED[name] = process.env[name];
    delete process.env[name];
  }
});

afterAll(async () => {
  for (const [name, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const { closePool } = await import("./db");
  await closePool();
  await tdb?.close();
});

function recordEvidence(path: string, detail: string) {
  if (!EVIDENCE_OUT) return;
  const current = existsSync(EVIDENCE_OUT)
    ? JSON.parse(readFileSync(EVIDENCE_OUT, "utf8"))
    : { evidenceVersion: "1.0", generatedAt: new Date().toISOString(), scenarios: [] };
  current.scenarios.push({ adapterId: "npa-esen", path, outcome: "pass", detail });
  writeFileSync(EVIDENCE_OUT, JSON.stringify(current, null, 2));
}

async function seedUser(openId: string, name: string): Promise<number> {
  const { getDb } = await import("./db");
  const { users } = await import("../drizzle/schema");
  const db = (await getDb())!;
  const [u] = await db.insert(users).values({ openId, name, loginMethod: "test", role: "user" }).returning();
  return u.id;
}

const VISIT = {
  vesselImoNumber: "9074729",
  vesselName: "MT LAGOS TRADER",
  vesselFlagCode: "NG",
  portCode: "NGLOS",
  agentReference: "agt-e2e-1",
  eta: "2026-09-03T06:00:00Z",
};

describeLive("MSW port-call verification against the live e-SEN sandbox (real PostgreSQL)", () => {
  it(
    "PORT_CALL_UNAVAILABLE (env absent) → VERIFIED (sandbox live) → UNAVAILABLE again (sandbox down)",
    { timeout: 60_000 },
    async () => {
      const svc = await import("./mswService");
      const esen = await import("./_core/externalAdapters/npaEsen");
      const agent = { userId: await seedUser("msw-e2e-agent", "E2E Agent"), role: "msw-agent" as const };

      // ── 1. Sandbox reachable, adapter env absent → fail-closed UNAVAILABLE ──
      const unconfigured = await svc.createVisit(agent, { ...VISIT, portCallId: "pc-e2e-msw-1" });
      expect(unconfigured.portCallVerification).toBe("PORT_CALL_UNAVAILABLE");
      expect(unconfigured.portCallGapId).toBe("GAP-MSW-ESEN");
      expect(unconfigured.record.portCallVerified).toBe(false);
      recordEvidence("msw-unavailable-unconfigured", "createVisit with live sandbox but no NPA_ESEN_* env → PORT_CALL_UNAVAILABLE + GAP-MSW-ESEN disclosed; visit honestly unverified");

      // ── 2. Configure the adapter (TEST-scope env) and register an e-SEN ──
      process.env.NPA_ESEN_URL = ESEN_URL;
      process.env.NPA_ESEN_SIGNING_KEY = PLATFORM_SIGNING_KEY;
      process.env.NPA_ESEN_KEY_ID = PLATFORM_KEY_ID;
      const principal = { principalId: `msw-user:${agent.userId}`, principalRole: agent.role };
      const filed = await esen.submitEsenShipEntryNotice(
        {
          portCallId: "pc-e2e-msw-1",
          vesselImoNumber: VISIT.vesselImoNumber,
          portCode: VISIT.portCode,
          eta: VISIT.eta,
          agentReference: VISIT.agentReference,
          submittedAt: new Date().toISOString(),
        },
        principal
      );
      expect(filed.response.status).toBe("REGISTERED");

      const verified = await svc.createVisit(agent, { ...VISIT, portCallId: "pc-e2e-msw-1" });
      expect(verified.portCallVerification).toBe("VERIFIED");
      expect(verified.portCallUpstream).toBe("npa-esen");
      expect(verified.portCallGapId).toBeNull();
      expect(verified.record.portCallVerified).toBe(true);
      recordEvidence("msw-verified", "e-SEN registered in sandbox → createVisit advanced PORT_CALL_UNAVAILABLE → VERIFIED via /v1/port-calls/verify (upstream npa-esen, portCallVerified=true)");

      // ── 3. Wrong IMO → honest PORT_CALL_UNVERIFIED (sandbox verified:false) ──
      const mismatch = await svc.createVisit(agent, { ...VISIT, vesselImoNumber: "9386976", portCallId: "pc-e2e-msw-x" });
      expect(mismatch.portCallVerification).toBe("PORT_CALL_UNVERIFIED");
      expect(mismatch.record.portCallVerified).toBe(false);
      recordEvidence("msw-unverified-mismatch", "IMO/port with no matching e-SEN → honest PORT_CALL_UNVERIFIED (sandbox verified:false/NOT_FOUND, no error, no fabrication)");

      // ── 4. Sandbox DOWN → fail-closed PORT_CALL_UNAVAILABLE again ──
      process.env.NPA_ESEN_URL = "http://127.0.0.1:1"; // guaranteed refused
      const down = await svc.createVisit(agent, { ...VISIT, portCallId: "pc-e2e-msw-1" });
      expect(down.portCallVerification).toBe("PORT_CALL_UNAVAILABLE");
      expect(down.portCallGapId).toBe("GAP-MSW-ESEN");
      expect(down.record.portCallVerified).toBe(false);
      recordEvidence("msw-unavailable-sandbox-down", "e-SEN endpoint unreachable (connection refused) → AdapterTransportError mapped to honest PORT_CALL_UNAVAILABLE; visit still created unverified");
    }
  );
});
