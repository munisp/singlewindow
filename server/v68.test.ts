// TradeGateway NGSWTP — v68 Vitest Test Suite
// Coverage:
//   1. SSE token issuance and verification (sse.ts)
//   2. SSE handler auth (anomalySSEHandler)
//   3. Kafka consumer message routing (kafkaConsumer.ts)
//   4. 4-eyes expiry cron (fourEyesExpiry.ts)
//   5. RBAC middleware anomaly integration (rbac.go — covered in Go tests)
//   6. anomalyBus event emission

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ─── Mock ENV ─────────────────────────────────────────────────────────────────

vi.mock("./_core/env", () => ({
  ENV: {
    cookieSecret: "test-secret-32-chars-long-enough!",
    databaseUrl: "mysql://localhost/test",
    bootstrapOwnerOpenId: "owner-1",
    isProduction: false,
    externalProviderUrl: "http://provider",
    externalProviderApiKey: "key",
  },
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────

// Chainable mock — all methods return `this` by default.
// .limit() and .values() are terminal (resolve).
// .where() is context-sensitive: after .set() it resolves; otherwise returns chain.
// We implement this by making where() a thenable that also has chain methods.
const makeChainMock = () => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ["select", "from", "update", "set", "insert", "execute"];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Terminal methods
  chain.limit = vi.fn().mockResolvedValue([]);
  chain.values = vi.fn().mockResolvedValue([]);
  // .where() returns a thenable chain (resolves with rowCount AND has .limit)
  const whereResult = {
    then: (resolve: (v: unknown) => void) => resolve({ rowCount: 1 }),
    limit: vi.fn().mockResolvedValue([]),
  };
  chain.where = vi.fn().mockReturnValue(whereResult);
  return chain;
};

const mockDb = makeChainMock();

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ─── Mock notification ────────────────────────────────────────────────────────

const notifyOwnerMock = vi.fn().mockResolvedValue(true);
vi.mock("./_core/notification", () => ({
  notifyOwner: notifyOwnerMock,
}));

// ─── Mock drizzle-orm ─────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  lt: vi.fn((col, val) => ({ type: "lt", col, val })),
  eq: vi.fn((col, val) => ({ type: "eq", col, val })),
  and: vi.fn((...args) => ({ type: "and", args })),
}));

// ─── Mock schema ──────────────────────────────────────────────────────────────

vi.mock("../drizzle/schema", () => ({
  privilegedActionApprovals: { id: "id", status: "status", expiresAt: "expiresAt", approvalRef: "approvalRef" },
  insiderThreatEvents: { id: "id" },
  anomalyDetections: { id: "id" },
  sessionAuditLog: { id: "id" },
}));

// ─── SSE Token Tests ──────────────────────────────────────────────────────────

describe("SSE Token", () => {
  it("issues a token for admin users", async () => {
    const { issueSSEToken } = await import("./sse");
    const token = await issueSSEToken(42, "admin");
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // JWT format
  });

  it("throws for non-admin users", async () => {
    const { issueSSEToken } = await import("./sse");
    await expect(issueSSEToken(1, "user")).rejects.toThrow("Only admin users");
  });

  it("verifies a valid admin token", async () => {
    const { issueSSEToken, verifySSEToken } = await import("./sse");
    const token = await issueSSEToken(99, "admin");
    const payload = await verifySSEToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(99);
    expect(payload?.role).toBe("admin");
  });

  it("returns null for an invalid token", async () => {
    const { verifySSEToken } = await import("./sse");
    const payload = await verifySSEToken("not.a.valid.jwt");
    expect(payload).toBeNull();
  });

  it("returns null for an empty token", async () => {
    const { verifySSEToken } = await import("./sse");
    const payload = await verifySSEToken("");
    expect(payload).toBeNull();
  });

  it("returns null for a tampered token", async () => {
    const { issueSSEToken, verifySSEToken } = await import("./sse");
    const token = await issueSSEToken(1, "admin");
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "1", role: "user" })).toString("base64url");
    const tampered = parts.join(".");
    const payload = await verifySSEToken(tampered);
    expect(payload).toBeNull();
  });
});

// ─── anomalyBus Tests ─────────────────────────────────────────────────────────

