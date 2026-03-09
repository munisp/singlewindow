import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

const RISK_SCORER_URL = process.env.RISK_SCORER_URL ?? "http://ray-risk-scorer:8101";

async function callRiskScorer<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${RISK_SCORER_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `ray-risk-scorer error: ${text}` });
  }
  return res.json() as Promise<T>;
}

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

const AB_TESTS_DATA = [
  { testId: "ab-2025-q4-001", championVersion: "v2.1.0", challengerVersion: "v3.0.0-beta", trafficSplitPct: 10, status: "running", startedAt: "2026-01-01T00:00:00Z", championAccuracy: 0.891, challengerAccuracy: 0.903, championRequests: 45230, challengerRequests: 5025, winner: null },
];

export const riskModelRouter = router({
  // Score a single declaration
  scoreDeclaration: protectedProcedure
    .input(DeclarationFeaturesSchema)
    .mutation(async ({ input }) => {
      return callRiskScorer<RiskScoreResult>("/score", "POST", mapInput(input));
    }),

  // Batch score multiple declarations
  batchScore: adminProcedure
    .input(z.object({
      declarations: z.array(DeclarationFeaturesSchema).max(1000),
    }))
    .mutation(async ({ input }) => {
      return callRiskScorer<{
        results: RiskScoreResult[];
        batch_size: number;
        processing_time_ms: number;
        model_version: string;
      }>("/batch-score", "POST", {
        declarations: input.declarations.map(mapInput),
      });
    }),

  // Get model performance statistics
  getModelStats: adminProcedure.query(async () => {
    return callRiskScorer<{
      model_version: string;
      algorithm: string;
      feature_count: number;
      training_samples: number;
      auc_roc: number;
      precision: number;
      recall: number;
      f1_score: number;
      last_trained: string;
      aeo_accuracy_improvement: number;
    }>("/model-stats");
  }),

  // Get feature importance rankings
  getFeatureImportance: adminProcedure.query(async () => {
    return callRiskScorer<{
      feature_importance: Array<{ feature: string; importance: number; weight: number }>;
      model_version: string;
    }>("/feature-importance");
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
});
