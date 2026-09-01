/**
 * payments.test.ts — Tests for payments tRPC router
 * Uses vi.mock to avoid real DB connections
 */
import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock payment account provisioner to avoid real DB FK violations ────────
vi.mock("./_core/paymentAccountProvisioner", () => ({
  getOrProvisionTraderAccount: vi.fn().mockResolvedValue("trader-9702"),
  provisionTraderAccount: vi.fn().mockResolvedValue({ accountId: "trader-9702", isNew: false, ledger: 1 }),
  provisionSystemAccounts: vi.fn().mockResolvedValue(undefined),
  SYSTEM_ACCOUNTS: {
    NCS_REVENUE: "ncs-revenue-account",
    BOND_COLLATERAL: "ncs-bond-collateral",
    DRAWBACK_RESERVE: "ncs-drawback-reserve",
    CUSTOMS_FEE: "ncs-customs-fee",
  },
}));

// ─── Mock DB helpers ──────────────────────────────────────────────────────────
vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getAllPayments: vi.fn().mockResolvedValue([
      {
        id: 1,
        declarationId: 1,
        traderId: 9702,
        amount: "5000.00",
        currency: "GHS",
        paymentMethod: "mobile_money",
        status: "confirmed",
        reference: "PAY-001",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]),
    getPaymentsByDeclaration: vi.fn().mockResolvedValue([]),
    getDeclarationById: vi.fn().mockImplementation(async (id: number) => {
      if (id === 999999) return null;
      return {
        id,
        traderId: 9702,
        status: "payment_pending",
        declarationNumber: "DEC-001",
        totalDue: "5000.00",
        invoiceCurrency: "GHS",
      };
    }),
    createPayment: vi.fn().mockResolvedValue({
      id: 2,
      declarationId: 1,
      traderId: 9702,
      amount: "5000.00",
      currency: "GHS",
      paymentMethod: "mobile_money",
      status: "pending",
      reference: "PAY-NEW-001",
      createdAt: new Date(),
    }),
    updateDeclaration: vi.fn().mockResolvedValue({}),
    updatePayment: vi.fn().mockResolvedValue({}),
    logAuditEvent: vi.fn().mockResolvedValue({}),
    createNotification: vi.fn().mockResolvedValue({}),
    // SW-26: enqueue failures are no longer swallowed — the happy-path test
    // needs a working in-memory queue/idempotency store. A generic thenable
    // query-builder chain supports every drizzle call shape (select/insert/
    // where/limit/returning/orderBy/offset) without touching a real DB.
    getDb: vi.fn().mockImplementation(async () => {
      // Generic thenable drizzle query-builder chain (defined here because
      // vi.mock factories are hoisted above top-level consts). The chain is
      // wrapped in a plain object so the top-level db handle is NOT thenable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = new Proxy(function () {}, {
        get: (_t, prop) => {
          if (prop === "then") return (resolve: (v: unknown) => void) => resolve([{ id: 1 }]);
          return () => chain;
        },
        apply: () => chain,
      });
      // Tx-chain whose awaited inserts resolve a full payment row (the
      // Phase-11 transactional create in payments.initiate destructures it).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const txChain: any = new Proxy(function () {}, {
        get: (_t, prop) => {
          if (prop === "then")
            return (resolve: (v: unknown) => void) =>
              resolve([{ id: 1, status: "pending", reference: "PAY-NEW-001" }]);
          return () => txChain;
        },
        apply: () => txChain,
      });
      return {
        select: () => chain, insert: () => chain, update: () => chain, delete: () => chain,
        // Phase-11: payments.initiate wraps payment create + declaration
        // status change in a transaction — hand the tx chain to the callback.
        transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({ insert: () => txChain, update: () => txChain }),
      };
    }),
  };
});

// SW-MP15: Permify writeTuple now fails closed instead of being silently
// swallowed — the happy path must run against a reachable (mocked) Permify.
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({}),
  text: async () => "",
} as Response);

// ─── Test context ─────────────────────────────────────────────────────────────
function createContext(role: "user" | "admin" | "finance" = "user", userId = 9702): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `pay-test-${userId}`,
      name: "Pay Test User",
      email: "pay@test.com",
      loginMethod: "manus",
      role: role as any,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const adminCaller = appRouter.createCaller(createContext("admin", 9701));
const traderCaller = appRouter.createCaller(createContext("user", 9702));

describe("payments router", () => {
  describe("listAll (admin/finance only)", () => {
    it("allows admin to list all payments", async () => {
      const result = await adminCaller.payments.listAll({ limit: 10, offset: 0 });
      expect(result).toHaveProperty("transactions");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.transactions)).toBe(true);
    });

    it("rejects non-admin listing all payments", async () => {
      await expect(
        traderCaller.payments.listAll({ limit: 10, offset: 0 })
      ).rejects.toThrow();
    });

    it("respects pagination parameters", async () => {
      const result = await adminCaller.payments.listAll({ limit: 5, offset: 0 });
      expect(result.transactions.length).toBeLessThanOrEqual(5);
    });

    it("returns total count alongside transactions", async () => {
      const result = await adminCaller.payments.listAll({ limit: 10, offset: 0 });
      expect(typeof result.total).toBe("number");
    });
  });

  describe("byDeclaration", () => {
    it("returns payments for a valid declaration owned by the trader", async () => {
      const result = await traderCaller.payments.byDeclaration({ declarationId: 1 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("rejects access to non-existent declaration", async () => {
      await expect(
        traderCaller.payments.byDeclaration({ declarationId: 999999 })
      ).rejects.toThrow();
    });
  });

  describe("initiate", () => {
    it("rejects payment for non-existent declaration", async () => {
      await expect(
        traderCaller.payments.initiate({
          declarationId: 999999,
          paymentMethod: "mobile_money",
        })
      ).rejects.toThrow();
    });

    it("initiates payment for a valid declaration", async () => {
      const result = await traderCaller.payments.initiate({
        declarationId: 1,
        paymentMethod: "mobile_money",
      });
      expect(result).toHaveProperty("id");
      expect(result).toHaveProperty("status", "pending");
    });
  });
});
