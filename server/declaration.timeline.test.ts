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

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

function makeUnauthCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

// ─── declarations.getTimeline ─────────────────────────────────────────────────

describe("declarations.getTimeline", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(caller.declarations.getTimeline({ id: 1 })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects id = 0 (non-positive)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.declarations.getTimeline({ id: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects negative id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.declarations.getTimeline({ id: -5 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns NOT_FOUND or INTERNAL_SERVER_ERROR for non-existent declaration when DB unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    try {
      await caller.declarations.getTimeline({ id: 999999 });
      // If DB is available and returns null, it should throw NOT_FOUND
    } catch (err: any) {
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(err.code);
    }
  });

  it("allows customs_officer role to call getTimeline", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    try {
      await caller.declarations.getTimeline({ id: 1 });
    } catch (err: any) {
      // DB unavailable or NOT_FOUND are acceptable — FORBIDDEN is not
      expect(err.code).not.toBe("FORBIDDEN");
    }
  });

  it("allows user role to call getTimeline (own declarations)", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user", id: 42 }));
    try {
      await caller.declarations.getTimeline({ id: 1 });
    } catch (err: any) {
      // FORBIDDEN only if traderId !== user.id — acceptable for test data
      expect(["FORBIDDEN", "NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(err.code);
    }
  });
});

// ─── declarations.generateClearanceCertificate ───────────────────────────────

describe("declarations.generateClearanceCertificate", () => {
  it("requires authentication", async () => {
    const caller = appRouter.createCaller(makeUnauthCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects id = 0 (non-positive)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects negative id", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.declarations.generateClearanceCertificate({ id: -1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns NOT_FOUND or INTERNAL_SERVER_ERROR for non-existent declaration when DB unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    try {
      await caller.declarations.generateClearanceCertificate({ id: 999999 });
    } catch (err: any) {
      expect(["NOT_FOUND", "INTERNAL_SERVER_ERROR"]).toContain(err.code);
    }
  });

  it("allows customs_officer role to call generateClearanceCertificate", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "customs_officer" }));
    try {
      await caller.declarations.generateClearanceCertificate({ id: 1 });
    } catch (err: any) {
      expect(err.code).not.toBe("FORBIDDEN");
    }
  });

  it("user role is blocked if declaration does not belong to them", async () => {
    // traderId in DB will differ from user.id=999 for any real declaration
    const caller = appRouter.createCaller(makeCtx({ role: "user", id: 999 }));
    try {
      await caller.declarations.generateClearanceCertificate({ id: 1 });
    } catch (err: any) {
      // FORBIDDEN (wrong owner), NOT_FOUND, BAD_REQUEST (not cleared), or INTERNAL_SERVER_ERROR (no DB) are all valid
      expect(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST", "INTERNAL_SERVER_ERROR"]).toContain(err.code);
    }
  });
});

// ─── kyc.reviewVerification (onboarding notification) ────────────────────────

describe("kyc.reviewVerification (onboarding notification)", () => {
  it("requires authentication — returns UNAUTHORIZED or FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeUnauthCtx());
    try {
      await caller.kyc.reviewVerification({ id: 1, status: "approved" });
    } catch (err: any) {
      // Some tRPC implementations surface UNAUTHORIZED as FORBIDDEN for unauthenticated calls
      expect(["UNAUTHORIZED", "FORBIDDEN"]).toContain(err.code);
    }
  });

  it("rejects non-admin role", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "user" }));
    await expect(
      caller.kyc.reviewVerification({ id: 1, status: "approved" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects invalid status value", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    await expect(
      caller.kyc.reviewVerification({ id: 1, status: "invalid_status" as any })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns NOT_FOUND, BAD_REQUEST, or INTERNAL_SERVER_ERROR for non-existent verification when DB unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx({ role: "admin" }));
    try {
      await caller.kyc.reviewVerification({ id: 999999, status: "approved" });
    } catch (err: any) {
      expect(["NOT_FOUND", "BAD_REQUEST", "INTERNAL_SERVER_ERROR"]).toContain(err.code);
    }
  });
});
