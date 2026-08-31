/**
 * mswExchange.ts — cross-border MSW-to-MSW exchange security (Phase 10 WP-3).
 *
 * Signed ingest/egress for IMO Compendium messages (imoCompendium.ts),
 * mirroring the port-interoperability NSW JWS ingress pattern
 * (blueeconomy-port-interoperability internal/nswsecurity,
 * POST /v1/nsw/port-calls):
 *
 *   INGEST  POST /api/v1/msw/exchange/ingest
 *     1. Authority JWS (compact, RS256) in X-MSW-Authority-Signature verified
 *        against a PINNED peer JWKS (HTTPS URL or inline JSON + sha256 digest
 *        pin + allow-listed KIDs + algorithm allow-list — all env-only).
 *     2. The JWS protected-header `jti` is RESERVED in the replay store
 *        (webhook_receipts, source "msw_exchange") BEFORE processing;
 *        replays → 409, store failure → 503 (fail closed).
 *     3. The envelope v1.0 content signature (EdDSA, JCS canonical) is
 *        verified against pinned peer trust keys
 *        (MSW_EXCHANGE_PEER_TRUST_KEYS, JSON {kid: base64 Ed25519 pub}).
 *     4. The payload IMO message is reverse-mapped (imoCompendium
 *        importImoToDeclaration, fail closed) and persisted as a DRAFT in
 *        msw_foreign_drafts — never auto-accepted; it must traverse the
 *        platform's own submission/maker-checker lifecycle.
 *
 *   EGRESS  (tRPC admin procedure mswExchange.exportDeclaration)
 *     Accepted declaration version → IMO message (digest-bound, fail closed)
 *     → envelope v1.0 (classification floors preserved: FAL4/5/6/MDOH floor
 *     at RESTRICTED with recordClassification) → EdDSA provenance signature
 *     (MSW_ENVELOPE_SIGNING_KEY, env-only, fail closed). Delivery occurs ONLY
 *     when MSW_EXCHANGE_PEER_URL is configured; otherwise the signed envelope
 *     is returned with delivery "NOT_DELIVERED_NO_PEER_CONFIGURED" — no fake
 *     connectivity.
 *
 * Env-only configuration (no defaults, fail closed):
 *   MSW_EXCHANGE_PEER_JWKS_URL        https:// URL of the peer authority JWKS
 *                                     (or MSW_EXCHANGE_PEER_JWKS_JSON inline)
 *   MSW_EXCHANGE_PEER_JWKS_JSON       inline JWKS JSON (test/ pinned-static)
 *   MSW_EXCHANGE_PEER_JWKS_PIN        "sha256:<64 lowercase hex>" of the JWKS doc
 *   MSW_EXCHANGE_PEER_ALLOWED_KIDS    comma-separated allow-listed KIDs
 *   MSW_EXCHANGE_PEER_TRUST_KEYS      JSON {kid: base64 Ed25519 public key}
 *   MSW_EXCHANGE_PEER_URL             optional egress delivery endpoint
 *   MSW_EXCHANGE_SENDER               MSW operator identifier of this window
 */

import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, getPool } from "../db";
import { mswDeclarations, mswForeignDrafts } from "../../drizzle/schema";
import {
  buildEgressEnvelope,
  decodeEd25519PublicKey,
  signEgressEnvelope,
  verifyEgressEnvelope,
  type SignedEgressEnvelope,
} from "./externalAdapters/base";
import {
  getMswSigningKey,
  MSW_PERSONAL_DATA_FORMS,
} from "./mswEnvelope";
import {
  exportDeclarationToImo,
  importImoToDeclaration,
  ImoConformanceError,
  type ImoMswMessage,
} from "./imoCompendium";
import { mswDigestOf, MswServiceError } from "../mswService";

// ─── Reason codes ────────────────────────────────────────────────────────────