describe("anomalyBus", () => {
  it("exports anomalyBus as an EventEmitter", async () => {
    const { anomalyBus } = await import("./sse");
    expect(anomalyBus).toBeInstanceOf(EventEmitter);
  });

  it("emits and receives anomaly events", async () => {
    const { anomalyBus, SSE_EVENT_ANOMALY } = await import("./sse");
    const received: unknown[] = [];
    anomalyBus.on(SSE_EVENT_ANOMALY, (data) => received.push(data));
    anomalyBus.emit(SSE_EVENT_ANOMALY, { userId: "u1", anomalyScore: 0.9 });
    expect(received).toHaveLength(1);
    expect((received[0] as any).userId).toBe("u1");
    anomalyBus.removeAllListeners(SSE_EVENT_ANOMALY);
  });

  it("emits and receives blocked events", async () => {
    const { anomalyBus, SSE_EVENT_BLOCKED } = await import("./sse");
    const received: unknown[] = [];
    anomalyBus.on(SSE_EVENT_BLOCKED, (data) => received.push(data));
    anomalyBus.emit(SSE_EVENT_BLOCKED, { userId: "u2", action: "POST /admin/seed" });
    expect(received).toHaveLength(1);
    anomalyBus.removeAllListeners(SSE_EVENT_BLOCKED);
  });

  it("emits and receives four_eyes events", async () => {
    const { anomalyBus, SSE_EVENT_FOUR_EYES } = await import("./sse");
    const received: unknown[] = [];
    anomalyBus.on(SSE_EVENT_FOUR_EYES, (data) => received.push(data));
    anomalyBus.emit(SSE_EVENT_FOUR_EYES, { type: "four_eyes_expired", approvalRef: "ref-1" });
    expect(received).toHaveLength(1);
    anomalyBus.removeAllListeners(SSE_EVENT_FOUR_EYES);
  });

  it("supports multiple concurrent listeners", async () => {
    const { anomalyBus, SSE_EVENT_ANOMALY } = await import("./sse");
    const counts = [0, 0, 0];
    anomalyBus.on(SSE_EVENT_ANOMALY, () => counts[0]++);
    anomalyBus.on(SSE_EVENT_ANOMALY, () => counts[1]++);
    anomalyBus.on(SSE_EVENT_ANOMALY, () => counts[2]++);
    anomalyBus.emit(SSE_EVENT_ANOMALY, { test: true });
    expect(counts).toEqual([1, 1, 1]);
    anomalyBus.removeAllListeners(SSE_EVENT_ANOMALY);
  });
});

// ─── Kafka Consumer Tests ─────────────────────────────────────────────────────

describe("Kafka Consumer", () => {
  it("exports startInsiderThreatKafkaConsumer as a function", async () => {
    const { startInsiderThreatKafkaConsumer } = await import("./kafkaConsumer");
    expect(typeof startInsiderThreatKafkaConsumer).toBe("function");
  });

  it("exports emitInsiderThreatEvent as a function", async () => {
    const { emitInsiderThreatEvent } = await import("./kafkaConsumer");
    expect(typeof emitInsiderThreatEvent).toBe("function");
  });

  it("emitInsiderThreatEvent emits to anomalyBus", async () => {
    const { emitInsiderThreatEvent } = await import("./kafkaConsumer");
    const { anomalyBus, SSE_EVENT_ANOMALY } = await import("./sse");
    const received: unknown[] = [];
    anomalyBus.on(SSE_EVENT_ANOMALY, (d) => received.push(d));
    emitInsiderThreatEvent(SSE_EVENT_ANOMALY, { userId: "u99", anomalyScore: 0.7 });
    expect(received).toHaveLength(1);
    anomalyBus.removeAllListeners(SSE_EVENT_ANOMALY);
  });

  it("gracefully no-ops when Kafka is unavailable", async () => {
    // kafkajs is not installed in sandbox — should not throw
    const { startInsiderThreatKafkaConsumer } = await import("./kafkaConsumer");
    await expect(startInsiderThreatKafkaConsumer()).resolves.not.toThrow();
  });
});

// ─── 4-Eyes Expiry Cron Tests ─────────────────────────────────────────────

// Build a fresh per-test DB mock with configurable limit return value
function buildTestDb(limitReturn: unknown[] = []) {
  const db: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["select", "from", "update", "set", "insert", "execute"]) {
    db[m] = vi.fn().mockReturnValue(db);
  }
  db.values = vi.fn().mockResolvedValue([]);
  db.limit = vi.fn().mockResolvedValue(limitReturn);
  // .where() is thenable AND has .limit for SELECT queries
  const makeWhere = () => ({
    then: (onFulfilled: (v: unknown) => void, onRejected?: (e: unknown) => void) =>
      Promise.resolve({ rowCount: 1 }).then(onFulfilled, onRejected),
    catch: (fn: (e: unknown) => void) => Promise.resolve({ rowCount: 1 }).catch(fn),
    finally: (fn: () => void) => Promise.resolve({ rowCount: 1 }).finally(fn),
    limit: vi.fn().mockResolvedValue(limitReturn),
  });
  db.where = vi.fn().mockReturnValue(makeWhere());
  return db;
}

