/**
 * mswEnvelope.ts — envelope v1.0 producer-side signing AND consumer-side
 * verification for maritime.msw.v1 events (Phase 9 WP-C).
 *
 * Contract (blueeconomy-contracts commit eb6b1ae, NORMATIVE):
 *   proto/blueeconomy/msw/v1/msw.proto, docs/msw.md,
 *   docs/envelope-signature.md, fixtures/msw/*.json.
 *
 *   - Every event is the primary resource of a FHIR R4 message Bundle carried
 *     in an EventEnvelope: envelopeVersion "1.0", eventId, eventType,
 *     occurredAt, producer "blueeconomy-singlewindow-msw", correlationId,
 *     classification, fhir, provenance{principalId, principalRole,
 *     ledgerCommitHash, signature}.
 *   - provenance.signature is a JWS compact serialization (EdDSA/Ed25519)
 *     over the JCS-canonicalized (RFC 8785) envelope with provenance.signature
 *     excluded; the protected header is exactly
 *     {"alg":"EdDSA","kid":"blueeconomy-singlewindow-msw-<epoch>"}.
 *   - Enum wire forms carry NO MSW_FORM_TYPE_/MSW_AGENCY_ prefixes
 *     ("FAL1", "PORT_HEALTH"); consumers fail closed on any other value.
 *   - Classification floors (docs/msw.md §Classification floors): personal-
 *     data forms (FAL4/FAL5/FAL6/MDOH — NDPA PERSONAL) and pratique decisions
 *     floor at RESTRICTED (recordClassification set); boarding and clearance
 *     events floor at CONFIDENTIAL. Floors are minima — never widened.
 *
 * FAIL CLOSED:
 *   - Signing requires MSW_ENVELOPE_SIGNING_KEY (Ed25519 private key,
 *     base64/hex 32-byte seed or PKCS#8 PEM) + MSW_ENVELOPE_KEY_ID (decimal
 *     epoch). Unset or malformed → MswSigningConfigError; NO unsigned
 *     admission, no placeholder keys (synthetic keys exist in tests only).
 *   - Verification rejects ANY deviation (bad version, wrong producer,
 *     disallowed event type, malformed JWS, untrusted kid, canonical-payload
 *     mismatch, invalid signature, contract-shape violation).
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { canonicalizeJcs } from "./pcsEnvelope";

export const MSW_ENVELOPE_VERSION = "1.0";
export const MSW_PRODUCER = "blueeconomy-singlewindow-msw";
export const MSW_KID_PREFIX = "blueeconomy-singlewindow-msw-";
export const MSW_TOPIC = "maritime.msw.v1";

// ─── Contract-governed fail-closed sets (wire forms — NO enum prefixes) ─────

export const MSW_FORM_TYPES = ["FAL1", "FAL2", "FAL3", "FAL4", "FAL5", "FAL6", "FAL7", "MDOH"] as const;
export type MswFormType = (typeof MSW_FORM_TYPES)[number];

export const MSW_AGENCIES = ["PORT_HEALTH", "NIS", "NCS", "NDLEA", "NIMASA", "NPA"] as const;
export type MswAgency = (typeof MSW_AGENCIES)[number];

export const MSW_VISIT_STATUSES = [
  "DRAFT", "SUBMITTED", "UNDER_REVIEW", "CLEARED_TO_ENTER", "IN_PORT",
  "CLEARED_TO_DEPART", "DEPARTED", "CANCELLED",
] as const;
export type MswVisitStatus = (typeof MSW_VISIT_STATUSES)[number];

export const MSW_CLEARANCE_KINDS = ["ARRIVAL", "DEPARTURE"] as const;
export type MswClearanceKind = (typeof MSW_CLEARANCE_KINDS)[number];

/** NDPA PERSONAL category: crew/passenger/health personal-data forms. */
export const MSW_PERSONAL_DATA_FORMS: ReadonlySet<MswFormType> = new Set(["FAL4", "FAL5", "FAL6", "MDOH"]);

/** NPPM 2021 joint-boarding agencies (Port Health boards FIRST, alone). */
export const MSW_JOINT_BOARDING_AGENCIES: readonly MswAgency[] = ["NIS", "NCS", "NDLEA", "NIMASA"];

