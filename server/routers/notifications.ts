import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { withRlsContext } from "../db";
import { notifications } from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";

export const notificationsRouter = router({
  /**
   * Get current user's notifications — RLS enforced at DB level.
   */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        return db
          .select()
          .from(notifications)
          .where(eq(notifications.userId, ctx.user.id))
          .orderBy(desc(notifications.createdAt))
          .limit(input.limit);
      });
    }),

  /**
   * Mark one or more notifications as read — verifies ownership.
   */
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.number().int().positive()).min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        for (const id of input.ids) {
          const [notif] = await db
            .select({ id: notifications.id, userId: notifications.userId })
            .from(notifications)
            .where(eq(notifications.id, id))
            .limit(1);
          if (!notif) continue;
          if (notif.userId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN", message: `Notification ${id} does not belong to you` });
          }
          await db
            .update(notifications)
            .set({ read: true })
            .where(eq(notifications.id, id));
        }
        return { success: true, count: input.ids.length };
      });
    }),

  /**
   * Mark all of the current user's notifications as read.
   */
  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      return withRlsContext(ctx.user, async (db) => {
        await db
          .update(notifications)
          .set({ read: true })
          .where(eq(notifications.userId, ctx.user.id));
        return { success: true };
      });
    }),

  /**
   * Get unread notification count for the badge indicator.
   */
  unreadCount: protectedProcedure
    .query(async ({ ctx }) => {
      return withRlsContext(ctx.user, async (db) => {
        const rows = await db
          .select({ id: notifications.id })
          .from(notifications)
          .where(and(eq(notifications.userId, ctx.user.id), eq(notifications.read, false)));
        return { count: rows.length };
      });
    }),
});
