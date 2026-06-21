// TradeGateway NGSWTP — 4-Eyes Approval Expiry Cron Job
// Language: TypeScript (Node.js / Express)
//
// Runs every 15 minutes. Scans the privileged_action_approvals table for
// rows where:
//   - status = 'pending'
//   - expires_at < now()
//
// For each expired row:
//   1. Transitions status → 'expired' and sets resolved_at = now()
//   2. Emits a four_eyes SSE event to connected admin clients
//   3. Notifies the owner via notifyOwner()
//   4. Logs to console for observability
//
// Registered in server/_core/index.ts as:
//   cron.schedule("0 */15 * * * *", runFourEyesExpiryCron, { timezone: "UTC" });
//   app.post("/api/scheduled/four-eyes-expiry", fourEyesExpiryHandler);

import { getDb } from "../db";
import { privilegedActionApprovals } from "../../drizzle/schema";
import { lt, eq, and } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { anomalyBus, SSE_EVENT_FOUR_EYES } from "../sse";

// ─── Expiry Runner ────────────────────────────────────────────────────────────

export async function runFourEyesExpiryCron(): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.error("[4-Eyes Expiry] Database unavailable — skipping cycle");
    return;
  }

  const now = new Date();

  try {
    // Find all pending approvals that have passed their expiry time
    const expired = await db
      .select()
      .from(privilegedActionApprovals)
      .where(
        and(
          eq(privilegedActionApprovals.status, "pending"),
          lt(privilegedActionApprovals.expiresAt, now)
        )
      )
      .limit(100); // Process at most 100 per cycle

    if (expired.length === 0) {
      return; // Nothing to expire
    }

    console.log(`[4-Eyes Expiry] Found ${expired.length} expired approval(s) to process`);

    let successCount = 0;
    let errorCount = 0;

    for (const approval of expired) {
      try {
        // 1. Transition status → 'expired' and set resolved_at
        await db
          .update(privilegedActionApprovals)
          .set({
            status: "expired",
            resolvedAt: now,
          })
          .where(
            and(
              eq(privilegedActionApprovals.id, approval.id),
              eq(privilegedActionApprovals.status, "pending") // Optimistic lock
            )
          );

        // 2. Emit SSE event to connected admin clients
        anomalyBus.emit(SSE_EVENT_FOUR_EYES, {
          type: "four_eyes_expired",
          approvalRef: approval.approvalRef,
          requesterId: approval.requesterId,
          action: approval.action,
          entityType: approval.entityType,
          entityId: approval.entityId,
          description: approval.description,
          expiredAt: now.toISOString(),
          ts: now.getTime(),
        });

        // 3. Notify owner
        await notifyOwner({
          title: `4-Eyes Approval Expired: ${approval.action}`,
          content: [
            `A privileged action approval has expired without a second approver.`,
            ``,
            `**Action:** ${approval.action}`,
            `**Entity:** ${approval.entityType}/${approval.entityId}`,
            `**Description:** ${approval.description}`,
            `**Requested by:** User #${approval.requesterId}`,
            `**Approval Ref:** ${approval.approvalRef}`,
            `**Expired at:** ${now.toUTCString()}`,
            ``,
            `The action has been automatically cancelled. The requester must re-submit if still needed.`,
          ].join("\n"),
        }).catch((err: Error) => {
          console.error(`[4-Eyes Expiry] notifyOwner failed for ${approval.approvalRef}:`, err.message);
        });

        console.log(`[4-Eyes Expiry] Expired: ${approval.approvalRef} — ${approval.action} (${approval.entityType}/${approval.entityId})`);
        successCount++;
      } catch (err) {
        errorCount++;
        console.error(`[4-Eyes Expiry] Failed to expire approval ${approval.approvalRef}:`, (err as Error).message);
      }
    }

    console.log(`[4-Eyes Expiry] Cycle complete: ${successCount} expired, ${errorCount} errors`);

    // Batch summary notification if multiple approvals expired
    if (successCount > 1) {
      await notifyOwner({
        title: `4-Eyes Expiry Batch: ${successCount} approvals expired`,
        content: [
          `${successCount} privileged action approvals expired in the last cron cycle.`,
          ``,
          `Expired approvals:`,
          ...expired
            .slice(0, successCount)
            .map((a) => `- ${a.approvalRef}: ${a.action} (${a.entityType}/${a.entityId})`),
          ``,
          `Review the Security Monitor for details.`,
        ].join("\n"),
      }).catch(() => {});
    }
  } catch (err) {
    console.error("[4-Eyes Expiry] Cron cycle failed:", (err as Error).message);
  }
}

// ─── Heartbeat handler (for Manus scheduled tasks) ───────────────────────────

/**
 * HTTP handler for POST /api/scheduled/four-eyes-expiry
 * Called by the Manus Heartbeat scheduler every 15 minutes.
 */
export async function fourEyesExpiryHandler(
  _req: import("express").Request,
  res: import("express").Response
): Promise<void> {
  try {
    await runFourEyesExpiryCron();
    res.json({ ok: true, ts: new Date().toISOString() });
  } catch (err) {
    console.error("[4-Eyes Expiry] Handler error:", (err as Error).message);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
}
