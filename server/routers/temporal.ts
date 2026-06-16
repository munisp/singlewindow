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
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";

// R3 FIX: Use ENV for all Temporal config to ensure namespace consistency across the codebase.
// ENV.temporalNamespace defaults to 'tradegateway' (not 'tradegate') — see env.ts line 45.
const TEMPORAL_URL = ENV.temporalAddress ?? process.env.TEMPORAL_URL ?? "http://localhost:7233";
const TEMPORAL_UI_URL = process.env.TEMPORAL_UI_URL ?? "http://localhost:8080";
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

// ─── Mock workflow state generator ─────────────────────────────────────────

function generateMockWorkflow(workflowId: string, declarationId?: number) {
  const now = Date.now();
  const startedAt = now - 1800_000; // 30 min ago as deterministic fallback
  type WorkflowStatus = "RUNNING" | "COMPLETED" | "FAILED" | "TIMED_OUT" | "CANCELLED";
  const statuses: WorkflowStatus[] = ["RUNNING", "COMPLETED", "RUNNING", "RUNNING", "COMPLETED"];
  const status: WorkflowStatus = statuses[0]; // deterministic fallback when Temporal is unavailable

  const activities = [
    {
      id: "1",
      name: "ValidateDeclaration",
      status: "COMPLETED",
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(startedAt + 2_000).toISOString(),
      attempt: 1,
      result: { valid: true, warnings: [] },
    },
    {
      id: "2",
      name: "RunRiskAssessment",
      status: "COMPLETED",
      startedAt: new Date(startedAt + 2_500).toISOString(),
      completedAt: new Date(startedAt + 7_000).toISOString(),
      attempt: 1,
      result: { riskScore: 23, riskLevel: "GREEN", lane: "GREEN" },
    },
    {
      id: "3",
      name: "NotifyOGAs",
      status: "COMPLETED",
      startedAt: new Date(startedAt + 7_500).toISOString(),
      completedAt: new Date(startedAt + 9_000).toISOString(),
      attempt: 1,
      result: { notified: ["FDA", "CEPS", "GIPC"] },
    },
    {
      id: "4",
      name: "WaitForOGAApprovals",
      status: status === "COMPLETED" ? "COMPLETED" : "RUNNING",
      startedAt: new Date(startedAt + 9_500).toISOString(),
      completedAt: status === "COMPLETED" ? new Date(startedAt + 1_800_000).toISOString() : undefined,
      attempt: 1,
      result: status === "COMPLETED" ? { approvals: ["FDA", "CEPS", "GIPC"], rejections: [] } : undefined,
    },
    {
      id: "5",
      name: "ProcessPayment",
      status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
      startedAt: status === "COMPLETED" ? new Date(startedAt + 1_800_500).toISOString() : undefined,
      completedAt: status === "COMPLETED" ? new Date(startedAt + 1_815_000).toISOString() : undefined,
      attempt: 1,
      result: status === "COMPLETED" ? { paymentConfirmed: true, transferId: `TRF-${Date.now()}` } : undefined,
    },
    {
      id: "6",
      name: "IssueClearancePermit",
      status: status === "COMPLETED" ? "COMPLETED" : "PENDING",
      startedAt: status === "COMPLETED" ? new Date(startedAt + 1_815_500).toISOString() : undefined,
      completedAt: status === "COMPLETED" ? new Date(startedAt + 1_816_000).toISOString() : undefined,
      attempt: 1,
      result: status === "COMPLETED" ? { permitNumber: `CP-${declarationId ?? "000"}-${Date.now()}` } : undefined,
    },
  ];

  return {
    workflowId,
    runId: `run-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    workflowType: WORKFLOW_TYPES.DECLARATION_CLEARANCE,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: "customs-clearance",
    status,
    startedAt: new Date(startedAt).toISOString(),
    completedAt: status === "COMPLETED" ? new Date(startedAt + 1_816_500).toISOString() : null,
    declarationId: declarationId ?? null,
    activities,
    pendingActivities: activities.filter(a => a.status === "RUNNING").map(a => a.name),
    completedActivities: activities.filter(a => a.status === "COMPLETED").length,
    totalActivities: activities.length,
    currentActivity: activities.find(a => a.status === "RUNNING")?.name ?? null,
    historyLength: activities.filter(a => a.status !== "PENDING").length * 3,
    memo: {
      declarationId: declarationId?.toString() ?? "unknown",
      traderName: "Sample Trader Ltd",
      hsCode: "8471.30",
      riskLevel: "GREEN",
    },
    isMock: true,
  };
}

// ─── In-memory workflow registry ───────────────────────────────────────────

const workflowRegistry = new Map<string, ReturnType<typeof generateMockWorkflow>>();

// ─── Router ───────────────────────────────────────────────────────────────

export const temporalRouter = router({
  /**
   * Get the Temporal cluster health and namespace status.
   */
  getSystemStatus: protectedProcedure.query(async () => {
    const available = await temporalAvailable();

    return {
      connected: available,
      mode: available ? "LIVE" : "SIMULATION",
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
        activeWorkflows: workflowRegistry.size,
        completedWorkflows: Array.from(workflowRegistry.values())
          .filter(w => w.status === "COMPLETED").length,
      },
    };
  }),

  /**
   * Get workflow execution details by workflowId.
   */
  getWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ input }) => {
      // Check in-memory registry first
      let workflow = workflowRegistry.get(input.workflowId);

      if (!workflow) {
        // Try Temporal API
        const available = await temporalAvailable();
        if (available) {
          try {
            const res = await fetch(
              `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${input.workflowId}`,
              { signal: AbortSignal.timeout(5_000) }
            );
            if (res.ok) {
              return res.json();
            }
          } catch {
            // fall through to mock
          }
        }

        // Generate mock for demo
        workflow = generateMockWorkflow(input.workflowId);
        workflowRegistry.set(input.workflowId, workflow);
      }

      return workflow;
    }),

  /**
   * List workflows associated with a declaration.
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
          const query = input.declarationId
            ? `declarationId="${input.declarationId}"`
            : "";
          const res = await fetch(
            `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows?query=${encodeURIComponent(query)}&pageSize=${input.limit}`,
            { signal: AbortSignal.timeout(5_000) }
          );
          if (res.ok) {
            return res.json();
          }
        } catch {
          // fall through to mock
        }
      }

      // Generate mock workflows
      const mockWorkflows = Array.from({ length: Math.min(input.limit, 5) }, (_, i) => {
        const wfId = `DCL-${(input.declarationId ?? 1000) + i}-${Date.now() - i * 3600_000}`;
        const existing = workflowRegistry.get(wfId);
        if (existing) return existing;
        const wf = generateMockWorkflow(wfId, input.declarationId);
        workflowRegistry.set(wfId, wf);
        return wf;
      });

      const filtered = input.status === "ALL"
        ? mockWorkflows
        : mockWorkflows.filter(w => w.status === input.status);

      return {
        workflows: filtered,
        total: filtered.length,
        isMock: true,
      };
    }),

  /**
   * Get the full event history for a workflow execution.
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
          const res = await fetch(
            `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${input.workflowId}/history`,
            { signal: AbortSignal.timeout(5_000) }
          );
          if (res.ok) {
            return res.json();
          }
        } catch {
          // fall through to mock
        }
      }

      const workflow = workflowRegistry.get(input.workflowId)
        ?? generateMockWorkflow(input.workflowId);

      // Generate synthetic event history
      const events = [];
      let eventId = 1;
      const baseTime = new Date(workflow.startedAt).getTime();

      events.push({
        eventId: eventId++,
        eventType: "WorkflowExecutionStarted",
        timestamp: workflow.startedAt,
        attributes: {
          workflowType: workflow.workflowType,
          taskQueue: workflow.taskQueue,
          input: workflow.memo,
        },
      });

      for (const activity of workflow.activities) {
        if (activity.status === "PENDING") continue;

        events.push({
          eventId: eventId++,
          eventType: "ActivityTaskScheduled",
          timestamp: activity.startedAt ?? workflow.startedAt,
          attributes: { activityType: activity.name, activityId: activity.id },
        });

        if (activity.startedAt) {
          events.push({
            eventId: eventId++,
            eventType: "ActivityTaskStarted",
            timestamp: activity.startedAt,
            attributes: { activityId: activity.id, attempt: activity.attempt },
          });
        }

        if (activity.completedAt) {
          events.push({
            eventId: eventId++,
            eventType: "ActivityTaskCompleted",
            timestamp: activity.completedAt,
            attributes: { activityId: activity.id, result: activity.result },
          });
        }
      }

      if (workflow.status === "COMPLETED" && workflow.completedAt) {
        events.push({
          eventId: eventId++,
          eventType: "WorkflowExecutionCompleted",
          timestamp: workflow.completedAt,
          attributes: { result: { status: "CLEARED" } },
        });
      }

      return {
        workflowId: input.workflowId,
        events,
        totalCount: events.length,
        isMock: true,
      };
    }),

  /**
   * Trigger a new workflow execution for a declaration.
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
              }),
              signal: AbortSignal.timeout(10_000),
            }
          );

          if (res.ok) {
            const data = await res.json() as Record<string, unknown>;
            return {
              workflowId,
              runId: (data as Record<string, unknown>).runId as string,
              status: "STARTED",
              message: `Workflow ${input.workflowType} started successfully.`,
            };
          }
        } catch (e) {
          console.warn(`[Temporal] Workflow trigger failed: ${e}. Using simulation.`);
        }
      }

      // Simulation mode
      const mockWf = generateMockWorkflow(workflowId, input.declarationId);
      workflowRegistry.set(workflowId, { ...mockWf, status: "RUNNING" });

      return {
        workflowId,
        runId: mockWf.runId,
        status: "STARTED",
        message: `Workflow ${input.workflowType} started (simulation mode).`,
        isMock: !available,
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
            `${TEMPORAL_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${input.workflowId}/signal`,
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
            return { success: true, message: `Signal '${input.signalName}' sent to workflow ${input.workflowId}` };
          }
        } catch (e) {
          console.warn(`[Temporal] Signal failed: ${e}. Using simulation.`);
        }
      }

      // Update in-memory state for simulation
      const workflow = workflowRegistry.get(input.workflowId);
      if (workflow) {
        if (input.signalName === "payment_confirmed" || input.signalName === "oga_approved") {
          workflowRegistry.set(input.workflowId, { ...workflow, status: "COMPLETED" });
        }
      }

      return {
        success: true,
        message: `Signal '${input.signalName}' processed (simulation mode).`,
        isMock: !available,
      };
    }),
});
