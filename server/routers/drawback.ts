/**
 * Duty Drawback tRPC Router
 * Allows traders to submit duty drawback claims for re-exported goods.
 * Implements TigerBeetle double-entry loop: payment → drawback refund.
 * Based on Ghana ICUMS AEO programme duty drawback module.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  dutyDrawbackClaims, declarations, payments,
} from "../../drizzle/schema";
import { eq, desc, and, sql, count, or, ilike } from "drizzle-orm";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateClaimNumber(): string {
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 900000) + 100000;
  return `DDC-${year}-${seq}`;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────
export const drawbackRouter = router({
  /**
   * List duty drawback claims.
   * Traders see only their own; finance/customs officers see all.
   */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["draft", "submitted", "under_review", "approved", "rejected", "paid"]).optional(),
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]).optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { status, drawbackType, search, limit = 20, offset = 0 } = input ?? {};
      const isReviewer = ["customs_officer", "admin", "finance"].includes(ctx.user.role);

      const conditions = [];
      if (!isReviewer) {
        conditions.push(eq(dutyDrawbackClaims.traderId, ctx.user.id));
      }
      if (status) conditions.push(eq(dutyDrawbackClaims.status, status));
      if (drawbackType) conditions.push(eq(dutyDrawbackClaims.drawbackType, drawbackType));
      if (search) {
        conditions.push(or(
          ilike(dutyDrawbackClaims.claimNumber, `%${search}%`),
          ilike(dutyDrawbackClaims.importDeclarationNumber, `%${search}%`),
        ));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [claims, totalResult] = await Promise.all([
        db.select({
          id: dutyDrawbackClaims.id,
          claimNumber: dutyDrawbackClaims.claimNumber,
          traderId: dutyDrawbackClaims.traderId,
          importDeclarationId: dutyDrawbackClaims.importDeclarationId,
          importDeclarationNumber: dutyDrawbackClaims.importDeclarationNumber,
          exportDeclarationNumber: dutyDrawbackClaims.exportDeclarationNumber,
          drawbackType: dutyDrawbackClaims.drawbackType,
          status: dutyDrawbackClaims.status,
          originalDutyPaid: dutyDrawbackClaims.originalDutyPaid,
          claimedAmount: dutyDrawbackClaims.claimedAmount,
          approvedAmount: dutyDrawbackClaims.approvedAmount,
          paidAmount: dutyDrawbackClaims.paidAmount,
          hsCode: dutyDrawbackClaims.hsCode,
          goodsDescription: dutyDrawbackClaims.goodsDescription,
          importDate: dutyDrawbackClaims.importDate,
          exportDate: dutyDrawbackClaims.exportDate,
          submittedAt: dutyDrawbackClaims.submittedAt,
          reviewedAt: dutyDrawbackClaims.reviewedAt,
          paidAt: dutyDrawbackClaims.paidAt,
          createdAt: dutyDrawbackClaims.createdAt,
          rejectionReason: dutyDrawbackClaims.rejectionReason,
        })
          .from(dutyDrawbackClaims)
          .where(where)
          .orderBy(desc(dutyDrawbackClaims.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() })
          .from(dutyDrawbackClaims)
          .where(where),
      ]);

      return {
        claims,
        total: Number(totalResult[0]?.total ?? 0),
      };
    }),

  /**
   * Get a single drawback claim by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [claim] = await db.select()
        .from(dutyDrawbackClaims)
        .where(eq(dutyDrawbackClaims.id, input.id))
        .limit(1);

      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });

      const isReviewer = ["customs_officer", "admin", "finance"].includes(ctx.user.role);
      if (!isReviewer && claim.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      return claim;
    }),

  /**
   * Create a new duty drawback claim (draft).
   * Traders only.
   */
  create: protectedProcedure
    .input(z.object({
      importDeclarationId: z.number().int().positive(),
      exportDeclarationId: z.number().int().positive().optional(),
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]),
      claimedAmount: z.number().positive(),
      importQuantity: z.number().positive().optional(),
      exportQuantity: z.number().positive().optional(),
      quantityUnit: z.string().max(16).optional(),
      goodsDescription: z.string().max(500).optional(),
      reExportEvidence: z.array(z.object({
        documentType: z.string(),
        fileUrl: z.string().url(),
        description: z.string().optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Fetch the import declaration to verify ownership and get duty paid
      const [importDecl] = await db.select({
        id: declarations.id,
        declarationNumber: declarations.declarationNumber,
        traderId: declarations.traderId,
        dutyAmount: declarations.dutyAmount,
        vatAmount: declarations.vatAmount,
        totalDue: declarations.totalDue,
        hsCode: declarations.hsCode,
        goodsDescription: declarations.goodsDescription,
        status: declarations.status,
        submittedAt: declarations.submittedAt,
        clearedAt: declarations.clearedAt,
      })
        .from(declarations)
        .where(eq(declarations.id, input.importDeclarationId))
        .limit(1);

      if (!importDecl) throw new TRPCError({ code: "NOT_FOUND", message: "Import declaration not found" });
      if (importDecl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only claim drawback on your own declarations" });
      }
      if (importDecl.status !== "cleared") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Import declaration must be cleared before claiming drawback" });
      }

      const originalDutyPaid = parseFloat(importDecl.dutyAmount ?? importDecl.totalDue ?? "0");
      if (input.claimedAmount > originalDutyPaid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Claimed amount (${input.claimedAmount}) cannot exceed original duty paid (${originalDutyPaid})`,
        });
      }

      // Fetch export declaration if provided
      let exportDecl: typeof importDecl | null = null;
      if (input.exportDeclarationId) {
        const [ed] = await db.select({
          id: declarations.id,
          declarationNumber: declarations.declarationNumber,
          traderId: declarations.traderId,
          status: declarations.status,
          submittedAt: declarations.submittedAt,
          clearedAt: declarations.clearedAt,
          dutyAmount: declarations.dutyAmount,
          vatAmount: declarations.vatAmount,
          totalDue: declarations.totalDue,
          hsCode: declarations.hsCode,
          goodsDescription: declarations.goodsDescription,
        })
          .from(declarations)
          .where(eq(declarations.id, input.exportDeclarationId))
          .limit(1);
        if (ed && ed.traderId === ctx.user.id) exportDecl = ed;
      }

      const claimNumber = generateClaimNumber();
      const [claim] = await db.insert(dutyDrawbackClaims).values({
        claimNumber,
        traderId: ctx.user.id,
        importDeclarationId: importDecl.id,
        importDeclarationNumber: importDecl.declarationNumber,
        exportDeclarationId: exportDecl?.id,
        exportDeclarationNumber: exportDecl?.declarationNumber,
        drawbackType: input.drawbackType,
        status: "draft",
        originalDutyPaid: String(originalDutyPaid),
        claimedAmount: String(input.claimedAmount),
        hsCode: importDecl.hsCode,
        goodsDescription: input.goodsDescription ?? importDecl.goodsDescription,
        importQuantity: input.importQuantity ? String(input.importQuantity) : null,
        exportQuantity: input.exportQuantity ? String(input.exportQuantity) : null,
        quantityUnit: input.quantityUnit,
        reExportEvidence: input.reExportEvidence ?? [],
        importDate: importDecl.clearedAt ?? importDecl.submittedAt,
        exportDate: exportDecl?.clearedAt ?? exportDecl?.submittedAt,
      }).returning();

      return claim;
    }),

  /**
   * Submit a draft claim for review.
   */
  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [claim] = await db.select()
        .from(dutyDrawbackClaims)
        .where(and(
          eq(dutyDrawbackClaims.id, input.id),
          eq(dutyDrawbackClaims.traderId, ctx.user.id),
        ))
        .limit(1);

      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (claim.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft claims can be submitted" });
      }

      const [updated] = await db.update(dutyDrawbackClaims)
        .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(dutyDrawbackClaims.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * Review a claim (approve / reject / request more info).
   * Finance and customs officers only.
   */
  review: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      decision: z.enum(["approved", "rejected"]),
      approvedAmount: z.number().positive().optional(),
      reviewerNotes: z.string().max(2000).optional(),
      rejectionReason: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isReviewer = ["customs_officer", "admin", "finance"].includes(ctx.user.role);
      if (!isReviewer) throw new TRPCError({ code: "FORBIDDEN", message: "Only finance/customs officers can review claims" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [claim] = await db.select()
        .from(dutyDrawbackClaims)
        .where(eq(dutyDrawbackClaims.id, input.id))
        .limit(1);

      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (!["submitted", "under_review"].includes(claim.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Claim must be submitted or under review to be reviewed" });
      }

      const updateData: Record<string, unknown> = {
        status: input.decision,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };
      if (input.reviewerNotes) updateData.reviewerNotes = input.reviewerNotes;
      if (input.rejectionReason) updateData.rejectionReason = input.rejectionReason;
      if (input.decision === "approved") {
        updateData.approvedAmount = String(input.approvedAmount ?? parseFloat(claim.claimedAmount));
      }

      const [updated] = await db.update(dutyDrawbackClaims)
        .set(updateData)
        .where(eq(dutyDrawbackClaims.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * Mark an approved claim as paid (finance officer).
   */
  markPaid: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      paidAmount: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isFinance = ["admin", "finance"].includes(ctx.user.role);
      if (!isFinance) throw new TRPCError({ code: "FORBIDDEN", message: "Only finance officers can mark claims as paid" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [claim] = await db.select()
        .from(dutyDrawbackClaims)
        .where(eq(dutyDrawbackClaims.id, input.id))
        .limit(1);

      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });
      if (claim.status !== "approved") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved claims can be marked as paid" });
      }

      const [updated] = await db.update(dutyDrawbackClaims)
        .set({
          status: "paid",
          paidAmount: String(input.paidAmount),
          paidAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(dutyDrawbackClaims.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * Dashboard statistics for the drawback module.
   */
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return {
        total: 0, submitted: 0, approved: 0, paid: 0,
        totalClaimed: 0, totalApproved: 0, totalPaid: 0,
      };

      const isReviewer = ["customs_officer", "admin", "finance"].includes(ctx.user.role);
      const where = isReviewer ? undefined : eq(dutyDrawbackClaims.traderId, ctx.user.id);

      const [stats] = await db.select({
        total: count(),
        submitted: sql<number>`COUNT(CASE WHEN status = 'submitted' THEN 1 END)`,
        underReview: sql<number>`COUNT(CASE WHEN status = 'under_review' THEN 1 END)`,
        approved: sql<number>`COUNT(CASE WHEN status = 'approved' THEN 1 END)`,
        paid: sql<number>`COUNT(CASE WHEN status = 'paid' THEN 1 END)`,
        rejected: sql<number>`COUNT(CASE WHEN status = 'rejected' THEN 1 END)`,
        totalClaimed: sql<string>`COALESCE(SUM(CAST(claimed_amount AS DECIMAL)), 0)`,
        totalApproved: sql<string>`COALESCE(SUM(CAST(approved_amount AS DECIMAL)), 0)`,
        totalPaid: sql<string>`COALESCE(SUM(CAST(paid_amount AS DECIMAL)), 0)`,
      }).from(dutyDrawbackClaims).where(where);

      return {
        total: Number(stats?.total ?? 0),
        submitted: Number(stats?.submitted ?? 0),
        underReview: Number(stats?.underReview ?? 0),
        approved: Number(stats?.approved ?? 0),
        paid: Number(stats?.paid ?? 0),
        rejected: Number(stats?.rejected ?? 0),
        totalClaimed: parseFloat(stats?.totalClaimed ?? "0"),
        totalApproved: parseFloat(stats?.totalApproved ?? "0"),
        totalPaid: parseFloat(stats?.totalPaid ?? "0"),
      };
    }),
});
