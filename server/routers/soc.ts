/**
 * SOC Router — Sprint 54: Wazuh SIEM/XDR Integration
 * Provides procedures for security alerts, incident management,
 * MITRE ATT&CK stats, and agent status from the wazuh-svc.
 *
 * Security: ALL procedures require authentication.
 * Admin-only: ingestAlert, createIncident, updateIncident, getAgentStatus, getMitreStats.
 */

import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";

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

  getAlerts: protectedProcedure
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

  acknowledgeAlert: adminProcedure
    .input(z.object({ alertId: z.string().min(1).max(128) }))
    .mutation(async ({ input }) => {
      return callWazuh(`/alerts/${input.alertId}/acknowledge`, { method: "POST" });
    }),

  ingestAlert: adminProcedure
    .input(
      z.object({
        ruleId: z.string().min(1).max(64),
        level: z.number().int().min(1).max(15),
        description: z.string().min(1).max(1024),
        agentId: z.string().min(1).max(64),
        agentName: z.string().min(1).max(128),
        srcIp: z.string().max(45).default(""),
        dstIp: z.string().max(45).default(""),
        declarationId: z.string().max(128).optional(),
        traderId: z.string().max(128).optional(),
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

  getIncidents: protectedProcedure
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

  getIncident: protectedProcedure
    .input(z.object({ incidentId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      return callWazuh(`/incidents/${input.incidentId}`);
    }),

  createIncident: adminProcedure
    .input(
      z.object({
        title: z.string().min(3).max(256),
        severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
        alertIds: z.array(z.string().max(128)).max(50).default([]),
        description: z.string().max(4096).default(""),
        assignedTo: z.string().max(128).default(""),
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

  updateIncident: adminProcedure
    .input(
      z.object({
        incidentId: z.string().min(1).max(128),
        status: z.enum(["open", "investigating", "contained", "resolved"]).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        assignedTo: z.string().max(128).optional(),
        description: z.string().max(4096).optional(),
        resolutionNotes: z.string().max(4096).optional(),
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

  correlateDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      return callWazuh(`/correlate/declaration/${input.declarationId}`);
    }),

  // ─── Agents & Stats (admin-only — exposes infrastructure topology) ──────────

  getAgentStatus: adminProcedure.query(async () => {
    return callWazuh("/agents");
  }),

  getMitreStats: adminProcedure.query(async () => {
    return callWazuh("/stats/mitre");
  }),
});
