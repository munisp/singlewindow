/**
 * geoEnvelope.ts — envelope v1.0 provenance verification for geo.*.v1 events
 * consumed from the vessels.events Kafka topic (PRA-096, Phase 9).
 *
 * Mirrors the fleet contract implemented in blueeconomy-geo-service
 * (internal/sign) and the Go reference consumer
 * (microservices/cargo-tracking-service/internal/envelope/verify.go, read
 * directly):
 *   - provenance.signature is a JWS compact serialization (EdDSA/Ed25519)
 *     over the JCS-canonicalized (RFC 8785) envelope with the
 *     provenance.signature field excluded;
 *   - the protected header is {"alg":"EdDSA","kid":"blueeconomy-geo-service-<epoch>"};
 *   - producer must be "blueeconomy-geo-service" and eventType one of the
 *     contract-governed geo.*.v1 types.
 *
 * Fail closed: ANY deviation (bad version, wrong producer, disallowed event
 * type, malformed JWS, wrong alg, kid not matching blueeconomy-geo-service-<epoch>,
 * untrusted kid, canonical-payload mismatch, invalid signature, no configured
 * trust keys) rejects the event — the projection NEVER writes an unverified
 * row; rejected messages are routed to the DLQ.
 *
 * Trust keys are env-only (GEO_ENVELOPE_TRUST_KEYS: comma-separated
 * "kid=base64-or-hex-public-key" entries — the same format the Go
 * cargo-tracking-service accepts).
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { canonicalizeJcs } from "./pcsEnvelope";

export const GEO_ENVELOPE_VERSION = "1.0";
export const GEO_PRODUCER = "blueeconomy-geo-service";
export const GEO_KID_PREFIX = "blueeconomy-geo-service-";
export const GEO_EVENT_VESSEL_POSITION = "geo.vessel-position.v1";

/** Contract-governed fail-closed event set (mirrors the Go consumer). */
export const GEO_ALLOWED_EVENT_TYPES: ReadonlySet<string> = new Set([
  "geo.vessel-position.v1",
  "geo.vessel-static.v1",
  "geo.geofence-event.v1",
  "geo.app-position-report.v1",
  "geo.sos.v1",
  "geo.sos-acknowledged.v1",
  "geo.sos-resolved.v1",
]);

export const GEO_VESSEL_TOPIC = "vessels.events";
export const GEO_VESSEL_DLQ_TOPIC = "vessels.events.dlq";

// ─── Envelope types ──────────────────────────────────────────────────────────

export interface GeoEnvelope {
  envelopeVersion: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  classification: string;
  fhir: unknown;
  provenance: {
    principalId: string;
    principalRole: string;
    signature: string;
    ledgerCommitHash?: string;
  };
}

/** geo.vessel-position.v1 primary-resource payload (contract field names). */
export interface VesselPositionPayload {
  positionReportId: string;
  mmsi: string;
  sourceClass: string;
  latitudeMicros: number;
  longitudeMicros: number;
  speedOverGroundMilliknots: number;
  courseOverGroundMillidegrees: number;
  headingMillidegrees?: number;
  navStatus?: number;
  positionAccuracy: string;
  observedAt: string;
  receiverId: string;
  aisMessageType?: number;
  classification: string;
  imo?: string;
  callsign?: string;
  shipName?: string;
}

export type GeoRejectReason =
  | "malformed_json"
  | "unsupported_version"
  | "untrusted_producer"
  | "unsupported_event_type"
  | "payload_shape"
  | "missing_signature"
  | "bad_jws_format"
  | "bad_header"
  | "untrusted_kid"
  | "payload_mismatch"
  | "bad_signature"
  | "missing_trust_keys";

/** Shared fail-closed rejection shape for verify and extract results. */
export type GeoReject = { ok: false; reason: GeoRejectReason; detail: string };

export type GeoVerifyResult =
  | { ok: true; envelope: GeoEnvelope; kid: string }
  | GeoReject;

// ─── Trust keys (env-only) ───────────────────────────────────────────────────

export class GeoTrustConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeoTrustConfigError";
  }
}

function decodePublicKey(encoded: string): Buffer | null {
  const trimmed = encoded.trim();
  if (!trimmed) return null;
  const candidates: Buffer[] = [];
  for (const encoding of ["base64url", "base64"] as const) {
    try {
      candidates.push(Buffer.from(trimmed, encoding));
    } catch { /* try next */ }
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex"));
  }
  return candidates.find((raw) => raw.length === 32) ?? null;
}

/** kid contract: blueeconomy-geo-service-<decimal epoch>. */
export function isValidGeoKeyId(kid: string): boolean {
  if (!kid.startsWith(GEO_KID_PREFIX)) return false;
  const epoch = kid.slice(GEO_KID_PREFIX.length);
  return /^\d+$/.test(epoch);
}

/**
 * Parses GEO_ENVELOPE_TRUST_KEYS (comma-separated kid=base64|hex entries)
 * into a kid → KeyObject map. Throws GeoTrustConfigError on any malformed
 * entry — a half-trusted keyring must never start.
 */