describe("4-Eyes Expiry Cron", () => {
  it("exports runFourEyesExpiryCron as a function", async () => {
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    expect(typeof runFourEyesExpiryCron).toBe("function");
  });

  it("exports fourEyesExpiryHandler as a function", async () => {
    const { fourEyesExpiryHandler } = await import("./scheduled/fourEyesExpiry");
    expect(typeof fourEyesExpiryHandler).toBe("function");
  });

  it("no-ops when no expired approvals found", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(buildTestDb([]) as any);
    notifyOwnerMock.mockClear();
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await expect(runFourEyesExpiryCron()).resolves.not.toThrow();
    expect(notifyOwnerMock).not.toHaveBeenCalled();
  });

  it("expires pending approvals and notifies owner", async () => {
    const expiredApproval = {
      id: 1, approvalRef: "4eyes-test-001", requesterId: 42,
      action: "duty-override", entityType: "declaration", entityId: "DEC-001",
      description: "Override duty for test", status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    };
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(buildTestDb([expiredApproval]) as any);
    notifyOwnerMock.mockClear();
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await runFourEyesExpiryCron();
    expect(notifyOwnerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.stringContaining("4-Eyes Approval Expired"),
        content: expect.stringContaining("duty-override"),
      })
    );
  });

  it("emits four_eyes_expired SSE event on expiry", async () => {
    const expiredApproval = {
      id: 2, approvalRef: "4eyes-test-002", requesterId: 7,
      action: "aeo-revoke", entityType: "trader", entityId: "TRD-007",
      description: "Revoke AEO status", status: "pending",
      expiresAt: new Date(Date.now() - 5000),
    };
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(buildTestDb([expiredApproval]) as any);
    const { anomalyBus, SSE_EVENT_FOUR_EYES } = await import("./sse");
    const received: unknown[] = [];
    anomalyBus.on(SSE_EVENT_FOUR_EYES, (d) => received.push(d));
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await runFourEyesExpiryCron();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const event = received[0] as any;
    expect(event.type).toBe("four_eyes_expired");
    expect(event.approvalRef).toBe("4eyes-test-002");
    anomalyBus.removeAllListeners(SSE_EVENT_FOUR_EYES);
  });

  it("sends batch summary when multiple approvals expire", async () => {
    const approvals = [1, 2, 3].map((i) => ({
      id: i, approvalRef: `4eyes-batch-${i}`, requesterId: i,
      action: `action-${i}`, entityType: "platform", entityId: `ent-${i}`,
      description: `desc-${i}`, status: "pending",
      expiresAt: new Date(Date.now() - 1000),
    }));
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(buildTestDb(approvals) as any);
    notifyOwnerMock.mockClear();
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await runFourEyesExpiryCron();
    expect(notifyOwnerMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    const batchCall = notifyOwnerMock.mock.calls.find(
      (c: any[]) => c[0].title?.includes("Batch")
    );
    expect(batchCall).toBeDefined();
  });

  it("handles DB unavailability gracefully", async () => {
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(null as any);
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await expect(runFourEyesExpiryCron()).resolves.not.toThrow();
  });

  it("continues processing remaining approvals if one fails", async () => {
    const approvals = [
      { id: 1, approvalRef: "ok-1", requesterId: 1, action: "a1", entityType: "t", entityId: "e1", description: "d1", status: "pending", expiresAt: new Date(Date.now() - 1000) },
      { id: 2, approvalRef: "fail-2", requesterId: 2, action: "a2", entityType: "t", entityId: "e2", description: "d2", status: "pending", expiresAt: new Date(Date.now() - 1000) },
    ];
    const db = buildTestDb(approvals);
    let whereCount = 0;
    const origWhere = db.where;
    db.where = vi.fn().mockImplementation((...args: unknown[]) => {
      whereCount++;
      if (whereCount === 2) throw new Error("DB error on second update");
      return origWhere(...args);
    });
    const { getDb } = await import("./db");
    vi.mocked(getDb).mockResolvedValueOnce(db as any);
    const { runFourEyesExpiryCron } = await import("./scheduled/fourEyesExpiry");
    await expect(runFourEyesExpiryCron()).resolves.not.toThrow();
  });
});

// ─── SSE Handler Auth Tests ───────────────────────────────────────────────────

describe("SSE Handler Authentication", () => {
  it("rejects requests without a token", async () => {
    const { anomalySSEHandler } = await import("./sse");
    const req = { query: {} } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await anomalySSEHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects requests with an invalid token", async () => {
    const { anomalySSEHandler } = await import("./sse");
    const req = { query: { token: "invalid.jwt.token" } } as any;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any;

    await anomalySSEHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