export const MSW_EXCHANGE_REASON_CODES = [
  "EXCHANGE_CONFIG",
  "EXCHANGE_SIGNATURE_MISSING",
  "EXCHANGE_SIGNATURE_REJECTED",
  "EXCHANGE_REPLAY",
  "EXCHANGE_REPLAY_STORE_UNAVAILABLE",
  "EXCHANGE_ENVELOPE_REJECTED",
  "EXCHANGE_IMPORT_REJECTED",
  "EXCHANGE_EXPORT_REJECTED",
  "EXCHANGE_PERSISTENCE_UNAVAILABLE",
] as const;
export type MswExchangeReasonCode = (typeof MSW_EXCHANGE_REASON_CODES)[number];

export class MswExchangeError extends Error {
  constructor(
    public readonly reasonCode: MswExchangeReasonCode,
    message: string
  ) {
    super(message);
    this.name = "MswExchangeError";
  }
}

export const MSW_EXCHANGE_PRODUCER = "blueeconomy-singlewindow-msw-exchange";
export const MSW_EXCHANGE_EVENT_TYPE = "maritime.msw.imo_export.v1";
export const MSW_EXCHANGE_SIGNATURE_HEADER = "x-msw-authority-signature";
export const MSW_EXCHANGE_REPLAY_SOURCE = "msw_exchange";

// ─── Peer authority JWS verifier (RS256, pinned JWKS) ───────────────────────

interface PeerJwksPolicy {
  jwksUrl?: string;
  jwksJson?: string;
  pin: string; // "sha256:<hex>"
  allowedKids: Set<string>;
  allowedAlgs: Set<string>;
}

export class PeerJwsVerifier {
  private keys = new Map<string, KeyObject>();

  constructor(private readonly policy: PeerJwksPolicy) {
    if (!policy.pin.startsWith("sha256:") || policy.pin.length !== 71) {
      throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_PEER_JWKS_PIN must be sha256:<64 lowercase hex>");
    }
    if (policy.allowedKids.size === 0) {
      throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_PEER_ALLOWED_KIDS must allow-list at least one KID");
    }
    if (!policy.jwksJson && !(policy.jwksUrl ?? "").startsWith("https://")) {
      throw new MswExchangeError("EXCHANGE_CONFIG", "peer JWKS source must be HTTPS (MSW_EXCHANGE_PEER_JWKS_URL) or pinned inline JSON");
    }
  }

  /** Fetches (or reads inline), digest-pin-checks and caches the peer JWKS. */
  async refresh(): Promise<void> {
    let body: string;
    if (this.policy.jwksJson !== undefined) {
      body = this.policy.jwksJson;
    } else {
      const res = await fetch(this.policy.jwksUrl!, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        throw new MswExchangeError("EXCHANGE_CONFIG", `peer JWKS fetch failed: HTTP ${res.status}`);
      }
      body = await res.text();
    }
    const sum = createHash("sha256").update(body, "utf8").digest("hex");
    if (`sha256:${sum}` !== this.policy.pin) {
      throw new MswExchangeError("EXCHANGE_CONFIG", "peer JWKS digest pin mismatch — refusing to trust");
    }
    const doc = JSON.parse(body) as { keys?: { kty: string; kid: string; n: string; e: string }[] };
    const next = new Map<string, KeyObject>();
    for (const k of doc.keys ?? []) {
      if (k.kty !== "RSA" || !this.policy.allowedKids.has(k.kid)) continue;
      next.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" }));
    }
    if (next.size === 0) {
      throw new MswExchangeError("EXCHANGE_CONFIG", "peer JWKS contains no allow-listed RSA KID");
    }
    this.keys = next;
  }

