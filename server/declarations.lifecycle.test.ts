import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", () => ({
  createDeclaration: vi.fn(),
  getDeclarationById: vi.fn(),
  getDeclarationsByTrader: vi.fn(),
  getAllDeclarations: vi.fn(),
  updateDeclaration: vi.fn(),
  getDeclarationStats: vi.fn(),
  getDeclarationStatsByTrader: vi.fn(),
  logAuditEvent: vi.fn(),
  createNotification: vi.fn(),
  createUserNotification: vi.fn(),
  getProfileByUserId: vi.fn(),
  getLatestKYCVerification: vi.fn(),
  withRlsContext: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("./_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("./_core/permify", () => ({ assertCan: vi.fn(), setOwner: vi.fn() }));
vi.mock("./_core/wsServer", () => ({
  broadcastNotification: vi.fn(),
  broadcastUnreadCount: vi.fn(),
  broadcastWorkloadUpdate: vi.fn(),
}));
vi.mock("./_core/kafka", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
  TOPICS: {
    DECLARATION_SUBMITTED: "declaration.submitted",
    DECLARATION_CLEARED: "declaration.cleared",
    DECLARATION_REJECTED: "declaration.rejected",
    DECLARATION_UPDATED: "declaration.updated",
  },
}));
vi.mock("./_core/opensearch", () => ({
  indexDeclaration: vi.fn().mockResolvedValue(undefined),
  searchDeclarations: vi.fn(),
}));
vi.mock("./_core/polyglotClients", () => ({
  scoreDeclarationRisk: vi.fn(),
  validateDeclarationWithEngine: vi.fn(),
  getCargoPosition: vi.fn(),
}));

import { declarationsRouter } from "./routers/declarations";
import {
  createDeclaration,
  createNotification,
  createUserNotification,
  getDb,
  getDeclarationById,
  getLatestKYCVerification,
  getProfileByUserId,
  logAuditEvent,
  updateDeclaration,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { assertCan, setOwner } from "./_core/permify";
import { broadcastNotification } from "./_core/wsServer";
import { publishEvent } from "./_core/kafka";
import { indexDeclaration } from "./_core/opensearch";
import { scoreDeclarationRisk } from "./_core/polyglotClients";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(role: AuthenticatedUser["role"] = "user", userId = 41): TrpcContext {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `${role}-${userId}`,
    email: `${role}-${userId}@example.test`,
    name: `${role} ${userId}`,
    loginMethod: "manus",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSignedIn: new Date("2026-01-01T00:00:00.000Z"),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

function declaration(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    declarationNumber: "TG-2026-LIFECYCLE",
    ucr: "UCR-LIFECYCLE",
    traderId: 41,
    declarationType: "import",
    status: "draft",
    riskLane: null,
    riskScore: null,
    hsCode: "847130",
    goodsDescription: "Laptop computers for branch office",
    countryOfOrigin: "US",
    countryOfDestination: "GH",
    portOfEntry: "GHTEM",
    grossWeight: "50",
    netWeight: "45",
    numberOfPackages: 10,
    invoiceValue: "1000",
    invoiceCurrency: "USD",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const approvedProfile = {
  id: 1,
  userId: 41,
  status: "approved",
  companyName: "Lifecycle Trading Ltd",
  tinNumber: "TIN-41",
};

const approvedKyc = {
  id: 900,
  userId: 41,
  status: "APPROVED",
  verificationType: "INDIVIDUAL",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createDeclaration).mockResolvedValue(declaration() as any);
  vi.mocked(getDeclarationById).mockResolvedValue(declaration() as any);
  vi.mocked(updateDeclaration).mockResolvedValue(declaration({ status: "under_assessment" }) as any);
  vi.mocked(getProfileByUserId).mockResolvedValue(approvedProfile as any);
  vi.mocked(getLatestKYCVerification).mockResolvedValue(approvedKyc as any);
  vi.mocked(logAuditEvent).mockResolvedValue(undefined as any);
  vi.mocked(createNotification).mockResolvedValue(undefined as any);
  vi.mocked(createUserNotification).mockResolvedValue(undefined as any);
  vi.mocked(setOwner).mockResolvedValue(undefined as any);
  vi.mocked(assertCan).mockResolvedValue(undefined as any);
  vi.mocked(scoreDeclarationRisk).mockResolvedValue({
    riskScore: 27,
    lane: "GREEN",
    mlScore: 23,
    ruleScore: 4,
    anomalyScore: 0,
    triggeredRules: ["trusted_trader"],
    shapExplanation: { trusted_trader: -3 },
    modelVersion: "test-model",
    processingMs: 8,
  } as any);
  vi.mocked(invokeLLM).mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ score: 45, lane: "yellow", factors: [], summary: "Documentary review" }) } }],
  } as any);
  vi.mocked(getDb).mockResolvedValue(null as any);
});

