/**
 * declarations.remediation.test.ts — Phase-6 regression tests
 *
 * SW-M13/SW-13: cleared is only reachable from payment_confirmed /
 *               examination_complete; active red/yellow holds block clearance.
 * SW-18: ML+LLM outage → SCORING_UNAVAILABLE (no HS-hash pseudo-score);
 *        LLM lanes are labelled and never auto-clear (green → yellow).
 * SW-17: duties are exact integer minor units and marked ESTIMATE_UNVERIFIED.
 * SW-22: trade finance applicant is bound to the verified caller.
 * SW-15: fund-flow fees are server-priced (fail closed when unassessed).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  decl: null as null | Record<string, unknown>,
  llmFails: false,
  llmLane: "green",
  mlFails: true,
  updates: [] as Array<Record<string, unknown>>,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (state.decl ? [state.decl] : []) }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [{ id: 1 }] }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [state.decl] }) }) }),
  })),
  createDeclaration: vi.fn(async () => ({ id: 1 })),
  getDeclarationById: vi.fn(async () => state.decl),
  getDeclarationsByTrader: vi.fn(async () => []),
  getAllDeclarations: vi.fn(async () => []),
  updateDeclaration: vi.fn(async (_id: number, v: Record<string, unknown>) => {
    state.updates.push(v);
    return { ...state.decl, ...v };
  }),
  getDeclarationStats: vi.fn(async () => ({})),
  getDeclarationStatsByTrader: vi.fn(async () => ({})),
  logAuditEvent: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  createUserNotification: vi.fn(async () => ({ id: 1 })),
  getProfileByUserId: vi.fn(async () => ({ status: "approved" })),
  getLatestKYCVerification: vi.fn(async () => ({ status: "APPROVED" })),
  withRlsContext: vi.fn(async (_c: unknown, fn: (db: unknown) => unknown) => fn(null)),
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(async () => {
    if (state.llmFails) throw new Error("LLM unavailable");
    return {
      choices: [{ message: { content: JSON.stringify({ score: 12, lane: state.llmLane, factors: [], summary: "llm" }) } }],
    };
  }),
}));

vi.mock("../_core/permify", () => ({
  assertCan: vi.fn(async () => {}),
  setOwner: vi.fn(async () => {}),
}));

vi.mock("../_core/polyglotClients", () => ({
  scoreDeclarationRisk: vi.fn(async () => {
    if (state.mlFails) throw new Error("ML scorer down");
    return { riskScore: 20, lane: "GREEN", mlScore: 20, ruleScore: 0, anomalyScore: 0, triggeredRules: [], shapExplanation: {}, modelVersion: "t", processingMs: 1 };
  }),
  validateDeclarationWithEngine: vi.fn(async () => ({})),
  getCargoPosition: vi.fn(async () => ({})),
}));

vi.mock("../_core/kafka", () => ({ publishEvent: vi.fn(async () => {}), TOPICS: { DECLARATION_SUBMITTED: "d.s" } }));
vi.mock("../_core/wsServer", () => ({ broadcastNotification: vi.fn(), broadcastUnreadCount: vi.fn(), broadcastWorkloadUpdate: vi.fn() }));
vi.mock("../_core/opensearch", () => ({ indexDeclaration: vi.fn(async () => {}), searchDeclarations: vi.fn(async () => ({ hits: [] })) }));
vi.mock("../_core/middlewareClients", () => ({
  fetchWithResilience: vi.fn(async () => new Response("{}", { status: 200 })),
}));

import { appRouter } from "../routers";
import { assertValidTransition } from "../businessRules";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "user", userId = 42): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

beforeEach(() => {
  state.decl = null;
  state.llmFails = false;
  state.llmLane = "green";
  state.mlFails = true;
  state.updates = [];
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
});

describe("SW-M13: transition table", () => {
  it("cleared is not reachable from submitted/under_assessment/payment_pending", () => {
    for (const from of ["submitted", "under_assessment", "payment_pending"] as const) {
      expect(() => assertValidTransition(from, "cleared", "customs_officer")).toThrowError(/Invalid status transition/);
    }
  });
  it("cleared is reachable from payment_confirmed and examination_complete", () => {
    expect(() => assertValidTransition("payment_confirmed", "cleared", "customs_officer")).not.toThrow();
    expect(() => assertValidTransition("examination_complete", "cleared", "customs_officer")).not.toThrow();
  });
});

describe("SW-M13: updateStatus hold assertion", () => {
  it("blocks clearance while a yellow-lane hold is active", async () => {
    state.decl = { id: 5, traderId: 42, status: "payment_confirmed", riskLane: "yellow", aiExplanation: null };
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));
    await expect(caller.declarations.updateStatus({ id: 5, status: "cleared" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("allows clearance from payment_confirmed on a green lane", async () => {
    state.decl = { id: 5, traderId: 42, status: "payment_confirmed", riskLane: "green", aiExplanation: null };
    const caller = appRouter.createCaller(makeCtx("customs_officer", 7));
    await caller.declarations.updateStatus({ id: 5, status: "cleared" });
    expect(state.updates[0].status).toBe("cleared");
  });
});

describe("SW-18: risk scoring fails closed", () => {
  beforeEach(() => {
    state.decl = {
      id: 5, traderId: 42, status: "draft", hsCode: "01012100", countryOfOrigin: "GH",
      invoiceValue: "1000.33", goodsDescription: "Live horses for breeding", declarationType: "import",
      declarationNumber: "TG-2026-X", invoiceCurrency: "USD",
    };
  });

  it("ML+LLM outage → SCORING_UNAVAILABLE, no pseudo-score written", async () => {
    state.mlFails = true; state.llmFails = true;
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.declarations.submit({ id: 5 }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    expect(state.updates).toHaveLength(0);
  });

  it("LLM fallback lane is labelled and green is clamped to yellow", async () => {
    state.mlFails = true; state.llmFails = false; state.llmLane = "green";
    const caller = appRouter.createCaller(makeCtx());
    await caller.declarations.submit({ id: 5 });
    expect(state.updates[0].riskLane).toBe("yellow"); // never auto-clear on LLM output
    expect((state.updates[0].aiExplanation as any).source).toBe("llm-fallback");
    expect((state.updates[0].aiExplanation as any).modelScore).toBe(false);
  });

  it("SW-17: duties are exact minor units and marked ESTIMATE_UNVERIFIED", async () => {
    state.mlFails = false;
    const caller = appRouter.createCaller(makeCtx());
    await caller.declarations.submit({ id: 5 });
    // CIF 1000.33 → duty 100.03, VAT 15% of 1100.36 = 165.05, total 265.08
    expect(state.updates[0].dutyAmount).toBe("100.03");
    expect(state.updates[0].vatAmount).toBe("165.05");
    expect(state.updates[0].totalDue).toBe("265.08");
    expect((state.updates[0].aiExplanation as any).dutyAssessment).toBe("ESTIMATE_UNVERIFIED");
  });
});

describe("SW-22: trade finance applicant binding", () => {
  const lcInput = {
    applicantId: "999", applicantName: "A", beneficiaryName: "B", beneficiaryCountry: "GHA",
    issuingBank: "GCB", amount: 1000, currency: "USD", expiryDate: new Date().toISOString(),
    portOfLoading: "GHACC", portOfDischarge: "NGLOS", goodsDescription: "goods", hsCode: "010121",
  };
  it("a trader cannot create an LC for another applicantId", async () => {
    const caller = appRouter.createCaller(makeCtx("user", 42));
    await expect(caller.tradeFinance.createLC(lcInput)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("an officer may create an LC on behalf of an applicant", async () => {
    const caller = appRouter.createCaller(makeCtx("finance", 7));
    await expect(caller.tradeFinance.createLC(lcInput)).resolves.toBeDefined();
  });
});

describe("SW-15: fund-flow server-side pricing", () => {
  it("export levy without a server assessment fails closed", async () => {
    state.decl = { id: 5, traderId: 42, status: "submitted", levyAmount: null };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.fundFlow.collectExportLevy({ declarationId: 5 }))
      .rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });
  it("import duty collection rejects a declaration not ready for payment", async () => {
    state.decl = { id: 5, traderId: 42, status: "draft" };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.fundFlow.collectImportDuty({ declarationId: 5 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("import duty collection rejects other traders' declarations", async () => {
    state.decl = { id: 5, traderId: 999, status: "payment_pending" };
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.fundFlow.collectImportDuty({ declarationId: 5 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
