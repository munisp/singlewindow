/**
 * Integration tests for the new tRPC routers:
 *   - kyc: document upload, analysis, verification
 *   - vision: cargo image inspection
 *   - mojaloop: payment initiation, FSP listing
 *   - temporal: workflow status, trigger
 *   - ai: model listing, chat
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Test helpers ─────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-open-id",
    email: "trader@example.com",
    name: "Test Trader",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createAnonContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── auth.me ─────────────────────────────────────────────────────────────────

describe("auth.me", () => {
  it("returns null for unauthenticated users", async () => {
    const ctx = createAnonContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).toBeNull();
  });

  it("returns the current user for authenticated users", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.auth.me();
    expect(result).not.toBeNull();
    expect(result?.email).toBe("trader@example.com");
    expect(result?.role).toBe("user");
  });
});

// ─── mojaloop router ─────────────────────────────────────────────────────────

describe("mojaloop.getSupportedFSPs", () => {
  it("returns a list of financial service providers", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.mojaloop.getSupportedFSPs();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty("fspId");
    expect(result[0]).toHaveProperty("name");
  });

  it("requires authentication", async () => {
    const ctx = createAnonContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.mojaloop.getSupportedFSPs()).rejects.toThrow();
  });
});

// ─── ai router ────────────────────────────────────────────────────────────────

describe("ai.models", () => {
  it("returns model availability information", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.ai.models();
    expect(result).toHaveProperty("ollamaAvailable");
    expect(result).toHaveProperty("installedModels");
    expect(result).toHaveProperty("recommendedModels");
    expect(result).toHaveProperty("forgeAvailable");
    expect(result.forgeAvailable).toBe(true);
    expect(Array.isArray(result.recommendedModels)).toBe(true);
    expect(result.recommendedModels.length).toBeGreaterThan(0);
  });

  it("recommended models include Qwen and DeepSeek variants", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.ai.models();
    const ids = result.recommendedModels.map(m => m.id);
    expect(ids.some(id => id.includes("qwen"))).toBe(true);
    expect(ids.some(id => id.includes("deepseek"))).toBe(true);
  });
});

// ─── temporal router ─────────────────────────────────────────────────────────

describe("temporal.getSystemStatus", () => {
  it("returns workflow engine status", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);
    const result = await caller.temporal.getSystemStatus();
    expect(result).toHaveProperty("temporalAvailable");
    expect(result).toHaveProperty("namespace");
    expect(result).toHaveProperty("taskQueue");
  });

  it("requires admin role", async () => {
    const ctx = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);
    await expect(caller.temporal.getSystemStatus()).rejects.toThrow();
  });
});

// ─── complianceReporting router (v104) ────────────────────────────────────────

describe("complianceReporting.listMyReports", () => {
  it("requires authentication", async () => {
    const ctx = createAnonContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.complianceReporting.listMyReports({ limit: 10 })
    ).rejects.toThrow();
  });

  it("returns an array for authenticated users (empty without DB)", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.complianceReporting.listMyReports({ limit: 10 });
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("complianceReporting.getPortalBranding", () => {
  it("returns branding object without DB", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.complianceReporting.getPortalBranding();
    expect(result).toHaveProperty("portalName");
    expect(result).toHaveProperty("logoUrl");
    expect(result).toHaveProperty("primaryColor");
    expect(result).toHaveProperty("features");
  });
});

// ─── declarations router guard ────────────────────────────────────────────────

describe("declarations.list", () => {
  it("requires authentication", async () => {
    const ctx = createAnonContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.declarations.list({ limit: 10, offset: 0 })
    ).rejects.toThrow();
  });
});
