/**
 * Audit Engine Router — Sprint 55: Post-Clearance Audit Engine
 * Manages audit task selection, assignment, findings submission,
 * and duty discrepancy reporting for post-clearance compliance.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import crypto from "crypto";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditSelectionReason =
  | "risk_score_high"
  | "random_sample"
  | "trader_tier_review"
  | "value_threshold"
  | "hs_chapter_sensitive"
  | "repeat_offender"
  | "post_green_lane";

export type AuditStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "findings_submitted"
  | "closed"
  | "appealed";

export type FindingType =
  | "undervaluation"
  | "misclassification"
  | "origin_mismatch"
  | "quantity_discrepancy"
  | "prohibited_goods"
  | "documentation_fraud"
  | "duty_evasion"
  | "no_finding";

// ─── In-memory stores ────────────────────────────────────────────────────────

interface AuditTask {
  id: string;
  declarationId: string;
  declarantName: string;
  hsCode: string;
  declaredValueUsd: number;
  dutyPaidUsd: number;
  selectionReason: AuditSelectionReason;
  riskScore: number;
  status: AuditStatus;
  assignedOfficerId: string | null;
  assignedOfficerName: string | null;
  dueAt: string;
  createdAt: string;
  closedAt: string | null;
  findings: AuditFinding[];
  dutyDiscrepancyUsd: number;
  appealNotes: string;
}

interface AuditFinding {
  id: string;
  auditTaskId: string;
  findingType: FindingType;
  description: string;
  amountUsd: number;
  evidenceUrl: string;
  createdAt: string;
}

const _tasks: AuditTask[] = [];
let _seeded = false;

// ─── Audit selection logic ───────────────────────────────────────────────────

/**
 * Determines whether a declaration should be selected for post-clearance audit.
 * Returns the selection reason or null if not selected.
 */
export function selectForAudit(params: {
  riskScore: number;
  declaredValueUsd: number;
  traderTier: "new" | "standard" | "aeo";
  hsChapter: string;
  laneAssigned: "GREEN" | "YELLOW" | "RED";
  randomSeed: number; // 0-1 for deterministic testing
}): AuditSelectionReason | null {
  const SENSITIVE_CHAPTERS = new Set(["24", "27", "36", "71", "87", "88", "93"]);

  // High risk score always triggers audit
  if (params.riskScore >= 70) return "risk_score_high";

  // High-value shipments
  if (params.declaredValueUsd >= 500_000) return "value_threshold";

  // Sensitive HS chapters
  if (SENSITIVE_CHAPTERS.has(params.hsChapter)) return "hs_chapter_sensitive";

  // New traders get more scrutiny
  if (params.traderTier === "new" && params.riskScore >= 40) return "trader_tier_review";

  // Green-lane declarations get a small random audit rate (5%)
  if (params.laneAssigned === "GREEN" && params.randomSeed < 0.05) return "post_green_lane";

  // General random sample (10% of all closed declarations)
  if (params.randomSeed < 0.10) return "random_sample";

  return null;
}

/**
 * Calculates duty discrepancy from a list of findings.
 */
export function calculateDutyDiscrepancy(findings: AuditFinding[]): number {
  return findings
    .filter((f) => f.findingType !== "no_finding")
    .reduce((sum, f) => sum + f.amountUsd, 0);
}

// ─── Seed demo data ──────────────────────────────────────────────────────────