export function parseGeoTrustKeys(raw: string): Map<string, KeyObject> {
  const trimmed = raw.trim();
  if (!trimmed) throw new GeoTrustConfigError("GEO_ENVELOPE_TRUST_KEYS is empty — no producer is trusted");
  const map = new Map<string, KeyObject>();
  for (const entry of trimmed.split(",")) {
    const part = entry.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) {
      throw new GeoTrustConfigError(`malformed trust-key entry '${part}' (want kid=base64-or-hex-key)`);
    }
    const kid = part.slice(0, eq).trim();
    const encoded = part.slice(eq + 1).trim();
    if (!isValidGeoKeyId(kid)) {
      throw new GeoTrustConfigError(`trust key kid '${kid}' is not a blueeconomy-geo-service-<epoch> key id`);
    }
    const rawKey = decodePublicKey(encoded);
    if (!rawKey) {
      throw new GeoTrustConfigError(`trust key '${kid}' is not a 32-byte Ed25519 public key (base64/hex)`);
    }
    map.set(
      kid,
      createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: rawKey.toString("base64url") }, format: "jwk" })
    );
  }
  if (map.size === 0) throw new GeoTrustConfigError("GEO_ENVELOPE_TRUST_KEYS names no keys");
  return map;
}

// ─── Verification ────────────────────────────────────────────────────────────

function reject(reason: GeoRejectReason, detail: string): GeoReject {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Verifies a raw Kafka message value against the geo envelope contract.
 * Pure function; never throws for untrusted input — returns a classified
 * rejection instead (callers count geo_vessel_signature_rejects_total).
 */
export function verifyGeoEnvelope(raw: string | Buffer, trustKeys: Map<string, KeyObject>): GeoVerifyResult {
  if (trustKeys.size === 0) {
    return reject("missing_trust_keys", "no trusted envelope signing keys are configured");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return reject("malformed_json", "message is not valid JSON");
  }
  if (!isRecord(parsed)) return reject("malformed_json", "message is not a JSON object");
  if (parsed.envelopeVersion !== GEO_ENVELOPE_VERSION) {
    return reject("unsupported_version", `envelopeVersion ${String(parsed.envelopeVersion)} is not ${GEO_ENVELOPE_VERSION}`);
  }
  if (parsed.producer !== GEO_PRODUCER) {
    return reject("untrusted_producer", `producer ${String(parsed.producer)} is not ${GEO_PRODUCER}`);
  }
  if (typeof parsed.eventType !== "string" || !GEO_ALLOWED_EVENT_TYPES.has(parsed.eventType)) {
    return reject("unsupported_event_type", `eventType ${String(parsed.eventType)} is not a geo v1 contract type`);
  }
  if (
    typeof parsed.eventId !== "string" || !parsed.eventId ||
    typeof parsed.correlationId !== "string" || !parsed.correlationId ||
    typeof parsed.occurredAt !== "string" || !parsed.occurredAt
  ) {
    return reject("payload_shape", "envelope is missing eventId/correlationId/occurredAt");
  }
  if (!Number.isFinite(Date.parse(parsed.occurredAt))) {
    return reject("payload_shape", `occurredAt '${parsed.occurredAt}' is not a valid timestamp`);
  }
  const provenance = parsed.provenance;
  if (!isRecord(provenance) || typeof provenance.signature !== "string" || !provenance.signature) {
    return reject("missing_signature", "envelope provenance.signature is missing");
  }

  const parts = provenance.signature.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    return reject("bad_jws_format", "provenance signature is not a JWS compact serialization");
  }
  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return reject("bad_header", "JWS protected header is not base64url JSON");
  }
  if (!isRecord(header) || header.alg !== "EdDSA") {
    return reject("bad_header", `JWS alg ${isRecord(header) ? String(header.alg) : "?"} is not EdDSA`);
  }
  const kid = header.kid;
  if (typeof kid !== "string" || !isValidGeoKeyId(kid)) {
    return reject("bad_header", `JWS kid ${String(kid)} is not a blueeconomy-geo-service-<epoch> key id`);
  }
  const publicKey = trustKeys.get(kid);
  if (!publicKey) {
    return reject("untrusted_kid", `JWS kid '${kid}' is not in the configured trust set`);
  }

  // Canonical payload: full envelope with provenance.signature excluded,
  // JCS-canonicalized; must re-encode to the exact signed payload segment.
  const stripped: Record<string, unknown> = { ...parsed, provenance: { ...provenance } };
  delete (stripped.provenance as Record<string, unknown>).signature;
  let canonical: string;
  try {
    canonical = canonicalizeJcs(stripped);
  } catch (err) {
    return reject("payload_shape", `envelope cannot be JCS-canonicalized: ${err instanceof Error ? err.message : err}`);
  }
  if (Buffer.from(canonical, "utf8").toString("base64url") !== parts[1]) {
    return reject("payload_mismatch", "envelope does not match the signed canonical payload");
  }
  let signature: Buffer;
  try {
    signature = Buffer.from(parts[2], "base64url");
  } catch {
    return reject("bad_jws_format", "JWS signature is not base64url");
  }
  if (!cryptoVerify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), publicKey, signature)) {
    return reject("bad_signature", "JWS signature verification failed");
  }

  return { ok: true, envelope: parsed as unknown as GeoEnvelope, kid };
}

