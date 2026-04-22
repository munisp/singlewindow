/**
 * dutyDrawback.ts — tRPC router for duty drawback claims management
 * Handles manufacturing, unused merchandise, rejected merchandise, and substitution drawback types.
 * Business rules: WCO Guidelines on Duty Drawback, ECOWAS CET Protocol
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dutyDrawbackClaims, users } from "../../drizzle/schema";
import { eq, desc, and, like, count, sum, sql } from "drizzle-orm";

function generateClaimNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 900000) + 100000;
  return `DDC-${year}-${seq}`;
}

export const dutyDrawbackRouter = router({
  /** List claims for the current trader */
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["draft", "submitted", "under_review", "approved", "rejected", "paid"]).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = [eq(dutyDrawbackClaims.traderId, ctx.user.id)];
      if (input.status) conditions.push(eq(dutyDrawbackClaims.status, input.status));
      if (input.search) conditions.push(like(dutyDrawbackClaims.claimNumber, `%${input.search}%`));
      const [totalRow] = await db.select({ count: count() }).from(dutyDrawbackClaims).where(and(...conditions));
      const items = await db.select().from(dutyDrawbackClaims)
        .where(and(...conditions))
        .orderBy(desc(dutyDrawbackClaims.createdAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Get a single claim */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [claim] = await db.select().from(dutyDrawbackClaims)
        .where(and(eq(dutyDrawbackClaims.id, input.id), eq(dutyDrawbackClaims.traderId, ctx.user.id)));
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      return claim;
    }),

  /** Create a new duty drawback claim */
  create: protectedProcedure
    .input(z.object({
      importDeclarationId: z.number(),
      importDeclarationNumber: z.string(),
      exportDeclarationId: z.number().optional(),
      exportDeclarationNumber: z.string().optional(),
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]),
      originalDutyPaid: z.string(),
      claimedAmount: z.string(),
      hsCode: z.string().optional(),
      goodsDescription: z.string().optional(),
      importQuantity: z.string().optional(),
      exportQuantity: z.string().optional(),
      quantityUnit: z.string().optional(),
      importDate: z.string().optional(),
      exportDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Business rule: claimed amount cannot exceed original duty paid
      const claimed = parseFloat(input.claimedAmount);
      const original = parseFloat(input.originalDutyPaid);
      if (claimed > original) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Claimed amount cannot exceed original duty paid" });
      }
      // Business rule: manufacturing drawback requires export evidence
      if (input.drawbackType === "manufacturing" && !input.exportDeclarationNumber) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Manufacturing drawback requires export declaration number" });
      }
      const [claim] = await db.insert(dutyDrawbackClaims).values({
        claimNumber: generateClaimNumber(),
        traderId: ctx.user.id,
        importDeclarationId: input.importDeclarationId,
        importDeclarationNumber: input.importDeclarationNumber,
        exportDeclarationId: input.exportDeclarationId,
        exportDeclarationNumber: input.exportDeclarationNumber,
        drawbackType: input.drawbackType,
        status: "draft",
        originalDutyPaid: input.originalDutyPaid,
        claimedAmount: input.claimedAmount,
        hsCode: input.hsCode,
        goodsDescription: input.goodsDescription,
        importQuantity: input.importQuantity,
        exportQuantity: input.exportQuantity,
        quantityUnit: input.quantityUnit,
        importDate: input.importDate ? new Date(input.importDate) : undefined,
        exportDate: input.exportDate ? new Date(input.exportDate) : undefined,
      }).returning();
      return claim;
    }),

  /** Submit a draft claim for review */
  submit: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [claim] = await db.select().from(dutyDrawbackClaims)
        .where(and(eq(dutyDrawbackClaims.id, input.id), eq(dutyDrawbackClaims.traderId, ctx.user.id)));
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (claim.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft claims can be submitted" });
      const [updated] = await db.update(dutyDrawbackClaims)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(dutyDrawbackClaims.id, input.id))
        .returning();
      return updated;
    }),

  /** Admin: list all claims */
  adminList: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["draft", "submitted", "under_review", "approved", "rejected", "paid"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = input.status ? [eq(dutyDrawbackClaims.status, input.status)] : [];
      const [totalRow] = await db.select({ count: count() }).from(dutyDrawbackClaims)
        .where(conditions.length ? and(...conditions) : undefined);
      const items = await db.select({
        claim: dutyDrawbackClaims,
        traderName: users.name,
      }).from(dutyDrawbackClaims)
        .leftJoin(users, eq(dutyDrawbackClaims.traderId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(dutyDrawbackClaims.createdAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Admin: approve or reject a claim */
  review: adminProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      approvedAmount: z.string().optional(),
      reviewerNotes: z.string().optional(),
      rejectionReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [claim] = await db.select().from(dutyDrawbackClaims).where(eq(dutyDrawbackClaims.id, input.id));
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (!["submitted", "under_review"].includes(claim.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Claim is not in a reviewable state" });
      }
      if (input.action === "approve" && !input.approvedAmount) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Approved amount is required for approval" });
      }
      const [updated] = await db.update(dutyDrawbackClaims).set({
        status: input.action === "approve" ? "approved" : "rejected",
        approvedAmount: input.approvedAmount,
        reviewerNotes: input.reviewerNotes,
        rejectionReason: input.rejectionReason,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(dutyDrawbackClaims.id, input.id)).returning();
      return updated;
    }),

  /** Admin: mark approved claim as paid */
  markPaid: adminProcedure
    .input(z.object({ id: z.number(), paidAmount: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [updated] = await db.update(dutyDrawbackClaims).set({
        status: "paid",
        paidAmount: input.paidAmount,
        paidAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(dutyDrawbackClaims.id, input.id)).returning();
      return updated;
    }),

  /** Stats for dashboard */
  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, pending: 0, approved: 0, totalApprovedAmount: "0" };
    const [total] = await db.select({ count: count() }).from(dutyDrawbackClaims);
    const [pending] = await db.select({ count: count() }).from(dutyDrawbackClaims)
      .where(eq(dutyDrawbackClaims.status, "submitted"));
    const [approved] = await db.select({ count: count() }).from(dutyDrawbackClaims)
      .where(eq(dutyDrawbackClaims.status, "approved"));
    const [totalAmount] = await db.select({ total: sum(dutyDrawbackClaims.approvedAmount) }).from(dutyDrawbackClaims)
      .where(eq(dutyDrawbackClaims.status, "approved"));
    return {
      total: total?.count ?? 0,
      pending: pending?.count ?? 0,
      approved: approved?.count ?? 0,
      totalApprovedAmount: totalAmount?.total ?? "0",
    };
  }),
});

export type DutyDrawbackRouter = typeof dutyDrawbackRouter;
