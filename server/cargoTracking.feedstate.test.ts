/**
 * WP-10 — fail-closed feed-state doctrine tests for cargoTracking and the
 * geo-service client: FEED_UNCONFIGURED honesty, stale badging, demo-mode
 * production lockout. Pure-function level (no DB, no network).
 */
import { describe, it, expect, afterEach } from "vitest";
import { isStale, isDemoMode, DEMO_BANNER } from "./routers/cargoTracking";
import { geoServiceConfig, GeoServiceError } from "./_core/geoServiceClient";

describe("cargoTracking staleness badging", () => {
  it("badges positions older than 15 minutes as stale", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    expect(isStale("2026-01-01T11:50:00Z", now)).toBe(false); // 10 min: fresh
    expect(isStale("2026-01-01T11:44:59Z", now)).toBe(true);  // >15 min: stale
    expect(isStale("not-a-date", now)).toBe(true);            // unparsable: stale (fail-closed)
  });
});

describe("cargoTracking demo mode lockout", () => {
  afterEach(() => {
    delete process.env.CARGO_TRACKING_DEMO;
    delete process.env.NODE_ENV;
  });

  it("is off by default", () => {
    expect(isDemoMode()).toBe(false);
  });

  it("requires the explicit flag outside production", () => {
    process.env.NODE_ENV = "development";
    expect(isDemoMode()).toBe(false);
    process.env.CARGO_TRACKING_DEMO = "true";
    expect(isDemoMode()).toBe(true);
  });

  it("can NEVER be enabled in production, even with the flag set", () => {
    process.env.NODE_ENV = "production";
    process.env.CARGO_TRACKING_DEMO = "true";
    expect(isDemoMode()).toBe(false);
  });

  it("carries an unmissable UI banner string", () => {
    expect(DEMO_BANNER).toMatch(/DEMO MODE/);
    expect(DEMO_BANNER).toMatch(/Not live AIS data/);
  });
});

describe("geoServiceClient fail-closed configuration", () => {
  afterEach(() => {
    delete process.env.GEO_SERVICE_URL;
    delete process.env.GEO_SERVICE_TOKEN;
  });

  it("reports unconfigured without env", () => {
    expect(geoServiceConfig().configured).toBe(false);
  });

  it("requires BOTH url and token", () => {
    process.env.GEO_SERVICE_URL = "https://geo.internal";
    expect(geoServiceConfig().configured).toBe(false);
    process.env.GEO_SERVICE_TOKEN = "tok";
    expect(geoServiceConfig().configured).toBe(true);
  });

  it("GeoServiceError carries the honest state code", () => {
    const err = new GeoServiceError("GEO_SERVICE_UNCONFIGURED: x", null);
    expect(err.message).toMatch(/^GEO_SERVICE_UNCONFIGURED/);
  });
});
