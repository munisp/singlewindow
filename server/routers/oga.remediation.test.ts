/**
 * oga.remediation.test.ts — Phase-11 regression tests
 *
 * OGA permit state machine: pending|under_review → approved|rejected only;
 * approved/rejected are terminal (no re-approve minting a fresh permit
 * number + expiry, no rejected→approved; re-application = new request row).
 * Declaration clearance hard-blocks when a required permit is not approved
 * or is expired (mirrors Go port-interop store.go:352-355).
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  permit: null as null | Record<string, unknown>,
  decl: null as null | Record<string, unknown>,
  permits: [] as Array<Record<string, unknown>>,
};

vi.mock("../db", () => ({
  getDb: vi.fn(async () => null),
  createOgaPermit: vi.fn(async (d: Record<string, unknown>) => ({ id: 1, ...d })),
  getOgaPermitById: vi.fn(async () => state.permit),
  getPermitsByDeclaration: vi.fn(async () => state.permits),
  getPermitsByOfficer: vi.fn(async () => []),
  transitionOgaPermit: vi.fn(async (_id: number, from: readonly string[], data: Record<string, unknown>) => {
    const p = state.permit;
    if (!p || !from.includes(p.status as string)) return undefined;
    Object.assign(p, data);
    return p;
  }),
  getDeclarationById: vi.fn(async () => state.decl),
  updateDeclaration: vi.fn(async (_id: number, v: Record<string, unknown>) => ({ ...state.decl, ...v })),
  getDeclarationsByTrader: vi.fn(async () => []),
  getAllDeclarations: vi.fn(async () => []),
  createDeclaration: vi.fn(async () => ({ id: 1 })),
  getDeclarationStats: vi.fn(async () => ({})),
  getDeclarationStatsByTrader: vi.fn(async () => ({})),
  getProfileByUserId: vi.fn(async () => ({ status: "approved" })),
  getLatestKYCVerification: vi.fn(async () => ({ status: "APPROVED" })),
  logAuditEvent: vi.fn(async () => {}),
  createNotification: vi.fn(async () => {}),
  createUserNotification: vi.fn(async () => ({ id: 1 })),
  withRlsContext: vi.fn(async (_c: unknown, fn: (db: unknown) => unknown) => fn(null)),
}));

vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn(async () => { throw new Error("offline"); }) }));
vi.mock("../_core/permify", () => ({ assertCan: vi.fn(async () => {}), setOwner: vi.fn(async () => {}) }));
vi.mock("../_core/polyglotClients", () => ({
  scoreDeclarationRisk: vi.fn(async () => { throw new Error("offline"); }),
  scoreDeclarationRiskComposite: vi.fn(async () => { throw new Error("offline"); }),
  configuredRiskScorers: vi.fn(() => ["python-ml"]),
  validateDeclarationWithEngine: vi.fn(async () => ({})),
  getCargoPosition: vi.fn(async () => ({})),
}));
vi.mock("../_core/kafka", () => ({ publishEvent: vi.fn(async () => {}), TOPICS: { OGA_PERMIT_APPROVED: "p.a", OGA_PERMIT_REJECTED: "p.r", OGA_PERMIT_REQUESTED: "p.q", DECLARATION_SUBMITTED: "d.s" } }));
vi.mock("../_core/wsServer", () => ({ broadcastNotification: vi.fn(), broadcastUnreadCount: vi.fn(), broadcastWorkloadUpdate: vi.fn() }));
vi.mock("../_core/opensearch", () => ({ indexDeclaration: vi.fn(async () => {}), searchDeclarations: vi.fn(async () => ({ hits: [] })) }));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function makeCtx(role = "oga_officer", userId = 7): TrpcContext {
  return {
    user: {
      id: userId, openId: `t-${role}`, email: `${role}@e.com`, name: role,
      loginMethod: "manus", role, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    } as TrpcContext["user"],
    req: { protocol: "https", headers: {} } as unknown as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function permit(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: 9, declarationId: 5, agencyCode: "FDA", agencyName: "Food & Drug Authority",
    status, permitNumber: null, expiresAt: null, ...overrides,
  };
}

beforeEach(() => {
  state.permit = permit("pending");
  state.permits = [];
  state.decl = {
    id: 5, traderId: 42, status: "payment_confirmed", riskLane: "green",
    aiExplanation: null, declarationNumber: "TG-2026-X",
  };
});

describe("OGA permit state machine", () => {
  it("approves a pending permit (mints number + 1y expiry)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.oga.approve({ permitId: 9 });
    expect(res.status).toBe("approved");
    expect(res.permitNumber).toMatch(/^PERMIT-/);
    expect(res.expiresAt).toBeDefined();
  });

  it("approves an under_review permit", async () => {
    state.permit = permit("under_review");
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.oga.approve({ permitId: 9 })).resolves.toMatchObject({ status: "approved" });
  });

  it("rejects re-approving an approved permit (terminal)", async () => {
    state.permit = permit("approved", { permitNumber: "PERMIT-OLD", expiresAt: new Date() });
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.oga.approve({ permitId: 9 }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("ILLEGAL_PERMIT_TRANSITION") });
    expect(state.permit!.permitNumber).toBe("PERMIT-OLD"); // unchanged
  });

  it("rejects approved → rejected (terminal)", async () => {
    state.permit = permit("approved", { permitNumber: "PERMIT-OLD", expiresAt: new Date() });
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.oga.reject({ permitId: 9, reason: "documents insufficient" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects rejected → approved (re-application must be a new request row)", async () => {
    state.permit = permit("rejected");
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.oga.approve({ permitId: 9 }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("terminal") });
  });

  it("rejects a pending permit with a reason", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const res = await caller.oga.reject({ permitId: 9, reason: "phytosanitary certificate missing" });
    expect(res.status).toBe("rejected");
  });

  it("returns NOT_FOUND for a missing permit", async () => {
    state.permit = null;
    const caller = appRouter.createCaller(makeCtx());
    await expect(caller.oga.approve({ permitId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("declaration clearance gating on OGA permits", () => {
  const officer = () => appRouter.createCaller(makeCtx("customs_officer", 8));
  const approvedPermit = permit("approved", {
    permitNumber: "PERMIT-OK",
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  });

  it("clears when every permit is approved and unexpired", async () => {
    state.permits = [approvedPermit];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" })).resolves.toMatchObject({ status: "cleared" });
  });

  it("clears when no permits were ever raised (none required)", async () => {
    state.permits = [];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" })).resolves.toMatchObject({ status: "cleared" });
  });

  it("blocks clearance while a permit is pending", async () => {
    state.permits = [permit("pending")];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PERMIT_NOT_APPROVED") });
  });

  it("blocks clearance when a permit was rejected (must re-apply)", async () => {
    state.permits = [permit("rejected")];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PERMIT_NOT_APPROVED") });
  });

  it("blocks clearance when an approved permit is expired", async () => {
    state.permits = [{ ...approvedPermit, expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) }];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PERMIT_EXPIRED") });
  });

  it("blocks clearance when an approved permit lacks number/expiry", async () => {
    state.permits = [permit("approved")];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PERMIT_INVALID") });
  });

  it("ignores not_required permits", async () => {
    state.permits = [permit("not_required"), approvedPermit];
    await expect(officer().declarations.updateStatus({ id: 5, status: "cleared" })).resolves.toMatchObject({ status: "cleared" });
  });
});
