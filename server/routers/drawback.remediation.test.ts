/**
 * drawback.remediation.test.ts — Phase-6 remediation regressions
 *
 * SW-4: finance-only procedures (approveDrawback, reconcileDrawback) reject
 *       caller role "user" before any DB work (previously reached the DB).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { appRouter } from "../routers";
import { financeProcedure } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";

// ── DB mock (must never be reached for rejected roles) ───────────────────────
const state = {
  dbCalls: 0,
  claim: null as any,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => {
    state.dbCalls++;
    return {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => (state.claim ? [state.claim] : []),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {},
        }),
      }),
      insert: () => ({
        values: async () => {},
      }),
    };
  }),
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock("../_core/kafka", () => ({
  publishEvent: vi.fn(async () => {}),
  TOPICS: { DRAWBACK_APPROVED: "drawback.approved", DRAWBACK_REJECTED: "drawback.rejected", DRAWBACK_RECONCILED: "drawback.reconciled" },
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

beforeEach(() => {
  state.dbCalls = 0;
  state.claim = {
    id: 3,
    claimReference: "DB-2026-0001",
    status: "verified",
    approvedAmount: "250.00",
    calculatedAmount: "250.00",
  };
});

describe("SW-4: drawback finance procedures reject non-finance roles", () => {
  it("approveDrawback rejects role=user with FORBIDDEN and never touches the DB", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.drawback.approveDrawback({ claimId: 3, approvedAmount: "250.00" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.dbCalls).toBe(0);
  });

  it("reconcileDrawback rejects role=user", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.drawback.reconcileDrawback({ claimId: 3, mojaloopTransferId: "tx-1" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.dbCalls).toBe(0);
  });

  it("approveDrawback accepts role=finance and applies the approved amount", async () => {
    const caller = appRouter.createCaller(ctxFor("finance"));
    const result = await caller.drawback.approveDrawback({ claimId: 3, approvedAmount: "250.00" });
    expect(result.success).toBe(true);
    expect(state.claim!.approvedAmount).toBe("250.00");
  });

  it("approveDrawback accepts role=admin", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const result = await caller.drawback.approveDrawback({ claimId: 3, approvedAmount: "250.00" });
    expect(result.success).toBe(true);
  });
});
