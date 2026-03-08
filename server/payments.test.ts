/**
 * payments.test.ts — Tests for payments tRPC router
 * Uses vi.mock to avoid real DB connections
 */
import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
    logAuditEvent: vi.fn().mockResolvedValue({}),
    createNotification: vi.fn().mockResolvedValue({}),
  };
});

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
