/**
 * WCO CEN (Customs Enforcement Network) tRPC Router
 * Proxies to the Go cen-service (port 8097)
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const CEN_SERVICE_URL = process.env.CEN_SERVICE_URL || "http://localhost:8097";

async function cenFetch(path: string, options?: RequestInit) {
  try {
    const res = await fetch(`${CEN_SERVICE_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error ?? text; } catch {}
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // Service unavailable — return graceful fallback
    return null;
  }
}

const AlertTypeEnum = z.enum(["RISK_PROFILE", "SEIZURE", "WANTED_PERSON", "VESSEL_WATCH", "GENERAL"]);
const PriorityEnum = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const cenRouter = router({
  // Get all partner customs administrations
  getPartners: protectedProcedure
    .input(z.object({
      region: z.string().optional(),
      activeOnly: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.region) params.set("region", input.region);
      if (input.activeOnly) params.set("activeOnly", "true");
      const data = await cenFetch(`/partners?${params}`);
      return data ?? { partners: [], total: 0 };
    }),

  // Send a risk alert to a partner customs administration
  sendAlert: adminProcedure
    .input(z.object({
      partnerCode: z.string().min(2).max(3),
      alertType: AlertTypeEnum,
      priority: PriorityEnum,
      subject: z.string().min(5).max(200),
      description: z.string().min(10).max(2000),
      traderRef: z.string().optional(),
      ucr: z.string().optional(),
      hsCode: z.string().optional(),
      riskScore: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const data = await cenFetch("/alerts/send", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "CEN service unavailable" });
      return data;
    }),

  // Receive an inbound alert from a partner (webhook-style)
  receiveAlert: adminProcedure
    .input(z.object({
      senderCode: z.string().min(2).max(3),
      alertType: AlertTypeEnum,
      priority: PriorityEnum,
      subject: z.string().min(5).max(200),
      description: z.string().min(10).max(2000),
      traderRef: z.string().optional(),
      ucr: z.string().optional(),
      hsCode: z.string().optional(),
      riskScore: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input }) => {
      const data = await cenFetch("/alerts/receive", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "CEN service unavailable" });
      return data;
    }),

  // List all alerts (outbound + inbound)
  listAlerts: protectedProcedure
    .input(z.object({
      direction: z.enum(["OUTBOUND", "INBOUND"]).optional(),
      priority: PriorityEnum.optional(),
      alertType: AlertTypeEnum.optional(),
    }))
    .query(async ({ input }) => {
      const params = new URLSearchParams();
      if (input.direction) params.set("direction", input.direction);
      if (input.priority) params.set("priority", input.priority);
      if (input.alertType) params.set("alertType", input.alertType);
      const data = await cenFetch(`/alerts?${params}`);
      return data ?? { alerts: [], total: 0 };
    }),

  // Correlate an alert with existing alerts
  correlateAlert: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .query(async ({ input }) => {
      const data = await cenFetch(`/alerts/${input.alertId}/correlate`);
      return data ?? { alertId: input.alertId, matchedAlerts: [], correlationScore: 0, reason: "Service unavailable" };
    }),

  // Acknowledge an inbound alert
  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .mutation(async ({ input }) => {
      const data = await cenFetch(`/alerts/${input.alertId}/acknowledge`, { method: "PUT" });
      if (!data) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "CEN service unavailable" });
      return data;
    }),

  // Get CEN statistics
  getStats: protectedProcedure
    .query(async () => {
      const data = await cenFetch("/stats");
      return data ?? {
        total: 0, outbound: 0, inbound: 0,
        high: 0, medium: 0, low: 0,
        active: 0, acknowledged: 0,
        activePartners: 0, totalPartners: 0,
      };
    }),
});
