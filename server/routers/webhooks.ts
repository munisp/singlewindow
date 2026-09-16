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
import {
  GOVERNED_TOPICS,
  WebhooksNotConfiguredError,
  encryptSecret,
  generateSecret,
  hashSecret,
  rotateSubscriptionSecret,
  webhooksConfigured,
} from "../webhooks/outbound";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

// Phase 19 (F1/H2): aligned to the governed marketplace registry topics
// (plural namespaces, api-registry.json webhookEvents). The legacy singular
// topics are retired — a registry-conformant subscriber and the runtime now
// speak the same contract.
const SUPPORTED_EVENTS = GOVERNED_TOPICS;

export const webhooksRouter = router({
  /** List my webhook subscriptions */
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const rows = await db
      .select()
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.userId, ctx.user.id))
      .orderBy(desc(webhookSubscriptions.createdAt));
    // Mask secret (H3: only the hash exists at rest — mask from it)
    return rows.map(r => ({ ...r, secret: maskSecret(r), secretEnc: undefined }));
  }),

  /** Create a webhook subscription */
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(3).max(128),
      url: z.string().url(),
      events: z.array(z.enum(SUPPORTED_EVENTS)).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!webhooksConfigured()) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "WEBHOOKS_NOT_CONFIGURED: platform webhook signing key is not configured" });
      }
      const db = await requireDb();
      const secret = generateSecret();
      const [row] = await db.insert(webhookSubscriptions).values({
        userId: ctx.user.id,
        name: input.name,
        url: input.url,
        secret: null,
        secretHash: hashSecret(secret),
        secretEnc: encryptSecret(secret),
        events: [...input.events],
        isActive: true,
        failureCount: 0,
      }).returning();
      // Return the raw secret exactly once — at rest only sha256 + AES-256-GCM.
      return { ...row, secret, secretHash: undefined, secretEnc: undefined };
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
        .set({ ...updates, events: updates.events ? [...updates.events] : undefined, updatedAt: new Date() })
        .where(eq(webhookSubscriptions.id, id))
        .returning();
      return { ...row, secret: maskSecret(row), secretEnc: undefined };
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

      try {
        const secret = await rotateSubscriptionSecret(db, input.id);
        return { secret }; // raw secret returned once
      } catch (err) {
        if (err instanceof WebhooksNotConfiguredError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
        }
        throw err;
      }
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
      return rows.map(r => ({ ...r, secret: maskSecret(r), secretEnc: undefined }));
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

function maskSecret(r: { secret: string | null; secretHash: string | null }): string {
  const basis = r.secretHash ?? r.secret ?? "";
  return basis ? `${basis.slice(0, 8)}${"*".repeat(24)}` : "";
}

function getEventDescription(event: string): string {
  const descriptions: Record<string, string> = {
    "declarations.submitted": "Fired when a trader submits a new declaration",
    "declarations.status_changed": "Fired when a declaration changes status",
    "declarations.cleared": "Fired when goods are cleared and released",
    "payments.initiated": "Fired when a duty payment is initiated",
    "payments.confirmed": "Fired when a duty payment is confirmed",
    "payments.failed": "Fired when a payment attempt fails",
  };
  return descriptions[event] ?? event;
}

export type WebhooksRouter = typeof webhooksRouter;
