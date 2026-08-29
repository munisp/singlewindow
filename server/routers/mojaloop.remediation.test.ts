/**
 * mojaloop.remediation.test.ts — Phase-6 regression tests
 *
 * SW-M1:  getPaymentStatus must be side-effect free — no auto-progression,
 *         no fabricated fulfilment, no ledger/audit writes from a READ.
 * SW-10:  webhook requires HMAC signature (timing-safe, via header);
 *         COMMITTED requires a fulfilment satisfying the stored condition;
 *         event-id / terminal-state dedupe prevents double ledger entries;
 *         initiation amount is server-authoritative (declaration.totalDue).
 * SW-M15: ILP condition derives from a CSPRNG preimage, NOT from transferId.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import nodeCrypto from "crypto";

// ─── Mutable DB fixture state ────────────────────────────────────────────────
const state = {
  tx: null as null | Record<string, unknown>,
  declaration: null as null | Record<string, unknown>,
  ledgerEntries: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  idempotencyKeys: new Set<string>(),
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            // paymentIdempotencyKeys lookups — test pre-seeds via state
            return [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: () => ({ onConflictDoNothing: async () => {} }),
    }),
  })),
  getPaymentsByDeclaration: vi.fn(async () => []),
  createMojaloopTransaction: vi.fn(async (data: Record<string, unknown>) => {
    state.tx = { id: 1, createdAt: new Date(), ...data };
    return state.tx;
  }),
  getMojaloopTransactionByTransferId: vi.fn(async () => state.tx),
  updateMojaloopTransaction: vi.fn(async (_id: string, data: Record<string, unknown>) => {
    state.updates.push(data);
    state.tx = { ...state.tx!, ...data };
    return state.tx;
  }),
  getMojaloopTransactionsByDeclaration: vi.fn(async () => []),
  getMojaloopTransactionsByUser: vi.fn(async () => []),
  getDeclarationById: vi.fn(async () => state.declaration),
  logAuditEvent: vi.fn(async (e: Record<string, unknown>) => { state.auditEvents.push(e); }),
  createLedgerEntry: vi.fn(async (e: Record<string, unknown>) => { state.ledgerEntries.push(e); return e; }),
}));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCtx(role = "user", headers: Record<string, string> = {}): TrpcContext {
  return {
    user: {
      id: 42, openId: `test-${role}`, email: `${role}@example.com`, name: `Test ${role}`,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function sign(payload: {
  transferId: string; transferState: string; fulfilment?: string;
  completedTimestamp?: string; eventId?: string;
}): string {
  const canonical = [
    payload.transferId, payload.transferState,
    payload.fulfilment ?? "", payload.completedTimestamp ?? "", payload.eventId ?? "",
  ].join(".");
  return nodeCrypto.createHmac("sha256", "dev-webhook-secret").update(canonical).digest("hex");
}

beforeEach(() => {
  state.tx = null;
  state.declaration = null;
  state.ledgerEntries = [];
  state.auditEvents = [];
  state.updates = [];
  // Default: Mojaloop switch unreachable; bridge healthy.
  vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/health")) throw new Error("connection refused");
    if (u.includes("/api/ledger/transfers")) {
      return new Response(JSON.stringify({ id: "tb-real-123" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${u}`);
  }));
});

// ─── SW-M1: status reads are side-effect free ────────────────────────────────

describe("SW-M1: getPaymentStatus is side-effect free", () => {
  it("returns PENDING for an old PENDING transfer without mutating anything", async () => {
    // A transfer that has been PENDING far longer than 15 s (old code
    // auto-progressed it to PROCESSING then COMMITTED and minted ledger rows).
    state.tx = {
      id: 7, transferId: "TRF-OLD", status: "PENDING",
      amount: "100.00", currency: "GHS", fspId: "MTN_MOMO", fspName: "MTN",
      fspType: "MOBILE_MONEY", payerAccount: "0244000000", declarationId: 5,
      createdAt: new Date(Date.now() - 60_000), committedAt: null,
      ilpPacket: "x", condition: "cond", fulfilment: "server-preimage",
    };
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.mojaloop.getPaymentStatus({ transferId: "TRF-OLD" });
    expect(res.status).toBe("PENDING");
    expect(res.isSettled).toBe(false);
    // Old behavior wrote updates, fabricated fulfilments, ledger rows, audit rows:
    expect(state.updates).toHaveLength(0);
    expect(state.ledgerEntries).toHaveLength(0);
    expect(state.auditEvents).toHaveLength(0);
    // The server-side preimage must not leak before COMMITTED:
    expect(res.fulfilment).toBeNull();
  });
});

// ─── SW-10/SW-M15: initiation uses server-authoritative amount + CSPRNG ILP ──

describe("SW-10/SW-M15: initiatePayment", () => {
  const baseInput = {
    declarationId: 5, currency: "GHS", fspId: "MTN_MOMO",
    payerAccount: "0244000000", payerName: "Test Trader",
  };

  beforeEach(() => {
    state.declaration = {
      id: 5, traderId: 42, totalDue: "1234.56", declarationNumber: "D-5",
      invoiceCurrency: "GHS", aiExplanation: null,
    };
  });

  it("uses declaration.totalDue, not the caller-supplied amount", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // amount 1.00 vs totalDue 1234.56 → mismatch rejected
    await expect(caller.mojaloop.initiatePayment({ ...baseInput, amount: 1.00 }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("initiates with the authoritative amount and a non-derivable condition", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.mojaloop.initiatePayment(baseInput);
    expect(res.amount).toBeCloseTo(1234.56, 2);
    expect(res.amountMinorUnits).toBe(123456); // integer minor units, no float drift
    // Condition must NOT be sha256(transferId) — anyone could forge that.
    const forged = nodeCrypto.createHash("sha256").update(res.transferId).digest("base64url");
    expect(res.condition).not.toBe(forged);
    // The preimage is never returned to the caller.
    expect(JSON.stringify(res)).not.toContain((state.tx as any).fulfilment);
  });

  it("rejects payment for a declaration the caller does not own", async () => {
    state.declaration = { ...state.declaration!, traderId: 999 };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.mojaloop.initiatePayment(baseInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("fails closed when no assessed amount exists", async () => {
    state.declaration = { ...state.declaration!, totalDue: "0" };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.mojaloop.initiatePayment(baseInput)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

// ─── SW-10: webhook authentication, fulfilment verification, dedupe ─────────

describe("SW-10: webhookCallback", () => {
  const preimage = nodeCrypto.randomBytes(32);
  const condition = nodeCrypto.createHash("sha256").update(preimage).digest("base64url");
  const fulfilment = preimage.toString("base64url");

  beforeEach(() => {
    state.tx = {
      id: 9, transferId: "TRF-WH", status: "PENDING", amount: "500.00", currency: "GHS",
      declarationId: 5, initiatedBy: 42, condition, fulfilment,
      createdAt: new Date(), committedAt: null,
    };
  });

  it("rejects callbacks without a valid HMAC signature", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    await expect(caller.mojaloop.webhookCallback({
      transferId: "TRF-WH", transferState: "COMMITTED", fulfilment,
    })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(state.ledgerEntries).toHaveLength(0);
    expect(state.tx!.status).toBe("PENDING");
  });

  it("rejects a COMMITTED callback whose fulfilment fails the condition", async () => {
    const badFulfilment = nodeCrypto.randomBytes(32).toString("base64url");
    const sig = sign({ transferId: "TRF-WH", transferState: "COMMITTED", fulfilment: badFulfilment });
    const caller = appRouter.createCaller(makeCtx("user", { "x-mojaloop-signature": sig }));
    await expect(caller.mojaloop.webhookCallback({
      transferId: "TRF-WH", transferState: "COMMITTED", fulfilment: badFulfilment,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.ledgerEntries).toHaveLength(0);
  });

  it("commits with valid signature + fulfilment, exactly one ledger entry; replay is a no-op", async () => {
    const sig = sign({ transferId: "TRF-WH", transferState: "COMMITTED", fulfilment });
    const ctx = makeCtx("user", { "x-mojaloop-signature": sig });
    const caller = appRouter.createCaller(ctx);
    const res = await caller.mojaloop.webhookCallback({
      transferId: "TRF-WH", transferState: "COMMITTED", fulfilment,
    });
    expect(res.success).toBe(true);
    expect(state.tx!.status).toBe("COMMITTED");
    expect(state.ledgerEntries).toHaveLength(1);
    expect(state.ledgerEntries[0].tbTransferId).toBe("tb-real-123"); // real bridge id, not fabricated

    // Replay of the same COMMITTED event → idempotent, no second ledger row.
    const replay = await caller.mojaloop.webhookCallback({
      transferId: "TRF-WH", transferState: "COMMITTED", fulfilment,
    });
    expect((replay as any).idempotentReplay).toBe(true);
    expect(state.ledgerEntries).toHaveLength(1);
  });
});
