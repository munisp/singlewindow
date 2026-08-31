/**
 * tariffClient.ts — typed HTTP client for the blueeconomy-financial-controls
 * tariff engine (W-FEAT-4; closes the PRA-100 wiring remainder).
 *
 * Contract (mirrors internal/tariff/http.go @ fincontrols 3bff518):
 *   POST /v1/tariffs/assess                      — Idempotency-Key header REQUIRED,
 *                                                  X-Correlation-ID optional (defaults
 *                                                  to the key server-side); 201 Assessment
 *   GET  /v1/tariffs/assessments/{id}            — 200 Assessment
 *   GET  /v1/tariffs/assessments/{id}/exemption-audits — 200 { audits: [] }
 *   GET  /healthz                                — liveness (unauthenticated)
 * Every endpoint except /healthz requires a bearer token. In production the
 * engine verifies RS256 against Keycloak; non-production engine profiles
 * accept any non-empty bearer as the requester subject.
 *
 * Resilience semantics follow the Go money-path client
 * (fincontrols internal/mojaloop/client.go):
 *   - explicit per-attempt timeout (AbortSignal.timeout — never the global
 *     default client without a deadline),
 *   - bounded retries: 3 attempts total, exponential backoff 200ms → 400ms →
 *     capped 2s, PLUS equal jitter (this wave's contract adds jitter),
 *   - retry ONLY on network errors / timeouts / 5xx; 4xx is returned
 *     immediately and never retried,
 *   - circuit breaker with the platform semantics (middlewareClients):
 *     CLOSED → OPEN after N failures in a window → HALF_OPEN after cooldown
 *     → CLOSED after consecutive successes.
 *
 * Fail-closed guarantees:
 *   - TARIFF_SERVICE_URL unset/invalid  → TariffConfigError (never a phantom
 *     endpoint, never a silent zero-rated assessment),
 *   - unreachable after retries / breaker open → TariffUnavailableError
 *     (classified; NEVER a fabricated rate),
 *   - 4xx from the engine → TariffRejectedError with the upstream message.
 *
 * Authentication (SW-CLOSE, PRA-100r deferred remainder):
 *   - When KEYCLOAK_TOKEN_URL / TARIFF_SERVICE_CLIENT_ID /
 *     TARIFF_SERVICE_CLIENT_SECRET are ALL set, the client obtains an access
 *     token via the OAuth2 client_credentials grant, caches it, and refreshes
 *     it once it expires within a safety margin (plus a forced single refresh
 *     if the engine answers 401). Token-endpoint calls carry the same
 *     resilience discipline as engine calls (per-attempt timeout, bounded
 *     retries with equal jitter, a dedicated circuit breaker, one CLIENT
 *     span). A 4xx from the token endpoint is a definitive credential
 *     misconfiguration → TariffConfigError, never retried.
 *   - When NONE of them are set, the static TARIFF_SERVICE_TOKEN bearer is
 *     the documented fallback (rustfsSvcClient convention).
 *   - A PARTIAL set is a misconfiguration and fails closed at call time with
 *     a classified TariffConfigError — never a silent fallback.
 *   - Tokens and client secrets NEVER appear in span attributes, events, log
 *     lines, or error messages (token-endpoint error bodies are reduced to
 *     the upstream `error` code, truncated).
 *
 * Telemetry goes through server/_core/telemetry.ts only: one CLIENT span per
 * call (withSpan) and W3C traceparent injection via injectTraceContext — no
 * parallel telemetry path.
 */

import { SpanKind } from "@opentelemetry/api";
import { ENV } from "./env";
import { withSpan, injectTraceContext } from "./telemetry";
import { CircuitBreaker } from "./middlewareClients";

// ─── Types (mirror fincontrols internal/tariff/model.go JSON) ────────────────

