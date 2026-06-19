import crypto from 'crypto';
/**
 * Post-Clearance Audit tRPC Router
 * Allows customs officers to schedule, conduct, and record post-clearance audits.
 * Implements Ghana ICUMS AEO programme and post-clearance audit patterns.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb, getProfileByUserId } from "../db";
import {
  postClearanceAudits, declarations,
} from "../../drizzle/schema";
import { eq, desc, and, sql, count, or, ilike } from "drizzle-orm";

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function generateAuditNumber(): string {
  const year = new Date().getFullYear();
  const seq = parseInt(crypto.randomUUID().replace(/-/g, '').slice(0, 6), 16) % 900000 + 100000;
  return `PCA-${year}-${seq}`;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────
export const postAuditRouter = router({
  /**
   * List post-clearance audits with filtering and pagination.
   * Customs officers see all; traders see only their own.
   */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["scheduled", "in_progress", "completed", "escalated", "closed"]).optional(),
      outcome: z.enum(["compliant", "minor_discrepancy", "major_discrepancy", "fraud_suspected", "pending"]).optional(),
      search: z.string().max(100).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { status, outcome, search, limit = 20, offset = 0 } = input ?? {};
      const isOfficer = ["customs_officer", "admin", "inspector"].includes(ctx.user.role);

      const conditions = [];
      if (!isOfficer) {
        // Traders only see their own audits — traderId is the user.id
        conditions.push(eq(postClearanceAudits.traderId, ctx.user.id));
      }
      if (status) conditions.push(eq(postClearanceAudits.status, status));
      if (outcome) conditions.push(eq(postClearanceAudits.outcome, outcome));
      if (search) {
        conditions.push(or(
          ilike(postClearanceAudits.auditNumber, `%${search}%`),
          ilike(postClearanceAudits.declarationNumber, `%${search}%`),
        ));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [audits, totalResult] = await Promise.all([
        db.select({
          id: postClearanceAudits.id,
          auditNumber: postClearanceAudits.auditNumber,
          declarationId: postClearanceAudits.declarationId,
          declarationNumber: postClearanceAudits.declarationNumber,
          traderId: postClearanceAudits.traderId,
          assignedOfficerId: postClearanceAudits.assignedOfficerId,
          status: postClearanceAudits.status,
          outcome: postClearanceAudits.outcome,
          triggerReason: postClearanceAudits.triggerReason,
          declaredValue: postClearanceAudits.declaredValue,
          auditedValue: postClearanceAudits.auditedValue,
          valueDifference: postClearanceAudits.valueDifference,
          additionalDutyAssessed: postClearanceAudits.additionalDutyAssessed,
          penaltyAmount: postClearanceAudits.penaltyAmount,
          findings: postClearanceAudits.findings,
          scheduledDate: postClearanceAudits.scheduledDate,
          startedAt: postClearanceAudits.startedAt,
          completedAt: postClearanceAudits.completedAt,
          createdAt: postClearanceAudits.createdAt,
          // Declaration details
          hsCode: declarations.hsCode,
          goodsDescription: declarations.goodsDescription,
          portOfEntry: declarations.portOfEntry,
          riskLane: declarations.riskLane,
        })
          .from(postClearanceAudits)
          .leftJoin(declarations, eq(postClearanceAudits.declarationId, declarations.id))
          .where(where)
          .orderBy(desc(postClearanceAudits.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() })
          .from(postClearanceAudits)
          .where(where),
      ]);

      return {
        audits,
        total: Number(totalResult[0]?.total ?? 0),
      };
    }),

  /**
   * Get a single audit by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [audit] = await db.select()
        .from(postClearanceAudits)
        .where(eq(postClearanceAudits.id, input.id))
        .limit(1);

      if (!audit) throw new TRPCError({ code: "NOT_FOUND", message: "Audit not found" });

      const isOfficer = ["customs_officer", "admin", "inspector"].includes(ctx.user.role);
      if (!isOfficer) {
        // Traders can only view their own audits
        if (audit.traderId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
        }
      }
      return audit;
    }),

  /**
   * Schedule a new post-clearance audit for a declaration.
   * Customs officers and admins only.
   */
  schedule: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      triggerReason: z.string().min(10).max(1000),
      scheduledDate: z.date().optional(),
      assignedOfficerId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isOfficer = ["customs_officer", "admin", "inspector"].includes(ctx.user.role);
      if (!isOfficer) throw new TRPCError({ code: "FORBIDDEN", message: "Only customs officers can schedule audits" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Fetch the declaration
      const [decl] = await db.select({
        id: declarations.id,
        declarationNumber: declarations.declarationNumber,
        traderId: declarations.traderId,
        invoiceValue: declarations.invoiceValue,
        status: declarations.status,
      })
        .from(declarations)
        .where(eq(declarations.id, input.declarationId))
        .limit(1);

      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (decl.status !== "cleared") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only cleared declarations can be audited" });
      }

      const auditNumber = generateAuditNumber();
      const [audit] = await db.insert(postClearanceAudits).values({
        auditNumber,
        declarationId: decl.id,
        declarationNumber: decl.declarationNumber,
        traderId: decl.traderId,
        assignedOfficerId: input.assignedOfficerId ?? ctx.user.id,
        status: "scheduled",
        outcome: "pending",
        triggerReason: input.triggerReason,
        declaredValue: decl.invoiceValue,
        scheduledDate: input.scheduledDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }).returning();

      return audit;
    }),

  /**
   * Update audit status and record findings.
   * Customs officers and admins only.
   */
  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["scheduled", "in_progress", "completed", "escalated", "closed"]).optional(),
      outcome: z.enum(["compliant", "minor_discrepancy", "major_discrepancy", "fraud_suspected", "pending"]).optional(),
      auditedValue: z.number().positive().optional(),
      additionalDutyAssessed: z.number().min(0).optional(),
      penaltyAmount: z.number().min(0).optional(),
      findings: z.string().max(5000).optional(),
      officerNotes: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const isOfficer = ["customs_officer", "admin", "inspector"].includes(ctx.user.role);
      if (!isOfficer) throw new TRPCError({ code: "FORBIDDEN", message: "Only customs officers can update audits" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [existing] = await db.select()
        .from(postClearanceAudits)
        .where(eq(postClearanceAudits.id, input.id))
        .limit(1);

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Audit not found" });

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (input.status) updateData.status = input.status;
      if (input.outcome) updateData.outcome = input.outcome;
      if (input.findings !== undefined) updateData.findings = input.findings;
      if (input.officerNotes !== undefined) updateData.officerNotes = input.officerNotes;
      if (input.auditedValue !== undefined) {
        updateData.auditedValue = String(input.auditedValue);
        const declared = parseFloat(existing.declaredValue ?? "0");
        updateData.valueDifference = String(input.auditedValue - declared);
      }
      if (input.additionalDutyAssessed !== undefined) {
        updateData.additionalDutyAssessed = String(input.additionalDutyAssessed);
      }
      if (input.penaltyAmount !== undefined) {
        updateData.penaltyAmount = String(input.penaltyAmount);
      }
      if (input.status === "in_progress" && !existing.startedAt) {
        updateData.startedAt = new Date();
      }
      if (input.status === "completed" || input.status === "closed") {
        updateData.completedAt = new Date();
      }

      const [updated] = await db.update(postClearanceAudits)
        .set(updateData)
        .where(eq(postClearanceAudits.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * Dashboard statistics for the audit module.
   */
  stats: protectedProcedure
    .query(async ({ ctx }) => {
      const isOfficer = ["customs_officer", "admin", "inspector", "finance"].includes(ctx.user.role);
      if (!isOfficer) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) return {
        total: 0, scheduled: 0, inProgress: 0, completed: 0,
        totalAdditionalDuty: 0, totalPenalties: 0, complianceRate: 0,
      };

      const [stats] = await db.select({
        total: count(),
        scheduled: sql<number>`COUNT(CASE WHEN status = 'scheduled' THEN 1 END)`,
        inProgress: sql<number>`COUNT(CASE WHEN status = 'in_progress' THEN 1 END)`,
        completed: sql<number>`COUNT(CASE WHEN status = 'completed' THEN 1 END)`,
        escalated: sql<number>`COUNT(CASE WHEN status = 'escalated' THEN 1 END)`,
        compliant: sql<number>`COUNT(CASE WHEN outcome = 'compliant' THEN 1 END)`,
        totalAdditionalDuty: sql<string>`COALESCE(SUM(CAST(additional_duty_assessed AS DECIMAL)), 0)`,
        totalPenalties: sql<string>`COALESCE(SUM(CAST(penalty_amount AS DECIMAL)), 0)`,
      }).from(postClearanceAudits);

      const total = Number(stats?.total ?? 0);
      const compliant = Number(stats?.compliant ?? 0);
      const completedCount = Number(stats?.completed ?? 0);

      return {
        total,
        scheduled: Number(stats?.scheduled ?? 0),
        inProgress: Number(stats?.inProgress ?? 0),
        completed: completedCount,
        escalated: Number(stats?.escalated ?? 0),
        totalAdditionalDuty: parseFloat(stats?.totalAdditionalDuty ?? "0"),
        totalPenalties: parseFloat(stats?.totalPenalties ?? "0"),
        complianceRate: completedCount > 0 ? Math.round((compliant / completedCount) * 100) : 0,
      };
    }),
});
