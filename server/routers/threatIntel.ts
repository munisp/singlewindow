import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const OPENCTI_SVC_URL = process.env.OPENCTI_SVC_URL ?? "http://opencti-svc:8099";

async function callOpenCTI<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${OPENCTI_SVC_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `opencti-svc error: ${text}` });
  }
  return res.json() as Promise<T>;
}

export const threatIntelRouter = router({
  // Get all STIX indicators
  getIndicators: protectedProcedure.query(async () => {
    return callOpenCTI<{
      indicators: unknown[];
      count: number;
      last_sync: string;
    }>("/indicators");
  }),

  // Match a declaration against threat indicators
  matchDeclaration: protectedProcedure
    .input(z.object({
      ucr: z.string(),
      hsCodes: z.array(z.string()).default([]),
      traderName: z.string().optional(),
      originCountry: z.string().optional(),
      destCountry: z.string().optional(),
      routeCountries: z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      return callOpenCTI<{
        ucr: string;
        matched: boolean;
        indicators: unknown[];
        risk_score: number;
        threat_types: string[];
        explanation: string;
      }>("/match", "POST", {
        ucr: input.ucr,
        hs_codes: input.hsCodes,
        trader_name: input.traderName ?? "",
        origin_country: input.originCountry ?? "",
        dest_country: input.destCountry ?? "",
        route_countries: input.routeCountries,
      });
    }),

  // Enrich a CEN alert with threat intelligence
  enrichAlert: adminProcedure
    .input(z.object({
      alertId: z.string(),
      ucr: z.string().optional(),
      hsCodes: z.array(z.string()).default([]),
      traderName: z.string().optional(),
      originCountry: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return callOpenCTI<{
        alert_id: string;
        indicators: unknown[];
        threat_actors: unknown[];
        risk_multiplier: number;
        enriched_at: string;
      }>("/enrich", "POST", {
        alert_id: input.alertId,
        ucr: input.ucr ?? "",
        hs_codes: input.hsCodes,
        trader_name: input.traderName ?? "",
        origin_country: input.originCountry ?? "",
      });
    }),

  // Export STIX bundle for partner sharing
  exportStix: adminProcedure.query(async () => {
    return callOpenCTI<{
      type: string;
      id: string;
      spec_version: string;
      objects: unknown[];
      created_at: string;
    }>("/export/stix");
  }),

  // Ingest new STIX indicators (admin only)
  ingestIndicators: adminProcedure
    .input(z.object({
      indicators: z.array(z.object({
        name: z.string(),
        pattern: z.string(),
        patternType: z.string().default("stix"),
        confidence: z.number().min(0).max(100),
        labels: z.array(z.string()).default([]),
        description: z.string().optional(),
        hsCodes: z.array(z.string()).default([]),
        traderEntities: z.array(z.string()).default([]),
        originCountries: z.array(z.string()).default([]),
        threatType: z.enum(["DRUG", "WEAPONS", "COUNTERFEITING", "SANCTIONS", "FRAUD"]),
        severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
      })),
    }))
    .mutation(async ({ input }) => {
      return callOpenCTI<{ ingested: number; message: string }>("/indicators/ingest", "POST", {
        indicators: input.indicators.map(ind => ({
          name: ind.name,
          pattern: ind.pattern,
          pattern_type: ind.patternType,
          confidence: ind.confidence,
          labels: ind.labels,
          description: ind.description ?? "",
          hs_codes: ind.hsCodes,
          trader_entities: ind.traderEntities,
          origin_countries: ind.originCountries,
          threat_type: ind.threatType,
          severity: ind.severity,
        })),
      });
    }),

  // Get threat intelligence statistics
  getStats: protectedProcedure.query(async () => {
    return callOpenCTI<{
      total_indicators: number;
      total_actors: number;
      by_severity: Record<string, number>;
      by_threat_type: Record<string, number>;
      last_sync: string;
    }>("/stats");
  }),
});
