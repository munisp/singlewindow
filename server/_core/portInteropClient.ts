/**
 * portInteropClient.ts — typed HTTP client for blueeconomy-port-interoperability,
 * the PCS trader portal's operational substrate (Phase 8).
 *
 * Port-interop is the SYSTEM OF RECORD for port calls, eCallUp bookings,
 * slots, gate scans and billing. The PCS portal is a thin read/projection
 * layer: it consumes GET endpoints and (only when the product-gated booking
 * initiation flag is on) POST /v1/bookings. Contract anchors (read directly
 * at phase 8):
 *   GET  /v1/port-calls/{call_id}            → 200 PortCall (openapi.yaml)
 *   GET  /v1/bookings/{booking_id}           → 200 Booking (internal/server/booking.go)
 *   GET  /v1/bookings/{booking_id}/observer  → 200 ObserverState (Temporal workflow query)
 *   GET  /v1/slots?terminal_id&from&to       → 200 { slots: Slot[] }
 *   POST /v1/bookings                        → 201 Booking; idempotency is the
 *        body's request_id (8–128 canonical chars; a divergent reuse 409s).
 *        An Idempotency-Key header carrying the same value is also sent so
 *        the contract is explicit at the client edge (spec §4).
 *   GET  /healthz                            — liveness (unauthenticated)
 *
 * Edge identity: port-interop requires a validated HS256 gateway tenant token
 * (Authorization: Bearer) plus the loopback trusted-proxy headers
 * X-Trusted-Proxy / X-Authenticated-Principal (openapi.yaml securitySchemes).
 * The caller's principal (trader subject) is supplied per call — booking
 * ownership in port-interop is anchored on the verified subject, so the
 * portal NEVER asserts a principal other than the authenticated trader.
 *
 * Resilience semantics mirror server/_core/tariffClient.ts (the Go money-path
 * policy): explicit per-attempt timeout, 3 attempts total with exponential
 * backoff 200ms → 400ms → capped 2s plus equal jitter, retry ONLY on network
 * errors / timeouts / 5xx (4xx returned immediately, never retried), and the
 * platform circuit breaker (middlewareClients). One CLIENT span per call via
 * server/_core/telemetry.ts with W3C traceparent injection — no parallel
 * telemetry path.
 *
 * Fail-closed guarantees (spec §5.7, §6):
 *   - PORT_INTEROP_URL unset/invalid     → PortInteropConfigError,
 *   - unreachable after retries / breaker open → PortInteropUnavailableError
 *     (classified; the router maps this to an honest UNAVAILABLE state,
 *     NEVER fabricated rows),
 *   - 4xx → PortInteropRejectedError with the upstream message,
 *   - Keycloak client-credentials env: ALL of KEYCLOAK_TOKEN_URL /
 *     PORT_INTEROP_CLIENT_ID / PORT_INTEROP_CLIENT_SECRET → token flow;
 *     a PARTIAL set → PortInteropConfigError (never a silent fallback);
 *     none → static PORT_INTEROP_TOKEN (documented non-production fallback).
 *   - Tokens and client secrets NEVER appear in spans, events, logs, or
 *     error messages.
 */

import { SpanKind } from "@opentelemetry/api";
import { ENV } from "./env";
import { withSpan, injectTraceContext } from "./telemetry";
import { CircuitBreaker } from "./middlewareClients";
import { pcsUpstreamCallsTotal } from "./metrics";

/** Metric increments never block the business path. */
function countUpstreamCall(verb: string, code: string): void {
  try {
    pcsUpstreamCallsTotal.inc({ verb, code });
  } catch {
    /* metrics must never break a call */
  }
}

// ─── Types (mirror port-interop internal/booking/model.go + openapi.yaml) ────

export type PortCallStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";

export interface PortCall {
  call_id: string;
  vessel_imo: string;
  port_code: string;
  declaration_reference: string;
  submitted_by: string;
  status: PortCallStatus;
  created_at: string;
  updated_at: string;
  version: number;
}

