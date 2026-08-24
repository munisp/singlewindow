import crypto from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimPaymentIdempotencyKey,
  completePaymentIdempotencyKey,
  createLedgerEntry,
  getLedgerEntryByMojaloopTransferId,
  getMojaloopTransactionByTransferId,
  logAuditEvent,
  releasePaymentIdempotencyKey,
  updateMojaloopTransaction,
} from "./db";
import {
  getOrProvisionTraderAccount,
} from "./_core/paymentAccountProvisioner";
import { tbBridgeAvailable, tbFetch } from "./routers/ledger";
import { registerMojaloopWebhookRoute } from "./webhooks/mojaloop";

vi.mock("./db", () => ({
  claimPaymentIdempotencyKey: vi.fn(),
  completePaymentIdempotencyKey: vi.fn(),
  createLedgerEntry: vi.fn(),
  getLedgerEntryByMojaloopTransferId: vi.fn(),
  getMojaloopTransactionByTransferId: vi.fn(),
  logAuditEvent: vi.fn(),
  releasePaymentIdempotencyKey: vi.fn(),
  updateMojaloopTransaction: vi.fn(),
}));

vi.mock("./_core/paymentAccountProvisioner", () => ({
  getOrProvisionTraderAccount: vi.fn(),
  SYSTEM_ACCOUNTS: { NCS_REVENUE: "ncs-revenue-account" },
}));

vi.mock("./routers/ledger", () => ({
  tbBridgeAvailable: vi.fn(),
  tbFetch: vi.fn(),
}));

const webhookSecret = "mojaloop-test-secret-012345678901234567890";
const transferId = "MJL-WEBHOOK-001";

function signedBody(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", webhookSecret).update(body).digest("hex");
  return { body, signature };
}

async function postWebhook(payload: unknown): Promise<Response> {
  const app = express();
  registerMojaloopWebhookRoute(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind");
    const { body, signature } = signedBody(payload);
    return await fetch(`http://127.0.0.1:${address.port}/api/webhooks/mojaloop`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mojaloop-Signature": signature,
      },
      body,
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const transaction = {
  id: 42,
  transferId,
  initiatedBy: 9702,
  currency: "GHS",
  amount: "500.00",
  declarationId: 7,
  status: "PENDING",
};

const committedPayload = {
  transferId,
  transferState: "COMMITTED",
  fulfilment: "fulfilment-001",
  completedTimestamp: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  process.env.MOJALOOP_WEBHOOK_SECRET = webhookSecret;
  vi.clearAllMocks();
  vi.mocked(getMojaloopTransactionByTransferId).mockResolvedValue(transaction as never);
  vi.mocked(getLedgerEntryByMojaloopTransferId).mockResolvedValue(undefined);
  vi.mocked(claimPaymentIdempotencyKey).mockResolvedValue({ id: 1 } as never);
  vi.mocked(completePaymentIdempotencyKey).mockResolvedValue(undefined);
  vi.mocked(createLedgerEntry).mockResolvedValue({ id: 1 } as never);
  vi.mocked(getOrProvisionTraderAccount).mockResolvedValue("trader-9702");
  vi.mocked(tbFetch).mockResolvedValue({ id: "tb-transfer-001" });
  vi.mocked(updateMojaloopTransaction).mockResolvedValue(transaction as never);
  vi.mocked(logAuditEvent).mockResolvedValue(undefined);
  vi.mocked(releasePaymentIdempotencyKey).mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.MOJALOOP_WEBHOOK_SECRET;
});

describe("Mojaloop webhook settlement", () => {
  it("leaves the transaction unsettled when TigerBeetle is unavailable", async () => {
    vi.mocked(tbBridgeAvailable).mockResolvedValue(false);

    const response = await postWebhook(committedPayload);

    expect(response.status).toBe(503);
    expect(createLedgerEntry).not.toHaveBeenCalled();
    expect(updateMojaloopTransaction).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(releasePaymentIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("uses the durable claim and ledger marker to prevent duplicate settlement", async () => {
    vi.mocked(tbBridgeAvailable).mockResolvedValue(true);
    let persistedLedger: unknown;
    let currentTransaction = { ...transaction };
    vi.mocked(getMojaloopTransactionByTransferId).mockImplementation(async () => currentTransaction as never);
    vi.mocked(updateMojaloopTransaction).mockImplementation(async (_transferId, data) => {
      currentTransaction = { ...currentTransaction, ...data } as typeof currentTransaction;
      return currentTransaction as never;
    });
    vi.mocked(createLedgerEntry).mockImplementation(async () => {
      persistedLedger = { tbTransferId: "tb-transfer-001", mojaloopTransferId: transferId };
      return persistedLedger as never;
    });
    vi.mocked(getLedgerEntryByMojaloopTransferId).mockImplementation(async () => persistedLedger as never);

    const first = await postWebhook(committedPayload);
    const second = await postWebhook(committedPayload);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(tbFetch).toHaveBeenCalledOnce();
    expect(createLedgerEntry).toHaveBeenCalledOnce();
    expect(completePaymentIdempotencyKey).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent duplicate while the first settlement owns the claim", async () => {
    vi.mocked(tbBridgeAvailable).mockResolvedValue(true);
    let claimed = false;
    vi.mocked(claimPaymentIdempotencyKey).mockImplementation(async () => {
      if (claimed) return undefined;
      claimed = true;
      return { id: 1 } as never;
    });
    vi.mocked(tbFetch).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { id: "tb-transfer-001" };
    });

    const [first, second] = await Promise.all([
      postWebhook(committedPayload),
      postWebhook(committedPayload),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 503]);
    expect(tbFetch).toHaveBeenCalledOnce();
    expect(createLedgerEntry).toHaveBeenCalledOnce();
  });
});