  /** Verifies a compact JWS and returns its protected-header jti. Fail closed. */
  async verify(compact: string): Promise<string> {
    const parts = compact.split(".");
    if (parts.length !== 3) {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "authority JWS must use compact serialization");
    }
    let header: { alg?: string; kid?: string; jti?: string };
    try {
      header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    } catch {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "invalid JWS protected header");
    }
    if (!header.alg || !this.policy.allowedAlgs.has(header.alg) || !header.kid || !this.policy.allowedKids.has(header.kid)) {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "JWS alg/KID violates peer policy");
    }
    if (!header.jti || typeof header.jti !== "string") {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "authority JWS missing replay identity (jti)");
    }
    let key = this.keys.get(header.kid);
    if (!key) {
      await this.refresh();
      key = this.keys.get(header.kid);
    }
    if (!key) {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "KID missing from pinned peer JWKS");
    }
    const ok = cryptoVerify(
      "sha256",
      Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"),
      key,
      Buffer.from(parts[2], "base64url")
    );
    if (!ok) {
      throw new MswExchangeError("EXCHANGE_SIGNATURE_REJECTED", "authority JWS signature invalid");
    }
    return header.jti;
  }
}

let cachedVerifier: PeerJwsVerifier | null = null;

/** Builds the verifier from the environment. Fail closed when unconfigured. */
export function getPeerVerifier(): PeerJwsVerifier {
  if (cachedVerifier) return cachedVerifier;
  cachedVerifier = new PeerJwsVerifier({
    jwksUrl: process.env.MSW_EXCHANGE_PEER_JWKS_URL?.trim() || undefined,
    jwksJson: process.env.MSW_EXCHANGE_PEER_JWKS_JSON?.trim() || undefined,
    pin: (process.env.MSW_EXCHANGE_PEER_JWKS_PIN ?? "").trim(),
    allowedKids: new Set(
      (process.env.MSW_EXCHANGE_PEER_ALLOWED_KIDS ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    ),
    allowedAlgs: new Set(["RS256"]),
  });
  return cachedVerifier;
}

/** Test hook: resets the cached verifier (env changes between tests). */
export function resetPeerVerifierForTests(): void {
  cachedVerifier = null;
}

// ─── Replay store (webhook_receipts, atomic reserve-before-process) ──────────

/**
 * Atomically reserves a replay identity (sha256 of the JWS jti). Returns
 * false on replay. Throws MswExchangeError when the store is unavailable —
 * callers must convert to 503, never let a replay through (mirrors the
 * port-interop ReplayStore.Reserve contract).
 */
export async function reserveReplayIdentity(jti: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) {
    throw new MswExchangeError("EXCHANGE_REPLAY_STORE_UNAVAILABLE", "PostgreSQL is unavailable — cannot reserve replay identity");
  }
  const key = `sha256:${createHash("sha256").update(jti, "utf8").digest("hex")}`;
  const { rowCount } = await pool.query(
    `INSERT INTO webhook_receipts (source, delivery_key) VALUES ($1, $2)
     ON CONFLICT ON CONSTRAINT webhook_receipts_source_key_unique DO NOTHING`,
    [MSW_EXCHANGE_REPLAY_SOURCE, key]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Peer envelope trust keys (content signature) ───────────────────────────

export function getPeerTrustKeys(): Map<string, KeyObject> {
  const raw = (process.env.MSW_EXCHANGE_PEER_TRUST_KEYS ?? "").trim();
  if (!raw) {
    throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_PEER_TRUST_KEYS is not configured — envelope verification fails closed");
  }
  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_PEER_TRUST_KEYS is not valid JSON");
  }
  const keys = new Map<string, KeyObject>();
  for (const [kid, encoded] of Object.entries(parsed)) {
    const der = decodeEd25519PublicKey(encoded);
    if (!der) continue;
    keys.set(kid, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: der.toString("base64url") }, format: "jwk" }));
  }
  if (keys.size === 0) {
    throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_PEER_TRUST_KEYS contains no usable Ed25519 key");
  }
  return keys;
}

// ─── Ingest (foreign MSW → platform draft) ───────────────────────────────────

export interface IngestResult {
  draftId: string;
  formType: string;
  provenance: Record<string, unknown>;
}

