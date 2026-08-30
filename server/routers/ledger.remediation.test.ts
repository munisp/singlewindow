/**
 * ledger.remediation.test.ts — Phase-6 remediation regressions
 *
 * SW-12: ledger.getLedgerSummary surfaces an explicit error when the
 *        TigerBeetle bridge is unreachable (previously fabricated a
 *        healthy-looking report with revenueTotal=0).
 * PRA-012: getLedgerSummary and getTransferHistory are financeProcedure
 *          (fail-closed for non-finance roles).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

const state = {
  fetchImpl: null as null | ((url: string, init?: any) => Promise<any>),
};

// Mock global fetch used by the ledger router's bridge calls
const realFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = ((url: any, init?: any) => {
    if (state.fetchImpl) return state.fetchImpl(String(url), init);
    return Promise.reject(new Error("fetch not stubbed"));
  }) as any;
});

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
}));

function ctxFor(role: string): TrpcContext {
  return {
    user: {
      id: 7,
      openId: "kc-finance-1",
      name: "Finance Officer",
      email: "finance@customs.gov",
      role: role as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {}, socket: {} } as any,
    res: {} as any,
  };
}

describe("SW-12: ledger summary honest on bridge outage", () => {
  it("returns ok:false + error when the bridge is unreachable (never fabricated zeros)", async () => {
    state.fetchImpl = () => Promise.reject(new Error("ECONNREFUSED"));
    const caller = appRouter.createCaller(ctxFor("finance"));
    const result = await caller.ledger.getLedgerSummary();
    expect(result.ok).toBe(false);
    expect(typeof (result as any).error).toBe("string");
    // Crucially it must NOT present fabricated zero balances as healthy data
    expect((result as any).revenueTotal).not.toBe("0");
  });

  it("returns ok:true with real totals when the bridge answers", async () => {
    state.fetchImpl = async (url: string) => {
      if (url.includes("/api/ledger/summary")) {
        return {
          ok: true,
          json: async () => ({
            summary: {
              totalRevenueConfirmed: "125000",
              totalRevenuePending: "8500",
              currency: "GHS",
              mode: "simulation",
              timestamp: "2026-03-16T12:00:00Z",
            },
            accounts: [],
            recentTransfers: [],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const caller = appRouter.createCaller(ctxFor("finance"));
    const result = await caller.ledger.getLedgerSummary();
    expect(result.ok).toBe(true);
    expect((result as any).totalRevenueConfirmed).toBe("125000");
  });
});

describe("PRA-012: ledger procedures are finance-only", () => {
  it("getLedgerSummary rejects role=user", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(caller.ledger.getLedgerSummary()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("getTransferHistory rejects role=user", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.ledger.getTransferHistory({ accountId: "ncs-revenue-account" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
