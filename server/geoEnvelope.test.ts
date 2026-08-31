/**
 * PRA-096 (Phase 9) — geo envelope v1.0 verifier unit tests (no broker).
 * Real Ed25519 keypairs and REAL JCS+JWS signing per test (geoTestSigner) —
 * the verifier is exercised against the genuine producer contract.
 */
import { describe, it, expect } from "vitest";
import {
  verifyGeoEnvelope,
  extractVesselPosition,
  parseGeoTrustKeys,
  isValidGeoKeyId,
  GeoTrustConfigError,
  GEO_KID_PREFIX,
} from "./_core/geoEnvelope";
import {
  microsToDegrees,
  milliknotsToKnots,
  millidegreesToDegrees,
  toVesselPositionRow,
} from "./geoVesselProjection";
import {
  generateGeoTestKeypair,
  buildSignedVesselPositionEvent,
} from "./testutils/geoTestSigner";

const kp = generateGeoTestKeypair("blueeconomy-geo-service-7");
const trustKeysRaw = `${kp.kid}=${kp.publicKeyBase64}`;

function keys(raw = trustKeysRaw) {
  return parseGeoTrustKeys(raw);
}

describe("parseGeoTrustKeys (fail-closed keyring)", () => {
  it("parses comma-separated kid=key entries (base64 and hex)", () => {
    const hex = Buffer.from(kp.publicKeyBase64, "base64").toString("hex");
    const map = parseGeoTrustKeys(` ${kp.kid}=${kp.publicKeyBase64} , blueeconomy-geo-service-8=${hex} `);
    expect(map.size).toBe(2);
    expect(map.has("blueeconomy-geo-service-8")).toBe(true);
  });

  it("rejects malformed entries, bad kids and empty keyrings", () => {
    expect(() => parseGeoTrustKeys("")).toThrow(GeoTrustConfigError);
    expect(() => parseGeoTrustKeys("no-equals-sign")).toThrow(GeoTrustConfigError);
    expect(() => parseGeoTrustKeys("wrong-prefix-1=AAAA")).toThrow(GeoTrustConfigError);
    expect(() => parseGeoTrustKeys("blueeconomy-geo-service-abc=AAAA")).toThrow(GeoTrustConfigError);
    expect(() => parseGeoTrustKeys("blueeconomy-geo-service-1=dGVzdA==")).toThrow(/32-byte/); // 4-byte key
  });

  it("enforces the kid prefix contract", () => {
    expect(isValidGeoKeyId("blueeconomy-geo-service-0")).toBe(true);
    expect(isValidGeoKeyId("blueeconomy-geo-service-20260831")).toBe(true);
    expect(isValidGeoKeyId("blueeconomy-geo-service-")).toBe(false);
    expect(isValidGeoKeyId("blueeconomy-geo-service-1a")).toBe(false);
    expect(isValidGeoKeyId(`port-interoperability-1`)).toBe(false);
    expect(GEO_KID_PREFIX).toBe("blueeconomy-geo-service-");
  });
});

describe("verifyGeoEnvelope (envelope v1.0, fail closed)", () => {
  it("accepts a genuinely signed vessel position envelope", () => {
    const raw = buildSignedVesselPositionEvent(kp, { eventId: "evt-ok-1" });
    const verdict = verifyGeoEnvelope(raw, keys());
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.envelope.eventId).toBe("evt-ok-1");
      expect(verdict.kid).toBe(kp.kid);
    }
  });

  it("rejects tampered payloads (post-signature mutation)", () => {
    const raw = buildSignedVesselPositionEvent(kp, { mmsi: "111222333" });
    const tampered = raw.replace("111222333", "999888777");
    const verdict = verifyGeoEnvelope(tampered, keys());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("payload_mismatch");
  });

  it("rejects envelopes signed by an untrusted key", () => {
    const attacker = generateGeoTestKeypair("blueeconomy-geo-service-7"); // same kid, different key
    const raw = buildSignedVesselPositionEvent(attacker, {});
    const verdict = verifyGeoEnvelope(raw, keys());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("bad_signature");
  });

  it("rejects unknown kids", () => {
    const other = generateGeoTestKeypair("blueeconomy-geo-service-99");
    const raw = buildSignedVesselPositionEvent(other, {});
    const verdict = verifyGeoEnvelope(raw, keys());
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe("untrusted_kid");
  });

  it("rejects wrong producer / version / event type / malformed JSON", () => {
    const badProducer = buildSignedVesselPositionEvent(kp, { producer: "evil-producer" });
    // Producer is part of the signed payload, so this fails at the producer check.
    expect(verifyGeoEnvelope(badProducer, keys())).toMatchObject({ ok: false, reason: "untrusted_producer" });

    const badType = buildSignedVesselPositionEvent(kp, { eventType: "geo.vessel-position.v2" });
    expect(verifyGeoEnvelope(badType, keys())).toMatchObject({ ok: false, reason: "unsupported_event_type" });

    expect(verifyGeoEnvelope("not json", keys())).toMatchObject({ ok: false, reason: "malformed_json" });
    expect(verifyGeoEnvelope(JSON.stringify({ envelopeVersion: "2.0" }), keys()))
      .toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(verifyGeoEnvelope(JSON.stringify({ envelopeVersion: "1.0", producer: "blueeconomy-geo-service", eventType: "geo.sos.v1" }), keys()))
      .toMatchObject({ ok: false, reason: "payload_shape" });
  });

  it("rejects when no trust keys are configured", () => {
    const raw = buildSignedVesselPositionEvent(kp, {});
    expect(verifyGeoEnvelope(raw, new Map())).toMatchObject({ ok: false, reason: "missing_trust_keys" });
  });

  it("rejects non-JWS and non-EdDSA signatures", () => {
    const raw = buildSignedVesselPositionEvent(kp, {});
    const env = JSON.parse(raw);
    env.provenance.signature = "not-a-jws";
    expect(verifyGeoEnvelope(JSON.stringify(env), keys())).toMatchObject({ ok: false, reason: "bad_jws_format" });

    const parts = JSON.parse(raw).provenance.signature.split(".");
    env.provenance.signature = [
      Buffer.from(JSON.stringify({ alg: "HS256", kid: kp.kid })).toString("base64url"),
      parts[1], parts[2],
    ].join(".");
    expect(verifyGeoEnvelope(JSON.stringify(env), keys())).toMatchObject({ ok: false, reason: "bad_header" });
  });
});

