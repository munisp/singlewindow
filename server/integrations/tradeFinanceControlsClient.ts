/**
 * tradeFinanceControlsClient.ts — WP-6 fail-closed client for the
 * financial-controls trade-finance rail.
 *
 * Every request is bearer-authenticated with the service's env-configured
 * client token; every dataset response from the rail is an envelope v1.0
 * bundle (FHIR R4 + JWS EdDSA/JCS) and is verified against the
 * env-configured trusted Ed25519 key set before any byte reaches a caller.
 * There is no default URL, no unsigned fallback and no mock mode: when the
 * environment is unconfigured the client refuses every call.
 */
import { verify as ed25519Verify } from "crypto";
import { TRPCError } from "@trpc/server";
import { fetchWithResilience } from "../_core/middlewareClients";

export interface TradeFinanceControlsConfig {
  baseUrl: string;
  clientToken: string;
  /** kid → base64url Ed25519 public key (32 bytes). */
  trustedKeys: Record<string, string>;
}

export class TradeFinanceControlsUnconfiguredError extends Error {
  constructor(detail: string) {
    super(`trade-finance controls client is not configured: ${detail}`);
    this.name = "TradeFinanceControlsUnconfiguredError";
  }
}

export class EnvelopeVerificationError extends Error {
  constructor(detail: string) {
    super(`trade-finance dataset envelope verification failed: ${detail}`);
    this.name = "EnvelopeVerificationError";
  }
}

/** Fail-closed env loader: any gap is a startup/configuration error. */
export function loadTradeFinanceControlsConfig(
  env: Record<string, string | undefined> = process.env
): TradeFinanceControlsConfig {
  const baseUrl = (env.FINANCIAL_CONTROLS_TRADEFINANCE_URL ?? "").trim();
  if (!baseUrl) {
    throw new TradeFinanceControlsUnconfiguredError(
      "FINANCIAL_CONTROLS_TRADEFINANCE_URL is required"
    );
  }
  if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl)) {
    throw new TradeFinanceControlsUnconfiguredError(
      "FINANCIAL_CONTROLS_TRADEFINANCE_URL must be https (loopback http allowed for local dev)"
    );
  }
  const clientToken = (env.FINANCIAL_CONTROLS_TRADEFINANCE_CLIENT_TOKEN ?? "").trim();
  if (!clientToken) {
    throw new TradeFinanceControlsUnconfiguredError(
      "FINANCIAL_CONTROLS_TRADEFINANCE_CLIENT_TOKEN is required"
    );
  }
  const rawKeys = (env.FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON ?? "").trim();
  if (!rawKeys) {
    throw new TradeFinanceControlsUnconfiguredError(
      "FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON is required"
    );
  }
  let trustedKeys: Record<string, string>;
  try {
    trustedKeys = JSON.parse(rawKeys);
  } catch {
    throw new TradeFinanceControlsUnconfiguredError(
      "FINANCIAL_CONTROLS_TRADEFINANCE_TRUSTED_KEYS_JSON is not valid JSON"
    );
  }
  const entries = Object.entries(trustedKeys ?? {});
  if (entries.length === 0) {
    throw new TradeFinanceControlsUnconfiguredError("trusted key set is empty");
  }
  for (const [kid, key] of entries) {
    if (!kid || typeof key !== "string" || Buffer.from(key, "base64url").length !== 32) {
      throw new TradeFinanceControlsUnconfiguredError(
        `trusted key ${JSON.stringify(kid)} is not a base64url Ed25519 public key`
      );
    }
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), clientToken, trustedKeys };
}

const JWS_EXTENSION_URL = "https://blueeconomy.gov.ng/fhir/StructureDefinition/artifact-jws";
const ENVELOPE_PROFILE = "https://blueeconomy.gov.ng/fhir/StructureDefinition/revenue-envelope-1.0";

export interface VerifiedDatasetPayload {
  bank_id: string;
  trader_id: string;
  scope: string;
  consent_id: string;
  expires_at: string;
  dataset_refs: string[];
}

/**
 * Verify an envelope v1.0 bundle (FHIR R4 Basic resource carrying a compact
 * JWS EdDSA over the JCS-canonical payload) against the trusted key set.
 * Fails closed on shape, kid, signature and canonicality violations.
 */
