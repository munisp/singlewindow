/**
 * Executive Dashboard Router — Test Suite
 * EXEC_ROLES = ["admin", "finance"]
 * exportRevenueCsv is a mutation requiring { startDate: Date, endDate: Date }
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
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getRevenueCounter ────────────────────────────────────────────────────────
describe("executiveDashboard.getRevenueCounter", () => {
  it("returns revenue object for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getRevenueCounter();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("returns revenue object for finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "finance" }));
    const result = await caller.executiveDashboard.getRevenueCounter();
    expect(result).toBeDefined();
  });

  it("result has todayNaira, monthNaira, yearNaira, allTimeNaira, asOf fields", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getRevenueCounter();
    expect(typeof result.todayNaira).toBe("number");
    expect(typeof result.monthNaira).toBe("number");
    expect(typeof result.yearNaira).toBe("number");
    expect(typeof result.allTimeNaira).toBe("number");
    expect(result.asOf).toBeInstanceOf(Date);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.executiveDashboard.getRevenueCounter()).rejects.toThrow();
  });

  it("throws FORBIDDEN for trader (user) role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.executiveDashboard.getRevenueCounter()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws FORBIDDEN for customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(caller.executiveDashboard.getRevenueCounter()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── getDailyCollectionVsTarget ───────────────────────────────────────────────
describe("executiveDashboard.getDailyCollectionVsTarget", () => {
  it("returns collection object with required fields for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getDailyCollectionVsTarget({
      dailyTargetNaira: 50_000_000,
    });
    expect(result).toBeDefined();
    expect(typeof result.collectedNaira).toBe("number");
    expect(typeof result.targetNaira).toBe("number");
    expect(typeof result.pct).toBe("number");
    expect(typeof result.onTrack).toBe("boolean");
    expect(result.asOf).toBeInstanceOf(Date);
  });

  it("pct is between 0 and 200 (reasonable range)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getDailyCollectionVsTarget({
      dailyTargetNaira: 1_000_000,
    });
    expect(result.pct).toBeGreaterThanOrEqual(0);
    expect(result.pct).toBeLessThanOrEqual(200);
  });

  it("targetNaira matches input dailyTargetNaira", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getDailyCollectionVsTarget({
      dailyTargetNaira: 75_000_000,
    });
    expect(result.targetNaira).toBe(75_000_000);
  });

  it("throws FORBIDDEN for non-admin/finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.executiveDashboard.getDailyCollectionVsTarget({ dailyTargetNaira: 1000 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.executiveDashboard.getDailyCollectionVsTarget({ dailyTargetNaira: 1000 })
    ).rejects.toThrow();
  });
});

// ─── getTopHsChapters ─────────────────────────────────────────────────────────
describe("executiveDashboard.getTopHsChapters", () => {
  it("returns an array for admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getTopHsChapters({});
    expect(Array.isArray(result)).toBe(true);
  });

  it("accepts optional startDate and endDate filters", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getTopHsChapters({
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("accepts optional limit filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getTopHsChapters({ limit: 5 });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("throws FORBIDDEN for non-admin/finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "oga_officer" }));
    await expect(caller.executiveDashboard.getTopHsChapters({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── getKpiSummary ────────────────────────────────────────────────────────────
describe("executiveDashboard.getKpiSummary", () => {
  it("returns a KPI object for admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.getKpiSummary();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("returns KPI object for finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "finance" }));
    const result = await caller.executiveDashboard.getKpiSummary();
    expect(result).toBeDefined();
  });

  it("throws FORBIDDEN for trader (user) role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.executiveDashboard.getKpiSummary()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ─── exportRevenueCsv ─────────────────────────────────────────────────────────
describe("executiveDashboard.exportRevenueCsv", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.executiveDashboard.exportRevenueCsv).toBe("function");
  });

  it("returns { csv, rowCount } for admin with valid date range", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.exportRevenueCsv({
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
    });
    expect(typeof result.csv).toBe("string");
    expect(typeof result.rowCount).toBe("number");
  });

  it("CSV starts with header row", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.exportRevenueCsv({
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
    });
    expect(result.csv).toMatch(/Date,HS Chapter,Corridor/);
  });

  it("rowCount is non-negative", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.executiveDashboard.exportRevenueCsv({
      startDate: new Date("2024-01-01"),
      endDate: new Date("2024-12-31"),
    });
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("throws FORBIDDEN for non-admin/finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.executiveDashboard.exportRevenueCsv({
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.executiveDashboard.exportRevenueCsv({
        startDate: new Date("2024-01-01"),
        endDate: new Date("2024-12-31"),
      })
    ).rejects.toThrow();
  });
});
