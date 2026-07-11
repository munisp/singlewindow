import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { securityAlerts } from "../../drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { publishEvent, TOPICS } from "../_core/kafka";

const WAZUH_SVC_URL = process.env.WAZUH_SVC_URL ?? "http://wazuh-svc:8100";
const DEMO_MODE = process.env.DEMO_MODE === "true";

async function callWazuh<T>(path: string, method = "GET", body?: unknown): Promise<T | null> {
  if (DEMO_MODE) return null;
  try {
    const res = await fetch(`${WAZUH_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export const wazuhRouter = router({
  // Get all security alerts — falls back to DB in demo mode
  getAlerts: adminProcedure.query(async () => {
    const live = await callWazuh<{ alerts: unknown[]; count: number }>("/alerts");
    if (live) return live;
    // DB fallback
    const db = await getDb();
    if (!db) return { alerts: [], count: 0 };
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
    };
  }),

  // Get all monitored agents — returns demo stub in fallback
  getAgents: adminProcedure.query(async () => {
    const live = await callWazuh<{ agents: unknown[]; count: number }>("/agents");
    if (live) return live;
    return {
      agents: [
        { id: "001", name: "api-gateway-01", ip: "10.0.1.10", status: "active", os: "Ubuntu 22.04", version: "4.7.0", last_keepalive: new Date().toISOString() },
        { id: "002", name: "declaration-svc-01", ip: "10.0.1.11", status: "active", os: "Ubuntu 22.04", version: "4.7.0", last_keepalive: new Date().toISOString() },
        { id: "003", name: "postgresql-01", ip: "10.0.1.20", status: "active", os: "Ubuntu 22.04", version: "4.7.0", last_keepalive: new Date().toISOString() },
        { id: "004", name: "risk-engine-01", ip: "10.0.1.30", status: "active", os: "Ubuntu 22.04", version: "4.7.0", last_keepalive: new Date().toISOString() },
        { id: "005", name: "mojaloop-connector", ip: "10.0.1.40", status: "disconnected", os: "Ubuntu 22.04", version: "4.7.0", last_keepalive: new Date(Date.now() - 3600000).toISOString() },
      ],
      count: 5,
    };
  }),

  // List available playbooks — returns demo stub in fallback
  listPlaybooks: adminProcedure.query(async () => {
    const live = await callWazuh<{ playbooks: unknown[] }>("/playbooks");
    if (live) return live;
    return {
      playbooks: [
        { id: "PB-001", name: "Block IP Address", description: "Automatically block a source IP at the WAF level", severity_threshold: "high", estimated_duration_seconds: 30 },
        { id: "PB-002", name: "Lock User Account", description: "Disable a user account and invalidate all active sessions", severity_threshold: "critical", estimated_duration_seconds: 10 },
        { id: "PB-003", name: "Isolate Service", description: "Remove a microservice from the service mesh to contain a breach", severity_threshold: "critical", estimated_duration_seconds: 60 },
        { id: "PB-004", name: "Rotate JWT Secret", description: "Rotate the JWT signing secret and force re-authentication for all users", severity_threshold: "high", estimated_duration_seconds: 120 },
        { id: "PB-005", name: "Capture Forensic Snapshot", description: "Take a memory dump and disk snapshot of the affected service for forensic analysis", severity_threshold: "medium", estimated_duration_seconds: 300 },
      ],
    };
  }),

  // Trigger a response playbook — no-op in demo mode
  triggerPlaybook: adminProcedure
    .input(z.object({
      playbookId: z.string().min(1, "playbookId is required"),
      alertId: z.string().min(1, "alertId is required"),
    }))
    .mutation(async ({ input }) => {
      const live = await callWazuh<{
        id: string; playbook_id: string; alert_id: string; status: string;
        actions_taken: string[]; started_at: string; completed_at: string;
      }>("/playbooks/trigger", "POST", { playbook_id: input.playbookId, alert_id: input.alertId });
      if (live) return live;
      // Demo stub
      return {
        id: `EXEC-${Date.now()}`,
        playbook_id: input.playbookId,
        alert_id: input.alertId,
        status: "completed",
        actions_taken: ["[DEMO] Action simulated — no real changes made"],
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      };
    }),

  // Detect login anomalies — demo stub
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
      if (live) return live;
      // Demo: simple heuristic
      const failedCount = input.events.filter(e => !e.success).length;
      const detected = failedCount >= 3;
      const result = {
        detected,
        anomaly_type: detected ? "brute_force" : "none",
        severity: detected ? "high" : "info",
        description: detected
          ? `[DEMO] ${failedCount} failed login attempts detected — possible brute force`
          : "[DEMO] No anomaly detected in provided events",
        score: detected ? 0.85 : 0.12,
      };
      // Publish Kafka SECURITY_ALERT when anomaly detected (fire-and-forget)
      if (detected) {
        publishEvent(TOPICS.SECURITY_ALERT, {
          eventType: "security.alert",
          aggregateId: `wazuh-anomaly-${Date.now()}`,
          payload: {
            anomalyType: result.anomaly_type,
            severity: result.severity,
            description: result.description,
            score: result.score,
            eventCount: input.events.length,
            failedCount,
          },
        }).catch(() => {});
      }
      return result;
    }),

  // Get overall platform security score — DB-derived in demo mode
  getSecurityScore: protectedProcedure.query(async () => {
    const live = await callWazuh<{
      score: number; grade: string; unresolved_alerts: number; total_agents: number; computed_at: string;
    }>("/security-score");
    if (live) return live;
    // DB fallback: derive score from unresolved alerts
    const db = await getDb();
    if (!db) return { score: 78, grade: "B+", unresolved_alerts: 0, total_agents: 5, computed_at: new Date().toISOString() };
    const rows = await db.select().from(securityAlerts).where(eq(securityAlerts.acknowledged, false));
    const criticals = rows.filter(r => r.severity === "critical").length;
    const highs = rows.filter(r => r.severity === "high").length;
    const score = Math.max(0, 100 - criticals * 15 - highs * 8 - rows.length * 2);
    const grade = score >= 90 ? "A" : score >= 80 ? "B+" : score >= 70 ? "B" : score >= 60 ? "C" : "D";
    return {
      score,
      grade,
      unresolved_alerts: rows.length,
      total_agents: 5,
      computed_at: new Date().toISOString(),
    };
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
