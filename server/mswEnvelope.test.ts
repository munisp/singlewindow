/**
 * Phase 9 WP-C — maritime.msw.v1 envelope sign/verify roundtrip + contract
 * fixture validation.
 *
 * Validates ALL 11 contract fixtures (copied from blueeconomy-contracts
 * commit eb6b1ae fixtures/msw/ into server/testutils/fixtures/msw/ — see the
 * README.md there: contents are SYNTHETIC, signed with a disclosed throwaway
 * fixture key, kid blueeconomy-singlewindow-msw-0) against the module's
 * verifier/validator: signature, eventType, required fields, classification
 * floors, enum wire forms (no MSW_FORM_TYPE_/MSW_AGENCY_ prefixes) and
 * pratique/precondition binding.
 *
 * Roundtrip keys are generated in-test (synthetic, test-only); the fixture
 * key is the publicly disclosed throwaway from the contracts repo. No
 * production key material exists in this repo.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { generateKeyPairSync, createPublicKey, type KeyObject } from "node:crypto";
import {
  buildAndSignMswEnvelope,
  buildMswEnvelope,
  getMswSigningKey,
  isValidMswKeyId,
  MSW_EVENT_TYPES,
  MSW_KID_PREFIX,
  MSW_PRODUCER,
  MSW_TOPIC,
  mswClassificationFloor,
  MswSigningConfigError,
  parseMswTrustKeys,
  signMswEnvelope,
  validateMswEvent,
  verifyMswEnvelope,
  type MswEnvelope,
} from "./_core/mswEnvelope";

// ─── Synthetic test keys (test-only, disclosed) ──────────────────────────────

const FIXTURES_DIR = path.resolve(__dirname, "testutils", "fixtures", "msw");
/** Disclosed throwaway fixture key from blueeconomy-contracts fixtures/msw/README.md. */
const FIXTURE_KID = "blueeconomy-singlewindow-msw-0";
const FIXTURE_PUBLIC_KEY = "iWAFxZ7dXCQAa--7-WwPW4TXI2jI4mhphx0CVxN3vW8";

function fixtureTrustKeys(): Map<string, KeyObject> {
  return parseMswTrustKeys(`${FIXTURE_KID}=${FIXTURE_PUBLIC_KEY}`);
}

function generateTestKeyMaterial(epoch: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubJwk = publicKey.export({ format: "jwk" }) as { x: string };
  const privJwk = privateKey.export({ format: "jwk" }) as { d: string };
  return {
    kid: `${MSW_KID_PREFIX}${epoch}`,
    publicKeyBase64: Buffer.from(pubJwk.x, "base64url").toString("base64"),
    /** base64url of the 32-byte Ed25519 seed — accepted by MSW_ENVELOPE_SIGNING_KEY. */
    seedBase64Url: privJwk.d,
  };
}

