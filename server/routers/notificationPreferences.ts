/**
 * Notification Preferences Router — Sprint 19
 * Allows users to opt in/out of specific notification types.
 * Each user can have one row per notification type; missing rows default to enabled.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { notificationPreferences, notificationDigestSettings, userNotifications, notificationChannelPreferences } from "../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import type { NotificationPreference } from "../../drizzle/schema";

const NOTIFICATION_CHANNELS = ["email", "sms", "push", "webhook", "in_app"] as const;
type NotificationChannel = typeof NOTIFICATION_CHANNELS[number];

const CHANNEL_LABELS: Record<NotificationChannel, { label: string; description: string }> = {
  email: { label: "Email", description: "Receive notifications via email" },
  sms: { label: "SMS", description: "Receive notifications via SMS text message" },
  push: { label: "Push Notification", description: "Receive browser or mobile push notifications" },
  webhook: { label: "Webhook", description: "POST notifications to your configured webhook URL" },
  in_app: { label: "In-App", description: "Receive notifications in the platform notification centre" },
};

// All valid notification types (mirrors the notificationTypeEnum in schema)
const NOTIFICATION_TYPES = [
  "declaration_submitted",
  "declaration_cleared",
  "declaration_rejected",
  "payment_confirmed",
  "permit_approved",
  "permit_rejected",
  "document_required",
  "aeo_status_update",
  "security_alert",
  "system",
  "declaration_status_change",
  "permit_expiry_warning",
  "fraud_case_opened",
  "fraud_case_assigned",
  "sla_breach",
  "kyc_approved",
  "kyc_rejected",
  "duty_payment_due",
  "clearance_complete",
  "general",
  // Phase 8 PCS trader portal (spec R6): port-community event notifications.
  "pcs_booking_confirmed",
  "pcs_gate_window",
  "pcs_berth_change",
  "pcs_invoice_issued",
] as const;

type NotificationType = typeof NOTIFICATION_TYPES[number];

// Human-readable labels for each notification type
const TYPE_LABELS: Record<NotificationType, { label: string; description: string; category: string }> = {
  declaration_submitted: { label: "Declaration Submitted", description: "Confirmation when you submit a new customs declaration", category: "Declarations" },
  declaration_status_change: { label: "Declaration Status Change", description: "Updates when your declaration status changes", category: "Declarations" },
  declaration_cleared: { label: "Declaration Cleared", description: "Notification when goods are cleared for release", category: "Declarations" },
  declaration_rejected: { label: "Declaration Rejected", description: "Alert when a declaration is rejected by customs", category: "Declarations" },
  payment_confirmed: { label: "Payment Confirmed", description: "Receipt confirmation after duty payment is processed", category: "Payments" },
  duty_payment_due: { label: "Duty Payment Due", description: "Reminder when duty payments are outstanding", category: "Payments" },
  permit_approved: { label: "Permit Approved", description: "Notification when an OGA permit is approved", category: "Permits" },
  permit_rejected: { label: "Permit Rejected", description: "Alert when a permit application is rejected", category: "Permits" },
  permit_expiry_warning: { label: "Permit Expiry Warning", description: "Advance warning before permits expire", category: "Permits" },
  document_required: { label: "Document Required", description: "Request for additional supporting documents", category: "Documents" },
  kyc_approved: { label: "Identity Verified", description: "Confirmation when KYC verification is approved", category: "Account" },
  kyc_rejected: { label: "Verification Failed", description: "Alert when KYC verification is rejected", category: "Account" },
  aeo_status_update: { label: "AEO Status Update", description: "Updates on your Authorised Economic Operator status", category: "Account" },
  sla_breach: { label: "SLA Breach Alert", description: "Escalation when declarations exceed processing time limits", category: "Compliance" },
  fraud_case_opened: { label: "Fraud Case Opened", description: "Alert when a fraud investigation is opened", category: "Compliance" },
  fraud_case_assigned: { label: "Case Assigned", description: "Notification when a fraud case is assigned to an officer", category: "Compliance" },
  security_alert: { label: "Security Alert", description: "High-priority security and sanctions notifications", category: "Security" },
  clearance_complete: { label: "Clearance Complete", description: "Final clearance confirmation for released goods", category: "Declarations" },
  system: { label: "System Announcements", description: "Platform maintenance and system-wide announcements", category: "System" },
  general: { label: "General Notifications", description: "Miscellaneous platform notifications", category: "System" },
  pcs_booking_confirmed: { label: "Port Booking Confirmed", description: "Notification when a terminal booking reaches a confirmed state (slot reserved / paid)", category: "Port Community" },
  pcs_gate_window: { label: "Gate Window / Call-Up", description: "Notification when a truck is called up or a gate window opens for your booking", category: "Port Community" },
  pcs_berth_change: { label: "Berth / Port-Call Change", description: "Notification when a port call carrying your cargo changes state", category: "Port Community" },
  pcs_invoice_issued: { label: "Port Invoice Issued", description: "Notification when a port charge invoice or refund is recorded", category: "Port Community" },
};

export const notificationPreferencesRouter = router({
  /**
   * Get all notification preferences for the current user.
   * Returns the full list of notification types with enabled/disabled status.
   * Types without a DB row default to enabled = true.
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const rows: NotificationPreference[] = db
      ? await db
          .select()
          .from(notificationPreferences)
          .where(eq(notificationPreferences.userId, ctx.user.id))
      : [];

    const prefMap = new Map(rows.map((r: NotificationPreference) => [r.notificationType, r.enabled]));

    return NOTIFICATION_TYPES.map((type) => ({
      type,
      enabled: prefMap.has(type) ? prefMap.get(type)! : true,
      ...TYPE_LABELS[type],
    }));
  }),

  /**
   * Update a single notification preference for the current user.
   * Uses upsert (insert on conflict update).
   */
  updatePreference: protectedProcedure
    .input(
      z.object({
        notificationType: z.enum(NOTIFICATION_TYPES),
        enabled: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if a row already exists
    const db = await getDb();
    if (!db) return { success: false, notificationType: input.notificationType, enabled: input.enabled };

    const existing = await db
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.userId, ctx.user.id),
          eq(notificationPreferences.notificationType, input.notificationType)
        )
      )
      .limit(1);

      if (existing.length > 0) {
        await db
          .update(notificationPreferences)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(
            and(
              eq(notificationPreferences.userId, ctx.user.id),
              eq(notificationPreferences.notificationType, input.notificationType)
            )
          );
      } else {
        await db.insert(notificationPreferences).values({
          userId: ctx.user.id,
          notificationType: input.notificationType,
          enabled: input.enabled,
          updatedAt: new Date(),
        });
      }

      return { success: true, notificationType: input.notificationType, enabled: input.enabled };
    }),

  /**
   * Reset all notification preferences to defaults (all enabled).
   * Deletes all preference rows for the current user.
   */
  resetToDefaults: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    if (db) {
      await db
        .delete(notificationPreferences)
        .where(eq(notificationPreferences.userId, ctx.user.id));
    }
    return { success: true, message: "All notification preferences reset to defaults (all enabled)." };
  }),

  /**
   * Get the current user's notification digest frequency setting.
   * Returns "none" if no row exists (default = no digest).
   */
  getDigestSettings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { digestFrequency: "none" as const, lastDigestSentAt: null as Date | null };
    const rows = await db
      .select()
      .from(notificationDigestSettings)
      .where(eq(notificationDigestSettings.userId, ctx.user.id))
      .limit(1);
    if (rows.length === 0) return { digestFrequency: "none" as const, lastDigestSentAt: null as Date | null };
    return {
      digestFrequency: rows[0].digestFrequency,
      lastDigestSentAt: rows[0].lastDigestSentAt,
    };
  }),

  /**
   * Update the current user's notification digest frequency.
   * Uses upsert (insert on conflict update).
   */
  updateDigestSettings: protectedProcedure
    .input(z.object({
      digestFrequency: z.enum(["none", "daily", "weekly"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false, digestFrequency: input.digestFrequency };
      const existing = await db
        .select({ id: notificationDigestSettings.id })
        .from(notificationDigestSettings)
        .where(eq(notificationDigestSettings.userId, ctx.user.id))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(notificationDigestSettings)
          .set({ digestFrequency: input.digestFrequency, updatedAt: new Date() })
          .where(eq(notificationDigestSettings.userId, ctx.user.id));
      } else {
        await db.insert(notificationDigestSettings).values({
          userId: ctx.user.id,
          digestFrequency: input.digestFrequency,
          updatedAt: new Date(),
        });
      }
      return { success: true, digestFrequency: input.digestFrequency };
    }),

  /**
   * Preview what the next digest would contain for the current user.
   * Returns the count of unread notifications and the first 5 titles as a sample.
   * Does NOT send anything — purely informational.
   */
  previewDigest: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { count: 0, sampleTitles: [] as string[], nextDigestLabel: "" };

    // Get unread notifications
    const unread = await db
      .select({ id: userNotifications.id, title: userNotifications.title, createdAt: userNotifications.createdAt })
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.userId, ctx.user.id),
          eq(userNotifications.isRead, false)
        )
      )
      .limit(50);

    // Get digest frequency to compute next send label
    const digestRows = await db
      .select({ digestFrequency: notificationDigestSettings.digestFrequency, lastDigestSentAt: notificationDigestSettings.lastDigestSentAt })
      .from(notificationDigestSettings)
      .where(eq(notificationDigestSettings.userId, ctx.user.id))
      .limit(1);

    const freq = digestRows[0]?.digestFrequency ?? "none";
    let nextDigestLabel = "";
    if (freq === "daily") {
      nextDigestLabel = "Tomorrow at 08:00 UTC";
    } else if (freq === "weekly") {
      // Next Monday
      const now = new Date();
      const daysUntilMonday = (8 - now.getUTCDay()) % 7 || 7;
      const nextMonday = new Date(now);
      nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
      nextMonday.setUTCHours(8, 0, 0, 0);
      nextDigestLabel = `Monday ${nextMonday.toLocaleDateString("en-GB", { month: "short", day: "numeric" })} at 08:00 UTC`;
    } else {
      nextDigestLabel = "Digest is disabled";
    }

    return {
      count: unread.length,
      sampleTitles: unread.slice(0, 5).map((n) => n.title),
      nextDigestLabel,
    };
  }),

  /**
   * v113: getChannelPreferences — get per-channel delivery preferences for the current user.
   * Returns a matrix of notification type x channel with enabled/disabled status.
   */
  getChannelPreferences: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const rows = db
      ? await db.select().from(notificationChannelPreferences).where(eq(notificationChannelPreferences.userId, ctx.user.id))
      : [];

    const map: Record<string, Record<string, boolean>> = {};
    for (const row of rows) {
      if (!map[row.notificationType]) map[row.notificationType] = {};
      map[row.notificationType][row.channel] = row.enabled;
    }

    const CRITICAL_TYPES = ["security_alert", "sla_breach", "fraud_case_opened"] as const;
    return NOTIFICATION_TYPES.map((type) => ({
      notificationType: type,
      label: TYPE_LABELS[type].label,
      category: TYPE_LABELS[type].category,
      channels: NOTIFICATION_CHANNELS.map((channel) => ({
        channel,
        label: CHANNEL_LABELS[channel].label,
        enabled: map[type]?.[channel] ?? (
          channel === "email" ? true :
          channel === "in_app" ? true :
          (CRITICAL_TYPES as readonly string[]).includes(type) && channel === "push" ? true :
          false
        ),
      })),
    }));
  }),

  /**
   * v113: updateChannelPreference — enable or disable a specific channel for a notification type.
   */
  updateChannelPreference: protectedProcedure
    .input(z.object({
      notificationType: z.enum(NOTIFICATION_TYPES),
      channel: z.enum(NOTIFICATION_CHANNELS),
      enabled: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false, reason: "Database unavailable" };

      await db.insert(notificationChannelPreferences)
        .values({
          userId: ctx.user.id,
          notificationType: input.notificationType,
          channel: input.channel,
          enabled: input.enabled,
        })
        .onConflictDoUpdate({
          target: [notificationChannelPreferences.userId, notificationChannelPreferences.notificationType, notificationChannelPreferences.channel],
          set: { enabled: input.enabled, updatedAt: new Date() },
        });

      return { success: true, notificationType: input.notificationType, channel: input.channel, enabled: input.enabled };
    }),

  /**
   * v113: bulkUpdateChannelPreferences — update multiple channel preferences at once.
   */
  bulkUpdateChannelPreferences: protectedProcedure
    .input(z.object({
      updates: z.array(z.object({
        notificationType: z.enum(NOTIFICATION_TYPES),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      })).min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { success: false, updated: 0, reason: "Database unavailable" };

      for (const update of input.updates) {
        await db.insert(notificationChannelPreferences)
          .values({
            userId: ctx.user.id,
            notificationType: update.notificationType,
            channel: update.channel,
            enabled: update.enabled,
          })
          .onConflictDoUpdate({
            target: [notificationChannelPreferences.userId, notificationChannelPreferences.notificationType, notificationChannelPreferences.channel],
            set: { enabled: update.enabled, updatedAt: new Date() },
          });
      }

      return { success: true, updated: input.updates.length };
    }),
});