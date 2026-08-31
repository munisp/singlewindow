/**
 * ledgerStats.test.ts
 *
 * Unit tests for the system.ledgerStats tRPC admin procedure.
 * Covers:
 *   - Happy path: bridge returns valid summary → procedure returns ok:true with balances
 *   - Non-OK HTTP response (HTTP 503) → procedure returns ok:false with error field
 *   - Network failure (ECONNREFUSED) → procedure returns ok:false with error field
 *   - Partial response (missing accounts array) → procedure handles gracefully
 *   - Admin-only guard: non-admin user is rejected with FORBIDDEN
 *   - Currency and mode fields are forwarded from the bridge response
 *
 * All external HTTP calls are mocked via vi.stubGlobal("fetch", ...) so no
 * live TigerBeetle bridge is required.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stub getDb so DB-dependent procedures don't crash.
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(null),
  withRlsContext: vi.fn(async (_user: unknown, fn: (db: unknown) => unknown) => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return fn(db);
  }),
}));

// Stub gRPC clients so serviceHealth doesn't attempt real connections.
vi.mock("./grpc-clients", () => ({
  getServiceHealthSummary: vi.fn().mockResolvedValue({}),
  checkGRPCHealth: vi.fn().mockResolvedValue(false),
  getTigerBeetleBridgeModes: vi.fn().mockResolvedValue([]),
}));

// Stub Redis so rateLimitStats doesn't need a live Redis instance.
vi.mock("./_core/redis", () => ({
  redisHealthCheck: vi.fn().mockResolvedValue({ ok: false, latencyMs: null }),
  getRedisClient: vi.fn().mockReturnValue(null),
}));

// Stub notification helper.
vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type MockFetchMap = Record<string, { status: number; body: unknown }>;

function mockFetch(routes: MockFetchMap) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) {
      return { ok: false, status: 404, text: async () => "Not found", json: async () => ({}) };
    }
    const [, { status, body }] = match;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
}

const ADMIN_CTX: TrpcContext = {
  user: { id: 1, openId: "admin-open-id", name: "Admin", email: "admin@example.com", role: "admin", createdAt: new Date() },
  req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
  res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
};

const USER_CTX: TrpcContext = {
  user: { id: 2, openId: "user-open-id", name: "User", email: "user@example.com", role: "user", createdAt: new Date() },
  req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
  res: { clearCookie: () => {}, cookie: () => {} } as unknown as TrpcContext["res"],
};

const SAMPLE_BRIDGE_RESPONSE = {
  summary: {
    totalRevenueConfirmed: "125000",
    totalRevenuePending:   "8500",
    currency:              "GHS",
    mode:                  "simulation",
    timestamp:             "2026-03-16T12:00:00Z",
  },
  accounts: [
    {
      id:             "customs-duty-revenue",
      accountType:    "CUSTOMS_REVENUE_CONFIRMED",
      creditsPosted:  "125000",
      debitsPending:  "0",
      creditsPending: "8500",
    },
    {
      id:             "trader-liability-pool",
      accountType:    "TRADER_LIABILITY",
      creditsPosted:  "0",
      debitsPending:  "133500",
      creditsPending: "0",
    },
  ],
  recentTransfers: [
    { id: "tx-001" },
    { id: "tx-002" },
    { id: "tx-003" },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("system.ledgerStats", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("happy path — bridge returns valid summary", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch({
        "/api/ledger/summary": { status: 200, body: SAMPLE_BRIDGE_RESPONSE },
      }));
    });

    it("returns ok:true", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.ok).toBe(true);
    });

    it("forwards totalRevenueConfirmed from bridge", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.totalRevenueConfirmed).toBe("125000");
    });

    it("forwards totalRevenuePending from bridge", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.totalRevenuePending).toBe("8500");
    });

    it("forwards currency from bridge", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.currency).toBe("GHS");
    });

    it("forwards mode from bridge", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.mode).toBe("simulation");
    });

    it("returns accounts array with correct length", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.accounts).toHaveLength(2);
    });

    it("returns recentTransferCount matching bridge array length", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.recentTransferCount).toBe(3);
    });

    it("includes a numeric checkedAt timestamp", async () => {
      const before = Date.now();
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      const after = Date.now();
      expect(result.checkedAt).toBeGreaterThanOrEqual(before);
      expect(result.checkedAt).toBeLessThanOrEqual(after);
    });
  });

  describe("non-OK HTTP response (HTTP 503)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch({
        "/api/ledger/summary": { status: 503, body: { error: "bridge overloaded" } },
      }));
    });

    it("returns ok:false", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.ok).toBe(false);
    });

    it("returns mode:unavailable", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.mode).toBe("unavailable");
    });

    it("returns zero totals", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.totalRevenueConfirmed).toBe("0");
      expect(result.totalRevenuePending).toBe("0");
    });

    it("returns empty accounts array", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.accounts).toEqual([]);
    });

    it("includes an error field describing the failure", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result).toHaveProperty("error");
      expect(typeof (result as { error?: string }).error).toBe("string");
    });
  });

  describe("network failure (ECONNREFUSED)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    });

    it("returns ok:false", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.ok).toBe(false);
    });

    it("returns mode:unavailable", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.mode).toBe("unavailable");
    });

    it("includes ECONNREFUSED in the error field", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect((result as { error?: string }).error).toContain("ECONNREFUSED");
    });

    it("returns recentTransferCount of 0", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.recentTransferCount).toBe(0);
    });
  });

  describe("partial response — missing recentTransfers array", () => {
    beforeEach(() => {
      const partial = {
        ...SAMPLE_BRIDGE_RESPONSE,
        recentTransfers: undefined,
      };
      vi.stubGlobal("fetch", mockFetch({
        "/api/ledger/summary": { status: 200, body: partial },
      }));
    });

    it("returns ok:true", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.ok).toBe(true);
    });

    it("returns recentTransferCount of 0 when array is missing", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.recentTransferCount).toBe(0);
    });
  });

  describe("admin-only access guard", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", mockFetch({
        "/api/ledger/summary": { status: 200, body: SAMPLE_BRIDGE_RESPONSE },
      }));
    });

    it("throws FORBIDDEN when called by a non-admin user", async () => {
      const caller = appRouter.createCaller(USER_CTX);
      await expect(caller.system.ledgerStats()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("throws FORBIDDEN when called without authentication (adminProcedure guards both)", async () => {
      const anonCtx: TrpcContext = { user: null, db: null };
      const caller = appRouter.createCaller(anonCtx);
      await expect(caller.system.ledgerStats()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("live mode — bridge reports live mode", () => {
    beforeEach(() => {
      const liveResponse = {
        ...SAMPLE_BRIDGE_RESPONSE,
        summary: { ...SAMPLE_BRIDGE_RESPONSE.summary, mode: "live" },
      };
      vi.stubGlobal("fetch", mockFetch({
        "/api/ledger/summary": { status: 200, body: liveResponse },
      }));
    });

    it("forwards mode:live from bridge", async () => {
      const caller = appRouter.createCaller(ADMIN_CTX);
      const result = await caller.system.ledgerStats();
      expect(result.mode).toBe("live");
    });
  });
});
