/**
 * pcsEnvelope.ts — envelope v1.0 provenance verification for ports.*.v1
 * Kafka events consumed by the PCS projection (Phase 8; spec §5.6/§5.7).
 *
 * Mirrors the fleet signing scheme implemented in
 * blueeconomy-port-interoperability internal/events/signing.go (read directly):
 *   - provenance.signature is a JWS compact serialization (EdDSA/Ed25519)
 *     over the JCS-canonicalized (RFC 8785) JSON of the full envelope with
 *     the signature field excluded;
 *   - the protected header is {"alg":"EdDSA","kid":"port-interoperability-<epoch>"};
 *   - verification requires alg=EdDSA, a trusted port-interoperability kid,
 *     an exact canonical-payload match and a valid Ed25519 signature.
 *
 * Fail closed: ANY deviation (bad version, bad header, unknown kid, payload
 * mismatch, invalid signature, no configured trust keys) rejects the event —
 * the projection NEVER writes an unverified row (spec §5.6).
 *
 * Trust keys are env-only (PCS_ENVELOPE_TRUST_KEYS: JSON object mapping the
 * JWS kid to the base64/hex-encoded 32-byte Ed25519 public key).
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

export const PCS_ENVELOPE_VERSION = "1.0";
export const PCS_ENVELOPE_PRODUCER = "s1-port-interoperability";
export const PCS_KID_PREFIX = "port-interoperability-";

export const PCS_TOPICS = ["ports.booking.v1", "ports.gate.v1", "ports.queue.v1"] as const;
export type PcsTopic = (typeof PCS_TOPICS)[number];

// ─── RFC 8785 JCS canonicalization ──────────────────────────────────────────
// Key ordering by UTF-16 code units (ECMAScript Array.prototype.sort default),
// number serialization per ECMAScript Number::toString (what JSON.stringify
// emits for finite numbers), string escaping per JSON.stringify (shortest
// escapes + \u00xx lowercase control characters), no insignificant whitespace.

class JcsError extends Error {}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new JcsError("non-finite numbers cannot be JCS-canonicalized");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    // Reject lone surrogates: RFC 8785 requires valid Unicode scalar values.
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdfff) {
        const next = value.charCodeAt(i + 1);
        const pair = code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
        if (!pair) throw new JcsError("lone surrogate in string cannot be JCS-canonicalized");
        i++;
      }
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => `${canonicalize(key)}:${canonicalize(record[key])}`);
    return `{${parts.join(",")}}`;
  }
  throw new JcsError(`unsupported value type in JCS canonicalization: ${typeof value}`);
}

/** Serializes a parsed JSON value to its RFC 8785 canonical form. */
export function canonicalizeJcs(value: unknown): string {
  return canonicalize(value);
}

// ─── Envelope types ──────────────────────────────────────────────────────────

export interface PcsEnvelope {
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

/** A verified, fully-typed projection input. */
export interface PcsEvent {
  envelope: PcsEnvelope;
  eventId: string;
  eventType: string;
  occurredAtMs: number;
  correlationId: string;
  /** Aggregate subject (booking id / gate-scan subject) from the FHIR Basic resource id. */
  subjectId: string;
  /** Domain payload JSON from the FHIR domain-payload extension. */
  payload: Record<string, unknown>;
  /** Flat scalar extensions (slot, terminal, amounts) from the FHIR entry. */
  extensions: Record<string, string>;
  ledgerCommitHash: string | null;
}

export type PcsRejectReason =
  | "malformed_json"
  | "unsupported_version"
  | "missing_signature"
  | "bad_jws_format"
  | "bad_header"
  | "untrusted_kid"
  | "payload_mismatch"
  | "bad_signature"
  | "payload_shape"
  | "missing_trust_keys";

export type PcsVerifyResult =
  | { ok: true; event: PcsEvent }
  | { ok: false; reason: PcsRejectReason; detail: string };

// ─── Trust keys (env-only) ───────────────────────────────────────────────────

export class PcsTrustConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PcsTrustConfigError";
  }
}

function decodePublicKey(encoded: string): Buffer | null {
  const trimmed = encoded.trim();
  if (!trimmed) return null;
  const candidates: Buffer[] = [];
  try {
    candidates.push(Buffer.from(trimmed, "base64url"));
  } catch { /* try next */ }
  try {
    candidates.push(Buffer.from(trimmed, "base64"));
  } catch { /* try next */ }
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex"));
  }
  return candidates.find((raw) => raw.length === 32) ?? null;
}

/**
 * Parses PCS_ENVELOPE_TRUST_KEYS (JSON object: kid → base64/hex Ed25519
 * public key) into a kid → KeyObject map. Throws PcsTrustConfigError on any
 * malformed entry — a half-trusted keyring must never start.
 */
