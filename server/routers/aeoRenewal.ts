/**
 * aeoRenewal.ts — tRPC router for AEO renewal requests
 * Business rules: WCO SAFE Framework, ECOWAS AEO Programme Guidelines
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { aeoRenewalRequests, aeoApplications, users } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";

export const aeoRenewalRouter = router({
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions: ReturnType<typeof eq>[] = [eq(aeoRenewalRequests.traderId, ctx.user.id)];
      if (input.status) conditions.push(eq(aeoRenewalRequests.status, input.status));
      const [totalRow] = await db.select({ count: count() }).from(aeoRenewalRequests).where(and(...conditions));
      const items = await db.select({
        renewal: aeoRenewalRequests,
        applicationNumber: aeoApplications.applicationNumber,
        tier: aeoApplications.tier,
      }).from(aeoRenewalRequests)
        .leftJoin(aeoApplications, eq(aeoRenewalRequests.applicationId, aeoApplications.id))
        .where(and(...conditions))
        .orderBy(desc(aeoRenewalRequests.requestedAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  submit: protectedProcedure
    .input(z.object({
      applicationId: z.number(),
      notes: z.string().optional(),
      complianceScoreAtRenewal: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [app] = await db.select().from(aeoApplications)
        .where(and(eq(aeoApplications.id, input.applicationId), eq(aeoApplications.traderId, ctx.user.id)));
      if (!app) throw new TRPCError({ code: "NOT_FOUND", message: "AEO application not found" });
      if (app.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved AEO applications can be renewed" });
      }
      const [existing] = await db.select().from(aeoRenewalRequests)
        .where(and(eq(aeoRenewalRequests.applicationId, input.applicationId), eq(aeoRenewalRequests.status, "pending")));
      if (existing) throw new TRPCError({ code: "BAD_REQUEST", message: "A pending renewal already exists" });
      const [renewal] = await db.insert(aeoRenewalRequests).values({
        applicationId: input.applicationId,
        traderId: ctx.user.id,
        status: "pending",
        notes: input.notes,
        complianceScoreAtRenewal: input.complianceScoreAtRenewal,
      }).returning();
      return renewal;
    }),

  adminList: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["pending", "approved", "rejected"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = input.status ? [eq(aeoRenewalRequests.status, input.status)] : [];
      const [totalRow] = await db.select({ count: count() }).from(aeoRenewalRequests)
        .where(conditions.length ? and(...conditions) : undefined);
      const items = await db.select({
        renewal: aeoRenewalRequests,
        traderName: users.name,
        applicationNumber: aeoApplications.applicationNumber,
        tier: aeoApplications.tier,
      }).from(aeoRenewalRequests)
        .leftJoin(users, eq(aeoRenewalRequests.traderId, users.id))
        .leftJoin(aeoApplications, eq(aeoRenewalRequests.applicationId, aeoApplications.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(aeoRenewalRequests.requestedAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  review: adminProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [renewal] = await db.select().from(aeoRenewalRequests).where(eq(aeoRenewalRequests.id, input.id));
      if (!renewal) throw new TRPCError({ code: "NOT_FOUND", message: "Renewal request not found" });
      if (renewal.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "Only pending requests can be reviewed" });
      const [updated] = await db.update(aeoRenewalRequests).set({
        status: input.action === "approve" ? "approved" : "rejected",
        processedAt: new Date(),
        processedBy: ctx.user.id,
        notes: input.notes ?? renewal.notes,
      }).where(eq(aeoRenewalRequests.id, input.id)).returning();
      if (input.action === "approve") {
        const newExpiry = new Date();
        newExpiry.setFullYear(newExpiry.getFullYear() + 3);
        await db.update(aeoApplications).set({ certificateExpiresAt: newExpiry, updatedAt: new Date() })
          .where(eq(aeoApplications.id, renewal.applicationId));
      }
      return updated;
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, pending: 0, approved: 0, rejected: 0 };
    const [total] = await db.select({ count: count() }).from(aeoRenewalRequests);
    const [pending] = await db.select({ count: count() }).from(aeoRenewalRequests).where(eq(aeoRenewalRequests.status, "pending"));
    const [approved] = await db.select({ count: count() }).from(aeoRenewalRequests).where(eq(aeoRenewalRequests.status, "approved"));
    const [rejected] = await db.select({ count: count() }).from(aeoRenewalRequests).where(eq(aeoRenewalRequests.status, "rejected"));
    return { total: total?.count ?? 0, pending: pending?.count ?? 0, approved: approved?.count ?? 0, rejected: rejected?.count ?? 0 };
  }),
});

export type AeoRenewalRouter = typeof aeoRenewalRouter;