describe("declarations lifecycle — creation and ownership", () => {
  it("serialises declaration input, audits it, and assigns the trader as the Permify owner", async () => {
    const result = await declarationsRouter.createCaller(createContext()).create({
      declarationType: "import",
      hsCode: "847130",
      goodsDescription: "Laptop computers for branch office",
      countryOfOrigin: "US",
      countryOfDestination: "GH",
      portOfEntry: "GHTEM",
      grossWeight: 50.5,
      netWeight: 45.25,
      numberOfPackages: 10,
      invoiceValue: 1_250.75,
      invoiceCurrency: "EUR",
    });

    expect(result.id).toBe(77);
    expect(createDeclaration).toHaveBeenCalledWith(expect.objectContaining({
      traderId: 41,
      status: "draft",
      grossWeight: "50.5",
      netWeight: "45.25",
      invoiceValue: "1250.75",
      invoiceCurrency: "EUR",
      countryOfDestination: "GH",
    }));
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "created",
      actorId: 41,
      actorType: "trader",
    }));
    expect(setOwner).toHaveBeenCalledWith("declaration", 77, 41);
  });

  it("rejects a country-specific HS code that passes the Zod length check but fails Ghana tariff validation", async () => {
    await expect(declarationsRouter.createCaller(createContext()).create({
      declarationType: "import",
      hsCode: "847130",
      goodsDescription: "Laptop computers for branch office",
      countryOfOrigin: "GH",
      portOfEntry: "GHTEM",
      grossWeight: 50,
      netWeight: 45,
      numberOfPackages: 10,
      invoiceValue: 1_000,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(createDeclaration).not.toHaveBeenCalled();
  });

  it("rejects an applicant whose profile is present but has not been approved", async () => {
    vi.mocked(getProfileByUserId).mockResolvedValueOnce({ ...approvedProfile, status: "pending" } as any);

    await expect(declarationsRouter.createCaller(createContext()).create({
      declarationType: "export",
      hsCode: "847130",
      goodsDescription: "Laptop computers for branch office",
      countryOfOrigin: "US",
      portOfEntry: "GHTEM",
      grossWeight: 50,
      netWeight: 45,
      numberOfPackages: 10,
      invoiceValue: 1_000,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("declarations lifecycle — KYC gate and risk assessment", () => {
  it.each([
    [null, "not started"],
    [{ ...approvedKyc, status: "PENDING_REVIEW" }, "PENDING_REVIEW"],
    [{ ...approvedKyc, status: "REJECTED" }, "REJECTED"],
  ])("does not submit a draft when KYC is %s", async (kycRecord, expectedStatus) => {
    vi.mocked(getLatestKYCVerification).mockResolvedValueOnce(kycRecord as any);

    await expect(declarationsRouter.createCaller(createContext()).submit({ id: 77 }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(expectedStatus) });

    expect(updateDeclaration).not.toHaveBeenCalled();
    expect(scoreDeclarationRisk).not.toHaveBeenCalled();
  });

  it("blocks submission by a non-owner and blocks a non-draft declaration before KYC or risk work begins", async () => {
    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ traderId: 99 }) as any);
    await expect(declarationsRouter.createCaller(createContext()).submit({ id: 77 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "payment_pending" }) as any);
    await expect(declarationsRouter.createCaller(createContext()).submit({ id: 77 }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(getLatestKYCVerification).not.toHaveBeenCalled();
    expect(scoreDeclarationRisk).not.toHaveBeenCalled();
  });

  it("uses the primary ML risk result, calculates duties, and emits non-blocking lifecycle side effects", async () => {
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({
      status: "under_assessment",
      riskScore: "27",
      riskLane: "green",
      dutyAmount: "100.00",
      vatAmount: "165.00",
      totalDue: "265.00",
    }) as any);

    const result = await declarationsRouter.createCaller(createContext()).submit({ id: 77 });

    expect(result.status).toBe("under_assessment");
    expect(scoreDeclarationRisk).toHaveBeenCalledWith(expect.objectContaining({
      declarationId: "77",
      traderId: "41",
      totalValue: 1_000,
    }));
    expect(updateDeclaration).toHaveBeenCalledWith(77, expect.objectContaining({
      status: "under_assessment",
      riskScore: "27",
      riskLane: "green",
      dutyAmount: "100.00",
      vatAmount: "165.00",
      totalDue: "265.00",
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: "declaration_submitted",
      message: expect.stringContaining("Total duties: 265.00 USD"),
    }));
    expect(publishEvent).toHaveBeenCalledWith("declaration.submitted", expect.objectContaining({
      eventType: "declaration.submitted",
      payload: expect.objectContaining({ riskLane: "green", totalDue: "265.00" }),
    }));
    expect(indexDeclaration).toHaveBeenCalledWith(expect.objectContaining({
      id: 77,
      status: "under_assessment",
      riskLane: "green",
    }));
  });

  it("falls back to the LLM risk assessment when the ML scorer has no result and tolerates notification delivery failure", async () => {
    vi.mocked(scoreDeclarationRisk).mockResolvedValueOnce(null as any);
    vi.mocked(createUserNotification).mockRejectedValueOnce(new Error("notification centre unavailable"));
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "under_assessment", riskLane: "yellow", riskScore: "45" }) as any);

    await declarationsRouter.createCaller(createContext()).submit({ id: 77 });

    expect(invokeLLM).toHaveBeenCalledOnce();
    expect(updateDeclaration).toHaveBeenCalledWith(77, expect.objectContaining({
      riskScore: "45",
      riskLane: "yellow",
    }));
  });

  it("falls back to deterministic risk scoring when both upstream scoring strategies fail", async () => {
    vi.mocked(scoreDeclarationRisk).mockRejectedValueOnce(new Error("ML unavailable"));
    vi.mocked(invokeLLM).mockResolvedValueOnce({ choices: [{ message: { content: "not-json" } }] } as any);
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "under_assessment", riskLane: "green", riskScore: "20" }) as any);

    await declarationsRouter.createCaller(createContext()).submit({ id: 77 });

    // The character-code sum of "847130" is 311; (311 % 40) + 10 = 41, a yellow lane.
    expect(updateDeclaration).toHaveBeenCalledWith(77, expect.objectContaining({
      riskScore: "41",
      riskLane: "yellow",
      aiExplanation: expect.objectContaining({ summary: "Automated assessment" }),
    }));
  });
});

