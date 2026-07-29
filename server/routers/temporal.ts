/**
 * temporal.ts — tRPC router for Temporal workflow orchestration
 *
 * Provides visibility into Temporal workflows for:
 *   - Declaration clearance workflows (multi-agency coordination)
 *   - Payment processing workflows
 *   - KYC verification workflows
 *   - AEO audit workflows
 *
 * Procedures:
 *   temporal.getWorkflow        — Get workflow execution details
 *   temporal.listWorkflows      — List workflows for a declaration
 *   temporal.getWorkflowHistory — Get full event history for a workflow
 *   temporal.triggerWorkflow    — Trigger a new workflow execution
 *   temporal.signalWorkflow     — Send a signal to a running workflow
 *   temporal.getSystemStatus    — Get Temporal cluster health
 *
 * Integration strategy:
 *   1. Always try the live Temporal API first (via HTTP to temporal-ui or temporal-server)
 *   2. On success, persist the result to the temporalWorkflows DB table for audit trail
 *   3. On Temporal unavailability, fall back to the DB-persisted state
 *   4. If neither is available, throw a proper error (no mock data)
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { temporalWorkflows } from "../../drizzle/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";

// R3 FIX: Use ENV for all Temporal config to ensure namespace consistency across the codebase.
const TEMPORAL_URL = ENV.temporalAddress ?? process.env.TEMPORAL_URL ?? "http://localhost:7233";
const TEMPORAL_UI_URL = process.env.TEMPORAL_UI_URL ?? "http://localhost:8088";
const TEMPORAL_NAMESPACE = ENV.temporalNamespace ?? process.env.TEMPORAL_NAMESPACE ?? "tradegateway";

// ─── Temporal service client ───────────────────────────────────────────────

async function temporalAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TEMPORAL_UI_URL}/api/v1/namespaces`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Workflow type definitions ─────────────────────────────────────────────

const WORKFLOW_TYPES = {
  DECLARATION_CLEARANCE: "DeclarationClearanceWorkflow",
  PAYMENT_PROCESSING: "PaymentProcessingWorkflow",
  KYC_VERIFICATION: "KYCVerificationWorkflow",
  AEO_AUDIT: "AEOAuditWorkflow",
  RISK_ASSESSMENT: "RiskAssessmentWorkflow",
  MULTI_AGENCY_APPROVAL: "MultiAgencyApprovalWorkflow",
  POST_CLEARANCE_AUDIT: "PostClearanceAuditWorkflow",
} as const;

// ─── DB-backed workflow persistence helpers ────────────────────────────────────

interface WorkflowRecord {
  workflowId: string;
  runId?: string;
  workflowType?: string;
  declarationId?: number | null;
  status?: string;
  startedAt?: string;
  completedAt?: string | null;
  currentStep?: string | null;
  activities?: unknown[];
  memo?: Record<string, unknown>;
}

async function saveWorkflowToDb(wf: WorkflowRecord) {
  const db = await getDb();
  if (!db) return;
  try {
    const row = {
      workflowId: wf.workflowId,
      runId: wf.runId ?? null,
      workflowType: wf.workflowType ?? "DeclarationClearanceWorkflow",
      declarationId: typeof wf.declarationId === "number" ? wf.declarationId : null,
      status: (wf.status ?? "RUNNING") as any,
      startTime: wf.startedAt ? new Date(wf.startedAt) : new Date(),
      closeTime: wf.completedAt ? new Date(wf.completedAt) : null,
      currentStep: wf.currentStep ?? null,
      steps: (wf.activities ?? []) as any,
      metadata: (wf.memo ?? {}) as any,
    };
    await db.insert(temporalWorkflows).values(row)
      .onConflictDoUpdate({
        target: temporalWorkflows.workflowId,
        set: {
          status: row.status,
          closeTime: row.closeTime,
          currentStep: row.currentStep,
          steps: row.steps,
          updatedAt: new Date(),
        },
      });
  } catch (e) {
    console.warn("[temporal] DB save failed:", e);
  }
}

async function getWorkflowFromDb(workflowId: string) {
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db.select().from(temporalWorkflows)
      .where(eq(temporalWorkflows.workflowId, workflowId));
    return row ?? null;
  } catch {
    return null;
  }
}

async function getWorkflowsFromDb(declarationId?: number, status?: string, limit = 10) {
  const db = await getDb();
  if (!db) return [];
  try {
    const conditions = [];
    if (declarationId) conditions.push(eq(temporalWorkflows.declarationId, declarationId));
    if (status && status !== "ALL") conditions.push(eq(temporalWorkflows.status, status as any));
    const query = db.select().from(temporalWorkflows)
      .orderBy(desc(temporalWorkflows.startTime))
      .limit(limit);
    if (conditions.length > 0) {
      return await query.where(and(...conditions));
    }
    return await query;
  } catch {
    return [];
  }
}

// ─── Temporal API response normalizer ─────────────────────────────────────────

function normalizeTemporalWorkflow(data: Record<string, unknown>) {
  const execution = (data.workflowExecutionInfo ?? data) as Record<string, unknown>;
  const execInfo = (execution.execution ?? execution) as Record<string, unknown>;
  return {
    workflowId: (execInfo.workflowId ?? (execution as any).workflowId ?? "") as string,
    runId: (execInfo.runId ?? (execution as any).runId ?? "") as string,
    workflowType: ((execution.type as any)?.name ?? (execution as any).workflowType ?? "Unknown") as string,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: ((execution.taskQueue as any)?.name ?? (execution as any).taskQueue ?? "customs-clearance") as string,
    status: ((execution.status ?? (execution as any).status) ?? "RUNNING") as string,
    startedAt: ((execution.startTime ?? (execution as any).startedAt) ?? new Date().toISOString()) as string,
    completedAt: ((execution.closeTime ?? (execution as any).completedAt) ?? null) as string | null,
    declarationId: null as number | null,
    historyLength: ((execution.historyLength ?? (execution as any).historyLength) ?? 0) as number,
    memo: ((execution.memo ?? (execution as any).memo) ?? {}) as Record<string, unknown>,
    isMock: false,
  };
}

// ─── Router ───────────────────────────────────────────────────────────────

export const temporalRouter = router({
  /**
   * Get the Temporal cluster health and namespace status.
   */
  getSystemStatus: protectedProcedure.query(async () => {
    const available = await temporalAvailable();

    let activeWorkflows = 0;
    let completedWorkflows = 0;

    if (available) {
      try {
        const res = await fetch(
          `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows?query=ExecutionStatus%3D"Running"&pageSize=1`,
          { signal: AbortSignal.timeout(5_000) }
        );
        if (res.ok) {
          const data = await res.json() as { executions?: unknown[] };
          activeWorkflows = data.executions?.length ?? 0;
        }
      } catch {
        // Non-fatal — stats are informational
      }
    } else {
      // Fall back to DB counts
      const db = await getDb();
      if (db) {
        try {
          const [activeRow] = await db.select({ count: sql<number>`count(*)::int` })
            .from(temporalWorkflows)
            .where(eq(temporalWorkflows.status, "RUNNING"));
          const [completedRow] = await db.select({ count: sql<number>`count(*)::int` })
            .from(temporalWorkflows)
            .where(eq(temporalWorkflows.status, "COMPLETED"));
          activeWorkflows = activeRow?.count ?? 0;
          completedWorkflows = completedRow?.count ?? 0;
        } catch {
          // Non-fatal
        }
      }
    }

    return {
      connected: available,
      mode: available ? "LIVE" : "DB_FALLBACK",
      temporalUrl: TEMPORAL_URL,
      uiUrl: TEMPORAL_UI_URL,
      namespace: TEMPORAL_NAMESPACE,
      workflowTypes: Object.values(WORKFLOW_TYPES),
      taskQueues: [
        "customs-clearance",
        "payment-processing",
        "kyc-verification",
        "aeo-audit",
        "risk-assessment",
      ],
      stats: {
        activeWorkflows,
        completedWorkflows,
      },
    };
  }),

  /**
   * Get workflow execution details by workflowId.
   * Tries live Temporal API first, then falls back to DB-persisted state.
   */
  getWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      // Try live Temporal API first
      const available = await temporalAvailable();
      if (available) {
        try {
          const res = await fetch(
            `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${encodeURIComponent(input.workflowId)}`,
            { signal: AbortSignal.timeout(5_000) }
          );
          if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            const normalized = normalizeTemporalWorkflow(data);
            // Persist to DB for audit trail
            await saveWorkflowToDb(normalized);
            return normalized;
          }
        } catch (e) {
          console.warn(`[temporal] Live API failed for getWorkflow: ${e}`);
        }
      }

      // Fall back to DB-persisted state
      const dbWorkflow = await getWorkflowFromDb(input.workflowId);
      if (dbWorkflow) return dbWorkflow;

      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Workflow ${input.workflowId} not found. Temporal may be unavailable and no DB record exists.`,
      });
    }),

  /**
   * List workflows associated with a declaration.
   * Tries live Temporal API first, then falls back to DB-persisted state.
   */
  listWorkflows: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive().optional(),
      status: z.enum(["RUNNING", "COMPLETED", "FAILED", "ALL"]).default("ALL"),
      limit: z.number().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const available = await temporalAvailable();

      if (available) {
        try {
          const queryParts: string[] = [];
          if (input.declarationId) queryParts.push(`declarationId="${input.declarationId}"`);
          if (input.status !== "ALL") queryParts.push(`ExecutionStatus="${input.status}"`);
          const query = queryParts.join(" AND ");
          const res = await fetch(
            `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows?query=${encodeURIComponent(query)}&pageSize=${input.limit}`,
            { signal: AbortSignal.timeout(5_000) }
          );
          if (res.ok) {
            const data = await res.json() as { executions?: Record<string, unknown>[]; nextPageToken?: string };
            const workflows = (data.executions ?? []).map(normalizeTemporalWorkflow);
            // Persist each to DB
            await Promise.allSettled(workflows.map(wf => saveWorkflowToDb(wf)));
            return {
              workflows,
              total: workflows.length,
              nextPageToken: data.nextPageToken ?? null,
              source: "temporal",
            };
          }
        } catch (e) {
          console.warn(`[temporal] Live API failed for listWorkflows: ${e}`);
        }
      }

      // Fall back to DB
      const dbWorkflows = await getWorkflowsFromDb(input.declarationId, input.status, input.limit);
      return {
        workflows: dbWorkflows,
        total: dbWorkflows.length,
        nextPageToken: null,
        source: "db_fallback",
      };
    }),

  /**
   * Get the full event history for a workflow execution.
   * Tries live Temporal API first, then reconstructs from DB steps.
   */
  getWorkflowHistory: protectedProcedure
    .input(z.object({
      workflowId: z.string(),
      runId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const available = await temporalAvailable();

      if (available) {
        try {
          const runParam = input.runId ? `?runId=${encodeURIComponent(input.runId)}` : "";
          const res = await fetch(
            `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${encodeURIComponent(input.workflowId)}/history${runParam}`,
            { signal: AbortSignal.timeout(10_000) }
          );
          if (res.ok) {
            return res.json();
          }
        } catch (e) {
          console.warn(`[temporal] Live API failed for getWorkflowHistory: ${e}`);
        }
      }

      // Fall back to DB-reconstructed history
      const dbRow = await getWorkflowFromDb(input.workflowId);
      if (!dbRow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workflow ${input.workflowId} not found in Temporal or database.`,
        });
      }

      // Reconstruct event history from persisted steps
      const events: Array<Record<string, unknown>> = [];
      let eventId = 1;
      const wfStartedAt = dbRow.startTime?.toISOString() ?? new Date().toISOString();

      events.push({
        eventId: eventId++,
        eventType: "WorkflowExecutionStarted",
        timestamp: wfStartedAt,
        attributes: {
          workflowType: dbRow.workflowType,
          taskQueue: "customs-clearance",
          input: dbRow.metadata ?? {},
        },
      });

      const steps = Array.isArray(dbRow.steps) ? dbRow.steps as Array<Record<string, unknown>> : [];
      for (const step of steps) {
        if (step.status === "PENDING") continue;
        events.push({
          eventId: eventId++,
          eventType: "ActivityTaskScheduled",
          timestamp: step.startedAt ?? wfStartedAt,
          attributes: { activityType: step.name, activityId: step.id },
        });
        if (step.startedAt) {
          events.push({
            eventId: eventId++,
            eventType: "ActivityTaskStarted",
            timestamp: step.startedAt,
            attributes: { activityId: step.id, attempt: step.attempt ?? 1 },
          });
        }
        if (step.completedAt) {
          events.push({
            eventId: eventId++,
            eventType: "ActivityTaskCompleted",
            timestamp: step.completedAt,
            attributes: { activityId: step.id, result: step.result },
          });
        }
      }

      if (dbRow.status === "COMPLETED" && dbRow.closeTime) {
        events.push({
          eventId: eventId++,
          eventType: "WorkflowExecutionCompleted",
          timestamp: dbRow.closeTime.toISOString(),
          attributes: { result: { status: "CLEARED" } },
        });
      } else if (dbRow.status === "FAILED") {
        events.push({
          eventId: eventId++,
          eventType: "WorkflowExecutionFailed",
          timestamp: dbRow.closeTime?.toISOString() ?? new Date().toISOString(),
          attributes: { failure: { message: "Workflow failed" } },
        });
      }

      return {
        workflowId: input.workflowId,
        events,
        totalCount: events.length,
        source: "db_fallback",
      };
    }),

  /**
   * Trigger a new workflow execution for a declaration.
   * Uses the Temporal REST API to start the workflow on the cluster.
   * Falls back to DB-only persistence if Temporal is unavailable.
   */
  triggerWorkflow: protectedProcedure
    .input(z.object({
      workflowType: z.enum([
        "DeclarationClearanceWorkflow",
        "PaymentProcessingWorkflow",
        "KYCVerificationWorkflow",
        "RiskAssessmentWorkflow",
      ]),
      declarationId: z.number().int().positive().optional(),
      input: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const workflowId = `${input.workflowType.replace("Workflow", "")}-${input.declarationId ?? "manual"}-${Date.now()}`;
      const available = await temporalAvailable();

      if (available) {
        try {
          const res = await fetch(
            `${TEMPORAL_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workflowId,
                workflowType: { name: input.workflowType },
                taskQueue: { name: "customs-clearance" },
                input: { payloads: [{ data: Buffer.from(JSON.stringify(input.input ?? {})).toString("base64") }] },
                memo: {
                  fields: {
                    declarationId: { data: Buffer.from(String(input.declarationId ?? "")).toString("base64") },
                    triggeredBy: { data: Buffer.from(String(ctx.user.id)).toString("base64") },
                  },
                },
              }),
              signal: AbortSignal.timeout(10_000),
            }
          );

          if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            const runId = (data.runId ?? data.run_id ?? "") as string;
            // Persist to DB
            await saveWorkflowToDb({
              workflowId,
              runId,
              workflowType: input.workflowType,
              declarationId: input.declarationId,
              status: "RUNNING",
              startedAt: new Date().toISOString(),
              memo: { triggeredBy: ctx.user.id, ...input.input },
            });
            return {
              workflowId,
              runId,
              status: "STARTED",
              source: "temporal",
              message: `Workflow ${input.workflowType} started on Temporal cluster.`,
            };
          }
          const errText = await res.text().catch(() => "");
          throw new Error(`Temporal API responded ${res.status}: ${errText}`);
        } catch (e) {
          console.error(`[Temporal] Workflow trigger failed: ${e}`);
          // Fall through to DB-only mode
        }
      }

      // Temporal unavailable — persist to DB only (will be picked up when Temporal comes back)
      await saveWorkflowToDb({
        workflowId,
        runId: `pending-${crypto.randomUUID()}`,
        workflowType: input.workflowType,
        declarationId: input.declarationId,
        status: "RUNNING",
        startedAt: new Date().toISOString(),
        memo: { triggeredBy: ctx.user.id, pendingTemporalSubmit: true, ...input.input },
      });

      return {
        workflowId,
        runId: null,
        status: "PENDING",
        source: "db_only",
        message: `Workflow ${input.workflowType} queued for execution. Temporal cluster is currently unavailable.`,
      };
    }),

  /**
   * Send a signal to a running workflow (e.g., OGA approval, payment confirmed).
   */
  signalWorkflow: adminProcedure
    .input(z.object({
      workflowId: z.string(),
      signalName: z.enum([
        "oga_approved",
        "oga_rejected",
        "payment_confirmed",
        "inspection_completed",
        "override_approved",
        "cancel_workflow",
      ]),
      signalData: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ input }) => {
      const available = await temporalAvailable();

      if (available) {
        try {
          const res = await fetch(
            `${TEMPORAL_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${encodeURIComponent(input.workflowId)}/signal`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                signalName: input.signalName,
                input: { payloads: [{ data: Buffer.from(JSON.stringify(input.signalData ?? {})).toString("base64") }] },
              }),
              signal: AbortSignal.timeout(5_000),
            }
          );

          if (res.ok) {
            // Update DB record to reflect signal
            const dbWorkflow = await getWorkflowFromDb(input.workflowId);
            if (dbWorkflow && (input.signalName === "payment_confirmed" || input.signalName === "oga_approved")) {
              await saveWorkflowToDb({
                workflowId: input.workflowId,
                runId: dbWorkflow.runId ?? undefined,
                workflowType: dbWorkflow.workflowType ?? undefined,
                declarationId: dbWorkflow.declarationId,
                status: "RUNNING",
                startedAt: dbWorkflow.startTime?.toISOString(),
                currentStep: `signal:${input.signalName}`,
              });
            }
            return { success: true, source: "temporal", message: `Signal '${input.signalName}' sent to workflow ${input.workflowId}` };
          }
          const errText = await res.text().catch(() => "");
          throw new Error(`Temporal API responded ${res.status}: ${errText}`);
        } catch (e) {
          console.error(`[Temporal] Signal failed: ${e}`);
        }
      }

      // Temporal unavailable — update DB state only
      const workflow = await getWorkflowFromDb(input.workflowId);
      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Workflow ${input.workflowId} not found.`,
        });
      }

      const terminalSignals = ["payment_confirmed", "oga_approved", "inspection_completed", "override_approved"];
      const cancelSignals = ["cancel_workflow", "oga_rejected"];
      const newStatus = terminalSignals.includes(input.signalName) ? "COMPLETED"
        : cancelSignals.includes(input.signalName) ? "CANCELLED"
        : "RUNNING";

      await saveWorkflowToDb({
        workflowId: input.workflowId,
        runId: workflow.runId ?? undefined,
        workflowType: workflow.workflowType ?? undefined,
        declarationId: workflow.declarationId,
        status: newStatus,
        startedAt: workflow.startTime?.toISOString(),
        completedAt: newStatus !== "RUNNING" ? new Date().toISOString() : undefined,
        currentStep: `signal:${input.signalName}`,
      });

      return {
        success: true,
        source: "db_only",
        message: `Signal '${input.signalName}' recorded in DB. Temporal cluster is currently unavailable.`,
      };
    }),
});
