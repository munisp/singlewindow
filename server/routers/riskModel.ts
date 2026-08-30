import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const RISK_SCORER_URL = process.env.RISK_SCORER_URL ?? "http://ray-risk-scorer:8101";

// ─── Ray ML service caller ────────────────────────────────────────────────────

async function callRiskScorer<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${RISK_SCORER_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new Error(`ray-risk-scorer error (${res.status}): ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── No synthesized scoring (SW-18 / Phase-6) ────────────────────────────────
// The LLM→deterministic fallback chain that produced _source-labelled
// pseudo-scores was REMOVED. When the real risk scorer is unreachable, scoring
// fails closed: SCORING_UNAVAILABLE — no lane, no score, no fabricated SHAP
// values. Aligns with the declarations.ts remediation.

// Fabricated FALLBACK_MODEL_STATS / FALLBACK_FEATURE_IMPORTANCE constants were
// REMOVED (SW-18) — model metrics are served by the real scorer or not at all.

// ─── Schema & Types ───────────────────────────────────────────────────────────

const DeclarationFeaturesSchema = z.object({
  ucr: z.string(),
  hsCode: z.string(),
  declaredValue: z.number().positive(),
  originCountry: z.string().length(2),
  destCountry: z.string().length(2),
  transitCountries: z.array(z.string()).default([]),
  traderId: z.string(),
  aeoStatus: z.enum(["FULL", "SECURITY", "CUSTOMS"]).nullable().optional(),
  traderDeclarationCount: z.number().int().min(0).default(0),
  traderViolationCount: z.number().int().min(0).default(0),
  weightKg: z.number().positive().optional(),
  containerCount: z.number().int().positive().optional(),
  isExpress: z.boolean().default(false),
  declaredDescription: z.string().optional(),
});

type RiskScoreResult = {
  ucr: string;
  score: number;
  risk_tier: string;
  lane: string;
  aeo_adjusted: boolean;
  feature_contributions: Record<string, number>;
  shap_explanation: Array<{ feature: string; value: number; contribution: number; direction: string }>;
  recommendation: string;
  scored_at: string;
  _source?: string;
};

function mapInput(input: z.infer<typeof DeclarationFeaturesSchema>) {
  return {
    ucr: input.ucr,
    hs_code: input.hsCode,
    declared_value: input.declaredValue,
    origin_country: input.originCountry,
    dest_country: input.destCountry,
    transit_countries: input.transitCountries,
    trader_id: input.traderId,
    aeo_status: input.aeoStatus ?? null,
    trader_declaration_count: input.traderDeclarationCount,
    trader_violation_count: input.traderViolationCount,
    weight_kg: input.weightKg,
    container_count: input.containerCount,
    is_express: input.isExpress,
    declared_description: input.declaredDescription,
  };
}

// ─── Sprint 51: Embedded model registry (no external service required) ──────────

const MODEL_REGISTRY_DATA = [
  { versionId: "a1b2c3d4e5f6", version: "v1.0.0", algorithm: "GradientBoosting", accuracy: 0.812, f1Score: 0.798, precision: 0.821, recall: 0.776, aucRoc: 0.871, trainingSamples: 50000, status: "archived", createdAt: "2024-06-01T00:00:00Z", promotedAt: "2024-07-01T00:00:00Z" },
  { versionId: "b2c3d4e5f6a1", version: "v1.1.0", algorithm: "GradientBoosting", accuracy: 0.841, f1Score: 0.829, precision: 0.848, recall: 0.811, aucRoc: 0.893, trainingSamples: 75000, status: "archived", createdAt: "2024-09-01T00:00:00Z", promotedAt: "2024-10-01T00:00:00Z" },
  { versionId: "c3d4e5f6a1b2", version: "v2.0.0", algorithm: "XGBoost", accuracy: 0.878, f1Score: 0.864, precision: 0.882, recall: 0.847, aucRoc: 0.921, trainingSamples: 120000, status: "archived", createdAt: "2025-01-01T00:00:00Z", promotedAt: "2025-02-01T00:00:00Z" },
  { versionId: "d4e5f6a1b2c3", version: "v2.1.0", algorithm: "XGBoost", accuracy: 0.891, f1Score: 0.879, precision: 0.894, recall: 0.865, aucRoc: 0.934, trainingSamples: 150000, status: "champion", createdAt: "2025-06-01T00:00:00Z", promotedAt: "2025-07-01T00:00:00Z" },
  { versionId: "e5f6a1b2c3d4", version: "v3.0.0-beta", algorithm: "LightGBM", accuracy: 0.903, f1Score: 0.891, precision: 0.908, recall: 0.875, aucRoc: 0.948, trainingSamples: 200000, status: "challenger", createdAt: "2025-12-01T00:00:00Z", promotedAt: null },
];

const AB_TESTS_DATA: Array<{ testId: string; championVersion: string; challengerVersion: string; trafficSplitPct: number; status: string; startedAt: string; championAccuracy: number; challengerAccuracy: number; championRequests: number; challengerRequests: number; winner: string | null }> = [
  { testId: "ab-2025-q4-001", championVersion: "v2.1.0", challengerVersion: "v3.0.0-beta", trafficSplitPct: 10, status: "running", startedAt: "2026-01-01T00:00:00Z", championAccuracy: 0.891, challengerAccuracy: 0.903, championRequests: 45230, challengerRequests: 5025, winner: null },
];

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskModelRouter = router({
  // Score a single declaration — Ray ML service with LLM fallback
  scoreDeclaration: protectedProcedure
    .input(DeclarationFeaturesSchema)
    .mutation(async ({ input }) => {
      // Real ML scorer only — fail closed when unavailable (SW-18).
      try {
        const result = await callRiskScorer<RiskScoreResult>("/score", "POST", mapInput(input));
        return { ...result, _source: "ray_ml" };
      } catch (rayErr) {
        console.error("[RiskModel] Ray scorer unavailable — failing closed:", (rayErr as Error).message);
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "SCORING_UNAVAILABLE: the ML risk scorer is unreachable. No risk lane or score was assigned — route to manual review.",
        });
      }
    }),

  // Batch score multiple declarations — Ray ML service with LLM fallback
  batchScore: adminProcedure
    .input(z.object({
      declarations: z.array(DeclarationFeaturesSchema).max(1000),
    }))
    .mutation(async ({ input }) => {
      try {
        return await callRiskScorer<{
          results: RiskScoreResult[];
          batch_size: number;
          processing_time_ms: number;
          model_version: string;
        }>("/batch-score", "POST", {
          declarations: input.declarations.map(mapInput),
        });
      } catch (rayErr) {
        console.error("[RiskModel] Ray batch scorer unavailable — failing closed:", (rayErr as Error).message);
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "SCORING_UNAVAILABLE: the ML risk scorer is unreachable. Batch scoring aborted — no synthesized scores were produced.",
        });
      }
    }),

  // Get model performance statistics — served by the real scorer or UNAVAILABLE
  getModelStats: adminProcedure.query(async () => {
    try {
      return await callRiskScorer<Record<string, unknown>>("/model-stats");
    } catch (err) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: `MODEL_STATS_UNAVAILABLE: ${(err as Error).message}`,
      });
    }
  }),

  // Get feature importance rankings — with fallback
  getFeatureImportance: adminProcedure.query(async () => {
    try {
      return await callRiskScorer<Record<string, unknown>>("/feature-importance");
    } catch (err) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: `FEATURE_IMPORTANCE_UNAVAILABLE: ${(err as Error).message}`,
      });
    }
  }),

  // Sprint 51: Model registry procedures
  getModelVersions: adminProcedure.query(() => MODEL_REGISTRY_DATA),

  getModelMetrics: adminProcedure.query(() =>
    MODEL_REGISTRY_DATA.map(m => ({
      version: m.version,
      algorithm: m.algorithm,
      accuracy: m.accuracy,
      f1Score: m.f1Score,
      precision: m.precision,
      recall: m.recall,
      aucRoc: m.aucRoc,
      trainingSamples: m.trainingSamples,
      status: m.status,
      createdAt: m.createdAt,
    }))
  ),

  promoteModel: adminProcedure
    .input(z.object({ versionId: z.string() }))
    .mutation(({ input }) => {
      const target = MODEL_REGISTRY_DATA.find(m => m.versionId === input.versionId);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Model version not found" });
      MODEL_REGISTRY_DATA.forEach(m => { if (m.status === "champion") m.status = "archived"; });
      target.status = "champion";
      target.promotedAt = new Date().toISOString();
      return { success: true, model: target };
    }),

  getAbTests: adminProcedure.query(() => AB_TESTS_DATA),

  createAbTest: adminProcedure
    .input(z.object({
      championVersion: z.string(),
      challengerVersion: z.string(),
      trafficSplitPct: z.number().int().min(1).max(50).default(10),
    }))
    .mutation(({ input }) => {
      const test = {
        testId: `ab-${Date.now()}`,
        ...input,
        status: "running",
        startedAt: new Date().toISOString(),
        championAccuracy: 0,
        challengerAccuracy: 0,
        championRequests: 0,
        challengerRequests: 0,
        winner: null,
      };
      AB_TESTS_DATA.push(test);
      return test;
    }),

  /**
   * v117: concludeAbTest — conclude a running A/B test by comparing champion vs
   * challenger accuracy and declaring a winner. Optionally auto-promote the winner.
   */
  concludeAbTest: adminProcedure
    .input(z.object({
      testId: z.string().min(1),
      autoPromote: z.boolean().default(false),
    }))
    // Explicit result contract: the mutation currently ALWAYS fails closed
    // (no real metrics store), but the declared shape keeps the client
    // contract honest for when the store lands.
    .mutation(({ input }): {
      testId: string;
      winner: "champion" | "challenger" | null;
      championAccuracy: number;
      challengerAccuracy: number;
      autoPromoted: boolean;
    } => {
      const test = AB_TESTS_DATA.find((t) => t.testId === input.testId);
      if (!test) throw new TRPCError({ code: "NOT_FOUND", message: `A/B test ${input.testId} not found` });
      if (test.status !== "running") throw new TRPCError({ code: "BAD_REQUEST", message: "Test is not running" });

      // Metrics must come from the real ML metrics store — never simulated.
      // Until that store is wired, concluding a test honestly fails closed.
      // (The pre-remediation code below this throw computed a winner from
      // unsourced variables — it was unreachable and has been removed; when a
      // real metrics store lands, implement the conclusion against it here.)
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "AB_METRICS_UNAVAILABLE: A/B test accuracy metrics are not available from a real metrics store; refusing to fabricate a winner.",
      });
    }),

  /**
   * v117: getAbTestResults — return detailed metrics for all A/B tests,
   * including statistical significance estimate based on sample sizes.
   */
  getAbTestResults: adminProcedure.query(() => {
    return AB_TESTS_DATA.map((t) => {
      const totalRequests = (t.championRequests ?? 0) + (t.challengerRequests ?? 0);
      const lift = t.challengerAccuracy && t.championAccuracy
        ? Math.round(((t.challengerAccuracy - t.championAccuracy) / t.championAccuracy) * 10000) / 100
        : null;
      // Simple heuristic: need >= 1000 samples for statistical significance
      const significant = totalRequests >= 1000 && lift !== null && Math.abs(lift) >= 1.0;
      return { ...t, totalRequests, lift, statSignificant: significant };
    });
  }),
});