export const TARIFF_VESSEL_CLASSES = [
  "GENERAL_CARGO",
  "TANKER",
  "CRUISE",
  "LNG_CARRIER",
  "CONTAINER",
  "BULK",
  "BARGE",
  "PASSENGER",
] as const;
export type TariffVesselClass = (typeof TARIFF_VESSEL_CLASSES)[number];

export type TariffVoyageType = "INTERNATIONAL" | "CABOTAGE";
export type TariffRouteKind = "SEA" | "INLAND_WATERWAY";

export interface TariffAssessRequest {
  vesselGrt: number;
  vesselClass: TariffVesselClass;
  entityRef: string;
  cargoCategory: string;
  voyageType: TariffVoyageType;
  routeKind: TariffRouteKind;
  nigeriaPortCall: boolean;
  grossFreightUsdMinor: number;
  voyageFlags?: string[];
  /** YYYY-MM-DD — selects the statutory rate window (server stamps service date when empty). */
  asOf?: string;
}

export type TariffApplicability = "CHARGED" | "EXEMPT" | "NOT_APPLICABLE" | "UNRATED";

export interface TariffAssessmentLine {
  lineNo: number;
  instrument: string;
  agency: string;
  applicability: TariffApplicability;
  basis: string;
  statutoryReference?: string;
  rateDescription?: string;
  amountMinor: number;
  currency: string;
  exemptionId?: string;
  provisional?: boolean;
}

export interface TariffAssessment {
  assessmentId: string;
  request: TariffAssessRequest;
  asOf: string;
  lines: TariffAssessmentLine[];
  totalUsdMinor: number;
  totalNgnMinor: number;
  requester: string;
  correlationId: string;
  createdAt: string;
}

export interface TariffExemptionAudit {
  auditId: string;
  assessmentId: string;
  exemptionId: string;
  instrument: string;
  matchKind: string;
  matchValue: string;
  statutoryBasis: string;
  evidenceRequirement: string;
  requester: string;
  createdAt: string;
}

// ─── Classified errors ───────────────────────────────────────────────────────

/** TARIFF_SERVICE_URL / TARIFF_SERVICE_TOKEN unset or malformed — fail closed. */
export class TariffConfigError extends Error {
  readonly kind = "config" as const;
  constructor(message: string) {
    super(message);
    this.name = "TariffConfigError";
  }
}

export type TariffUnavailableReason =
  | "circuit_open"
  | "timeout"
  | "network"
  | "upstream_5xx"
  | "invalid_response"
  /** The Keycloak token endpoint was unreachable after bounded retries. */
  | "token_endpoint";

/** Upstream unreachable after bounded retries, or breaker open. Never fabricated. */
export class TariffUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  readonly reason: TariffUnavailableReason;
  readonly attempts: number;
  constructor(message: string, reason: TariffUnavailableReason, attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TariffUnavailableError";
    this.reason = reason;
    this.attempts = attempts;
  }
}

/** Engine rejected the request with a 4xx — returned verbatim, never retried. */
export class TariffRejectedError extends Error {
  readonly kind = "rejected" as const;
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TariffRejectedError";
    this.statusCode = statusCode;
  }
}

// ─── Keycloak client-credentials token provider (SW-CLOSE) ──────────────────

/**
 * Supplies bearer tokens to the tariff client. Implementations must never
 * expose the token (or the client secret) through errors, spans, or logs.
 */
export interface TariffTokenProvider {
  /**
   * Returns a cached access token while it remains valid outside the expiry
   * margin; otherwise fetches (single-flight) a fresh one. `forceRefresh`
   * bypasses the cache (used after an engine 401).
   */
  getToken(forceRefresh?: boolean): Promise<string>;
}