/** Classification lattice (ascending). Floors are minima — never widened. */
export const MSW_CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type MswClassification = (typeof MSW_CLASSIFICATIONS)[number];

export const MSW_EVENT_TYPES = [
  "maritime.msw.visit_created.v1",
  "maritime.msw.agent_nominated.v1",
  "maritime.msw.declaration_submitted.v1",
  "maritime.msw.declaration_accepted.v1",
  "maritime.msw.declaration_returned.v1",
  "maritime.msw.pratique_granted.v1",
  "maritime.msw.pratique_refused.v1",
  "maritime.msw.boarding_scheduled.v1",
  "maritime.msw.boarding_completed.v1",
  "maritime.msw.clearance_granted.v1",
  "maritime.msw.clearance_refused.v1",
] as const;
export type MswEventType = (typeof MSW_EVENT_TYPES)[number];

const MSW_EVENT_TYPE_SET: ReadonlySet<string> = new Set(MSW_EVENT_TYPES);

/** FHIR primary-resource @type URL per event type (contract field names). */
export const MSW_RESOURCE_TYPE_URL: Record<MswEventType, string> = {
  "maritime.msw.visit_created.v1": "type.googleapis.com/blueeconomy.msw.v1.MswVisitCreated",
  "maritime.msw.agent_nominated.v1": "type.googleapis.com/blueeconomy.msw.v1.MswAgentNominated",
  "maritime.msw.declaration_submitted.v1": "type.googleapis.com/blueeconomy.msw.v1.MswDeclarationSubmitted",
  "maritime.msw.declaration_accepted.v1": "type.googleapis.com/blueeconomy.msw.v1.MswDeclarationAccepted",
  "maritime.msw.declaration_returned.v1": "type.googleapis.com/blueeconomy.msw.v1.MswDeclarationReturned",
  "maritime.msw.pratique_granted.v1": "type.googleapis.com/blueeconomy.msw.v1.MswPratiqueGranted",
  "maritime.msw.pratique_refused.v1": "type.googleapis.com/blueeconomy.msw.v1.MswPratiqueRefused",
  "maritime.msw.boarding_scheduled.v1": "type.googleapis.com/blueeconomy.msw.v1.MswBoardingScheduled",
  "maritime.msw.boarding_completed.v1": "type.googleapis.com/blueeconomy.msw.v1.MswBoardingCompleted",
  "maritime.msw.clearance_granted.v1": "type.googleapis.com/blueeconomy.msw.v1.MswClearanceGranted",
  "maritime.msw.clearance_refused.v1": "type.googleapis.com/blueeconomy.msw.v1.MswClearanceRefused",
};

// ─── Envelope types ──────────────────────────────────────────────────────────

export interface MswEnvelope {
  envelopeVersion: string;
  eventId: string;
  eventType: MswEventType;
  occurredAt: string;
  producer: string;
  correlationId: string;
  classification: MswClassification;
  recordClassification?: MswClassification;
  fhir: {
    resourceType: "Bundle";
    type: "message";
    bundleId: string;
    entry: [{ fullUrl: string; resource: Record<string, unknown> }];
  };
  provenance: {
    principalId: string;
    principalRole: string;
    ledgerCommitHash: string;
    signature?: string;
  };
}

export interface MswSignedEnvelope extends MswEnvelope {
  provenance: MswEnvelope["provenance"] & { signature: string };
}

// ─── Classification floors (docs/msw.md §Classification floors) ─────────────

function isPersonalDataForm(formType: unknown): boolean {
  return typeof formType === "string" && MSW_PERSONAL_DATA_FORMS.has(formType as MswFormType);
}

/**
 * Computes the contract classification floor for an event. Returns the floor
 * and whether recordClassification must be set. Pure function of the event
 * type and (for declaration events) the form type.
 */