describe("extractVesselPosition + read-model mapping", () => {
  it("extracts the payload and converts contract units", () => {
    const raw = buildSignedVesselPositionEvent(kp, {
      eventId: "evt-units",
      mmsi: "657123456",
      shipName: "MV LAGOS TRADER",
      imo: "9074729",
      latitudeMicros: 6_453_000,
      longitudeMicros: 3_402_000,
      speedOverGroundMilliknots: 12_400,
      courseOverGroundMillidegrees: 187_500,
      headingMillidegrees: 190_000,
      observedAt: "2026-08-31T10:15:30.000Z",
      positionReportId: "pr-1",
    });
    const verdict = verifyGeoEnvelope(raw, keys());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const extracted = extractVesselPosition(verdict.envelope);
    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;

    const row = toVesselPositionRow(verdict.envelope, extracted.payload, verdict.kid);
    expect(row.mmsi).toBe("657123456");
    expect(row.vesselName).toBe("MV LAGOS TRADER");
    expect(row.imoNumber).toBe("9074729");
    expect(row.latitude).toBeCloseTo(6.453, 6);
    expect(row.longitude).toBeCloseTo(3.402, 6);
    expect(row.speed).toBeCloseTo(12.4, 3);
    expect(row.heading).toBeCloseTo(190, 3); // heading preferred over course
    expect(row.recordedAt.toISOString()).toBe("2026-08-31T10:15:30.000Z");
    expect(row.sourceEventId).toBe("evt-units");
    expect(row.positionReportId).toBe("pr-1");
    expect(row.sourceKid).toBe(kp.kid);

    expect(microsToDegrees(-90_000_000)).toBe(-90);
    expect(milliknotsToKnots(1_000)).toBe(1);
    expect(millidegreesToDegrees(359_999)).toBeCloseTo(359.999, 3);
  });

  it("falls back to course-over-ground when heading is absent", () => {
    const raw = buildSignedVesselPositionEvent(kp, { courseOverGroundMillidegrees: 90_000 });
    const verdict = verifyGeoEnvelope(raw, keys());
    if (!verdict.ok) throw new Error("verdict not ok");
    const extracted = extractVesselPosition(verdict.envelope);
    if (!extracted.ok) throw new Error("extract not ok");
    const row = toVesselPositionRow(verdict.envelope, extracted.payload, verdict.kid);
    expect(row.heading).toBeCloseTo(90, 3);
    expect(row.vesselName).toBeNull();
    expect(row.imoNumber).toBeNull();
  });

  it("rejects non-position event types at the extraction boundary", () => {
    const raw = buildSignedVesselPositionEvent(kp, { eventType: "geo.sos.v1" });
    const verdict = verifyGeoEnvelope(raw, keys());
    expect(verdict.ok).toBe(true); // envelope itself is contract-valid
    if (!verdict.ok) return;
    expect(extractVesselPosition(verdict.envelope)).toMatchObject({ ok: false, reason: "unsupported_event_type" });
  });

  it("rejects structurally deviating payloads (unknown fields, bad ranges)", () => {
    const raw = buildSignedVesselPositionEvent(kp, {});
    const env = JSON.parse(raw);
    const resource = env.fhir.entry[0].resource;

    resource.unexpectedField = 1;
    // Re-sign is not possible here (payload changed) — extraction is a pure
    // structural check over an already-verified envelope, so call it directly.
    expect(extractVesselPosition(env)).toMatchObject({ ok: false, reason: "payload_shape" });
    delete resource.unexpectedField;

    resource.latitudeMicros = 91_000_000;
    expect(extractVesselPosition(env)).toMatchObject({ ok: false, reason: "payload_shape" });
    resource.latitudeMicros = 6_453_000;

    delete resource["@type"];
    expect(extractVesselPosition(env)).toMatchObject({ ok: false, reason: "payload_shape" });
  });
});
