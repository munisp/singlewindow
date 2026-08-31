/**
 * Phase 10 WP-2b — LIVE end-to-end tests for the six OGA external adapters
 * against the blueeconomy-agency-sandbox simulators (NO MOCKS of the
 * sandbox: every call below reaches a real Go sandbox process over HTTP).
 *
 * Gate: AGENCY_SANDBOX_BASE_URLS (JSON map adapterId → base URL). When the
 * env var is absent the whole suite skips — production CI without the
 * sandbox is unaffected, and the fail-closed ADAPTER_UNCONFIGURED semantics
 * remain proven by server/externalAdapters.test.ts (16/16) which runs
 * unconditionally.
 *
 * Provisioning (see scripts/agency-sandbox-e2e.sh — the only supported way
 * to run this suite):
 *   - AGENCY_SANDBOX_BASE_URLS        JSON {"ncs-bodogwu":"http://127.0.0.1:8081",...}
 *   - AGENCY_SANDBOX_ROGUE_BASE_URLS  JSON map → instances signed with an
 *                                     UNKNOWN key (trust-path proof)
 *   - AGENCY_SANDBOX_PLATFORM_SIGNING_KEY  base64url Ed25519 seed (TEST-ONLY,
 *                                     generated per run by the script; the
 *                                     sandbox is configured with
 *                                     SANDBOX_TRUST_KEYS so it REALLY
 *                                     verifies our Ed25519 JWS)
 *   - AGENCY_SANDBOX_PLATFORM_KEY_ID  decimal epoch (kid suffix)
 *   - AGENCY_SANDBOX_EVIDENCE_OUT     optional path: per-scenario evidence
 *                                     JSON (digests, kids, outcomes) for the
 *                                     signed conformance report
 *
 * For EACH adapter: happy path (typed receipt + sandbox-signed response
 * envelope verified against the sandbox JWKS, kid <agency>-sandbox-<epoch>),
 * refusal (X-Sandbox-Scenario: REFUSE → honest typed refusal), fault
 * (FAULT → 503 → UPSTREAM_ERROR; TIMEOUT → adapter deadline → TIMEOUT, no
 * hang, no fabricated success), trust (response signed by an unknown kid →
 * rejected by the framework verifier), and the unconfigured regression
 * (env absent → ADAPTER_UNCONFIGURED before any network I/O).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { createPublicKey, type KeyObject } from "node:crypto";
import { writeFileSync } from "node:fs";
import {
  AdapterTransportError,
  verifyEgressEnvelope,
  type SendOptions,
  type SignedEgressEnvelope,
} from "./_core/externalAdapters/base";
import { ncsBodogwuAdapter, parseBodogwuReceipt, submitBodogwuClearanceRequest } from "./_core/externalAdapters/ncsBodogwu";
import { cbnTmsAdapter, parseTmsReceipt, submitTmsFormM } from "./_core/externalAdapters/cbnTms";
import { nepcAdapter, parseNepcReceipt, submitNepcExportDocumentation } from "./_core/externalAdapters/nepc";
import { nisAdapter, parseNisReceipt, submitNisBorderNotice } from "./_core/externalAdapters/nis";
import { portHealthAdapter, parsePortHealthReceipt, submitPortHealthPratiqueNotice } from "./_core/externalAdapters/portHealth";
import { npaEsenAdapter, parseEsenReceipt, submitEsenShipEntryNotice } from "./_core/externalAdapters/npaEsen";
import type { ExternalAdapter } from "./_core/externalAdapters/base";

// ─── Gate ────────────────────────────────────────────────────────────────────

const BASE_URLS_JSON = process.env.AGENCY_SANDBOX_BASE_URLS ?? "";
const describeLive = BASE_URLS_JSON ? describe : describe.skip;
if (!BASE_URLS_JSON) {
  console.warn(
    "[agency-e2e] SKIPPING live sandbox suite: AGENCY_SANDBOX_BASE_URLS unset. " +
      "Boot the sandbox via scripts/agency-sandbox-e2e.sh to run it."
  );
}

const BASE_URLS: Record<string, string> = BASE_URLS_JSON ? JSON.parse(BASE_URLS_JSON) : {};
const ROGUE_BASE_URLS: Record<string, string> = process.env.AGENCY_SANDBOX_ROGUE_BASE_URLS
  ? JSON.parse(process.env.AGENCY_SANDBOX_ROGUE_BASE_URLS)
  : {};
const PLATFORM_SIGNING_KEY = process.env.AGENCY_SANDBOX_PLATFORM_SIGNING_KEY ?? "";
const PLATFORM_KEY_ID = process.env.AGENCY_SANDBOX_PLATFORM_KEY_ID ?? "1";
const EVIDENCE_OUT = process.env.AGENCY_SANDBOX_EVIDENCE_OUT ?? "";

const PRINCIPAL = { principalId: "msw-user:e2e", principalRole: "msw-customs" };
const DIGEST = `sha256:${"ab".repeat(32)}`;
const NOW = "2026-09-01T00:00:00Z";
const SCENARIO = "X-Sandbox-Scenario";

// ─── Env save/restore (never leak TEST-scope env into other suites) ──────────

const ADAPTER_ENV_NAMES = [
  "NCS_BODOGWU_URL", "NCS_BODOGWU_TOKEN", "NCS_BODOGWU_SIGNING_KEY", "NCS_BODOGWU_KEY_ID",
  "CBN_TMS_URL", "CBN_TMS_TOKEN", "CBN_TMS_SIGNING_KEY", "CBN_TMS_KEY_ID",
  "NEPC_URL", "NEPC_TOKEN", "NEPC_SIGNING_KEY", "NEPC_KEY_ID",
  "NIS_URL", "NIS_TOKEN", "NIS_SIGNING_KEY", "NIS_KEY_ID",
  "PORT_HEALTH_URL", "PORT_HEALTH_TOKEN", "PORT_HEALTH_SIGNING_KEY", "PORT_HEALTH_KEY_ID",
  "NPA_ESEN_URL", "NPA_ESEN_TOKEN", "NPA_ESEN_SIGNING_KEY", "NPA_ESEN_KEY_ID",
] as const;

const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const name of ADAPTER_ENV_NAMES) {
    SAVED[name] = process.env[name];
    delete process.env[name];
  }
});
afterAll(() => {
  for (const [name, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

// ─── Live sandbox helpers (JWKS trust, response-envelope verification) ──────

interface Jwks { keys: Array<{ kty: string; kid: string; alg?: string; x?: string; crv?: string }> }

/** Fetches the sandbox's own JWKS and builds the verifier trust set (kid → key). */
async function sandboxTrustKeys(baseUrl: string): Promise<Map<string, KeyObject>> {
  const res = await fetch(`${baseUrl}/.well-known/jwks.json`);
  expect(res.ok, `JWKS fetch from ${baseUrl}`).toBe(true);
  const jwks = (await res.json()) as Jwks;
  const trust = new Map<string, KeyObject>();
  for (const jwk of jwks.keys) {
    expect(jwk.kty).toBe("OKP");
    trust.set(jwk.kid, createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" }));
  }
  expect(trust.size).toBeGreaterThan(0);
  return trust;
}

/**
 * Verifies the sandbox-signed responseEnvelope captured from a live adapter
 * call: producer "<adapter>-sandbox", kid "<agency>-sandbox-<epoch>".
 */
function verifySandboxResponse(
  adapter: ExternalAdapter,
  rawBody: Record<string, unknown>,
  trust: Map<string, KeyObject>
) {
  const responseEnvelope = rawBody.responseEnvelope;
  expect(responseEnvelope, "sandbox response must carry responseEnvelope").toBeTruthy();
  const result = verifyEgressEnvelope(JSON.stringify(responseEnvelope), {
    producer: `${adapter.adapterId}-sandbox`,
    kidPrefix: `${adapter.adapterId}-sandbox-`,
    trustKeys: trust,
  });
  return result;
}

const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// ─── Evidence collector (signed conformance report input) ───────────────────

interface EvidenceRecord {
  adapterId: string;
  path: "happy" | "refusal" | "fault" | "timeout" | "trust" | "unconfigured";
  outcome: "pass" | "fail";
  requestSha256?: string;
  responseSha256?: string;
  responseKid?: string;
  signatureVerified?: boolean;
  detail: string;
}
const evidence: EvidenceRecord[] = [];
function record(entry: EvidenceRecord) {
  evidence.push(entry);
}
afterAll(() => {
  if (EVIDENCE_OUT && evidence.length > 0) {
    writeFileSync(
      EVIDENCE_OUT,
      JSON.stringify({ evidenceVersion: "1.0", generatedAt: new Date().toISOString(), scenarios: evidence }, null, 2)
    );
  }
});

// ─── Adapter case table (production call surfaces) ──────────────────────────

interface AdapterCase {
  adapter: ExternalAdapter;
  envPrefix: string;
  sendOptions: Omit<SendOptions, "headers">;
  parse: (body: unknown) => { receiptReference: string; status: string };
  /** The exported helper every production call site uses (smoke-checked). */
  helperInvoke: () => Promise<{ response: { status: string } }>;
  happyStatus: string;
  refusalStatus: string;
}

const CASES: AdapterCase[] = [
  {
    adapter: ncsBodogwuAdapter,
    envPrefix: "NCS_BODOGWU",
    sendOptions: {
      path: "/v1/clearance-requests",
      eventType: "oga.ncs.bodogwu.clearance_requested.v1",
      payload: {
        declarationReference: "decl-e2e-1",
        customsBrokerReference: "brk-e2e-1",
        hsCode: "870380",
        dutyAssessmentDigestSha256: DIGEST,
        requestedAt: NOW,
      },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
      classification: "CONFIDENTIAL",
      recordClassification: "CONFIDENTIAL",
    },
    parse: parseBodogwuReceipt,
    helperInvoke: () =>
      submitBodogwuClearanceRequest(
        { declarationReference: "decl-e2e-helper", customsBrokerReference: "brk-e2e-1", hsCode: "870380", dutyAssessmentDigestSha256: DIGEST, requestedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "ACCEPTED",
    refusalStatus: "REJECTED",
  },
  {
    adapter: cbnTmsAdapter,
    envPrefix: "CBN_TMS",
    sendOptions: {
      path: "/v1/form-m",
      eventType: "oga.cbn.tms.form_m_submitted.v1",
      payload: {
        formMNumber: "MF-2026-E2E-1",
        importerReference: "imp-e2e-1",
        hsCode: "870380",
        currency: "USD",
        invoiceDocumentDigestSha256: DIGEST,
        submittedAt: NOW,
      },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
    },
    parse: parseTmsReceipt,
    helperInvoke: () =>
      submitTmsFormM(
        { formMNumber: "MF-2026-E2E-H", importerReference: "imp-e2e-1", hsCode: "870380", currency: "USD", invoiceDocumentDigestSha256: DIGEST, submittedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "REGISTERED",
    refusalStatus: "REJECTED",
  },
  {
    adapter: nepcAdapter,
    envPrefix: "NEPC",
    sendOptions: {
      path: "/v1/export-documentation",
      eventType: "oga.nepc.export_documentation_submitted.v1",
      payload: {
        exporterReference: "exp-e2e-1",
        exporterCertificateReference: "NEPC-CERT-E2E-1",
        productHsCode: "080111",
        destinationCountryCode: "GH",
        exportDocumentDigestSha256: DIGEST,
        submittedAt: NOW,
      },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
    },
    parse: parseNepcReceipt,
    helperInvoke: () =>
      submitNepcExportDocumentation(
        { exporterReference: "exp-e2e-1", exporterCertificateReference: "NEPC-CERT-E2E-H", productHsCode: "080111", destinationCountryCode: "GH", exportDocumentDigestSha256: DIGEST, submittedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "ACCEPTED",
    refusalStatus: "REJECTED",
  },
  {
    adapter: nisAdapter,
    envPrefix: "NIS",
    sendOptions: {
      path: "/v1/border-notices",
      eventType: "oga.nis.border_notice_submitted.v1",
      payload: { visitId: "mswv-e2e-1", noticeKind: "CREW_LIST", listDigestSha256: DIGEST, submittedAt: NOW },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
      classification: "RESTRICTED",
      recordClassification: "RESTRICTED",
    },
    parse: parseNisReceipt,
    helperInvoke: () =>
      submitNisBorderNotice(
        { visitId: "mswv-e2e-helper", noticeKind: "CREW_LIST", listDigestSha256: DIGEST, submittedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "ACKNOWLEDGED",
    refusalStatus: "REJECTED",
  },
  {
    adapter: portHealthAdapter,
    envPrefix: "PORT_HEALTH",
    sendOptions: {
      path: "/v1/pratique-notices",
      eventType: "oga.port_health.pratique_notice_submitted.v1",
      payload: {
        visitId: "mswv-e2e-1",
        healthDeclarationReference: "mswd-e2e-1",
        decision: "GRANTED",
        pratiqueRecordDigestSha256: DIGEST,
        decidedAt: NOW,
      },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
      classification: "RESTRICTED",
      recordClassification: "RESTRICTED",
    },
    parse: parsePortHealthReceipt,
    helperInvoke: () =>
      submitPortHealthPratiqueNotice(
        { visitId: "mswv-e2e-helper", healthDeclarationReference: "mswd-e2e-1", decision: "GRANTED", pratiqueRecordDigestSha256: DIGEST, decidedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "ACKNOWLEDGED",
    refusalStatus: "REJECTED",
  },
  {
    adapter: npaEsenAdapter,
    envPrefix: "NPA_ESEN",
    sendOptions: {
      path: "/v1/ship-entry-notices",
      eventType: "oga.npa.esen.ship_entry_notice_submitted.v1",
      payload: {
        portCallId: "pc-e2e-1",
        vesselImoNumber: "9074729",
        portCode: "NGLOS",
        eta: "2026-09-03T06:00:00Z",
        agentReference: "agt-e2e-1",
        submittedAt: NOW,
      },
      principalId: PRINCIPAL.principalId,
      principalRole: PRINCIPAL.principalRole,
      classification: "INTERNAL",
    },
    parse: parseEsenReceipt,
    helperInvoke: () =>
      submitEsenShipEntryNotice(
        { portCallId: "pc-e2e-helper", vesselImoNumber: "9074729", portCode: "NGLOS", eta: "2026-09-03T06:00:00Z", agentReference: "agt-e2e-1", submittedAt: NOW },
        PRINCIPAL
      ),
    happyStatus: "REGISTERED",
    refusalStatus: "REJECTED",
  },
];

/** Points one adapter at a live sandbox base URL with the TEST-ONLY platform key. */
function configure(c: AdapterCase, baseUrl: string) {
  process.env[`${c.envPrefix}_URL`] = baseUrl;
  process.env[`${c.envPrefix}_SIGNING_KEY`] = PLATFORM_SIGNING_KEY;
  process.env[`${c.envPrefix}_KEY_ID`] = PLATFORM_KEY_ID;
}

/**
 * Full production send path with the raw response body captured for
 * envelope verification (the parser wrapper is transparent: it delegates to
 * the adapter's own parser).
 */
async function sendCapturing<T>(
  c: AdapterCase,
  parse: (body: unknown) => T,
  headers?: Record<string, string>
): Promise<{ envelope: SignedEgressEnvelope; response: T; rawBody: Record<string, unknown> }> {
  let rawBody: Record<string, unknown> | undefined;
  const result = await c.adapter.send({ ...c.sendOptions, ...(headers ? { headers } : {}) }, (body) => {
    rawBody = body as Record<string, unknown>;
    return parse(body);
  });
  expect(rawBody, "raw sandbox body captured").toBeTruthy();
  return { ...result, rawBody: rawBody! };
}

// ─── The live suite ──────────────────────────────────────────────────────────

describeLive("WP-2b live agency-sandbox end-to-end (real sandbox processes, no mocks)", () => {
  for (const c of CASES) {
    describe(`${c.adapter.adapterId} (${c.adapter.authority})`, () => {
      it("happy path: signed egress → typed receipt + sandbox-signed response envelope verifies (kid <agency>-sandbox-<epoch>)", async () => {
        configure(c, BASE_URLS[c.adapter.adapterId]);
        const trust = await sandboxTrustKeys(BASE_URLS[c.adapter.adapterId]);
        const { envelope, response, rawBody } = await sendCapturing(c, c.parse);
        expect(response.status).toBe(c.happyStatus);
        expect(response.receiptReference).toBeTruthy();
        expect(rawBody.sandbox).toBe(true);
        // The sandbox REALLY verified our Ed25519 JWS (SANDBOX_TRUST_KEYS set).
        const verified = verifySandboxResponse(c.adapter, rawBody, trust);
        expect(verified.ok, verified.ok ? "" : `${verified.reason}: ${verified.detail}`).toBe(true);
        if (verified.ok) {
          expect(verified.kid).toMatch(new RegExp(`^${c.adapter.adapterId}-sandbox-\\d+$`));
          const payload = verified.envelope.payload as Record<string, unknown>;
          expect(payload.signatureVerified, "sandbox must have verified our egress signature").toBe(true);
          expect(payload.correlationId).toBe(envelope.correlationId);
          record({
            adapterId: c.adapter.adapterId, path: "happy", outcome: "pass",
            requestSha256: sha256(envelope), responseSha256: sha256(rawBody),
            responseKid: verified.kid, signatureVerified: payload.signatureVerified === true,
            detail: `typed receipt status=${response.status}; response envelope JWS verified against sandbox JWKS`,
          });
        }
        // The exported helper (production call surface) reaches the sandbox too.
        const helper = await c.helperInvoke();
        expect(helper.response.status).toBe(c.happyStatus);
      });

      it("refusal path: X-Sandbox-Scenario REFUSE → honest typed refusal (no error, no fabrication)", async () => {
        configure(c, BASE_URLS[c.adapter.adapterId]);
        const trust = await sandboxTrustKeys(BASE_URLS[c.adapter.adapterId]);
        const { envelope, response, rawBody } = await sendCapturing(c, c.parse, { [SCENARIO]: "REFUSE" });
        expect(response.status).toBe(c.refusalStatus);
        expect(typeof rawBody.detail === "string" ? rawBody.detail : "").not.toBe("");
        const verified = verifySandboxResponse(c.adapter, rawBody, trust);
        expect(verified.ok).toBe(true);
        record({
          adapterId: c.adapter.adapterId, path: "refusal", outcome: "pass",
          requestSha256: sha256(envelope), responseSha256: sha256(rawBody),
          responseKid: verified.ok ? verified.kid : undefined,
          detail: `typed refusal surfaced: status=${response.status} detail=${String(rawBody.detail)}`,
        });
      });

      it("fault path: FAULT scenario → AdapterTransportError UPSTREAM_ERROR (HTTP 503, fail closed)", async () => {
        configure(c, BASE_URLS[c.adapter.adapterId]);
        const err = await sendCapturing(c, c.parse, { [SCENARIO]: "FAULT" }).then(
          () => null,
          (e: unknown) => e
        );
        expect(err).toBeInstanceOf(AdapterTransportError);
        expect((err as AdapterTransportError).reason).toBe("UPSTREAM_ERROR");
        expect((err as AdapterTransportError).statusCode).toBe(503);
        record({
          adapterId: c.adapter.adapterId, path: "fault", outcome: "pass",
          detail: "FAULT scenario surfaced as AdapterTransportError UPSTREAM_ERROR (HTTP 503); no fabricated success",
        });
      });

      it("fault path: TIMEOUT scenario → AdapterTransportError TIMEOUT at the adapter deadline (no hang)", { timeout: 30_000 }, async () => {
        configure(c, BASE_URLS[c.adapter.adapterId]);
        const started = Date.now();
        const err = await sendCapturing(c, c.parse, { [SCENARIO]: "TIMEOUT" }).then(
          () => null,
          (e: unknown) => e
        );
        const elapsedMs = Date.now() - started;
        expect(err).toBeInstanceOf(AdapterTransportError);
        expect((err as AdapterTransportError).reason).toBe("TIMEOUT");
        // The sandbox hangs 30s; the adapter's own 10s deadline must trip first.
        expect(elapsedMs).toBeLessThan(20_000);
        record({
          adapterId: c.adapter.adapterId, path: "timeout", outcome: "pass",
          detail: `TIMEOUT scenario tripped the adapter deadline in ${elapsedMs}ms (sandbox hangs 30s); fail closed`,
        });
      });

      it("trust path: response envelope signed by an UNKNOWN kid is rejected", async () => {
        const rogueUrl = ROGUE_BASE_URLS[c.adapter.adapterId];
        expect(rogueUrl, `rogue sandbox instance for ${c.adapter.adapterId}`).toBeTruthy();
        // Egress to the rogue instance (it verifies structure; we trust-keys
        // it too) — then verify its response against the TRUSTED JWKS set.
        configure(c, rogueUrl);
        const { rawBody } = await sendCapturing(c, c.parse);
        expect(rawBody.responseEnvelope).toBeTruthy();
        const trust = await sandboxTrustKeys(BASE_URLS[c.adapter.adapterId]); // trusted stack only
        const rejected = verifySandboxResponse(c.adapter, rawBody, trust);
        expect(rejected.ok).toBe(false);
        if (!rejected.ok) expect(rejected.reason).toBe("untrusted_kid");
        // And the rogue envelope IS well-formed — it verifies under its OWN
        // JWKS, proving the rejection is about trust, not format.
        const rogueTrust = await sandboxTrustKeys(rogueUrl);
        const rogueVerified = verifySandboxResponse(c.adapter, rawBody, rogueTrust);
        expect(rogueVerified.ok).toBe(true);
        record({
          adapterId: c.adapter.adapterId, path: "trust", outcome: "pass",
          responseSha256: sha256(rawBody),
          responseKid: rogueVerified.ok ? rogueVerified.kid : undefined,
          detail: "unknown-kid response rejected with untrusted_kid against the trusted JWKS set; verifies only under the rogue JWKS",
        });
      });
    });
  }

  it("unconfigured regression: env absent → ADAPTER_UNCONFIGURED before any network I/O (sandbox UP)", async () => {
    // All adapter env cleared by beforeEach; sandbox base URLs still live.
    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchAttempts++;
      return originalFetch(...(args as Parameters<typeof fetch>));
    }) as typeof fetch;
    try {
      for (const c of CASES) {
        await expect(c.helperInvoke()).rejects.toMatchObject({
          name: "AdapterUnconfiguredError",
          reason: "ADAPTER_UNCONFIGURED",
          adapterId: c.adapter.adapterId,
          gapId: c.adapter.gapId,
        });
      }
      expect(fetchAttempts).toBe(0);
      for (const c of CASES) {
        record({
          adapterId: c.adapter.adapterId, path: "unconfigured", outcome: "pass",
          detail: `ADAPTER_UNCONFIGURED (${c.adapter.gapId}) raised before any network I/O while the sandbox was reachable`,
        });
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