export function mswClassificationFloor(
  eventType: MswEventType,
  resource: Record<string, unknown>
): { floor: MswClassification; recordClassification: MswClassification | null } {
  switch (eventType) {
    case "maritime.msw.visit_created.v1":
    case "maritime.msw.agent_nominated.v1":
      return { floor: "INTERNAL", recordClassification: null };
    case "maritime.msw.declaration_submitted.v1":
    case "maritime.msw.declaration_accepted.v1":
    case "maritime.msw.declaration_returned.v1":
      return isPersonalDataForm(resource.formType)
        ? { floor: "RESTRICTED", recordClassification: "RESTRICTED" }
        : { floor: "INTERNAL", recordClassification: null };
    case "maritime.msw.pratique_granted.v1":
    case "maritime.msw.pratique_refused.v1":
      return { floor: "RESTRICTED", recordClassification: "RESTRICTED" };
    case "maritime.msw.boarding_scheduled.v1":
    case "maritime.msw.boarding_completed.v1":
    case "maritime.msw.clearance_granted.v1":
    case "maritime.msw.clearance_refused.v1":
      return { floor: "CONFIDENTIAL", recordClassification: "CONFIDENTIAL" };
  }
}

function classificationRank(c: MswClassification): number {
  return MSW_CLASSIFICATIONS.indexOf(c);
}

// ─── Signing key (env-only, fail closed) ─────────────────────────────────────

export class MswSigningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MswSigningConfigError";
  }
}

/** PKCS#8 DER prefix for an Ed25519 private key from a 32-byte seed. */
const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function decodePrivateKey(encoded: string): KeyObject {
  const trimmed = encoded.trim();
  if (!trimmed) {
    throw new MswSigningConfigError("MSW_ENVELOPE_SIGNING_KEY is empty");
  }
  if (trimmed.startsWith("-----BEGIN")) {
    try {
      const key = createPrivateKey(trimmed);
      if (key.asymmetricKeyType !== "ed25519") {
        throw new MswSigningConfigError("MSW_ENVELOPE_SIGNING_KEY PEM is not an Ed25519 private key");
      }
      return key;
    } catch (err) {
      if (err instanceof MswSigningConfigError) throw err;
      throw new MswSigningConfigError("MSW_ENVELOPE_SIGNING_KEY is not a parseable PEM private key");
    }
  }
  const candidates: Buffer[] = [];
  for (const encoding of ["base64url", "base64"] as const) {
    try {
      candidates.push(Buffer.from(trimmed, encoding));
    } catch { /* try next */ }
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed)) {
    candidates.push(Buffer.from(trimmed, "hex"));
  }
  // 32-byte raw seed, or the first 32 bytes of a 64-byte expanded secret key.
  const seed = candidates.find((raw) => raw.length === 32 || raw.length === 64)?.subarray(0, 32);
  if (!seed || seed.length !== 32) {
    throw new MswSigningConfigError(
      "MSW_ENVELOPE_SIGNING_KEY is not a 32-byte Ed25519 seed (base64/hex) or PKCS#8 PEM"
    );
  }
  return createPrivateKey({
    key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
    format: "der",
    type: "pkcs8",
  });
}

export interface MswSigningKey {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Full JWS kid: blueeconomy-singlewindow-msw-<epoch>. */
  kid: string;
}

/**
 * Resolves the producer signing key from the environment. FAIL CLOSED: throws
 * MswSigningConfigError when MSW_ENVELOPE_SIGNING_KEY / MSW_ENVELOPE_KEY_ID
 * are unset or malformed — no unsigned admission, no placeholder keys.
 * Read lazily (call time) so key rotation needs no process restart; the keys
 * are registered centrally in server/_core/env.ts (PRA-068).
 */
export function getMswSigningKey(): MswSigningKey {
  const rawKey = process.env.MSW_ENVELOPE_SIGNING_KEY ?? "";
  if (!rawKey.trim()) {
    throw new MswSigningConfigError(
      "MSW_ENVELOPE_SIGNING_KEY is not configured — MSW envelope signing fails closed (no unsigned admission)"
    );
  }
  const keyId = (process.env.MSW_ENVELOPE_KEY_ID ?? "").trim();
  if (!/^\d+$/.test(keyId)) {
    throw new MswSigningConfigError(
      "MSW_ENVELOPE_KEY_ID is not a decimal epoch — MSW envelope signing fails closed"
    );
  }
  const privateKey = decodePrivateKey(rawKey);
  return {
    privateKey,
    publicKey: createPublicKey(privateKey),
    kid: `${MSW_KID_PREFIX}${keyId}`,
  };
}

