/**
 * ledger.remediation.test.ts — Phase-6 regression tests
 *
 * SW-M7:  ledger mutations require a finance/admin/customs_officer role;
 *         bridge outage → 503, NEVER a DB row with fabricated tbTransferId
 *         status "posted"; server-side account allowlist; exact minor units.
 * SW-19:  payment risk scorer outage → REVIEW + SCORING_UNAVAILABLE, never
 *         LOW/APPROVE.
 * SW-MP2: seed client uses the canonical /api/ledger/* dialect on the
 *         canonical bridge (no /seed/system).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  // PRA-012: money-rail hops require service auth; tests use the documented
  // non-production shared-secret credential (fail-closed semantics preserved).
  process.env.TB_BRIDGE_SHARED_SECRET = "test-tb-bridge-shared-secret";
});

const state = {
  ledgerEntries: [] as Array<Record<string, unknown>>,
  fetches: [] as Array<{ url: string; init?: RequestInit }>,
  bridgeUp: false,
};

vi.mock("../db", () => ({
  getLedgerEntriesByDeclaration: vi.fn(async () => []),
  getLedgerEntriesByPayment: vi.fn(async () => []),
  getRecentLedgerEntries: vi.fn(async () => []),
  createLedgerEntry: vi.fn(async (e: Record<string, unknown>) => { state.ledgerEntries.push(e); return e; }),
}));

vi.mock("../_core/kafka", () => ({
  publishEvent: vi.fn(async () => {}),
  TOPICS: { PAYMENT_INITIATED: "payment.initiated" },
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "user"): TrpcContext {
  return {
    user: {
      id: 42, openId: `test-${role}`, email: `${role}@example.com`, name: `Test ${role}`,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  state.ledgerEntries = [];
  state.fetches = [];
  state.bridgeUp = false;
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    state.fetches.push({ url: u, init });
    if (u.includes("/health")) {
      return state.bridgeUp ? new Response("{}", { status: 200 }) : (() => { throw new Error("down"); })();
    }
    if (u.includes("/api/ledger/transfers") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "tb-real-1" }), { status: 200 });
    }
    if (u.includes("/api/ledger/accounts") && init?.method === "POST") {
      return new Response(JSON.stringify({ id: "acct" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }));
});

const transferInput = {
  debitAccountId: "trader-42-liability",
  creditAccountId: "customs-duty-revenue",
  amount: "100.25",
  currency: "GHS",
};

describe("SW-M7: ledger mutations fail closed", () => {
  it("rejects non-finance callers", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(caller.ledger.postTransfer(transferInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.ledger.voidPending({ pendingId: "p1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("bridge down → 503 and NO fabricated posted ledger row", async () => {
    state.bridgeUp = false;
    const caller = appRouter.createCaller(makeCtx("finance"));
    await expect(caller.ledger.postTransfer(transferInput)).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(caller.ledger.postBondDeposit({
      declarationId: 1, traderId: 42, bondAmount: 500, currency: "GHS", bondType: "import_bond",
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    // Old behavior wrote status:'posted' with a fabricated tbTransferId:
    expect(state.ledgerEntries).toHaveLength(0);
  });

  it("rejects accounts outside the server-side allowlist", async () => {
    state.bridgeUp = true;
    const caller = appRouter.createCaller(makeCtx("finance"));
    await expect(caller.ledger.postTransfer({
      ...transferInput, creditAccountId: "attacker-controlled-account",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("posts to the canonical bridge with exact minor units when available", async () => {
    state.bridgeUp = true;
    const caller = appRouter.createCaller(makeCtx("finance"));
    await caller.ledger.postTransfer(transferInput);
    expect(state.ledgerEntries).toHaveLength(1);
    expect(state.ledgerEntries[0].amountMinorUnits).toBe(10025); // 100.25 exact
    expect(state.ledgerEntries[0].tbTransferId).toBe("tb-real-1"); // real bridge id
    expect(state.ledgerEntries[0].status).toBe("posted");
  });

  it("penalty officerId must match the authenticated officer", async () => {
    state.bridgeUp = true;
    const caller = appRouter.createCaller(makeCtx("customs_officer"));
    await expect(caller.ledger.postPenalty({
      declarationId: 1, traderId: 42, penaltyAmount: 10, currency: "GHS",
      penaltyCode: "LATE_FILING", officerId: 999,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("SW-19: scorePaymentRisk fails safe", () => {
  it("scorer outage → REVIEW + SCORING_UNAVAILABLE (never APPROVE)", async () => {
    const caller = appRouter.createCaller(makeCtx("finance"));
    const res = await caller.ledger.scorePaymentRisk({
      traderId: "42", amount: 100, fspId: "MTN_MOMO", fspType: "MOBILE_MONEY", payerAccount: "0244000000",
    });
    expect(res.recommendedAction).toBe("REVIEW");
    expect(res.flags.join(" ")).toContain("SCORING_UNAVAILABLE");
    expect(res.recommendedAction).not.toBe("APPROVE");
  });
});

describe("SW-MP2: seed converges on the canonical dialect", () => {
  it("seedSystemAccounts posts each account to /api/ledger/accounts", async () => {
    const caller = appRouter.createCaller(makeCtx("admin"));
    const res = await caller.tigerbeetleSeed.seedSystemAccounts();
    expect(res.success).toBe(true);
    const accountPosts = state.fetches.filter(f => f.url.includes("/api/ledger/accounts") && f.init?.method === "POST");
    expect(accountPosts.length).toBeGreaterThanOrEqual(13);
    // The phantom /seed/system endpoint must never be called:
    expect(state.fetches.some(f => f.url.includes("/seed/system"))).toBe(false);
  });

  it("seeding is admin-only", async () => {
    const caller = appRouter.createCaller(makeCtx("finance"));
    await expect(caller.tigerbeetleSeed.seedSystemAccounts()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
