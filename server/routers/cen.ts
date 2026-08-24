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
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: msg });
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "CEN service unavailable" });
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
      return cenFetch(`/partners?${params}`);
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
      return cenFetch(`/alerts?${params}`);
    }),

  // Correlate an alert with existing alerts
  correlateAlert: protectedProcedure
    .input(z.object({ alertId: z.string() }))
    .query(async ({ input }) => {
      return cenFetch(`/alerts/${input.alertId}/correlate`);
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
      return cenFetch("/stats");
    }),

  /**
   * v112: enrichDeclaration — cross-reference a declaration against WCO CEN intelligence.
   * Returns any matching alerts, risk flags, and a composite enrichment score.
   */
  enrichDeclaration: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      ucr: z.string().optional(),
      traderId: z.string().optional(),
      hsCode: z.string().optional(),
      originCountry: z.string().length(2).optional(),
    }))
    .query(async ({ input }) => {
      return cenFetch("/enrich/declaration", {
        method: "POST",
        body: JSON.stringify(input),
      });
    }),

  /**
   * v112: getTraderRiskProfile — fetch the WCO CEN risk profile for a specific trader.
   * Aggregates all inbound/outbound alerts linked to this trader reference.
   */
  getTraderRiskProfile: protectedProcedure
    .input(z.object({
      traderRef: z.string().min(1),
      includeHistory: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const params = new URLSearchParams({ traderRef: input.traderRef });
      if (input.includeHistory) params.set("includeHistory", "true");
      return cenFetch(`/risk/trader?${params}`);
    }),

  /**
   * v112: bulkEnrich — batch-enrich up to 50 declarations against CEN intelligence in one call.
   * Returns an array of enrichment results in the same order as the input.
   */
  bulkEnrich: adminProcedure
    .input(z.object({
      declarations: z.array(z.object({
        declarationId: z.number().int().positive(),
        ucr: z.string().optional(),
        traderId: z.string().optional(),
        hsCode: z.string().optional(),
        originCountry: z.string().length(2).optional(),
      })).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      return cenFetch("/enrich/bulk", {
        method: "POST",
        body: JSON.stringify({ declarations: input.declarations }),
      });
    }),
});