// ─── Envelope construction + signing ─────────────────────────────────────────

export interface BuildMswEnvelopeOptions {
  eventId: string;
  eventType: MswEventType;
  /** Primary resource (contract field names, camelCase; @type is added). */
  resource: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  correlationId: string;
  occurredAt: string;
  bundleId: string;
  fullUrl: string;
  /** Optional raise above the floor (floors are minima, never widened). */
  classification?: MswClassification;
}

/**
 * Builds an unsigned envelope v1.0 with the FHIR R4 message Bundle wrap and
 * the contract classification floor applied. Throws when a requested
 * classification would WIDEN below the floor.
 */
export function buildMswEnvelope(options: BuildMswEnvelopeOptions): MswEnvelope {
  const resource = { "@type": MSW_RESOURCE_TYPE_URL[options.eventType], ...options.resource };
  const { floor, recordClassification } = mswClassificationFloor(options.eventType, resource);
  let classification: MswClassification = floor;
  if (options.classification) {
    if (classificationRank(options.classification) < classificationRank(floor)) {
      throw new MswSigningConfigError(
        `classification ${options.classification} is below the contract floor ${floor} for ${options.eventType}`
      );
    }
    classification = options.classification;
  }
  return {
    envelopeVersion: MSW_ENVELOPE_VERSION,
    eventId: options.eventId,
    eventType: options.eventType,
    occurredAt: options.occurredAt,
    producer: MSW_PRODUCER,
    correlationId: options.correlationId,
    classification,
    ...(recordClassification ? { recordClassification } : {}),
    fhir: {
      resourceType: "Bundle",
      type: "message",
      bundleId: options.bundleId,
      entry: [{ fullUrl: options.fullUrl, resource }],
    },
    provenance: {
      principalId: options.principalId,
      principalRole: options.principalRole,
      ledgerCommitHash: "",
    },
  };
}

/**
 * Attaches provenance.signature: JWS compact EdDSA over the JCS-canonicalized
 * envelope minus provenance.signature, protected header exactly
 * {"alg":"EdDSA","kid":"blueeconomy-singlewindow-msw-<epoch>"}.
 */
