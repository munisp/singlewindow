import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Mock the database helpers ────────────────────────────────────────────────
// myDeclarations uses limit/offset (not page/limit)
// stats is admin-only
// create requires an approved trader profile
vi.mock("./db", () => ({
  createDeclaration: vi.fn().mockResolvedValue({
    id: 1,
    declarationNumber: "DEC-001",
    ucr: "UCR-001",
    traderId: 1,
    status: "draft",
    hsCode: "8471.30",
    goodsDescription: "Laptop computers",
    countryOfOrigin: "US",
    invoiceValue: "5000",
    grossWeight: "50",
    netWeight: "45",
    declarationType: "import",
    portOfEntry: "GHTEM",
    numberOfPackages: 10,
  }),
  getDeclarationById: vi.fn().mockResolvedValue({
    id: 1,
    declarationNumber: "DEC-001",
    ucr: "UCR-001",
    traderId: 1,
    status: "draft",
    hsCode: "8471.30",
    goodsDescription: "Laptop computers",
    countryOfOrigin: "US",
    invoiceValue: "5000",
    grossWeight: "50",
    netWeight: "45",
    declarationType: "import",
    portOfEntry: "GHTEM",
    numberOfPackages: 10,
  }),
  getDeclarationsByTrader: vi.fn().mockResolvedValue([]),
  getAllDeclarations: vi.fn().mockResolvedValue([]),
  updateDeclaration: vi.fn().mockResolvedValue(undefined),
  getDeclarationStats: vi.fn().mockResolvedValue({ total: 5, green: 3, yellow: 1, red: 1 }),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  getDocumentsByDeclaration: vi.fn().mockResolvedValue([]),
  getPermitsByDeclaration: vi.fn().mockResolvedValue([]),
  getPaymentsByDeclaration: vi.fn().mockResolvedValue([]),
  getAuditTrail: vi.fn().mockResolvedValue([]),
  createSecurityAlert: vi.fn().mockResolvedValue(undefined),
  getSecurityAlerts: vi.fn().mockResolvedValue([]),
  createSanctionsCheck: vi.fn().mockResolvedValue(undefined),
  getSanctionsChecksByDeclaration: vi.fn().mockResolvedValue([]),
  // Return an approved profile so create() doesn't throw FORBIDDEN
  getProfileByUserId: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    status: "approved",
    companyName: "Test Co",
    tinNumber: "TIN-001",
  }),
  getUserById: vi.fn().mockResolvedValue(null),
  createNotification: vi.fn().mockResolvedValue(undefined),
  getNotificationsByUser: vi.fn().mockResolvedValue([]),
  createUserNotification: vi.fn().mockResolvedValue(undefined),
  getDeclarationStatsByTrader: vi.fn().mockResolvedValue({ total: 5, green: 3, yellow: 1, red: 1, cleared: 2, rejected: 0 }),
  // withRlsContext: in tests, invoke the callback with a stub Drizzle-like db that returns empty arrays
  withRlsContext: vi.fn().mockImplementation(async (_user: unknown, callback: (db: any) => Promise<unknown>) => {
    const stubSelect = () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }) }),
        orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve([]) }) }),
        limit: () => ({ offset: () => Promise.resolve([]) }),
      }),
    });
    return callback({ select: stubSelect });
  }),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            score: 25,
            lane: "GREEN",
            factors: ["low_value", "trusted_trader"],
            explanation: "Low-risk shipment from trusted trader.",
          }),
        },
      },
    ],
  }),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createTraderCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "trader-001",
    email: "trader@example.com",
    name: "Test Trader",
    loginMethod: "manus",
    role: "user",
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

function createAdminCtx(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "admin-001",
    email: "admin@example.com",
    name: "Admin Officer",
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
describe("declarations router — auth guards", () => {
  it("rejects unauthenticated access to stats", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(caller.declarations.stats()).rejects.toThrow();
  });

  it("rejects unauthenticated access to myDeclarations", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(
      caller.declarations.myDeclarations({ limit: 10, offset: 0 })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated access to submit", async () => {
    const caller = appRouter.createCaller(createUnauthCtx());
    await expect(
      caller.declarations.submit({ declarationId: 1 })
    ).rejects.toThrow();
  });

  it("returns trader-specific stats for trader role", async () => {
    const caller = appRouter.createCaller(createTraderCtx());
    // Traders now get their own stats (not FORBIDDEN) — getDeclarationStatsByTrader is called
    const result = await caller.declarations.stats();
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
  });
});

