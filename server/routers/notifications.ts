import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { withRlsContext } from "../db";
import { notifications } from "../../drizzle/schema";
import { eq, desc, and, inArray, sql } from "drizzle-orm";

const NOTIFICATION_TYPES = [
  "declaration_submitted", "declaration_cleared", "declaration_rejected",
  "payment_confirmed", "permit_approved", "permit_rejected",
  "document_required", "aeo_status_update", "security_alert", "system",
  "declaration_status_change", "permit_expiry_warning", "fraud_case_opened",
  "fraud_case_assigned", "sla_breach", "kyc_approved", "kyc_rejected", "general",
] as const;

export const notificationsRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      type: z.enum(NOTIFICATION_TYPES).optional(),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        const conditions = [eq(notifications.userId, ctx.user.id)];
        if (input.type) conditions.push(eq(notifications.type, input.type));
        if (input.unreadOnly) conditions.push(eq(notifications.read, false));
        const rows = await db.select().from(notifications)
          .where(and(...conditions))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit).offset(input.offset);
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications).where(and(...conditions));
        return { items: rows, total: count };
      });
    }),

  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        const owned = await db.select({ id: notifications.id }).from(notifications)
          .where(and(inArray(notifications.id, input.ids), eq(notifications.userId, ctx.user.id)));
        const ownedIds = owned.map(r => r.id);
        if (ownedIds.length === 0) return { success: true, count: 0 };
        await db.update(notifications).set({ read: true })
          .where(and(inArray(notifications.id, ownedIds), eq(notifications.userId, ctx.user.id)));
        return { success: true, count: ownedIds.length };
      });
    }),

  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      return withRlsContext(ctx.user, async (db) => {
        const result = await db.update(notifications).set({ read: true })
          .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)))
          .returning({ id: notifications.id });
        return { success: true, count: result.length };
      });
    }),

  delete: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        const deleted = await db.delete(notifications)
          .where(and(inArray(notifications.id, input.ids), eq(notifications.userId, ctx.user.id)))
          .returning({ id: notifications.id });
        return { success: true, count: deleted.length };
      });
    }),

  deleteAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      return withRlsContext(ctx.user, async (db) => {
        const deleted = await db.delete(notifications)
          .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, true)))
          .returning({ id: notifications.id });
        return { success: true, count: deleted.length };
      });
    }),

  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      return withRlsContext(ctx.user, async (db) => {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(notifications)
          .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
        return { count };
      });
    }),
});
