/**
 * telemetry.ts — OpenTelemetry instrumentation core for the TradeGateway monolith.
 *
 * Contract (Phase-7 OTEL_DESIGN.md §1/§2):
 *   - SDK start is GUARDED by OTEL_EXPORTER_OTLP_ENDPOINT. Unset ⇒ telemetry is
 *     fully disabled and MUST NOT break boot or any request. This is the ONE
 *     sanctioned fail-open in the platform.
 *   - When set: OTLP/HTTP exporter + BatchSpanProcessor (non-blocking); a down
 *     collector means spans are dropped by the batcher — never a request failure.
 *   - W3C tracecontext + baggage propagation; Kafka carriers are manual
 *     (traceparent injected on produce, extracted on consume).
 *   - Tenant attribution: tenant.id + agency via baggage at the request edge,
 *     copied onto server spans as attributes. Metrics stay low-cardinality
 *     (no tenant labels on metrics).
 *
 * Design notes:
 *   - Only @opentelemetry/api is imported statically (it is side-effect-free and
 *     defaults to no-op providers). The SDK + auto-instrumentations are loaded
 *     synchronously via createRequire ONLY when the endpoint is configured, and
 *     ONLY from telemetryBootstrap.ts, which is imported before any
 *     instrumented module (express/pg/ioredis/kafkajs) in server/_core/index.ts
 *     so require-in-the-middle hooks can patch them.
 *   - Every helper in this file is safe to call with telemetry disabled — spans
 *     become non-recording no-op spans via the API's default NoopTracerProvider.
 */
import { createRequire } from "module";
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Link,
  type Span,
  type SpanOptions,
  type Tracer,
} from "@opentelemetry/api";

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? "tradegateway-monolith";

let sdkStarted = false;

export function isTelemetryEnabled(): boolean {
  return !!process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
}

/**
 * Starts the OpenTelemetry NodeSDK when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 * Fail-open by design: any init error logs a warning and leaves telemetry off.
 * Idempotent.
 */
export function initTelemetry(): void {
  if (sdkStarted) return;
  sdkStarted = true;
  if (!isTelemetryEnabled()) return;
  try {
    const req = createRequire(import.meta.url);
    const { NodeSDK } = req("@opentelemetry/sdk-node");
    const { getNodeAutoInstrumentations } = req("@opentelemetry/auto-instrumentations-node");
    const { OTLPTraceExporter } = req("@opentelemetry/exporter-trace-otlp-http");
    const { OTLPMetricExporter } = req("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = req("@opentelemetry/sdk-metrics");
    const { resourceFromAttributes } = req("@opentelemetry/resources");
    const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = req("@opentelemetry/semantic-conventions");

    const sdk = new NodeSDK({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: process.env.APP_VERSION ?? "1.0.0",
        "deployment.environment": process.env.NODE_ENV ?? "development",
      }),
      // BatchSpanProcessor is the NodeSDK default for traceExporter —
      // async/batched, non-blocking. Collector-down = drop, never request failure.
      traceExporter: new OTLPTraceExporter(),
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: 30_000,
        }),
      ],
      instrumentations: [
        getNodeAutoInstrumentations({
          // fs is pathological noise on a vite/tsx dev server.
          "@opentelemetry/instrumentation-fs": { enabled: false },
          // http/express/pg/ioredis/kafkajs/undici are enabled by default.
        }),
      ],
    });
    sdk.start();
    const shutdown = () => sdk.shutdown().catch(() => {});
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    console.log(
      `[OTel] SDK started for ${SERVICE_NAME} → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT} (OTLP/HTTP, batch)`
    );
  } catch (err) {
    console.warn(
      "[OTel] SDK initialization failed — telemetry disabled, business path unaffected (sanctioned fail-open):",
      err instanceof Error ? err.message : err
    );
  }
}

export function getTracer(name = SERVICE_NAME): Tracer {
  return trace.getTracer(name);
}

// ─── Tenant attribution (baggage → span attributes) ──────────────────────────

export const BAGGAGE_TENANT_ID = "tenant.id";
export const BAGGAGE_AGENCY = "agency";

/** Copies tenant.id / agency from the active baggage onto a span as attributes. */
export function applyTenantBaggage(span: Span): void {
  try {
    const bag = propagation.getBaggage(context.active());
    if (!bag) return;
    const tenantId = bag.getEntry(BAGGAGE_TENANT_ID)?.value;
    const agency = bag.getEntry(BAGGAGE_AGENCY)?.value;
    if (tenantId) span.setAttribute(BAGGAGE_TENANT_ID, tenantId);
    if (agency) span.setAttribute(BAGGAGE_AGENCY, agency);
  } catch {
    // Telemetry must never break the request path.
  }
}

/** Runs fn with tenant.id/agency baggage entries set on the active context. */
export function runWithTenantBaggage<T>(
  tenantId: string | undefined,
  agency: string | undefined,
  fn: () => T
): T {
  let bag = propagation.getBaggage(context.active()) ?? propagation.createBaggage();
  if (tenantId) bag = bag.setEntry(BAGGAGE_TENANT_ID, { value: tenantId });
  if (agency) bag = bag.setEntry(BAGGAGE_AGENCY, { value: agency });
  return context.with(propagation.setBaggage(context.active(), bag), fn);
}