/**
 * Full ingest pipeline: authority JWS → replay reserve → envelope v1.0
 * content-signature verify → IMO reverse mapping → DRAFT persistence.
 * Throws MswExchangeError / ImoConformanceError (fail closed).
 */
export async function ingestExchangeMessage(params: {
  authorityJws: string | undefined;
  rawBody: string;
  verifier?: PeerJwsVerifier;
  reserveReplay?: (jti: string) => Promise<boolean>;
  now?: () => Date;
}): Promise<IngestResult> {
  const compact = (params.authorityJws ?? "").trim();
  if (!compact) {
    throw new MswExchangeError("EXCHANGE_SIGNATURE_MISSING", "missing authority signature");
  }
  const verifier = params.verifier ?? getPeerVerifier();
  const jti = await verifier.verify(compact);
  const reserve = params.reserveReplay ?? reserveReplayIdentity;
  const reserved = await reserve(jti);
  if (!reserved) {
    throw new MswExchangeError("EXCHANGE_REPLAY", "replayed authority message");
  }

  const peerProducer = (process.env.MSW_EXCHANGE_PEER_PRODUCER ?? "").trim();
  const peerKidPrefix = (process.env.MSW_EXCHANGE_PEER_KID_PREFIX ?? "").trim();
  if (!peerProducer || !peerKidPrefix) {
    throw new MswExchangeError(
      "EXCHANGE_CONFIG",
      "MSW_EXCHANGE_PEER_PRODUCER / MSW_EXCHANGE_PEER_KID_PREFIX are not configured — envelope verification fails closed"
    );
  }
  const verified = verifyEgressEnvelope(params.rawBody, {
    producer: peerProducer,
    kidPrefix: peerKidPrefix,
    trustKeys: getPeerTrustKeys(),
  });
  if (!verified.ok) {
    throw new MswExchangeError("EXCHANGE_ENVELOPE_REJECTED", `envelope rejected: ${verified.reason} (${verified.detail})`);
  }
  const envelope = verified.envelope as SignedEgressEnvelope;
  if (envelope.eventType !== MSW_EXCHANGE_EVENT_TYPE && envelope.eventType !== "maritime.msw.imo_import.v1") {
    throw new MswExchangeError("EXCHANGE_ENVELOPE_REJECTED", `unexpected exchange eventType ${envelope.eventType}`);
  }

  const now = (params.now ?? (() => new Date()))();
  let imported;
  try {
    imported = importImoToDeclaration(envelope.payload, now.toISOString());
  } catch (err) {
    if (err instanceof ImoConformanceError) {
      throw new MswExchangeError("EXCHANGE_IMPORT_REJECTED", `${err.reasonCode}: ${err.message}`);
    }
    throw err;
  }

  const db = await getDb();
  if (!db) {
    throw new MswExchangeError("EXCHANGE_PERSISTENCE_UNAVAILABLE", "PostgreSQL is unavailable — foreign draft not persisted");
  }
  const message = envelope.payload as unknown as ImoMswMessage;
  const draftId = `mswfd-${randomUUID().slice(0, 12)}`;
  await db.insert(mswForeignDrafts).values({
    draftId,
    formType: imported.formType,
    foreignSender: imported.provenance.foreignSender,
    sourceMessageId: imported.provenance.sourceMessageId,
    envelopeEventId: envelope.eventId,
    envelopeDigestSha256: mswDigestOf(envelope.payload),
    formPayload: { ...imported.formPayload, provenance: imported.provenance },
    containsPersonalData: imported.containsPersonalData,
    status: "DRAFT",
  });
  return { draftId, formType: imported.formType, provenance: imported.provenance as unknown as Record<string, unknown> };
}

// ─── Egress (accepted declaration → signed IMO export) ──────────────────────

export interface EgressResult {
  envelope: SignedEgressEnvelope;
  /** Honest delivery state — no fake connectivity. */
  delivery: "DELIVERED" | "NOT_DELIVERED_NO_PEER_CONFIGURED" | "DELIVERY_FAILED";
  deliveryDetail?: string;
}