function seedDemoData() {
  if (_seeded) return;
  _seeded = true;

  const now = Date.now();
  const reasons: AuditSelectionReason[] = [
    "risk_score_high", "random_sample", "trader_tier_review",
    "value_threshold", "hs_chapter_sensitive", "post_green_lane",
  ];
  const statuses: AuditStatus[] = [
    "pending", "assigned", "in_progress", "findings_submitted", "closed",
  ];
  const officers = [
    { id: "off-001", name: "Inspector Kwame Asante" },
    { id: "off-002", name: "Inspector Amara Diallo" },
    { id: "off-003", name: "Inspector Fatima Nkosi" },
  ];

  for (let i = 0; i < 30; i++) {
    const status = statuses[i % statuses.length];
    const officer = i % 3 === 0 ? null : officers[i % officers.length];
    const dueAt = new Date(now + (7 - (i % 14)) * 86400_000).toISOString();
    const createdAt = new Date(now - i * 3600_000 * 8).toISOString();
    const findings: AuditFinding[] = [];

    if (status === "findings_submitted" || status === "closed") {
      const findingTypes: FindingType[] = ["undervaluation", "misclassification", "no_finding"];
      const ft = findingTypes[i % findingTypes.length];
      findings.push({
        id: `finding-${i + 1}`,
        auditTaskId: `audit-${String(i + 1).padStart(3, "0")}`,
        findingType: ft,
        description: ft === "no_finding" ? "No discrepancies found." : `Discrepancy detected: ${ft}`,
        amountUsd: ft === "no_finding" ? 0 : (i + 1) * 1250,
        evidenceUrl: "",
        createdAt,
      });
    }

    _tasks.push({
      id: `audit-${String(i + 1).padStart(3, "0")}`,
      declarationId: `DECL-${10000 + i}`,
      declarantName: `Trader Corp ${i + 1}`,
      hsCode: `${(6200 + i * 100).toString().slice(0, 4)}00`,
      declaredValueUsd: 5000 + i * 3000,
      dutyPaidUsd: (5000 + i * 3000) * 0.05,
      selectionReason: reasons[i % reasons.length],
      riskScore: 20 + (i * 3) % 80,
      status,
      assignedOfficerId: officer?.id ?? null,
      assignedOfficerName: officer?.name ?? null,
      dueAt,
      createdAt,
      closedAt: status === "closed" ? new Date(now - i * 3600_000).toISOString() : null,
      findings,
      dutyDiscrepancyUsd: calculateDutyDiscrepancy(findings),
      appealNotes: "",
    });
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const auditEngineRouter = router({
  getAuditTasks: publicProcedure
    .input(
      z.object({
        status: z.enum(["pending", "assigned", "in_progress", "findings_submitted", "closed", "appealed"]).optional(),
        assignedOfficerId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(({ input }) => {
      seedDemoData();
      let results = [..._tasks];
      if (input.status) results = results.filter((t) => t.status === input.status);
      if (input.assignedOfficerId) results = results.filter((t) => t.assignedOfficerId === input.assignedOfficerId);
      results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { total: results.length, tasks: results.slice(input.offset, input.offset + input.limit) };
    }),

  getAuditTask: publicProcedure
    .input(z.object({ auditId: z.string() }))
    .query(({ input }) => {
      seedDemoData();
      const task = _tasks.find((t) => t.id === input.auditId);
      if (!task) throw new Error(`Audit task ${input.auditId} not found`);
      return task;
    }),

  assignAuditTask: publicProcedure
    .input(
      z.object({
        auditId: z.string(),
        officerId: z.string(),
        officerName: z.string(),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const task = _tasks.find((t) => t.id === input.auditId);
      if (!task) throw new Error(`Audit task ${input.auditId} not found`);
      task.assignedOfficerId = input.officerId;
      task.assignedOfficerName = input.officerName;
      task.status = "assigned";
      return task;
    }),

  submitFindings: publicProcedure
    .input(
      z.object({
        auditId: z.string(),
        findings: z.array(
          z.object({
            findingType: z.enum([
              "undervaluation", "misclassification", "origin_mismatch",
              "quantity_discrepancy", "prohibited_goods", "documentation_fraud",
              "duty_evasion", "no_finding",
            ]),
            description: z.string(),
            amountUsd: z.number().min(0).default(0),
            evidenceUrl: z.string().default(""),
          })
        ),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const task = _tasks.find((t) => t.id === input.auditId);
      if (!task) throw new Error(`Audit task ${input.auditId} not found`);
      const now = new Date().toISOString();
      task.findings = input.findings.map((f, i) => ({
        id: `finding-${crypto.randomBytes(4).toString("hex")}`,
        auditTaskId: task.id,
        findingType: f.findingType,
        description: f.description,
        amountUsd: f.amountUsd,
        evidenceUrl: f.evidenceUrl,
        createdAt: now,
      }));
      task.dutyDiscrepancyUsd = calculateDutyDiscrepancy(task.findings);
      task.status = "findings_submitted";
      return task;
    }),

  closeAudit: publicProcedure
    .input(z.object({ auditId: z.string() }))
    .mutation(({ input }) => {
      seedDemoData();
      const task = _tasks.find((t) => t.id === input.auditId);
      if (!task) throw new Error(`Audit task ${input.auditId} not found`);
      task.status = "closed";
      task.closedAt = new Date().toISOString();
      return task;
    }),

  getDutyDiscrepancyReport: publicProcedure
    .input(
      z.object({
        fromDate: z.string().optional(),
        toDate: z.string().optional(),
      })
    )
    .query(({ input }) => {
      seedDemoData();
      let closed = _tasks.filter((t) => t.status === "closed" || t.status === "findings_submitted");
      if (input.fromDate) closed = closed.filter((t) => t.createdAt >= input.fromDate!);
      if (input.toDate) closed = closed.filter((t) => t.createdAt <= input.toDate!);

      const totalDiscrepancy = closed.reduce((s, t) => s + t.dutyDiscrepancyUsd, 0);
      const withFindings = closed.filter((t) => t.dutyDiscrepancyUsd > 0);
      const byFindingType: Record<string, number> = {};
      for (const task of closed) {
        for (const f of task.findings) {
          if (f.findingType !== "no_finding") {
            byFindingType[f.findingType] = (byFindingType[f.findingType] ?? 0) + f.amountUsd;
          }
        }
      }
      return {
        totalAudited: closed.length,
        withFindings: withFindings.length,
        totalDiscrepancyUsd: totalDiscrepancy,
        averageDiscrepancyUsd: withFindings.length > 0 ? totalDiscrepancy / withFindings.length : 0,
        byFindingType,
        topDiscrepancies: closed
          .filter((t) => t.dutyDiscrepancyUsd > 0)
          .sort((a, b) => b.dutyDiscrepancyUsd - a.dutyDiscrepancyUsd)
          .slice(0, 10),
      };
    }),

  getAuditStats: publicProcedure.query(() => {
    seedDemoData();
    const byStatus: Record<string, number> = {};
    const byReason: Record<string, number> = {};
    for (const t of _tasks) {
      byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      byReason[t.selectionReason] = (byReason[t.selectionReason] ?? 0) + 1;
    }
    return {
      total: _tasks.length,
      byStatus,
      byReason,
      totalDiscrepancyUsd: _tasks.reduce((s, t) => s + t.dutyDiscrepancyUsd, 0),
      overdueTasks: _tasks.filter(
        (t) => t.status !== "closed" && t.dueAt < new Date().toISOString()
      ).length,
    };
  }),

  // Simulate the daily audit selection job
  runAuditSelection: publicProcedure
    .input(
      z.object({
        declarations: z.array(
          z.object({
            declarationId: z.string(),
            declarantName: z.string(),
            hsCode: z.string(),
            declaredValueUsd: z.number(),
            dutyPaidUsd: z.number(),
            riskScore: z.number(),
            traderTier: z.enum(["new", "standard", "aeo"]),
            laneAssigned: z.enum(["GREEN", "YELLOW", "RED"]),
          })
        ),
      })
    )
    .mutation(({ input }) => {
      seedDemoData();
      const selected: AuditTask[] = [];
      for (const decl of input.declarations) {
        const seed = Math.random();
        const reason = selectForAudit({
          riskScore: decl.riskScore,
          declaredValueUsd: decl.declaredValueUsd,
          traderTier: decl.traderTier,
          hsChapter: decl.hsCode.slice(0, 2),
          laneAssigned: decl.laneAssigned,
          randomSeed: seed,
        });
        if (reason) {
          const task: AuditTask = {
            id: `audit-${crypto.randomBytes(4).toString("hex")}`,
            declarationId: decl.declarationId,
            declarantName: decl.declarantName,
            hsCode: decl.hsCode,
            declaredValueUsd: decl.declaredValueUsd,
            dutyPaidUsd: decl.dutyPaidUsd,
            selectionReason: reason,
            riskScore: decl.riskScore,
            status: "pending",
            assignedOfficerId: null,
            assignedOfficerName: null,
            dueAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
            createdAt: new Date().toISOString(),
            closedAt: null,
            findings: [],
            dutyDiscrepancyUsd: 0,
            appealNotes: "",
          };
          _tasks.push(task);
          selected.push(task);
        }
      }
      return { selected: selected.length, tasks: selected };
    }),
});