describe("declarations lifecycle — officer transitions", () => {
  it("permits a customs officer to transition an assessed declaration to payment pending", async () => {
    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "under_assessment" }) as any);
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "payment_pending" }) as any);

    const result = await declarationsRouter.createCaller(createContext("customs_officer" as AuthenticatedUser["role"], 82))
      .updateStatus({ id: 77, status: "payment_pending", notes: "Duty assessment complete" });

    expect(result.status).toBe("payment_pending");
    expect(assertCan).toHaveBeenCalledWith("82", "declaration", "77", "assess");
    expect(updateDeclaration).toHaveBeenCalledWith(77, { status: "payment_pending" });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: "declaration_submitted",
      userId: 41,
    }));
    expect(publishEvent).toHaveBeenCalledWith("declaration.updated", expect.objectContaining({
      eventType: "declaration.payment_pending",
      payload: expect.objectContaining({ previousStatus: "under_assessment", notes: "Duty assessment complete" }),
    }));
  });

  it("uses the hold permission when an assessed declaration is selected for physical examination", async () => {
    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "under_assessment" }) as any);
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "under_examination" }) as any);

    await declarationsRouter.createCaller(createContext("inspector" as AuthenticatedUser["role"], 83))
      .updateStatus({ id: 77, status: "under_examination" });

    expect(assertCan).toHaveBeenCalledWith("83", "declaration", "77", "hold");
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: "status_update",
      body: expect.stringContaining("selected for physical examination"),
    }));
    expect(publishEvent).toHaveBeenCalledWith("declaration.updated", expect.objectContaining({
      eventType: "declaration.under_examination",
    }));
  });

  it("sets the clearance timestamp, uses the release permission, and broadcasts a stored clearance notification", async () => {
    const notification = {
      id: 501,
      title: "Declaration Cleared",
      body: "Goods may be released.",
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
    };
    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "payment_confirmed" }) as any);
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "cleared" }) as any);
    vi.mocked(createUserNotification).mockResolvedValueOnce(notification as any);

    await declarationsRouter.createCaller(createContext("customs_officer" as AuthenticatedUser["role"], 82))
      .updateStatus({ id: 77, status: "cleared" });

    expect(assertCan).toHaveBeenCalledWith("82", "declaration", "77", "release");
    expect(updateDeclaration).toHaveBeenCalledWith(77, expect.objectContaining({
      status: "cleared",
      clearedAt: expect.any(Date),
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: "declaration_cleared" }));
    expect(broadcastNotification).toHaveBeenCalledWith(41, expect.objectContaining({
      id: 501,
      category: "declaration",
      entityId: 77,
    }));
    expect(publishEvent).toHaveBeenCalledWith("declaration.cleared", expect.objectContaining({
      eventType: "declaration.cleared",
    }));
  });

  it("selects rejection-specific user, legacy, and event notifications", async () => {
    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "under_assessment" }) as any);
    vi.mocked(updateDeclaration).mockResolvedValueOnce(declaration({ status: "rejected" }) as any);

    await declarationsRouter.createCaller(createContext("customs_officer" as AuthenticatedUser["role"], 82))
      .updateStatus({ id: 77, status: "rejected", notes: "Invoice requires correction" });

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: "declaration_rejected",
      message: expect.stringContaining("Invoice requires correction"),
    }));
    expect(createUserNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: "declaration_rejected",
      body: expect.stringContaining("Reason: Invoice requires correction"),
    }));
    expect(publishEvent).toHaveBeenCalledWith("declaration.rejected", expect.objectContaining({
      eventType: "declaration.rejected",
    }));
  });

  it("rejects a trader, missing declaration, and impossible state transition before side effects", async () => {
    await expect(declarationsRouter.createCaller(createContext()).updateStatus({ id: 77, status: "cleared" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    vi.mocked(getDeclarationById).mockResolvedValueOnce(null as any);
    await expect(declarationsRouter.createCaller(createContext("admin", 82)).updateStatus({ id: 77, status: "cleared" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    vi.mocked(getDeclarationById).mockResolvedValueOnce(declaration({ status: "draft" }) as any);
    await expect(declarationsRouter.createCaller(createContext("admin", 82)).updateStatus({ id: 77, status: "cleared" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(updateDeclaration).not.toHaveBeenCalled();
  });
});
