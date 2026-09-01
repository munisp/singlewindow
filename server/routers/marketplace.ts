/**
 * WP-8 — API Marketplace tRPC router.
 *
 *  - Signed API catalogue (browse/search from the devPortal UI)
 *  - Developer organisation self-service registration
 *  - Production-tier elevation with maker-checker control:
 *      maker  = org member requests elevation for one of their keys
 *      checker = a DIFFERENT admin approves/rejects; self-approval refused
 *
 * Fail-closed: DB errors propagate as explicit tRPC errors, never silent
 * success; unsigned catalogues are honestly flagged by the builder.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { protectedProcedure, adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiKeys, apiKeyElevationRequests, developerOrganisations } from "../../drizzle/schema";
import { buildSignedCatalogue } from "../marketplace/apiCatalogue";
import {
  bindKeyToTier,
  buildUsageInvoice,
  listTiers as listMarketplaceTiers,
  MarketplaceBillingError,
  usageSeriesForKey,
} from "../marketplace/tiers";

export const marketplaceRouter = router({
  /** Signed API catalogue for the marketplace browse UI (public metadata). */
  getSignedCatalogue: publicProcedure.query(() => buildSignedCatalogue()),

  // ── Organisation registration ───────────────────────────────────────────────
  registerOrganisation: protectedProcedure
    .input(
      z.object({
        name: z.string().min(3).max(200),
        contactEmail: z.string().email().max(320),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      try {
        const [org] = await db
          .insert(developerOrganisations)
          .values({
            name: input.name,
            contactEmail: input.contactEmail,
            tier: "sandbox", // all new orgs start sandbox-only
            status: "active",
            registeredBy: ctx.user.id,
          })
          .returning();
        return org;
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Organisation registration failed; nothing was persisted.",
          cause: err,
        });
      }
    }),

  listMyOrganisations: protectedProcedure.query(async ({ ctx }) => {
    const db = (await getDb())!;
    return db
      .select()
      .from(developerOrganisations)
      .where(eq(developerOrganisations.registeredBy, ctx.user.id))
      .orderBy(desc(developerOrganisations.createdAt));
  }),

  // ── Production-tier elevation: MAKER ────────────────────────────────────────
  requestProductionElevation: protectedProcedure
    .input(
      z.object({
        organisationId: z.number().int(),
        apiKeyId: z.number().int(),
        justification: z.string().min(20).max(4000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      // The key must belong to the requester and be sandbox-mode — only
      // sandbox keys are elevated to production; already-production keys are
      // rejected to keep the control meaningful.
      const [key] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.apiKeyId), eq(apiKeys.userId, ctx.user.id)));
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found for this user" });
      if (key.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot elevate a ${key.status} key` });
      }
      if (!key.sandboxMode) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Key is already a production key" });
      }
      const [org] = await db
        .select()
        .from(developerOrganisations)
        .where(
          and(
            eq(developerOrganisations.id, input.organisationId),
            eq(developerOrganisations.registeredBy, ctx.user.id)
          )
        );
      if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organisation not found for this user" });
      if (org.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Organisation is ${org.status}` });
      }
      const [existing] = await db
        .select({ id: apiKeyElevationRequests.id })
        .from(apiKeyElevationRequests)
        .where(
          and(
            eq(apiKeyElevationRequests.apiKeyId, input.apiKeyId),
            eq(apiKeyElevationRequests.status, "pending")
          )
        );
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "An elevation request is already pending for this key" });
      }
      const [request] = await db
        .insert(apiKeyElevationRequests)
        .values({
          organisationId: input.organisationId,
          apiKeyId: input.apiKeyId,
          justification: input.justification,
          requestedBy: ctx.user.id,
        })
        .returning();
      return request;
    }),

  listMyElevationRequests: protectedProcedure.query(async ({ ctx }) => {
    const db = (await getDb())!;
    return db
      .select()
      .from(apiKeyElevationRequests)
      .where(eq(apiKeyElevationRequests.requestedBy, ctx.user.id))
      .orderBy(desc(apiKeyElevationRequests.createdAt));
  }),

  // ── Production-tier elevation: CHECKER ──────────────────────────────────────
  listPendingElevations: adminProcedure.query(async () => {
    const db = (await getDb())!;
    return db
      .select()
      .from(apiKeyElevationRequests)
      .where(eq(apiKeyElevationRequests.status, "pending"))
      .orderBy(apiKeyElevationRequests.createdAt);
  }),

  reviewElevation: adminProcedure
    .input(
      z.object({
        requestId: z.number().int(),
        decision: z.enum(["approved", "rejected"]),
        reviewNotes: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [request] = await db
        .select()
        .from(apiKeyElevationRequests)
        .where(eq(apiKeyElevationRequests.id, input.requestId));
      if (!request) throw new TRPCError({ code: "NOT_FOUND", message: "Elevation request not found" });
      if (request.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Request already ${request.status}` });
      }
      // MAKER-CHECKER: the reviewer must be a different person than the maker.
      if (request.requestedBy === ctx.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Maker-checker violation: you cannot review your own elevation request",
        });
      }
      const [updated] = await db
        .update(apiKeyElevationRequests)
        .set({
          status: input.decision,
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(apiKeyElevationRequests.id, input.requestId))
        .returning();

      if (input.decision === "approved") {
        // Flip the key to production routing and the org to production tier.
        await db.update(apiKeys).set({ sandboxMode: false }).where(eq(apiKeys.id, request.apiKeyId));
        await db
          .update(developerOrganisations)
          .set({ tier: "production", updatedAt: new Date() })
          .where(eq(developerOrganisations.id, request.organisationId));
      }
      return updated;
    }),

  // ── Phase 12: monetization tiers ────────────────────────────────────────────

  /** Tier catalogue (public commercial metadata). */
  listTiers: publicProcedure.query(async () => listMarketplaceTiers()),

  /** Admin: bind one of the platform's keys to a tier. */
  bindKeyToTier: adminProcedure
    .input(z.object({ apiKeyId: z.number().int().positive(), tierCode: z.enum(["free", "builder", "enterprise"]) }))
    .mutation(async ({ input }) => {
      try {
        return await bindKeyToTier(input.apiKeyId, input.tierCode);
      } catch (err) {
        if (err instanceof MarketplaceBillingError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Self-service: bind MY key to a tier (upgrade path). */
  bindMyKeyToTier: protectedProcedure
    .input(z.object({ apiKeyId: z.number().int().positive(), tierCode: z.enum(["free", "builder", "enterprise"]) }))
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).limit(1);
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      if (key.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your API key" });
      }
      try {
        return await bindKeyToTier(input.apiKeyId, input.tierCode);
      } catch (err) {
        if (err instanceof MarketplaceBillingError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Itemized, period-bounded usage invoice for one of MY keys. */
  usageInvoice: protectedProcedure
    .input(
      z.object({
        apiKeyId: z.number().int().positive(),
        from: z.string().min(4).max(40),
        to: z.string().min(4).max(40),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).limit(1);
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      if (key.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your API key" });
      }
      try {
        return await buildUsageInvoice(input.apiKeyId, input.from, input.to);
      } catch (err) {
        if (err instanceof MarketplaceBillingError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
    }),

  /** Per-day usage series for the portal charts (own keys only). */
  usageSeries: protectedProcedure
    .input(z.object({ apiKeyId: z.number().int().positive(), days: z.number().int().min(1).max(92).default(30) }))
    .query(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, input.apiKeyId)).limit(1);
      if (!key) throw new TRPCError({ code: "NOT_FOUND", message: "API key not found" });
      if (key.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your API key" });
      }
      return usageSeriesForKey(input.apiKeyId, input.days);
    }),
});
