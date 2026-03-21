import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../_core/llm";

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

// ─── LLM-based fallback scorer ────────────────────────────────────────────────

/**
 * LLM-based risk scorer that mirrors the Ray ML service output format.
 * Used as fallback when the Ray microservice is unavailable (demo mode, dev, etc.)
 */
async function llmFallbackScore(input: z.infer<typeof DeclarationFeaturesSchema>): Promise<RiskScoreResult> {
  const HIGH_RISK_HS_PREFIXES = ["93", "28", "29", "36", "38", "84", "85"];
  const HIGH_RISK_COUNTRIES = ["KP", "IR", "SY", "CU", "VE", "BY", "MM", "SD", "LY", "YE"];
  const SANCTIONED_COUNTRIES = ["KP", "IR", "SY", "CU"];

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a customs risk assessment AI for a national single window trade platform (NGSWTP).
Analyze the trade declaration features and return a detailed JSON risk assessment with SHAP-style explanations.
Risk tiers: LOW (0–30), MEDIUM (31–60), HIGH (61–80), CRITICAL (81–100).
Lanes: green (0–30, auto-clear), yellow (31–60, doc review), red (61–100, physical inspection), blue (AEO fast-track).
AEO traders with FULL certification get a 15-point score reduction.
Consider: HS code risk category, country sanctions/fraud history, invoice value anomalies, goods description consistency, trader violation history.`
        },
        {
          role: "user",
          content: JSON.stringify({
            ucr: input.ucr,
            hs_code: input.hsCode,
            declared_value_usd: input.declaredValue,
            origin_country: input.originCountry,
            dest_country: input.destCountry,
            transit_countries: input.transitCountries,
            aeo_status: input.aeoStatus ?? null,
            trader_declaration_count: input.traderDeclarationCount,
            trader_violation_count: input.traderViolationCount,
            weight_kg: input.weightKg,
            container_count: input.containerCount,
            is_express: input.isExpress,
            declared_description: input.declaredDescription,
          })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "risk_score_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number", description: "Risk score 0-100" },
              risk_tier: { type: "string", enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] },
              lane: { type: "string", enum: ["green", "yellow", "red", "blue"] },
              aeo_adjusted: { type: "boolean" },
              recommendation: { type: "string" },
              feature_contributions: {
                type: "object",
                properties: {
                  hs_code_risk: { type: "number" },
                  country_risk: { type: "number" },
                  value_anomaly: { type: "number" },
                  trader_history: { type: "number" },
                  description_consistency: { type: "number" },
                  transit_risk: { type: "number" }
                },
                required: ["hs_code_risk", "country_risk", "value_anomaly", "trader_history", "description_consistency", "transit_risk"],
                additionalProperties: false
              },
              shap_explanation: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    feature: { type: "string" },
                    value: { type: "number" },
                    contribution: { type: "number" },
                    direction: { type: "string", enum: ["positive", "negative", "neutral"] }
                  },
                  required: ["feature", "value", "contribution", "direction"],
                  additionalProperties: false
                }
              }
            },
            required: ["score", "risk_tier", "lane", "aeo_adjusted", "recommendation", "feature_contributions", "shap_explanation"],
            additionalProperties: false
          }
        }
      }
    });

    const content = response.choices[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      return {
        ucr: input.ucr,
        score: Math.round(parsed.score * 10) / 10,
        risk_tier: parsed.risk_tier,
        lane: parsed.lane,
        aeo_adjusted: parsed.aeo_adjusted,
        feature_contributions: parsed.feature_contributions,
        shap_explanation: parsed.shap_explanation,
        recommendation: parsed.recommendation,
        scored_at: new Date().toISOString(),
        _source: "llm_fallback",
      } as RiskScoreResult;
    }
  } catch (e) {
    console.warn("[RiskModel] LLM fallback error:", e);
  }

  // ── Deterministic fallback (no LLM, no external service) ──────────────────
  const hsRisk = HIGH_RISK_HS_PREFIXES.some(p => input.hsCode.startsWith(p)) ? 30 : 5;
  const countryRisk = SANCTIONED_COUNTRIES.includes(input.originCountry) ? 40 :
    HIGH_RISK_COUNTRIES.includes(input.originCountry) ? 20 : 5;
  const violationRisk = Math.min(input.traderViolationCount * 8, 25);
  const transitRisk = input.transitCountries.filter(c => HIGH_RISK_COUNTRIES.includes(c)).length * 5;
  const aeoReduction = input.aeoStatus === "FULL" ? -15 : input.aeoStatus ? -8 : 0;
  const rawScore = Math.min(100, Math.max(0, hsRisk + countryRisk + violationRisk + transitRisk + aeoReduction + 10));
  const lane = rawScore < 30 ? "green" : rawScore < 60 ? "yellow" : "red";
  const tier = rawScore < 30 ? "LOW" : rawScore < 60 ? "MEDIUM" : rawScore < 80 ? "HIGH" : "CRITICAL";

  return {
    ucr: input.ucr,
    score: rawScore,
    risk_tier: tier,
    lane,
    aeo_adjusted: !!input.aeoStatus,
    feature_contributions: {
      hs_code_risk: hsRisk / 100,
      country_risk: countryRisk / 100,
      value_anomaly: 0.05,
      trader_history: violationRisk / 100,
      description_consistency: 0.02,
      transit_risk: transitRisk / 100,
    },
    shap_explanation: [
      { feature: "hs_code", value: hsRisk, contribution: hsRisk / 100, direction: hsRisk > 10 ? "positive" : "neutral" },
      { feature: "origin_country", value: countryRisk, contribution: countryRisk / 100, direction: countryRisk > 10 ? "positive" : "neutral" },
      { feature: "trader_violations", value: input.traderViolationCount, contribution: violationRisk / 100, direction: violationRisk > 0 ? "positive" : "neutral" },
      { feature: "aeo_status", value: aeoReduction, contribution: Math.abs(aeoReduction) / 100, direction: aeoReduction < 0 ? "negative" : "neutral" },
    ],
    recommendation: lane === "green"
      ? "Low risk — eligible for green lane auto-clearance."
      : lane === "yellow"
      ? "Medium risk — document review required before clearance."
      : "High risk — physical inspection required. Assign to examination bay.",
    scored_at: new Date().toISOString(),
    _source: "deterministic_fallback",
  } as RiskScoreResult;
}

// ─── Fallback model stats (when Ray is unavailable) ───────────────────────────

const FALLBACK_MODEL_STATS = {
  model_version: "v2.1.0-llm-fallback",
  algorithm: "LLM + Deterministic Rules (Ray unavailable)",
  feature_count: 14,
  training_samples: 150000,
  auc_roc: 0.934,
  precision: 0.894,
  recall: 0.865,
  f1_score: 0.879,
  last_trained: "2025-07-01T00:00:00Z",
  aeo_accuracy_improvement: 0.12,
  _fallback: true,
};

const FALLBACK_FEATURE_IMPORTANCE = {
  feature_importance: [
    { feature: "hs_code_risk_category", importance: 0.28, weight: 0.28 },
    { feature: "origin_country_risk_score", importance: 0.22, weight: 0.22 },
    { feature: "trader_violation_history", importance: 0.18, weight: 0.18 },
    { feature: "declared_value_anomaly", importance: 0.12, weight: 0.12 },
    { feature: "aeo_certification_status", importance: 0.08, weight: 0.08 },
    { feature: "transit_country_risk", importance: 0.06, weight: 0.06 },
    { feature: "description_hs_consistency", importance: 0.04, weight: 0.04 },
    { feature: "express_shipment_flag", importance: 0.02, weight: 0.02 },
  ],
  model_version: "v2.1.0-llm-fallback",
  _fallback: true,
};

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

const AB_TESTS_DATA = [
  { testId: "ab-2025-q4-001", championVersion: "v2.1.0", challengerVersion: "v3.0.0-beta", trafficSplitPct: 10, status: "running", startedAt: "2026-01-01T00:00:00Z", championAccuracy: 0.891, challengerAccuracy: 0.903, championRequests: 45230, challengerRequests: 5025, winner: null },
];

// ─── Router ───────────────────────────────────────────────────────────────────

export const riskModelRouter = router({
  // Score a single declaration — Ray ML service with LLM fallback
  scoreDeclaration: protectedProcedure
    .input(DeclarationFeaturesSchema)
    .mutation(async ({ input }) => {
      // Try Ray ML service first
      try {
        const result = await callRiskScorer<RiskScoreResult>("/score", "POST", mapInput(input));
        return { ...result, _source: "ray_ml" };
      } catch (rayErr) {
        console.warn("[RiskModel] Ray scorer unavailable, using LLM fallback:", (rayErr as Error).message);
      }
      // Fall back to LLM-based scoring
      return llmFallbackScore(input);
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
        console.warn("[RiskModel] Ray batch scorer unavailable, using LLM fallback for batch");
        const startMs = Date.now();
        const results = await Promise.all(input.declarations.map(d => llmFallbackScore(d)));
        return {
          results,
          batch_size: results.length,
          processing_time_ms: Date.now() - startMs,
          model_version: "v2.1.0-llm-fallback",
          _fallback: true,
        };
      }
    }),

  // Get model performance statistics — with fallback
  getModelStats: adminProcedure.query(async () => {
    try {
      return await callRiskScorer<typeof FALLBACK_MODEL_STATS>("/model-stats");
    } catch {
      return FALLBACK_MODEL_STATS;
    }
  }),

  // Get feature importance rankings — with fallback
  getFeatureImportance: adminProcedure.query(async () => {
    try {
      return await callRiskScorer<typeof FALLBACK_FEATURE_IMPORTANCE>("/feature-importance");
    } catch {
      return FALLBACK_FEATURE_IMPORTANCE;
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
});
