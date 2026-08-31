/**
 * pcsEnvelope.test.ts — Phase 8 envelope v1.0 provenance verification tests.
 *
 * Envelopes are signed exactly per the fleet scheme (port-interop
 * internal/events/signing.go): JWS compact serialization, EdDSA/Ed25519 over
 * the JCS-canonical (RFC 8785) envelope with provenance.signature excluded,
 * header {"alg":"EdDSA","kid":"port-interoperability-<epoch>"}. Real keys are
 * generated with node:crypto — nothing is mocked.
 */

import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import {
  canonicalizeJcs,
  parseTrustKeys,
  verifyPcsEnvelope,
  PcsTrustConfigError,
  type PcsEnvelope,
} from "./_core/pcsEnvelope";

const KID = "port-interoperability-1";

function makeKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return { privateKey, publicKeyRaw: Buffer.from(jwk.x, "base64url") };
}

/** Builds + signs an envelope exactly like the Go producer. */
function signedEnvelope(privateKey: KeyObject, kid: string, overrides: Record<string, unknown> = {}) {
  const payload = JSON.stringify({
    booking_id: "bk-9",
    status: "PAID",
    amount_kobo: 4500000,
    currency: "NGN",
    payment_receipt_ref: "rcpt-1",
  });
  const envelope: Record<string, unknown> = {
    envelopeVersion: "1.0",
    eventId: "3f6b1f3c-2c4b-4f3a-9a3e-6c0f9d2a0b11",
    eventType: "booking.paid",
    occurredAt: "2026-09-01T10:00:00.000Z",
    producer: "s1-port-interoperability",
    correlationId: "corr-1",
    classification: "INTERNAL",
    fhir: {
      resourceType: "Bundle",
      type: "message",
      timestamp: "2026-09-01T10:00:00.000Z",
      entry: [
        {
          fullUrl: "urn:uuid:9d8d2d44-0d31-4f9d-a111-222222222222",
          resource: {
            resourceType: "Basic",
            id: "bk-9",
            code: { text: "booking.paid" },
            extension: [
              {
                url: "https://blueeconomy.gov.ng/fhir/StructureDefinition/domain-payload",
                valueString: payload,
              },
              {
                url: "https://blueeconomy.gov.ng/fhir/StructureDefinition/amount-kobo",
                valueString: "4500000",
              },
              {
                url: "https://blueeconomy.gov.ng/fhir/StructureDefinition/payment-receipt-ref",
                valueString: "rcpt-1",
              },
            ],
          },
        },
      ],
    },
    provenance: {
      principalId: "user:1",
      principalRole: "trucker",
      signature: "",
      ledgerCommitHash: "abc123",
    },
    ...overrides,
  };
  // Sign: header + JCS(envelope minus signature) + Ed25519.
  const stripped = JSON.parse(JSON.stringify(envelope)) as Record<string, unknown>;
  delete (stripped.provenance as Record<string, unknown>).signature;
  const canonical = canonicalizeJcs(stripped);
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid }), "utf8").toString("base64url");
  const payloadSegment = Buffer.from(canonical, "utf8").toString("base64url");
  const signature = cryptoSign(null, Buffer.from(`${header}.${payloadSegment}`, "utf8"), privateKey);
  (envelope.provenance as Record<string, unknown>).signature = `${header}.${payloadSegment}.${signature.toString("base64url")}`;
  return JSON.stringify(envelope);
}

describe("canonicalizeJcs (RFC 8785)", () => {
  it("orders object keys by UTF-16 code units, no whitespace", () => {
    expect(canonicalizeJcs({ b: 1, a: 2, "10": 3 })).toBe('{"10":3,"a":2,"b":1}');
  });

  it("serializes numbers per ECMAScript Number::toString", () => {
    expect(canonicalizeJcs({ n: [1, 1.5, -0, 1e30, 0.1] })).toBe('{"n":[1,1.5,0,1e+30,0.1]}');
  });

  it("escapes strings per JSON.stringify (shortest escapes, lowercase hex)", () => {
    expect(canonicalizeJcs({ s: 'a"b\\c\n\u0001' })).toBe('{"s":"a\\"b\\\\c\\n\\u0001"}');
  });

  it("handles nested structures and unicode", () => {
    expect(canonicalizeJcs({ z: { y: [true, null, "₦"] } })).toBe('{"z":{"y":[true,null,"₦"]}}');
  });

  it("rejects lone surrogates", () => {
    expect(() => canonicalizeJcs({ s: "\ud800" })).toThrow();
  });
});

