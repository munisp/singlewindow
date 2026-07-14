/**
 * Post-Clearance Audit Weekly Reminder Handler
 * Triggered every Monday at 06:00 UTC via Heartbeat.
 * Scans upcoming scheduled audits for the next 7 days and notifies the owner.
 *
 * Endpoint: POST /api/scheduled/post-audit-reminder
 */
import type { Request, Response } from "express";
import { getPool } from "../db";
import { notifyOwner } from "../_core/notification";

export async function postAuditReminderHandler(req: Request, res: Response) {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(500).json({ error: "Database unavailable" });
    }

    const now = new Date();
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { rows: audits } = await pool.query<{
      id: number;
      declaration_id: string;
      audit_type: string;
      status: string;
      scheduled_date: string;
      assigned_officer_id: string | null;
      risk_score: number | null;
    }>(
      `SELECT id, declaration_id, audit_type, status, scheduled_date,
              assigned_officer_id, risk_score
       FROM post_clearance_audits
       WHERE status = 'scheduled'
         AND scheduled_date IS NOT NULL
         AND scheduled_date >= $1
         AND scheduled_date <= $2
       ORDER BY scheduled_date ASC
       LIMIT 50`,
      [now, sevenDaysOut]
    );

    if (audits.length === 0) {
      return res.json({
        ok: true,
        upcomingAudits: 0,
        message: "No upcoming audits in the next 7 days — no reminder sent",
      });
    }

    const formatDate = (d: string) =>
      new Date(d).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

    const daysUntil = (d: string) =>
      Math.ceil((new Date(d).getTime() - now.getTime()) / 86_400_000);

    const lines = audits
      .map((a) => {
        const days = daysUntil(a.scheduled_date);
        const urgency = days <= 1 ? "🔴 TOMORROW" : days <= 3 ? "🟡 SOON" : "🟢 UPCOMING";
        return (
          `  ${urgency} | Audit #${a.id} | Declaration: ${a.declaration_id}\n` +
          `         Type: ${a.audit_type} | Risk Score: ${a.risk_score ?? "N/A"}\n` +
          `         Scheduled: ${formatDate(a.scheduled_date)} (${days}d away)` +
          (a.assigned_officer_id ? `\n         Officer: ${a.assigned_officer_id}` : "")
        );
      })
      .join("\n\n");

    const content =
      `Weekly Post-Clearance Audit Reminder — ${now.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}\n` +
      `Generated at: ${now.toISOString()}\n` +
      `Upcoming audits (next 7 days): ${audits.length}\n\n` +
      lines +
      `\n\n---\nThis reminder is sent every Monday at 06:00 UTC. Log in to the Post-Clearance Audit module to review.`;

    const notified = await notifyOwner({
      title: `📋 Weekly Audit Reminder: ${audits.length} audit(s) scheduled in the next 7 days`,
      content,
    });

    return res.json({
      ok: true,
      upcomingAudits: audits.length,
      notified,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(500).json({
      error: message,
      context: { url: req.url, timestamp: new Date().toISOString() },
    });
  }
}
