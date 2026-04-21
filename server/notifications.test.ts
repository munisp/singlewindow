/**
 * notifications.test.ts — Tests for notifications tRPC router
 * Uses vi.mock to avoid real DB connections.
 * Updated for Sprint 96+: router now uses withRlsContext and returns {items, total} for list.
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

const mockCountResult = [{ count: 2 }];

/**
 * Build a chainable Drizzle mock.
 * - select().from().where().orderBy().limit().offset() → resolves mockNotifications
 * - select({count}).from().where() → resolves mockCountResult (awaited directly)
 * - update().set().where() → resolves { returning: [...] }
 * - delete().where() → resolves { returning: [...] }
 */
function makeChainableMock() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  // offset is the terminal for list queries
  chain.offset = vi.fn().mockResolvedValue(mockNotifications);

  // limit chains to offset
  chain.limit = vi.fn().mockReturnThis();

  // orderBy chains
  chain.orderBy = vi.fn().mockReturnThis();

  // returning for update/delete
  chain.returning = vi.fn().mockResolvedValue([{ id: 1, userId: 9801, read: true }]);

  // set chains
  chain.set = vi.fn().mockReturnThis();

  // update chains
  chain.update = vi.fn().mockReturnThis();

  // delete chains
  chain.delete = vi.fn().mockReturnThis();

  // from chains
  chain.from = vi.fn().mockReturnThis();

  // select chains
  chain.select = vi.fn().mockReturnThis();

  // where: must handle two cases:
  //   1. After orderBy → returns chainable (for .limit().offset())
  //   2. After select({count}).from() → returns Promise resolving to countResult
  //   3. After update().set() → returns thenable with .returning()
  //   4. After delete() → returns thenable with .returning()
  chain.where = vi.fn().mockImplementation(function (this: unknown) {
    // Return an object that is both a Promise (for count queries) and chainable
    const countPromise = Promise.resolve(mockCountResult);
    const chainable = Object.assign(countPromise, chain);
    return chainable;
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
    it("returns items and total for authenticated user", async () => {
      const result = await caller.notifications.list({ limit: 10 });
      expect(result).toHaveProperty("items");
      expect(result).toHaveProperty("total");
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("respects limit parameter (no more than limit items)", async () => {
      const result = await caller.notifications.list({ limit: 5 });
      expect(result.items.length).toBeLessThanOrEqual(5);
    });

    it("each notification has required fields", async () => {
      const result = await caller.notifications.list({ limit: 20 });
      result.items.forEach((n: Record<string, unknown>) => {
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
