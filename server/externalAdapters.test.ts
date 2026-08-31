/**
 * Phase 9 WP-D — OGA external adapter layer tests.
 *
 * Asserts the HARD fail-closed contract of server/_core/externalAdapters/:
 *   (a) every adapter rejects with the stable reason ADAPTER_UNCONFIGURED
 *       (AdapterUnconfiguredError) when its endpoint/credentials are unset
 *       (default env);
 *   (b) with TEST-ONLY env keys set (synthetic Ed25519 keypairs generated
 *       in-test — never production material), each adapter produces a
 *       correctly signed envelope v1.0, verified with the framework's
 *       verifyEgressEnvelope (JCS + JWS-EdDSA, kid convention);
 *   (c) the disabled state surfaces the registered gap id via status() and
 *       externalAdapterStatuses() (PLATFORM_GAPS-resolved);
 *   (d) NO network calls occur when unconfigured (a counting fetch stub —
 *       test-only instrumentation, disclosed — asserts fetch is never
 *       attempted before the fail-closed gate rejects);
 *   (e) configured-but-unreachable endpoints surface honest transport errors
 *       (AdapterTransportError CONNECTION_ERROR) — nothing swallowed.
 *
 * DB not required. No mocks on production paths; the fetch stub is used only
 * to PROVE no network I/O happens in the unconfigured state.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { generateKeyPairSync, type KeyObject } from "node:crypto";
import {
  AdapterTransportError,
  AdapterUnconfiguredError,
  EXTERNAL_ADAPTERS,
  externalAdapterStatuses,
  verifyEgressEnvelope,
  type ExternalAdapter,
} from "./_core/externalAdapters";
import { submitBodogwuClearanceRequest, buildBodogwuClearanceEnvelope } from "./_core/externalAdapters/ncsBodogwu";
import { submitTmsFormM, buildTmsFormMEnvelope } from "./_core/externalAdapters/cbnTms";
import { submitNepcExportDocumentation, buildNepcExportDocumentationEnvelope } from "./_core/externalAdapters/nepc";
import { submitNisBorderNotice, buildNisBorderNoticeEnvelope } from "./_core/externalAdapters/nis";
import { submitPortHealthPratiqueNotice, buildPortHealthPratiqueNoticeEnvelope } from "./_core/externalAdapters/portHealth";
import { submitEsenShipEntryNotice, buildEsenShipEntryNoticeEnvelope } from "./_core/externalAdapters/npaEsen";
import { PLATFORM_GAPS } from "./_core/gapRegistry";

const PRINCIPAL = { principalId: "msw-user:1", principalRole: "msw-customs" };
const DIGEST = `sha256:${"0".repeat(64)}`;

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

/** One representative unconfigured call per adapter. */
const UNCONFIGURED_CALLS: Array<{ adapter: ExternalAdapter; invoke: () => Promise<unknown> }> = [
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "ncs-bodogwu")!,
    invoke: () =>
      submitBodogwuClearanceRequest(
        { declarationReference: "decl-1", customsBrokerReference: "brk-1", hsCode: "870380", dutyAssessmentDigestSha256: DIGEST, requestedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "cbn-tms")!,
    invoke: () =>
      submitTmsFormM(
        { formMNumber: "MF-2026-1", importerReference: "imp-1", hsCode: "870380", currency: "USD", invoiceDocumentDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "nepc")!,
    invoke: () =>
      submitNepcExportDocumentation(
        { exporterReference: "exp-1", exporterCertificateReference: "nepc-cert-1", productHsCode: "080111", destinationCountryCode: "GH", exportDocumentDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "nis")!,
    invoke: () =>
      submitNisBorderNotice(
        { visitId: "mswv-000001", noticeKind: "CREW_LIST", listDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "port-health")!,
    invoke: () =>
      submitPortHealthPratiqueNotice(
        { visitId: "mswv-000001", healthDeclarationReference: "mswd-000108", decision: "GRANTED", pratiqueRecordDigestSha256: DIGEST, decidedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
  {
    adapter: EXTERNAL_ADAPTERS.find((a) => a.adapterId === "npa-esen")!,
    invoke: () =>
      submitEsenShipEntryNotice(
        { portCallId: "pc-000321", vesselImoNumber: "9074729", portCode: "NGLOS", eta: "2026-09-03T06:00:00Z", agentReference: "agt-1", submittedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      ),
  },
];

describe("WP-D OGA adapters — registry completeness", () => {
  it("registers exactly the six authority adapters", () => {
    expect(EXTERNAL_ADAPTERS.map((a) => a.adapterId).sort()).toEqual(
      ["cbn-tms", "ncs-bodogwu", "nepc", "nis", "npa-esen", "port-health"].sort()
    );
  });
});

describe("(a) every adapter fails closed ADAPTER_UNCONFIGURED when unconfigured", () => {
  for (const { adapter, invoke } of UNCONFIGURED_CALLS) {
    it(`${adapter.adapterId} rejects with ADAPTER_UNCONFIGURED + ${adapter.gapId}`, async () => {
      await expect(invoke()).rejects.toMatchObject({
        name: "AdapterUnconfiguredError",
        reason: "ADAPTER_UNCONFIGURED",
        adapterId: adapter.adapterId,
        gapId: adapter.gapId,
      });
    });
  }

  it("even the pure build path refuses unsigned admission when unconfigured", () => {
    expect(() =>
      buildBodogwuClearanceEnvelope(
        { declarationReference: "d", customsBrokerReference: "b", hsCode: "870380", dutyAssessmentDigestSha256: DIGEST, requestedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      )
    ).toThrow(AdapterUnconfiguredError);
  });
});

describe("(c) disabled state surfaces the registered gap id", () => {
  it("status() reports disabled_gap_registered with the gap id for all six", () => {
    for (const adapter of EXTERNAL_ADAPTERS) {
      const status = adapter.status();
      expect(status.configured).toBe(false);
      expect(status.state).toBe("disabled_gap_registered");
      expect(status.gapId).toBe(adapter.gapId);
      expect(status.missing.length).toBeGreaterThan(0);
      // Never leaks secret values — only env var NAMES.
      for (const name of status.missing) {
        expect(name).toMatch(/^(NCS_BODOGWU|CBN_TMS|NEPC|NIS|PORT_HEALTH|NPA_ESEN)_(URL|SIGNING_KEY|KEY_ID)$/);
      }
    }
  });

  it("externalAdapterStatuses() resolves each gap against PLATFORM_GAPS", () => {
    const report = externalAdapterStatuses();
    expect(report).toHaveLength(6);
    for (const entry of report) {
      expect(entry.gap).not.toBeNull();
      expect(entry.gap!.id).toBe(entry.gapId);
      expect(entry.state).toBe("disabled_gap_registered");
    }
    // Spot-check the three new WP-D registrations + the three reused MSW gaps.
    const allGapIds = Object.values(PLATFORM_GAPS).map((g) => g.id);
    for (const id of ["GAP-OGA-BODOGWU", "GAP-OGA-CBNTMS", "GAP-OGA-NEPC", "GAP-MSW-NIS", "GAP-MSW-PH", "GAP-MSW-ESEN"]) {
      expect(allGapIds).toContain(id);
    }
  });
});

describe("(d) no network calls occur when unconfigured", () => {
  it("fetch is never attempted before the fail-closed gate rejects", async () => {
    // Test-only instrumentation: a counting fetch stub PROVES the absence of
    // network I/O (no production path is mocked).
    let fetchAttempts = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: unknown[]) => {
      fetchAttempts++;
      return originalFetch(...(args as Parameters<typeof fetch>));
    }) as typeof fetch;
    try {
      for (const { invoke } of UNCONFIGURED_CALLS) {
        await expect(invoke()).rejects.toMatchObject({ reason: "ADAPTER_UNCONFIGURED" });
      }
      expect(fetchAttempts).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("(b) configured adapters produce correctly signed envelope v1.0 egress", () => {
  function configureAdapter(urlEnv: string, keyEnv: string, idEnv: string, seed: string, epoch: string) {
    process.env[urlEnv] = "https://authority.example.invalid";
    process.env[keyEnv] = seed;
    process.env[idEnv] = epoch;
  }

  function syntheticKey(epoch: string) {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
    const privJwk = privateKey.export({ format: "jwk" }) as { d: string };
    const trust = new Map<string, KeyObject>();
    return { seed: privJwk.d, epoch, publicKey, trustFor: (kid: string) => (trust.set(kid, publicKey), trust) };
  }

  it("ncs-bodogwu signs a verifiable envelope with the contract kid", () => {
    const key = syntheticKey("5");
    configureAdapter("NCS_BODOGWU_URL", "NCS_BODOGWU_SIGNING_KEY", "NCS_BODOGWU_KEY_ID", key.seed, key.epoch);
    const adapter = EXTERNAL_ADAPTERS.find((a) => a.adapterId === "ncs-bodogwu")!;
    expect(adapter.status().state).toBe("configured");

    const envelope = buildBodogwuClearanceEnvelope(
      { declarationReference: "decl-1", customsBrokerReference: "brk-1", hsCode: "870380", dutyAssessmentDigestSha256: DIGEST, requestedAt: "2026-09-01T00:00:00Z" },
      PRINCIPAL
    );
    expect(envelope.envelopeVersion).toBe("1.0");
    expect(envelope.eventType).toBe("oga.ncs.bodogwu.clearance_requested.v1");
    const kid = `blueeconomy-singlewindow-oga-ncs-bodogwu-5`;
    const result = verifyEgressEnvelope(JSON.stringify(envelope), {
      producer: adapter.producer,
      kidPrefix: adapter.kidPrefix,
      trustKeys: key.trustFor(kid),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kid).toBe(kid);
  });

  it("all six adapters sign verifiable envelopes with their own kid prefixes", () => {
    const cases: Array<{ adapter: string; build: () => ReturnType<typeof buildBodogwuClearanceEnvelope> }> = [
      {
        adapter: "cbn-tms",
        build: () => buildTmsFormMEnvelope(
          { formMNumber: "MF-1", importerReference: "imp-1", hsCode: "870380", currency: "USD", invoiceDocumentDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
          PRINCIPAL
        ),
      },
      {
        adapter: "nepc",
        build: () => buildNepcExportDocumentationEnvelope(
          { exporterReference: "exp-1", exporterCertificateReference: "cert-1", productHsCode: "080111", destinationCountryCode: "GH", exportDocumentDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
          PRINCIPAL
        ),
      },
      {
        adapter: "nis",
        build: () => buildNisBorderNoticeEnvelope(
          { visitId: "mswv-1", noticeKind: "CREW_LIST", listDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
          PRINCIPAL
        ),
      },
      {
        adapter: "port-health",
        build: () => buildPortHealthPratiqueNoticeEnvelope(
          { visitId: "mswv-1", healthDeclarationReference: "mswd-1", decision: "GRANTED", pratiqueRecordDigestSha256: DIGEST, decidedAt: "2026-09-01T00:00:00Z" },
          PRINCIPAL
        ),
      },
      {
        adapter: "npa-esen",
        build: () => buildEsenShipEntryNoticeEnvelope(
          { portCallId: "pc-1", vesselImoNumber: "9074729", portCode: "NGLOS", eta: "2026-09-03T06:00:00Z", agentReference: "agt-1", submittedAt: "2026-09-01T00:00:00Z" },
          PRINCIPAL
        ),
      },
    ];
    const envPrefix: Record<string, string> = {
      "cbn-tms": "CBN_TMS", nepc: "NEPC", nis: "NIS", "port-health": "PORT_HEALTH", "npa-esen": "NPA_ESEN",
    };
    for (const { adapter: adapterId, build } of cases) {
      const key = syntheticKey("1");
      const prefix = envPrefix[adapterId];
      configureAdapter(`${prefix}_URL`, `${prefix}_SIGNING_KEY`, `${prefix}_KEY_ID`, key.seed, key.epoch);
      const adapter = EXTERNAL_ADAPTERS.find((a) => a.adapterId === adapterId)!;
      const envelope = build();
      const kid = `blueeconomy-singlewindow-oga-${adapterId}-1`;
      const result = verifyEgressEnvelope(JSON.stringify(envelope), {
        producer: adapter.producer,
        kidPrefix: adapter.kidPrefix,
        trustKeys: key.trustFor(kid),
      });
      expect(result.ok, `${adapterId} envelope must verify`).toBe(true);
      // Tamper → fail closed.
      const tampered = JSON.parse(JSON.stringify(envelope));
      tampered.payload.tampered = true;
      const r2 = verifyEgressEnvelope(JSON.stringify(tampered), {
        producer: adapter.producer,
        kidPrefix: adapter.kidPrefix,
        trustKeys: key.trustFor(kid),
      });
      expect(r2.ok).toBe(false);
    }
  });

  it("NIS crew-list notices floor at RESTRICTED (NDPA PERSONAL)", () => {
    const key = syntheticKey("2");
    configureAdapter("NIS_URL", "NIS_SIGNING_KEY", "NIS_KEY_ID", key.seed, key.epoch);
    const envelope = buildNisBorderNoticeEnvelope(
      { visitId: "mswv-1", noticeKind: "CREW_LIST", listDigestSha256: DIGEST, submittedAt: "2026-09-01T00:00:00Z" },
      PRINCIPAL
    );
    expect(envelope.classification).toBe("RESTRICTED");
    expect(envelope.recordClassification).toBe("RESTRICTED");
  });
});

describe("(e) configured-but-unreachable endpoints surface honest transport errors", () => {
  it("rejects with AdapterTransportError CONNECTION_ERROR (nothing swallowed)", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    const seed = (privateKey.export({ format: "jwk" }) as { d: string }).d;
    process.env.NCS_BODOGWU_URL = "http://127.0.0.1:1"; // guaranteed refused
    process.env.NCS_BODOGWU_SIGNING_KEY = seed;
    process.env.NCS_BODOGWU_KEY_ID = "1";
    await expect(
      submitBodogwuClearanceRequest(
        { declarationReference: "decl-1", customsBrokerReference: "brk-1", hsCode: "870380", dutyAssessmentDigestSha256: DIGEST, requestedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      )
    ).rejects.toMatchObject({ name: "AdapterTransportError", reason: "CONNECTION_ERROR" });
  });

  it("a partial env set is still unconfigured (half-configured never starts)", () => {
    process.env.NPA_ESEN_URL = "https://npa.example.invalid";
    // signing key + key id deliberately unset
    const adapter = EXTERNAL_ADAPTERS.find((a) => a.adapterId === "npa-esen")!;
    const status = adapter.status();
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(["NPA_ESEN_SIGNING_KEY", "NPA_ESEN_KEY_ID"]);
    expect(() =>
      buildEsenShipEntryNoticeEnvelope(
        { portCallId: "pc-1", vesselImoNumber: "9074729", portCode: "NGLOS", eta: "2026-09-03T06:00:00Z", agentReference: "agt-1", submittedAt: "2026-09-01T00:00:00Z" },
        PRINCIPAL
      )
    ).toThrow(AdapterUnconfiguredError);
  });
});
