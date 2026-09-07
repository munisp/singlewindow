/**
 * Phase 16 Wave P2 — port performance report tests (DB-free; fixture-backed
 * source seam). Covers:
 *  - report shape vs the ministry-portal contract (period, windows, metrics);
 *  - honest null metrics when a source has no rows (no fabricated zeros);
 *  - period-over-period delta computation incl. zero/null-leg cases;
 *  - teu_out fail-closed null with the config-named source;
 *  - route registration + 400 on unknown period;
 *  - signed-PDF fail-closed without keys and JWS-EdDSA round-trip with keys.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import { generateKeyPairSync } from "crypto";
import {
  computeDeltaPct,
  computePortPerformanceReport,
  isPortPerformancePeriod,
  teuOutSourceName,
  type PortPerformanceSource,
  type WindowedAggregate,
} from "./executive/portPerformance";
import { buildSignedPortPerformancePdf } from "./executive/portPerformancePdf";
import { BriefingSigningUnavailable } from "./executive/briefing";
import { verifyPayloadJws } from "./lib/envelopeSign";
import { registerExecutiveApiRoutes } from "./routes/executiveApi";

const NOW = new Date("2026-02-15T12:00:00.000Z");

function fixtureSource(map: Record<string, WindowedAggregate>): PortPerformanceSource {
  const get = (k: string): WindowedAggregate => map[k] ?? { value: 0, rows: 0 };
  // Key convention: "<metric>:<windowStartISO>" — current window starts
  // 7d before NOW for the weekly tests below.
  return {
    cargoThroughputKg: (from) => Promise.resolve(get(`cargo:${from.toISOString()}`)),
    vesselCalls: (from) => Promise.resolve(get(`calls:${from.toISOString()}`)),
    containersIn: (from) => Promise.resolve(get(`teuIn:${from.toISOString()}`)),
    transshipmentContainers: (from) => Promise.resolve(get(`ts:${from.toISOString()}`)),
    declarationTonnageKg: (kind, from) => Promise.resolve(get(`${kind}:${from.toISOString()}`)),
  };
}

const CUR = new Date("2026-02-08T12:00:00.000Z").toISOString();  // weekly current window
const PREV = new Date("2026-02-01T12:00:00.000Z").toISOString(); // weekly previous window

describe("port performance report aggregation", () => {
  it("validates periods", () => {
    expect(isPortPerformancePeriod("weekly")).toBe(true);
    expect(isPortPerformancePeriod("monthly")).toBe(true);
    expect(isPortPerformancePeriod("quarterly")).toBe(true);
    expect(isPortPerformancePeriod("daily")).toBe(false);
    expect(isPortPerformancePeriod("")).toBe(false);
  });

  it("emits the full contract shape with real values, deltas and named sources", async () => {
    const report = await computePortPerformanceReport("weekly", {
      now: NOW,
      source: fixtureSource({
        [`cargo:${CUR}`]: { value: 2_500_000, rows: 40 },   // 2500 t
        [`cargo:${PREV}`]: { value: 2_000_000, rows: 35 },  // +25%
        [`calls:${CUR}`]: { value: 12, rows: 12 },
        [`calls:${PREV}`]: { value: 10, rows: 10 },         // +20%
        [`teuIn:${CUR}`]: { value: 640, rows: 40 },
        [`teuIn:${PREV}`]: { value: 800, rows: 50 },        // -20%
        [`ts:${CUR}`]: { value: 55, rows: 3 },
        [`ts:${PREV}`]: { value: 55, rows: 3 },             // 0%
        [`export:${CUR}`]: { value: 900_000, rows: 12 },    // 900 t
        [`export:${PREV}`]: { value: 450_000, rows: 9 },    // +100%
        [`import:${CUR}`]: { value: 1_600_000, rows: 28 },  // 1600 t
        [`import:${PREV}`]: { value: 1_600_000, rows: 28 }, // 0%
      }),
    });

    expect(report.period).toBe("weekly");
    expect(report.period_start).toBe(CUR);
    expect(report.period_end).toBe(NOW.toISOString());
    expect(typeof report.generated_at).toBe("string");

    const m = report.metrics;
    expect(Object.keys(m).sort()).toEqual([
      "cargo_throughput_tonnes", "export_tonnes", "import_tonnes",
      "teu_in", "teu_out", "transshipment_volume_teu", "vessel_calls",
    ].sort());

    expect(m.cargo_throughput_tonnes.value).toBe(2500);
    expect(m.cargo_throughput_tonnes.unit).toBe("tonnes");
    expect(m.cargo_throughput_tonnes.delta_pct).toBe(25);
    expect(m.cargo_throughput_tonnes.source).toContain("bills_of_lading");

    expect(m.vessel_calls).toMatchObject({ value: 12, delta_pct: 20, unit: "calls" });
    expect(m.vessel_calls.source).toContain("manifests");

    expect(m.teu_in).toMatchObject({ value: 640, delta_pct: -20, unit: "TEU" });
    expect(m.transshipment_volume_teu).toMatchObject({ value: 55, delta_pct: 0, unit: "TEU" });
    expect(m.export_tonnes).toMatchObject({ value: 900, delta_pct: 100, unit: "tonnes" });
    expect(m.import_tonnes).toMatchObject({ value: 1600, delta_pct: 0, unit: "tonnes" });
  });

  it("serves honest null metrics (never zeros) when a source has no rows", async () => {
    const report = await computePortPerformanceReport("monthly", {
      now: NOW,
      source: fixtureSource({}), // every source empty
    });
    expect(report.period).toBe("monthly");
    expect(report.period_start).toBe(new Date("2026-01-16T12:00:00.000Z").toISOString());
    for (const [key, metric] of Object.entries(report.metrics)) {
      expect(metric.value, key).toBeNull();
      expect(metric.delta_pct, key).toBeNull();
      expect(metric.source.length, key).toBeGreaterThan(0);
    }
  });

  it("delta is null when the previous leg is zero or empty", () => {
    expect(computeDeltaPct(100, 0)).toBeNull();
    expect(computeDeltaPct(100, null)).toBeNull();
    expect(computeDeltaPct(null, 50)).toBeNull();
    expect(computeDeltaPct(110, 100)).toBe(10);
    expect(computeDeltaPct(90, 100)).toBe(-10);
  });

  it("quarterly uses a 91-day window", async () => {
    const report = await computePortPerformanceReport("quarterly", {
      now: NOW,
      source: fixtureSource({}),
    });
    const spanMs = new Date(report.period_end).getTime() - new Date(report.period_start).getTime();
    expect(spanMs).toBe(91 * 86_400_000);
  });

  it("teu_out is fail-closed null and names the upstream config state", async () => {
    delete process.env.PORT_INTEROP_URL;
    expect(teuOutSourceName()).toContain("PORT_INTEROP_URL not configured");
    process.env.PORT_INTEROP_URL = "http://port-interop.test";
    expect(teuOutSourceName()).toContain("aggregate endpoint not available");
    delete process.env.PORT_INTEROP_URL;

    const report = await computePortPerformanceReport("weekly", { now: NOW, source: fixtureSource({}) });
    expect(report.metrics.teu_out).toMatchObject({ value: null, delta_pct: null, unit: "TEU" });
  });

  it("rejects an unknown period fail-closed", async () => {
    await expect(
      computePortPerformanceReport("fortnightly" as never, { now: NOW, source: fixtureSource({}) })
    ).rejects.toThrow(/Unknown port performance period/);
  });
});

describe("port performance routes", () => {
  it("registers the report and report.pdf contract paths", () => {
    const app = express();
    registerExecutiveApiRoutes(app);
    const stack = ((app as any)._router ?? (app as any).router)?.stack ?? [];
    const paths = stack
      .filter((l: any) => l.route?.path)
      .map((l: any) => `${Object.keys(l.route.methods)[0]?.toUpperCase()} ${l.route.path}`);
    expect(paths).toContain("GET /v1/port-performance/report");
    expect(paths).toContain("GET /v1/port-performance/report.pdf");
  });
});

describe("signed port performance PDF", () => {
  afterEach(() => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    delete process.env.MARKETPLACE_SIGNING_PUBLIC_KEY;
    delete process.env.BRIEFING_KEY_ID;
  });

  it("refuses to issue an unsigned PDF when no signing key is configured", async () => {
    delete process.env.MARKETPLACE_SIGNING_PRIVATE_KEY;
    await expect(
      buildSignedPortPerformancePdf("weekly", { now: NOW, source: fixtureSource({}) })
    ).rejects.toThrow(BriefingSigningUnavailable);
  });

  it("signs with the weekly-briefing kid convention and round-trips byte-exact", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    process.env.MARKETPLACE_SIGNING_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    process.env.MARKETPLACE_SIGNING_PUBLIC_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
    process.env.BRIEFING_KEY_ID = "3";

    const signed = await buildSignedPortPerformancePdf("weekly", {
      now: NOW,
      source: fixtureSource({
        [`cargo:${CUR}`]: { value: 1_000_000, rows: 10 },
        [`calls:${CUR}`]: { value: 5, rows: 5 },
      }),
    });

    expect(signed.algorithm).toBe("EdDSA");
    expect(signed.kid).toBe("singlewindow-3"); // same kid convention as /v1/briefings/weekly
    expect(signed.contentType).toBe("application/pdf");

    // Byte-exact PDF recovery from the base64 payload.
    const pdf = Buffer.from(signed.payload, "base64");
    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(500);

    // JWS verifies against the configured public key with the platform kid prefix.
    expect(verifyPayloadJws(signed.signature, "singlewindow-")).toBe(true);

    // JWS payload carries the envelope metadata and the same base64 PDF.
    const payloadSeg = signed.signature.split(".")[1];
    const envelope = JSON.parse(Buffer.from(payloadSeg, "base64url").toString("utf8"));
    expect(envelope.contentType).toBe("application/pdf");
    expect(envelope.period).toBe("weekly");
    expect(envelope.payload).toBe(signed.payload);
  });
});
