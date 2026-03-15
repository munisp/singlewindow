/**
 * auditLog.test.ts
 *
 * Unit tests for the system.auditLog tRPC procedure.
 * Covers:
 *   - Pagination (page / pageSize)
 *   - All filter types (entityType, actorId, action keyword, fromDate, toDate)
 *   - Combined filters
 *   - Empty-DB fallback (getDb returns null)
 *   - Admin-only access guard (non-admin user is rejected)
 *
 * Uses vi.mock to stub out all database calls so tests run without a live DB.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock getDb so individual tests can control what the DB returns.
vi.mock("./db", () => ({
  getDb: vi.fn(),
  withRlsContext: vi.fn(async (_user: unknown, fn: (db: unknown) => unknown) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return fn(db);
  }),
}));

// Mock the gRPC clients so serviceHealth / rateLimitStats don't attempt real connections.
vi.mock("./grpc-clients", () => ({
  getServiceHealthSummary: vi.fn().mockResolvedValue({}),
  checkGRPCHealth: vi.fn().mockResolvedValue(false),
  getDeclarationGRPCClient: vi.fn().mockReturnValue(null),
  getPaymentGRPCClient: vi.fn().mockReturnValue(null),
  getOGAGRPCClient: vi.fn().mockReturnValue(null),
}));

// Mock Redis health so rateLimitStats doesn't need a real Redis instance.
vi.mock("./_core/redis", () => ({
  redisHealthCheck: vi.fn().mockResolvedValue({ ok: false, latencyMs: null }),
  getRedisClient: vi.fn().mockReturnValue(null),
}));

// Mock notification helper used by system.notifyOwner.
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

import { getDb } from "./db";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  {
    id: 1,
    entityType: "declaration",
    entityId: 101,
    action: "submit",
    actorId: 5,
    actorType: "user",
    ipAddress: "192.168.1.1",
    metadata: null,
    createdAt: new Date("2026-01-10T10:00:00Z"),
  },
  {
    id: 2,
    entityType: "payment",
    entityId: 202,
    action: "initiate",
    actorId: 5,
    actorType: "user",
    ipAddress: "192.168.1.2",
    metadata: { amount: 1500 },
    createdAt: new Date("2026-01-11T12:00:00Z"),
  },
  {
    id: 3,
    entityType: "user",
    entityId: 9,
    action: "role_change",
    actorId: 1,
    actorType: "admin",
    ipAddress: "10.0.0.1",
    metadata: { from: "user", to: "admin" },
    createdAt: new Date("2026-01-12T08:00:00Z"),
  },
];

const COUNT_ROW = [{ count: SAMPLE_ROWS.length }];

/**
 * Build a Drizzle-like chainable mock that resolves with `rows` for the
 * row query and `countRow` for the count query.
 * Promise.allSettled is used in the procedure so both queries run in parallel.
 */
function makeDbMock(rows = SAMPLE_ROWS, countRow = COUNT_ROW) {
  let callIndex = 0;
  const resolveValues = [rows, countRow];

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const chainMethods = ["select", "from", "where", "orderBy", "limit", "offset"];

  for (const m of chainMethods) {
    chain[m] = vi.fn().mockImplementation(() => {
      // When offset() is called it's the terminal call for the row query.
      // When the count select chain ends (no limit/offset) it resolves via execute.
      return chain;
    });
  }

  // Make the chain thenable so `await db.select(...).from(...).where(...).orderBy(...).limit(...).offset(...)`
  // resolves to the correct value in sequence.
  chain.offset = vi.fn().mockImplementation(() => {
    const val = resolveValues[callIndex % 2];
    callIndex++;
    return Promise.resolve(val);
  });

  // The count query ends at .from(...).where(...) — make where() also thenable for that path.
  // We use a dual-mode mock: returns chain AND is thenable.
  chain.where = vi.fn().mockImplementation(() => {
    const val = resolveValues[callIndex % 2];
    callIndex++;
    const promise = Promise.resolve(val);
    // Attach chain methods so further chaining still works (e.g. .orderBy after .where)
    Object.assign(promise, chain);
    return promise;
  });

  return chain;
}