export function parseTrustKeys(raw: string): Map<string, KeyObject> {
  const trimmed = raw.trim();
  if (!trimmed) throw new PcsTrustConfigError("PCS_ENVELOPE_TRUST_KEYS is empty — no producer is trusted");
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new PcsTrustConfigError("PCS_ENVELOPE_TRUST_KEYS is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PcsTrustConfigError("PCS_ENVELOPE_TRUST_KEYS must be a JSON object of kid → public key");
  }
  const map = new Map<string, KeyObject>();
  for (const [kid, encoded] of Object.entries(parsed as Record<string, unknown>)) {
    if (!kid.startsWith(PCS_KID_PREFIX) || !/^\d+$/.test(kid.slice(PCS_KID_PREFIX.length))) {
      throw new PcsTrustConfigError(`trust key kid '${kid}' is not a port-interoperability-<epoch> key id`);
    }
    if (typeof encoded !== "string") {
      throw new PcsTrustConfigError(`trust key '${kid}' is not a string`);
    }
    const rawKey = decodePublicKey(encoded);
    if (!rawKey) {
      throw new PcsTrustConfigError(`trust key '${kid}' is not a 32-byte Ed25519 public key (base64/hex)`);
    }
    map.set(
      kid,
      createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: rawKey.toString("base64url") }, format: "jwk" })
    );
  }
  if (map.size === 0) throw new PcsTrustConfigError("PCS_ENVELOPE_TRUST_KEYS names no keys");
  return map;
}

// ─── Verification ────────────────────────────────────────────────────────────

function reject(reason: PcsRejectReason, detail: string): PcsVerifyResult {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Verifies and parses a raw Kafka message value into a projection-ready
 * PcsEvent. Pure function; never throws for untrusted input — returns a
 * classified rejection instead (callers count pcs_signature_rejects_total).
 */
export function verifyPcsEnvelope(raw: string | Buffer, trustKeys: Map<string, KeyObject>): PcsVerifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return reject("malformed_json", "message is not valid JSON");
  }
  if (!isRecord(parsed)) return reject("malformed_json", "message is not a JSON object");
  if (parsed.envelopeVersion !== PCS_ENVELOPE_VERSION) {
    return reject("unsupported_version", `envelopeVersion ${String(parsed.envelopeVersion)} is not ${PCS_ENVELOPE_VERSION}`);
  }
  const provenance = parsed.provenance;
  if (!isRecord(provenance) || typeof provenance.signature !== "string" || !provenance.signature) {
    return reject("missing_signature", "envelope provenance.signature is missing");
  }
  if (trustKeys.size === 0) {
    return reject("missing_trust_keys", "no trusted envelope signing keys are configured");
  }
  if (
    typeof parsed.eventId !== "string" || !parsed.eventId ||
    typeof parsed.eventType !== "string" || !parsed.eventType ||
    typeof parsed.occurredAt !== "string" || !parsed.occurredAt ||
    typeof parsed.correlationId !== "string" || !parsed.correlationId
  ) {
    return reject("payload_shape", "envelope is missing eventId/eventType/occurredAt/correlationId");
  }
  const occurredAtMs = Date.parse(parsed.occurredAt);
  if (!Number.isFinite(occurredAtMs)) {
    return reject("payload_shape", `occurredAt '${parsed.occurredAt}' is not a valid timestamp`);
  }

  const parts = provenance.signature.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) {
    return reject("bad_jws_format", "provenance signature is not a JWS compact serialization");
  }
  let headerJson: string;
  try {
    headerJson = Buffer.from(parts[0], "base64url").toString("utf8");
  } catch {
    return reject("bad_jws_format", "JWS protected header is not base64url");
  }
  let header: unknown;
  try {
    header = JSON.parse(headerJson);
  } catch {
    return reject("bad_header", "JWS protected header is not JSON");
  }
  if (!isRecord(header) || header.alg !== "EdDSA") {
    return reject("bad_header", `JWS alg ${isRecord(header) ? String(header.alg) : "?"} is not EdDSA`);
  }
  const kid = header.kid;
  if (typeof kid !== "string" || !kid.startsWith(PCS_KID_PREFIX)) {
    return reject("bad_header", `JWS kid ${String(kid)} is not a port-interoperability key`);
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

  // Domain payload: FHIR R4 message Bundle → first entry Basic resource →
  // domain-payload extension (valueString JSON); resource.id is the subject.
  const fhir = parsed.fhir;
  if (!isRecord(fhir) || fhir.resourceType !== "Bundle" || !Array.isArray(fhir.entry) || fhir.entry.length === 0) {
    return reject("payload_shape", "fhir message bundle is missing entries");
  }
  const resource = (fhir.entry as unknown[])[0];
  if (!isRecord(resource) || !isRecord(resource.resource)) {
    return reject("payload_shape", "fhir entry is missing its resource");
  }
  const basic = resource.resource;
  if (typeof basic.id !== "string" || !basic.id) {
    return reject("payload_shape", "fhir Basic resource id (aggregate subject) is missing");
  }
  let payload: Record<string, unknown> = {};
  const extensions: Record<string, string> = {};
  if (Array.isArray(basic.extension)) {
    for (const ext of basic.extension as unknown[]) {
      if (!isRecord(ext) || typeof ext.url !== "string") continue;
      const name = ext.url.split("/").pop() ?? "";
      if (ext.url.endsWith("/domain-payload") && typeof ext.valueString === "string") {
        try {
          const parsedPayload: unknown = JSON.parse(ext.valueString);
          if (isRecord(parsedPayload)) payload = parsedPayload;
        } catch {
          return reject("payload_shape", "domain-payload extension is not valid JSON");
        }
      } else if (typeof ext.valueString === "string" && name) {
        extensions[name] = ext.valueString;
      }
    }
  }

  const envelope = parsed as unknown as PcsEnvelope;
  return {
    ok: true,
    event: {
      envelope,
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      occurredAtMs,
      correlationId: parsed.correlationId,
      subjectId: basic.id,
      payload,
      extensions,
      ledgerCommitHash:
        typeof provenance.ledgerCommitHash === "string" && provenance.ledgerCommitHash
          ? provenance.ledgerCommitHash
          : null,
    },
  };
}
