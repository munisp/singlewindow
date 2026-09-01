/**
 * Phase 12 — CRM case workflow tests.
 *
 * Covers the pure, DB-free surfaces:
 *  - state machine transition guard (fail-closed table)
 *  - maker-checker close guard for dispute cases
 *  - SLA deadline computation
 *  - crm.case.v1 envelope v1.0 sign/verify roundtrip (synthetic test key)
 *  - tRPC procedure registration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import {
  assertTransitionAllowed,
  CaseTransitionError,
  closeBlocker,
  slaDeadlines,
  MAX_PAGE_SIZE,
} from "./crm/cases";
import { appRouter } from "./routers";

describe("case state machine", () => {
  it("allows the happy path open→triaged→in_progress→resolved→closed", () => {
    assertTransitionAllowed("open", "triaged");
    assertTransitionAllowed("triaged", "in_progress");
    assertTransitionAllowed("in_progress", "resolved");
    assertTransitionAllowed("resolved", "closed");
  });

  it("refuses skips and regressions", () => {
    expect(() => assertTransitionAllowed("open", "in_progress")).toThrow(CaseTransitionError);
    expect(() => assertTransitionAllowed("open", "resolved")).toThrow(CaseTransitionError);
    expect(() => assertTransitionAllowed("triaged", "open")).toThrow(CaseTransitionError);
    expect(() => assertTransitionAllowed("closed", "open")).toThrow(CaseTransitionError);
    expect(() => assertTransitionAllowed("resolved", "in_progress")).toThrow(CaseTransitionError);
  });

  it("refuses unknown statuses", () => {
    expect(() => assertTransitionAllowed("bogus", "triaged")).toThrow(CaseTransitionError);
  });

  it("caps page size", () => {
    expect(MAX_PAGE_SIZE).toBeLessThanOrEqual(100);
  });
});

describe("maker-checker close guard", () => {
  it("blocks closing unresolved cases", () => {
    expect(closeBlocker({ status: "in_progress", caseType: "general", resolutionApprovedBy: null } as any))
      .toMatch(/resolved/);
  });

  it("blocks closing unapproved dispute resolutions", () => {
    expect(closeBlocker({ status: "resolved", caseType: "dispute", resolutionApprovedBy: null } as any))
      .toMatch(/maker-checker/);
  });

  it("allows closing approved dispute resolutions", () => {
    expect(closeBlocker({ status: "resolved", caseType: "dispute", resolutionApprovedBy: 42 } as any)).toBeNull();
  });

  it("allows closing non-dispute resolutions without approval", () => {
    expect(closeBlocker({ status: "resolved", caseType: "payment", resolutionApprovedBy: null } as any)).toBeNull();
  });
});

describe("SLA deadlines", () => {
  it("scales by priority", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const crit = slaDeadlines("critical", now);
    const low = slaDeadlines("low", now);
    expect(crit.triageDue.getTime()).toBe(now.getTime() + 3600_000);
    expect(low.triageDue.getTime()).toBe(now.getTime() + 72 * 3600_000);
    expect(crit.resolutionDue.getTime()).toBeLessThan(low.resolutionDue.getTime());
  });
});

describe("crm.case.v1 envelope v1.0", () => {
  let privPem: string;
  let pubPem: string;

  beforeAll(() => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    privPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    pubPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.CRM_ENVELOPE_SIGNING_KEY = privPem;
    process.env.CRM_ENVELOPE_KEY_ID = "20260901";
  });

  afterAll(() => {
    delete process.env.CRM_ENVELOPE_SIGNING_KEY;
    delete process.env.CRM_ENVELOPE_KEY_ID;
  });

  it("builds a signed FHIR R4 Bundle envelope with JWS-EdDSA/JCS", async () => {
    const { buildAndSignCrmCaseEnvelope, verifyCrmCaseEnvelope, CRM_PRODUCER } = await import("./crm/envelope");
    const env = buildAndSignCrmCaseEnvelope({
      eventId: "evt-test-1",
      eventType: "crm.case.created.v1",
      resource: { caseNumber: "CRM-000001", status: "open" },
      principalId: "7",
      principalRole: "customs_officer",
      correlationId: "corr-1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      bundleId: "bdl-test-1",
      fullUrl: "urn:uuid:00000000-0000-4000-8000-000000000001",
    });
    expect(env.envelopeVersion).toBe("1.0");
    expect(env.producer).toBe(CRM_PRODUCER);
    expect(env.fhir.resourceType).toBe("Bundle");
    expect(env.fhir.type).toBe("message");
    const [h] = env.provenance.signature.split(".");
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    expect(header.alg).toBe("EdDSA");
    expect(header.kid).toBe("blueeconomy-singlewindow-crm-20260901");
    expect(verifyCrmCaseEnvelope(env, pubPem)).toBe(true);
  });

  it("fails closed without signing config", async () => {
    delete process.env.CRM_ENVELOPE_SIGNING_KEY;
    const { buildAndSignCrmCaseEnvelope, CrmSigningConfigError } = await import("./crm/envelope");
    expect(() =>
      buildAndSignCrmCaseEnvelope({
        eventId: "e",
        eventType: "crm.case.created.v1",
        resource: {},
        principalId: "1",
        principalRole: "admin",
        correlationId: "c",
        occurredAt: "2026-01-01T00:00:00Z",
        bundleId: "b",
        fullUrl: "urn:uuid:x",
      })
    ).toThrow(CrmSigningConfigError);
    process.env.CRM_ENVELOPE_SIGNING_KEY = privPem;
  });

  it("rejects unknown event types", async () => {
    const { buildAndSignCrmCaseEnvelope } = await import("./crm/envelope");
    expect(() =>
      buildAndSignCrmCaseEnvelope({
        eventId: "e",
        eventType: "crm.case.hacked.v1" as any,
        resource: {},
        principalId: "1",
        principalRole: "admin",
        correlationId: "c",
        occurredAt: "2026-01-01T00:00:00Z",
        bundleId: "b",
        fullUrl: "urn:uuid:x",
      })
    ).toThrow(/Unknown crm.case event type/);
  });
});

describe("tRPC registration", () => {
  const proc = (p: string) => (appRouter as any)._def.procedures[p];

  it("registers stakeholder-360 procedures", () => {
    expect(proc("stakeholders.get360")).toBeDefined();
    expect(proc("stakeholders.search")).toBeDefined();
  });

  it("registers case workflow procedures", () => {
    for (const p of [
      "cases.create",
      "cases.list",
      "cases.myCases",
      "cases.byId",
      "cases.assign",
      "cases.transition",
      "cases.approveResolution",
    ]) {
      expect(proc(p), p).toBeDefined();
    }
  });

  it("registers marketplace tier procedures", () => {
    for (const p of [
      "marketplace.listTiers",
      "marketplace.bindKeyToTier",
      "marketplace.bindMyKeyToTier",
      "marketplace.usageInvoice",
      "marketplace.usageSeries",
    ]) {
      expect(proc(p), p).toBeDefined();
    }
  });
});
