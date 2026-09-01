/**
 * Webhooks Router — Sprint 74
 * Manage webhook subscriptions and delivery history.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { webhookSubscriptions, webhookDeliveries } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import crypto from "crypto";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

const SUPPORTED_EVENTS = [
  "declaration.submitted", "declaration.approved", "declaration.rejected", "declaration.released",
  "payment.confirmed", "payment.failed",
  "kyc.approved", "kyc.rejected",
  "permit.issued", "permit.expiring",
  "vessel.geofence_entry", "vessel.geofence_exit",
  "alert.high_risk", "alert.sanctions_hit",
] as const;

export const webhooksRouter = router({
  /** List my webhook subscriptions */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, ctx.user.id))
      .orderBy(desc(webhookSubscriptions.createdAt));
    // Mask secret
    return rows.map(r => ({ ...r, secret: `${r.secret.slice(0, 8)}${"*".repeat(24)}` }));
  }),

  /** Create a webhook subscription */
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(3).max(128),
      url: z.string().url(),
      events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const secret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
      const [row] = await db.insert(webhookSubscriptions).values({
        userId: ctx.user.id,
        name: input.name,
        url: input.url,
        secret,
        events: input.events,
        isActive: true,
        failureCount: 0,
      }).returning();
      return { ...row, secret }; // Return full secret once on creation
    }),

  /** Update a webhook subscription */
  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      name: z.string().min(3).max(128).optional(),
      url: z.string().url().optional(),
      events: z.array(z.enum(SUPPORTED_EVENTS)).min(1).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });

      const { id, ...updates } = input;
      const [row] = await db.update(webhookSubscriptions)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(webhookSubscriptions.id, id))
        .returning();
      return { ...row, secret: `${row.secret.slice(0, 8)}${"*".repeat(24)}` };
    }),

  /** Delete a webhook subscription */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });
      await db.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, input.id));
      return { success: true };
    }),

  /** Rotate webhook secret */
  rotateSecret: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [existing] = await db.select().from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.id, input.id), eq(webhookSubscriptions.userId, ctx.user.id)));
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });

      const newSecret = `whsec_${crypto.randomBytes(32).toString("hex")}`;
      await db.update(webhookSubscriptions)
        .set({ secret: newSecret, updatedAt: new Date() })
        .where(eq(webhookSubscriptions.id, input.id));
      return { secret: newSecret };
    }),

  /** Get delivery history for a subscription */
  deliveries: protectedProcedure
    .input(z.object({
      subscriptionId: z.number().int().positive(),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const db = await requireDb();
      // Verify ownership
      const [sub] = await db.select().from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.id, input.subscriptionId), eq(webhookSubscriptions.userId, ctx.user.id)));
      if (!sub) throw new TRPCError({ code: "NOT_FOUND", message: "Webhook not found" });

      const rows = await db.select().from(webhookDeliveries)
        .where(eq(webhookDeliveries.subscriptionId, input.subscriptionId))
        .orderBy(desc(webhookDeliveries.deliveredAt))
        .limit(input.limit);
      return rows;
    }),

  /** Get supported event types */
  supportedEvents: protectedProcedure.query(() => {
    return SUPPORTED_EVENTS.map(e => ({
      event: e,
      category: e.split(".")[0],
      description: getEventDescription(e),
    }));
  }),

  /** Admin: list all subscriptions (paginated — capped to bound result sets) */
  adminList: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db.select().from(webhookSubscriptions).orderBy(desc(webhookSubscriptions.createdAt))
        .limit(input?.limit ?? 100)
        .offset(input?.offset ?? 0);
      return rows.map(r => ({ ...r, secret: `${r.secret.slice(0, 8)}${"*".repeat(24)}` }));
    }),

  /** Admin: get delivery stats */
  stats: adminProcedure.query(async () => {
    const db = await requireDb();
    const [total] = await db.select({ count: count() }).from(webhookSubscriptions);
    const [active] = await db.select({ count: count() }).from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.isActive, true));
    const [deliveries] = await db.select({ count: count() }).from(webhookDeliveries);
    const [failed] = await db.select({ count: count() }).from(webhookDeliveries)
      .where(eq(webhookDeliveries.success, false));
    return {
      totalSubscriptions: total?.count ?? 0,
      activeSubscriptions: active?.count ?? 0,
      totalDeliveries: deliveries?.count ?? 0,
      failedDeliveries: failed?.count ?? 0,
    };
  }),
});

function getEventDescription(event: string): string {
  const descriptions: Record<string, string> = {
    "declaration.submitted": "Fired when a trader submits a new declaration",
    "declaration.approved": "Fired when a customs officer approves a declaration",
    "declaration.rejected": "Fired when a declaration is rejected",
    "declaration.released": "Fired when goods are cleared and released",
    "payment.confirmed": "Fired when a duty payment is confirmed",
    "payment.failed": "Fired when a payment attempt fails",
    "kyc.approved": "Fired when a KYC verification is approved",
    "kyc.rejected": "Fired when a KYC verification is rejected",
    "permit.issued": "Fired when an OGA permit is issued",
    "permit.expiring": "Fired 30 days before a permit expires",
    "vessel.geofence_entry": "Fired when a vessel enters a geofence zone",
    "vessel.geofence_exit": "Fired when a vessel exits a geofence zone",
    "alert.high_risk": "Fired when a high-risk declaration is flagged",
    "alert.sanctions_hit": "Fired when a sanctions screening match is found",
  };
  return descriptions[event] ?? event;
}

export type WebhooksRouter = typeof webhooksRouter;
