/**
 * base.ts — fail-closed signed-envelope egress adapter framework for external
 * government authority integrations (Phase 9 WP-D).
 *
 * Every adapter toward an external authority system (NCS B'Odogwu, CBN TMS,
 * NEPC, NIS, Port Health, NPA e-SEN) is ADAPTER-READY ONLY: no wire
 * compatibility with the authority system is claimed until counterpart
 * credentials exist (mirrors docs/msw.md §External dependencies).
 *
 * HARD fail-closed contract:
 *   - Endpoint + credentials are env-only (registered in server/_core/env.ts,
 *     PRA-068). When an adapter's endpoint or signing material is unset,
 *     EVERY call rejects with AdapterUnconfiguredError
 *     (reason ADAPTER_UNCONFIGURED + the registered GAP id) BEFORE any
 *     network I/O — no stub success paths, no fabricated responses, no
 *     placeholder credentials.
 *   - Egress payloads are envelope v1.0: JCS-canonicalized (RFC 8785) and
 *     JWS-EdDSA signed (reuses the pcsEnvelope/mswEnvelope primitives), kid
 *     "blueeconomy-singlewindow-oga-<adapter>-<epoch>".
 *   - Transport failures (timeout, connection error, non-2xx, shape-invalid
 *     responses) surface honestly as AdapterTransportError — never swallowed,
 *     never substituted with synthetic data.
 */

import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { randomUUID } from "node:crypto";
import { canonicalizeJcs } from "../pcsEnvelope";

// ─── Errors (stable reason codes) ────────────────────────────────────────────

export const ADAPTER_UNCONFIGURED = "ADAPTER_UNCONFIGURED" as const;
export type AdapterTransportReason = "TIMEOUT" | "CONNECTION_ERROR" | "UPSTREAM_ERROR" | "INVALID_RESPONSE";

export class AdapterUnconfiguredError extends Error {
  readonly reason = ADAPTER_UNCONFIGURED;
  constructor(
    public readonly adapterId: string,
    /** Registered platform gap id (e.g. GAP-OGA-BODOGWU, GAP-MSW-ESEN). */
    public readonly gapId: string,
    /** Env var names that must be set to enable the adapter. */
    public readonly missing: string[]
  ) {
    super(
      `${adapterId} is not configured (${missing.join(", ")} unset) — adapter disabled, see ${gapId}. ` +
        "No stub success path exists."
    );
    this.name = "AdapterUnconfiguredError";
  }
}

export class AdapterTransportError extends Error {
  constructor(
    public readonly adapterId: string,
    public readonly reason: AdapterTransportReason,
    message: string,
    public readonly statusCode?: number,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AdapterTransportError";
  }
}

// ─── Envelope v1.0 egress signing ────────────────────────────────────────────

export interface EgressEnvelope {
  envelopeVersion: "1.0";
  eventId: string;
  eventType: string;
  occurredAt: string;
  producer: string;
  correlationId: string;
  classification: string;
  recordClassification?: string;
  payload: Record<string, unknown>;
  provenance: {
    principalId: string;
    principalRole: string;
    ledgerCommitHash: string;
    signature?: string;
  };
}

export interface SignedEgressEnvelope extends EgressEnvelope {
  provenance: EgressEnvelope["provenance"] & { signature: string };
}

/** kid convention: blueeconomy-singlewindow-oga-<adapter>-<decimal epoch>. */
export function egressKidPrefix(adapterId: string): string {
  return `blueeconomy-singlewindow-oga-${adapterId}-`;
}

const ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

/** Decodes an Ed25519 private key: PKCS#8 PEM or base64/base64url/hex 32-byte seed (64-byte expanded key → first 32 bytes). */
export function decodeEd25519PrivateKey(encoded: string, envName: string): KeyObject {
  const trimmed = encoded.trim();
  if (trimmed.startsWith("-----BEGIN")) {
    try {
      const key = createPrivateKey(trimmed);
      if (key.asymmetricKeyType !== "ed25519") {
        throw new AdapterTransportError("framework", "INVALID_RESPONSE", `${envName} PEM is not Ed25519`);
      }
      return key;
    } catch (err) {
      if (err instanceof AdapterTransportError) throw err;
      throw new Error(`${envName} is not a parseable PEM private key`);
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
  const seed = candidates.find((raw) => raw.length === 32 || raw.length === 64)?.subarray(0, 32);
  if (!seed || seed.length !== 32) {
    throw new Error(`${envName} is not a 32-byte Ed25519 seed (base64/hex) or PKCS#8 PEM`);
  }
  return createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]), format: "der", type: "pkcs8" });
}

