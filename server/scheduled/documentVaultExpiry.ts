/**
 * Scheduled handler: document-vault-expiry
 * Cron: daily at 09:00 UTC (6-field: 0 0 9 star star star)
 *
 * Scans document vault for documents expiring within the next 30 days,
 * sends in-app notifications to document owners, and marks expired docs.
 */
import type { Request, Response } from "express";
import { logCronRun } from "./cronLogger";
import { getDb } from "../db";
import { documentVault, userNotifications } from "../../drizzle/schema";
import { and, isNull, lt, gte } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

export async function documentVaultExpiryHandler(req: Request, res: Response) {
  const start = Date.now();
  const triggeredBy: "scheduler" | "manual" = req.headers["x-heartbeat-task-uid"] ? "scheduler" : "manual";
  const taskUid = req.headers["x-heartbeat-task-uid"] as string | undefined;

  try {
    const db = await getDb();
    if (!db) {
      await logCronRun({ jobName: "document-vault-expiry", taskUid, triggeredBy, status: "error", durationMs: Date.now() - start, errorMessage: "DB unavailable" });
      return res.json({ ok: true, processed: 0, message: "DB unavailable" });
    }

    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Find documents expiring within 30 days
    const expiringDocs = await db
      .select()
      .from(documentVault)
      .where(
        and(
          isNull(documentVault.revokedAt),
          gte(documentVault.expiresAt, now),
          lt(documentVault.expiresAt, in30Days)
        )
      )
      .limit(200);

    // Find already-expired documents and mark them as revoked
    const expiredDocs = await db
      .select()
      .from(documentVault)
      .where(
        and(
          isNull(documentVault.revokedAt),
          lt(documentVault.expiresAt, now)
        )
      )
      .limit(200);

    // Mark expired docs
    let markedExpired = 0;
    for (const doc of expiredDocs) {
      const { eq } = await import("drizzle-orm");
      await db
        .update(documentVault)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(documentVault.id, doc.id));
      markedExpired++;
    }

    // Send in-app notifications for expiring docs
    let notified = 0;
    for (const doc of expiringDocs) {
      const daysLeft = Math.ceil(
        (doc.expiresAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      );
      await db.insert(userNotifications).values({
        userId: doc.ownerId,
        title: "Document Expiring Soon",
        body: `Your document "${doc.filename}" expires in ${daysLeft} day(s). Please renew it before ${doc.expiresAt!.toLocaleDateString()}.`,
        type: "general",
        isRead: false,
        createdAt: now,
      });
      notified++;
    }

    // Notify owner with summary
    if (notified > 0 || markedExpired > 0) {
      await notifyOwner({
        title: "Document Vault Expiry Report",
        content: `Daily vault scan: ${notified} document(s) expiring within 30 days (notifications sent), ${markedExpired} document(s) marked as expired.`,
      });
    }

    await logCronRun({ jobName: "document-vault-expiry", taskUid, triggeredBy, status: "success", durationMs: Date.now() - start, resultSummary: `${notified} expiring soon, ${markedExpired} marked expired` });
    return res.json({
      ok: true,
      expiringSoon: notified,
      markedExpired,
      timestamp: now.toISOString(),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logCronRun({ jobName: "document-vault-expiry", taskUid, triggeredBy, status: "error", durationMs: Date.now() - start, errorMessage: error });
    return res.status(500).json({
      error,
      context: { url: req.url, handler: "documentVaultExpiry" },
      timestamp: new Date().toISOString(),
    });
  }
}
