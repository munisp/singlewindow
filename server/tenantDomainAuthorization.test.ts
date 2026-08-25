import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDomainVerificationHistory: vi.fn(),
  getDomainHealthSummary: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  getDomainVerificationHistory: mocks.getDomainVerificationHistory,
  getDomainHealthSummary: mocks.getDomainHealthSummary,
}));

import { tenantRouter } from "./routers/tenant";

const tenantId = "4d1ef3c0-2a59-4e14-863e-7b9751c4c001";

function makeCaller(role: string, userId = 7) {
  return tenantRouter.createCaller({
    user: { id: userId, role, openId: `user-${userId}`, name: "Test User", email: "test@example.com" },
    req: {} as never,
    res: {} as never,
  } as never);
}

function membershipDb(rows: Array<{ id: number }>) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { select };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDomainVerificationHistory.mockResolvedValue([{ id: "event-1" }]);
  mocks.getDomainHealthSummary.mockResolvedValue({ total: 1, successRate: 100 });
});

describe("tenant domain-health access control", () => {
  it("allows a tenant member to view verification history", async () => {
    mocks.getDb.mockResolvedValue(membershipDb([{ id: 1 }]));

    await expect(makeCaller("trader").getDomainVerificationHistory({ tenantId, limit: 5 }))
      .resolves.toEqual([{ id: "event-1" }]);
    expect(mocks.getDomainVerificationHistory).toHaveBeenCalledWith(tenantId, 5);
  });

  it("allows a tenant member to view the domain health summary", async () => {
    mocks.getDb.mockResolvedValue(membershipDb([{ id: 1 }]));

    await expect(makeCaller("customs_officer").getDomainHealthSummary({ tenantId }))
      .resolves.toEqual({ total: 1, successRate: 100 });
    expect(mocks.getDomainHealthSummary).toHaveBeenCalledWith(tenantId);
  });

  it("denies a non-member before reading verification history", async () => {
    mocks.getDb.mockResolvedValue(membershipDb([]));

    await expect(makeCaller("trader").getDomainVerificationHistory({ tenantId, limit: 5 }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDomainVerificationHistory).not.toHaveBeenCalled();
  });

  it("denies a non-member before reading the health summary", async () => {
    mocks.getDb.mockResolvedValue(membershipDb([]));

    await expect(makeCaller("trader").getDomainHealthSummary({ tenantId }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.getDomainHealthSummary).not.toHaveBeenCalled();
  });

  it("allows a platform administrator without requiring a membership lookup", async () => {
    await expect(makeCaller("admin").getDomainHealthSummary({ tenantId }))
      .resolves.toEqual({ total: 1, successRate: 100 });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns a controlled database error when membership cannot be checked", async () => {
    mocks.getDb.mockResolvedValue(null);

    await expect(makeCaller("trader").getDomainHealthSummary({ tenantId }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
