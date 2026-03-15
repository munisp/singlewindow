/**
 * notifications.test.ts — Tests for notifications tRPC router
 * Uses vi.mock to avoid real DB connections.
 * Updated for Sprint 96: router now uses withRlsContext instead of
 * getNotificationsByUser/markNotificationRead helpers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock DB ──────────────────────────────────────────────────────────────────

const mockNotifications = [
  {
    id: 1,
    userId: 9801,
    title: "Declaration Approved",
    message: "Your declaration DEC-001 has been approved.",
    type: "declaration",
    read: false,
    referenceId: 1,
    referenceType: "declaration",
    createdAt: new Date(),
  },
  {
    id: 2,
    userId: 9801,
    title: "Payment Confirmed",
    message: "Payment for DEC-002 has been confirmed.",
    type: "payment",
    read: true,
    referenceId: 2,
    referenceType: "payment",
    createdAt: new Date(),
  },
];

// Build a chainable Drizzle mock that returns mockNotifications for select queries
function makeChainableMock(resolveValue: unknown = mockNotifications) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const terminalMethods = ["limit", "offset"];
  const chainMethods = ["select", "from", "where", "orderBy", "update", "set"];
  for (const m of chainMethods) {
    chain[m] = vi.fn().mockReturnThis();
  }
  for (const m of terminalMethods) {
    chain[m] = vi.fn().mockResolvedValue(resolveValue);
  }
  // returning() is used by update/insert
  chain.returning = vi.fn().mockResolvedValue([{ id: 1, userId: 9801, read: true }]);
  // where() when used as terminal (e.g. update...set...where) should also resolve
  // Override where to resolve as a Promise when called after set()
  chain.where = vi.fn().mockImplementation(() => {
    // Return both a thenable (for await) and chainable methods
    const result = Promise.resolve(resolveValue);
    Object.assign(result, chain);
    return result;
  });
  return chain;
}

vi.mock("./db", () => ({
  getDb: vi.fn(),
  withRlsContext: vi.fn(async (_user: unknown, fn: (db: unknown) => unknown) => {
    const db = makeChainableMock();
    return fn(db);
  }),
}));

// ─── Test context ─────────────────────────────────────────────────────────────

function createContext(): TrpcContext {
  return {
    user: {
      id: 9801,
      openId: "notif-test-001",
      name: "Notif Test User",
      email: "notif@test.com",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  };
}

const caller = appRouter.createCaller(createContext());

describe("notifications router", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("list", () => {
    it("returns an array for authenticated user", async () => {
      const result = await caller.notifications.list({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("respects limit parameter (no more than limit items)", async () => {
      const result = await caller.notifications.list({ limit: 5 });
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("each notification has required fields", async () => {
      const result = await caller.notifications.list({ limit: 20 });
      result.forEach((n: Record<string, unknown>) => {
        expect(n).toHaveProperty("id");
        expect(n).toHaveProperty("title");
        expect(n).toHaveProperty("message");
        expect(n).toHaveProperty("read");
      });
    });
  });

  describe("markRead", () => {
    it("rejects an empty ids array (min: 1 validation)", async () => {
      // The router now enforces z.array().min(1) — empty array is a validation error
      await expect(caller.notifications.markRead({ ids: [] })).rejects.toThrow();
    });

    it("marks specified notification ids as read", async () => {
      const result = await caller.notifications.markRead({ ids: [1, 2] });
      expect(result).toHaveProperty("success", true);
    });

    it("handles non-existent notification ids gracefully (skip missing)", async () => {
      const result = await caller.notifications.markRead({ ids: [999999] });
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("markAllRead", () => {
    it("returns success: true", async () => {
      const result = await caller.notifications.markAllRead();
      expect(result).toHaveProperty("success", true);
    });
  });

  describe("unreadCount", () => {
    it("returns a count property", async () => {
      const result = await caller.notifications.unreadCount();
      expect(result).toHaveProperty("count");
      expect(typeof result.count).toBe("number");
    });
  });
});