// ─── Context helpers ──────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeAdminUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "admin-open-id",
    email: "admin@tradegateway.io",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    lastSignedIn: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser = makeAdminUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("system.auditLog", () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Access control ────────────────────────────────────────────────────────

  describe("access control", () => {
    it("rejects unauthenticated callers", async () => {
      const caller = appRouter.createCaller({ user: null } as unknown as TrpcContext);
      await expect(caller.system.auditLog({ page: 1, pageSize: 25 })).rejects.toThrow();
    });

    it("rejects non-admin users with FORBIDDEN", async () => {
      const caller = appRouter.createCaller(
        makeCtx({ ...makeAdminUser(), role: "user" })
      );
      await expect(caller.system.auditLog({ page: 1, pageSize: 25 })).rejects.toThrow();
    });

    it("allows admin users", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25 });
      expect(result).toHaveProperty("rows");
      expect(result).toHaveProperty("total");
    });
  });

  // ── Empty-DB fallback ─────────────────────────────────────────────────────

  describe("empty-DB fallback", () => {
    it("returns empty rows and zero total when getDb returns null", async () => {
      vi.mocked(getDb).mockResolvedValue(null as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25 });
      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
    });
  });

  // ── Pagination ────────────────────────────────────────────────────────────

  describe("pagination", () => {
    it("returns page and pageSize in the response", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 2, pageSize: 10 });
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(10);
    });

    it("rejects page < 1", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.system.auditLog({ page: 0, pageSize: 25 })
      ).rejects.toThrow();
    });

    it("rejects pageSize > 100", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.system.auditLog({ page: 1, pageSize: 101 })
      ).rejects.toThrow();
    });

    it("accepts pageSize of exactly 100", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 100 });
      expect(result.pageSize).toBe(100);
    });
  });

  // ── Filters ───────────────────────────────────────────────────────────────

  describe("filters", () => {
    it("accepts a valid entityType filter", async () => {
      const db = makeDbMock([SAMPLE_ROWS[0]], [{ count: 1 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({
        page: 1,
        pageSize: 25,
        entityType: "declaration",
      });
      expect(result).toHaveProperty("rows");
      expect(result.total).toBeGreaterThanOrEqual(0);
    });

    it("rejects an invalid entityType value", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.system.auditLog({
          page: 1,
          pageSize: 25,
          entityType: "invalid_type" as never,
        })
      ).rejects.toThrow();
    });

    it("accepts all valid entityType values", async () => {
      const validTypes = [
        "declaration", "user", "payment", "permit",
        "document", "aeo_application", "kyc_verification",
      ] as const;
      for (const entityType of validTypes) {
        const db = makeDbMock([], [{ count: 0 }]);
        vi.mocked(getDb).mockResolvedValue(db as never);
        const caller = appRouter.createCaller(makeCtx());
        const result = await caller.system.auditLog({ page: 1, pageSize: 25, entityType });
        expect(result).toHaveProperty("rows");
      }
    });

    it("accepts an actorId filter", async () => {
      const db = makeDbMock([SAMPLE_ROWS[0], SAMPLE_ROWS[1]], [{ count: 2 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25, actorId: 5 });
      expect(result).toHaveProperty("rows");
    });

    it("rejects a non-positive actorId", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.system.auditLog({ page: 1, pageSize: 25, actorId: 0 })
      ).rejects.toThrow();
    });

    it("accepts an action keyword filter", async () => {
      const db = makeDbMock([SAMPLE_ROWS[0]], [{ count: 1 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25, action: "submit" });
      expect(result).toHaveProperty("rows");
    });

    it("rejects an action keyword longer than 128 characters", async () => {
      const caller = appRouter.createCaller(makeCtx());
      await expect(
        caller.system.auditLog({ page: 1, pageSize: 25, action: "a".repeat(129) })
      ).rejects.toThrow();
    });

    it("accepts fromDate filter as UTC milliseconds", async () => {
      const db = makeDbMock([SAMPLE_ROWS[1], SAMPLE_ROWS[2]], [{ count: 2 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({
        page: 1,
        pageSize: 25,
        fromDate: new Date("2026-01-11T00:00:00Z").getTime(),
      });
      expect(result).toHaveProperty("rows");
    });

    it("accepts toDate filter as UTC milliseconds", async () => {
      const db = makeDbMock([SAMPLE_ROWS[0]], [{ count: 1 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({
        page: 1,
        pageSize: 25,
        toDate: new Date("2026-01-10T23:59:59Z").getTime(),
      });
      expect(result).toHaveProperty("rows");
    });

    it("accepts combined entityType + actorId + action + date range filters", async () => {
      const db = makeDbMock([SAMPLE_ROWS[0]], [{ count: 1 }]);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({
        page: 1,
        pageSize: 25,
        entityType: "declaration",
        actorId: 5,
        action: "submit",
        fromDate: new Date("2026-01-01T00:00:00Z").getTime(),
        toDate: new Date("2026-01-31T23:59:59Z").getTime(),
      });
      expect(result).toHaveProperty("rows");
      expect(result.page).toBe(1);
    });
  });

  // ── Response shape ────────────────────────────────────────────────────────

  describe("response shape", () => {
    it("returns rows, total, page, and pageSize fields", async () => {
      const db = makeDbMock();
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25 });
      expect(result).toHaveProperty("rows");
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("page");
      expect(result).toHaveProperty("pageSize");
      expect(Array.isArray(result.rows)).toBe(true);
      expect(typeof result.total).toBe("number");
    });

    it("total defaults to 0 when count query returns empty", async () => {
      const db = makeDbMock([], []);
      vi.mocked(getDb).mockResolvedValue(db as never);
      const caller = appRouter.createCaller(makeCtx());
      const result = await caller.system.auditLog({ page: 1, pageSize: 25 });
      expect(result.total).toBe(0);
    });
  });
});