export type BookingStatus =
  | "DRAFTED" | "PENDING_SYNC" | "SLOT_RESERVED" | "PAID"
  | "VALIDATION_PENDING" | "GATE_APPROVED" | "COMPLETED" | "CANCELLED"
  | "EXPIRED" | "REJECTED" | "RECONCILIATION_REQUIRED" | "REFUNDED";

export interface PortInteropBooking {
  booking_id: string;
  tenant_id: string;
  request_id: string;
  truck_plate: string;
  trucker_msisdn: string;
  terminal_id: string;
  created_by?: string;
  slot_id?: string;
  channel: "WEB" | "USSD" | "OFFLINE";
  status: BookingStatus;
  amount_kobo: number;
  currency: string;
  cargo_declaration_ref?: string;
  declared_weight_kg?: number;
  consignee_id?: string;
  operator_id?: string;
  payment_receipt_ref?: string;
  gate_id?: string;
  ledger_commit_hash?: string;
  reconciliation_reason?: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  version: number;
}

export interface PortInteropSlot {
  slot_id: string;
  terminal_id: string;
  port_code: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  reserved: number;
  created_at: string;
}

export interface PortInteropObserverState {
  booking_id: string;
  stage: string;
  receipt_ref?: string;
  scan_id?: string;
  customs_decision?: string;
  updated_at: string;
}

export interface CreateBookingRequest {
  /** 8–128 canonical chars — the port-interop idempotency key (body field). */
  request_id: string;
  truck_plate: string;
  trucker_msisdn: string;
  terminal_id: string;
  channel: "WEB" | "USSD" | "OFFLINE";
  amount_kobo: number;
  expires_at: string; // RFC3339, must be in the future
  cargo_declaration_ref?: string;
  declared_weight_kg?: number;
  consignee_id?: string;
  operator_id?: string;
}

// ─── Classified errors ───────────────────────────────────────────────────────

/** PORT_INTEROP_URL / credentials unset or malformed — fail closed. */
export class PortInteropConfigError extends Error {
  readonly kind = "config" as const;
  constructor(message: string) {
    super(message);
    this.name = "PortInteropConfigError";
  }
}

export type PortInteropUnavailableReason =
  | "circuit_open"
  | "timeout"
  | "network"
  | "upstream_5xx"
  | "invalid_response"
  /** The Keycloak token endpoint was unreachable after bounded retries. */
  | "token_endpoint";

/** Upstream unreachable after bounded retries, or breaker open. Never fabricated. */
export class PortInteropUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  readonly reason: PortInteropUnavailableReason;
  readonly attempts: number;
  constructor(message: string, reason: PortInteropUnavailableReason, attempts: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PortInteropUnavailableError";
    this.reason = reason;
    this.attempts = attempts;
  }
}

/** Port-interop rejected the request with a 4xx — verbatim, never retried. */
export class PortInteropRejectedError extends Error {
  readonly kind = "rejected" as const;
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "PortInteropRejectedError";
    this.statusCode = statusCode;
  }
}

// ─── Keycloak client-credentials token provider (mirrors tariffClient) ───────

/**
 * Supplies bearer tokens to the port-interop client. Implementations must
 * never expose the token (or the client secret) through errors, spans, logs.
 */
export interface PortInteropTokenProvider {
  getToken(forceRefresh?: boolean): Promise<string>;
}

export interface PortInteropTokenProviderOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  refreshMarginMs?: number;
  breaker?: CircuitBreaker;
  random?: () => number;
  now?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_BACKOFF_MS = 200;
const DEFAULT_MAX_BACKOFF_MS = 2_000;
const DEFAULT_TOKEN_REFRESH_MARGIN_MS = 30_000;

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timed out"))
  );
}

/**
 * OAuth2 client_credentials token provider with caching + expiry-margin
 * refresh — the same resilience discipline as engine calls; a token-endpoint
 * 4xx is classified PortInteropConfigError (definitive credential
 * misconfiguration), exhaustion is PortInteropUnavailableError("token_endpoint").
 */
