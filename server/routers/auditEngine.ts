/**
 * Audit Engine Router — v56: Fully PostgreSQL-backed
 * All audit tasks and findings are persisted to the database.
 * No in-memory stores.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  auditTasks, auditFindings,
} from "../../drizzle/schema";
import { eq, and, desc, gte, lte, sql, inArray } from "drizzle-orm";
import crypto from "crypto";

// ─── Business logic helpers ──────────────────────────────────────────────────
export type AuditSelectionReason =
  | "risk_score_high" | "random_sample" | "trader_tier_review"
  | "value_threshold" | "hs_chapter_sensitive" | "repeat_offender" | "post_green_lane";

export type AuditStatus =
  | "pending" | "assigned" | "in_progress" | "findings_submitted" | "closed" | "appealed";

export type FindingType =
  | "undervaluation" | "misclassification" | "origin_mismatch"
  | "quantity_discrepancy" | "prohibited_goods" | "documentation_fraud"
  | "duty_evasion" | "no_finding";

const SENSITIVE_CHAPTERS = new Set(["24", "27", "36", "71", "87", "88", "93"]);
const AUDIT_ROLES = new Set(["admin", "customs_officer", "oga_officer", "inspector", "finance", "auditor"]);

function assertAuditOfficer(role: string): void {
  if (!AUDIT_ROLES.has(role)) throw new TRPCError({ code: "FORBIDDEN", message: "Audit officer access required" });
}

export function selectForAudit(params: {
  riskScore: number; declaredValueUsd: number;
  traderTier: "new" | "standard" | "aeo";
  hsChapter: string; laneAssigned: "GREEN" | "YELLOW" | "RED"; randomSeed: number;
}): AuditSelectionReason | null {
  if (params.riskScore >= 70) return "risk_score_high";
  if (params.declaredValueUsd >= 500_000) return "value_threshold";
  if (SENSITIVE_CHAPTERS.has(params.hsChapter)) return "hs_chapter_sensitive";
  if (params.traderTier === "new" && params.riskScore >= 40) return "trader_tier_review";
  if (params.laneAssigned === "GREEN" && params.randomSeed < 0.05) return "post_green_lane";
  if (params.randomSeed < 0.10) return "random_sample";
  return null;
}

export function calculateDutyDiscrepancy(findings: { findingType: string; amountUsd: number | string }[]): number {
  return findings.filter((f) => f.findingType !== "no_finding").reduce((sum, f) => sum + Number(f.amountUsd), 0);
}

// ─── Router ──────────────────────────────────────────────────────────────────
export const auditEngineRouter = router({
  getAuditTasks: protectedProcedure
    .input(z.object({
      status: z.enum(["pending","assigned","in_progress","findings_submitted","closed","appealed"]).optional(),
      assignedOfficerId: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const conditions: any[] = [];
      if (!AUDIT_ROLES.has(ctx.user.role)) conditions.push(eq(auditTasks.assignedOfficerId, String(ctx.user.id)));
      if (input.status) conditions.push(eq(auditTasks.status, input.status));
      if (input.assignedOfficerId) conditions.push(eq(auditTasks.assignedOfficerId, input.assignedOfficerId));
      const [tasks, countResult] = await Promise.all([
        db.select().from(auditTasks)
          .where(conditions.length > 0 ? and(...conditions) : undefined)
          .orderBy(desc(auditTasks.createdAt)).limit(input.limit).offset(input.offset),
        db.select({ count: sql<number>`count(*)` }).from(auditTasks)
          .where(conditions.length > 0 ? and(...conditions) : undefined),
      ]);
      const taskIds = tasks.map((t) => t.id);
      const findings = taskIds.length > 0
        ? await db.select().from(auditFindings).where(inArray(auditFindings.auditTaskId, taskIds))
        : [];
      const findingsByTask = findings.reduce((acc, f) => {
        if (!acc[f.auditTaskId]) acc[f.auditTaskId] = [];
        acc[f.auditTaskId].push(f);
        return acc;
      }, {} as Record<string, typeof findings>);
      return {
        total: Number(countResult[0]?.count ?? 0),
        tasks: tasks.map((t) => ({
          ...t, findings: findingsByTask[t.id] ?? [],
          declaredValueUsd: Number(t.declaredValueUsd), dutyPaidUsd: Number(t.dutyPaidUsd),
          riskScore: Number(t.riskScore), dutyDiscrepancyUsd: Number(t.dutyDiscrepancyUsd ?? 0),
        })),
      };
    }),

  getAuditTask: protectedProcedure
    .input(z.object({ auditId: z.string() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const [task] = await db.select().from(auditTasks).where(eq(auditTasks.id, input.auditId));
      if (!task) throw new Error(`Audit task ${input.auditId} not found`);
      if (!AUDIT_ROLES.has(ctx.user.role) && task.assignedOfficerId !== String(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const findings = await db.select().from(auditFindings).where(eq(auditFindings.auditTaskId, input.auditId));
      return { ...task, findings, declaredValueUsd: Number(task.declaredValueUsd),
        dutyPaidUsd: Number(task.dutyPaidUsd), riskScore: Number(task.riskScore),
        dutyDiscrepancyUsd: Number(task.dutyDiscrepancyUsd ?? 0) };
    }),

  createAuditTask: protectedProcedure
    .input(z.object({
      declarationId: z.string(), declarantName: z.string(), hsCode: z.string().optional(),
      declaredValueUsd: z.number(), dutyPaidUsd: z.number(),
      selectionReason: z.enum(["risk_score_high","random_sample","trader_tier_review","value_threshold","hs_chapter_sensitive","repeat_offender","post_green_lane"]),
      riskScore: z.number().min(0).max(100), dueAt: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const id = `audit-${crypto.randomBytes(6).toString("hex")}`;
      const dueAt = input.dueAt ? new Date(input.dueAt) : new Date(Date.now() + 14 * 24 * 3600_000);
      const [task] = await db.insert(auditTasks).values({
        id, declarationId: input.declarationId, declarantName: input.declarantName,
        hsCode: input.hsCode ?? null, declaredValueUsd: String(input.declaredValueUsd),
        dutyPaidUsd: String(input.dutyPaidUsd), selectionReason: input.selectionReason,
        riskScore: String(input.riskScore), status: "pending", dueAt,
      }).returning();
      return { ...task, findings: [] };
    }),

  assignAuditTask: protectedProcedure
    .input(z.object({ auditId: z.string(), officerId: z.string(), officerName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const [updated] = await db.update(auditTasks)
        .set({ assignedOfficerId: input.officerId, assignedOfficerName: input.officerName, status: "assigned" })
        .where(eq(auditTasks.id, input.auditId)).returning();
      if (!updated) throw new Error(`Audit task ${input.auditId} not found`);
      return updated;
    }),

  submitFindings: protectedProcedure
    .input(z.object({
      auditId: z.string(),
      findings: z.array(z.object({
        findingType: z.enum(["undervaluation","misclassification","origin_mismatch","quantity_discrepancy","prohibited_goods","documentation_fraud","duty_evasion","no_finding"]),
        description: z.string(), amountUsd: z.number().min(0).default(0), evidenceUrl: z.string().default(""),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      await db.delete(auditFindings).where(eq(auditFindings.auditTaskId, input.auditId));
      const newFindings = input.findings.map((f) => ({
        id: `finding-${crypto.randomBytes(4).toString("hex")}`,
        auditTaskId: input.auditId, findingType: f.findingType,
        description: f.description, amountUsd: String(f.amountUsd), evidenceUrl: f.evidenceUrl || null,
      }));
      if (newFindings.length > 0) await db.insert(auditFindings).values(newFindings);
      const discrepancy = calculateDutyDiscrepancy(newFindings);
      const [updated] = await db.update(auditTasks)
        .set({ status: "findings_submitted", dutyDiscrepancyUsd: String(discrepancy) })
        .where(eq(auditTasks.id, input.auditId)).returning();
      return { ...updated, findings: newFindings };
    }),

  closeAudit: protectedProcedure
    .input(z.object({ auditId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const [updated] = await db.update(auditTasks)
        .set({ status: "closed", closedAt: new Date() })
        .where(eq(auditTasks.id, input.auditId)).returning();
      if (!updated) throw new Error(`Audit task ${input.auditId} not found`);
      return updated;
    }),

  appealAudit: protectedProcedure
    .input(z.object({ auditId: z.string(), appealNotes: z.string() }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const [updated] = await db.update(auditTasks)
        .set({ status: "appealed", appealNotes: input.appealNotes })
        .where(eq(auditTasks.id, input.auditId)).returning();
      if (!updated) throw new Error(`Audit task ${input.auditId} not found`);
      return updated;
    }),

  getDutyDiscrepancyReport: protectedProcedure
    .input(z.object({ fromDate: z.string().optional(), toDate: z.string().optional() }))
    .query(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const conditions: any[] = [inArray(auditTasks.status, ["closed","findings_submitted"])];
      if (input.fromDate) conditions.push(gte(auditTasks.createdAt, new Date(input.fromDate)));
      if (input.toDate) conditions.push(lte(auditTasks.createdAt, new Date(input.toDate)));
      const tasks = await db.select().from(auditTasks).where(and(...conditions));
      const taskIds = tasks.map((t) => t.id);
      const findings = taskIds.length > 0
        ? await db.select().from(auditFindings).where(inArray(auditFindings.auditTaskId, taskIds)) : [];
      const totalDiscrepancy = tasks.reduce((s, t) => s + Number(t.dutyDiscrepancyUsd ?? 0), 0);
      const withFindingsTasks = tasks.filter((t) => Number(t.dutyDiscrepancyUsd ?? 0) > 0);
      const byFindingType: Record<string, number> = {};
      for (const f of findings) {
        if (f.findingType !== "no_finding") byFindingType[f.findingType] = (byFindingType[f.findingType] ?? 0) + Number(f.amountUsd);
      }
      return {
        totalAudited: tasks.length, withFindings: withFindingsTasks.length,
        totalDiscrepancyUsd: totalDiscrepancy,
        averageDiscrepancyUsd: withFindingsTasks.length > 0 ? totalDiscrepancy / withFindingsTasks.length : 0,
        byFindingType,
        topDiscrepancies: tasks.filter((t) => Number(t.dutyDiscrepancyUsd ?? 0) > 0)
          .sort((a, b) => Number(b.dutyDiscrepancyUsd) - Number(a.dutyDiscrepancyUsd)).slice(0, 10),
      };
    }),

  getAuditStats: protectedProcedure.query(async ({ ctx }) => {
    assertAuditOfficer(ctx.user.role);
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
    const tasks = await db.select().from(auditTasks);
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    let totalDiscrepancy = 0;
    let overdueTasks = 0;
    const now = new Date();
    for (const t of tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byReason[t.selectionReason] = (byReason[t.selectionReason] ?? 0) + 1;
      totalDiscrepancy += Number(t.dutyDiscrepancyUsd ?? 0);
      if (t.status !== "closed" && t.dueAt < now) overdueTasks++;
    }
    return { total: tasks.length, byStatus, byReason, totalDiscrepancyUsd: totalDiscrepancy, overdueTasks };
  }),

  runAuditSelection: protectedProcedure
    .input(z.object({
      declarations: z.array(z.object({
        declarationId: z.string(), declarantName: z.string(), hsCode: z.string(),
        declaredValueUsd: z.number(), dutyPaidUsd: z.number(), riskScore: z.number(),
        traderTier: z.enum(["new","standard","aeo"]), laneAssigned: z.enum(["GREEN","YELLOW","RED"]),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      assertAuditOfficer(ctx.user.role);
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Audit database unavailable" });
      const selected = [];
      for (const decl of input.declarations) {
        const seed = Math.random();
        const reason = selectForAudit({
          riskScore: decl.riskScore, declaredValueUsd: decl.declaredValueUsd,
          traderTier: decl.traderTier, hsChapter: decl.hsCode.slice(0, 2),
          laneAssigned: decl.laneAssigned, randomSeed: seed,
        });
        if (reason) {
          const id = `audit-${crypto.randomBytes(4).toString("hex")}`;
          const [task] = await db.insert(auditTasks).values({
            id, declarationId: decl.declarationId, declarantName: decl.declarantName,
            hsCode: decl.hsCode, declaredValueUsd: String(decl.declaredValueUsd),
            dutyPaidUsd: String(decl.dutyPaidUsd), selectionReason: reason,
            riskScore: String(decl.riskScore), status: "pending",
            dueAt: new Date(Date.now() + 7 * 86400_000),
          }).returning();
          selected.push(task);
        }
      }
      return { selected: selected.length, tasks: selected };
    }),
});
