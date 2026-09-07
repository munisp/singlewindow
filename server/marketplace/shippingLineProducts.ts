/**
 * Phase 16 Wave P1 — Shipping-line API products (PARTNER tier).
 *
 * Two signed-catalogue products backed by REAL upstream services, fail-closed:
 *
 *   berth-availability
 *     Proxies blueeconomy-port-interoperability, the system of record for
 *     terminal slots (GET /v1/slots?terminal_id&from&to). Availability is
 *     derived from real slot capacity/reserved counts — never fabricated.
 *     Config-gated on PORT_INTEROP_URL (+ credentials) via the shared
 *     getPortInteropClient(); unconfigured → ShippingLineConfigError.
 *
 *   congestion-forecast
 *     Proxies blueeconomy-ml-stack predictions (POST /score/port-congestion,
 *     the ml-stack scoring contract). Config-gated on ML_STACK_HTTP_URL;
 *     when the model is not deployed upstream the honest SCORING_UNAVAILABLE
 *     contract is surfaced as ShippingLineUnavailableError — never a
 *     synthetic forecast.
 *
 * Typed errors map to honest HTTP states in routes/shippingLineApi.ts:
 *   config      → 503 SERVICE_UNAVAILABLE (operator action required)
 *   unavailable → 503 SERVICE_UNAVAILABLE (upstream down / model undeployed)
 *   rejected    → upstream 4xx status, verbatim message (never retried)
 *
 * Secrets are environment-only and never appear in errors, spans, or logs.
 */
import {
  getPortInteropClient,
  PortInteropConfigError,
  PortInteropRejectedError,
  PortInteropUnavailableError,
} from "../_core/portInteropClient";

// ─── Typed errors ────────────────────────────────────────────────────────────

/** Required upstream configuration (URL / credentials) is missing or partial. */
export class ShippingLineConfigError extends Error {
  readonly kind = "config" as const;
  constructor(message: string) {
    super(message);
    this.name = "ShippingLineConfigError";
  }
}

/** Upstream unreachable, timed out, or honestly reported itself unavailable. */
export class ShippingLineUnavailableError extends Error {
  readonly kind = "unavailable" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ShippingLineUnavailableError";
  }
}

/** Upstream rejected the request with a 4xx — verbatim, never retried. */
export class ShippingLineRejectedError extends Error {
  readonly kind = "rejected" as const;
  readonly statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ShippingLineRejectedError";
    this.statusCode = statusCode;
  }
}

// ─── berth-availability (port-interoperability slots) ───────────────────────

export interface BerthAvailabilityQuery {
  terminalId: string;
  from: string; // RFC3339
  to: string; // RFC3339
}

export interface BerthAvailabilitySlot {
  slotId: string;
  terminalId: string;
  portCode: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
  reserved: number;
  available: number;
}

export interface BerthAvailability {
  product: "berth-availability";
  terminalId: string;
  window: { from: string; to: string };
  slots: BerthAvailabilitySlot[];
  totalCapacity: number;
  totalReserved: number;
  totalAvailable: number;
  source: "blueeconomy-port-interoperability";
}

const MAX_WINDOW_MS = 31 * 86_400_000; // bounded query window

/** Validate the query window (pure, fail-closed). */
export function normalizeBerthQuery(q: BerthAvailabilityQuery): BerthAvailabilityQuery {
  const terminalId = (q.terminalId ?? "").trim();
  if (!terminalId) throw new ShippingLineRejectedError("terminal_id is required", 400);
  const from = new Date(q.from);
  const to = new Date(q.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ShippingLineRejectedError("from/to must be valid RFC3339 timestamps", 400);
  }
  if (from >= to) throw new ShippingLineRejectedError("from must precede to", 400);
  if (to.getTime() - from.getTime() > MAX_WINDOW_MS) {
    throw new ShippingLineRejectedError("query window exceeds 31 days", 400);
  }
  return { terminalId, from: from.toISOString(), to: to.toISOString() };
}

/**
 * Berth availability for a terminal over a window, projected from REAL
 * port-interoperability slot rows. Fail-closed: port-interop config or
 * transport failures surface as typed errors — never an empty "available"
 * answer presented as real.
 */
