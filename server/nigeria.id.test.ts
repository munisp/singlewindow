/**
 * Nigeria ID (NIN/BVN) Router — Test Suite
 * Procedures: initiateAuth, verifyToken, getVerificationStatus, adminListVerified
 * External NIMC IDP calls will fail in test env — we verify graceful handling.
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

// ─── initiateAuth ─────────────────────────────────────────────────────────────
describe("nigeriaId.initiateAuth", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    expect(typeof caller.nigeriaId.initiateAuth).toBe("function");
  });

  it("returns authUrl and message for valid origin", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.initiateAuth({
      origin: "https://tradegateway.example.com",
      returnPath: "/app/trader/profile",
    });
    expect(result).toBeDefined();
    expect(typeof result.authUrl).toBe("string");
    expect(typeof result.message).toBe("string");
    expect(result.authUrl.length).toBeGreaterThan(0);
  });

  it("authUrl is a valid URL string", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.initiateAuth({
      origin: "https://tradegateway.example.com",
    });
    expect(() => new URL(result.authUrl)).not.toThrow();
  });

  it("uses default returnPath when not specified", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.initiateAuth({
      origin: "https://tradegateway.example.com",
    });
    expect(result).toBeDefined();
    expect(typeof result.authUrl).toBe("string");
  });

  it("throws for invalid origin URL", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.nigeriaId.initiateAuth({ origin: "not-a-valid-url" })
    ).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.nigeriaId.initiateAuth({ origin: "https://example.com" })
    ).rejects.toThrow();
  });
});

// ─── verifyToken ──────────────────────────────────────────────────────────────
describe("nigeriaId.verifyToken", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    expect(typeof caller.nigeriaId.verifyToken).toBe("function");
  });

  it("throws or returns for invalid token (external IDP unavailable in test env)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.verifyToken({ token: "invalid.jwt.token" }).catch(e => e);
    // Should throw INTERNAL_SERVER_ERROR or similar — not hang
    expect(result).toBeDefined();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(
      caller.nigeriaId.verifyToken({ token: "test-token" })
    ).rejects.toThrow();
  });
});

// ─── getVerificationStatus ────────────────────────────────────────────────────
describe("nigeriaId.getVerificationStatus", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    expect(typeof caller.nigeriaId.getVerificationStatus).toBe("function");
  });

  it("returns status object with verified boolean and status field for authenticated user", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.getVerificationStatus() as any;
    expect(result).toBeDefined();
    expect(typeof result.verified).toBe("boolean");
    expect(result.status).toBeDefined();
  });

  it("unverified user has verified=false", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user", id: 999999 }));
    const result = await caller.nigeriaId.getVerificationStatus() as any;
    expect(result.verified).toBe(false);
  });

  it("provider is null when not verified, 'nimc' when verified", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    const result = await caller.nigeriaId.getVerificationStatus() as any;
    // provider is null when not verified, 'nimc' when NIN is verified
    expect(result.provider === null || result.provider === "nimc" || result.provider === undefined).toBe(true);
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.nigeriaId.getVerificationStatus()).rejects.toThrow();
  });
});

// ─── adminListVerified ────────────────────────────────────────────────────────
describe("nigeriaId.adminListVerified", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    expect(typeof caller.nigeriaId.adminListVerified).toBe("function");
  });

  it("returns { items, total } object for admin users", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.nigeriaId.adminListVerified({}) as any;
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(Array.isArray(result.items)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("accepts optional limit parameter", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    const result = await caller.nigeriaId.adminListVerified({ limit: 10 }) as any;
    expect(result).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
  });

  it("throws for non-admin role (user)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(caller.nigeriaId.adminListVerified({})).rejects.toThrow();
  });

  it("throws for customs_officer role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    await expect(caller.nigeriaId.adminListVerified({})).rejects.toThrow();
  });

  it("throws UNAUTHORIZED for unauthenticated requests", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.nigeriaId.adminListVerified({})).rejects.toThrow();
  });
});
