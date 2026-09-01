/**
 * crm/envelope.ts — envelope v1.0 producer-side signing for crm.case.v1
 * events (Phase 12 stakeholder-360 CRM).
 *
 * Follows the normative fleet scheme (blueeconomy-contracts
 * docs/envelope-signature.md), mirroring server/_core/mswEnvelope.ts:
 *
 *   - Every event is the primary resource of a FHIR R4 message Bundle carried
 *     in an EventEnvelope: envelopeVersion "1.0", eventId, eventType,
 *     occurredAt, producer "blueeconomy-singlewindow-crm", correlationId,
 *     classification, fhir, provenance{principalId, principalRole,
 *     ledgerCommitHash, signature}.
 *   - provenance.signature is a JWS compact serialization (EdDSA/Ed25519)
 *     over the JCS-canonicalized (RFC 8785) envelope with
 *     provenance.signature excluded; the protected header is exactly
 *     {"alg":"EdDSA","kid":"blueeconomy-singlewindow-crm-<epoch>"}.
 *
 * FAIL CLOSED: signing requires CRM_ENVELOPE_SIGNING_KEY (Ed25519 private
 * key: base64/hex 32-byte seed or PKCS#8 PEM) and CRM_ENVELOPE_KEY_ID
 * (decimal epoch). Unset or malformed → CrmSigningConfigError; NO unsigned
 * admission, no placeholder keys (synthetic keys exist in tests only).
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject,
} from "node:crypto";
import { canonicalizeJcs } from "../lib/jcs";

export const CRM_ENVELOPE_VERSION = "1.0";
export const CRM_PRODUCER = "blueeconomy-singlewindow-crm";
export const CRM_KID_PREFIX = "blueeconomy-singlewindow-crm-";
export const CRM_CASE_TOPIC = "crm.case.v1";

export const CRM_CASE_EVENT_TYPES = [
  "crm.case.created.v1",
  "crm.case.assigned.v1",
  "crm.case.transitioned.v1",
  "crm.case.resolved.v1",
  "crm.case.resolution_approved.v1",
  "crm.case.closed.v1",
] as const;
export type CrmCaseEventType = (typeof CRM_CASE_EVENT_TYPES)[number];

const CRM_EVENT_TYPE_SET: ReadonlySet<string> = new Set(CRM_CASE_EVENT_TYPES);

export interface CrmCaseEnvelope {
  envelopeVersion: string;
  eventId: string;
  eventType: CrmCaseEventType;
  occurredAt: string;
  producer: string;
  correlationId: string;
  classification: "INTERNAL";
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

export interface CrmCaseSignedEnvelope extends CrmCaseEnvelope {
  provenance: CrmCaseEnvelope["provenance"] & { signature: string };
}

export class CrmSigningConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CrmSigningConfigError";
  }
}

const b64u = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

function keyMaterialToPrivateKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  if (trimmed.includes("-----BEGIN")) return createPrivateKey(trimmed);
  const compact = trimmed.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]{64}$/.test(compact)) {
    // 32-byte seed → wrap in PKCS#8 DER (Ed25519 prefix per RFC 8410).
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    return createPrivateKey({ key: Buffer.concat([prefix, Buffer.from(compact, "hex")]), format: "der", type: "pkcs8" });
  }
  const buf = Buffer.from(compact, "base64");
  if (buf.length === 32) {
    const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
    return createPrivateKey({ key: Buffer.concat([prefix, buf]), format: "der", type: "pkcs8" });
  }
  return createPrivateKey(buf);
}

function signingKeyFromEnv(): { privateKey: KeyObject; kid: string } {
  const raw = process.env.CRM_ENVELOPE_SIGNING_KEY;
  const epoch = process.env.CRM_ENVELOPE_KEY_ID;
  if (!raw || !raw.trim()) {
    throw new CrmSigningConfigError(
      "CRM_ENVELOPE_SIGNING_KEY is not configured (env-only secrets policy, fail-closed); refusing to emit an unsigned crm.case.v1 event."
    );
  }
  if (!epoch || !/^\d+$/.test(epoch.trim())) {
    throw new CrmSigningConfigError(
      "CRM_ENVELOPE_KEY_ID (decimal epoch) is not configured; cannot derive kid for crm.case.v1 signing."
    );
  }
  try {
    return { privateKey: keyMaterialToPrivateKey(raw), kid: `${CRM_KID_PREFIX}${epoch.trim()}` };
  } catch (err) {
    throw new CrmSigningConfigError(
      `CRM_ENVELOPE_SIGNING_KEY is malformed: ${err instanceof Error ? err.message : "unknown key error"}`
    );
  }
}

/** JCS-canonical bytes of the envelope with provenance.signature excluded. */
function canonicalSigningPayload(envelope: CrmCaseEnvelope): Buffer {
  const { provenance, ...rest } = envelope;
  const unsigned = {
    ...rest,
    provenance: {
      principalId: provenance.principalId,
      principalRole: provenance.principalRole,
      ledgerCommitHash: provenance.ledgerCommitHash,
    },
  };
  return Buffer.from(canonicalizeJcs(unsigned as unknown as import("../lib/jcs").JsonValue), "utf8");
}

