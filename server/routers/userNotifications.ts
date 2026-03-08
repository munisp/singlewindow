/**
 * User Notifications Router — Sprint 15 Notification Centre
 * Provides in-app inbox for traders and other users.
 * Backed by the user_notifications table (separate from the legacy notifications table).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createUserNotification,
  getUserNotifications,
  getUserUnreadCount,
  markUserNotificationRead,
  markAllUserNotificationsRead,
} from "../db";

export const userNotificationsRouter = router({
  // ── GET MY NOTIFICATIONS ─────────────────────────────────────────────────────
  // Returns paginated list of notifications for the current user.
  getMyNotifications: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).default(50),
        onlyUnread: z.boolean().default(false),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await getUserNotifications(ctx.user.id, input.limit, input.onlyUnread);
      return items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        declarationId: n.declarationId,
        isRead: n.isRead,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      }));
    }),

  // ── GET UNREAD COUNT ─────────────────────────────────────────────────────────
  // Lightweight poll for the nav badge — returns only the count.
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const count = await getUserUnreadCount(ctx.user.id);
    return { count };
  }),

  // ── MARK ONE AS READ ─────────────────────────────────────────────────────────
  markAsRead: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await markUserNotificationRead(input.id, ctx.user.id);
      return { success: true };
    }),

  // ── MARK ALL AS READ ─────────────────────────────────────────────────────────
  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const updated = await markAllUserNotificationsRead(ctx.user.id);
    return { success: true, updated };
  }),

  // ── ADMIN: SEND NOTIFICATION TO USER ────────────────────────────────────────
  // Allows admins to push a notification to any user (e.g. for testing or manual alerts).
  adminSend: protectedProcedure
    .input(
      z.object({
        userId: z.number().int().positive(),
        type: z.string().default("general"),
        title: z.string().min(1).max(255),
        body: z.string().min(1),
        declarationId: z.number().int().positive().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
      }
      const result = await createUserNotification({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        declarationId: input.declarationId ?? null,
      });
      return { success: true, id: result?.id };
    }),
});
