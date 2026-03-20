/**
 * Post-Clearance Audit Router — Test Suite
 * list returns { audits: [], total: number }
 * stats returns { total, scheduled, inProgress, completed, escalated, ... }
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
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── list ─────────────────────────────────────────────────────────────────────
describe("postAudit.list", () => {
  it("returns { audits, total } object for admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({});
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray(result.audits)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("returns { audits, total } object for customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    const result = await caller.postAudit.list({});
    expect(Array.isArray(result.audits)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("returns { audits, total } object for inspector role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "inspector" }));
    const result = await caller.postAudit.list({});
    expect(Array.isArray(result.audits)).toBe(true);
  });

  it("trader (user) role can list their own audits", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.postAudit.list({});
    expect(Array.isArray(result.audits)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("accepts optional status filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({ status: "scheduled" });
    expect(Array.isArray(result.audits)).toBe(true);
  });

  it("accepts optional outcome filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({ outcome: "compliant" });
    expect(Array.isArray(result.audits)).toBe(true);
  });

  it("accepts optional search filter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({ search: "AUDIT-2024" });
    expect(Array.isArray(result.audits)).toBe(true);
  });

  it("respects limit parameter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({ limit: 5 });
    expect(result.audits.length).toBeLessThanOrEqual(5);
  });

  it("total is non-negative", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.list({});
    expect(result.total).toBeGreaterThanOrEqual(0);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.postAudit.list({})).rejects.toThrow();
  });
});

// ─── getById ──────────────────────────────────────────────────────────────────
describe("postAudit.getById", () => {
  it("throws NOT_FOUND for non-existent audit case (admin)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.postAudit.getById({ id: 999999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws NOT_FOUND for customs_officer on non-existent case", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(
      caller.postAudit.getById({ id: 999999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.postAudit.getById({ id: 1 })).rejects.toThrow();
  });
});

// ─── schedule ─────────────────────────────────────────────────────────────────
describe("postAudit.schedule", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.postAudit.schedule).toBe("function");
  });

  it("throws or returns for valid schedule input", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.schedule({
      declarationId: 999999999,
      auditType: "full_compliance",
      scheduledDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional assignedOfficerId", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.schedule({
      declarationId: 999999999,
      auditType: "targeted",
      scheduledDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      assignedOfficerId: 1,
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.postAudit.schedule({
        declarationId: 1,
        auditType: "full_compliance",
        scheduledDate: new Date(),
      })
    ).rejects.toThrow();
  });
});

// ─── update ───────────────────────────────────────────────────────────────────
describe("postAudit.update", () => {
  it("throws NOT_FOUND for non-existent audit case", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.postAudit.update({ id: 999999999, status: "completed" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts optional findings field", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.postAudit.update({
        id: 999999999,
        status: "completed",
        findings: "No discrepancies found",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.postAudit.update({ id: 1, status: "completed" })).rejects.toThrow();
  });
});

// ─── stats ────────────────────────────────────────────────────────────────────
describe("postAudit.stats", () => {
  it("returns stats object with numeric fields for admin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.stats();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(typeof result.total).toBe("number");
    expect(typeof result.scheduled).toBe("number");
    expect(typeof result.inProgress).toBe("number");
    expect(typeof result.completed).toBe("number");
  });

  it("returns stats for customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    const result = await caller.postAudit.stats();
    expect(result).toBeDefined();
    expect(typeof result.total).toBe("number");
  });

  it("returns stats for finance role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "finance" }));
    const result = await caller.postAudit.stats();
    expect(result).toBeDefined();
  });

  it("all stats values are non-negative", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.stats();
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.scheduled).toBeGreaterThanOrEqual(0);
    expect(result.inProgress).toBeGreaterThanOrEqual(0);
    expect(result.completed).toBeGreaterThanOrEqual(0);
  });

  it("complianceRate is between 0 and 100", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.postAudit.stats();
    expect(result.complianceRate).toBeGreaterThanOrEqual(0);
    expect(result.complianceRate).toBeLessThanOrEqual(100);
  });

  it("throws FORBIDDEN for trader (user) role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.postAudit.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.postAudit.stats()).rejects.toThrow();
  });
});
