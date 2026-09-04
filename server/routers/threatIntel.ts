import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const OPENCTI_SVC_URL = process.env.OPENCTI_SVC_URL ?? "http://opencti-svc:8099";

async function callOpenCTI<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${OPENCTI_SVC_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    // Honest degraded mode: upstream threat-intel service unreachable — typed
    // error with a clear message, never a raw "fetch failed" stack.
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: `Threat intelligence service is currently unavailable (${timeout ? "timeout" : "connection failed"}). Try again later.`,
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Threat intelligence service returned an error (HTTP ${res.status}).`, cause: text });
  }
  return res.json() as Promise<T>;
}

export const threatIntelRouter = router({
  // Get all STIX indicators
  getIndicators: adminProcedure.query(async () => {
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
  getStats: adminProcedure.query(async () => {
    return callOpenCTI<{
      total_indicators: number;
      total_actors: number;
      by_severity: Record<string, number>;
      by_threat_type: Record<string, number>;
      last_sync: string;
    }>("/stats");
  }),

  // Sprint 52: Full STIX 2.1 enrichment procedures

  enrichDeclaration: protectedProcedure
    .input(z.object({
      declarationId: z.string(),
      traderName: z.string(),
      shipperName: z.string(),
      consigneeName: z.string(),
      originCountry: z.string(),
      destinationCountry: z.string(),
      transshipmentPorts: z.array(z.string()).default([]),
      hsCode: z.string(),
      declaredValueUsd: z.number().nonnegative(),
    }))
    .mutation(async ({ input }) => {
      return callOpenCTI<{
        declaration_id: string;
        enriched_at: string;
        threat_level: string;
        overall_risk_score: number;
        origin_country_risk: Record<string, unknown>;
        destination_country_risk: Record<string, unknown>;
        sanctions_hits: unknown[];
        sanctions_hit_count: number;
        threat_actors: unknown[];
        transshipment_risks: unknown[];
        hs_chapter: string;
        recommendations: string[];
      }>("/enrich", "POST", {
        declaration_id: input.declarationId,
        trader_name: input.traderName,
        shipper_name: input.shipperName,
        consignee_name: input.consigneeName,
        origin_country: input.originCountry,
        destination_country: input.destinationCountry,
        transshipment_ports: input.transshipmentPorts,
        hs_code: input.hsCode,
        declared_value_usd: input.declaredValueUsd,
      });
    }),

  lookupThreatActor: protectedProcedure
    .input(z.object({ country: z.string().optional() }))
    .query(async ({ input }) => {
      const path = input.country ? `/threat-actors?country=${input.country}` : "/threat-actors";
      return callOpenCTI<unknown[]>(path);
    }),

  checkSanctions: protectedProcedure
    .input(z.object({ entityName: z.string(), country: z.string().optional() }))
    .mutation(async ({ input }) => {
      return callOpenCTI<{
        entity_name: string;
        hits: unknown[];
        is_sanctioned: boolean;
      }>("/sanctions/check", "POST", { entity_name: input.entityName, country: input.country });
    }),

  getCountryRisk: protectedProcedure
    .input(z.object({ countryCode: z.string() }))
    .query(async ({ input }) => {
      return callOpenCTI<{
        country: string;
        score: number;
        level: string;
        factors: string[];
        sources: string[];
      }>(`/country-risk/${input.countryCode}`);
    }),

  getTTPs: protectedProcedure.query(async () => {
    return callOpenCTI<Array<{ id: string; name: string; tactic: string; description: string }>>("/ttps");
  }),
});
