import express, { type Request, type Response } from "express";
import crypto from "crypto";
import { getWebhookSecret } from "../_core/webhookSecretsValidator";
import {
  claimPaymentIdempotencyKey,
  completePaymentIdempotencyKey,
  createLedgerEntry,
  getLedgerEntryByMojaloopTransferId,
  getMojaloopTransactionByTransferId,
  logAuditEvent,
  releasePaymentIdempotencyKey,
  updateMojaloopTransaction,
} from "../db";
import { getOrProvisionTraderAccount, SYSTEM_ACCOUNTS } from "../_core/paymentAccountProvisioner";
import { tbBridgeAvailable, tbFetch } from "../routers/ledger";

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

      if (input.transferState === "COMMITTED") {
        const existingLedgerEntry = await getLedgerEntryByMojaloopTransferId(input.transferId);
        if (existingLedgerEntry) {
          if (tx.status !== "COMMITTED") {
            await updateMojaloopTransaction(input.transferId, {
              status: "COMMITTED",
              fulfilment: input.fulfilment ?? null,
              committedAt: input.completedTimestamp ? new Date(input.completedTimestamp) : new Date(),
              webhookPayload: input,
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
          return res.json({ success: true, transferId: input.transferId, newStatus: "COMMITTED" });
        }

        const keyHash = crypto
          .createHash("sha256")
          .update(`mojaloop-webhook-settlement:${input.transferId}`)
          .digest("hex");
        let claim;
        try {
          claim = await claimPaymentIdempotencyKey({
            keyHash,
            transferId: input.transferId,
            responseSnapshot: { transferId: input.transferId, status: "settlement_in_progress" },
            expiresAt: new Date(Date.now() + 86_400_000),
          });
        } catch (error) {
          console.error("[Mojaloop] Settlement idempotency unavailable:", error);
          return res.status(503).json({
            error: "Settlement idempotency unavailable; webhook will be retried",
            transferId: input.transferId,
          });
        }
        if (!claim) {
          return res.status(503).json({
            error: "Settlement is already being processed; webhook will be retried",
            transferId: input.transferId,
          });
        }

        let bridgeAccepted = false;
        try {
          if (!(await tbBridgeAvailable())) {
            throw new Error("TigerBeetle bridge is unavailable");
          }
          const debitAccountId = await getOrProvisionTraderAccount(tx.initiatedBy, tx.currency);
          const bridgeTransfer = await tbFetch<{ id: string }>("/api/ledger/transfers", {
            method: "POST",
            body: JSON.stringify({
              debitAccountId,
              creditAccountId: SYSTEM_ACCOUNTS.NCS_REVENUE,
              amount: String(tx.amount),
              currency: tx.currency,
              ledger: 1,
              reference: `DUTY-${tx.declarationId ?? "N/A"}`,
              description: `Duty payment settled via Mojaloop webhook (${input.transferId})`,
              metadata: { mojaloopTransferId: input.transferId },
            }),
          });
          bridgeAccepted = true;
          await createLedgerEntry({
            tbTransferId: bridgeTransfer.id,
            debitAccountId,
            creditAccountId: SYSTEM_ACCOUNTS.NCS_REVENUE,
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
          await updateMojaloopTransaction(input.transferId, {
            status: "COMMITTED",
            fulfilment: input.fulfilment ?? null,
            committedAt: input.completedTimestamp ? new Date(input.completedTimestamp) : new Date(),
            webhookPayload: input,
          });
          await logAuditEvent({
            entityType: "payment",
            entityId: tx.id,
            action: "mojaloop_webhook_committed",
            actorId: tx.initiatedBy,
            actorType: "system",
            newState: { transferId: input.transferId, status: "COMMITTED" },
          });
          await completePaymentIdempotencyKey(keyHash, {
            transferId: input.transferId,
            status: "settled",
            tbTransferId: bridgeTransfer.id,
          });
        } catch (error) {
          console.error("[Mojaloop] Settlement failed:", error);
          if (!bridgeAccepted) {
            try {
              await releasePaymentIdempotencyKey(keyHash);
            } catch (releaseError) {
              console.error("[Mojaloop] Failed to release settlement claim:", releaseError);
            }
          }
          return res.status(503).json({
            error: "Ledger settlement unavailable; webhook will be retried",
            transferId: input.transferId,
          });
        }
        return res.json({ success: true, transferId: input.transferId, newStatus: "COMMITTED" });
      }

      const updateData: Record<string, unknown> = {
        status: input.transferState,
        webhookPayload: input,
      };
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