const SAVED_ENV: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ["MSW_ENVELOPE_SIGNING_KEY", "MSW_ENVELOPE_KEY_ID"]) {
    SAVED_ENV[k] = process.env[k];
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ─── Signing key resolution (fail closed) ────────────────────────────────────

describe("MSW signing key resolution (fail closed)", () => {
  it("throws when MSW_ENVELOPE_SIGNING_KEY is unset — no unsigned admission", () => {
    delete process.env.MSW_ENVELOPE_SIGNING_KEY;
    process.env.MSW_ENVELOPE_KEY_ID = "1";
    expect(() => getMswSigningKey()).toThrow(MswSigningConfigError);
    expect(() => getMswSigningKey()).toThrow(/MSW_ENVELOPE_SIGNING_KEY/);
  });

  it("throws when MSW_ENVELOPE_KEY_ID is not a decimal epoch", () => {
    const km = generateTestKeyMaterial("1");
    process.env.MSW_ENVELOPE_SIGNING_KEY = km.seedBase64Url;
    process.env.MSW_ENVELOPE_KEY_ID = "not-an-epoch";
    expect(() => getMswSigningKey()).toThrow(MswSigningConfigError);
  });

  it("accepts a base64 32-byte seed and forms the contract kid", () => {
    const km = generateTestKeyMaterial("7");
    process.env.MSW_ENVELOPE_SIGNING_KEY = km.seedBase64Url;
    process.env.MSW_ENVELOPE_KEY_ID = "7";
    const key = getMswSigningKey();
    expect(key.kid).toBe("blueeconomy-singlewindow-msw-7");
    expect(isValidMswKeyId(key.kid)).toBe(true);
  });
});

// ─── Sign/verify roundtrip ───────────────────────────────────────────────────

describe("MSW envelope sign/verify roundtrip", () => {
  it("signs and verifies a visit_created envelope end to end", () => {
    const km = generateTestKeyMaterial("3");
    process.env.MSW_ENVELOPE_SIGNING_KEY = km.seedBase64Url;
    process.env.MSW_ENVELOPE_KEY_ID = "3";

    const signed = buildAndSignMswEnvelope({
      eventId: "evt-test-1",
      eventType: "maritime.msw.visit_created.v1",
      resource: {
        visitId: "mswv-000900",
        portCallVerified: false,
        vesselImoNumber: "9074729",
        vesselName: "MT TEST",
        vesselFlagCode: "NG",
        portCode: "NGLOS",
        agentReference: "agt-org-1",
        eta: "2026-09-03T06:00:00Z",
        status: "SUBMITTED",
        declaredAt: "2026-09-01T08:00:00Z",
      },
      principalId: "msw-user:1",
      principalRole: "msw-agent",
      correlationId: "corr-test-1",
      occurredAt: "2026-09-01T08:00:00Z",
      bundleId: "bdl-test-1",
      fullUrl: "urn:uuid:11111111-1111-4111-8111-111111111111",
    });
    expect(signed.producer).toBe(MSW_PRODUCER);
    expect(signed.classification).toBe("INTERNAL");
    expect(signed.recordClassification).toBeUndefined();

    // Protected header is exactly {"alg":"EdDSA","kid":...}.
    const [headerSeg] = signed.provenance.signature.split(".");
    expect(JSON.parse(Buffer.from(headerSeg, "base64url").toString("utf8"))).toEqual({
      alg: "EdDSA",
      kid: "blueeconomy-singlewindow-msw-3",
    });

    const trust = parseMswTrustKeys(`${km.kid}=${km.publicKeyBase64}`);
    const result = verifyMswEnvelope(JSON.stringify(signed), trust);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kid).toBe(km.kid);
      expect(result.envelope.eventType).toBe("maritime.msw.visit_created.v1");
    }
  });

  it("rejects a tampered envelope (payload_mismatch) and a bad signature", () => {
    const km = generateTestKeyMaterial("3");
    process.env.MSW_ENVELOPE_SIGNING_KEY = km.seedBase64Url;
    process.env.MSW_ENVELOPE_KEY_ID = "3";
    const signed = buildAndSignMswEnvelope({
      eventId: "evt-test-2",
      eventType: "maritime.msw.agent_nominated.v1",
      resource: {
        visitId: "mswv-000900",
        agentReference: "agt-org-1",
        nominationDocumentDigestSha256:
          "sha256:49326194562a972e71f536abacdfa75b8aeed19c4e1b2de014b41e9ced618a45",
        nominatedAt: "2026-09-01T07:30:00Z",
      },
      principalId: "msw-user:1",
      principalRole: "msw-agent",
      correlationId: "corr-test-2",
      occurredAt: "2026-09-01T07:30:00Z",
      bundleId: "bdl-test-2",
      fullUrl: "urn:uuid:22222222-2222-4222-8222-222222222222",
    });
    const trust = parseMswTrustKeys(`${km.kid}=${km.publicKeyBase64}`);

    const tampered = JSON.parse(JSON.stringify(signed));
    tampered.fhir.entry[0].resource.agentReference = "agt-org-ATTACKER";
    const r1 = verifyMswEnvelope(JSON.stringify(tampered), trust);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.reason).toBe("payload_mismatch");

    const other = generateTestKeyMaterial("3");
    const otherTrust = parseMswTrustKeys(`${other.kid}=${other.publicKeyBase64}`);
    const r2 = verifyMswEnvelope(JSON.stringify(signed), otherTrust);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("bad_signature");
  });

  it("floors personal-data declarations at RESTRICTED and boardings at CONFIDENTIAL", () => {
    const fal5 = mswClassificationFloor("maritime.msw.declaration_submitted.v1", { formType: "FAL5" });
    expect(fal5).toEqual({ floor: "RESTRICTED", recordClassification: "RESTRICTED" });
    const fal1 = mswClassificationFloor("maritime.msw.declaration_submitted.v1", { formType: "FAL1" });
    expect(fal1).toEqual({ floor: "INTERNAL", recordClassification: null });
    const boarding = mswClassificationFloor("maritime.msw.boarding_completed.v1", {});
    expect(boarding).toEqual({ floor: "CONFIDENTIAL", recordClassification: "CONFIDENTIAL" });
    const pratique = mswClassificationFloor("maritime.msw.pratique_granted.v1", {});
    expect(pratique).toEqual({ floor: "RESTRICTED", recordClassification: "RESTRICTED" });

    // Widening below the floor is refused at build time.
    expect(() =>
      buildMswEnvelope({
        eventId: "e", eventType: "maritime.msw.pratique_granted.v1",
        resource: {}, principalId: "p", principalRole: "msw-port-health",
        correlationId: "c", occurredAt: "2026-01-01T00:00:00Z", bundleId: "b",
        fullUrl: "urn:uuid:33333333-3333-4333-8333-333333333333",
        classification: "INTERNAL",
      })
    ).toThrow(/below the contract floor/);
  });
});

// ─── Contract fixture validation (all 11 event types) ────────────────────────