// ─── Vessel position extraction ──────────────────────────────────────────────

const VESSEL_POSITION_TYPE_URL = "type.googleapis.com/blueeconomy.contracts.v1.VesselPositionReported";

/** Strict contract field set (unknown fields reject, mirroring DisallowUnknownFields). */
const VESSEL_POSITION_KEYS: ReadonlySet<string> = new Set([
  "positionReportId", "mmsi", "sourceClass", "latitudeMicros", "longitudeMicros",
  "speedOverGroundMilliknots", "courseOverGroundMillidegrees", "headingMillidegrees",
  "navStatus", "positionAccuracy", "observedAt", "receiverId", "aisMessageType",
  "classification", "imo", "callsign", "shipName",
]);

export type GeoExtractResult =
  | { ok: true; payload: VesselPositionPayload }
  | GeoReject;

function isUint(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Unwraps a verified envelope's FHIR message bundle primary resource as a
 * geo.vessel-position.v1 payload. Fail-closed: any structural deviation
 * (wrong bundle shape, missing @type discriminator, unknown or mistyped
 * fields, missing required fields) rejects the event.
 */
export function extractVesselPosition(envelope: GeoEnvelope): GeoExtractResult {
  if (envelope.eventType !== GEO_EVENT_VESSEL_POSITION) {
    return reject("unsupported_event_type", `eventType ${envelope.eventType} is not ${GEO_EVENT_VESSEL_POSITION}`);
  }
  const fhir = envelope.fhir;
  if (!isRecord(fhir) || fhir.resourceType !== "Bundle" || fhir.type !== "message" || !Array.isArray(fhir.entry) || fhir.entry.length !== 1) {
    return reject("payload_shape", "FHIR payload is not a single-entry message Bundle");
  }
  const entry = fhir.entry[0];
  if (!isRecord(entry) || !isRecord(entry.resource)) {
    return reject("payload_shape", "FHIR entry is missing its resource");
  }
  const resource = entry.resource as Record<string, unknown>;
  if (resource["@type"] !== VESSEL_POSITION_TYPE_URL) {
    return reject("payload_shape", `position resource @type ${String(resource["@type"])} is not VesselPositionReported`);
  }
  for (const key of Object.keys(resource)) {
    if (key !== "@type" && !VESSEL_POSITION_KEYS.has(key)) {
      return reject("payload_shape", `position payload carries unknown field '${key}'`);
    }
  }
  const p = resource as Record<string, unknown>;
  if (typeof p.positionReportId !== "string" || !p.positionReportId ||
      typeof p.mmsi !== "string" || !p.mmsi ||
      typeof p.receiverId !== "string" || !p.receiverId ||
      typeof p.sourceClass !== "string" || !p.sourceClass ||
      typeof p.positionAccuracy !== "string" || !p.positionAccuracy ||
      typeof p.classification !== "string" || !p.classification ||
      typeof p.observedAt !== "string" || !Number.isFinite(Date.parse(p.observedAt))) {
    return reject("payload_shape", "position payload is missing required string/timestamp fields");
  }
  if (!Number.isInteger(p.latitudeMicros) || (p.latitudeMicros as number) < -90_000_000 || (p.latitudeMicros as number) > 90_000_000) {
    return reject("payload_shape", "latitudeMicros is not an integer micro-degrees value in [-90, 90]");
  }
  if (!Number.isInteger(p.longitudeMicros) || (p.longitudeMicros as number) < -180_000_000 || (p.longitudeMicros as number) > 180_000_000) {
    return reject("payload_shape", "longitudeMicros is not an integer micro-degrees value in [-180, 180]");
  }
  if (!isUint(p.speedOverGroundMilliknots) || !isUint(p.courseOverGroundMillidegrees)) {
    return reject("payload_shape", "speed/course are not unsigned integer milli-units");
  }
  if (p.headingMillidegrees !== undefined && !isUint(p.headingMillidegrees)) {
    return reject("payload_shape", "headingMillidegrees is not an unsigned integer");
  }
  if (p.navStatus !== undefined && !Number.isInteger(p.navStatus)) {
    return reject("payload_shape", "navStatus is not an integer");
  }
  if (p.aisMessageType !== undefined && !isUint(p.aisMessageType)) {
    return reject("payload_shape", "aisMessageType is not an unsigned integer");
  }
  for (const opt of ["imo", "callsign", "shipName"] as const) {
    if (p[opt] !== undefined && typeof p[opt] !== "string") {
      return reject("payload_shape", `${opt} is not a string`);
    }
  }
  const { "@type": _discarded, ...payload } = p;
  return { ok: true, payload: payload as unknown as VesselPositionPayload };
}
