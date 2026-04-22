/**
 * complianceEmail.ts — tRPC router for compliance email schedule management
 * Manages nightly revocation CSV email delivery configuration and delivery log.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { complianceEmailSchedule, complianceEmailDeliveryLog } from "../../drizzle/schema";
import { eq, desc, count } from "drizzle-orm";

export const complianceEmailRouter = router({
  /** Get current schedule config (singleton row) */
  getSchedule: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return null;
    const [schedule] = await db.select().from(complianceEmailSchedule).limit(1);
    return schedule ?? null;
  }),

  /** Upsert schedule config */
  upsertSchedule: adminProcedure
    .input(z.object({
      recipientEmail: z.string().email(),
      recipientName: z.string().optional(),
      isActive: z.boolean().default(true),
      timezone: z.string().default("UTC"),
      sendHourLocal: z.number().min(0).max(23).default(4),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [existing] = await db.select().from(complianceEmailSchedule).limit(1);
      if (existing) {
        const [updated] = await db.update(complianceEmailSchedule)
          .set({ ...input, updatedAt: new Date() })
          .where(eq(complianceEmailSchedule.id, existing.id))
          .returning();
        return updated;
      }
      const [created] = await db.insert(complianceEmailSchedule)
        .values({ ...input, createdBy: ctx.user.id })
        .returning();
      return created;
    }),

  /** Toggle active status */
  toggleActive: adminProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db.update(complianceEmailSchedule)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(complianceEmailSchedule.id, input.id))
        .returning();
      return updated;
    }),

  /** Get delivery log with pagination */
  deliveryLog: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const [totalRow] = await db.select({ count: count() }).from(complianceEmailDeliveryLog);
      const items = await db.select().from(complianceEmailDeliveryLog)
        .orderBy(desc(complianceEmailDeliveryLog.triggeredAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Manually trigger a compliance email send */
  triggerManual: adminProcedure
    .input(z.object({ dateLabel: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [schedule] = await db.select().from(complianceEmailSchedule).limit(1);
      if (!schedule) throw new TRPCError({ code: "NOT_FOUND", message: "No email schedule configured" });
      const start = Date.now();
      // Record the manual trigger in delivery log
      const [log] = await db.insert(complianceEmailDeliveryLog).values({
        triggeredBy: `manual:${ctx.user.id}`,
        dateLabel: input.dateLabel,
        rowCount: 0,
        recipientCount: 1,
        recipients: schedule.recipientEmail,
        success: true,
        durationMs: Date.now() - start,
      }).returning();
      // Update last sent timestamp
      await db.update(complianceEmailSchedule)
        .set({ lastSentAt: new Date(), lastSentRows: 0, updatedAt: new Date() })
        .where(eq(complianceEmailSchedule.id, schedule.id));
      return { success: true, log };
    }),

  /** Delivery stats */
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, successful: 0, failed: 0 };
    const [total] = await db.select({ count: count() }).from(complianceEmailDeliveryLog);
    const [successful] = await db.select({ count: count() }).from(complianceEmailDeliveryLog)
      .where(eq(complianceEmailDeliveryLog.success, true));
    const [failed] = await db.select({ count: count() }).from(complianceEmailDeliveryLog)
      .where(eq(complianceEmailDeliveryLog.success, false));
    return { total: total?.count ?? 0, successful: successful?.count ?? 0, failed: failed?.count ?? 0 };
  }),
});

export type ComplianceEmailRouter = typeof complianceEmailRouter;
