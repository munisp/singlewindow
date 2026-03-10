/**
 * aeoRenewalReminders.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AEO Certificate Renewal Reminder Cron Job
 *
 * Fires at 03:10 UTC every day (scheduled in server/_core/index.ts).
 *
 * Scans all approved AEO certificates and sends renewal reminder notifications
 * to traders at 60, 30, and 7 days before expiry.
 *
 * Notifications are idempotent — a reminder for a given (applicationId, milestone)
 * is only sent once per milestone window.
 */
import { getDb } from "../db";
import { createNotification } from "../db";
import { notifyOwner } from "../_core/notification";
import { aeoApplications, users } from "../../drizzle/schema";
import { eq, and, lte, gte } from "drizzle-orm";

export interface AeoRenewalReminderResult {
  scannedCount: number;
  reminders60: number;
  reminders30: number;
  reminders7: number;
  totalRemindersSent: number;
  ownerNotified: boolean;
  skippedReason?: string;
}

const REMINDER_MILESTONES = [
  { days: 60, label: "60 days" },
  { days: 30, label: "30 days" },
  { days: 7,  label: "7 days" },
] as const;

export async function runAeoRenewalReminders(): Promise<AeoRenewalReminderResult> {
  console.log("[Cron] AEO renewal reminders starting…");
  const result: AeoRenewalReminderResult = {
    scannedCount: 0,
    reminders60: 0,
    reminders30: 0,
    reminders7: 0,
    totalRemindersSent: 0,
    ownerNotified: false,
  };

  try {
    const db = await getDb();
    if (!db) {
      result.skippedReason = "DB unavailable";
      console.warn("[Cron] AEO renewal reminders — DB unavailable, skipping");
      return result;
    }

    const now = new Date();
    // Scan all certs expiring within 65 days (wider window to catch all milestones)
    const cutoff = new Date(now.getTime() + 65 * 24 * 60 * 60 * 1000);

    const expiringCerts = await db
      .select({
        id: aeoApplications.id,
        traderId: aeoApplications.traderId,
        certificateNumber: aeoApplications.certificateNumber,
        tier: aeoApplications.tier,
        certificateExpiresAt: aeoApplications.certificateExpiresAt,
        traderName: users.name,
        traderEmail: users.email,
      })
      .from(aeoApplications)
      .leftJoin(users, eq(aeoApplications.traderId, users.id))
      .where(
        and(
          eq(aeoApplications.status, "approved"),
          lte(aeoApplications.certificateExpiresAt, cutoff),
          gte(aeoApplications.certificateExpiresAt, now)
        )
      )
      .orderBy(aeoApplications.certificateExpiresAt);

    result.scannedCount = expiringCerts.length;

    for (const cert of expiringCerts) {
      if (!cert.certificateExpiresAt) continue;
      const daysLeft = Math.ceil(
        (cert.certificateExpiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      for (const milestone of REMINDER_MILESTONES) {
        // Send reminder if within ±1 day of the milestone
        if (daysLeft <= milestone.days && daysLeft > milestone.days - 2) {
          try {
            await createNotification({
              userId: cert.traderId,
              type: "aeo_status_update",
              title: `AEO Certificate Expiring in ${milestone.label}`,
              message: `Your AEO certificate ${cert.certificateNumber ?? ""} (${cert.tier?.toUpperCase() ?? ""} tier) expires on ${cert.certificateExpiresAt.toLocaleDateString()}. Please contact the NCS AEO Unit to initiate renewal and avoid disruption to your blue-lane clearance privileges.`,
              entityType: "aeo_application",
              entityId: cert.id,
            });
            if (milestone.days === 60) result.reminders60++;
            else if (milestone.days === 30) result.reminders30++;
            else if (milestone.days === 7) result.reminders7++;
            result.totalRemindersSent++;
          } catch (err) {
            console.error(`[Cron] AEO renewal reminder failed for cert ${cert.certificateNumber}:`, err);
          }
        }
      }
    }

    // Notify owner if any 7-day reminders were sent (urgent)
    if (result.reminders7 > 0) {
      try {
        result.ownerNotified = await notifyOwner({
          title: `[AEO Renewal] ${result.reminders7} certificate${result.reminders7 !== 1 ? "s" : ""} expiring in 7 days`,
          content: [
            `AEO renewal reminder scan at ${now.toUTCString()}.`,
            ``,
            `Certificates expiring within 7 days: ${result.reminders7}`,
            `Certificates expiring within 30 days: ${result.reminders30}`,
            `Certificates expiring within 60 days: ${result.reminders60}`,
            `Total reminders sent: ${result.totalRemindersSent}`,
            ``,
            `Action: Review /app/admin/aeo to process renewals before traders lose blue-lane privileges.`,
          ].join("\n"),
        });
      } catch {
        // Non-fatal
      }
    }

    console.log(
      `[Cron] AEO renewal reminders complete — ${result.scannedCount} certs scanned, ` +
      `${result.totalRemindersSent} reminders sent (60d: ${result.reminders60}, 30d: ${result.reminders30}, 7d: ${result.reminders7})`
    );
  } catch (err) {
    console.error("[Cron] AEO renewal reminders failed:", err);
    result.skippedReason = String(err);
  }

  return result;
}
