import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const state = vi.hoisted(() => ({
  registration: undefined as any,
  declaration: undefined as any,
  permit: undefined as any,
  rateCount: 0,
  dbUnavailable: false,
}));

vi.mock("./_core/redisRateLimiter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/redisRateLimiter")>();
  return {
    ...actual,
    incrementRateLimit: vi.fn(async () => ++state.rateCount),
  };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getStakeholderRegistrationByReference: vi.fn(async (reference: string) =>
      state.dbUnavailable
        ? (() => { throw new Error("database unavailable"); })()
        : state.registration?.referenceNumber === reference ? state.registration : undefined),
    getPublicDeclarationTracking: vi.fn(async (reference: string) =>
      state.dbUnavailable
        ? (() => { throw new Error("database unavailable"); })()
        : state.declaration && [state.declaration.declarationNumber, state.declaration.ucr].includes(reference)
          ? state.declaration
          : undefined),
    getPublicPermitTracking: vi.fn(async (reference: string) =>
      state.dbUnavailable
        ? (() => { throw new Error("database unavailable"); })()
        : state.permit?.permitNumber === reference ? state.permit : undefined),
    getDb: vi.fn(async () => {
      if (state.dbUnavailable) throw new Error("database unavailable");
      return {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: async () => state.permit ? [state.permit] : [],
            }),
          }),
        }),
      };
    }),
  };
});

function publicContext(): TrpcContext {
  return {
    user: null,
    keycloakRoles: [],
    req: {
      method: "GET",
      headers: { "x-forwarded-for": "198.51.100.10" },
      socket: { remoteAddress: "198.51.100.10" },
    } as unknown as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("NSW public tracking and permit validation", () => {
  it("tracks registrations, declarations by UCR, and permits without sensitive fields", async () => {
    state.rateCount = 0;
    state.registration = {
      referenceNumber: "NSW-REG-2026-TRACK",
      stakeholderType: "shipping_line",
      status: "under_review",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      approvedAt: null,
      organizationName: "Private Carrier",
      rejectionReason: "Suspected fraud referral",
    };
    state.declaration = {
      declarationNumber: "DEC-TRACK-1",
      ucr: "UCR-TRACK-1",
      declarationType: "import",
      status: "submitted",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      submittedAt: new Date("2026-01-02T00:00:00.000Z"),
      clearedAt: null,
      goodsDescription: "Secret goods",
      invoiceValue: "999999",
    };
    state.permit = {
      permitNumber: "PERMIT-TRACK-1",
      permitType: "health",
      status: "approved",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
      respondedAt: new Date("2026-01-02T00:00:00.000Z"),
      expiresAt: new Date("2030-01-01T00:00:00.000Z"),
      agencyCode: "FDA",
      agencyName: "Food and Drug Authority",
    };
    const caller = appRouter.createCaller(publicContext());

    const registration = await caller.applicationTracking.track({ referenceNumber: state.registration.referenceNumber });
    expect(registration).toMatchObject({ referenceNumber: state.registration.referenceNumber, type: "shipping_line" });
    expect(registration).not.toHaveProperty("organizationName");
    expect(registration).not.toHaveProperty("rejectionReason");

    const declaration = await caller.applicationTracking.track({ referenceNumber: state.declaration.ucr });
    expect(declaration).toMatchObject({ referenceNumber: state.declaration.declarationNumber, status: "submitted" });
    expect(declaration).not.toHaveProperty("goodsDescription");
    expect(declaration).not.toHaveProperty("invoiceValue");

    const permit = await caller.applicationTracking.track({ referenceNumber: state.permit.permitNumber });
    expect(permit).toMatchObject({ referenceNumber: state.permit.permitNumber, status: "approved" });
    expect(permit).not.toHaveProperty("agencyName");

    const validation = await caller.oga.validatePermit({ permitNumber: state.permit.permitNumber });
    expect(validation).toMatchObject({
      permitNumber: state.permit.permitNumber,
      agencyCode: "FDA",
      agencyName: "Food and Drug Authority",
      isValid: true,
      isExpired: false,
    });
    expect(validation).not.toHaveProperty("reviewNotes");
  });

  it("returns one not-found shape and throttles public reference probing per IP", async () => {
    state.registration = undefined;
    state.declaration = undefined;
    state.permit = undefined;
    state.rateCount = 0;
    const caller = appRouter.createCaller(publicContext());
    const first = caller.applicationTracking.track({ referenceNumber: "UNKNOWN-TRACK-1" });
    await expect(first).rejects.toMatchObject({ code: "NOT_FOUND", message: "Application not found." });

    for (let i = 0; i < 59; i++) {
      await expect(caller.applicationTracking.track({ referenceNumber: `UNKNOWN-TRACK-${i + 2}` }))
        .rejects.toMatchObject({ code: "NOT_FOUND", message: "Application not found." });
    }
    await expect(caller.applicationTracking.track({ referenceNumber: "UNKNOWN-TRACK-LAST" }))
      .rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("reports an expired permit as authentic but not currently valid", async () => {
    state.rateCount = 0;
    state.permit = {
      permitNumber: "PERMIT-EXPIRED",
      permitType: "health",
      status: "approved",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      updatedAt: new Date("2025-01-02T00:00:00.000Z"),
      expiresAt: new Date("2025-01-03T00:00:00.000Z"),
      agencyCode: "FDA",
      agencyName: "Food and Drug Authority",
    };
    const result = await appRouter.createCaller(publicContext()).oga.validatePermit({
      permitNumber: state.permit.permitNumber,
    });
    expect(result.isExpired).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it("fails closed when public tracking storage is unavailable", async () => {
    state.dbUnavailable = true;
    await expect(appRouter.createCaller(publicContext()).applicationTracking.track({
      referenceNumber: "NSW-REG-2026-UNAVAILABLE",
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(appRouter.createCaller(publicContext()).oga.validatePermit({
      permitNumber: "PERMIT-UNAVAILABLE",
    })).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    state.dbUnavailable = false;
  });
});
