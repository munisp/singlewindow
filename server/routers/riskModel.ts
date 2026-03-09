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
});
