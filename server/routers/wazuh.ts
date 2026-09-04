import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { securityAlerts } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { publishEvent, TOPICS } from "../_core/kafka";

// Fail-closed doctrine: no fabricated agents/playbooks/verdicts. When the Wazuh
// service is not explicitly configured we return WAZUH_UNCONFIGURED; when it is
// configured but unreachable we return WAZUH_UNAVAILABLE. Demo fallbacks removed
// (phase-10 audit remediation, finding B-1).
const WAZUH_SVC_URL = process.env.WAZUH_SVC_URL ?? "";

function wazuhUnconfigured(): TRPCError {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "WAZUH_UNCONFIGURED: WAZUH_SVC_URL is not set; Wazuh integration is disabled (fail-closed)",
  });
}

function wazuhUnavailable(detail?: string): TRPCError {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: `WAZUH_UNAVAILABLE: wazuh-svc is unreachable or returned an error${detail ? ` (${detail})` : ""}`,
  });
}

async function callWazuh<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  if (!WAZUH_SVC_URL) throw wazuhUnconfigured();
  let res: Response;
  try {
    res = await fetch(`${WAZUH_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    throw wazuhUnavailable(err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw wazuhUnavailable(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const wazuhRouter = router({
  // Get all security alerts — live from wazuh-svc; falls back to alerts
  // persisted in our own DB (real recorded data, disclosed via source field).
  getAlerts: adminProcedure.query(async () => {
    try {
      const live = await callWazuh<{ alerts: unknown[]; count: number }>("/alerts");
      return { ...live, source: "wazuh-svc" as const };
    } catch (err) {
      if (!(err instanceof TRPCError)) throw err;
      // DB fallback: honest — these are real alerts recorded by the platform.
      const db = await getDb();
      if (!db) throw err;
      const rows = await db.select().from(securityAlerts).orderBy(desc(securityAlerts.createdAt)).limit(100);
      return {
        alerts: rows.map(r => ({
          id: r.alertId,
          severity: r.severity,
          category: r.category,
          title: r.title,
          description: r.description,
          source_ip: r.sourceIp,
          target_service: r.targetService,
          rule_id: r.ruleId,
          rule_description: r.ruleDescription,
          raw_event: r.rawEvent,
          acknowledged: r.acknowledged,
          acknowledged_by: r.acknowledgedBy,
          acknowledged_at: r.acknowledgedAt,
          resolved_at: r.resolvedAt,
          timestamp: r.createdAt,
        })),
        count: rows.length,
        source: "db-fallback" as const,
      };
    }
  }),

  // Get all monitored agents — live only; fail closed when Wazuh is down.
  getAgents: adminProcedure.query(async () => {
    return callWazuh<{ agents: unknown[]; count: number }>("/agents");
  }),

  // List available playbooks — live only; fail closed when Wazuh is down.
  listPlaybooks: adminProcedure.query(async () => {
    return callWazuh<{ playbooks: unknown[] }>("/playbooks");
  }),

  // Trigger a response playbook — fail closed: NEVER report success for an
  // action that was not executed by wazuh-svc.
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

  // Detect login anomalies — live only; fail closed when Wazuh is down.
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
      const live = await callWazuh<{
        detected: boolean; anomaly_type: string; severity: string; description: string; score: number;
      }>("/detect/anomaly", "POST", {
        events: input.events.map(e => ({
          user_id: e.userId, ip_address: e.ipAddress,
          country: e.country ?? "", timestamp: e.timestamp, success: e.success,
        })),
      });
      // Publish Kafka SECURITY_ALERT when anomaly detected (fire-and-forget)
      if (live.detected) {
        publishEvent(TOPICS.SECURITY_ALERT, {
          eventType: "security.alert",
          aggregateId: `wazuh-anomaly-${Date.now()}`,
          payload: {
            anomalyType: live.anomaly_type,
            severity: live.severity,
            description: live.description,
            score: live.score,
            eventCount: input.events.length,
          },
        }).catch(() => {});
      }
      return live;
    }),

  // Get overall platform security score — live from wazuh-svc; DB-derived
  // fallback is computed from real unresolved alerts and disclosed via source.
  getSecurityScore: adminProcedure.query(async () => {
    try {
      const live = await callWazuh<{
        score: number; grade: string; unresolved_alerts: number; total_agents: number; computed_at: string;
      }>("/security-score");
      return { ...live, source: "wazuh-svc" as const };
    } catch (err) {
      if (!(err instanceof TRPCError)) throw err;
      const db = await getDb();
      if (!db) throw err;
      const rows = await db.select().from(securityAlerts).where(eq(securityAlerts.acknowledged, false));
      const criticals = rows.filter(r => r.severity === "critical").length;
      const highs = rows.filter(r => r.severity === "high").length;
      const score = Math.max(0, 100 - criticals * 15 - highs * 8 - rows.length * 2);
      const grade = score >= 90 ? "A" : score >= 80 ? "B+" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
      return {
        score,
        grade,
        unresolved_alerts: rows.length,
        // Unknown without a live Wazuh connection — reported honestly as null.
        total_agents: null,
        computed_at: new Date().toISOString(),
        source: "db-derived" as const,
      };
    }
  }),

  // Acknowledge an alert
  acknowledgeAlert: adminProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      await db.update(securityAlerts)
        .set({ acknowledged: true, acknowledgedBy: ctx.user.id, acknowledgedAt: new Date() })
        .where(eq(securityAlerts.alertId, input.alertId));
      return { success: true };
    }),
});
