import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getNotificationsByUser, markNotificationRead } from "../db";

export const notificationsRouter = router({
  // Get current user's notifications
  list: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      return getNotificationsByUser(ctx.user.id, input.limit);
    }),

  // Mark notifications as read
  markRead: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ ctx, input }) => {
      for (const id of input.ids) { await markNotificationRead(id); }
      return { success: true };
    }),
});
