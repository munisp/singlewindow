/**
 * Phase-7 OTel — Node monolith unit tests.
 *
 * Gates covered:
 *   1. Telemetry-disabled boot: importing the bootstrap with
 *      OTEL_EXPORTER_OTLP_ENDPOINT unset must not throw and must leave
 *      telemetry disabled (the sanctioned fail-open).
 *   2. Propagation round-trip: W3C traceparent injected into a kafkajs-style
 *      header carrier on produce is extracted back to the same span context.
 *   3. Baggage → attribute middleware: tenant.id + agency from edge
 *      headers/JWT claims become baggage, then span attributes.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  context,
  propagation,
  trace,
  type Span,
} from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core";

// The @opentelemetry/api globals are no-op until a provider is registered
// (in production the NodeSDK registers both). Tests register them directly so
// carrier inject/extract and baggage semantics can be exercised without
// starting an exporter.
context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
propagation.setGlobalPropagator(
  new CompositePropagator({
    propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
  })
);

const ORIGINAL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

beforeEach(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
});

afterAll(() => {
  if (ORIGINAL_ENDPOINT === undefined) delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  else process.env.OTEL_EXPORTER_OTLP_ENDPOINT = ORIGINAL_ENDPOINT;
});

describe("telemetry-disabled boot (fail-open)", () => {
  it("imports the bootstrap without OTEL_EXPORTER_OTLP_ENDPOINT and does not throw", async () => {
    await expect(import("./_core/telemetryBootstrap")).resolves.toBeDefined();
    const { isTelemetryEnabled } = await import("./_core/telemetry");
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("initTelemetry is a no-op when disabled and withSpan still executes fn", async () => {
    const { initTelemetry, withSpan, isTelemetryEnabled } = await import("./_core/telemetry");
    expect(() => initTelemetry()).not.toThrow();
    expect(isTelemetryEnabled()).toBe(false);
    const ran = withSpan("boot.disabled", {}, () => 42);
    expect(ran).toBe(42);
    await expect(withSpan("boot.disabled.async", {}, async () => "ok")).resolves.toBe("ok");
  });

  it("withSpan records errors without leaking them when disabled", async () => {
    const { withSpan } = await import("./_core/telemetry");
    await expect(
      withSpan("boot.err", {}, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
  });
});

describe("kafka carrier propagation round-trip", () => {
  it("injects traceparent on produce and extracts the same context on consume", async () => {
    const { injectKafkaHeaders, extractKafkaContext } = await import("./_core/telemetry");

    const spanContext = {
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      traceFlags: 1,
    };
    const parentCtx = trace.setSpanContext(context.active(), spanContext);

    const headers: Record<string, string> = {};
    context.with(parentCtx, () => injectKafkaHeaders(headers));

    expect(headers["traceparent"]).toBe(
      `00-${spanContext.traceId}-${spanContext.spanId}-01`
    );

    const extracted = extractKafkaContext(headers);
    const remote = trace.getSpanContext(extracted);
    expect(remote?.traceId).toBe(spanContext.traceId);
    expect(remote?.spanId).toBe(spanContext.spanId);
    expect(remote?.isRemote).toBe(true);
  });

  it("tolerates kafkajs Buffer header values and missing headers", async () => {
    const { extractKafkaContext } = await import("./_core/telemetry");
    const ctx = extractKafkaContext({
      traceparent: Buffer.from("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"),
    });
    expect(trace.getSpanContext(ctx)?.traceId).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(() => extractKafkaContext(undefined)).not.toThrow();
  });

  it("baggage rides the same carrier", async () => {
    const { injectKafkaHeaders, extractKafkaContext } = await import("./_core/telemetry");
    let bag = propagation.createBaggage();
    bag = bag.setEntry("tenant.id", { value: "tenant-7" });
    const ctx = propagation.setBaggage(context.active(), bag);
    const headers: Record<string, string> = {};
    context.with(ctx, () => injectKafkaHeaders(headers));
    expect(headers["baggage"]).toContain("tenant.id=tenant-7");
    const extracted = extractKafkaContext(headers);
    expect(propagation.getBaggage(extracted)?.getEntry("tenant.id")?.value).toBe("tenant-7");
  });
});

describe("tenant baggage middleware → span attributes", () => {
  function fakeRes() {
    return { setHeader: () => {} };
  }

  it("sets tenant.id/agency baggage from edge headers and applies them to spans", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const { tenantBaggageMiddleware, applyTenantBaggage } = await import("./_core/telemetry");

    const req = { headers: { "x-tenant-id": "tenant-42", "x-agency": "NIMASA" } };
    let observed: Record<string, unknown> = {};
    await new Promise<void>((resolve) => {
      tenantBaggageMiddleware(req, fakeRes(), () => {
        const bag = propagation.getBaggage(context.active());
        expect(bag?.getEntry("tenant.id")?.value).toBe("tenant-42");
        expect(bag?.getEntry("agency")?.value).toBe("NIMASA");
        const fakeSpan: Pick<Span, "setAttribute"> = {
          setAttribute: (k: string, v: unknown) => {
            observed[k] = v;
            return fakeSpan as Span;
          },
        };
        applyTenantBaggage(fakeSpan as Span);
        resolve();
      });
    });
    expect(observed["tenant.id"]).toBe("tenant-42");
    expect(observed["agency"]).toBe("NIMASA");
  });

  it("extracts tenant claims from an (unverified, telemetry-only) JWT", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const { tenantBaggageMiddleware } = await import("./_core/telemetry");

    const payload = Buffer.from(
      JSON.stringify({ sub: "u1", tenant_id: "tenant-9", agency: "NPA" })
    ).toString("base64url");
    const jwt = `h.${payload}.s`;
    const req = { headers: { authorization: `Bearer ${jwt}` } };
    await new Promise<void>((resolve) => {
      tenantBaggageMiddleware(req, fakeRes(), () => {
        const bag = propagation.getBaggage(context.active());
        expect(bag?.getEntry("tenant.id")?.value).toBe("tenant-9");
        expect(bag?.getEntry("agency")?.value).toBe("NPA");
        resolve();
      });
    });
  });

  it("passes through cleanly with no claims and never blocks the request", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    const { tenantBaggageMiddleware } = await import("./_core/telemetry");
    let called = false;
    tenantBaggageMiddleware({ headers: {} }, fakeRes(), () => {
      called = true;
    });
    expect(called).toBe(true);
    expect(propagation.getBaggage(context.active())).toBeUndefined();
  });

  it("is a pass-through when telemetry is disabled", async () => {
    const { tenantBaggageMiddleware } = await import("./_core/telemetry");
    let called = false;
    tenantBaggageMiddleware(
      { headers: { "x-tenant-id": "t", "x-agency": "a" } },
      fakeRes(),
      () => {
        called = true;
        // No baggage installed when disabled
        expect(propagation.getBaggage(context.active())).toBeUndefined();
      }
    );
    expect(called).toBe(true);
  });
});