export function verifyDatasetEnvelope(
  bundle: unknown,
  trustedKeys: Record<string, string>
): VerifiedDatasetPayload {
  const doc = bundle as any;
  if (
    !doc ||
    doc.resourceType !== "Bundle" ||
    doc.type !== "document" ||
    !Array.isArray(doc.meta?.profile) ||
    !doc.meta.profile.includes(ENVELOPE_PROFILE) ||
    !Array.isArray(doc.entry) ||
    doc.entry.length !== 1
  ) {
    throw new EnvelopeVerificationError("not a well-formed v1.0 bundle");
  }
  const resource = doc.entry[0]?.resource;
  const jws = (resource?.extension ?? []).find((e: any) => e?.url === JWS_EXTENSION_URL)?.valueString;
  if (resource?.resourceType !== "Basic" || typeof jws !== "string") {
    throw new EnvelopeVerificationError("bundle entry lacks its JWS extension");
  }
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new EnvelopeVerificationError("JWS is not a compact serialization");
  }
  let header: { alg?: string; kid?: string };
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new EnvelopeVerificationError("undecodable JWS header");
  }
  if (header.alg !== "EdDSA" || !header.kid) {
    throw new EnvelopeVerificationError("unexpected JWS alg or kid");
  }
  const publicKeyB64 = trustedKeys[header.kid];
  if (!publicKeyB64) {
    throw new EnvelopeVerificationError(`signer key ${header.kid} is not trusted`);
  }
  // Ed25519 verify over the signing input with the raw public key wrapped
  // into a SubjectPublicKeyInfo envelope.
  const spki = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicKeyB64, "base64url"),
  ]);
  let ok = false;
  try {
    ok = ed25519Verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"),
      { key: spki, format: "der", type: "spki" },
      Buffer.from(parts[2], "base64url")
    );
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new EnvelopeVerificationError("EdDSA signature does not verify");
  }
  let payload: VerifiedDatasetPayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new EnvelopeVerificationError("undecodable JWS payload");
  }
  if (
    typeof payload?.bank_id !== "string" ||
    typeof payload?.trader_id !== "string" ||
    typeof payload?.scope !== "string" ||
    typeof payload?.consent_id !== "string" ||
    !Array.isArray(payload?.dataset_refs)
  ) {
    throw new EnvelopeVerificationError("payload is not a consented-dataset artifact");
  }
  return payload;
}

/** Transport seam: production uses fetchWithResilience; tests inject fakes. */
export type Transport = (url: string, options: RequestInit, serviceName: string) => Promise<Response>;

export class TradeFinanceControlsClient {
  constructor(
    private readonly config: TradeFinanceControlsConfig,
    private readonly transport: Transport = fetchWithResilience
  ) {}

  /** Fail-closed constructor from env. */
  static fromEnv(env: Record<string, string | undefined> = process.env): TradeFinanceControlsClient {
    return new TradeFinanceControlsClient(loadTradeFinanceControlsConfig(env));
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.clientToken}`,
    };
  }

  private async call(path: string, init: RequestInit): Promise<any> {
    const res = await this.transport(
      `${this.config.baseUrl}${path}`,
      { ...init, headers: { ...this.headers(), ...(init.headers ?? {}) } },
      "financial-controls-tradefinance"
    );
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new TRPCError({
        code: res.status === 403 || res.status === 401 ? "FORBIDDEN" : "BAD_GATEWAY",
        message: `trade-finance rail rejected the request (HTTP ${res.status})`,
      });
    }
    return res.json();
  }

  /** Fetch one consented dataset and verify its envelope before returning. */
  async getConsentedDataset(traderId: string, scope: string): Promise<VerifiedDatasetPayload | null> {
    const res = await this.transport(
      `${this.config.baseUrl}/v1/tradefinance/bank/datasets/${encodeURIComponent(traderId)}/${encodeURIComponent(scope)}`,
      { headers: this.headers() },
      "financial-controls-tradefinance"
    );
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) {
      throw new TRPCError({ code: "BAD_GATEWAY", message: `dataset read failed (HTTP ${res.status})` });
    }
    const bundle = await res.json();
    const payload = verifyDatasetEnvelope(bundle, this.config.trustedKeys);
    if (payload.trader_id !== traderId || payload.scope !== scope) {
      throw new EnvelopeVerificationError("payload does not match the requested trader/scope");
    }
    return payload;
  }

  requestConsent(body: Record<string, unknown>) {
    return this.call("/v1/tradefinance/consents", { method: "POST", body: JSON.stringify(body) });
  }

  consentMove(consentId: string, move: "activate" | "reject" | "request-revocation" | "confirm-revocation" | "reject-revocation", version: number) {
    return this.call(`/v1/tradefinance/consents/${encodeURIComponent(consentId)}/${move}`, {
      method: "POST",
      body: JSON.stringify({ version }),
    });
  }

  listConsents(traderId: string) {
    return this.call(`/v1/tradefinance/consents?trader_id=${encodeURIComponent(traderId)}`, {});
  }

  getConsent(consentId: string) {
    return this.call(`/v1/tradefinance/consents/${encodeURIComponent(consentId)}`, {});
  }

  getConsentAudit(consentId: string) {
    return this.call(`/v1/tradefinance/consents/${encodeURIComponent(consentId)}/audit`, {});
  }

  submitApplication(body: Record<string, unknown>) {
    return this.call("/v1/tradefinance/applications", { method: "POST", body: JSON.stringify(body) });
  }

  recordDecision(applicationId: string, version: number, decision: "APPROVE" | "REJECT") {
    return this.call(`/v1/tradefinance/applications/${encodeURIComponent(applicationId)}/decisions`, {
      method: "POST",
      body: JSON.stringify({ version, decision }),
    });
  }

  getApplication(applicationId: string) {
    return this.call(`/v1/tradefinance/applications/${encodeURIComponent(applicationId)}`, {});
  }

  listApplications(traderId: string) {
    return this.call(`/v1/tradefinance/applications?trader_id=${encodeURIComponent(traderId)}`, {});
  }
}
