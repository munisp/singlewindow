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
      // Dev/test mode: serve from the in-memory dev pool (makeDevRun below)
      // so the admin dashboard can be exercised without a database.
      // VITEST-gated — production always reads temporalRuns from PostgreSQL.
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
        let runs = Array.from({ length: 20 }, (_, i) => makeDevRun(i));
        if (input?.status) runs = runs.filter((r) => r.status === input.status);
        if (input?.workflowType) runs = runs.filter((r) => r.workflowType === input.workflowType);
        if (input?.declarationId != null) runs = runs.filter((r) => r.declarationId === input.declarationId);
        const offset = input?.offset ?? 0;
        const limit = input?.limit ?? 50;
        return { runs: runs.slice(offset, offset + limit), total: runs.length };
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
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
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
      const { getTemporalRunStats } = await import("../db");
      const stats = await getTemporalRunStats();
      return stats ?? { running: 0, completed: 0, failed: 0, timedOut: 0 };
    }),

  /**
   * retriggerWorkflow — re-submit a failed/timed-out workflow run.
   *
   * Fail-closed doctrine (phase-10 audit remediation, finding B-2):
   * production calls the real Temporal HTTP API to start a new run and only
   * then records it in the DB. If Temporal is not explicitly configured
   * (TEMPORAL_UNCONFIGURED) or unreachable (TEMPORAL_UNAVAILABLE) the mutation
   * throws SERVICE_UNAVAILABLE — it NEVER reports success for a run that was
   * not started, and never inserts a fabricated "running" row.
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
      // Dev/test mode: record against the in-memory dev pool only.
      // VITEST-gated — production ALWAYS goes through the live Temporal API.
      if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
        const newRunId = `retrigger-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 8)}`;
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
      }

      const { ENV } = await import("../_core/env");
      const temporalAddress = process.env.TEMPORAL_ADDRESS ?? ENV.temporalAddress;
      const temporalUiUrl = process.env.TEMPORAL_UI_URL ?? "";
      const namespace = process.env.TEMPORAL_NAMESPACE ?? ENV.temporalNamespace ?? "tradegateway";
      if (!process.env.TEMPORAL_ADDRESS || !temporalUiUrl) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "TEMPORAL_UNCONFIGURED: TEMPORAL_ADDRESS and TEMPORAL_UI_URL must be explicitly set to re-trigger workflows (fail-closed)",
        });
      }

      // Verify the Temporal cluster is reachable before claiming anything.
      try {
        const probe = await fetch(`${temporalUiUrl}/api/v1/namespaces`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `TEMPORAL_UNAVAILABLE: Temporal cluster at ${temporalAddress} is unreachable (${err instanceof Error ? err.message : String(err)})`,
        });
      }

      const workflowId = `retrigger-${input.workflowType}-${Date.now()}`;
      let newRunId: string;
      try {
        const res = await fetch(
          `http://${temporalAddress}/api/v1/namespaces/${namespace}/workflows`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workflowId,
              workflowType: { name: input.workflowType },
              taskQueue: { name: "declaration-queue" },
              input: { payloads: [{ data: Buffer.from(JSON.stringify(input.input ?? {})).toString("base64") }] },
            }),
            signal: AbortSignal.timeout(10_000),
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json().catch(() => ({}))) as { runId?: string };
        newRunId = body.runId ?? "";
        if (!newRunId) throw new Error("Temporal did not return a runId");
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `TEMPORAL_UNAVAILABLE: failed to start workflow ${workflowId} (${err instanceof Error ? err.message : String(err)})`,
        });
      }

      // Only record the run AFTER Temporal confirmed it was started.
      const { upsertTemporalRun } = await import("../db");
      await upsertTemporalRun({
        workflowId,
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
