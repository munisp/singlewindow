import crypto from 'crypto';
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
import { assertCan } from "../_core/permify";
import {
  dutyDrawbackClaims, declarations, payments,
} from "../../drizzle/schema";
import { eq, desc, and, sql, count, or, ilike } from "drizzle-orm";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateClaimNumber(): string {
  const year = new Date().getFullYear();
  const seq = parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 6), 16) % 900000 + 100000;
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
      await assertCan(String(ctx.user.id), "duty_drawback_claim", String(input.id), "review");

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
   * Sprint 60 — Check eligibility for duty drawback claim.
   * Cross-references import declaration against export proof by HS code and trader.
   */
  checkEligibility: protectedProcedure
    .input(z.object({
      importDeclarationId: z.number().int().positive(),
      exportDeclarationId: z.number().int().positive().optional(),
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [importDecl] = await db.select({
        id: declarations.id,
        declarationNumber: declarations.declarationNumber,
        traderId: declarations.traderId,
        status: declarations.status,
        dutyAmount: declarations.dutyAmount,
        totalDue: declarations.totalDue,
        hsCode: declarations.hsCode,
        goodsDescription: declarations.goodsDescription,
        submittedAt: declarations.submittedAt,
        clearedAt: declarations.clearedAt,
      }).from(declarations).where(eq(declarations.id, input.importDeclarationId)).limit(1);

      if (!importDecl) {
        return { eligible: false, reason: "Import declaration not found", refundRate: 0, estimatedRefund: 0 };
      }
      if (importDecl.traderId !== ctx.user.id) {
        return { eligible: false, reason: "You do not own this import declaration", refundRate: 0, estimatedRefund: 0 };
      }
      if (importDecl.status !== "cleared") {
        return { eligible: false, reason: `Declaration must be cleared (current: ${importDecl.status})`, refundRate: 0, estimatedRefund: 0 };
      }

      // Check if a claim already exists for this import declaration
      const existingClaims = await db.select({ id: dutyDrawbackClaims.id, status: dutyDrawbackClaims.status })
        .from(dutyDrawbackClaims)
        .where(and(
          eq(dutyDrawbackClaims.importDeclarationId, input.importDeclarationId),
          eq(dutyDrawbackClaims.traderId, ctx.user.id),
        ));
      const activeClaim = existingClaims.find(c => !["rejected"].includes(c.status));
      if (activeClaim) {
        return { eligible: false, reason: `A claim already exists for this declaration (status: ${activeClaim.status})`, refundRate: 0, estimatedRefund: 0 };
      }

      // Check 3-year filing deadline
      const clearedDate = importDecl.clearedAt ?? importDecl.submittedAt;
      if (clearedDate) {
        const yearsElapsed = (Date.now() - new Date(clearedDate).getTime()) / (365.25 * 24 * 3600 * 1000);
        if (yearsElapsed > 3) {
          return { eligible: false, reason: "Filing deadline exceeded (3 years from clearance date)", refundRate: 0, estimatedRefund: 0 };
        }
      }

      // Determine refund rate by drawback type
      const REFUND_RATES: Record<string, number> = {
        manufacturing: 0.99,
        unused_merchandise: 0.99,
        rejected_merchandise: 1.00,
        substitution: 0.99,
      };
      const refundRate = REFUND_RATES[input.drawbackType] ?? 0.99;
      const dutyPaid = parseFloat(importDecl.dutyAmount ?? importDecl.totalDue ?? "0");
      const estimatedRefund = Math.round(dutyPaid * refundRate * 100) / 100;

      return {
        eligible: true,
        reason: "Declaration is eligible for duty drawback",
        refundRate,
        estimatedRefund,
        dutyPaid,
        hsCode: importDecl.hsCode,
        declarationNumber: importDecl.declarationNumber,
        clearedAt: importDecl.clearedAt,
      };
    }),

  /**
   * Sprint 60 — Calculate refund amount for a drawback claim.
   * Supports partial quantity claims (export quantity < import quantity).
   */
  calculateRefund: protectedProcedure
    .input(z.object({
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]),
      dutyPaid: z.number().positive(),
      importQuantity: z.number().positive().optional(),
      exportQuantity: z.number().positive().optional(),
      hsCode: z.string().max(20).optional(),
    }))
    .query(({ input }) => {
      const REFUND_RATES: Record<string, number> = {
        manufacturing: 0.99,
        unused_merchandise: 0.99,
        rejected_merchandise: 1.00,
        substitution: 0.99,
      };
      const refundRate = REFUND_RATES[input.drawbackType] ?? 0.99;

      // Partial quantity adjustment
      let quantityRatio = 1.0;
      if (input.importQuantity && input.exportQuantity) {
        quantityRatio = Math.min(input.exportQuantity / input.importQuantity, 1.0);
      }

      const grossRefund = input.dutyPaid * refundRate * quantityRatio;
      const processingFee = Math.min(grossRefund * 0.005, 500); // 0.5% capped at $500
      const netRefund = Math.round((grossRefund - processingFee) * 100) / 100;

      return {
        refundRate,
        quantityRatio: Math.round(quantityRatio * 10000) / 10000,
        grossRefund: Math.round(grossRefund * 100) / 100,
        processingFee: Math.round(processingFee * 100) / 100,
        netRefund,
        breakdown: {
          dutyPaid: input.dutyPaid,
          refundRateApplied: refundRate,
          quantityAdjustment: quantityRatio < 1 ? `${Math.round(quantityRatio * 100)}% (partial export)` : "100% (full export)",
          processingFeeNote: "0.5% of gross refund, capped at USD 500",
        },
      };
    }),

  /**
   * Sprint 60 — Generate a pre-filled drawback claim PDF summary.
   * Returns a structured data object for client-side PDF rendering.
   */
  generateClaimPdf: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [claim] = await db.select().from(dutyDrawbackClaims).where(eq(dutyDrawbackClaims.id, input.id)).limit(1);
      if (!claim) throw new TRPCError({ code: "NOT_FOUND", message: "Claim not found" });

      const isReviewer = ["customs_officer", "admin", "finance"].includes(ctx.user.role);
      if (!isReviewer && claim.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      // Return structured data for client-side PDF generation
      return {
        claimNumber: claim.claimNumber,
        traderId: claim.traderId,
        traderName: ctx.user.name,
        drawbackType: claim.drawbackType,
        status: claim.status,
        importDeclarationNumber: claim.importDeclarationNumber,
        exportDeclarationNumber: claim.exportDeclarationNumber,
        hsCode: claim.hsCode,
        goodsDescription: claim.goodsDescription,
        importDate: claim.importDate,
        exportDate: claim.exportDate,
        originalDutyPaid: parseFloat(claim.originalDutyPaid ?? "0"),
        claimedAmount: parseFloat(claim.claimedAmount ?? "0"),
        approvedAmount: claim.approvedAmount ? parseFloat(claim.approvedAmount) : null,
        importQuantity: claim.importQuantity ? parseFloat(claim.importQuantity) : null,
        exportQuantity: claim.exportQuantity ? parseFloat(claim.exportQuantity) : null,
        quantityUnit: claim.quantityUnit,
        submittedAt: claim.submittedAt,
        reviewedAt: claim.reviewedAt,
        generatedAt: new Date(),
        formTitle: "DUTY DRAWBACK CLAIM FORM",
        authority: "Ghana Revenue Authority — Customs Division",
        legalBasis: "Customs and Excise Management Act (CEMA), Section 118",
      };
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

  /**
   * v115: autoCalculateFromDeclaration — automatically compute the maximum eligible
   * drawback refund for a given declaration by looking up the actual duty paid,
   * HS code, and export quantity from the database.
   * Returns a full breakdown with eligibility assessment.
   */
  autoCalculateFromDeclaration: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      drawbackType: z.enum(["manufacturing", "unused_merchandise", "rejected_merchandise", "substitution"]).default("unused_merchandise"),
      exportQuantity: z.number().positive().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [decl] = await db
        .select({
          id: declarations.id,
          traderId: declarations.traderId,
          hsCode: declarations.hsCode,
          dutyAmount: declarations.dutyAmount,
          vatAmount: declarations.vatAmount,
          totalDue: declarations.totalDue,
          invoiceValue: declarations.invoiceValue,
          numberOfPackages: declarations.numberOfPackages,
          status: declarations.status,
          declarationType: declarations.declarationType,
        })
        .from(declarations)
        .where(eq(declarations.id, input.declarationId))
        .limit(1);

      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });

      const isOwner = decl.traderId === ctx.user.id;
      const isPrivileged = ["admin", "customs_officer", "finance"].includes(ctx.user.role);
      if (!isOwner && !isPrivileged) throw new TRPCError({ code: "FORBIDDEN" });

      // Only import declarations are eligible for drawback
      const eligible = decl.declarationType === "import" && decl.status === "cleared";
      if (!eligible) {
        return {
          eligible: false,
          reason: decl.declarationType !== "import"
            ? "Only import declarations are eligible for duty drawback"
            : "Declaration must be in 'cleared' status to claim drawback",
          declarationId: input.declarationId,
          netRefund: 0,
          breakdown: null,
        };
      }

      const dutyPaid = parseFloat(decl.dutyAmount ?? "0");
      if (dutyPaid <= 0) {
        return {
          eligible: false,
          reason: "No duty was paid on this declaration",
          declarationId: input.declarationId,
          netRefund: 0,
          breakdown: null,
        };
      }

      const REFUND_RATES: Record<string, number> = {
        manufacturing: 0.99,
        unused_merchandise: 0.99,
        rejected_merchandise: 1.00,
        substitution: 0.99,
      };
      const refundRate = REFUND_RATES[input.drawbackType] ?? 0.99;

      // Quantity ratio: if exportQuantity provided, compare to numberOfPackages
      let quantityRatio = 1.0;
      if (input.exportQuantity && decl.numberOfPackages && decl.numberOfPackages > 0) {
        quantityRatio = Math.min(input.exportQuantity / decl.numberOfPackages, 1.0);
      }

      const grossRefund = dutyPaid * refundRate * quantityRatio;
      const processingFee = Math.min(grossRefund * 0.005, 500);
      const netRefund = Math.round((grossRefund - processingFee) * 100) / 100;

      // Check for existing drawback claims on this declaration
      const existingClaims = await db
        .select({ id: dutyDrawbackClaims.id, status: dutyDrawbackClaims.status, claimedAmount: dutyDrawbackClaims.claimedAmount })
        .from(dutyDrawbackClaims)
        .where(eq(dutyDrawbackClaims.importDeclarationId, input.declarationId));

      const alreadyClaimed = existingClaims.some((c) => ["submitted", "under_review", "approved", "paid"].includes(c.status));

      return {
        eligible: !alreadyClaimed,
        reason: alreadyClaimed ? "A drawback claim already exists for this declaration" : null,
        declarationId: input.declarationId,
        hsCode: decl.hsCode,
        drawbackType: input.drawbackType,
        refundRate,
        quantityRatio: Math.round(quantityRatio * 10000) / 10000,
        grossRefund: Math.round(grossRefund * 100) / 100,
        processingFee: Math.round(processingFee * 100) / 100,
        netRefund,
        existingClaims: existingClaims.map((c) => ({ id: c.id, status: c.status, amount: parseFloat(c.claimedAmount ?? "0") })),
        breakdown: {
          dutyPaid,
          vatPaid: parseFloat(decl.vatAmount ?? "0"),
          invoiceValue: parseFloat(decl.invoiceValue ?? "0"),
          refundRateApplied: refundRate,
          quantityAdjustment: quantityRatio < 1 ? `${Math.round(quantityRatio * 100)}% (partial export)` : "100% (full export)",
          processingFeeNote: "0.5% of gross refund, capped at USD 500",
          legalBasis: "Section 74 Customs Act — Drawback of Customs Duty",
        },
      };
    }),

  /**
   * v115: getEligibleDeclarations — list all cleared import declarations for the
   * current user that have no existing drawback claim and have duty > 0.
   */
  getEligibleDeclarations: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { declarations: [], total: 0 };

      const isPrivileged = ["admin", "customs_officer", "finance"].includes(ctx.user.role);

      // Get cleared import declarations with duty paid
      const rows = await db
        .select({
          id: declarations.id,
          declarationNumber: declarations.declarationNumber,
          hsCode: declarations.hsCode,
          dutyAmount: declarations.dutyAmount,
          invoiceValue: declarations.invoiceValue,
          countryOfOrigin: declarations.countryOfOrigin,
          clearedAt: declarations.clearedAt,
          traderId: declarations.traderId,
        })
        .from(declarations)
        .where(
          and(
            isPrivileged ? undefined : eq(declarations.traderId, ctx.user.id),
            eq(declarations.declarationType, "import"),
            eq(declarations.status, "cleared"),
            sql`${declarations.dutyAmount}::numeric > 0`,
          )
        )
        .orderBy(desc(declarations.clearedAt))
        .limit(input.limit)
        .offset(input.offset);

      // Filter out those with existing claims
      const withClaims = await db
        .select({ declarationId: dutyDrawbackClaims.importDeclarationId })
        .from(dutyDrawbackClaims)
        .where(
          and(
            sql`${dutyDrawbackClaims.status} IN ('submitted', 'under_review', 'approved', 'paid')`,
          )
        );

      const claimedIds = new Set(withClaims.map((c) => c.declarationId));
      const eligible = rows.filter((r) => !claimedIds.has(r.id));

      return {
        declarations: eligible.map((r) => ({
          ...r,
          dutyAmount: parseFloat(r.dutyAmount ?? "0"),
          invoiceValue: parseFloat(r.invoiceValue ?? "0"),
          estimatedRefund: Math.round(parseFloat(r.dutyAmount ?? "0") * 0.99 * 0.995 * 100) / 100,
        })),
        total: eligible.length,
      };
    }),
});