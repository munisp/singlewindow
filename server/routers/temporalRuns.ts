/**
 * Temporal Workflow Runs tRPC Router — Sprint v81
 * Admin procedures for monitoring, querying, and re-triggering Temporal workflows.
 */
import { z } from "zod";
import { router, adminProcedure, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const WORKFLOW_TYPES = [
  "DeclarationClearance",
  "OGAPermitApproval",
  "PaymentProcessing",
  "RiskAssessment",
  "KYCVerification",
  "AEOApplication",
  "BondedWarehouseRelease",
  "PostClearanceAudit",
  "SanctionsScreening",
  "DocumentVerification",
];

const TASK_QUEUES = [
  "declaration-queue",
  "payment-queue",
  "kyc-queue",
  "risk-queue",
  "oga-queue",
  "audit-queue",
];

const STATUSES = ["running", "completed", "failed", "cancelled", "timed_out"] as const;

function makeDevRun(i: number, overrides?: Partial<Record<string, unknown>>) {
  const status = STATUSES[i % STATUSES.length];
  const started = new Date(Date.now() - (i + 1) * 3_600_000);
  const closed = status !== "running" ? new Date(started.getTime() + Math.random() * 3_600_000) : null;
  return {
    id: i + 1,
    workflowId: `wf-${WORKFLOW_TYPES[i % WORKFLOW_TYPES.length].toLowerCase()}-${1000 + i}`,
    runId: `run-${(1000 + i).toString(16).padStart(8, "0")}-${Date.now().toString(16)}`,
    workflowType: WORKFLOW_TYPES[i % WORKFLOW_TYPES.length],
    taskQueue: TASK_QUEUES[i % TASK_QUEUES.length],
    status,
    declarationId: i % 3 === 0 ? 1000 + i : null,
    input: { declarationId: 1000 + i, traderName: `Trader ${i}` },
    result: status === "completed" ? { cleared: true, lane: "green" } : null,
    errorMessage: status === "failed" ? "Downstream service timeout" : null,
    startedAt: started,
    closedAt: closed,
    durationMs: closed ? Math.round((closed.getTime() - started.getTime())) : null,
    createdAt: started,
    ...overrides,
  };
}

export const temporalRunsRouter = router({
  /**
   * getWorkflowRuns — paginated list of Temporal workflow runs.
   */
  getWorkflowRuns: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(500).default(50),
        offset: z.number().int().min(0).default(0),
        status: z.enum(STATUSES).optional(),
        workflowType: z.string().optional(),
        declarationId: z.number().int().positive().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        const rows = Array.from({ length: 60 }, (_, i) => makeDevRun(i));
        const filtered = rows.filter((r) => {
          if (input?.status && r.status !== input.status) return false;
          if (input?.workflowType && r.workflowType !== input.workflowType) return false;
          if (input?.declarationId && r.declarationId !== input.declarationId) return false;
          return true;
        });
        return {
          runs: filtered.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 50)),
          total: filtered.length,
        };
      }
      const { getTemporalRuns } = await import("../db");
      const runs = await getTemporalRuns({
        limit: input?.limit,
        offset: input?.offset,
        status: input?.status,
        workflowType: input?.workflowType,
        declarationId: input?.declarationId,
      });
      return { runs, total: runs.length };
    }),

  /**
   * getWorkflowRunById — fetch a single run by its DB id.
   */
  getWorkflowRunById: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      if (process.env.NODE_ENV !== "production") {
        return makeDevRun(input.id - 1);
      }
      const { getTemporalRunById } = await import("../db");
      const run = await getTemporalRunById(input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: `Workflow run ${input.id} not found` });
      return run;
    }),

  /**
   * getWorkflowStats — summary counts by status.
   */
  getWorkflowStats: adminProcedure
    .query(async () => {
      if (process.env.NODE_ENV !== "production") {
        return { running: 4, completed: 312, failed: 7, timedOut: 2 };
      }
      const { getTemporalRunStats } = await import("../db");
      const stats = await getTemporalRunStats();
      return stats ?? { running: 0, completed: 0, failed: 0, timedOut: 0 };
    }),

  /**
   * retriggerWorkflow — re-submit a failed/timed-out workflow run.
   * In production this would call the Temporal client SDK.
   */
  retriggerWorkflow: adminProcedure
    .input(
      z.object({
        runId: z.string().min(1),
        workflowType: z.string().min(1),
        input: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input }) => {
      // In production: call Temporal client to start a new workflow run
      // For now, record the re-trigger in the DB and return a stub run ID
      const newRunId = `retrigger-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
      if (process.env.NODE_ENV !== "production") {
        return { success: true, newRunId, message: `Re-triggered ${input.workflowType} (dev stub)` };
      }
      const { upsertTemporalRun } = await import("../db");
      await upsertTemporalRun({
        workflowId: `retrigger-${input.workflowType}-${Date.now()}`,
        runId: newRunId,
        workflowType: input.workflowType,
        taskQueue: "declaration-queue",
        status: "running",
        input: input.input ?? {},
        startedAt: new Date(),
        createdAt: new Date(),
      });
      return { success: true, newRunId, message: `Re-triggered ${input.workflowType}` };
    }),

  /**
   * getWorkflowTypes — list of distinct workflow types for filter dropdowns.
   */
  getWorkflowTypes: adminProcedure
    .query(async () => {
      return WORKFLOW_TYPES;
    }),

  /**
   * v94: Get the input payload history for a specific workflow type (last N runs).
   */
  getWorkflowInputHistory: protectedProcedure
    .input(z.object({
      workflowType: z.string().min(1),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const { temporalWorkflowRuns } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");
      const rows = await db.select({
        id: temporalWorkflowRuns.id,
        workflowId: temporalWorkflowRuns.workflowId,
        input: temporalWorkflowRuns.input,
        startedAt: temporalWorkflowRuns.startedAt,
        status: temporalWorkflowRuns.status,
      })
        .from(temporalWorkflowRuns)
        .where(eq(temporalWorkflowRuns.workflowType, input.workflowType))
        .orderBy(desc(temporalWorkflowRuns.startedAt))
        .limit(input.limit);
      return rows;
    }),
});
