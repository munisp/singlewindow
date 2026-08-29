/**
 * payments.remediation.test.ts — Phase-6 regression tests
 *
 * SW-9:  payments.confirm requires a valid switch HMAC signature (or admin),
 *        and the referenced Mojaloop transfer must be COMMITTED — an
 *        authenticated payment owner cannot confirm with an arbitrary id.
 * SW-26: enqueue failures fail the mutation honestly (no fabricated
 *        queuedForProcessing:true); Kafka publish failures are not swallowed.
 * SW-17: queue amounts are exact integer minor units (no parseFloat math).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import nodeCrypto from "crypto";

const state = {
  decl: null as null | Record<string, unknown>,
  payment: null as null | Record<string, unknown>,
  mojaTx: null as null | Record<string, unknown>,
  queueInserts: [] as Array<Record<string, unknown>>,
  paymentUpdates: [] as Array<Record<string, unknown>>,
  emitted: [] as string[],
  selectResult: [] as Array<Record<string, unknown>>,
  failQueueInsert: false,
  failEmit: false,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: (_table: unknown) => ({
        where: () => ({
          limit: async () => state.selectResult,
        }),
      }),
    }),
    insert: (table: any) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (state.failQueueInsert) throw new Error("DB write failed");
          if (v && (v as any).transferId) state.queueInserts.push(v);
          return [{ id: 55 }];
        },
        onConflictDoNothing: async () => {},
      }),
    }),
  })),
  createPayment: vi.fn(async (p: Record<string, unknown>) => ({ id: 10, status: "pending", ...p })),
  updatePayment: vi.fn(async (id: number, p: Record<string, unknown>) => {
    state.paymentUpdates.push({ id, ...p });
    return { id, ...p };
  }),
  getPaymentsByDeclaration: vi.fn(async () => []),
  getDeclarationById: vi.fn(async () => state.decl),
  updateDeclaration: vi.fn(async () => {}),
  logAuditEvent: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  getAllPayments: vi.fn(async () => []),
  createUserNotification: vi.fn(async () => {}),
  withRlsContext: vi.fn(async (_c: unknown, fn: (db: unknown) => unknown) => fn(null)),
  getPaymentTrend: vi.fn(async () => []),
  getPendingPaymentsList: vi.fn(async () => []),
  getLedgerEntriesByPayment: vi.fn(async () => []),
  getMojaloopTransactionByTransferId: vi.fn(async () => state.mojaTx),
}));

vi.mock("../_core/permify", () => ({
  assertCan: vi.fn(async () => {}),
  setOwner: vi.fn(async () => {}),
}));

vi.mock("../_core/kafkaEventPublisher", () => ({
  emitPaymentInitiated: vi.fn(async () => {
    if (state.failEmit) throw new Error("kafka down");
    state.emitted.push("payment.initiated");
  }),
  emitPaymentCompleted: vi.fn(async () => {}),
}));

vi.mock("../_core/paymentAccountProvisioner", () => ({
  getOrProvisionTraderAccount: vi.fn(async () => "trader-acc-1"),
  SYSTEM_ACCOUNTS: { NCS_REVENUE: "ncs-revenue" },
}));

vi.mock("../_core/distributedLock", () => ({
  acquireLock: vi.fn(async () => "lock-token"),
  releaseLock: vi.fn(async () => {}),
  getIdempotencyKey: vi.fn(async () => null),
  setIdempotencyKey: vi.fn(async () => {}),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "user", userId = 42): TrpcContext {
  return {
    user: {
      id: userId, openId: `test-${role}`, email: `${role}@example.com`, name: `Test ${role}`,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function sign(paymentId: number, transferId: string): string {
  return nodeCrypto.createHmac("sha256", "dev-webhook-secret")
    .update(`confirm:${paymentId}:${transferId}`).digest("hex");
}

beforeEach(() => {
  state.decl = { id: 5, traderId: 42, status: "payment_pending", totalDue: "0.29", invoiceCurrency: "GHS", declarationNumber: "D-5", aiExplanation: null };
  state.payment = { id: 10, traderId: 42, status: "pending", declarationId: 5, amount: "0.29", currency: "GHS" };
  state.mojaTx = null;
  state.queueInserts = [];
  state.paymentUpdates = [];
  state.selectResult = [];
  state.emitted = [];
  state.failQueueInsert = false;
  state.failEmit = false;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});

describe("SW-26/SW-17: payments.initiate", () => {
  it("enqueues with exact integer minor units (0.29 → 29), reports real flags", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.payments.initiate({ declarationId: 5, paymentMethod: "mobile_money" });
    expect(res.queuedForProcessing).toBe(true);
    expect(res.eventPublished).toBe(true);
    expect(state.queueInserts).toHaveLength(1);
    expect(state.queueInserts[0].amountMinorUnits).toBe(29n); // no float drift
  });

  it("fails the mutation honestly when enqueueing fails", async () => {
    state.failQueueInsert = true;
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.payments.initiate({ declarationId: 5, paymentMethod: "mobile_money" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    // The payment must not linger as pending-but-unqueued:
    expect(state.paymentUpdates.some(u => u.status === "failed")).toBe(true);
  });

  it("reports eventPublished:false when Kafka publish fails (not swallowed)", async () => {
    state.failEmit = true;
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.payments.initiate({ declarationId: 5, paymentMethod: "mobile_money" });
    expect(res.eventPublished).toBe(false);
    expect(res.queuedForProcessing).toBe(true);
  });
});

describe("SW-9: payments.confirm", () => {
  beforeEach(() => { state.selectResult = state.payment ? [state.payment] : []; });
  it("rejects a payment owner dispatching confirmation without a switch signature", async () => {
    const caller = appRouter.createCaller(makeCtx()); // owner, role=user
    await expect(caller.payments.confirm({ paymentId: 10, mojaloopTransferId: "TRF-FAKE" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects a forged signature", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.payments.confirm({
      paymentId: 10, mojaloopTransferId: "TRF-1",
      signature: "0".repeat(64),
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects confirmation when the referenced transfer is not COMMITTED", async () => {
    state.mojaTx = { id: 1, transferId: "TRF-1", status: "PENDING", declarationId: 5 };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.payments.confirm({
      paymentId: 10, mojaloopTransferId: "TRF-1", signature: sign(10, "TRF-1"),
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("accepts a valid signature with a COMMITTED transfer and submits the workflow", async () => {
    state.mojaTx = { id: 1, transferId: "TRF-1", status: "COMMITTED", declarationId: 5 };
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.payments.confirm({
      paymentId: 10, mojaloopTransferId: "TRF-1", signature: sign(10, "TRF-1"),
    });
    expect(res.status).toBe("confirmation_submitted");
  });

  it("admin may confirm without a signature but still requires a COMMITTED transfer", async () => {
    const caller = appRouter.createCaller(makeCtx("admin", 1));
    await expect(caller.payments.confirm({ paymentId: 10, mojaloopTransferId: "TRF-X" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
