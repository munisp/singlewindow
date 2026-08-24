import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMojaloopTransaction,
  deleteMojaloopTransaction,
  getDb,
  getDeclarationById,
  getMojaloopTransactionByTransferId,
  getMojaloopTransactionsByDeclaration,
  getMojaloopTransactionsByUser,
  getPaymentsByDeclaration,
  logAuditEvent,
  updateMojaloopTransaction,
} from "./db";
import { mojaloopRouter } from "./routers/mojaloop";

vi.mock("./db", () => ({
  createMojaloopTransaction: vi.fn(),
  deleteMojaloopTransaction: vi.fn(),
  getDb: vi.fn(),
  getDeclarationById: vi.fn(),
  getMojaloopTransactionByTransferId: vi.fn(),
  getMojaloopTransactionsByDeclaration: vi.fn(),
  getMojaloopTransactionsByUser: vi.fn(),
  getPaymentsByDeclaration: vi.fn(),
  logAuditEvent: vi.fn(),
  updateMojaloopTransaction: vi.fn(),
}));

const caller = mojaloopRouter.createCaller({
  user: {
    id: 9702,
    openId: "mojaloop-test-user",
    name: "Mojaloop Test User",
    email: "mojaloop@test.com",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { method: "POST", headers: {}, cookies: {} } as any,
  res: {} as any,
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue(null);
  vi.mocked(getDeclarationById).mockResolvedValue({
    id: 7,
    traderId: 9702,
    totalDue: "500.00",
    invoiceCurrency: "GHS",
  } as never);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Mojaloop unavailable")));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mojaloop payment initiation", () => {
  it("does not persist a transaction when the switch is unavailable", async () => {
    await expect(caller.initiatePayment({
      declarationId: 7,
      amount: 500,
      currency: "GHS",
      fspId: "GCB_BANK",
      payerAccount: "payer-12345",
      payerName: "Test Payer",
    })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      message: "Mojaloop switch is unavailable",
    });

    expect(createMojaloopTransaction).not.toHaveBeenCalled();
    expect(deleteMojaloopTransaction).not.toHaveBeenCalled();
    expect(updateMojaloopTransaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