/** Decodes a base64/base64url/hex 32-byte Ed25519 public key. */
export function decodeEd25519PublicKey(encoded: string): Buffer | null {
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

export interface BuildEgressOptions {
  producer: string;
  eventType: string;
  payload: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  classification?: string;
  recordClassification?: string;
  correlationId?: string;
  eventId?: string;
  occurredAt?: string;
}

export function buildEgressEnvelope(options: BuildEgressOptions): EgressEnvelope {
  return {
    envelopeVersion: "1.0",
    eventId: options.eventId ?? `evt-oga-${randomUUID()}`,
    eventType: options.eventType,
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    producer: options.producer,
    correlationId: options.correlationId ?? `corr-${randomUUID()}`,
    classification: options.classification ?? "CONFIDENTIAL",
    ...(options.recordClassification ? { recordClassification: options.recordClassification } : {}),
    payload: options.payload,
    provenance: {
      principalId: options.principalId,
      principalRole: options.principalRole,
      ledgerCommitHash: "",
    },
  };
}

/** Attaches provenance.signature (JWS compact EdDSA over the JCS-canonicalized envelope minus signature). */
export function signEgressEnvelope(
  envelope: EgressEnvelope,
  privateKey: KeyObject,
  kid: string
): SignedEgressEnvelope {
  const header = Buffer.from(JSON.stringify({ alg: "EdDSA", kid }), "utf8").toString("base64url");
  const payload = Buffer.from(canonicalizeJcs(envelope), "utf8").toString("base64url");
  const signature = cryptoSign(null, Buffer.from(`${header}.${payload}`, "utf8"), privateKey).toString("base64url");
  return { ...envelope, provenance: { ...envelope.provenance, signature: `${header}.${payload}.${signature}` } };
}

export type EgressVerifyResult =
  | { ok: true; envelope: SignedEgressEnvelope; kid: string }
  | { ok: false; reason: string; detail: string };

/**
 * Generic envelope v1.0 verifier (consumer symmetry / tests): version,
 * producer, JWS format, alg=EdDSA, kid prefix + trust set, canonical-payload
 * match, Ed25519 signature. Fail closed on any deviation.
 */
export function verifyEgressEnvelope(
  raw: string | Buffer,
  opts: { producer: string; kidPrefix: string; trustKeys: Map<string, KeyObject> }
): EgressVerifyResult {
  const bad = (reason: string, detail: string): EgressVerifyResult => ({ ok: false, reason, detail });
  if (opts.trustKeys.size === 0) return bad("missing_trust_keys", "no trusted keys configured");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
  } catch {
    return bad("malformed_json", "not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return bad("malformed_json", "not a JSON object");
  if (parsed.envelopeVersion !== "1.0") return bad("unsupported_version", `envelopeVersion ${String(parsed.envelopeVersion)}`);
  if (parsed.producer !== opts.producer) return bad("untrusted_producer", `producer ${String(parsed.producer)}`);
  const provenance = parsed.provenance as Record<string, unknown> | undefined;
  if (!provenance || typeof provenance.signature !== "string" || !provenance.signature) {
    return bad("missing_signature", "provenance.signature missing");
  }
  const parts = provenance.signature.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return bad("bad_jws_format", "not a JWS compact serialization");
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    return bad("bad_header", "protected header is not base64url JSON");
  }
  if (header.alg !== "EdDSA") return bad("bad_header", `alg ${String(header.alg)} is not EdDSA`);
  const kid = header.kid;
  if (
    typeof kid !== "string" ||
    !kid.startsWith(opts.kidPrefix) ||
    !/^\d+$/.test(kid.slice(opts.kidPrefix.length))
  ) {
    return bad("bad_header", `kid ${String(kid)} is not a ${opts.kidPrefix}<epoch> key id`);
  }
  const publicKey = opts.trustKeys.get(kid);
  if (!publicKey) return bad("untrusted_kid", `kid '${kid}' not in trust set`);
  const stripped: Record<string, unknown> = { ...parsed, provenance: { ...provenance } };
  delete (stripped.provenance as Record<string, unknown>).signature;
  if (Buffer.from(canonicalizeJcs(stripped), "utf8").toString("base64url") !== parts[1]) {
    return bad("payload_mismatch", "envelope does not match the signed canonical payload");
  }
  if (!cryptoVerify(null, Buffer.from(`${parts[0]}.${parts[1]}`, "utf8"), publicKey, Buffer.from(parts[2], "base64url"))) {
    return bad("bad_signature", "Ed25519 signature verification failed");
  }
  return { ok: true, envelope: parsed as unknown as SignedEgressEnvelope, kid };
}

// ─── Adapter definition + factory ────────────────────────────────────────────

export interface ExternalAdapterDefinition {
  /** Stable adapter id, e.g. "ncs-bodogwu". Used in the kid prefix. */
  adapterId: string;
  /** Human-facing authority name, e.g. "NCS B'Odogwu". */
  authority: string;
  /** Registered platform gap id disclosed while the adapter is disabled. */
  gapId: string;
  /** Env var names (registered in server/_core/env.ts). */
  env: { url: string; token: string; signingKey: string; keyId: string };
  /** Envelope producer value for this adapter's egress. */
  producer: string;
  /** Transport timeout in ms (default 10_000). */
  timeoutMs?: number;
}

export interface ExternalAdapterStatus {
  adapterId: string;
  authority: string;
  gapId: string;
  /** True only when endpoint AND signing material are fully configured. */
  configured: boolean;
  /** Env vars still missing (never values — names only). */
  missing: string[];
  /** Honest operator state: disabled+gap-registered until credentials exist. */
  state: "disabled_gap_registered" | "configured";
}

interface ResolvedAdapterConfig {
  baseUrl: string;
  token: string;
  privateKey: KeyObject;
  kid: string;
}

export interface SendOptions {
  /** URL path appended to the configured base URL, e.g. "/v1/clearance-requests". */
  path: string;
  eventType: string;
  payload: Record<string, unknown>;
  principalId: string;
  principalRole: string;
  classification?: string;
  recordClassification?: string;
}

export interface ExternalAdapter {
  readonly adapterId: string;
  readonly authority: string;
  readonly gapId: string;
  readonly kidPrefix: string;
  readonly producer: string;
  /** Honest status for operator surfaces — no secrets, only set/unset names. */
  status(): ExternalAdapterStatus;
  /**
   * Builds + signs the egress envelope for a request WITHOUT any network I/O.
   * Still fails closed (AdapterUnconfiguredError) when signing material is
   * unset — no unsigned admission.
   */
  buildSignedRequest(options: Omit<SendOptions, "path">): SignedEgressEnvelope;
  /**
   * Full egress: fail-closed config resolution (BEFORE any network), signed
   * envelope POST, honest transport errors, fail-closed response parsing.
   */
  send<TResponse>(
    options: SendOptions,
    parse: (body: unknown) => TResponse
  ): Promise<{ envelope: SignedEgressEnvelope; response: TResponse }>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createExternalAdapter(def: ExternalAdapterDefinition): ExternalAdapter {
  const kidPrefix = egressKidPrefix(def.adapterId);

  function missingEnv(): string[] {
    const missing: string[] = [];
    if (!(process.env[def.env.url] ?? "").trim()) missing.push(def.env.url);
    if (!(process.env[def.env.signingKey] ?? "").trim()) missing.push(def.env.signingKey);
    if (!(process.env[def.env.keyId] ?? "").trim()) missing.push(def.env.keyId);
    return missing;
  }

  /**
   * Resolves endpoint + signing material or THROWS AdapterUnconfiguredError.
   * Called before ANY network I/O — the fail-closed gate.
   */
  function resolveConfig(): ResolvedAdapterConfig {
    const missing = missingEnv();
    if (missing.length > 0) {
      throw new AdapterUnconfiguredError(def.adapterId, def.gapId, missing);
    }
    const rawUrl = (process.env[def.env.url] ?? "").trim();
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new AdapterUnconfiguredError(def.adapterId, def.gapId, [`${def.env.url} (not a valid URL)`]);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new AdapterUnconfiguredError(def.adapterId, def.gapId, [`${def.env.url} (must be http(s))`]);
    }
    const keyId = (process.env[def.env.keyId] ?? "").trim();
    if (!/^\d+$/.test(keyId)) {
      throw new AdapterUnconfiguredError(def.adapterId, def.gapId, [`${def.env.keyId} (must be a decimal epoch)`]);
    }
    let privateKey: KeyObject;
    try {
      privateKey = decodeEd25519PrivateKey(process.env[def.env.signingKey] ?? "", def.env.signingKey);
    } catch (err) {
      throw new AdapterUnconfiguredError(def.adapterId, def.gapId, [
        `${def.env.signingKey} (${err instanceof Error ? err.message : "unparseable"})`,
      ]);
    }
    return {
      baseUrl: url.origin,
      token: (process.env[def.env.token] ?? "").trim(),
      privateKey,
      kid: `${kidPrefix}${keyId}`,
    };
  }

  function buildSignedRequest(options: Omit<SendOptions, "path">): SignedEgressEnvelope {
    const config = resolveConfig();
    const envelope = buildEgressEnvelope({
      producer: def.producer,
      eventType: options.eventType,
      payload: options.payload,
      principalId: options.principalId,
      principalRole: options.principalRole,
      classification: options.classification,
      recordClassification: options.recordClassification,
    });
    return signEgressEnvelope(envelope, config.privateKey, config.kid);
  }

  async function send<TResponse>(
    options: SendOptions,
    parse: (body: unknown) => TResponse
  ): Promise<{ envelope: SignedEgressEnvelope; response: TResponse }> {
    // Fail-closed gate: config resolution happens BEFORE any network I/O.
    const config = resolveConfig();
    const envelope = buildSignedRequest(options);
    const timeoutMs = def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${config.baseUrl}${options.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
        },
        body: JSON.stringify(envelope),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      throw new AdapterTransportError(
        def.adapterId,
        aborted ? "TIMEOUT" : "CONNECTION_ERROR",
        `${def.authority} egress ${aborted ? `timed out after ${timeoutMs}ms` : "connection failed"}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        undefined,
        { cause: err }
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AdapterTransportError(
        def.adapterId,
        "UPSTREAM_ERROR",
        `${def.authority} responded HTTP ${res.status}`,
        res.status
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      throw new AdapterTransportError(
        def.adapterId,
        "INVALID_RESPONSE",
        `${def.authority} response is not valid JSON`,
        res.status,
        { cause: err }
      );
    }
    try {
      return { envelope, response: parse(body) };
    } catch (err) {
      throw new AdapterTransportError(
        def.adapterId,
        "INVALID_RESPONSE",
        `${def.authority} response failed shape validation: ${err instanceof Error ? err.message : String(err)}`,
        res.status,
        { cause: err }
      );
    }
  }

  return {
    adapterId: def.adapterId,
    authority: def.authority,
    gapId: def.gapId,
    kidPrefix,
    producer: def.producer,
    status(): ExternalAdapterStatus {
      const missing = missingEnv();
      return {
        adapterId: def.adapterId,
        authority: def.authority,
        gapId: def.gapId,
        configured: missing.length === 0,
        missing,
        state: missing.length === 0 ? "configured" : "disabled_gap_registered",
      };
    },
    buildSignedRequest,
    send,
  };
}

/** Fail-closed parser helper: requires a non-empty string field. */
export function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | null)?.[field];
  if (typeof value !== "string" || !value) throw new Error(`missing ${field}`);
  return value;
}

/** Derives the public key from a private key (trust-set construction in tests/peers). */
export function publicKeyOf(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey);
}
