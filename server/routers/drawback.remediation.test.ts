/**
 * drawback.remediation.test.ts — Phase-6 regression tests (SW-M8)
 *
 * - approvedAmount may never exceed claimedAmount (old code allowed it).
 * - markPaid requires paidAmount == approvedAmount AND a verified rail receipt
 *   (old code took caller paidAmount with no rail call, no audit).
 * - Four-eyes: high-value payouts require a second-officer approval.
 * - Every transition is audited.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.hoisted(() => {
  process.env.DRAWBACK_FOUR_EYES_THRESHOLD_MINOR = "100"; // 1.00 major — everything is four-eyes in tests
});

const state = {
  claim: null as null | Record<string, unknown>,
  secondApprovals: [] as Array<{ actorId: number }>,
  auditEvents: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  railReceipt: null as null | Record<string, unknown>,
  railStatus: 200,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: (..._args: unknown[]) => ({
      from: (table: unknown) => ({
        where: () => ({
          limit: async () => {
            const name = (table as any)?.[Symbol.for("drizzle:Name")] ?? "";
            if (String(name).includes("audit")) return state.secondApprovals;
            return state.claim ? [state.claim] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            state.updates.push(v);
            state.claim = { ...state.claim!, ...v };
            return [state.claim];
          },
        }),
      }),
    }),
    insert: () => ({ values: () => ({ returning: async () => [state.claim] }) }),
  })),
  logAuditEvent: vi.fn(async (e: Record<string, unknown>) => { state.auditEvents.push(e); }),
}));

vi.mock("../_core/permify", () => ({
  assertCan: vi.fn(async () => {}),
  setOwner: vi.fn(async () => {}),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "finance", userId = 7): TrpcContext {
  return {
    user: {
      id: userId, openId: `test-${role}-${userId}`, email: `${role}@example.com`, name: `Test ${role}`,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  state.claim = {
    id: 3, claimNumber: "DDC-2026-000003", traderId: 42, status: "submitted",
    claimedAmount: "250.00", approvedAmount: null, reviewedBy: null,
  };
  state.secondApprovals = [];
  state.auditEvents = [];
  state.updates = [];
  state.railStatus = 200;
  state.railReceipt = { id: "rail-1", amount: "250.00", status: "posted" };
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (state.railStatus !== 200) return new Response("not found", { status: state.railStatus });
    return new Response(JSON.stringify(state.railReceipt), { status: 200 });
  }));
});

describe("SW-M8: drawback review", () => {
  it("rejects approvedAmount greater than the claimed amount", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.drawback.review({ id: 3, decision: "approved", approvedAmount: 250.01 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("approves at/below the claimed amount and audits the transition", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await caller.drawback.review({ id: 3, decision: "approved", approvedAmount: 250.00 });
    expect(state.claim!.status).toBe("approved");
    expect(state.claim!.approvedAmount).toBe("250.00");
    expect(state.auditEvents.some(e => e.action === "drawback_claim_approved")).toBe(true);
  });
});

describe("SW-M8: drawback markPaid", () => {
  beforeEach(() => {
    state.claim = {
      ...state.claim!, status: "approved", approvedAmount: "250.00", reviewedBy: 99,
    };
    state.secondApprovals = [{ actorId: 55 }]; // ≠ reviewer 99
  });

  it("rejects paidAmount different from the approved amount", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.drawback.markPaid({ id: 3, paidAmount: 200.00, railReference: "rail-1" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.claim!.status).toBe("approved");
  });

  it("rejects a nonexistent rail receipt", async () => {
    state.railStatus = 404;
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.drawback.markPaid({ id: 3, paidAmount: 250.00, railReference: "rail-x" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("fails closed when the rail is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.drawback.markPaid({ id: 3, paidAmount: 250.00, railReference: "rail-1" }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("enforces four-eyes above the threshold", async () => {
    state.secondApprovals = []; // no second approval
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.drawback.markPaid({ id: 3, paidAmount: 250.00, railReference: "rail-1" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("second approval must come from a different officer", async () => {
    const caller = appRouter.createCaller(makeCtx("finance", 99)); // same as reviewer
    await expect(caller.drawback.secondApprove({ id: 3 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("pays with equal amount, verified receipt, second approval — and audits", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.drawback.markPaid({ id: 3, paidAmount: 250.00, railReference: "rail-1" });
    expect(res.status).toBe("paid");
    expect(state.auditEvents.some(e => e.action === "drawback_claim_paid")).toBe(true);
  });
});
