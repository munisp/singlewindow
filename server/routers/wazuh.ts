import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const WAZUH_SVC_URL = process.env.WAZUH_SVC_URL ?? "http://wazuh-svc:8100";

async function callWazuh<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${WAZUH_SVC_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `wazuh-svc error: ${text}` });
  }
  return res.json() as Promise<T>;
}

export const wazuhRouter = router({
  // Get all security alerts
  getAlerts: adminProcedure.query(async () => {
    return callWazuh<{ alerts: unknown[]; count: number }>("/alerts");
  }),

  // Get all monitored agents
  getAgents: adminProcedure.query(async () => {
    return callWazuh<{ agents: unknown[]; count: number }>("/agents");
  }),

  // List available playbooks
  listPlaybooks: adminProcedure.query(async () => {
    return callWazuh<{ playbooks: unknown[] }>("/playbooks");
  }),

  // Trigger a response playbook for an alert
  triggerPlaybook: adminProcedure
    .input(z.object({
      playbookId: z.string(),
      alertId: z.string(),
    }))
    .mutation(async ({ input }) => {
      return callWazuh<{
        id: string;
        playbook_id: string;
        alert_id: string;
        status: string;
        actions_taken: string[];
        started_at: string;
        completed_at: string;
      }>("/playbooks/trigger", "POST", {
        playbook_id: input.playbookId,
        alert_id: input.alertId,
      });
    }),

  // Detect login anomalies from a batch of login events
  detectAnomaly: adminProcedure
    .input(z.object({
      events: z.array(z.object({
        userId: z.string(),
        ipAddress: z.string(),
        country: z.string().optional(),
        timestamp: z.string(),
        success: z.boolean(),
      })),
    }))
    .mutation(async ({ input }) => {
      return callWazuh<{
        detected: boolean;
        anomaly_type: string;
        severity: string;
        description: string;
        score: number;
      }>("/detect/anomaly", "POST", {
        events: input.events.map(e => ({
          user_id: e.userId,
          ip_address: e.ipAddress,
          country: e.country ?? "",
          timestamp: e.timestamp,
          success: e.success,
        })),
      });
    }),

  // Get overall platform security score
  getSecurityScore: protectedProcedure.query(async () => {
    return callWazuh<{
      score: number;
      grade: string;
      unresolved_alerts: number;
      total_agents: number;
      computed_at: string;
    }>("/security-score");
  }),
});
