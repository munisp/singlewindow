/**
 * SOC Router — Sprint 54: Wazuh SIEM/XDR Integration
 * Provides procedures for security alerts, incident management,
 * MITRE ATT&CK stats, and agent status from the wazuh-svc.
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";

const WAZUH_SVC = process.env.WAZUH_SVC_URL ?? "http://localhost:8108";

async function callWazuh<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${WAZUH_SVC}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`wazuh-svc error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export const socRouter = router({
  // ─── Alerts ────────────────────────────────────────────────────────────────

  getAlerts: publicProcedure
    .input(
      z.object({
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        acknowledged: z.boolean().optional(),
        declarationId: z.string().optional(),
        traderId: z.string().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.severity) params.set("severity", input.severity);
      if (input.acknowledged !== undefined) params.set("acknowledged", String(input.acknowledged));
      if (input.declarationId) params.set("declaration_id", input.declarationId);
      if (input.traderId) params.set("trader_id", input.traderId);
      params.set("limit", String(input.limit));
      params.set("offset", String(input.offset));
      return callWazuh<{ total: number; alerts: unknown[] }>(`/alerts?${params}`);
    }),

  acknowledgeAlert: publicProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      return callWazuh(`/alerts/${input.alertId}/acknowledge`, { method: "POST" });
    }),

  ingestAlert: publicProcedure
    .input(
      z.object({
        ruleId: z.string(),
        level: z.number().int().min(1).max(15),
        description: z.string(),
        agentId: z.string(),
        agentName: z.string(),
        srcIp: z.string().default(""),
        dstIp: z.string().default(""),
        declarationId: z.string().optional(),
        traderId: z.string().optional(),
        extraData: z.record(z.string(), z.unknown()).default({}),
      })
    )
    .mutation(async ({ input }) => {
      return callWazuh("/alerts/ingest", {
        method: "POST",
        body: JSON.stringify({
          rule_id: input.ruleId,
          level: input.level,
          description: input.description,
          agent_id: input.agentId,
          agent_name: input.agentName,
          src_ip: input.srcIp,
          dst_ip: input.dstIp,
          declaration_id: input.declarationId,
          trader_id: input.traderId,
          extra_data: input.extraData,
        }),
      });
    }),

  // ─── Incidents ─────────────────────────────────────────────────────────────

  getIncidents: publicProcedure
    .input(
      z.object({
        status: z.enum(["open", "investigating", "contained", "resolved"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.status) params.set("status", input.status);
      params.set("limit", String(input.limit));
      params.set("offset", String(input.offset));
      return callWazuh<{ total: number; incidents: unknown[] }>(`/incidents?${params}`);
    }),

  getIncident: publicProcedure
    .input(z.object({ incidentId: z.string() }))
    .query(async ({ input }) => {
      return callWazuh(`/incidents/${input.incidentId}`);
    }),

  createIncident: publicProcedure
    .input(
      z.object({
        title: z.string().min(3),
        severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
        alertIds: z.array(z.string()).default([]),
        description: z.string().default(""),
        assignedTo: z.string().default(""),
      })
    )
    .mutation(async ({ input }) => {
      return callWazuh("/incidents", {
        method: "POST",
        body: JSON.stringify({
          title: input.title,
          severity: input.severity,
          alert_ids: input.alertIds,
          description: input.description,
          assigned_to: input.assignedTo,
        }),
      });
    }),

  updateIncident: publicProcedure
    .input(
      z.object({
        incidentId: z.string(),
        status: z.enum(["open", "investigating", "contained", "resolved"]).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        assignedTo: z.string().optional(),
        description: z.string().optional(),
        resolutionNotes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { incidentId, ...rest } = input;
      return callWazuh(`/incidents/${incidentId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: rest.status,
          severity: rest.severity,
          assigned_to: rest.assignedTo,
          description: rest.description,
          resolution_notes: rest.resolutionNotes,
        }),
      });
    }),

  // ─── Correlation ───────────────────────────────────────────────────────────

  correlateDeclaration: publicProcedure
    .input(z.object({ declarationId: z.string() }))
    .query(async ({ input }) => {
      return callWazuh(`/correlate/declaration/${input.declarationId}`);
    }),

  // ─── Agents & Stats ────────────────────────────────────────────────────────

  getAgentStatus: publicProcedure.query(async () => {
    return callWazuh("/agents");
  }),

  getMitreStats: publicProcedure.query(async () => {
    return callWazuh("/stats/mitre");
  }),
});
