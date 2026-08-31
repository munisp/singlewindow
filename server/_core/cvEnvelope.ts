/**
 * cvEnvelope.ts — Fail-closed verification of blueeconomy platform event
 * envelopes (envelope v1.0): JWS compact (EdDSA/Ed25519) over the RFC 8785
 * JCS canonicalization of the full envelope excluding `provenance.signature`.
 *
 * Consumers load the producer public-key directory ({kid: base64url-pubkey})
 * from KEY_DIRECTORY_PATH and fail closed when it is absent, malformed or
 * empty. Rejection reason codes follow docs/envelope-signature.md §4.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

export class EnvelopeRejection extends Error {
  readonly reason: string;
  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "EnvelopeRejection";
    this.reason = reason;
  }
}

// ── RFC 8785 JCS canonicalization ────────────────────────────────────────────

export function jcsCanonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    // JSON.stringify emits the minimal escapes JCS requires (non-ASCII raw).
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(jcsCanonicalize).join(",") + "]";
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) // UTF-16 code-unit order
      .map(([k, v]) => `${JSON.stringify(k)}:${jcsCanonicalize(v)}`);
    return "{" + entries.join(",") + "}";
  }
  throw new EnvelopeRejection("malformed-jws", "uncanonicalizable value");
}

// ── base64url ────────────────────────────────────────────────────────────────

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

function b64urlDecode(segment: string): Buffer {
  if (!segment || !B64URL_RE.test(segment)) {
    throw new EnvelopeRejection("malformed-jws", "not base64url (no padding permitted)");
  }
  return Buffer.from(segment, "base64url");
}

// ── Key directory ────────────────────────────────────────────────────────────

const KID_RE = /^[A-Za-z0-9._-]{1,256}$/;
// Ed25519 SPKI DER prefix (RFC 8410): 302a300506032b6570032100 || raw pubkey
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type KeyDirectory = Map<string, KeyObject>;

export function parseKeyDirectory(raw: string): KeyDirectory {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new EnvelopeRejection("key-directory", "not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
    throw new EnvelopeRejection("key-directory", "not a non-empty JSON object");
  }
  const directory: KeyDirectory = new Map();
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID_RE.test(kid) || typeof value !== "string") {
      throw new EnvelopeRejection("key-directory", `malformed entry for ${kid}`);
    }
    const keyBytes = b64urlDecode(value);
    if (keyBytes.length !== 32) {
      throw new EnvelopeRejection("key-directory", `malformed key for ${kid}`);
    }
    directory.set(
      kid,
      createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, keyBytes]), format: "der", type: "spki" })
    );
  }
  return directory;
}

export function loadKeyDirectoryFromEnv(env: NodeJS.ProcessEnv = process.env): KeyDirectory {
  const path = env.KEY_DIRECTORY_PATH?.trim();
  if (!path) {
    throw new EnvelopeRejection(
      "key-directory",
      "KEY_DIRECTORY_PATH is required; provenance verification is mandatory"
    );
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new EnvelopeRejection("key-directory", "absent or unreadable");
  }
  return parseKeyDirectory(raw);
}

// ── Envelope verification ────────────────────────────────────────────────────

export interface VerifiedEnvelope {
  envelopeVersion: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  classification: string;
  resource: Record<string, unknown>;
  kid: string;
}

/**
 * Verify one raw envelope document fail-closed. Returns the verified view or
 * throws EnvelopeRejection with the spec reason code. Rejection is terminal.
 */
export function verifyEnvelope(raw: string | Buffer, directory: KeyDirectory): VerifiedEnvelope {
  let envelope: any;
  try {
    envelope = JSON.parse(raw.toString());
  } catch {
    throw new EnvelopeRejection("malformed-jws", "envelope is not JSON");
  }
  const signature = envelope?.provenance?.signature;
  if (typeof signature !== "string") {
    throw new EnvelopeRejection("malformed-jws", "provenance.signature missing");
  }
  const segments = signature.split(".");
  if (segments.length !== 3 || segments.some((s) => !s)) {
    throw new EnvelopeRejection("malformed-jws", "expected three non-empty segments");
  }
  const [segHeader, segPayload, segSignature] = segments;
  let header: any;
  try {
    header = JSON.parse(b64urlDecode(segHeader).toString("utf8"));
  } catch (err) {
    if (err instanceof EnvelopeRejection) throw err;
    throw new EnvelopeRejection("malformed-jws", "undecodable protected header");
  }
  if (header.alg !== "EdDSA") {
    throw new EnvelopeRejection("unsupported-alg", `alg=${header.alg}`);
  }
  const kid = header.kid;
  if (typeof kid !== "string" || !KID_RE.test(kid)) {
    throw new EnvelopeRejection("malformed-jws", "malformed kid");
  }
  const publicKey = directory.get(kid);
  if (!publicKey) {
    throw new EnvelopeRejection("unknown-kid", kid);
  }
  // Re-derive the signed payload; never trust the transmitted segment.
  const provenance = { ...envelope.provenance };
  delete provenance.signature;
  const payload = Buffer.from(jcsCanonicalize({ ...envelope, provenance }), "utf8");
  if (!payload.equals(b64urlDecode(segPayload))) {
    throw new EnvelopeRejection("payload-mismatch");
  }
  const signingInput = Buffer.from(`${segHeader}.${segPayload}`, "ascii");
  if (!cryptoVerify(null, signingInput, publicKey, b64urlDecode(segSignature))) {
    throw new EnvelopeRejection("invalid-signature");
  }
  const entry = envelope?.fhir?.entry;
  if (!Array.isArray(entry) || entry.length !== 1 || typeof entry[0]?.resource !== "object") {
    throw new EnvelopeRejection("malformed-jws", "envelope fhir.entry must contain exactly one resource");
  }
  return {
    envelopeVersion: envelope.envelopeVersion,
    eventId: envelope.eventId,
    eventType: envelope.eventType,
    occurredAt: envelope.occurredAt,
    producer: envelope.producer,
    classification: envelope.classification,
    resource: entry[0].resource,
    kid,
  };
}
