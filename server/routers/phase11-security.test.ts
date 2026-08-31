/**
 * phase11-security.test.ts — Phase-11 security hardening regression tests
 *
 * SW-S11-1: ledger account reads are authorization-scoped (IDOR fix) — traders
 *           may only read their own `trader-<id>-*` accounts; platform revenue
 *           accounts and other traders' accounts are forbidden.
 * SW-S11-2: /api/scheduled/* endpoints require Bearer SCHEDULER_SECRET and
 *           fail closed (503) in production when the secret is unconfigured.
 * SW-S11-5: finance mobile-alias procedures (summary, transactions, duties,
 *           clusterSummary) enforce the finance/admin role check like every
 *           other finance procedure.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.TB_BRIDGE_SHARED_SECRET = "test-tb-bridge-shared-secret";
});

vi.mock("../db", () => ({
  // finance router
  getFinanceKPIs: vi.fn(async () => ({ totalRevenue: 1, pendingAmount: 0, pendingCount: 0, confirmedCount: 1, failedCount: 0, dutyRevenue: 1, vatRevenue: 0, levyRevenue: 0, overdueCount: 0 })),
  getRevenueByHsChapter: vi.fn(async () => []),
  getRevenueByCountry: vi.fn(async () => []),
  getPaymentTrend: vi.fn(async () => []),
  getRevenueByDeclarationType: vi.fn(async () => []),
  getPortRevenueBreakdown: vi.fn(async () => []),
  getPendingPaymentsList: vi.fn(async () => []),
  getRiskLaneRevenueBreakdown: vi.fn(async () => []),
  getAllPayments: vi.fn(async () => []),
  getPool: vi.fn(() => null),
  // ledger router
  getLedgerEntriesByDeclaration: vi.fn(async () => []),
  getLedgerEntriesByPayment: vi.fn(async () => []),
  getRecentLedgerEntries: vi.fn(async () => []),
  createLedgerEntry: vi.fn(async (e: Record<string, unknown>) => e),
}));

vi.mock("../_core/kafka", () => ({
  publishEvent: vi.fn(async () => {}),
  TOPICS: { PAYMENT_INITIATED: "payment.initiated" },
}));

vi.mock("../_core/permify", () => ({
  assertCan: vi.fn(async () => {}),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { scheduledJobAuth } from "../_core/security";

function makeCtx(role = "user", id = 42): TrpcContext {
  return {
    user: {
      id, openId: `test-${role}`, email: `${role}@example.com`, name: `Test ${role}`,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  // Bridge down → authorized reads reach a 503; authorization failures must
  // surface as FORBIDDEN/BAD_REQUEST *before* the bridge is consulted.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
});

// ─── SW-S11-1: ledger read authorization (IDOR) ─────────────────────────────

describe("SW-S11-1: ledger account reads are scoped", () => {
  it("trader cannot read another trader's account", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.ledger.getBalance({ accountId: "trader-7-liability" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("trader cannot read platform revenue accounts", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.ledger.getAccount({ accountId: "customs-duty-revenue" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accounts outside the allowlist are rejected even for privileged roles", async () => {
    const caller = appRouter.createCaller(makeCtx("finance", 9));
    await expect(caller.ledger.getBalance({ accountId: "arbitrary-account" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("trader reading their own account passes authorization (fails later at bridge)", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.ledger.getBalance({ accountId: "trader-42-liability" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("finance role can read any well-formed account", async () => {
    const caller = appRouter.createCaller(makeCtx("finance", 9));
    await expect(caller.ledger.getBalance({ accountId: "trader-42-liability" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
});

// ─── SW-S11-5: finance alias procedures enforce role checks ─────────────────

describe("SW-S11-5: finance mobile aliases require finance/admin role", () => {
  it.each(["summary", "transactions", "duties", "clusterSummary"] as const)(
    "finance.%s rejects an ordinary trader",
    async (proc) => {
      const caller = appRouter.createCaller(makeCtx("user", 42));
      await expect((caller.finance as any)[proc]())
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it.each(["summary", "transactions", "duties", "clusterSummary"] as const)(
    "finance.%s rejects a customs officer",
    async (proc) => {
      const caller = appRouter.createCaller(makeCtx("customs_officer", 5));
      await expect((caller.finance as any)[proc]())
        .rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("finance.summary succeeds for the finance role", async () => {
    const caller = appRouter.createCaller(makeCtx("finance", 9));
    const result = await caller.finance.summary();
    expect(result).toMatchObject({ totalRevenue: 1, confirmedCount: 1 });
  });
});

// ─── SW-S11-2: scheduled-job endpoint auth ──────────────────────────────────

describe("SW-S11-2: scheduledJobAuth middleware", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function mockRes() {
    const res = {
      statusCode: 0,
      body: null as unknown,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: unknown) { this.body = payload; return this; },
    };
    return res;
  }

  it("fails closed (503) in production when SCHEDULER_SECRET is unset", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SCHEDULER_SECRET;
    const res = mockRes();
    const next = vi.fn();
    scheduledJobAuth({ headers: {} } as any, res as any, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token in production (401)", () => {
    process.env.NODE_ENV = "production";
    process.env.SCHEDULER_SECRET = "correct-horse";
    const res = mockRes();
    const next = vi.fn();
    scheduledJobAuth({ headers: { authorization: "Bearer wrong" }, ip: "127.0.0.1", path: "/api/scheduled/x" } as any, res as any, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts the correct bearer token", () => {
    process.env.NODE_ENV = "production";
    process.env.SCHEDULER_SECRET = "correct-horse";
    const res = mockRes();
    const next = vi.fn();
    scheduledJobAuth({ headers: { authorization: "Bearer correct-horse" }, ip: "127.0.0.1", path: "/api/scheduled/x" } as any, res as any, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows requests in development when the secret is unset", () => {
    process.env.NODE_ENV = "development";
    delete process.env.SCHEDULER_SECRET;
    const res = mockRes();
    const next = vi.fn();
    scheduledJobAuth({ headers: {} } as any, res as any, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
