import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { requireDeclarationActor } from "./_core/mandateAuthorization";

const state = vi.hoisted(() => ({
  mandate: undefined as unknown,
  created: [] as any[],
  declaration: {
    id: 7,
    traderId: 1,
    principalId: 1,
    actingAgentId: 2,
    status: "draft" as const,
    declarationNumber: "TG-2026-TEST",
  },
}));

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getActiveStakeholderMandate: vi.fn(async () => state.mandate),
    getProfileByUserId: vi.fn(async () => ({
      id: 1,
      userId: 1,
      stakeholderType: "trader",
      status: "approved",
    })),
    createDeclaration: vi.fn(async (data: any) => {
      const created = { ...data, id: 8 };
      state.created.push(created);
      return created;
    }),
    getDeclarationById: vi.fn(async () => state.declaration),
    getLatestKYCVerification: vi.fn(async () => ({
      status: "APPROVED",
      userId: 1,
    })),
    logAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./_core/permify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/permify")>();
  return {
    ...actual,
    setOwner: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ score: 10, lane: "green", factors: [], summary: "low" }) } }],
  }),
}));

function context(id: number, role: NonNullable<TrpcContext["user"]>["role"] = "user"): TrpcContext {
  return {
    user: {
      id,
      openId: `mandate-${id}`,
      name: `Mandate ${id}`,
      email: `mandate-${id}@example.com`,
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

const declarationInput = {
  declarationType: "import" as const,
  hsCode: "8471.30",
  goodsDescription: "Laptop computers for resale",
  countryOfOrigin: "US",
  portOfEntry: "Lagos",
  grossWeight: 10,
  netWeight: 9,
  numberOfPackages: 1,
  invoiceValue: 5000,
  invoiceCurrency: "USD",
};

describe("mandate enforcement for third-party filing", () => {
  it("keeps the principal authorized after an agent files the declaration", async () => {
    await expect(
      requireDeclarationActor(state.declaration, { id: 1, role: "user" }),
    ).resolves.toEqual({ principalUserId: 1, actingAgentId: null });
  });

  it("rejects an agent filing without an active mandate", async () => {
    state.mandate = undefined;
    await expect(
      appRouter.createCaller(context(2)).declarations.create({
        ...declarationInput,
        principalUserId: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each(["oga_officer", "inspector"] as const)(
    "does not allow %s to create for an arbitrary principal",
    async (role) => {
      state.mandate = undefined;
      await expect(
        appRouter.createCaller(context(3, role)).declarations.create({
          ...declarationInput,
          principalUserId: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it.each(["admin", "customs_officer"] as const)(
    "allows %s to use the creation override",
    async (role) => {
      const result = await appRouter.createCaller(context(3, role)).declarations.create({
        ...declarationInput,
        principalUserId: 1,
      });
      expect(result.principalId).toBe(1);
      expect(result.actingAgentId).toBeNull();
    },
  );

  it.each(["admin", "finance", "customs_officer"] as const)(
    "retains %s payment operational override",
    async (role) => {
      await expect(
        requireDeclarationActor(
          state.declaration,
          { id: 3, role },
          { allowOperationalOverride: true },
        ),
      ).resolves.toEqual({ principalUserId: 1, actingAgentId: null });
    },
  );

  it.each(["oga_officer", "inspector"] as const)(
    "does not grant %s payment operational override",
    async (role) => {
      await expect(
        requireDeclarationActor(
          state.declaration,
          { id: 3, role },
          { allowOperationalOverride: true },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );

  it("accepts an active mandate and records principal and acting agent", async () => {
    state.mandate = { id: 1, principalUserId: 1, agentUserId: 2 };
    state.created.length = 0;
    const result = await appRouter.createCaller(context(2)).declarations.create({
      ...declarationInput,
      principalUserId: 1,
    });
    expect(result.traderId).toBe(1);
    expect(result.principalId).toBe(1);
    expect(result.actingAgentId).toBe(2);
  });

  it.each([
    ["revoked", undefined],
    ["expired mandate", undefined],
    ["expired agent licence", undefined],
  ])("rejects filing with %s", async (_label, mandate) => {
    state.mandate = mandate;
    await expect(
      appRouter.createCaller(context(2)).declarations.create({
        ...declarationInput,
        principalUserId: 1,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechecks the mandate before a draft is submitted", async () => {
    state.mandate = undefined;
    await expect(
      appRouter.createCaller(context(2)).declarations.submit({ id: 7 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
