/**
 * Trader Scorecard Router — Test Suite
 * Procedures: getScorecard, getClearancePercentile, getRejectionTrend, getBenchmark
 * Return shapes verified against actual router implementation.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getScorecard ─────────────────────────────────────────────────────────────
describe("traderScorecard.getScorecard", () => {
  it("returns scorecard with traderId, traderName, period, summary, complianceHistory, generatedAt", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getScorecard({});
    expect(result).toBeDefined();
    expect(typeof result.traderId).toBe("number");
    expect(typeof result.traderName).toBe("string");
    expect(result.period).toBe("last_12_months");
    expect(result.summary).toBeDefined();
    expect(typeof result.summary.total).toBe("number");
    expect(typeof result.summary.cleared).toBe("number");
    expect(typeof result.summary.rejected).toBe("number");
    expect(typeof result.summary.complianceScore).toBe("number");
    expect(Array.isArray(result.complianceHistory)).toBe(true);
    expect(result.generatedAt).toBeInstanceOf(Date);
  });

  it("complianceScore is between 0 and 100", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getScorecard({});
    expect(result.summary.complianceScore).toBeGreaterThanOrEqual(0);
    expect(result.summary.complianceScore).toBeLessThanOrEqual(100);
  });

  it("complianceHistory has at most 12 entries", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getScorecard({});
    expect(result.complianceHistory.length).toBeLessThanOrEqual(12);
  });

  it("admin can view scorecard for another trader by string traderId", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.traderScorecard.getScorecard({ traderId: "999999999" });
    expect(result).toBeDefined();
    expect(result.traderId).toBe(999999999);
  });

  it("customs_officer can view scorecard for another trader", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    const result = await caller.traderScorecard.getScorecard({ traderId: "1" });
    expect(result).toBeDefined();
  });

  it("aeoTier is one of none/standard/silver/gold", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getScorecard({});
    expect(["none", "standard", "silver", "gold"]).toContain(result.summary.aeoTier);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.traderScorecard.getScorecard({})).rejects.toThrow();
  });
});

// ─── getClearancePercentile ───────────────────────────────────────────────────
describe("traderScorecard.getClearancePercentile", () => {
  it("returns percentile, avgHours, populationSize, hsChapter for authenticated user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getClearancePercentile({ hsChapter: "84" });
    expect(result).toBeDefined();
    expect(typeof result.percentile).toBe("number");
    expect(typeof result.avgHours).toBe("number");
    expect(typeof result.populationSize).toBe("number");
    expect(typeof result.hsChapter).toBe("string");
  });

  it("percentile is between 0 and 100", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getClearancePercentile({});
    expect(result.percentile).toBeGreaterThanOrEqual(0);
    expect(result.percentile).toBeLessThanOrEqual(100);
  });

  it("avgHours is non-negative", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getClearancePercentile({});
    expect(result.avgHours).toBeGreaterThanOrEqual(0);
  });

  it("populationSize is non-negative", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getClearancePercentile({});
    expect(result.populationSize).toBeGreaterThanOrEqual(0);
  });

  it("hsChapter defaults to 'all' when not specified", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getClearancePercentile({});
    expect(result.hsChapter).toBe("all");
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.traderScorecard.getClearancePercentile({})).rejects.toThrow();
  });
});

// ─── getRejectionTrend ────────────────────────────────────────────────────────
describe("traderScorecard.getRejectionTrend", () => {
  it("returns { trend: [] } object for authenticated user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getRejectionTrend();
    expect(result).toBeDefined();
    expect(Array.isArray(result.trend)).toBe(true);
  });

  it("trend has at most 12 entries", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getRejectionTrend();
    expect(result.trend.length).toBeLessThanOrEqual(12);
  });

  it("each trend entry has month, rate, and delta fields", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getRejectionTrend();
    for (const entry of result.trend) {
      expect(typeof entry.month).toBe("string");
      expect(typeof entry.rate).toBe("number");
      expect(typeof entry.delta).toBe("number");
    }
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.traderScorecard.getRejectionTrend()).rejects.toThrow();
  });
});

// ─── getBenchmark ─────────────────────────────────────────────────────────────
describe("traderScorecard.getBenchmark", () => {
  it("returns a benchmark comparison object for authenticated user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getBenchmark();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("result has trader and platform fields", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.traderScorecard.getBenchmark();
    // Both can be null if no data
    expect("trader" in result).toBe(true);
    expect("platform" in result).toBe(true);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.traderScorecard.getBenchmark()).rejects.toThrow();
  });
});
