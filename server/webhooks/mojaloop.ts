import express, { type Request, type Response } from "express";
import crypto from "crypto";
import { getWebhookSecret } from "../_core/webhookSecretsValidator";
import {
  createLedgerEntry,
  getMojaloopTransactionByTransferId,
  logAuditEvent,
  updateMojaloopTransaction,
} from "../db";

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

export function registerMojaloopWebhookRoute(app: express.Application): void {
  app.post(
    "/api/webhooks/mojaloop",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      let secret: string;
      try {
        secret = getWebhookSecret("MOJALOOP_WEBHOOK_SECRET");
      } catch {
        return res.status(503).json({ error: "Webhook authentication unavailable" });
      }
      const rawBody = req.body instanceof Buffer ? req.body : Buffer.from("");
      const signature = String(req.headers["x-mojaloop-signature"] ?? "");
      if (!signature || !verifySignature(rawBody, signature, secret)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      let input: {
        transferId: string;
        transferState: "RECEIVED" | "RESERVED" | "COMMITTED" | "ABORTED";
        fulfilment?: string;
        completedTimestamp?: string;
        errorInformation?: { errorCode: string; errorDescription: string };
      };
      try {
        input = JSON.parse(rawBody.toString("utf8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON payload" });
      }
      if (!input.transferId || !input.transferState) {
        return res.status(400).json({ error: "Missing transferId or transferState" });
      }

      const tx = await getMojaloopTransactionByTransferId(input.transferId);
      if (!tx) return res.status(404).json({ error: "Transfer not found" });

      const updateData: Record<string, unknown> = {
        status: input.transferState,
        webhookPayload: input,
      };
      if (input.transferState === "COMMITTED") {
        updateData.fulfilment = input.fulfilment ?? null;
        updateData.committedAt = input.completedTimestamp ? new Date(input.completedTimestamp) : new Date();
        const tbTransferId = crypto.randomUUID().replace(/-/g, "").slice(0, 32).padStart(32, "0");
        await createLedgerEntry({
          tbTransferId,
          debitAccountId: "0000000000000002",
          creditAccountId: "0000000000000001",
          amountMinorUnits: Math.round(Number(tx.amount) * 100),
          currency: tx.currency,
          ledger: 1,
          entryType: "duty_payment",
          status: "posted",
          declarationId: tx.declarationId ?? undefined,
          mojaloopTransferId: input.transferId,
          reference: `DUTY-${tx.declarationId ?? "N/A"}`,
          description: `Duty payment settled via Mojaloop webhook (${input.transferId})`,
          postedAt: new Date(),
        });
        await logAuditEvent({
          entityType: "payment",
          entityId: tx.id,
          action: "mojaloop_webhook_committed",
          actorId: tx.initiatedBy,
          actorType: "system",
          newState: { transferId: input.transferId, status: "COMMITTED" },
        });
      }
      if (input.transferState === "ABORTED") {
        updateData.abortedAt = new Date();
        updateData.failureReason = input.errorInformation?.errorDescription ?? "Transfer aborted";
        await logAuditEvent({
          entityType: "payment",
          entityId: tx.id,
          action: "mojaloop_webhook_aborted",
          actorId: tx.initiatedBy,
          actorType: "system",
          newState: { transferId: input.transferId, status: "ABORTED", error: input.errorInformation },
        });
      }
      await updateMojaloopTransaction(input.transferId, updateData as never);
      return res.json({ success: true, transferId: input.transferId, newStatus: input.transferState });
    },
  );
}
