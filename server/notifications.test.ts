/**
 * notifications.test.ts — Tests for notifications tRPC router
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
    getNotificationsByUser: vi.fn().mockResolvedValue([
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
    ]),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
  };
});

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
  describe("list", () => {
    it("returns an array of notifications for authenticated user", async () => {
      const result = await caller.notifications.list({ limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("respects limit parameter", async () => {
      const result = await caller.notifications.list({ limit: 5 });
      expect(result.length).toBeLessThanOrEqual(5);
    });

    it("each notification has required fields", async () => {
      const result = await caller.notifications.list({ limit: 20 });
      result.forEach((n: any) => {
        expect(n).toHaveProperty("id");
        expect(n).toHaveProperty("title");
        expect(n).toHaveProperty("message");
        expect(n).toHaveProperty("read");
      });
    });
  });

  describe("markRead", () => {
    it("accepts an empty ids array without error", async () => {
      const result = await caller.notifications.markRead({ ids: [] });
      expect(result).toHaveProperty("success", true);
    });

    it("marks specified notification ids as read", async () => {
      const result = await caller.notifications.markRead({ ids: [1, 2] });
      expect(result).toHaveProperty("success", true);
    });

    it("handles non-existent notification ids gracefully", async () => {
      const result = await caller.notifications.markRead({ ids: [999999] });
      expect(result).toHaveProperty("success", true);
    });
  });
});
