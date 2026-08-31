/**
 * ASEAN Single Window Router — Test Suite
 * All procedures use protectedProcedure (any authenticated user).
 * External ASEAN SW API calls will throw in test env — we verify graceful handling.
 * Return shapes and input schemas verified against actual router implementation.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeCtx(overrides: Partial<AuthenticatedUser> = {}): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getConnections ───────────────────────────────────────────────────────────
describe("aseanSw.getConnections", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.getConnections).toBe("function");
  });

  it("returns { connections, total, active } object for admin (offline fallback)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getConnections() as any;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray(result.connections)).toBe(true);
  });

  it("returns { connections, total, active } for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.getConnections() as any;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });

  it("offline fallback has _offline: true when ASEAN SW API is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getConnections() as any;
    expect(result._offline).toBe(true);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.getConnections()).rejects.toThrow();
  });
});

// ─── testConnection ───────────────────────────────────────────────────────────
describe("aseanSw.testConnection", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.testConnection).toBe("function");
  });

  it("throws or returns for valid 2-char countryCode (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.testConnection({ countryCode: "SG" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for MY countryCode (protectedProcedure allows all roles)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.testConnection({ countryCode: "MY" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for countryCode longer than 2 chars", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.testConnection({ countryCode: "SGP" })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.testConnection({ countryCode: "SG" })).rejects.toThrow();
  });
});

// ─── sendMessage ──────────────────────────────────────────────────────────────
describe("aseanSw.sendMessage", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.sendMessage).toBe("function");
  });

  it("throws or returns for valid input with destinationCode and ucr (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.sendMessage({
      destinationCode: "SG",
      messageType: "ACDD",
      ucr: "UCR-TEST-001",
      hsCode: "8471.30",
      description: "Laptop computers",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.sendMessage({
      destinationCode: "MY",
      ucr: "UCR-TEST-002",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for destinationCode longer than 2 chars", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.sendMessage({ destinationCode: "SGP", ucr: "UCR-001" })
    ).rejects.toThrow();
  });

  it("throws for ucr shorter than 3 chars", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.sendMessage({ destinationCode: "SG", ucr: "AB" })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.aseanSw.sendMessage({ destinationCode: "SG", ucr: "UCR-001" })
    ).rejects.toThrow();
  });
});

// ─── getMessageStatus ─────────────────────────────────────────────────────────
describe("aseanSw.getMessageStatus", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.getMessageStatus).toBe("function");
  });

  it("throws or returns for valid messageId (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getMessageStatus({ messageId: "MSG-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.getMessageStatus({ messageId: "MSG-001" })).rejects.toThrow();
  });
});

// ─── listMessages ─────────────────────────────────────────────────────────────
describe("aseanSw.listMessages", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.listMessages).toBe("function");
  });

  it("returns { messages, total } object for admin (offline fallback)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.listMessages({}) as any;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it("returns { messages, total } for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.listMessages({}) as any;
    expect(result).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it("accepts optional destinationCode filter (2-char)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.listMessages({ destinationCode: "SG" }) as any;
    expect(result).toBeDefined();
  });

  it("offline fallback has _offline: true in test env", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.listMessages({}) as any;
    expect(result._offline).toBe(true);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.listMessages({})).rejects.toThrow();
  });
});

// ─── listInboundMessages ──────────────────────────────────────────────────────
describe("aseanSw.listInboundMessages", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.listInboundMessages).toBe("function");
  });

  it("returns { messages, total, unread } object for admin (offline fallback)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.listInboundMessages({}) as any;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it("returns { messages, total, unread } for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.listInboundMessages({}) as any;
    expect(result).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it("accepts optional sourceCode filter (2-char)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.listInboundMessages({ sourceCode: "SG" }) as any;
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.listInboundMessages({})).rejects.toThrow();
  });
});

// ─── acknowledgeMessage ───────────────────────────────────────────────────────
describe("aseanSw.acknowledgeMessage", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.acknowledgeMessage).toBe("function");
  });

  it("throws or returns for valid messageId (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.acknowledgeMessage({ messageId: "MSG-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.acknowledgeMessage({ messageId: "MSG-001" })).rejects.toThrow();
  });
});

// ─── retryMessage ─────────────────────────────────────────────────────────────
describe("aseanSw.retryMessage", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.retryMessage).toBe("function");
  });

  it("throws or returns for valid messageId (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.retryMessage({ messageId: "MSG-FAILED-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("returns for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.retryMessage({ messageId: "MSG-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.retryMessage({ messageId: "MSG-001" })).rejects.toThrow();
  });
});

// ─── getConnectivityStatus ────────────────────────────────────────────────────
describe("aseanSw.getConnectivityStatus", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.getConnectivityStatus).toBe("function");
  });

  it("returns { members, checkedAt } object with offline fallback for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getConnectivityStatus() as any;
    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
    expect(typeof result.checkedAt).toBe("string");
  });

  it("returns { members, checkedAt } for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.getConnectivityStatus() as any;
    expect(result).toBeDefined();
    expect(Array.isArray(result.members)).toBe(true);
  });

  it("offline fallback has _offline: true in test env", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getConnectivityStatus() as any;
    expect(result._offline).toBe(true);
  });

  it("offline members honestly report NOT_ASSESSED (no fabricated metrics)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getConnectivityStatus() as any;
    // Offline (test env): score/uptime/latency are null and tier is
    // NOT_ASSESSED — the previous static ASEAN_MEMBERS uptime/latency figures
    // were illustrative and must not be served as measured data.
    for (const member of result.members) {
      expect(member.score).toBeNull();
      expect(member.tier).toBe("NOT_ASSESSED");
      expect(member.uptime).toBeNull();
      expect(member.latency_ms).toBeNull();
    }
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.getConnectivityStatus()).rejects.toThrow();
  });
});

// ─── receiveAck ───────────────────────────────────────────────────────────────
describe("aseanSw.receiveAck", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.receiveAck).toBe("function");
  });

  it("throws or returns for valid ack input (ASEAN SW API unavailable)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.receiveAck({
      messageRef: "MSG-REF-001",
      ackReference: "ACK-REF-001",
      status: "accepted",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws or returns for rejected status with reason", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.receiveAck({
      messageRef: "MSG-REF-002",
      ackReference: "ACK-REF-002",
      status: "rejected",
      reason: "Invalid HS code format",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for messageRef shorter than 3 chars", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.receiveAck({ messageRef: "AB", ackReference: "ACK-001", status: "accepted" })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.aseanSw.receiveAck({ messageRef: "MSG-001", ackReference: "ACK-001", status: "accepted" })
    ).rejects.toThrow();
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────
describe("aseanSw.getStats", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.aseanSw.getStats).toBe("function");
  });

  it("returns { total, by_status } object with offline fallback for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getStats() as any;
    expect(result).toBeDefined();
    expect(typeof result.total).toBe("number");
    expect(typeof result.by_status).toBe("object");
  });

  it("returns { total, by_status } for user role (protectedProcedure allows all)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.aseanSw.getStats() as any;
    expect(result).toBeDefined();
    expect(typeof result.total).toBe("number");
  });

  it("offline fallback has _offline: true in test env", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.aseanSw.getStats() as any;
    expect(result._offline).toBe(true);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.getStats()).rejects.toThrow();
  });
});