export async function getBerthAvailability(
  rawQuery: BerthAvailabilityQuery,
  principal: string
): Promise<BerthAvailability> {
  const query = normalizeBerthQuery(rawQuery);
  let client;
  try {
    client = getPortInteropClient();
  } catch (err) {
    if (err instanceof PortInteropConfigError) {
      throw new ShippingLineConfigError(`berth-availability unavailable: ${err.message}`);
    }
    throw err;
  }
  try {
    const slots = await client.listSlots(
      { terminalId: query.terminalId, from: query.from, to: query.to },
      { principal }
    );
    const projected = slots.map((s) => ({
      slotId: s.slot_id,
      terminalId: s.terminal_id,
      portCode: s.port_code,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      capacity: s.capacity,
      reserved: s.reserved,
      available: s.capacity - s.reserved,
    }));
    return {
      product: "berth-availability",
      terminalId: query.terminalId,
      window: { from: query.from, to: query.to },
      slots: projected,
      totalCapacity: projected.reduce((n, s) => n + s.capacity, 0),
      totalReserved: projected.reduce((n, s) => n + s.reserved, 0),
      totalAvailable: projected.reduce((n, s) => n + s.available, 0),
      source: "blueeconomy-port-interoperability",
    };
  } catch (err) {
    if (err instanceof PortInteropConfigError) {
      throw new ShippingLineConfigError(`berth-availability unavailable: ${err.message}`);
    }
    if (err instanceof PortInteropRejectedError) {
      throw new ShippingLineRejectedError(err.message, err.statusCode);
    }
    if (err instanceof PortInteropUnavailableError) {
      throw new ShippingLineUnavailableError(`berth-availability upstream unavailable: ${err.message}`);
    }
    throw err;
  }
}

// ─── congestion-forecast (ml-stack port-congestion model) ───────────────────

export const CONGESTION_MODEL_KEY = "port-congestion";
const ML_STACK_TIMEOUT_MS = 5_000;
const MAX_HORIZON_HOURS = 168; // 7 days

export interface CongestionForecastQuery {
  portCode: string;
  horizonHours: number;
}

export interface CongestionForecast {
  product: "congestion-forecast";
  portCode: string;
  horizonHours: number;
  score: number;
  modelName?: string;
  modelVersion?: string;
  mode?: string;
  source: "blueeconomy-ml-stack";
}

/** Validate the forecast query (pure, fail-closed). */
export function normalizeCongestionQuery(q: CongestionForecastQuery): CongestionForecastQuery {
  const portCode = (q.portCode ?? "").trim().toUpperCase();
  if (!/^[A-Z]{5}$/.test(portCode)) {
    throw new ShippingLineRejectedError("port_code must be a 5-letter UN/LOCODE", 400);
  }
  const horizonHours = Number(q.horizonHours);
  if (!Number.isFinite(horizonHours) || horizonHours < 1 || horizonHours > MAX_HORIZON_HOURS) {
    throw new ShippingLineRejectedError(`horizon_hours must be 1..${MAX_HORIZON_HOURS}`, 400);
  }
  return { portCode, horizonHours };
}

function mlStackConfigured(): string {
  // Read live env (not the import-time snapshot) so the gate reflects the
  // current deployment configuration.
  const url = (process.env.ML_STACK_HTTP_URL ?? "").trim();
  if (!url) {
    throw new ShippingLineConfigError(
      "congestion-forecast unavailable: ML_STACK_HTTP_URL is not configured — refusing to fabricate a forecast (fail closed)."
    );
  }
  return url.replace(/\/+$/, "");
}

/**
 * Congestion forecast from the ml-stack `port-congestion` scoring contract.
 * Caller-supplied port/horizon are the ONLY inputs — no synthetic features.
 * When the model is not deployed upstream, ml-stack honestly answers
 * SCORING_UNAVAILABLE, surfaced here as ShippingLineUnavailableError.
 */
export async function getCongestionForecast(
  rawQuery: CongestionForecastQuery
): Promise<CongestionForecast> {
  const query = normalizeCongestionQuery(rawQuery);
  const baseUrl = mlStackConfigured();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const serviceToken = (process.env.ML_STACK_SERVICE_TOKEN ?? "").trim();
  if (serviceToken) headers["Authorization"] = `Bearer ${serviceToken}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ML_STACK_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/score/${CONGESTION_MODEL_KEY}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        entity_id: query.portCode,
        features: [query.horizonHours],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    throw new ShippingLineUnavailableError(
      `congestion-forecast upstream ${timedOut ? "timed out" : "unreachable"}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  } finally {
    clearTimeout(timer);
  }

  if (res.status >= 400 && res.status < 500) {
    const body = (await res.text().catch(() => "")).slice(0, 300);
    throw new ShippingLineRejectedError(
      `congestion-forecast rejected by ml-stack (HTTP ${res.status}): ${body || "no detail"}`,
      res.status
    );
  }
  if (!res.ok) {
    throw new ShippingLineUnavailableError(`congestion-forecast upstream error: HTTP ${res.status}`);
  }
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!data || data.status !== "OK" || typeof data.score !== "number") {
    // Honest ml-stack contract: model undeployed / scoring unavailable.
    throw new ShippingLineUnavailableError(
      `congestion-forecast unavailable: ${typeof data?.detail === "string" ? data.detail : "SCORING_UNAVAILABLE"}`
    );
  }
  return {
    product: "congestion-forecast",
    portCode: query.portCode,
    horizonHours: query.horizonHours,
    score: data.score,
    modelName: typeof data.model_name === "string" ? data.model_name : undefined,
    modelVersion: typeof data.model_version === "string" ? data.model_version : undefined,
    mode: typeof data.mode === "string" ? data.mode : undefined,
    source: "blueeconomy-ml-stack",
  };
}