// ─── Create declaration tests ─────────────────────────────────────────────────
describe("declarations router — create", () => {
  it("creates a draft declaration with required fields for approved trader", async () => {
    const caller = appRouter.createCaller(createTraderCtx());
    const result = await caller.declarations.create({
      hsCode: "8471.30",
      goodsDescription: "Laptop computers",
      countryOfOrigin: "US",
      portOfEntry: "GHTEM",
      grossWeight: 50,
      netWeight: 45,
      numberOfPackages: 10,
      invoiceValue: 5000,
      declarationType: "import",
    });

    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("declarationNumber");
    expect(result).toHaveProperty("ucr");
  });

  it("rejects create for trader without approved profile", async () => {
    const { getProfileByUserId } = await import("./db");
    vi.mocked(getProfileByUserId).mockResolvedValueOnce(null);

    const caller = appRouter.createCaller(createTraderCtx());
    await expect(
      caller.declarations.create({
        hsCode: "8471.30",
        goodsDescription: "Laptop computers",
        countryOfOrigin: "US",
        portOfEntry: "GHTEM",
        grossWeight: 50,
        netWeight: 45,
        numberOfPackages: 10,
        invoiceValue: 5000,
        declarationType: "import",
      })
    ).rejects.toThrow();
  });

  it("rejects create with negative invoice value", async () => {
    const caller = appRouter.createCaller(createTraderCtx());
    await expect(
      caller.declarations.create({
        hsCode: "8471.30",
        goodsDescription: "Laptop computers",
        countryOfOrigin: "US",
        portOfEntry: "GHTEM",
        grossWeight: 50,
        netWeight: 45,
        numberOfPackages: 10,
        invoiceValue: -100,
        declarationType: "import",
      })
    ).rejects.toThrow();
  });

  it("rejects create with empty goods description", async () => {
    const caller = appRouter.createCaller(createTraderCtx());
    await expect(
      caller.declarations.create({
        hsCode: "8471.30",
        goodsDescription: "",
        countryOfOrigin: "US",
        portOfEntry: "GHTEM",
        grossWeight: 50,
        netWeight: 45,
        numberOfPackages: 10,
        invoiceValue: 1000,
        declarationType: "import",
      })
    ).rejects.toThrow();
  });
});

// ─── Submit declaration tests ─────────────────────────────────────────────────
describe("declarations router — submit", () => {
  it("submits a declaration and returns updated declaration with risk lane", async () => {
    const { invokeLLM } = await import("./_core/llm");
    vi.mocked(invokeLLM).mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              score: 25,
              lane: "GREEN",
              factors: ["low_value"],
              explanation: "Low-risk shipment.",
            }),
          },
        },
      ],
    } as Awaited<ReturnType<typeof invokeLLM>>);

    // submit returns the result of updateDeclaration which returns the updated row
    const { updateDeclaration } = await import("./db");
    vi.mocked(updateDeclaration).mockResolvedValueOnce({
      id: 1,
      declarationNumber: "DEC-001",
      ucr: "UCR-001",
      traderId: 1,
      status: "under_assessment",
      riskScore: "25",
      riskLane: "GREEN",
      aiExplanation: "Low-risk shipment.",
      hsCode: "8471.30",
      goodsDescription: "Laptop computers",
      countryOfOrigin: "US",
      invoiceValue: "5000",
      grossWeight: "50",
      netWeight: "45",
      declarationType: "import",
      portOfEntry: "GHTEM",
      numberOfPackages: 10,
    } as Awaited<ReturnType<typeof updateDeclaration>>);

    const caller = appRouter.createCaller(createTraderCtx());
    const result = await caller.declarations.submit({ id: 1 });

    // submit returns the updated declaration row
    expect(result).toHaveProperty("riskLane");
    expect(["GREEN", "YELLOW", "RED"]).toContain(result.riskLane);
    expect(result).toHaveProperty("riskScore");
  });

  it("rejects submit for non-existent declaration", async () => {
    const { getDeclarationById } = await import("./db");
    vi.mocked(getDeclarationById).mockResolvedValueOnce(null);

    const caller = appRouter.createCaller(createTraderCtx());
    await expect(
      caller.declarations.submit({ id: 9999 })
    ).rejects.toThrow();
  });
});

// ─── myDeclarations pagination tests ─────────────────────────────────────────
describe("declarations router — myDeclarations", () => {
  it("returns empty array for trader with no declarations", async () => {
    const caller = appRouter.createCaller(createTraderCtx());
    const result = await caller.declarations.myDeclarations({ limit: 10, offset: 0 });
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── Stats tests (admin only) ─────────────────────────────────────────────────
describe("declarations router — stats (admin)", () => {
  it("returns stats object for admin user", async () => {
    const caller = appRouter.createCaller(createAdminCtx());
    const result = await caller.declarations.stats();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("green");
    expect(result).toHaveProperty("yellow");
    expect(result).toHaveProperty("red");
  });
});
