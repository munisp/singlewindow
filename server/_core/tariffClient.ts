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

export type TariffUnavailableReason = "circuit_open" | "timeout" | "network" | "upstream_5xx" | "invalid_response";

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

// ─── Client ──────────────────────────────────────────────────────────────────

export interface TariffClientOptions {
  /** Required — must be an absolute http(s) URL. */
  baseUrl: string;
  /** Bearer token presented to the engine. */
  serviceToken: string;
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
  if (typeof options.serviceToken !== "string") {
    throw new TariffConfigError("TARIFF_SERVICE_TOKEN must be a string — tariff engine calls fail closed.");
  }
  const serviceToken = options.serviceToken;
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
        let lastReason: TariffUnavailableReason = "network";
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await sleep(backoffWithJitter(attempt - 1));
          }
          const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${serviceToken}`,
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
 */
export function getTariffClient(): TariffClient {
  const baseUrl = ENV.tariffServiceUrl;
  // Mirror the rustfsSvcClient token contract: production requires an explicit
  // token; elsewhere a clearly-labelled dev token is used so the engine's
  // non-production authenticator can record a requester subject.
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
