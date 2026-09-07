/**
 * Phase 16 Wave P1 — shipping-line API product tests.
 *
 * DB-free unit coverage:
 *  - Route registration (both product paths + spec documents)
 *  - Catalogue: both products present at PARTNER classification with digests
 *  - Entitlement: missing X-API-Key → 401 before any upstream call
 *  - Query validation (pure, fail-closed)
 *  - Config gating: no PORT_INTEROP_URL / ML_STACK_HTTP_URL → typed config
 *    errors → 503 (never fabricated data)
 *  - Congestion proxy error paths with a stubbed fetch (mock upstream fine
 *    in tests): OK pass-through, SCORING_UNAVAILABLE → unavailable,
 *    4xx → rejected verbatim, 5xx/network → unavailable
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import express from "express";
import { registerShippingLineApiRoutes } from "./routes/shippingLineApi";
import { buildApiCatalogue } from "./marketplace/apiCatalogue";
import {
  getCongestionForecast,
  normalizeBerthQuery,
  normalizeCongestionQuery,
  SHIPPING_LINE_OPENAPI_SPECS,
  ShippingLineConfigError,
  ShippingLineRejectedError,
  ShippingLineUnavailableError,
} from "./marketplace/shippingLineProducts";

function registeredPaths(app: express.Express): string[] {
  const stack = ((app as any)._router ?? (app as any).router)?.stack ?? [];
  const paths: string[] = [];
  for (const layer of stack) {
    if (layer.route?.path) paths.push(`${Object.keys(layer.route.methods)[0]?.toUpperCase()} ${layer.route.path}`);
  }
  return paths;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ML_STACK_HTTP_URL;
  delete process.env.ML_STACK_SERVICE_TOKEN;
});

describe("shipping-line route registration", () => {
  it("exposes both product paths and the spec document route", () => {
    const app = express();
    registerShippingLineApiRoutes(app);
    const paths = registeredPaths(app);
    expect(paths).toContain("GET /v1/shipping/berth-availability");
    expect(paths).toContain("GET /v1/shipping/congestion-forecast");
    expect(paths).toContain("GET /api/marketplace/specs/:product");
  });

  it("serves OpenAPI 3.1 spec documents for both products", () => {
    for (const product of ["berth-availability", "congestion-forecast"]) {
      const spec = SHIPPING_LINE_OPENAPI_SPECS[product];
      expect(spec.openapi).toBe("3.1.0");
      expect(Object.keys(spec.paths as object)).toHaveLength(1);
    }
  });
});

describe("catalogue entries (signed PARTNER products)", () => {
  it("registers both products at PARTNER classification with spec digests", () => {
    const catalogue = buildApiCatalogue(new Date("2026-08-31T00:00:00Z"));
    const byId = new Map(catalogue.entries.map((e) => [e.apiId, e]));
    for (const id of ["singlewindow.shipping.berth-availability", "singlewindow.shipping.congestion-forecast"]) {
      const entry = byId.get(id);
      expect(entry, id).toBeDefined();
      expect(entry!.classification).toBe("PARTNER");
      expect(entry!.specDigest).toMatch(/^[0-9a-f]{64}$/);
      expect(entry!.openapiRef).toBe(`/api/marketplace/specs/${id.split(".").pop()}`);
    }
  });
});

describe("entitlement (requireApiKey shipping:read)", () => {
  it("refuses calls without X-API-Key before touching upstreams", async () => {
    const app = express();
    registerShippingLineApiRoutes(app);
    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      for (const path of [
        "/v1/shipping/berth-availability?terminal_id=T1&from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z",
        "/v1/shipping/congestion-forecast?port_code=NGAPP",
      ]) {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        expect(res.status, path).toBe(401);
        expect((await res.json()).error).toMatch(/X-API-Key/);
      }
    } finally {
      server.close();
    }
  });
});

describe("query validation (fail-closed)", () => {
  it("accepts a bounded berth window", () => {
    const q = normalizeBerthQuery({ terminalId: "T1", from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" });
    expect(q.terminalId).toBe("T1");
  });
  it("rejects missing terminal, inverted and oversized windows", () => {
    expect(() => normalizeBerthQuery({ terminalId: "", from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" })).toThrow(ShippingLineRejectedError);
    expect(() => normalizeBerthQuery({ terminalId: "T1", from: "2026-09-02T00:00:00Z", to: "2026-09-01T00:00:00Z" })).toThrow(ShippingLineRejectedError);
    expect(() => normalizeBerthQuery({ terminalId: "T1", from: "2026-09-01T00:00:00Z", to: "2026-12-01T00:00:00Z" })).toThrow(ShippingLineRejectedError);
  });
  it("validates port_code / horizon", () => {
    expect(normalizeCongestionQuery({ portCode: "ngapp", horizonHours: 24 })).toEqual({ portCode: "NGAPP", horizonHours: 24 });
    expect(() => normalizeCongestionQuery({ portCode: "NG", horizonHours: 24 })).toThrow(ShippingLineRejectedError);
    expect(() => normalizeCongestionQuery({ portCode: "NGAPP", horizonHours: 0 })).toThrow(ShippingLineRejectedError);
    expect(() => normalizeCongestionQuery({ portCode: "NGAPP", horizonHours: 999 })).toThrow(ShippingLineRejectedError);
  });
});

describe("congestion-forecast proxy (config-gated, typed errors)", () => {
  it("fails closed with a config error when ML_STACK_HTTP_URL is unset", async () => {
    delete process.env.ML_STACK_HTTP_URL;
    await expect(getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 })).rejects.toThrow(ShippingLineConfigError);
  });

  it("passes through a real OK score", async () => {
    process.env.ML_STACK_HTTP_URL = "http://ml-stack.test";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "OK", score: 0.62, model_name: "port-congestion", model_version: "0.1.0", mode: "shadow" }), { status: 200 })
    ));
    const out = await getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 });
    expect(out.score).toBe(0.62);
    expect(out.source).toBe("blueeconomy-ml-stack");
    expect(out.modelName).toBe("port-congestion");
  });

  it("maps honest SCORING_UNAVAILABLE to ShippingLineUnavailableError", async () => {
    process.env.ML_STACK_HTTP_URL = "http://ml-stack.test";
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ status: "SCORING_UNAVAILABLE", score: null, detail: "unknown model 'port-congestion'" }), { status: 200 })
    ));
    await expect(getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 })).rejects.toThrow(ShippingLineUnavailableError);
  });

  it("maps upstream 4xx to ShippingLineRejectedError (verbatim status)", async () => {
    process.env.ML_STACK_HTTP_URL = "http://ml-stack.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 422 })));
    await expect(getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 })).rejects.toThrow(ShippingLineRejectedError);
  });

  it("maps 5xx and network failures to ShippingLineUnavailableError", async () => {
    process.env.ML_STACK_HTTP_URL = "http://ml-stack.test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    await expect(getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 })).rejects.toThrow(ShippingLineUnavailableError);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    await expect(getCongestionForecast({ portCode: "NGAPP", horizonHours: 24 })).rejects.toThrow(ShippingLineUnavailableError);
  });
});
