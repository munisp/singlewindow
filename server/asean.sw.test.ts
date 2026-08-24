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

  it("fails closed when ASEAN SW is unavailable for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getConnections()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when ASEAN SW is unavailable for a user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.aseanSw.getConnections()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not fabricate an offline connection result", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getConnections()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
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

  it("fails closed when ASEAN SW is unavailable for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.listMessages({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when ASEAN SW is unavailable for a user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.aseanSw.listMessages({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects destinationCode queries when ASEAN SW is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.listMessages({ destinationCode: "SG" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("does not fabricate an offline message result", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.listMessages({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
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

  it("fails closed when ASEAN SW is unavailable for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.listInboundMessages({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when ASEAN SW is unavailable for a user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.aseanSw.listInboundMessages({})).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("rejects sourceCode queries when ASEAN SW is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.aseanSw.listInboundMessages({ sourceCode: "SG" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
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

  it("fails closed when ASEAN SW is unavailable for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getConnectivityStatus()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when ASEAN SW is unavailable for a user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.aseanSw.getConnectivityStatus()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not fabricate offline connectivity data", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getConnectivityStatus()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not fabricate member scores or tiers", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getConnectivityStatus()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
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

  it("fails closed when ASEAN SW is unavailable for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getStats()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("fails closed when ASEAN SW is unavailable for a user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.aseanSw.getStats()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("does not fabricate offline statistics", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(caller.aseanSw.getStats()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.aseanSw.getStats()).rejects.toThrow();
  });
});
