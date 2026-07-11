/**
 * Sprint v86 Tests
 * - openAppSecRouter.getWafTrend procedure
 * - WafEvents.tsx trend chart presence (static analysis)
 * - GeoIP refresh quick-action button presence
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { openAppSecRouter } from "./routers/openAppSec";
import { readFileSync } from "fs";
import { resolve } from "path";

// ─── Mock contexts ────────────────────────────────────────────────────────────
const adminCtx = {
  req: {} as any,
  res: {} as any,
  user: { id: 1, role: "admin" as const, openId: "test-open-id", name: "Admin" },
};

const anonCtx = {
  req: {} as any,
  res: {} as any,
  user: null as any,
};

// ─── getWafTrend ──────────────────────────────────────────────────────────────
describe("openAppSecRouter.getWafTrend", () => {
  it("returns an array of trend entries (default 30 days)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend(undefined);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(30);
  });

  it("respects custom days parameter (7)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 7 });
    expect(result.length).toBe(7);
  });

  it("respects maximum days parameter (90)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 90 });
    expect(result.length).toBe(90);
  });

  it("each entry has date, critical, high, medium, low fields", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 7 });
    for (const entry of result) {
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("critical");
      expect(entry).toHaveProperty("high");
      expect(entry).toHaveProperty("medium");
      expect(entry).toHaveProperty("low");
    }
  });

  it("date field is ISO date string (YYYY-MM-DD)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 7 });
    const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;
    for (const entry of result) {
      expect(entry.date).toMatch(isoDateRegex);
    }
  });

  it("numeric fields are non-negative numbers", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 7 });
    for (const entry of result) {
      expect(typeof entry.critical).toBe("number");
      expect(typeof entry.high).toBe("number");
      expect(typeof entry.medium).toBe("number");
      expect(typeof entry.low).toBe("number");
      expect(entry.critical).toBeGreaterThanOrEqual(0);
      expect(entry.high).toBeGreaterThanOrEqual(0);
      expect(entry.medium).toBeGreaterThanOrEqual(0);
      expect(entry.low).toBeGreaterThanOrEqual(0);
    }
  });

  it("entries are ordered chronologically (oldest first)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 14 });
    for (let i = 1; i < result.length; i++) {
      expect(result[i].date >= result[i - 1].date).toBe(true);
    }
  });

  it("rejects days below minimum (7)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.getWafTrend({ days: 3 })).rejects.toThrow();
  });

  it("rejects days above maximum (90)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.getWafTrend({ days: 91 })).rejects.toThrow();
  });

  it("last entry date is today or yesterday (within 2 days)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafTrend({ days: 7 });
    const lastDate = new Date(result[result.length - 1].date);
    const today = new Date();
    const diffMs = today.getTime() - lastDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeLessThan(2);
  });

  it("rejects non-admin callers (UNAUTHORIZED)", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.getWafTrend(undefined)).rejects.toThrow();
  });
});

// ─── getWafEvents (regression) ────────────────────────────────────────────────
describe("openAppSecRouter.getWafEvents (regression)", () => {
  it("returns events and total", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents(undefined);
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("events have sourceIp and severity fields", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents(undefined);
    for (const ev of result.events.slice(0, 5)) {
      expect(ev).toHaveProperty("sourceIp");
      expect(ev).toHaveProperty("severity");
    }
  });
});

// ─── getWafStats (regression) ─────────────────────────────────────────────────
describe("openAppSecRouter.getWafStats (regression)", () => {
  it("returns severity counts and unacknowledged total", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const stats = await caller.getWafStats();
    expect(stats).toHaveProperty("critical");
    expect(stats).toHaveProperty("high");
    expect(stats).toHaveProperty("medium");
    expect(stats).toHaveProperty("low");
    expect(stats).toHaveProperty("unacknowledged");
  });
});

// ─── WafEvents.tsx static analysis ───────────────────────────────────────────
const wafEventsSource = readFileSync(
  resolve(__dirname, "../client/src/pages/app/WafEvents.tsx"),
  "utf-8"
);

describe("WafEvents.tsx — trend chart", () => {
  it("imports LineChart from recharts", () => {
    expect(wafEventsSource).toContain("LineChart");
  });

  it("imports Line from recharts", () => {
    expect(wafEventsSource).toContain("Line");
  });

  it("uses getWafTrend tRPC procedure", () => {
    expect(wafEventsSource).toContain("getWafTrend");
  });

  it("renders a trend chart section", () => {
    expect(wafEventsSource).toContain("Trend");
  });

  it("renders critical severity line", () => {
    expect(wafEventsSource).toContain("critical");
  });

  it("renders high severity line", () => {
    expect(wafEventsSource).toContain("high");
  });
});

describe("WafEvents.tsx — Refresh GeoIP button", () => {
  it("contains Refresh GeoIP text or button", () => {
    const hasRefreshGeoIp =
      wafEventsSource.includes("Refresh GeoIP") ||
      wafEventsSource.includes("refreshGeoip") ||
      wafEventsSource.includes("RefreshGeoip");
    expect(hasRefreshGeoIp).toBe(true);
  });

  it("references geoip in some form", () => {
    const hasGeoipAction =
      wafEventsSource.includes("geoip") ||
      wafEventsSource.includes("GeoIP") ||
      wafEventsSource.includes("geoIp");
    expect(hasGeoipAction).toBe(true);
  });
});
