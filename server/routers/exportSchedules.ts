/**
 * Export Schedules Router — recurring CSV delivery configuration
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { exportSchedules, exportScheduleDeliveries } from "../../drizzle/schema";
import { eq, and, lte, desc } from "drizzle-orm";

const CADENCE_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

function computeNextRunAt(cadence: string): Date {
  const days = CADENCE_DAYS[cadence] ?? 7;
  const next = new Date();
  next.setDate(next.getDate() + days);
  next.setHours(6, 0, 0, 0);
  return next;
}

export const exportSchedulesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(exportSchedules).where(eq(exportSchedules.userId, ctx.user.id));
  }),

  upsert: protectedProcedure
    .input(z.object({
      exportType:   z.enum(["ledger", "payments"]),
      cadence:      z.enum(["daily", "weekly", "monthly"]),
      filterPreset: z.enum(["7", "30", "90", "year", "all"]).default("30"),
      isActive:     z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [existing] = await db.select().from(exportSchedules)
        .where(and(eq(exportSchedules.userId, ctx.user.id), eq(exportSchedules.exportType, input.exportType)))
        .limit(1);
      const nextRunAt = computeNextRunAt(input.cadence);
      if (existing) {
        await db.update(exportSchedules)
          .set({ cadence: input.cadence, filterPreset: input.filterPreset, isActive: input.isActive, nextRunAt, updatedAt: new Date() })
          .where(eq(exportSchedules.id, existing.id));
        return { id: existing.id, created: false };
      }
      const [created] = await db.insert(exportSchedules)
        .values({ userId: ctx.user.id, exportType: input.exportType, cadence: input.cadence, filterPreset: input.filterPreset, isActive: input.isActive, nextRunAt })
        .returning({ id: exportSchedules.id });
      return { id: created.id, created: true };
    }),

  setActive: protectedProcedure
    .input(z.object({ id: z.number().int(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(exportSchedules)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(and(eq(exportSchedules.id, input.id), eq(exportSchedules.userId, ctx.user.id)));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.delete(exportSchedules)
        .where(and(eq(exportSchedules.id, input.id), eq(exportSchedules.userId, ctx.user.id)));
      return { success: true };
    }),

  listDue: protectedProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(exportSchedules)
      .where(and(eq(exportSchedules.isActive, true), lte(exportSchedules.nextRunAt, new Date())));
  }),

  /** List delivery receipts for a specific schedule */
  listDeliveries: protectedProcedure
    .input(z.object({ scheduleId: z.number().int(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [schedule] = await db.select().from(exportSchedules)
        .where(and(eq(exportSchedules.id, input.scheduleId), eq(exportSchedules.userId, ctx.user.id)))
        .limit(1);
      if (!schedule) throw new Error("Schedule not found or access denied");
      return db.select().from(exportScheduleDeliveries)
        .where(eq(exportScheduleDeliveries.scheduleId, input.scheduleId))
        .orderBy(desc(exportScheduleDeliveries.deliveredAt))
        .limit(input.limit);
    }),

  /** Get the last delivery for each of the current user's schedules */
  lastDeliveries: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const schedules = await db.select().from(exportSchedules)
      .where(eq(exportSchedules.userId, ctx.user.id));
    const result: Record<number, typeof exportScheduleDeliveries.$inferSelect | null> = {};
    for (const s of schedules) {
      const [last] = await db.select().from(exportScheduleDeliveries)
        .where(eq(exportScheduleDeliveries.scheduleId, s.id))
        .orderBy(desc(exportScheduleDeliveries.deliveredAt))
        .limit(1);
      result[s.id] = last ?? null;
    }
    return result;
  }),

  /** Record a delivery receipt (called by heartbeat job after successful export) */
  recordDelivery: protectedProcedure
    .input(z.object({
      scheduleId: z.number().int(),
      rowCount: z.number().int().min(0),
      fileSizeBytes: z.number().int().min(0),
      status: z.enum(["success", "failed"]).default("success"),
      errorMessage: z.string().optional(),
      notificationId: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [delivery] = await db.insert(exportScheduleDeliveries).values({
        scheduleId: input.scheduleId,
        rowCount: input.rowCount,
        fileSizeBytes: input.fileSizeBytes,
        status: input.status,
        errorMessage: input.errorMessage ?? null,
        notificationId: input.notificationId ?? null,
      }).returning({ id: exportScheduleDeliveries.id });
      await db.update(exportSchedules)
        .set({ lastRunAt: new Date() })
        .where(eq(exportSchedules.id, input.scheduleId));
      return { id: delivery.id };
    }),
});
