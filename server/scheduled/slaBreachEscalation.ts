// Scheduled handler: sla-breach-escalation
// Cron: every 30 minutes
// Finds SLA escalations that are still open and past their deadline,
// promotes them to the next escalation tier, and notifies the owner.
import type { Request, Response } from "express";
import { logCronRun } from "./cronLogger";
import { getDb } from "../db";
import { slaEscalations } from "../../drizzle/schema";
import { and, eq, isNull, lt } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

export async function slaBreachEscalationHandler(req: Request, res: Response) {
  const start = Date.now();
  const triggeredBy: "scheduler" | "manual" = req.headers["x-heartbeat-task-uid"] ? "scheduler" : "manual";
  const taskUid = req.headers["x-heartbeat-task-uid"] as string | undefined;

  try {
    const db = await getDb();
    if (!db) {
      await logCronRun({ jobName: "sla-breach-escalation", taskUid, triggeredBy, status: "error", durationMs: Date.now() - start, errorMessage: "DB unavailable" });
      return res.json({ ok: true, processed: 0, message: "DB unavailable" });
    }

    const now = new Date();
    const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000);

    const overdueEscalations = await db
      .select()
      .from(slaEscalations)
      .where(
        and(
          eq(slaEscalations.status, "open"),
          isNull(slaEscalations.resolvedAt),
          lt(slaEscalations.createdAt, thirtyMinAgo)
        )
      )
      .limit(100);

    if (overdueEscalations.length === 0) {
      await logCronRun({ jobName: "sla-breach-escalation", taskUid, triggeredBy, status: "success", durationMs: Date.now() - start, resultSummary: "No overdue SLA escalations found" });
      return res.json({ ok: true, processed: 0, message: "No overdue SLA escalations found" });
    }

    let promoted = 0;
    for (const esc of overdueEscalations) {
      await db
        .update(slaEscalations)
        .set({ status: "escalated", updatedAt: now })
        .where(eq(slaEscalations.id, esc.id));
      promoted++;
    }

    if (promoted > 0) {
      await notifyOwner({
        title: "SLA Breach Auto-Escalation",
        content: `${promoted} SLA breach(es) were automatically escalated to the next tier at ${now.toISOString()}. Please review the SLA Breach Escalation dashboard.`,
      });
    }

    await logCronRun({ jobName: "sla-breach-escalation", taskUid, triggeredBy, status: "success", durationMs: Date.now() - start, resultSummary: `Escalated ${promoted} overdue SLA breach(es)` });
    return res.json({
      ok: true,
      processed: promoted,
      timestamp: now.toISOString(),
      message: `Escalated ${promoted} overdue SLA breach(es)`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await logCronRun({ jobName: "sla-breach-escalation", taskUid, triggeredBy, status: "error", durationMs: Date.now() - start, errorMessage: error });
    return res.status(500).json({
      error,
      context: { url: req.url, handler: "slaBreachEscalation" },
      timestamp: new Date().toISOString(),
    });
  }
}
