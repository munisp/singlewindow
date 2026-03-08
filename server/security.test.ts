import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock LLM ─────────────────────────────────────────────────────────────────
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            result: "clear",
            matchDetails: {},
          }),
        },
      },
    ],
  }),
}));

// ─── Mock DB ──────────────────────────────────────────────────────────────────
vi.mock("./db", () => ({
  createDeclaration: vi.fn().mockResolvedValue({ id: 1, declarationNumber: "DEC-001" }),
  getDeclarationById: vi.fn().mockResolvedValue({
    id: 1,
    declarationNumber: "DEC-001",
    traderId: 3,
    status: "submitted",
    riskScore: 65,
    riskLane: "YELLOW",
    aiExplanation: "Moderate risk due to high declared value and origin country.",
    sanctionsFlags: [],
  }),
  getDeclarationsByTrader: vi.fn().mockResolvedValue([]),
  getAllDeclarations: vi.fn().mockResolvedValue([]),
  updateDeclaration: vi.fn().mockResolvedValue(undefined),
  getDeclarationStats: vi.fn().mockResolvedValue({ total: 0, green: 0, yellow: 0, red: 0 }),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getDocumentsByDeclaration: vi.fn().mockResolvedValue([]),
  getPermitsByDeclaration: vi.fn().mockResolvedValue([]),
  getPaymentsByDeclaration: vi.fn().mockResolvedValue([]),
  getAuditTrail: vi.fn().mockResolvedValue([]),
  createSecurityAlert: vi.fn().mockResolvedValue(undefined),
  getSecurityAlerts: vi.fn().mockResolvedValue([]),
  acknowledgeAlert: vi.fn().mockResolvedValue(undefined),
  createSanctionsCheck: vi.fn().mockResolvedValue({
    id: 1,
    entityName: "Acme Trading Co",
    entityType: "company",
    checkResult: "clear",
    listsChecked: ["OFAC-SDN", "UN-CONSOLIDATED"],
    matchDetails: {},
    checkedBy: 3,
    createdAt: new Date(),
  }),
  getSanctionsChecksByDeclaration: vi.fn().mockResolvedValue([]),
  getProfileByUserId: vi.fn().mockResolvedValue(null),
  getUserById: vi.fn().mockResolvedValue(null),
  createNotification: vi.fn().mockResolvedValue(undefined),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createSecurityCtx(userId = 3): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `security-00${userId}`,
    email: "security@example.com",
    name: "Security Analyst",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function createUnauthCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Auth guard tests ─────────────────────────────────────────────────────────
describe("security router — auth guards", () => {
  it("rejects unauthenticated sanctions screening", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(
      caller.security.screenEntity({
        entityName: "Test Entity",
        entityType: "company",
      })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated risk explanation", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(
      caller.security.explainRisk({ declarationId: 1 })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated alert listing", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(caller.security.alerts()).rejects.toThrow();
  });
});

// ─── Sanctions screening tests ────────────────────────────────────────────────
describe("security router — screenEntity", () => {
  it("returns a clear result for a clean entity", async () => {
    const { invokeLLM } = await import("./_core/llm");
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({ result: "clear", matchDetails: {} }),
          },
        },
      ],
    } as Awaited<ReturnType<typeof invokeLLM>>);

    const caller = appRouter.createCaller(createSecurityCtx());
    const result = await caller.security.screenEntity({
      entityName: "Acme Trading Co",
      entityType: "company",
    });

    expect(result).toHaveProperty("checkResult");
    expect(result.checkResult).toBe("clear");
    expect(result).toHaveProperty("entityName", "Acme Trading Co");
  });

  it("flags a confirmed match and creates a security alert", async () => {
    const { invokeLLM } = await import("./_core/llm");
    const { createSecurityAlert, createSanctionsCheck } = await import("./db");

    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              result: "confirmed_match",
              matchDetails: { list: "OFAC-SDN", score: 0.98 },
            }),
          },
        },
      ],
    } as Awaited<ReturnType<typeof invokeLLM>>);

    vi.mocked(createSanctionsCheck).mockResolvedValueOnce({
      id: 2,
      entityName: "Sanctioned Corp Ltd",
      entityType: "company",
      checkResult: "confirmed_match",
      listsChecked: ["OFAC-SDN"],
      matchDetails: { list: "OFAC-SDN", score: 0.98 },
      checkedBy: 3,
      createdAt: new Date(),
    } as Awaited<ReturnType<typeof createSanctionsCheck>>);

    const caller = appRouter.createCaller(createSecurityCtx());
    const result = await caller.security.screenEntity({
      entityName: "Sanctioned Corp Ltd",
      entityType: "company",
    });

    expect(result.checkResult).toBe("confirmed_match");
    // Confirmed matches should trigger a security alert
    expect(vi.mocked(createSecurityAlert)).toHaveBeenCalled();
  });

  it("rejects entity name shorter than 2 characters", async () => {
    const caller = appRouter.createCaller(createSecurityCtx());
    await expect(
      caller.security.screenEntity({
        entityName: "A",
        entityType: "company",
      })
    ).rejects.toThrow();
  });
});

// ─── Risk explanation tests ───────────────────────────────────────────────────
describe("security router — explainRisk", () => {
  it("returns risk explanation for own declaration", async () => {
    // User ID 3 matches traderId 3 in the mocked declaration
    const caller = appRouter.createCaller(createSecurityCtx(3));
    const result = await caller.security.explainRisk({ declarationId: 1 });

    expect(result).toHaveProperty("declarationNumber");
    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("riskLane");
    expect(result).toHaveProperty("explanation");
    expect(result.explanation).toBeTruthy();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
  });

  it("rejects access to another trader's declaration", async () => {
    // User ID 99 does not match traderId 3 and is not admin
    const user: AuthenticatedUser = {
      id: 99,
      openId: "other-trader",
      email: "other@example.com",
      name: "Other Trader",
      loginMethod: "manus",
      role: "user", // not admin
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    };
    const ctx: TrpcContext = {
      user,
      req: { protocol: "https", headers: {} } as TrpcContext["req"],
      res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
    };
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.security.explainRisk({ declarationId: 1 })
    ).rejects.toThrow();
  });
});

// ─── Alert management tests ───────────────────────────────────────────────────
describe("security router — alerts", () => {
  it("returns alert list for authenticated user", async () => {
    const caller = appRouter.createCaller(createSecurityCtx());
    const result = await caller.security.alerts({ limit: 20, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
  });

  it("acknowledges an alert", async () => {
    const { acknowledgeAlert } = await import("./db");
    vi.mocked(acknowledgeAlert).mockResolvedValueOnce(undefined);

    const caller = appRouter.createCaller(createSecurityCtx());
    await expect(
      caller.security.acknowledgeAlert({ alertId: 1 })
    ).resolves.not.toThrow();
  });
});