/**
 * Builds (and optionally delivers) the signed cross-border export for an
 * ACCEPTED declaration version. Digest-bound to the stored declaration
 * version; classification floors preserved (personal-data forms floor at
 * RESTRICTED with recordClassification). Fail closed: unmapped mandatory
 * elements reject the export; no unsigned admission.
 */
export async function buildSignedExport(params: {
  declarationId: string;
  principalId: string;
  correlationId?: string;
  deliver?: boolean;
}): Promise<EgressResult> {
  const db = await getDb();
  if (!db) {
    throw new MswServiceError("DATABASE_UNAVAILABLE", "PostgreSQL is unavailable for MSW exchange egress");
  }
  const rows = await db
    .select()
    .from(mswDeclarations)
    .where(and(eq(mswDeclarations.declarationId, params.declarationId)))
    .limit(1);
  const declaration = rows[0];
  if (!declaration) {
    throw new MswServiceError("DECLARATION_NOT_FOUND", `declaration '${params.declarationId}' does not exist`);
  }
  if (declaration.status !== "ACCEPTED") {
    throw new MswExchangeError(
      "EXCHANGE_EXPORT_REJECTED",
      `declaration '${params.declarationId}' is ${declaration.status} — only ACCEPTED versions may be exported cross-border`
    );
  }

  const sender = (process.env.MSW_EXCHANGE_SENDER ?? "").trim();
  if (!sender) {
    throw new MswExchangeError("EXCHANGE_CONFIG", "MSW_EXCHANGE_SENDER is not configured — egress fails closed");
  }

  let message: ImoMswMessage;
  try {
    message = exportDeclarationToImo({
      formType: declaration.formType,
      declarationId: declaration.declarationId,
      visitId: String(declaration.visitPk),
      version: declaration.version,
      formPayloadDigestSha256: declaration.formPayloadDigestSha256,
      formPayload: declaration.formPayload as Record<string, unknown>,
      sender,
      messageId: `imomsg-${randomUUID()}`,
      issuedAt: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ImoConformanceError) {
      throw new MswExchangeError("EXCHANGE_EXPORT_REJECTED", `${err.reasonCode}: ${err.message}`);
    }
    throw err;
  }

  const personal = MSW_PERSONAL_DATA_FORMS.has(declaration.formType);
  const envelope = buildEgressEnvelope({
    producer: MSW_EXCHANGE_PRODUCER,
    eventType: MSW_EXCHANGE_EVENT_TYPE,
    payload: message as unknown as Record<string, unknown>,
    principalId: params.principalId,
    principalRole: "msw-exchange",
    classification: personal ? "RESTRICTED" : "CONFIDENTIAL",
    ...(personal ? { recordClassification: "RESTRICTED" } : {}),
    ...(params.correlationId ? { correlationId: params.correlationId } : {}),
  });
  const signingKey = getMswSigningKey();
  const signed = signEgressEnvelope(envelope, signingKey.privateKey, signingKey.kid);

  const peerUrl = (process.env.MSW_EXCHANGE_PEER_URL ?? "").trim();
  if (!peerUrl || params.deliver === false) {
    return {
      envelope: signed,
      delivery: "NOT_DELIVERED_NO_PEER_CONFIGURED",
      deliveryDetail: peerUrl ? "delivery disabled by caller" : "MSW_EXCHANGE_PEER_URL is not configured",
    };
  }
  try {
    const res = await fetch(peerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(signed),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { envelope: signed, delivery: "DELIVERY_FAILED", deliveryDetail: `peer returned HTTP ${res.status}` };
    }
    return { envelope: signed, delivery: "DELIVERED", deliveryDetail: `HTTP ${res.status}` };
  } catch (err) {
    return { envelope: signed, delivery: "DELIVERY_FAILED", deliveryDetail: err instanceof Error ? err.message : String(err) };
  }
}