/**
 * Decodes (WITHOUT verifying) the payload of a JWT. Telemetry-only usage:
 * claims are never used for authz — verification happens in sdk.authenticateRequest.
 */
function decodeJwtPayloadUnverified(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(part, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

/**
 * Express middleware — request-edge tenant attribution.
 * Precedence: verified-proxy headers (x-tenant-id/x-agency, set by APISIX/oauth2-proxy)
 * → unverified JWT claims (tenant_id/agency; telemetry-only) → incoming baggage
 * header (already handled by the propagator). Never blocks the request.
 */
export function tenantBaggageMiddleware(req: any, _res: any, next: () => void): void {
  if (!isTelemetryEnabled()) return next();
  try {
    let tenantId = req.headers?.["x-tenant-id"] as string | undefined;
    let agency = req.headers?.["x-agency"] as string | undefined;
    const auth = req.headers?.authorization as string | undefined;
    if ((!tenantId || !agency) && auth?.startsWith("Bearer ")) {
      const claims = decodeJwtPayloadUnverified(auth.slice("Bearer ".length));
      if (claims) {
        tenantId ??= (claims.tenant_id ?? claims.tenantId) as string | undefined;
        agency ??= claims.agency as string | undefined;
      }
    }
    if (!tenantId && !agency) return next();
    return runWithTenantBaggage(tenantId, agency, () => next());
  } catch {
    return next();
  }
}

// ─── Span helpers ─────────────────────────────────────────────────────────────

export interface WithSpanOptions extends SpanOptions {
  attributes?: Attributes;
}

function endSpanWithError(span: Span, err: unknown): void {
  try {
    if (err instanceof Error) span.recordException(err);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
  } catch {
    // ignore
  }
}

/**
 * Runs fn inside a span; records errors and always ends the span.
 * Safe with telemetry disabled (no-op non-recording span).
 * Works for both async and sync fn.
 */
export function withSpan<T>(
  name: string,
  opts: WithSpanOptions,
  fn: (span: Span) => T
): T {
  const tracer = getTracer();
  const span = tracer.startSpan(name, opts);
  applyTenantBaggage(span);
  const run = (): T => {
    try {
      const result = fn(span);
      if (result && typeof (result as any).then === "function") {
        return (result as any).then(
          (v: unknown) => {
            span.end();
            return v;
          },
          (err: unknown) => {
            endSpanWithError(span, err);
            span.end();
            throw err;
          }
        ) as T;
      }
      span.end();
      return result;
    } catch (err) {
      endSpanWithError(span, err);
      span.end();
      throw err;
    }
  }
  return context.with(trace.setSpan(context.active(), span), run);
}

// ─── Kafka carriers (manual W3C traceparent inject/extract) ──────────────────

const kafkaHeaderSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key] = value;
  },
};

const kafkaHeaderGetter = {
  keys(carrier: Record<string, unknown>): string[] {
    return Object.keys(carrier);
  },
  get(carrier: Record<string, unknown>, key: string): string | undefined {
    const v = carrier[key];
    if (typeof v === "string") return v;
    if (v instanceof Buffer) return v.toString("utf8");
    if (Array.isArray(v)) {
      const first = v[0];
      return first instanceof Buffer ? first.toString("utf8") : (first as string | undefined);
    }
    return undefined;
  },
};

/**
 * Injects W3C traceparent/tracestate/baggage from the active context into
 * outbound HTTP headers (same carrier semantics as injectKafkaHeaders, named
 * for HTTP call sites — e.g. the PRA-100 tariff-engine client). Never throws.
 */
export function injectTraceContext(headers: Record<string, string>): void {
  try {
    propagation.inject(context.active(), headers, kafkaHeaderSetter);
  } catch {
    // never break the outbound request path
  }
}

/** Injects traceparent/tracestate/baggage from the active context into Kafka headers. */
export function injectKafkaHeaders(headers: Record<string, string>): void {
  try {
    propagation.inject(context.active(), headers, kafkaHeaderSetter);
  } catch {
    // never break produce path
  }
}

/** Extracts a remote context from Kafka message headers (kafkajs header shape). */
export function extractKafkaContext(headers: Record<string, unknown> | undefined): Context {
  if (!headers) return context.active();
  try {
    return propagation.extract(context.active(), headers, kafkaHeaderGetter);
  } catch {
    return context.active();
  }
}

// ─── Mojaloop FSPIOP correlation ─────────────────────────────────────────────

/**
 * Builds span links from an FSPIOP traceparent header (when the hub propagates
 * W3C context) so quote/transfer/fulfil spans join the hub-side trace.
 * The FSPIOP correlation ID itself is recorded as an attribute by callers
 * (it is not a span context and cannot be a link).
 */
export function fspiopLinksFromHeaders(headers: Record<string, unknown> | undefined): Link[] {
  if (!headers) return [];
  try {
    const ctx = extractKafkaContext(headers); // same getter semantics for HTTP headers
    const remote = trace.getSpanContext(ctx);
    if (remote && trace.isSpanContextValid(remote)) {
      return [{ context: remote }];
    }
  } catch {
    // ignore
  }
  return [];
}