export function signMswEnvelope(envelope: MswEnvelope, signingKey: MswSigningKey): MswSignedEnvelope {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid: signingKey.kid }), "utf8").toString("base64url");
  const payload = Buffer.from(canonicalizeJcs(envelope), "utf8").toString("base64url");
  const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`, "utf8"), signingKey.privateKey).toString("base64url");
  return { ...envelope, provenance: { ...envelope.provenance, signature: `${header}.${payload}.${signature}` } };
}

/** Convenience: build + sign with the env-resolved key (fail closed). */
export function buildAndSignMswEnvelope(options: BuildMswEnvelopeOptions): MswSignedEnvelope {
  return signMswEnvelope(buildMswEnvelope(options), getMswSigningKey());
}

// ─── Trust keys (consumer symmetry / tests) ──────────────────────────────────

export class MswTrustConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MswTrustConfigError";
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

/** kid contract: blueeconomy-singlewindow-msw-<decimal epoch>. */
export function isValidMswKeyId(kid: string): boolean {
  if (!kid.startsWith(MSW_KID_PREFIX)) return false;
  return /^\d+$/.test(kid.slice(MSW_KID_PREFIX.length));
}

/**
 * Parses a trust keyring (comma-separated "kid=base64-or-hex-public-key"
 * entries — the same format GEO_ENVELOPE_TRUST_KEYS uses) into a
 * kid → KeyObject map. Throws MswTrustConfigError on any malformed entry.
 */
export function parseMswTrustKeys(raw: string): Map<string, KeyObject> {
  const trimmed = raw.trim();
  if (!trimmed) throw new MswTrustConfigError("trust keyring is empty — no producer is trusted");
  const map = new Map<string, KeyObject>();
  for (const entry of trimmed.split(",")) {
    const part = entry.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq <= 0) {
      throw new MswTrustConfigError(`malformed trust-key entry '${part}' (want kid=base64-or-hex-key)`);
    }
    const kid = part.slice(0, eq).trim();
    const encoded = part.slice(eq + 1).trim();
    if (!isValidMswKeyId(kid)) {
      throw new MswTrustConfigError(`trust key kid '${kid}' is not a ${MSW_KID_PREFIX}<epoch> key id`);
    }
    const rawKey = decodePublicKey(encoded);
    if (!rawKey) {
      throw new MswTrustConfigError(`trust key '${kid}' is not a 32-byte Ed25519 public key (base64/hex)`);
    }
    map.set(
      kid,
      createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: rawKey.toString("base64url") }, format: "jwk" })
    );
  }
  if (map.size === 0) throw new MswTrustConfigError("trust keyring names no keys");
  return map;
}

// ─── Verification + contract validation ──────────────────────────────────────

export type MswRejectReason =
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
  | "missing_trust_keys"
  | "enum_wire_violation"
  | "classification_floor_violation"
  | "pratique_binding_violation"
  | "precondition_binding_violation"
  | "digest_format_violation";

export type MswReject = { ok: false; reason: MswRejectReason; detail: string };

export type MswVerifyResult =
  | { ok: true; envelope: MswSignedEnvelope; kid: string; resource: Record<string, unknown> }
  | MswReject;

function reject(reason: MswRejectReason, detail: string): MswReject {
  return { ok: false, reason, detail };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const SHA256_DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256_DIGEST_RE.test(value);
}

function isEmptyOrDigest(value: unknown): boolean {
  return value === "" || value === undefined || isDigest(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Contract validation of the primary resource for a verified envelope
 * (docs/msw.md): required fields, enum wire forms (fail closed on
 * MSW_FORM_TYPE_/MSW_AGENCY_-prefixed or unknown values), classification
 * floors, pratique/precondition binding.
 */
export function validateMswEvent(envelope: MswEnvelope): MswReject | { ok: true; resource: Record<string, unknown> } {
  const eventType = envelope.eventType;
  if (!MSW_EVENT_TYPE_SET.has(eventType)) {
    return reject("unsupported_event_type", `eventType ${String(eventType)} is not a maritime.msw v1 contract type`);
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
  if (resource["@type"] !== MSW_RESOURCE_TYPE_URL[eventType]) {
    return reject("payload_shape", `resource @type ${String(resource["@type"])} does not match eventType ${eventType}`);
  }

  // Classification floor.
  if (typeof envelope.classification !== "string" || !MSW_CLASSIFICATIONS.includes(envelope.classification)) {
    return reject("classification_floor_violation", `classification ${String(envelope.classification)} is not a contract value`);
  }
  const { floor, recordClassification } = mswClassificationFloor(eventType, resource);
  if (classificationRank(envelope.classification) < classificationRank(floor)) {
    return reject("classification_floor_violation", `classification ${envelope.classification} is below the floor ${floor} for ${eventType}`);
  }
  if (recordClassification && envelope.recordClassification !== recordClassification) {
    return reject("classification_floor_violation", `recordClassification must be ${recordClassification} for ${eventType}`);
  }

  switch (eventType) {
    case "maritime.msw.visit_created.v1": {
      if (!isNonEmptyString(resource.visitId) || !isNonEmptyString(resource.vesselImoNumber) ||
          !/^[0-9]{7}$/.test(resource.vesselImoNumber as string) ||
          !isNonEmptyString(resource.vesselName) || !isNonEmptyString(resource.vesselFlagCode) ||
          !isNonEmptyString(resource.portCode) || !isNonEmptyString(resource.agentReference) ||
          !isIsoTimestamp(resource.eta) || !isIsoTimestamp(resource.declaredAt)) {
        return reject("payload_shape", "MswVisitCreated is missing required fields or has a bad IMO number");
      }
      if (resource.portCallId !== undefined && !isNonEmptyString(resource.portCallId)) {
        return reject("payload_shape", "portCallId must be a non-empty string when present");
      }
      if (resource.etd !== undefined && !isIsoTimestamp(resource.etd)) {
        return reject("payload_shape", "etd must be an ISO timestamp when present");
      }
      if (typeof resource.portCallVerified !== "boolean") {
        return reject("payload_shape", "portCallVerified must be a boolean");
      }
      // Honest-linkage invariant: a verified flag without a port call is fabricated.
      if (resource.portCallVerified === true && !isNonEmptyString(resource.portCallId)) {
        return reject("payload_shape", "portCallVerified=true without portCallId is fabricated verification");
      }
      if (typeof resource.status !== "string" || !MSW_VISIT_STATUSES.includes(resource.status as MswVisitStatus)) {
        return reject("enum_wire_violation", `status ${String(resource.status)} is not a wire MswVisitStatus`);
      }
      return { ok: true, resource };
    }
    case "maritime.msw.agent_nominated.v1": {
      if (!isNonEmptyString(resource.visitId) || !isNonEmptyString(resource.agentReference) || !isIsoTimestamp(resource.nominatedAt)) {
        return reject("payload_shape", "MswAgentNominated is missing required fields");
      }
      if (!isDigest(resource.nominationDocumentDigestSha256)) {
        return reject("digest_format_violation", "nominationDocumentDigestSha256 is not a sha256 digest");
      }
      return { ok: true, resource };
    }
    case "maritime.msw.declaration_submitted.v1": {
      if (!isNonEmptyString(resource.declarationId) || !isNonEmptyString(resource.visitId) || !isIsoTimestamp(resource.submittedAt)) {
        return reject("payload_shape", "MswDeclarationSubmitted is missing required fields");
      }
      if (typeof resource.formType !== "string" || !MSW_FORM_TYPES.includes(resource.formType as MswFormType)) {
        return reject("enum_wire_violation", `formType ${String(resource.formType)} is not a wire MswFormType (no MSW_FORM_TYPE_ prefix)`);
      }
      if (!Number.isInteger(resource.version) || (resource.version as number) < 1) {
        return reject("payload_shape", "version must be a positive integer");
      }
      if (!isDigest(resource.formPayloadDigestSha256)) {
        return reject("digest_format_violation", "formPayloadDigestSha256 is not a sha256 digest");
      }
      // Single-submission chain shape: empty prior digest iff version 1.
      if ((resource.version as number) === 1 && resource.priorSubmissionDigestSha256 !== "") {
        return reject("digest_format_violation", "priorSubmissionDigestSha256 must be empty on version 1");
      }
      if ((resource.version as number) > 1 && !isDigest(resource.priorSubmissionDigestSha256)) {
        return reject("digest_format_violation", "priorSubmissionDigestSha256 must chain to the prior submission on version > 1");
      }
      if (typeof resource.containsPersonalData !== "boolean" ||
          resource.containsPersonalData !== isPersonalDataForm(resource.formType)) {
        return reject("payload_shape", "containsPersonalData must be true exactly for FAL4/FAL5/FAL6/MDOH");
      }
      return { ok: true, resource };
    }
    case "maritime.msw.declaration_accepted.v1":
    case "maritime.msw.declaration_returned.v1": {
      if (!isNonEmptyString(resource.declarationId) || !isNonEmptyString(resource.visitId) || !isIsoTimestamp(resource.decidedAt)) {
        return reject("payload_shape", "declaration review event is missing required fields");
      }
      if (typeof resource.formType !== "string" || !MSW_FORM_TYPES.includes(resource.formType as MswFormType)) {
        return reject("enum_wire_violation", `formType ${String(resource.formType)} is not a wire MswFormType`);
      }
      if (typeof resource.reviewingAgency !== "string" || !MSW_AGENCIES.includes(resource.reviewingAgency as MswAgency)) {
        return reject("enum_wire_violation", `reviewingAgency ${String(resource.reviewingAgency)} is not a wire MswAgency (no MSW_AGENCY_ prefix)`);
      }
      if (!Number.isInteger(resource.version) || (resource.version as number) < 1) {
        return reject("payload_shape", "version must be a positive integer");
      }
      if (!isDigest(resource.reviewNoteDigestSha256)) {
        return reject("digest_format_violation", "reviewNoteDigestSha256 is not a sha256 digest");
      }
      if (eventType === "maritime.msw.declaration_returned.v1" && !isNonEmptyString(resource.returnReasonCode)) {
        return reject("payload_shape", "returnReasonCode is mandatory on a return");
      }
      return { ok: true, resource };
    }
    case "maritime.msw.pratique_granted.v1":
    case "maritime.msw.pratique_refused.v1": {
      if (!isNonEmptyString(resource.visitId) || !isNonEmptyString(resource.healthDeclarationReference)) {
        return reject("payload_shape", "pratique decision is missing visitId/healthDeclarationReference");
      }
      if (eventType === "maritime.msw.pratique_granted.v1") {
        if (!isNonEmptyString(resource.grantedByReference) || !isIsoTimestamp(resource.grantedAt)) {
          return reject("payload_shape", "MswPratiqueGranted is missing grantedByReference/grantedAt");
        }
      } else {
        if (!isNonEmptyString(resource.refusedByReference) || !isIsoTimestamp(resource.refusedAt) ||
            !isNonEmptyString(resource.refusalReasonCode)) {
          return reject("payload_shape", "MswPratiqueRefused is missing refusedByReference/refusedAt/refusalReasonCode");
        }
        if (!isDigest(resource.refusalRecordDigestSha256)) {
          return reject("digest_format_violation", "refusalRecordDigestSha256 is not a sha256 digest");
        }
      }
      return { ok: true, resource };
    }
    case "maritime.msw.boarding_scheduled.v1":
    case "maritime.msw.boarding_completed.v1": {
      if (!isNonEmptyString(resource.boardingId) || !isNonEmptyString(resource.visitId)) {
        return reject("payload_shape", "boarding event is missing boardingId/visitId");
      }
      if (!Array.isArray(resource.agencies) || resource.agencies.length === 0 ||
          !resource.agencies.every((a) => typeof a === "string" && MSW_AGENCIES.includes(a as MswAgency))) {
        return reject("enum_wire_violation", "agencies must be a non-empty set of wire MswAgency values (no MSW_AGENCY_ prefix)");
      }
      const hasNonPortHealth = (resource.agencies as string[]).some((a) => a !== "PORT_HEALTH");
      if (eventType === "maritime.msw.boarding_scheduled.v1") {
        if (typeof resource.scheduledByAgency !== "string" || !MSW_AGENCIES.includes(resource.scheduledByAgency as MswAgency)) {
          return reject("enum_wire_violation", `scheduledByAgency ${String(resource.scheduledByAgency)} is not a wire MswAgency`);
        }
        if (!isIsoTimestamp(resource.scheduledAt) || !isEmptyOrDigest(resource.scheduleNoteDigestSha256)) {
          return reject("payload_shape", "MswBoardingScheduled has a bad scheduledAt/scheduleNoteDigestSha256");
        }
      } else {
        if (!isIsoTimestamp(resource.startedAt) || !isIsoTimestamp(resource.completedAt) || !isDigest(resource.outcomeDigestSha256)) {
          return reject("payload_shape", "MswBoardingCompleted is missing startedAt/completedAt/outcomeDigestSha256");
        }
        // Pratique-first invariant (NPPM 2021): consumers fail closed on a
        // non-Port-Health completion without the grant digest binding.
        if (hasNonPortHealth && !isDigest(resource.pratiqueGrantDigestSha256)) {
          return reject("pratique_binding_violation", "non-Port-Health boarding completion without pratiqueGrantDigestSha256 (PRATIQUE_REQUIRED)");
        }
        if (!hasNonPortHealth && !isEmptyOrDigest(resource.pratiqueGrantDigestSha256)) {
          return reject("digest_format_violation", "pratiqueGrantDigestSha256 must be empty or a sha256 digest");
        }
      }
      return { ok: true, resource };
    }
    case "maritime.msw.clearance_granted.v1":
    case "maritime.msw.clearance_refused.v1": {
      if (!isNonEmptyString(resource.clearanceId) || !isNonEmptyString(resource.visitId) || !isIsoTimestamp(resource.decidedAt)) {
        return reject("payload_shape", "clearance event is missing required fields");
      }
      if (typeof resource.kind !== "string" || !MSW_CLEARANCE_KINDS.includes(resource.kind as MswClearanceKind)) {
        return reject("enum_wire_violation", `kind ${String(resource.kind)} is not a wire MswClearanceKind`);
      }
      if (typeof resource.decidedByAgency !== "string" || !MSW_AGENCIES.includes(resource.decidedByAgency as MswAgency)) {
        return reject("enum_wire_violation", `decidedByAgency ${String(resource.decidedByAgency)} is not a wire MswAgency`);
      }
      if (eventType === "maritime.msw.clearance_granted.v1") {
        // Consumers fail closed on a DEPARTURE grant without the checklist digest.
        if (resource.kind === "DEPARTURE" && !isDigest(resource.preconditionChecklistDigestSha256)) {
          return reject("precondition_binding_violation", "DEPARTURE clearance grant without preconditionChecklistDigestSha256");
        }
        if (resource.kind === "ARRIVAL" && resource.preconditionChecklistDigestSha256 !== "" && !isDigest(resource.preconditionChecklistDigestSha256)) {
          return reject("digest_format_violation", "preconditionChecklistDigestSha256 must be empty or a sha256 digest for ARRIVAL");
        }
        if (!isEmptyOrDigest(resource.conditionsDigestSha256)) {
          return reject("digest_format_violation", "conditionsDigestSha256 must be empty or a sha256 digest");
        }
      } else {
        if (!isNonEmptyString(resource.refusalReasonCode) || !isDigest(resource.refusalRecordDigestSha256)) {
          return reject("payload_shape", "MswClearanceRefused is missing refusalReasonCode/refusalRecordDigestSha256");
        }
      }
      return { ok: true, resource };
    }
  }
}

/**
 * Verifies a raw maritime.msw.v1 message value against the envelope contract
 * (signature + structure + contract validation). Pure function; never throws
 * for untrusted input — returns a classified rejection instead.
 */
export function verifyMswEnvelope(raw: string | Buffer, trustKeys: Map<string, KeyObject>): MswVerifyResult {
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
  if (parsed.envelopeVersion !== MSW_ENVELOPE_VERSION) {
    return reject("unsupported_version", `envelopeVersion ${String(parsed.envelopeVersion)} is not ${MSW_ENVELOPE_VERSION}`);
  }
  if (parsed.producer !== MSW_PRODUCER) {
    return reject("untrusted_producer", `producer ${String(parsed.producer)} is not ${MSW_PRODUCER}`);
  }
  if (typeof parsed.eventType !== "string" || !MSW_EVENT_TYPE_SET.has(parsed.eventType)) {
    return reject("unsupported_event_type", `eventType ${String(parsed.eventType)} is not a maritime.msw v1 contract type`);
  }
  if (!isNonEmptyString(parsed.eventId) || !isNonEmptyString(parsed.correlationId) || !isIsoTimestamp(parsed.occurredAt)) {
    return reject("payload_shape", "envelope is missing eventId/correlationId/occurredAt");
  }
  const provenance = parsed.provenance;
  if (!isRecord(provenance) || !isNonEmptyString(provenance.signature)) {
    return reject("missing_signature", "envelope provenance.signature is missing");
  }
  if (!isNonEmptyString(provenance.principalId) || !isNonEmptyString(provenance.principalRole)) {
    return reject("payload_shape", "envelope provenance is missing principalId/principalRole");
  }

  const parts = (provenance.signature as string).split(".");
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
  if (typeof kid !== "string" || !isValidMswKeyId(kid)) {
    return reject("bad_header", `JWS kid ${String(kid)} is not a ${MSW_KID_PREFIX}<epoch> key id`);
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
  if (!cryptoVerify(null, Buffer.from(`${parts[0]}${"."}${parts[1]}`, "utf8"), publicKey, signature)) {
    return reject("bad_signature", "JWS signature verification failed");
  }

  const envelope = parsed as unknown as MswSignedEnvelope;
  const validation = validateMswEvent(envelope);
  if (!validation.ok) return validation;
  return { ok: true, envelope, kid, resource: validation.resource };
}
