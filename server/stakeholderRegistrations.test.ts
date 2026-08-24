import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const dbState = vi.hoisted(() => ({
  registration: {
    id: 11,
    referenceNumber: "NSW-REG-2026-TEST",
    userId: 2,
    stakeholderType: "freight_forwarder" as const,
    organizationName: "Licensed Clearing Ltd",
    licenseNumber: "LIC-001",
    licenseExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    status: "pending" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  mandate: {
    id: 21,
    referenceNumber: "NSW-MND-2026-TEST",
    principalUserId: 1,
    agentUserId: 2,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date("2027-01-01T00:00:00.000Z"),
    revokedAt: null,
    revokedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  unavailable: false,
  pendingDuplicate: undefined as unknown,
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    createStakeholderRegistration: vi.fn(async (data: any) => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return { ...dbState.registration, ...data };
    }),
    getStakeholderRegistrationByReference: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return dbState.registration;
    }),
    getStakeholderRegistrationById: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return dbState.registration;
    }),
    getPendingStakeholderRegistrationForUser: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return dbState.pendingDuplicate;
    }),
    getStakeholderRegistrationsByUser: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return [dbState.registration];
    }),
    getPendingStakeholderRegistrations: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return [dbState.registration];
    }),
    updateStakeholderRegistration: vi.fn(async (_id: number, data: any) => ({
      ...dbState.registration,
      ...data,
    })),
    getApprovedTraderProfile: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return {
        id: 1,
        userId: 1,
        stakeholderType: "trader",
        status: "approved",
      };
    }),
    getApprovedAgentRegistration: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return {
        ...dbState.registration,
        status: "approved",
      };
    }),
    getApprovedAgentRegistrations: vi.fn(async () => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return [{
        userId: 2,
        organizationName: "Licensed Clearing Ltd",
        licenseNumber: "LIC-001",
        licenseExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
      }];
    }),
    createStakeholderMandate: vi.fn(async (data: any) => {
      if (dbState.unavailable) throw new Error("database unavailable");
      return { ...dbState.mandate, ...data };
    }),
    getStakeholderMandateById: vi.fn(async () => dbState.mandate),
    getStakeholderMandateByReference: vi.fn(async () => dbState.mandate),
    getStakeholderMandatesByPrincipal: vi.fn(async () => [dbState.mandate]),
    getStakeholderMandatesByAgent: vi.fn(async () => [{
      ...dbState.mandate,
      revokedAt: new Date("2026-06-01T00:00:00.000Z"),
      revokedBy: 1,
      revocationReason: "Engagement ended",
    }]),
    revokeStakeholderMandate: vi.fn(async (_id: number, revokedBy: number, reason?: string) => ({
      ...dbState.mandate,
      revokedAt: new Date(),
      revokedBy,
      revocationReason: reason ?? null,
    })),
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
});

function context(id: number, role: "user" | "admin" = "user"): TrpcContext {
  return {
    user: {
      id,
      openId: `stakeholder-${id}`,
      name: `Stakeholder ${id}`,
      email: `stakeholder-${id}@example.com`,
      loginMethod: "test",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { method: "POST", headers: {}, cookies: {} } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("NSW stakeholder registrations and mandates", () => {
  it("mints a reference and starts a registration pending without changing user capability", async () => {
    dbState.unavailable = false;
    const result = await appRouter.createCaller(context(2)).stakeholderRegistrations.register({
      stakeholderType: "freight_forwarder",
      organizationName: "Licensed Clearing Ltd",
      licenseNumber: "LIC-001",
      licenseExpiresAt: "2030-01-01T00:00:00.000Z",
      country: "NG",
    });

    expect(result.referenceNumber).toMatch(/^NSW-REG-/);
    expect(result.status).toBe("pending");
    expect(result.userId).toBe(2);
    expect(result).not.toHaveProperty("role");
  });

  it("allows only an officer to approve and transitions the application", async () => {
    const result = await appRouter.createCaller(context(1, "admin")).stakeholderRegistrations.approve({
      registrationId: 11,
    });
    expect(result.status).toBe("approved");
    expect(result.approvedBy).toBe(1);
  });

  it("rejects a duplicate pending registration and points to the existing reference", async () => {
    dbState.pendingDuplicate = dbState.registration;
    await expect(
      appRouter.createCaller(context(2)).stakeholderRegistrations.register({
        stakeholderType: "freight_forwarder",
        organizationName: "Licensed Clearing Ltd",
        licenseNumber: "LIC-001",
        licenseExpiresAt: "2030-01-01T00:00:00.000Z",
        country: "NG",
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining(dbState.registration.referenceNumber),
    });
    dbState.pendingDuplicate = undefined;
  });

  it("creates and revokes a durable principal-to-agent mandate", async () => {
    const principal = appRouter.createCaller(context(1));
    const mandate = await principal.stakeholderRegistrations.createMandate({
      agentUserId: 2,
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
    });
    expect(mandate.referenceNumber).toMatch(/^NSW-MND-/);
    expect(mandate.principalUserId).toBe(1);
    expect(mandate.agentUserId).toBe(2);

    const revoked = await principal.stakeholderRegistrations.revokeMandate({
      mandateId: 21,
      reason: "Principal ended the engagement",
    });
    expect(revoked.revokedBy).toBe(1);
    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });

  it("lists historical mandates from both relationship sides", async () => {
    const granted = await appRouter.createCaller(context(1)).stakeholderRegistrations.mineMandates({ side: "principal" });
    expect(granted[0].principalUserId).toBe(1);

    const held = await appRouter.createCaller(context(2)).stakeholderRegistrations.mineMandates({ side: "agent" });
    expect(held[0].revokedAt).toBeInstanceOf(Date);
    expect(held[0].revokedBy).toBe(1);
    expect(held[0].revocationReason).toBe("Engagement ended");
  });

  it("lists only the approved agent directory fields needed to grant a mandate", async () => {
    const agents = await appRouter.createCaller(context(1)).stakeholderRegistrations.approvedAgents();
    expect(agents).toEqual([{
      userId: 2,
      organizationName: "Licensed Clearing Ltd",
      licenseNumber: "LIC-001",
      licenseExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    }]);
    expect(agents[0]).not.toHaveProperty("email");
    expect(agents[0]).not.toHaveProperty("role");
  });

  it("fails closed when registration persistence is unavailable", async () => {
    dbState.unavailable = true;
    await expect(
      appRouter.createCaller(context(2)).stakeholderRegistrations.register({
        stakeholderType: "shipping_line",
        organizationName: "Ocean Carrier Ltd",
        country: "NG",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    dbState.unavailable = false;
  });

  it("fails closed when mandate persistence is unavailable", async () => {
    dbState.unavailable = true;
    await expect(
      appRouter.createCaller(context(1)).stakeholderRegistrations.createMandate({
        agentUserId: 2,
        validUntil: "2027-01-01T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    dbState.unavailable = false;
  });

  it("fails closed when registration listing is unavailable", async () => {
    dbState.unavailable = true;
    await expect(
      appRouter.createCaller(context(2)).stakeholderRegistrations.mine(),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(
      appRouter.createCaller(context(2)).stakeholderRegistrations.approvedAgents(),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    dbState.unavailable = false;
  });
});
