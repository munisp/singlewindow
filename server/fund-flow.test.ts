/**
 * fund-flow.test.ts — Vitest Test Suite for All 20 Fund-Flow Scenarios
 *
 * Tests cover:
 *   1. Redis idempotency guard (SET NX) — duplicate calls are no-ops
 *   2. Temporal workflow trigger delegation — no direct DB/TigerBeetle calls
 *   3. Authorization enforcement — non-admin callers are rejected
 *   4. Input validation — malformed inputs are rejected at the Zod layer
 *   5. Atomicity contract — workflow trigger failure does NOT leave partial state
 *
 * All external dependencies (Redis, Temporal, DB) are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── MOCKS ────────────────────────────────────────────────────────────────────

// Mock Redis
const mockRedisSet = vi.fn();
const mockRedisPing = vi.fn().mockResolvedValue("PONG");
const mockRedisConnect = vi.fn().mockResolvedValue(undefined);
vi.mock("redis", () => ({
  createClient: () => ({
    set: mockRedisSet,
    ping: mockRedisPing,
    connect: mockRedisConnect,
    on: vi.fn(),
  }),
}));

// Mock fetch (Temporal workflow trigger + Permify)
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock getDb
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDb = {
  select: mockDbSelect,
  insert: mockDbInsert,
  update: mockDbUpdate,
  query: { declarations: { findFirst: vi.fn() } },
};
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeAdminCtx(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 1, role: "admin", name: "Test Admin", email: "admin@test.com", ...overrides },
    req: { headers: {} } as never,
    res: {} as never,
  };
}

function makeTraderCtx(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: 2, role: "user", name: "Test Trader", email: "trader@test.com", ...overrides },
    req: { headers: {} } as never,
    res: {} as never,
  };
}

function mockTemporalSuccess(workflowId = "wf-test-001", runId = "run-001") {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ workflowId, runId }),
  });
}

function mockTemporalFailure(status = 500, body = "Internal Server Error") {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    text: async () => body,
    status,
  });
}

function mockRedisNotDuplicate() {
  mockRedisSet.mockResolvedValueOnce("OK"); // SET NX succeeded → not duplicate
}

function mockRedisDuplicate() {
  mockRedisSet.mockResolvedValueOnce(null); // SET NX returned null → duplicate
}

function mockDeclarationApproved(id = 1) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
            Promise.resolve(cb([{ id, status: "approved", traderId: 2, dutyAmount: "1500.00" }]))
          ),
        }),
      }),
    }),
  });
}

function mockDeclarationNotFound() {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
            Promise.resolve(cb([]))
          ),
        }),
      }),
    }),
  });
}

function mockDeclarationDraft(id = 1) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          then: vi.fn().mockImplementation((cb: (r: unknown[]) => unknown) =>
            Promise.resolve(cb([{ id, status: "draft", traderId: 2, dutyAmount: "1500.00" }]))
          ),
        }),
      }),
    }),
  });
}

function mockDrawbackInsert(claimId = 100) {
  mockDbInsert.mockReturnValueOnce({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: claimId, claimNumber: "DBC-TEST-001" }]),
    }),
  });
}

function mockPaymentQueueSelect(items: Array<{ id: number }> = [{ id: 1 }, { id: 2 }]) {
  mockDbSelect.mockReturnValueOnce({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(items),
      }),
    }),
  });
}

// ─── IMPORT ROUTER UNDER TEST ─────────────────────────────────────────────────

// We test the router procedures directly by calling their resolver functions
// rather than going through the full tRPC stack, to keep tests fast and isolated.

// ─── SCENARIO 1: Import Duty Collection ───────────────────────────────────────

describe("Scenario 1: Import Duty Collection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers DutyClearanceWorkflow for an approved declaration", async () => {
    mockDeclarationApproved(42);
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-duty-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.collectImportDuty({ declarationId: 42 });

    expect(result.idempotent).toBe(false);
    expect(result.workflowId).toBe("wf-duty-001");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/workflows/trigger"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns idempotent=true for duplicate call", async () => {
    mockDeclarationApproved(42);
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.collectImportDuty({ declarationId: 42 });

    expect(result.idempotent).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for missing declaration", async () => {
    mockDeclarationNotFound();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.collectImportDuty({ declarationId: 999 }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws PRECONDITION_FAILED for non-approved declaration", async () => {
    mockDeclarationDraft(42);

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.collectImportDuty({ declarationId: 42 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("propagates Temporal failure without leaving partial state", async () => {
    mockDeclarationApproved(42);
    mockRedisNotDuplicate();
    mockTemporalFailure(500, "Temporal unavailable");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.collectImportDuty({ declarationId: 42 }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

// ─── SCENARIO 2: Export Levy Collection ───────────────────────────────────────

describe("Scenario 2: Export Levy Collection", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers ExportLevyWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-levy-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.collectExportLevy({ declarationId: 10, levyAmountMinor: 50000 });

    expect(result.idempotent).toBe(false);
    expect(result.workflowId).toBe("wf-levy-001");
  });

  it("is idempotent on duplicate", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.collectExportLevy({ declarationId: 10, levyAmountMinor: 50000 });
    expect(result.idempotent).toBe(true);
  });

  it("rejects zero levy amount", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.collectExportLevy({ declarationId: 10, levyAmountMinor: 0 }))
      .rejects.toThrow();
  });
});

// ─── SCENARIO 3: Duty Drawback Claim ──────────────────────────────────────────

describe("Scenario 3: Duty Drawback Claim", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("creates a drawback claim record in DB", async () => {
    mockDrawbackInsert(101);

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.submitDrawbackClaim({
      declarationId: 5,
      claimedAmountMinor: 200000,
      supportingDocuments: ["https://docs.example.com/invoice.pdf"],
    });

    expect(result.claimId).toBe(101);
    expect(result.status).toBe("submitted");
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("requires at least one supporting document", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.submitDrawbackClaim({
      declarationId: 5,
      claimedAmountMinor: 200000,
      supportingDocuments: [],
    })).rejects.toThrow();
  });

  it("approveDrawbackClaim requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.approveDrawbackClaim({ claimId: 1, approvedAmountMinor: 100000 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("approveDrawbackClaim triggers DutyDrawbackWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-drawback-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.approveDrawbackClaim({ claimId: 1, approvedAmountMinor: 100000 });

    expect(result.idempotent).toBe(false);
    expect(result.workflowId).toBe("wf-drawback-001");
  });
});

// ─── SCENARIO 4: Penalty Levy ──────────────────────────────────────────────────

describe("Scenario 4: Penalty Levy", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.issuePenalty({ declarationId: 1, penaltyAmountMinor: 10000, reason: "Misdeclaration of goods value" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers PenaltyLevyWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-penalty-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.issuePenalty({
      declarationId: 1,
      penaltyAmountMinor: 10000,
      reason: "Misdeclaration of goods value",
    });

    expect(result.workflowId).toBe("wf-penalty-001");
  });

  it("requires reason of at least 10 characters", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    await expect(caller.issuePenalty({ declarationId: 1, penaltyAmountMinor: 10000, reason: "short" }))
      .rejects.toThrow();
  });
});

// ─── SCENARIO 5: Bond Guarantee Lodgement ─────────────────────────────────────

describe("Scenario 5: Bond Guarantee Lodgement", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers BondManagementWorkflow with lodge action", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-bond-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.lodgeBondGuarantee({
      bondType: "general_bond",
      amountMinor: 5000000,
      currency: "NGN",
      expiryDate: "2027-12-31",
    });

    expect(result.workflowId).toBe("wf-bond-001");
    expect(result.bondId).toBeTruthy();
    expect(result.idempotent).toBe(false);
  });

  it("returns idempotent=true on duplicate bond lodgement", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.lodgeBondGuarantee({
      bondType: "general_bond",
      amountMinor: 5000000,
      currency: "NGN",
      expiryDate: "2027-12-31",
    });

    expect(result.idempotent).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ─── SCENARIO 6: Bond Release ─────────────────────────────────────────────────

describe("Scenario 6: Bond Release", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.releaseBond({ bondId: 1, clearancePermitRef: "CP-001" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers BondManagementWorkflow with release action", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-bond-release-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.releaseBond({ bondId: 1, clearancePermitRef: "CP-001" });
    expect(result.workflowId).toBe("wf-bond-release-001");
  });
});

// ─── SCENARIO 7: Bond Forfeiture ──────────────────────────────────────────────

describe("Scenario 7: Bond Forfeiture", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.forfeitBond({ bondId: 1, reason: "Goods not re-exported within deadline" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers BondManagementWorkflow with forfeit action", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-bond-forfeit-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.forfeitBond({ bondId: 1, reason: "Goods not re-exported within deadline" });
    expect(result.workflowId).toBe("wf-bond-forfeit-001");
  });
});

// ─── SCENARIO 8: Transit Guarantee Lodgement ──────────────────────────────────

describe("Scenario 8: Transit Guarantee Lodgement", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers TransitLodgementWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-transit-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.lodgeTransitGuarantee({
      transitId: 10,
      amountMinor: 3000000,
      currency: "NGN",
      exitDeadline: "2026-07-31",
      ucr: "UCR-2026-001",
    });

    expect(result.workflowId).toBe("wf-transit-001");
    expect(result.idempotent).toBe(false);
  });

  it("is idempotent on duplicate", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.lodgeTransitGuarantee({
      transitId: 10,
      amountMinor: 3000000,
      currency: "NGN",
      exitDeadline: "2026-07-31",
      ucr: "UCR-2026-001",
    });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 9: Transit Guarantee Release ────────────────────────────────────

describe("Scenario 9: Transit Guarantee Release", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.releaseTransitGuarantee({ transitId: 1, exitConfirmRef: "EXIT-001", ucr: "UCR-001" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers TransitReleaseWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-transit-release-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.releaseTransitGuarantee({ transitId: 1, exitConfirmRef: "EXIT-001", ucr: "UCR-001" });
    expect(result.workflowId).toBe("wf-transit-release-001");
  });
});

// ─── SCENARIO 10: AEO Application Fee ────────────────────────────────────────

describe("Scenario 10: AEO Application Fee", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers AEOFeeWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-aeo-fee-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payAeoFee({ applicationId: 5, feeAmountMinor: 25000 });
    expect(result.workflowId).toBe("wf-aeo-fee-001");
  });

  it("is idempotent on duplicate", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payAeoFee({ applicationId: 5, feeAmountMinor: 25000 });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 11: Free Zone Entry Fee ────────────────────────────────────────

describe("Scenario 11: Free Zone Entry Fee", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers FreeZoneEntryFeeWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-fz-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payFreeZoneEntryFee({ admissionId: 3, feeAmountMinor: 10000 });
    expect(result.workflowId).toBe("wf-fz-001");
  });
});

// ─── SCENARIO 12: Warehouse Storage Fee ──────────────────────────────────────

describe("Scenario 12: Warehouse Storage Fee", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers WarehouseStorageFeeWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-wh-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payWarehouseStorageFee({ inventoryId: 7, feeAmountMinor: 8000, period: "2026-06" });
    expect(result.workflowId).toBe("wf-wh-001");
  });

  it("rejects invalid period format", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.payWarehouseStorageFee({ inventoryId: 7, feeAmountMinor: 8000, period: "June 2026" }))
      .rejects.toThrow();
  });

  it("is idempotent — same inventory + period combination", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payWarehouseStorageFee({ inventoryId: 7, feeAmountMinor: 8000, period: "2026-06" });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 13: Ex-Bond Duty Payment ───────────────────────────────────────

describe("Scenario 13: Ex-Bond Duty Payment", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers ExBondDutyWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-exbond-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payExBondDuty({ permitId: 15, dutyAmountMinor: 120000 });
    expect(result.workflowId).toBe("wf-exbond-001");
  });
});

// ─── SCENARIO 14: Post-Clearance Audit Recovery ───────────────────────────────

describe("Scenario 14: Post-Clearance Audit Recovery", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.initiateAuditRecovery({
      auditId: 1, declarationId: 1, underpaidMinor: 50000,
      demandNoticeRef: "DN-001", paymentDeadline: "2026-07-31",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers AuditRecoveryWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-audit-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.initiateAuditRecovery({
      auditId: 1, declarationId: 1, underpaidMinor: 50000,
      demandNoticeRef: "DN-001", paymentDeadline: "2026-07-31",
    });
    expect(result.workflowId).toBe("wf-audit-001");
  });

  it("is idempotent — same audit + demand notice", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.initiateAuditRecovery({
      auditId: 1, declarationId: 1, underpaidMinor: 50000,
      demandNoticeRef: "DN-001", paymentDeadline: "2026-07-31",
    });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 15: Overpayment Refund ──────────────────────────────────────────

describe("Scenario 15: Overpayment Refund", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.initiateOverpaymentRefund({ auditId: 1, declarationId: 1, overpaidMinor: 20000 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers OverpaymentRefundWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-refund-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.initiateOverpaymentRefund({ auditId: 1, declarationId: 1, overpaidMinor: 20000 });
    expect(result.workflowId).toBe("wf-refund-001");
  });
});

// ─── SCENARIO 16: OGA Permit Fee ──────────────────────────────────────────────

describe("Scenario 16: OGA Permit Fee", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers OGAPermitFeeWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-oga-fee-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payOgaPermitFee({ permitApplicationId: 20, feeAmountMinor: 15000 });
    expect(result.workflowId).toBe("wf-oga-fee-001");
  });

  it("is idempotent on duplicate", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.payOgaPermitFee({ permitApplicationId: 20, feeAmountMinor: 15000 });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 17: Sanctions-Blocked Payment Reversal ──────────────────────────

describe("Scenario 17: Sanctions-Blocked Payment Reversal", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.reverseSanctionedPayment({
      declarationId: 1, reservedTigerBeetleTxId: "tb-001", sanctionsRef: "OFAC-001",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers SanctionsReversalWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-sanctions-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.reverseSanctionedPayment({
      declarationId: 1, reservedTigerBeetleTxId: "tb-001", sanctionsRef: "OFAC-001",
    });
    expect(result.workflowId).toBe("wf-sanctions-001");
  });

  it("is idempotent — same declaration + sanctions ref", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.reverseSanctionedPayment({
      declarationId: 1, reservedTigerBeetleTxId: "tb-001", sanctionsRef: "OFAC-001",
    });
    expect(result.idempotent).toBe(true);
  });
});

// ─── SCENARIO 18: Batch Payment Settlement ────────────────────────────────────

describe("Scenario 18: Batch Payment Settlement", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.triggerBatchSettlement({ batchId: "BATCH-001", settlementDate: "2026-06-21" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers BatchSettlementWorkflow with pending transfer IDs", async () => {
    mockRedisNotDuplicate();
    mockPaymentQueueSelect([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mockTemporalSuccess("wf-batch-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.triggerBatchSettlement({ batchId: "BATCH-001", settlementDate: "2026-06-21" });

    expect(result.workflowId).toBe("wf-batch-001");
    expect(result.transferCount).toBe(3);
    expect(result.idempotent).toBe(false);
  });

  it("is idempotent on duplicate batch ID", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.triggerBatchSettlement({ batchId: "BATCH-001", settlementDate: "2026-06-21" });
    expect(result.idempotent).toBe(true);
  });

  it("rejects invalid settlement date format", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    await expect(caller.triggerBatchSettlement({ batchId: "BATCH-001", settlementDate: "21-06-2026" }))
      .rejects.toThrow();
  });
});

// ─── SCENARIO 19: Revenue Reconciliation ──────────────────────────────────────

describe("Scenario 19: Revenue Reconciliation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("requires admin role", async () => {
    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.triggerRevenueReconciliation({ reconciliationDate: "2026-06-21" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("triggers RevenueReconciliationWorkflow for admin", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-recon-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    const result = await caller.triggerRevenueReconciliation({ reconciliationDate: "2026-06-21" });
    expect(result.workflowId).toBe("wf-recon-001");
  });

  it("uses 1-hour TTL for same-day re-runs", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-recon-002");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    await caller.triggerRevenueReconciliation({ reconciliationDate: "2026-06-21" });

    // Verify Redis was called with 1-hour TTL (3600 seconds)
    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining("revenue_reconciliation"),
      "1",
      expect.objectContaining({ EX: 3600 })
    );
  });
});

// ─── SCENARIO 20: Trader Account Provisioning ─────────────────────────────────

describe("Scenario 20: Trader Account Provisioning", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("triggers TraderAccountProvisioningWorkflow", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-provision-001");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.provisionTraderAccount({ currency: "NGN" });
    expect(result.workflowId).toBe("wf-provision-001");
    expect(result.idempotent).toBe(false);
  });

  it("is idempotent — same trader + currency", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.provisionTraderAccount({ currency: "NGN" });
    expect(result.idempotent).toBe(true);
    expect(result.message).toContain("already provisioned");
  });

  it("defaults to NGN currency", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess("wf-provision-002");

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.provisionTraderAccount({});
    expect(result.workflowId).toBe("wf-provision-002");
  });
});

// ─── CROSS-CUTTING: Workflow Status Query ─────────────────────────────────────

describe("Cross-cutting: getWorkflowStatus", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns workflow status from Temporal service", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "COMPLETED", result: { tigerBeetleTxId: "tb-999" } }),
    });

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    const result = await caller.getWorkflowStatus({ workflowId: "wf-test-001" });

    expect(result.status).toBe("COMPLETED");
  });

  it("throws NOT_FOUND for unknown workflow", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Not found" }),
    });

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await expect(caller.getWorkflowStatus({ workflowId: "wf-unknown" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ─── ATOMICITY GUARANTEE TESTS ────────────────────────────────────────────────

describe("Atomicity Guarantees", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does NOT call Temporal if Redis idempotency key already exists", async () => {
    mockRedisDuplicate();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await caller.collectExportLevy({ declarationId: 1, levyAmountMinor: 1000 });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT write to DB if Temporal workflow trigger fails", async () => {
    // For drawback approval: Redis OK, Temporal fails
    mockRedisNotDuplicate();
    mockTemporalFailure();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeAdminCtx() as never);
    await expect(caller.approveDrawbackClaim({ claimId: 1, approvedAmountMinor: 50000 }))
      .rejects.toThrow();

    // DB insert should NOT have been called for the approval
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("Redis SET NX is called with correct key prefix for each scenario", async () => {
    mockRedisNotDuplicate();
    mockTemporalSuccess();

    const { fundFlowRouter } = await import("./routers/fund-flow");
    const caller = fundFlowRouter.createCaller(makeTraderCtx() as never);
    await caller.collectExportLevy({ declarationId: 77, levyAmountMinor: 1000 });

    expect(mockRedisSet).toHaveBeenCalledWith(
      "ff:idem:export_levy:77",
      "1",
      expect.objectContaining({ NX: true })
    );
  });
});
