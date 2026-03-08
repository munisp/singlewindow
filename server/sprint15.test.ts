/**
 * Sprint 15 Tests
 *
 * Tests for:
 *   - userNotifications router (getUnreadCount, getMyNotifications, markAllRead)
 *   - slaEscalation router (list, stats, scan access control)
 *   - bulkExport router (exportDeclarations, previewCount access control)
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Context Helpers ─────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<TrpcContext["user"]> = {}): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "trader@example.com",
      name: "Test Trader",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
      ...overrides,
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function makeAdminCtx(): TrpcContext {
  return makeCtx({ id: 99, role: "admin", email: "admin@example.com", name: "Admin User" });
}

function makeOfficerCtx(): TrpcContext {
  return makeCtx({ id: 88, role: "customs_officer", email: "officer@example.com", name: "Officer" });
}

// ─── userNotifications ────────────────────────────────────────────────────────

describe("userNotifications.getUnreadCount", () => {
  it("returns a count object for authenticated users", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.userNotifications.getUnreadCount();
    expect(result).toHaveProperty("count");
    expect(typeof result.count).toBe("number");
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it("returns count for admin users", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.userNotifications.getUnreadCount();
    expect(result).toHaveProperty("count");
  });
});

describe("userNotifications.getMyNotifications", () => {
  it("returns paginated notifications with correct shape", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.userNotifications.getMyNotifications({
      limit: 10,
      offset: 0,
      unreadOnly: false,
    });
    expect(Array.isArray(result)).toBe(true);
  });

  it("accepts unreadOnly filter", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.userNotifications.getMyNotifications({
      limit: 5,
      offset: 0,
      unreadOnly: true,
    });
    expect(Array.isArray(result)).toBe(true);
    // All returned items should be unread
    result.forEach((n: any) => {
      expect(n.isRead).toBe(false);
    });
  });

  it("respects limit parameter", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.userNotifications.getMyNotifications({
      limit: 3,
      offset: 0,
      unreadOnly: false,
    });
    expect(result.length).toBeLessThanOrEqual(3);
  });
});

describe("userNotifications.markAllRead", () => {
  it("returns updated count", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.userNotifications.markAllRead();
    expect(result).toHaveProperty("updated");
    expect(typeof result.updated).toBe("number");
  });
});

// ─── slaEscalation ────────────────────────────────────────────────────────────

describe("slaEscalation.stats", () => {
  it("is accessible to admins", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.slaEscalation.stats();
    expect(result).toHaveProperty("totalInProcessing");
    expect(result).toHaveProperty("totalBreaches");
    expect(result).toHaveProperty("criticalBreaches");
    expect(result).toHaveProperty("warningBreaches");
    expect(result).toHaveProperty("byLane");
    expect(result).toHaveProperty("generatedAt");
  });

  it("is accessible to customs officers", async () => {
    const caller = appRouter.createCaller(makeOfficerCtx());
    const result = await caller.slaEscalation.stats();
    expect(result).toHaveProperty("totalInProcessing");
  });

  it("is forbidden for regular traders", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.slaEscalation.stats()).rejects.toThrow();
  });
});

describe("slaEscalation.list", () => {
  it("returns breach list with correct shape for admins", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.slaEscalation.list({
      severity: "all",
      lane: "all",
      limit: 10,
    });
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("critical");
    expect(result).toHaveProperty("warning");
    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("filters by severity", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.slaEscalation.list({
      severity: "critical",
      lane: "all",
      limit: 50,
    });
    result.items.forEach((item: any) => {
      expect(item.breachSeverity).toBe("critical");
    });
  });

  it("filters by lane", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.slaEscalation.list({
      severity: "all",
      lane: "green",
      limit: 50,
    });
    result.items.forEach((item: any) => {
      expect(item.riskLane).toBe("green");
    });
  });

  it("is forbidden for regular traders", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.slaEscalation.list({ severity: "all", lane: "all", limit: 10 })
    ).rejects.toThrow();
  });
});

describe("slaEscalation.scan", () => {
  it("dry run returns breach summary without creating notifications", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.slaEscalation.scan({
      notifyTraders: false,
      dryRun: true,
    });
    expect(result).toHaveProperty("scanned");
    expect(result).toHaveProperty("breachCount");
    expect(result).toHaveProperty("criticalCount");
    expect(result).toHaveProperty("warningCount");
    expect(result).toHaveProperty("notificationsSent");
    expect(result.dryRun).toBe(true);
    expect(result.notificationsSent).toBe(0); // dry run → no notifications
  });

  it("is forbidden for regular traders", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.slaEscalation.scan({ notifyTraders: false, dryRun: true })
    ).rejects.toThrow();
  });
});

// ─── bulkExport ───────────────────────────────────────────────────────────────

describe("bulkExport.previewCount", () => {
  it("returns a count for the current trader", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bulkExport.previewCount({
      status: "all",
      riskLane: "all",
    });
    expect(result).toHaveProperty("count");
    expect(typeof result.count).toBe("number");
    expect(result.count).toBeGreaterThanOrEqual(0);
  });

  it("returns a count for admins across all traders", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.bulkExport.previewCount({
      status: "all",
      riskLane: "all",
    });
    expect(result).toHaveProperty("count");
  });

  it("filters by status correctly", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const allResult = await caller.bulkExport.previewCount({ status: "all", riskLane: "all" });
    const clearedResult = await caller.bulkExport.previewCount({ status: "cleared", riskLane: "all" });
    // Cleared count should be <= total count
    expect(clearedResult.count).toBeLessThanOrEqual(allResult.count);
  });
});

describe("bulkExport.exportDeclarations", () => {
  it("returns a CSV export with base64 content", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bulkExport.exportDeclarations({
      format: "csv",
      status: "all",
      riskLane: "all",
      limit: 10,
    });
    expect(result.format).toBe("csv");
    expect(result.filename).toMatch(/\.csv$/);
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result).toHaveProperty("rowCount");
    // Verify it's valid base64
    expect(() => atob(result.content)).not.toThrow();
    // Verify decoded CSV has header row
    const decoded = atob(result.content);
    expect(decoded).toContain("declarationNumber");
  });

  it("returns a JSON export with base64 content", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.bulkExport.exportDeclarations({
      format: "json",
      status: "all",
      riskLane: "all",
      limit: 10,
    });
    expect(result.format).toBe("json");
    expect(result.filename).toMatch(/\.json$/);
    // Verify it's valid base64-encoded JSON
    const decoded = atob(result.content);
    expect(() => JSON.parse(decoded)).not.toThrow();
    const parsed = JSON.parse(decoded);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("prevents traders from exporting other traders' data", async () => {
    const caller = appRouter.createCaller(makeCtx({ id: 1 }));
    await expect(
      caller.bulkExport.exportDeclarations({
        format: "csv",
        status: "all",
        riskLane: "all",
        traderId: 999, // different trader
        limit: 10,
      })
    ).rejects.toThrow();
  });

  it("allows admins to export all declarations", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.bulkExport.exportDeclarations({
      format: "csv",
      status: "all",
      riskLane: "all",
      limit: 100,
    });
    expect(result.format).toBe("csv");
    expect(result.rowCount).toBeGreaterThanOrEqual(0);
  });

  it("respects the limit parameter", async () => {
    const caller = appRouter.createCaller(makeAdminCtx());
    const result = await caller.bulkExport.exportDeclarations({
      format: "csv",
      status: "all",
      riskLane: "all",
      limit: 5,
    });
    expect(result.rowCount).toBeLessThanOrEqual(5);
  });
});
