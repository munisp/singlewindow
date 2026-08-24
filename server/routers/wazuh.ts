import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { securityAlerts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

const WAZUH_SVC_URL = process.env.WAZUH_SVC_URL ?? "http://wazuh-svc:8100";
async function callWazuh<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  try {
    const res = await fetch(`${WAZUH_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Wazuh service returned ${res.status}` });
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Wazuh service unavailable" });
  }
}

export const wazuhRouter = router({
  // Get all security alerts from Wazuh
  getAlerts: adminProcedure.query(async () => {
    return callWazuh<{ alerts: unknown[]; count: number }>("/alerts");
  }),

  // Get all monitored agents from Wazuh
  getAgents: adminProcedure.query(async () => {
    return callWazuh<{ agents: unknown[]; count: number }>("/agents");
  }),

  // List available playbooks from Wazuh
  listPlaybooks: adminProcedure.query(async () => {
    return callWazuh<{ playbooks: unknown[] }>("/playbooks");
  }),

  // Trigger a response playbook through Wazuh
  triggerPlaybook: adminProcedure
    .input(z.object({
      playbookId: z.string().min(1, "playbookId is required"),
      alertId: z.string().min(1, "alertId is required"),
    }))
    .mutation(async ({ input }) => {
      return callWazuh<{
        id: string; playbook_id: string; alert_id: string; status: string;
        actions_taken: string[]; started_at: string; completed_at: string;
      }>("/playbooks/trigger", "POST", { playbook_id: input.playbookId, alert_id: input.alertId });
    }),

  // Detect login anomalies through Wazuh
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
        detected: boolean; anomaly_type: string; severity: string; description: string; score: number;
      }>("/detect/anomaly", "POST", {
        events: input.events.map(e => ({
          user_id: e.userId, ip_address: e.ipAddress,
          country: e.country ?? "", timestamp: e.timestamp, success: e.success,
        })),
      });
    }),

  // Get overall platform security score from Wazuh
  getSecurityScore: protectedProcedure.query(async () => {
    return callWazuh<{
      score: number; grade: string; unresolved_alerts: number; total_agents: number; computed_at: string;
    }>("/security-score");
  }),

  // Acknowledge an alert
  acknowledgeAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "DB unavailable" });
      await db.update(securityAlerts)
        .set({ acknowledged: true, acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() })
        .where(eq(securityAlerts.alertId, input.alertId));
      return { success: true };
    }),
});