// ─── OpenAPI 3.x spec documents (served by the platform) ────────────────────

const apiKeySecurity = [{ ApiKeyHeader: [] }];
const apiKeyScheme = {
  ApiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
};
const errorResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { status: { type: "string", enum: ["down"] }, error: { type: "string" } },
        required: ["error"],
      },
    },
  },
});

export const SHIPPING_LINE_OPENAPI_SPECS: Record<string, Record<string, unknown>> = {
  "berth-availability": {
    openapi: "3.1.0",
    info: {
      title: "Berth Availability API",
      version: "1.0.0",
      description:
        "Shipping-line berth availability for a terminal over a time window. " +
        "Backed by blueeconomy-port-interoperability terminal slots (system of record). " +
        "Classification: PARTNER. Fail-closed: unconfigured or unreachable upstreams " +
        "answer 503 SERVICE_UNAVAILABLE — never fabricated availability.",
    },
    paths: {
      "/v1/shipping/berth-availability": {
        get: {
          operationId: "getBerthAvailability",
          tags: ["Shipping Lines"],
          security: apiKeySecurity,
          parameters: [
            { name: "terminal_id", in: "query", required: true, schema: { type: "string" } },
            { name: "from", in: "query", required: true, schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", required: true, schema: { type: "string", format: "date-time" } },
          ],
          responses: {
            "200": {
              description: "Berth availability projected from real slot rows.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["product", "terminalId", "window", "slots", "totalAvailable", "source"],
                    properties: {
                      product: { type: "string", enum: ["berth-availability"] },
                      terminalId: { type: "string" },
                      window: {
                        type: "object",
                        properties: { from: { type: "string" }, to: { type: "string" } },
                      },
                      slots: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            slotId: { type: "string" },
                            terminalId: { type: "string" },
                            portCode: { type: "string" },
                            startsAt: { type: "string" },
                            endsAt: { type: "string" },
                            capacity: { type: "integer" },
                            reserved: { type: "integer" },
                            available: { type: "integer" },
                          },
                        },
                      },
                      totalCapacity: { type: "integer" },
                      totalReserved: { type: "integer" },
                      totalAvailable: { type: "integer" },
                      source: { type: "string", enum: ["blueeconomy-port-interoperability"] },
                    },
                  },
                },
              },
            },
            "400": errorResponse("Invalid query window."),
            "401": errorResponse("Missing/invalid API key."),
            "403": errorResponse("Key lacks the shipping:read scope or sandbox routing refused."),
            "429": errorResponse("Rate limit exceeded for this API key."),
            "503": errorResponse("Upstream unconfigured or unavailable (fail-closed)."),
          },
        },
      },
    },
    components: { securitySchemes: apiKeyScheme },
  },
  "congestion-forecast": {
    openapi: "3.1.0",
    info: {
      title: "Port Congestion Forecast API",
      version: "1.0.0",
      description:
        "Shipping-line port congestion forecast from the blueeconomy-ml-stack " +
        "port-congestion model. Classification: PARTNER. Fail-closed: when the model " +
        "is undeployed or the stack is unreachable, answers 503 SERVICE_UNAVAILABLE — " +
        "never a synthetic forecast.",
    },
    paths: {
      "/v1/shipping/congestion-forecast": {
        get: {
          operationId: "getCongestionForecast",
          tags: ["Shipping Lines"],
          security: apiKeySecurity,
          parameters: [
            { name: "port_code", in: "query", required: true, schema: { type: "string", pattern: "^[A-Za-z]{5}$" } },
            { name: "horizon_hours", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 168, default: 24 } },
          ],
          responses: {
            "200": {
              description: "Congestion forecast from the deployed model.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["product", "portCode", "horizonHours", "score", "source"],
                    properties: {
                      product: { type: "string", enum: ["congestion-forecast"] },
                      portCode: { type: "string" },
                      horizonHours: { type: "integer" },
                      score: { type: "number" },
                      modelName: { type: "string" },
                      modelVersion: { type: "string" },
                      mode: { type: "string" },
                      source: { type: "string", enum: ["blueeconomy-ml-stack"] },
                    },
                  },
                },
              },
            },
            "400": errorResponse("Invalid port_code/horizon."),
            "401": errorResponse("Missing/invalid API key."),
            "403": errorResponse("Key lacks the shipping:read scope or sandbox routing refused."),
            "429": errorResponse("Rate limit exceeded for this API key."),
            "503": errorResponse("Upstream unconfigured or model unavailable (fail-closed)."),
          },
        },
      },
    },
    components: { securitySchemes: apiKeyScheme },
  },
};
