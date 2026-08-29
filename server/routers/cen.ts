/**
 * WCO CEN (Customs Enforcement Network) tRPC Router
 * Proxies to the Go cen-service (default port 8093 per the PORTS registry —
 * renumbered off 8097 which collided with profile-service, P0-7).
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { fetchWithResilience } from "../_core/middlewareClients";
import { PORTS } from "../_core/env";

const CEN_SERVICE_URL = process.env.CEN_SERVICE_URL || `http://localhost:${PORTS.cenService}`;

async function cenFetch(path: string, options?: RequestInit) {
  try {
    // P0-7: timeout + retry + circuit breaker via the resilience wrapper.
    const res = await fetchWithResilience(`${CEN_SERVICE_URL}${path}`, {
      ...options,
      timeoutMs: 5_000,
      headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    }, "cen-service");
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).error ?? text; } catch {}
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
    }
    return JSON.parse(text);
  } catch (err) {
    // Real HTTP error responses from the service propagate.
    if (err instanceof TRPCError && err.code !== "SERVICE_UNAVAILABLE") throw err;
    // Service unavailable (network/timeout/circuit-breaker open) — return
    // graceful fallback; MUTATIONS convert null into SERVICE_UNAVAILABLE.
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
      const data = await cenFetch("/enrich/declaration", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (data) return data;
      // Offline fallback: return empty enrichment
      return {
        declarationId: input.declarationId,
        matchedAlerts: [] as string[],
        riskFlags: [] as string[],
        enrichmentScore: 0,
        source: "offline",
        enrichedAt: new Date().toISOString(),
      };
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
      const data = await cenFetch(`/risk/trader?${params}`);
      if (data) return data;
      return {
        traderRef: input.traderRef,
        riskLevel: "UNKNOWN" as string,
        alertCount: 0,
        highPriorityCount: 0,
        lastAlertAt: null as string | null,
        history: [] as unknown[],
        source: "offline",
      };
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
      const data = await cenFetch("/enrich/bulk", {
        method: "POST",
        body: JSON.stringify({ declarations: input.declarations }),
      });
      if (data) return data;
      // Offline fallback: return empty enrichment for each declaration
      return {
        results: input.declarations.map((d) => ({
          declarationId: d.declarationId,
          matchedAlerts: [] as string[],
          riskFlags: [] as string[],
          enrichmentScore: 0,
          source: "offline",
          enrichedAt: new Date().toISOString(),
        })),
        processedAt: new Date().toISOString(),
        source: "offline",
      };
    }),
});