export interface ClientCredentialsTokenProviderOptions {
  /** Required — absolute http(s) URL of the Keycloak token endpoint. */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Per-attempt timeout for token-endpoint calls (default 5_000ms). */
  timeoutMs?: number;
  /** Total attempts per token fetch including the initial try (default 3). */
  maxAttempts?: number;
  /** Retry backoff policy — the same Go money-path policy as engine calls. */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Refresh once the token expires within this margin (default 30_000ms). */
  refreshMarginMs?: number;
  /** Isolated breaker instance; defaults to a dedicated "keycloak-tariff-token" breaker. */
  breaker?: CircuitBreaker;
  /** Random source for jitter — injectable for deterministic tests. */
  random?: () => number;
  /** Clock — injectable for deterministic refresh tests. */
  now?: () => number;
}

const DEFAULT_TOKEN_REFRESH_MARGIN_MS = 30_000;

/**
 * OAuth2 client_credentials token provider with caching + expiry-margin
 * refresh. Resilience mirrors the engine-call policy; a token-endpoint 4xx
 * is classified TariffConfigError (definitive credential misconfiguration),
 * exhaustion is TariffUnavailableError("token_endpoint").
 */
export function createClientCredentialsTokenProvider(
  options: ClientCredentialsTokenProviderOptions
): TariffTokenProvider {
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(options.tokenUrl.trim());
  } catch {
    throw new TariffConfigError("KEYCLOAK_TOKEN_URL is not a valid URL — tariff token flow fails closed.");
  }
  if (tokenUrl.protocol !== "http:" && tokenUrl.protocol !== "https:") {
    throw new TariffConfigError(`KEYCLOAK_TOKEN_URL must be http(s), got '${tokenUrl.protocol}' — tariff token flow fails closed.`);
  }
  if (!options.clientId.trim() || !options.clientSecret.trim()) {
    throw new TariffConfigError(
      "TARIFF_SERVICE_CLIENT_ID and TARIFF_SERVICE_CLIENT_SECRET must be non-empty — tariff token flow fails closed."
    );
  }
  const endpoint = tokenUrl.toString();
  const clientId = options.clientId;
  const clientSecret = options.clientSecret;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const refreshMarginMs = options.refreshMarginMs ?? DEFAULT_TOKEN_REFRESH_MARGIN_MS;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const breaker =
    options.breaker ??
    new CircuitBreaker({
      name: "keycloak-tariff-token",
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30_000,
      windowMs: 60_000,
    });

  let cachedToken: { value: string; expiresAtMs: number } | null = null;
  let inFlight: Promise<string> | null = null;

  function backoffWithJitter(attemptIndex: number): number {
    const computed = Math.min(baseBackoffMs * 2 ** attemptIndex, maxBackoffMs);
    const half = computed / 2;
    return half + random() * half;
  }

  async function fetchToken(): Promise<string> {
    if (breaker.isOpen) {
      throw new TariffUnavailableError(
        "keycloak token circuit breaker is OPEN — refusing the token request without an upstream attempt",
        "circuit_open",
        0
      );
    }
    return withSpan(
      "keycloak.client_credentials",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          // Keep the span minimal: no credentials material of any kind.
          "server.address": tokenUrl.hostname,
          "http.request.method": "POST",
          "url.path": tokenUrl.pathname,
        },
      },
      async (span) => {
        let lastReason: TariffUnavailableReason = "network";
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, backoffWithJitter(attempt - 1)));
          }
          // The secret lives ONLY in this request body — never in spans,
          // events, logs, or error messages.
          const body = new URLSearchParams({
            grant_type: "client_credentials",
            client_id: clientId,
            client_secret: clientSecret,
          });
          let response: Response;
          try {
            response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
              body: body.toString(),
              signal: AbortSignal.timeout(timeoutMs),
              redirect: "manual",
            });
          } catch (err) {
            lastReason = isTimeoutError(err) ? "timeout" : "network";
            lastError = err;
            breaker.onFailure();
            span.addEvent("keycloak.token.attempt.failed", { attempt: attempt + 1, reason: lastReason });
            continue;
          }

          if (response.status >= 500) {
            lastReason = "upstream_5xx";
            lastError = new Error(`keycloak token endpoint answered HTTP ${response.status}`);
            breaker.onFailure();
            await response.text().catch(() => "");
            span.addEvent("keycloak.token.attempt.failed", { attempt: attempt + 1, reason: lastReason, status: response.status });
            continue;
          }

          if (response.status >= 400) {
            // 4xx is a definitive credential/config rejection: never retried.
            // Only the upstream `error` CODE is surfaced (truncated) — the
            // body could echo request material and must never leak.
            breaker.onSuccess();
            const text = await response.text().catch(() => "");
            let upstreamCode = "";
            try {
              const parsed = JSON.parse(text) as { error?: unknown };
              if (typeof parsed.error === "string") upstreamCode = parsed.error.slice(0, 120);
            } catch {
              /* no JSON body — the status alone classifies it */
            }
            throw new TariffConfigError(
              `keycloak token endpoint rejected the client credentials (HTTP ${response.status}${
                upstreamCode ? `, ${upstreamCode}` : ""
              }) — fix TARIFF_SERVICE_CLIENT_ID/TARIFF_SERVICE_CLIENT_SECRET; tariff calls fail closed.`
            );
          }

          breaker.onSuccess();
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (err) {
            throw new TariffUnavailableError(
              `keycloak token endpoint answered HTTP ${response.status} with an unparseable body`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
          const token = payload as { access_token?: unknown; expires_in?: unknown; token_type?: unknown } | null;
          if (!token || typeof token.access_token !== "string" || !token.access_token) {
            throw new TariffUnavailableError(
              "keycloak token response failed shape validation: missing access_token",
              "invalid_response",
              attempt + 1
            );
          }
          if (typeof token.token_type === "string" && token.token_type.toLowerCase() !== "bearer") {
            throw new TariffUnavailableError(
              "keycloak token response failed shape validation: token_type is not Bearer",
              "invalid_response",
              attempt + 1
            );
          }
          // expires_in is REQUIRED: without it we cannot cache safely, and
          // re-fetching per call would hammer the token endpoint. Fail closed.
          if (typeof token.expires_in !== "number" || !(token.expires_in > 0)) {
            throw new TariffUnavailableError(
              "keycloak token response failed shape validation: missing/invalid expires_in",
              "invalid_response",
              attempt + 1
            );
          }
          cachedToken = { value: token.access_token, expiresAtMs: now() + token.expires_in * 1000 };
          span.setAttribute("keycloak.token.attempts.used", attempt + 1);
          return cachedToken.value;
        }
        throw new TariffUnavailableError(
          `keycloak token endpoint unreachable after ${maxAttempts} attempt(s) (${lastReason}): ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`,
          "token_endpoint",
          maxAttempts,
          { cause: lastError }
        );
      }
    );
  }

  return {
    getToken(forceRefresh = false) {
      if (!forceRefresh && cachedToken && now() < cachedToken.expiresAtMs - refreshMarginMs) {
        return Promise.resolve(cachedToken.value);
      }
      // Single-flight: concurrent callers share one token request. A forced
      // refresh during an in-flight fetch reuses it — that fetch IS fresh.
      if (!inFlight) {
        inFlight = fetchToken().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────

export interface TariffClientOptions {
  /** Required — must be an absolute http(s) URL. */
  baseUrl: string;
  /**
   * Static bearer token presented to the engine (fallback when the Keycloak
   * client-credentials env is absent). Mutually exclusive with tokenProvider.
   */
  serviceToken?: string;
  /**
   * Keycloak client-credentials token source. When set, the bearer is
   * resolved per call (cached + refreshed by the provider) and a forced
   * single refresh is attempted if the engine answers 401.
   */
  tokenProvider?: TariffTokenProvider;
  /** Per-attempt timeout (default 5_000ms). */
  timeoutMs?: number;
  /** Total attempts per call including the initial try (default 3). */
  maxAttempts?: number;
  /** Base backoff doubled per retry, capped (defaults 200ms / 2_000ms — the Go money-path policy). */
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  /** Isolated breaker instance; defaults to a dedicated "tariff-service" breaker. */
  breaker?: CircuitBreaker;
  /** Random source for jitter — injectable for deterministic tests. */
  random?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 200;
const DEFAULT_MAX_BACKOFF_MS = 2_000;

export interface TariffClient {
  assess(
    request: TariffAssessRequest,
    opts: { idempotencyKey: string; correlationId?: string }
  ): Promise<TariffAssessment>;
  getAssessment(assessmentId: string): Promise<TariffAssessment>;
  getExemptionAudits(assessmentId: string): Promise<TariffExemptionAudit[]>;
  health(): Promise<boolean>;
  readonly baseUrl: string;
}

/** Validates and normalizes the base URL; throws TariffConfigError on garbage. */
function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new TariffConfigError(
      "TARIFF_SERVICE_URL is not configured — tariff engine calls fail closed (no phantom endpoint, no fabricated rates)."
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new TariffConfigError(`TARIFF_SERVICE_URL '${trimmed}' is not a valid URL — tariff engine calls fail closed.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TariffConfigError(`TARIFF_SERVICE_URL must be http(s), got '${url.protocol}' — tariff engine calls fail closed.`);
  }
  return url.origin;
}

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timed out"))
  );
}

export function createTariffClient(options: TariffClientOptions): TariffClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (options.serviceToken !== undefined && typeof options.serviceToken !== "string") {
    throw new TariffConfigError("TARIFF_SERVICE_TOKEN must be a string — tariff engine calls fail closed.");
  }
  const staticToken = options.serviceToken ?? "";
  const tokenProvider = options.tokenProvider ?? null;
  // Exactly one auth source — ambiguity here is a misconfiguration, and
  // guessing would be a silent behavior change.
  if (tokenProvider && staticToken) {
    throw new TariffConfigError(
      "Provide either TARIFF_SERVICE_TOKEN or the Keycloak client-credentials token provider, not both — tariff engine calls fail closed."
    );
  }
  if (!tokenProvider && !staticToken) {
    throw new TariffConfigError(
      "No tariff-engine credential configured (TARIFF_SERVICE_TOKEN unset and no Keycloak client-credentials provider) — tariff engine calls fail closed."
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  const random = options.random ?? Math.random;
  const breaker =
    options.breaker ??
    new CircuitBreaker({
      name: "tariff-service",
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30_000,
      windowMs: 60_000,
    });

  /** Equal jitter: half the computed backoff is deterministic, half is random. */
  function backoffWithJitter(attemptIndex: number): number {
    const computed = Math.min(baseBackoffMs * 2 ** attemptIndex, maxBackoffMs);
    const half = computed / 2;
    return half + random() * half;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function call<T>(
    spanName: string,
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown; idempotencyKey?: string; correlationId?: string },
    parse: (payload: unknown) => T
  ): Promise<T> {
    if (breaker.isOpen) {
      throw new TariffUnavailableError(
        `tariff-engine circuit breaker is OPEN — refusing ${method} ${path} without an upstream attempt`,
        "circuit_open",
        0
      );
    }

    return withSpan(
      spanName,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "server.address": new URL(baseUrl).hostname,
          "http.request.method": method,
          "url.path": path,
          "tariff.attempts.max": maxAttempts,
        },
      },
      async (span) => {
        // Resolve the bearer once per call (cached by the provider); token
        // fetch failures are already classified and never counted as engine
        // attempts.
        let bearer = tokenProvider ? await tokenProvider.getToken() : staticToken;
        let refreshedAfter401 = false;
        let lastReason: TariffUnavailableReason = "network";
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await sleep(backoffWithJitter(attempt - 1));
          }
          const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${bearer}`,
          };
          if (init.body !== undefined) headers["Content-Type"] = "application/json";
          if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
          if (init.correlationId) headers["X-Correlation-ID"] = init.correlationId;
          // W3C traceparent from the active OTel context (client span above).
          injectTraceContext(headers);

          let response: Response;
          try {
            response = await fetch(`${baseUrl}${path}`, {
              method,
              headers,
              body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
              signal: AbortSignal.timeout(timeoutMs),
              redirect: "manual",
            });
          } catch (err) {
            lastReason = isTimeoutError(err) ? "timeout" : "network";
            lastError = err;
            breaker.onFailure();
            span.addEvent("tariff.attempt.failed", { attempt: attempt + 1, reason: lastReason });
            continue;
          }

          if (response.status >= 500) {
            lastReason = "upstream_5xx";
            lastError = new Error(`tariff engine answered HTTP ${response.status}`);
            breaker.onFailure();
            // Drain so keep-alive sockets are reusable, then retry.
            await response.text().catch(() => "");
            span.addEvent("tariff.attempt.failed", { attempt: attempt + 1, reason: lastReason, status: response.status });
            continue;
          }

          if (response.status === 401 && tokenProvider && !refreshedAfter401) {
            // The cached token was rejected — force exactly one refresh and
            // retry (consuming an attempt slot, so this stays bounded). A
            // second 401 falls through to the definitive 4xx path.
            refreshedAfter401 = true;
            await response.text().catch(() => "");
            span.addEvent("tariff.token.refresh_after_401");
            bearer = await tokenProvider.getToken(true);
            continue;
          }

          if (response.status >= 400) {
            // 4xx is a definitive rejection: never retried, not a service failure.
            breaker.onSuccess();
            const text = await response.text().catch(() => "");
            let message = `tariff engine rejected ${method} ${path} (HTTP ${response.status})`;
            try {
              const parsed = JSON.parse(text) as { error?: string; message?: string };
              const upstream = parsed.error ?? parsed.message;
              if (upstream) message = `${message}: ${upstream}`;
            } catch {
              if (text.trim()) message = `${message}: ${text.trim().slice(0, 300)}`;
            }
            throw new TariffRejectedError(message, response.status);
          }

          breaker.onSuccess();
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (err) {
            // A 2xx we cannot parse on the money path is NOT success.
            throw new TariffUnavailableError(
              `tariff engine answered HTTP ${response.status} with an unparseable body`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
          try {
            const parsed = parse(payload);
            span.setAttribute("tariff.attempts.used", attempt + 1);
            return parsed;
          } catch (err) {
            throw new TariffUnavailableError(
              `tariff engine response failed shape validation: ${err instanceof Error ? err.message : String(err)}`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
        }
        throw new TariffUnavailableError(
          `tariff engine unreachable after ${maxAttempts} attempt(s) (${lastReason}): ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`,
          lastReason,
          maxAttempts,
          { cause: lastError }
        );
      }
    );
  }

  function parseAssessment(payload: unknown): TariffAssessment {
    const a = payload as TariffAssessment | null;
    if (!a || typeof a !== "object" || typeof a.assessmentId !== "string" || !a.assessmentId) {
      throw new Error("missing assessmentId");
    }
    if (!Array.isArray(a.lines)) throw new Error("missing lines array");
    if (typeof a.totalUsdMinor !== "number" || typeof a.totalNgnMinor !== "number") {
      throw new Error("missing minor-unit totals");
    }
    return a;
  }

  return {
    baseUrl,
    assess(request, opts) {
      if (!opts.idempotencyKey?.trim()) {
        // The engine 400s without the header; failing early keeps the
        // idempotency contract explicit at the client edge.
        return Promise.reject(
          new TariffConfigError("idempotencyKey is required for tariff assessment — the engine replays on this key")
        );
      }
      return call(
        "tariff.assess",
        "POST",
        "/v1/tariffs/assess",
        { body: request, idempotencyKey: opts.idempotencyKey, correlationId: opts.correlationId },
        parseAssessment
      );
    },
    getAssessment(assessmentId) {
      return call(
        "tariff.get_assessment",
        "GET",
        `/v1/tariffs/assessments/${encodeURIComponent(assessmentId)}`,
        {},
        parseAssessment
      );
    },
    getExemptionAudits(assessmentId) {
      return call(
        "tariff.get_exemption_audits",
        "GET",
        `/v1/tariffs/assessments/${encodeURIComponent(assessmentId)}/exemption-audits`,
        {},
        (payload) => {
          const body = payload as { audits?: TariffExemptionAudit[] } | null;
          if (!body || !Array.isArray(body.audits)) throw new Error("missing audits array");
          return body.audits;
        }
      );
    },
    async health() {
      try {
        const res = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

// ─── Lazy singleton from environment (fail closed when unset) ────────────────

let cached: { key: string; client: TariffClient } | null = null;
let warnedDevToken = false;

/**
 * Returns the environment-configured client. Throws TariffConfigError when
 * TARIFF_SERVICE_URL is unset — callers must surface that as an explicit
 * configuration failure, never silently degrade to an estimate or a zero rate.
 *
 * Auth resolution (SW-CLOSE):
 *   1. KEYCLOAK_TOKEN_URL + TARIFF_SERVICE_CLIENT_ID +
 *      TARIFF_SERVICE_CLIENT_SECRET all set → client_credentials token flow;
 *   2. a PARTIAL set → TariffConfigError naming the missing variables
 *      (fail closed — never a silent fallback to the static token);
 *   3. none set → static TARIFF_SERVICE_TOKEN (documented fallback).
 */
export function getTariffClient(): TariffClient {
  const baseUrl = ENV.tariffServiceUrl;
  const tokenUrl = ENV.keycloakTokenUrl.trim();
  const clientId = ENV.tariffServiceClientId.trim();
  const clientSecret = ENV.tariffServiceClientSecret;
  const provided = [tokenUrl.length > 0, clientId.length > 0, clientSecret.trim().length > 0].filter(Boolean).length;

  if (provided === 3) {
    const key = `${baseUrl}|client-credentials|${tokenUrl}|${clientId}`;
    if (!cached || cached.key !== key) {
      cached = {
        key,
        client: createTariffClient({
          baseUrl,
          tokenProvider: createClientCredentialsTokenProvider({ tokenUrl, clientId, clientSecret }),
        }),
      };
    }
    return cached.client;
  }

  if (provided > 0) {
    const missing = [
      tokenUrl ? null : "KEYCLOAK_TOKEN_URL",
      clientId ? null : "TARIFF_SERVICE_CLIENT_ID",
      clientSecret.trim() ? null : "TARIFF_SERVICE_CLIENT_SECRET",
    ]
      .filter((name): name is string => name !== null)
      .join(", ");
    throw new TariffConfigError(
      `Partial Keycloak client-credentials configuration (missing: ${missing}). Set ALL of ` +
      `KEYCLOAK_TOKEN_URL, TARIFF_SERVICE_CLIENT_ID, TARIFF_SERVICE_CLIENT_SECRET or NONE — ` +
      `refusing to fall back silently to a static token (fail closed).`
    );
  }

  // Static-token fallback (documented): mirror the rustfsSvcClient token
  // contract — production requires an explicit token; elsewhere a
  // clearly-labelled dev token is used so the engine's non-production
  // authenticator can record a requester subject.
  let token = ENV.tariffServiceToken;
  if (!token) {
    if (ENV.isProduction) {
      throw new TariffConfigError("TARIFF_SERVICE_TOKEN must be set in production — tariff engine calls fail closed.");
    }
    if (!warnedDevToken) {
      warnedDevToken = true;
      console.warn("[tariffClient] TARIFF_SERVICE_TOKEN not set, using dev token. DO NOT use in production.");
    }
    token = "dev-tariff-service-token";
  }
  const key = `${baseUrl}|${token}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: createTariffClient({ baseUrl, serviceToken: token }) };
  }
  return cached.client;
}