export interface BuildCrmCaseEnvelopeInput {
  eventId: string;
  eventType: CrmCaseEventType;
  resource: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  correlationId: string;
  occurredAt: string;
  bundleId: string;
  fullUrl: string;
}

/**
 * Build and sign (FAIL CLOSED on missing key) one crm.case.v1 envelope.
 * Throws CrmSigningConfigError when signing config is absent; throws on any
 * contract-shape violation (unknown event type).
 */
export function buildAndSignCrmCaseEnvelope(input: BuildCrmCaseEnvelopeInput): CrmCaseSignedEnvelope {
  if (!CRM_EVENT_TYPE_SET.has(input.eventType)) {
    throw new Error(`Unknown crm.case event type "${input.eventType}" (fail-closed set)`);
  }
  const envelope: CrmCaseEnvelope = {
    envelopeVersion: CRM_ENVELOPE_VERSION,
    eventId: input.eventId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    producer: CRM_PRODUCER,
    correlationId: input.correlationId,
    classification: "INTERNAL",
    fhir: {
      resourceType: "Bundle",
      type: "message",
      bundleId: input.bundleId,
      entry: [{ fullUrl: input.fullUrl, resource: input.resource }],
    },
    provenance: {
      principalId: input.principalId,
      principalRole: input.principalRole,
      ledgerCommitHash: createHash("sha256")
        .update(canonicalizeJcs(input.resource as unknown as import("../lib/jcs").JsonValue))
        .digest("hex"),
    },
  };
  const { privateKey, kid } = signingKeyFromEnv();
  const header = b64u(Buffer.from(JSON.stringify({ alg: "EdDSA", kid }), "utf8"));
  const payload = b64u(canonicalSigningPayload(envelope));
  const signature = b64u(cryptoSign(null, Buffer.from(`${header}.${payload}`), privateKey));
  return {
    ...envelope,
    provenance: { ...envelope.provenance, signature: `${header}.${payload}.${signature}` },
  };
}

/** Verify a signed crm.case.v1 envelope against a supplied public key. */
export function verifyCrmCaseEnvelope(envelope: CrmCaseSignedEnvelope, publicKeyPemOrDer: string | Buffer): boolean {
  const jws = envelope.provenance.signature;
  const parts = jws.split(".");
  if (parts.length !== 3) return false;
  const unsigned: CrmCaseEnvelope = {
    ...envelope,
    provenance: {
      principalId: envelope.provenance.principalId,
      principalRole: envelope.provenance.principalRole,
      ledgerCommitHash: envelope.provenance.ledgerCommitHash,
    },
  };
  const payload = b64u(canonicalSigningPayload(unsigned));
  const headerB64 = Buffer.from(parts[0], "base64url").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  if (payload !== parts[1] || headerB64 !== parts[0]) return false;
  const key = createPublicKey(
    typeof publicKeyPemOrDer === "string" && publicKeyPemOrDer.includes("-----BEGIN")
      ? publicKeyPemOrDer
      : { key: publicKeyPemOrDer, format: "der", type: "spki" }
  );
  return cryptoVerify(
    null,
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    Buffer.from(parts[2], "base64url")
  );
}