describe("contract fixtures (blueeconomy-contracts eb6b1ae, SYNTHETIC)", () => {
  const fixtureFiles = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));

  it("ships exactly the 11 contract event types", () => {
    expect(fixtureFiles.sort()).toEqual([...MSW_EVENT_TYPES].map((t) => `${t}.json`).sort());
    // Topic registration per docs/msw.md.
    expect(MSW_TOPIC).toBe("maritime.msw.v1");
  });

  for (const file of fixtureFiles) {
    it(`verifies + validates ${file}`, () => {
      const raw = fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8");
      const result = verifyMswEnvelope(raw, fixtureTrustKeys());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.eventType).toBe(file.replace(/\.json$/, ""));
        expect(result.kid).toBe(FIXTURE_KID);
        expect(result.envelope.producer).toBe(MSW_PRODUCER);
      }
    });
  }

  it("rejects the fixtures when the trust keyring is empty (fail closed)", () => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, "maritime.msw.visit_created.v1.json"), "utf8");
    const result = verifyMswEnvelope(raw, new Map());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_trust_keys");
  });

  it("rejects an unknown kid", () => {
    const raw = fs.readFileSync(path.join(FIXTURES_DIR, "maritime.msw.visit_created.v1.json"), "utf8");
    const km = generateTestKeyMaterial("99");
    const result = verifyMswEnvelope(raw, parseMswTrustKeys(`${km.kid}=${km.publicKeyBase64}`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("untrusted_kid");
  });
});

// ─── Contract validator negative cases ───────────────────────────────────────

function envelopeFor(eventType: MswEnvelope["eventType"], resource: Record<string, unknown>): MswEnvelope {
  return buildMswEnvelope({
    eventId: "evt-neg",
    eventType,
    resource,
    principalId: "msw-user:9",
    principalRole: "msw-agent",
    correlationId: "corr-neg",
    occurredAt: "2026-09-01T00:00:00Z",
    bundleId: "bdl-neg",
    fullUrl: "urn:uuid:44444444-4444-4444-8444-444444444444",
  });
}

describe("contract validator negatives (fail closed)", () => {
  it("rejects enum-prefixed wire values (MSW_FORM_TYPE_/MSW_AGENCY_)", () => {
    const env = envelopeFor("maritime.msw.declaration_submitted.v1", {
      declarationId: "mswd-1",
      visitId: "mswv-1",
      formType: "MSW_FORM_TYPE_FAL1",
      version: 1,
      formPayloadDigestSha256: "sha256:" + "0".repeat(64),
      priorSubmissionDigestSha256: "",
      containsPersonalData: false,
      submittedAt: "2026-09-01T00:00:00Z",
    });
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("enum_wire_violation");
  });

  it("rejects a classification below the floor on the wire", () => {
    const env = envelopeFor("maritime.msw.pratique_granted.v1", {
      visitId: "mswv-1",
      healthDeclarationReference: "mswd-1",
      grantedByReference: "ph-1",
      grantedAt: "2026-09-01T00:00:00Z",
    });
    // Simulate a widened producer bypassing build-time floor protection.
    env.classification = "INTERNAL";
    delete env.recordClassification;
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("classification_floor_violation");
  });

  it("rejects a non-Port-Health boarding completion without pratiqueGrantDigestSha256", () => {
    const env = envelopeFor("maritime.msw.boarding_completed.v1", {
      boardingId: "mswb-1",
      visitId: "mswv-1",
      agencies: ["NIS", "NCS"],
      startedAt: "2026-09-03T09:00:00Z",
      completedAt: "2026-09-03T11:00:00Z",
      pratiqueGrantDigestSha256: "",
      outcomeDigestSha256: "sha256:" + "1".repeat(64),
    });
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("pratique_binding_violation");
  });

  it("rejects a DEPARTURE clearance grant without preconditionChecklistDigestSha256", () => {
    const env = envelopeFor("maritime.msw.clearance_granted.v1", {
      clearanceId: "mswc-1",
      visitId: "mswv-1",
      kind: "DEPARTURE",
      decidedByAgency: "NIMASA",
      preconditionChecklistDigestSha256: "",
      conditionsDigestSha256: "",
      decidedAt: "2026-09-05T14:00:00Z",
    });
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("precondition_binding_violation");
  });

  it("rejects a version-chain break (version 1 with a prior digest)", () => {
    const env = envelopeFor("maritime.msw.declaration_submitted.v1", {
      declarationId: "mswd-1",
      visitId: "mswv-1",
      formType: "FAL2",
      version: 1,
      formPayloadDigestSha256: "sha256:" + "0".repeat(64),
      priorSubmissionDigestSha256: "sha256:" + "9".repeat(64),
      containsPersonalData: false,
      submittedAt: "2026-09-01T00:00:00Z",
    });
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("digest_format_violation");
  });

  it("rejects a fabricated portCallVerified=true without a portCallId", () => {
    const env = envelopeFor("maritime.msw.visit_created.v1", {
      visitId: "mswv-1",
      portCallVerified: true,
      vesselImoNumber: "9074729",
      vesselName: "MT X",
      vesselFlagCode: "NG",
      portCode: "NGLOS",
      agentReference: "agt-1",
      eta: "2026-09-03T06:00:00Z",
      status: "SUBMITTED",
      declaredAt: "2026-09-01T08:00:00Z",
    });
    const r = validateMswEvent(env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("payload_shape");
  });
});