describe("parseTrustKeys", () => {
  it("parses a kid → base64 key map", () => {
    const { publicKeyRaw } = makeKeyPair();
    const map = parseTrustKeys(JSON.stringify({ [KID]: publicKeyRaw.toString("base64") }));
    expect(map.size).toBe(1);
  });

  it("accepts hex-encoded keys", () => {
    const { publicKeyRaw } = makeKeyPair();
    expect(parseTrustKeys(JSON.stringify({ [KID]: publicKeyRaw.toString("hex") })).size).toBe(1);
  });

  it("fails closed on empty / malformed / non-port-interop kids / wrong sizes", () => {
    expect(() => parseTrustKeys("")).toThrow(PcsTrustConfigError);
    expect(() => parseTrustKeys("not-json")).toThrow(PcsTrustConfigError);
    expect(() => parseTrustKeys("{}")).toThrow(PcsTrustConfigError);
    expect(() => parseTrustKeys(JSON.stringify({ "other-producer-1": "AAAA" }))).toThrow(PcsTrustConfigError);
    expect(() => parseTrustKeys(JSON.stringify({ [KID]: Buffer.alloc(16).toString("base64") }))).toThrow(PcsTrustConfigError);
    expect(() => parseTrustKeys(JSON.stringify({ "port-interoperability-x": "AAAA" }))).toThrow(PcsTrustConfigError);
  });
});

describe("verifyPcsEnvelope", () => {
  function setup() {
    const { privateKey, publicKeyRaw } = makeKeyPair();
    const trust = parseTrustKeys(JSON.stringify({ [KID]: publicKeyRaw.toString("base64") }));
    return { privateKey, trust };
  }

  it("verifies a well-formed signed envelope and extracts the typed event", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const verdict = verifyPcsEnvelope(raw, trust);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.event.eventId).toBe("3f6b1f3c-2c4b-4f3a-9a3e-6c0f9d2a0b11");
    expect(verdict.event.eventType).toBe("booking.paid");
    expect(verdict.event.subjectId).toBe("bk-9");
    expect(verdict.event.payload.amount_kobo).toBe(4500000);
    expect(verdict.event.extensions["amount-kobo"]).toBe("4500000");
    expect(verdict.event.extensions["payment-receipt-ref"]).toBe("rcpt-1");
    expect(verdict.event.ledgerCommitHash).toBe("abc123");
    expect(verdict.event.occurredAtMs).toBe(Date.parse("2026-09-01T10:00:00.000Z"));
  });

  it("rejects a tampered envelope (payload_mismatch)", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const tampered = JSON.parse(raw) as Record<string, unknown>;
    tampered.correlationId = "corr-EVIL";
    const verdict = verifyPcsEnvelope(JSON.stringify(tampered), trust);
    expect(verdict).toMatchObject({ ok: false, reason: "payload_mismatch" });
  });

  it("rejects a signature from a different key (bad_signature)", () => {
    const { privateKey, trust } = setup();
    const { privateKey: otherKey } = makeKeyPair();
    const raw = signedEnvelope(otherKey, KID); // signed by a non-trusted key under a trusted kid
    expect(privateKey).not.toBe(otherKey);
    const verdict = verifyPcsEnvelope(raw, trust);
    expect(verdict).toMatchObject({ ok: false, reason: "bad_signature" });
  });

  it("rejects an unknown kid (untrusted_kid)", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, "port-interoperability-99");
    const verdict = verifyPcsEnvelope(raw, trust);
    expect(verdict).toMatchObject({ ok: false, reason: "untrusted_kid" });
  });

  it("rejects a non-EdDSA alg header (bad_header)", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const parsed = JSON.parse(raw) as { provenance: { signature: string } };
    const parts = parsed.provenance.signature.split(".");
    const evilHeader = Buffer.from(JSON.stringify({ alg: "HS256", kid: KID }), "utf8").toString("base64url");
    parsed.provenance.signature = [evilHeader, parts[1], parts[2]].join(".");
    const verdict = verifyPcsEnvelope(JSON.stringify(parsed), trust);
    expect(verdict).toMatchObject({ ok: false, reason: "bad_header" });
  });

  it("rejects missing signature, bad versions, malformed JSON", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const noSig = JSON.parse(raw) as PcsEnvelope & Record<string, unknown>;
    noSig.provenance = { ...noSig.provenance, signature: "" };
    expect(verifyPcsEnvelope(JSON.stringify(noSig), trust)).toMatchObject({ ok: false, reason: "missing_signature" });
    const badVersion = JSON.parse(raw) as Record<string, unknown>;
    badVersion.envelopeVersion = "0.9";
    expect(verifyPcsEnvelope(JSON.stringify(badVersion), trust)).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(verifyPcsEnvelope("{oops", trust)).toMatchObject({ ok: false, reason: "malformed_json" });
  });

  it("rejects everything when no trust keys are configured (fail closed)", () => {
    const { privateKey } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const verdict = verifyPcsEnvelope(raw, new Map());
    expect(verdict).toMatchObject({ ok: false, reason: "missing_trust_keys" });
  });

  it("rejects a malformed JWS (not three segments)", () => {
    const { privateKey, trust } = setup();
    const raw = signedEnvelope(privateKey, KID);
    const parsed = JSON.parse(raw) as { provenance: { signature: string } };
    parsed.provenance.signature = "a.b";
    expect(verifyPcsEnvelope(JSON.stringify(parsed), trust)).toMatchObject({ ok: false, reason: "bad_jws_format" });
  });
});