export function createPortInteropTokenProvider(
  options: PortInteropTokenProviderOptions
): PortInteropTokenProvider {
  let tokenUrl: URL;
  try {
    tokenUrl = new URL(options.tokenUrl.trim());
  } catch {
    throw new PortInteropConfigError("KEYCLOAK_TOKEN_URL is not a valid URL — port-interop token flow fails closed.");
  }
  if (tokenUrl.protocol !== "http:" && tokenUrl.protocol !== "https:") {
    throw new PortInteropConfigError(`KEYCLOAK_TOKEN_URL must be http(s), got '${tokenUrl.protocol}' — port-interop token flow fails closed.`);
  }
  if (!options.clientId.trim() || !options.clientSecret.trim()) {
    throw new PortInteropConfigError(
      "PORT_INTEROP_CLIENT_ID and PORT_INTEROP_CLIENT_SECRET must be non-empty — port-interop token flow fails closed."
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
      name: "keycloak-port-interop-token",
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
      throw new PortInteropUnavailableError(
        "keycloak token circuit breaker is OPEN — refusing the token request without an upstream attempt",
        "circuit_open",
        0
      );
    }
    return withSpan(
      "keycloak.client_credentials.port_interop",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "server.address": tokenUrl.hostname,
          "http.request.method": "POST",
          "url.path": tokenUrl.pathname,
        },
      },
      async (span) => {
        let lastReason: PortInteropUnavailableReason = "network";
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
            // Only the upstream `error` CODE is surfaced (truncated).
            breaker.onSuccess();
            const text = await response.text().catch(() => "");
            let upstreamCode = "";
            try {
              const parsed = JSON.parse(text) as { error?: unknown };
              if (typeof parsed.error === "string") upstreamCode = parsed.error.slice(0, 120);
            } catch {
              /* no JSON body — the status alone classifies it */
            }
            throw new PortInteropConfigError(
              `keycloak token endpoint rejected the client credentials (HTTP ${response.status}${
                upstreamCode ? `, ${upstreamCode}` : ""
              }) — fix PORT_INTEROP_CLIENT_ID/PORT_INTEROP_CLIENT_SECRET; port-interop calls fail closed.`
            );
          }

          breaker.onSuccess();
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (err) {
            throw new PortInteropUnavailableError(
              `keycloak token endpoint answered HTTP ${response.status} with an unparseable body`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
          const token = payload as { access_token?: unknown; expires_in?: unknown; token_type?: unknown } | null;
          if (!token || typeof token.access_token !== "string" || !token.access_token) {
            throw new PortInteropUnavailableError(
              "keycloak token response failed shape validation: missing access_token",
              "invalid_response",
              attempt + 1
            );
          }
          if (typeof token.token_type === "string" && token.token_type.toLowerCase() !== "bearer") {
            throw new PortInteropUnavailableError(
              "keycloak token response failed shape validation: token_type is not Bearer",
              "invalid_response",
              attempt + 1
            );
          }
          if (typeof token.expires_in !== "number" || !(token.expires_in > 0)) {
            throw new PortInteropUnavailableError(
              "keycloak token response failed shape validation: missing/invalid expires_in",
              "invalid_response",
              attempt + 1
            );
          }
          cachedToken = { value: token.access_token, expiresAtMs: now() + token.expires_in * 1000 };
          span.setAttribute("keycloak.token.attempts.used", attempt + 1);
          return cachedToken.value;
        }
        throw new PortInteropUnavailableError(
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
      // Single-flight: concurrent callers share one token request.
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

export interface PortInteropClientOptions {
  /** Required — must be an absolute http(s) URL. */
  baseUrl: string;
  /** Static bearer token (fallback when the Keycloak env is absent). */
  serviceToken?: string;
  /** Keycloak client-credentials token source; mutually exclusive with serviceToken. */
  tokenProvider?: PortInteropTokenProvider;
  timeoutMs?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  breaker?: CircuitBreaker;
  random?: () => number;
}

export interface PortInteropCallContext {
  /**
   * The authenticated trader subject asserted in X-Authenticated-Principal.
   * Booking reads are ownership-enforced upstream against the verified token
   * subject, so this header is informational/trace context at the edge — but
   * it must still be the real caller, never a fabricated identity.
   */
  principal: string;
}

export interface PortInteropClient {
  getPortCall(callId: string, ctx: PortInteropCallContext): Promise<PortCall>;
  getBooking(bookingId: string, ctx: PortInteropCallContext): Promise<PortInteropBooking>;
  getBookingObserver(bookingId: string, ctx: PortInteropCallContext): Promise<PortInteropObserverState>;
  listSlots(query: { terminalId: string; from: string; to: string }, ctx: PortInteropCallContext): Promise<PortInteropSlot[]>;
  createBooking(request: CreateBookingRequest, ctx: PortInteropCallContext): Promise<PortInteropBooking>;
  health(): Promise<boolean>;
  readonly baseUrl: string;
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new PortInteropConfigError(
      "PORT_INTEROP_URL is not configured — port-interop calls fail closed (no phantom endpoint, no fabricated rows)."
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new PortInteropConfigError(`PORT_INTEROP_URL '${trimmed}' is not a valid URL — port-interop calls fail closed.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PortInteropConfigError(`PORT_INTEROP_URL must be http(s), got '${url.protocol}' — port-interop calls fail closed.`);
  }
  return url.origin;
}

export function createPortInteropClient(options: PortInteropClientOptions): PortInteropClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (options.serviceToken !== undefined && typeof options.serviceToken !== "string") {
    throw new PortInteropConfigError("PORT_INTEROP_TOKEN must be a string — port-interop calls fail closed.");
  }
  const staticToken = options.serviceToken ?? "";
  const tokenProvider = options.tokenProvider ?? null;
  if (tokenProvider && staticToken) {
    throw new PortInteropConfigError(
      "Provide either PORT_INTEROP_TOKEN or the Keycloak client-credentials token provider, not both — port-interop calls fail closed."
    );
  }
  if (!tokenProvider && !staticToken) {
    throw new PortInteropConfigError(
      "No port-interop credential configured (PORT_INTEROP_TOKEN unset and no Keycloak client-credentials provider) — port-interop calls fail closed."
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
      name: "port-interop",
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 30_000,
      windowMs: 60_000,
    });

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
    init: { body?: unknown; idempotencyKey?: string; principal: string },
    parse: (payload: unknown) => T
  ): Promise<T> {
    if (breaker.isOpen) {
      countUpstreamCall(spanName, "circuit_open");
      throw new PortInteropUnavailableError(
        `port-interop circuit breaker is OPEN — refusing ${method} ${path} without an upstream attempt`,
        "circuit_open",
        0
      );
    }
    if (!init.principal.trim()) {
      throw new PortInteropConfigError("X-Authenticated-Principal must name the authenticated caller — refusing to assert an empty identity.");
    }

    return withSpan(
      spanName,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "server.address": new URL(baseUrl).hostname,
          "http.request.method": method,
          "url.path": path.split("?")[0],
          "upstream": "port-interop",
          "port_interop.attempts.max": maxAttempts,
        },
      },
      async (span) => {
        let bearer = tokenProvider ? await tokenProvider.getToken() : staticToken;
        let refreshedAfter401 = false;
        let lastReason: PortInteropUnavailableReason = "network";
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          if (attempt > 0) {
            await sleep(backoffWithJitter(attempt - 1));
          }
          const headers: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${bearer}`,
            // Loopback trusted-proxy edge identity (openapi.yaml securitySchemes).
            "X-Trusted-Proxy": "loopback",
            "X-Authenticated-Principal": init.principal,
          };
          if (init.body !== undefined) headers["Content-Type"] = "application/json";
          if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;
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
            span.addEvent("port_interop.attempt.failed", { attempt: attempt + 1, reason: lastReason });
            continue;
          }

          if (response.status >= 500) {
            lastReason = "upstream_5xx";
            lastError = new Error(`port-interop answered HTTP ${response.status}`);
            breaker.onFailure();
            await response.text().catch(() => "");
            span.addEvent("port_interop.attempt.failed", { attempt: attempt + 1, reason: lastReason, status: response.status });
            continue;
          }

          if (response.status === 401 && tokenProvider && !refreshedAfter401) {
            // The cached token was rejected — force exactly one refresh and
            // retry (consuming an attempt slot, so this stays bounded).
            refreshedAfter401 = true;
            await response.text().catch(() => "");
            span.addEvent("port_interop.token.refresh_after_401");
            bearer = await tokenProvider.getToken(true);
            continue;
          }

          if (response.status >= 400) {
            // 4xx is a definitive rejection: never retried, not a service failure.
            breaker.onSuccess();
            countUpstreamCall(spanName, String(response.status));
            const text = await response.text().catch(() => "");
            let message = `port-interop rejected ${method} ${path} (HTTP ${response.status})`;
            try {
              const parsed = JSON.parse(text) as { error?: string; message?: string };
              const upstream = parsed.error ?? parsed.message;
              if (upstream) message = `${message}: ${upstream}`;
            } catch {
              if (text.trim()) message = `${message}: ${text.trim().slice(0, 300)}`;
            }
            throw new PortInteropRejectedError(message, response.status);
          }

          breaker.onSuccess();
          let payload: unknown;
          try {
            payload = await response.json();
          } catch (err) {
            throw new PortInteropUnavailableError(
              `port-interop answered HTTP ${response.status} with an unparseable body`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
          try {
            const parsed = parse(payload);
            span.setAttribute("port_interop.attempts.used", attempt + 1);
            countUpstreamCall(spanName, String(response.status));
            return parsed;
          } catch (err) {
            throw new PortInteropUnavailableError(
              `port-interop response failed shape validation: ${err instanceof Error ? err.message : String(err)}`,
              "invalid_response",
              attempt + 1,
              { cause: err }
            );
          }
        }
        countUpstreamCall(spanName, lastReason);
        throw new PortInteropUnavailableError(
          `port-interop unreachable after ${maxAttempts} attempt(s) (${lastReason}): ${
            lastError instanceof Error ? lastError.message : String(lastError)
          }`,
          lastReason,
          maxAttempts,
          { cause: lastError }
        );
      }
    );
  }

  function parsePortCall(payload: unknown): PortCall {
    const p = payload as PortCall | null;
    if (!p || typeof p !== "object" || typeof p.call_id !== "string" || !p.call_id) {
      throw new Error("missing call_id");
    }
    if (typeof p.status !== "string" || typeof p.port_code !== "string" || typeof p.version !== "number") {
      throw new Error("missing port-call status/port_code/version");
    }
    return p;
  }

  function parseBooking(payload: unknown): PortInteropBooking {
    const b = payload as PortInteropBooking | null;
    if (!b || typeof b !== "object" || typeof b.booking_id !== "string" || !b.booking_id) {
      throw new Error("missing booking_id");
    }
    if (typeof b.status !== "string" || typeof b.amount_kobo !== "number") {
      throw new Error("missing booking status/amount_kobo");
    }
    return b;
  }

  return {
    baseUrl,
    getPortCall(callId, ctx) {
      return call(
        "port_interop.get_port_call",
        "GET",
        `/v1/port-calls/${encodeURIComponent(callId)}`,
        { principal: ctx.principal },
        parsePortCall
      );
    },
    getBooking(bookingId, ctx) {
      return call(
        "port_interop.get_booking",
        "GET",
        `/v1/bookings/${encodeURIComponent(bookingId)}`,
        { principal: ctx.principal },
        parseBooking
      );
    },
    getBookingObserver(bookingId, ctx) {
      return call(
        "port_interop.get_booking_observer",
        "GET",
        `/v1/bookings/${encodeURIComponent(bookingId)}/observer`,
        { principal: ctx.principal },
        (payload) => {
          const o = payload as PortInteropObserverState | null;
          if (!o || typeof o !== "object" || typeof o.booking_id !== "string" || typeof o.stage !== "string") {
            throw new Error("missing observer booking_id/stage");
          }
          return o;
        }
      );
    },
    listSlots(query, ctx) {
      const params = new URLSearchParams({
        terminal_id: query.terminalId,
        from: query.from,
        to: query.to,
      });
      return call(
        "port_interop.list_slots",
        "GET",
        `/v1/slots?${params.toString()}`,
        { principal: ctx.principal },
        (payload) => {
          const body = payload as { slots?: PortInteropSlot[] } | null;
          if (!body || !Array.isArray(body.slots)) throw new Error("missing slots array");
          return body.slots;
        }
      );
    },
    createBooking(request, ctx) {
      // Port-interop's booking idempotency contract is the body request_id
      // (8–128 canonical chars; divergent reuse → 409). Validate at the edge
      // so the key is never implicit.
      if (
        typeof request.request_id !== "string" ||
        request.request_id.length < 8 ||
        request.request_id.length > 128 ||
        request.request_id !== request.request_id.trim()
      ) {
        return Promise.reject(
          new PortInteropConfigError("request_id must be canonical text between 8 and 128 characters — port-interop replays on this key")
        );
      }
      return call(
        "port_interop.create_booking",
        "POST",
        "/v1/bookings",
        { body: request, idempotencyKey: request.request_id, principal: ctx.principal },
        parseBooking
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

let cached: { key: string; client: PortInteropClient } | null = null;
let warnedDevToken = false;

/**
 * Returns the environment-configured client. Throws PortInteropConfigError
 * when PORT_INTEROP_URL is unset — callers must surface that as an explicit
 * configuration state, never silently degrade to fabricated rows.
 *
 * Auth resolution (mirrors tariffClient SW-CLOSE):
 *   1. KEYCLOAK_TOKEN_URL + PORT_INTEROP_CLIENT_ID +
 *      PORT_INTEROP_CLIENT_SECRET all set → client_credentials token flow;
 *   2. a PARTIAL set → PortInteropConfigError naming the missing variables;
 *   3. none set → static PORT_INTEROP_TOKEN (documented fallback).
 */
export function getPortInteropClient(): PortInteropClient {
  const baseUrl = ENV.portInteropUrl;
  const tokenUrl = ENV.keycloakTokenUrl.trim();
  const clientId = ENV.portInteropClientId.trim();
  const clientSecret = ENV.portInteropClientSecret;
  const provided = [tokenUrl.length > 0, clientId.length > 0, clientSecret.trim().length > 0].filter(Boolean).length;

  if (provided === 3) {
    const key = `${baseUrl}|client-credentials|${tokenUrl}|${clientId}`;
    if (!cached || cached.key !== key) {
      cached = {
        key,
        client: createPortInteropClient({
          baseUrl,
          tokenProvider: createPortInteropTokenProvider({ tokenUrl, clientId, clientSecret }),
        }),
      };
    }
    return cached.client;
  }

  if (provided > 0) {
    const missing = [
      tokenUrl ? null : "KEYCLOAK_TOKEN_URL",
      clientId ? null : "PORT_INTEROP_CLIENT_ID",
      clientSecret.trim() ? null : "PORT_INTEROP_CLIENT_SECRET",
    ]
      .filter((name): name is string => name !== null)
      .join(", ");
    throw new PortInteropConfigError(
      `Partial Keycloak client-credentials configuration (missing: ${missing}). Set ALL of ` +
      `KEYCLOAK_TOKEN_URL, PORT_INTEROP_CLIENT_ID, PORT_INTEROP_CLIENT_SECRET or NONE — ` +
      `refusing to fall back silently to a static token (fail closed).`
    );
  }

  let token = ENV.portInteropToken;
  if (!token) {
    if (ENV.isProduction) {
      throw new PortInteropConfigError("PORT_INTEROP_TOKEN must be set in production — port-interop calls fail closed.");
    }
    if (!warnedDevToken) {
      warnedDevToken = true;
      console.warn("[portInteropClient] PORT_INTEROP_TOKEN not set, using dev token. DO NOT use in production.");
    }
    token = "dev-port-interop-token";
  }
  const key = `${baseUrl}|${token}`;
  if (!cached || cached.key !== key) {
    cached = { key, client: createPortInteropClient({ baseUrl, serviceToken: token }) };
  }
  return cached.client;
}
