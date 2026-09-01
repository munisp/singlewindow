/**
 * polyglotClients.mlstack.test.ts — ml-stack scorer client + composite pipeline
 *
 * Covers:
 *  - buildDeclarationFraudFeatures feature contract (10 ordered features)
 *  - scoreDeclarationFraudWithMlStack fail-closed behaviour (transport error,
 *    HTTP error, SCORING_UNAVAILABLE -> ScorerUnavailableError)
 *  - configuredRiskScorers parsing incl. unknown-scorer rejection
 *  - scoreDeclarationRiskComposite: both-scorer composition, conservative max,
 *    lane thresholds, and fail-closed abort when any configured scorer is down
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildDeclarationFraudFeatures,
  configuredRiskScorers,
  ML_STACK_FEATURE_NAMES,
  scoreDeclarationFraudWithMlStack,
  scoreDeclarationRiskComposite,
  ScorerUnavailableError,
  type MlStackFeatureEnrichment,
  type RiskScoreRequest,
} from "./_core/polyglotClients";

const BASE_REQ: RiskScoreRequest = {
  declarationId: "decl-1",
  traderId: "trader-1",
  declarationType: "IMPORT",
  countryOfOrigin: "CN",
  countryOfDestination: "",
  totalValue: 1_000_000,
  totalWeight: 100,
  totalDuty: 200_000,
  numberOfPackages: 10,
  items: [{ hsCode: "9301", description: "arms", quantity: 1, unitValue: 1_000_000 }],
  documents: [],
  traderHistory: { totalDeclarations: 100, rejectionRate: 0.5, amendmentRate: 0, isAEO: true, monthsActive: 12 },
};

/** Real source data for the features the request contract does not carry. */
const BASE_ENRICHMENT: MlStackFeatureEnrichment = {
  referenceUnitPriceUsdPerKg: 5_000,
  consigneeIsShell: false,
  filedAt: "2025-01-01T03:00:00Z", // night filing
  assessedHsCode: "9301",
  portCode: "NGAPP",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildDeclarationFraudFeatures (ml-stack 11-feature contract)", () => {
  // Contract pin: this is the exact ordered feature list of the deployed
  // model. SOURCE OF TRUTH: blueeconomy-ml-stack
  // synthetic/declarations.py FEATURE_COLUMNS (lines 163-168) and
  // models/MODEL_CARDS.md (declaration-fraud-mlp 0.1.0, "11 features").
  // If the ml-stack schema changes, change it THERE first, then update this
  // fixture and the builder together.
  const EXPECTED_FEATURES_FROM_ML_STACK = [
    "price_ratio_vs_reference",
    "log_cif_usd",
    "duty_rate_applied",
    "log_weight_kg",
    "consignee_is_shell",
    "declarant_is_established",
    "declarant_prior_declarations",
    "night_filing",
    "hs_mismatch",
    "port_enc",
    "origin_enc",
  ];

  it("pins feature count, names and order against the ml-stack schema", () => {
    expect(ML_STACK_FEATURE_NAMES).toEqual(EXPECTED_FEATURES_FROM_ML_STACK);
    expect(ML_STACK_FEATURE_NAMES).toHaveLength(11);
  });

  it("builds the ordered 11-feature vector from real data", () => {
    const f = buildDeclarationFraudFeatures(BASE_REQ, BASE_ENRICHMENT);
    expect(f).toHaveLength(11);
    // price_ratio_vs_reference = (1_000_000/100) / 5_000 = 2
    expect(f[0]).toBeCloseTo(2, 6);
    // log_cif_usd = log1p(1_000_000)
    expect(f[1]).toBeCloseTo(Math.log1p(1_000_000), 6);
    // duty_rate_applied = 200_000 / 1_000_000
    expect(f[2]).toBeCloseTo(0.2, 6);
    // log_weight_kg = log1p(100)
    expect(f[3]).toBeCloseTo(Math.log1p(100), 6);
    expect(f[4]).toBe(0); // consignee_is_shell
    expect(f[5]).toBe(1); // declarant_is_established (monthsActive 12)
    expect(f[6]).toBe(100); // declarant_prior_declarations
    expect(f[7]).toBe(1); // night_filing (03:00 UTC)
    expect(f[8]).toBe(0); // hs_mismatch (declared == assessed)
    expect(f[9]).toBe(0); // port_enc: NGAPP is index 0 in ml-stack PORTS
    expect(f[10]).toBe(0); // origin_enc: CN is index 0 in ml-stack ORIGINS
  });

  it("detects hs_mismatch and day filing honestly", () => {
    const f = buildDeclarationFraudFeatures(BASE_REQ, {
      ...BASE_ENRICHMENT,
      assessedHsCode: "8471",
      filedAt: "2025-01-01T12:00:00Z",
      consigneeIsShell: true,
      portCode: "NGTIN",
    });
    expect(f[4]).toBe(1); // shell consignee
    expect(f[7]).toBe(0); // day filing
    expect(f[8]).toBe(1); // hs mismatch
    expect(f[9]).toBe(1); // NGTIN index 1
  });

  it("fails closed when feature source data is missing (never fabricates)", () => {
    expect(() => buildDeclarationFraudFeatures(BASE_REQ)).toThrow(ScorerUnavailableError);
    expect(() => buildDeclarationFraudFeatures(BASE_REQ)).toThrow(
      /price_ratio_vs_reference.*consignee_is_shell.*night_filing.*hs_mismatch.*port_enc/s
    );
  });

  it("fails closed on origins/ports the model has no trained encoding for", () => {
    expect(() =>
      buildDeclarationFraudFeatures({ ...BASE_REQ, countryOfOrigin: "KP" }, BASE_ENRICHMENT)
    ).toThrow(/origin_enc/);
    expect(() =>
      buildDeclarationFraudFeatures(BASE_REQ, { ...BASE_ENRICHMENT, portCode: "USNYC" })
    ).toThrow(/port_enc/);
  });

  it("fails closed on zero value/weight instead of dividing by zero", () => {
    expect(() =>
      buildDeclarationFraudFeatures(
        { ...BASE_REQ, totalValue: 0, totalWeight: 0 },
        BASE_ENRICHMENT
      )
    ).toThrow(/log_cif_usd.*log_weight_kg/s);
  });
});

describe("scoreDeclarationFraudWithMlStack (fail-closed)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("returns the mapped result on OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      status: "OK", score: 0.87, model_name: "declaration-fraud",
      model_version: "0.1.0", mode: "ml", latency_ms: 3.2,
    })));
    const r = await scoreDeclarationFraudWithMlStack(BASE_REQ, BASE_ENRICHMENT);
    expect(r.score).toBe(0.87);
    expect(r.modelVersion).toBe("0.1.0");
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toContain("/score/declaration-fraud");
    const body = JSON.parse(call[1].body);
    expect(body.entity_id).toBe("decl-1");
    expect(body.features).toHaveLength(11);
  });

  it("fails closed before any network call when feature data is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(scoreDeclarationFraudWithMlStack(BASE_REQ)).rejects.toThrow(
      ScorerUnavailableError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on SCORING_UNAVAILABLE (never fabricates)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      status: "SCORING_UNAVAILABLE", score: null, detail: "missing model file",
    })));
    await expect(scoreDeclarationFraudWithMlStack(BASE_REQ)).rejects.toThrow(ScorerUnavailableError);
  });

  it("throws on transport failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(scoreDeclarationFraudWithMlStack(BASE_REQ)).rejects.toThrow(/SCORER_UNAVAILABLE: ml-stack/);
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(scoreDeclarationFraudWithMlStack(BASE_REQ)).rejects.toThrow(ScorerUnavailableError);
  });
});

describe("configuredRiskScorers", () => {
  afterEach(() => { delete process.env.RISK_SCORER_PIPELINE; });

  it("defaults to ai-risk-scorer only", () => {
    delete process.env.RISK_SCORER_PIPELINE;
    expect(configuredRiskScorers()).toEqual(["ai-risk-scorer"]);
  });

  it("parses multi-scorer pipelines", () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer, ml-stack";
    expect(configuredRiskScorers()).toEqual(["ai-risk-scorer", "ml-stack"]);
  });

  it("rejects unknown scorers fail-closed", () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,random-llm";
    expect(() => configuredRiskScorers()).toThrow(ScorerUnavailableError);
  });
});

describe("scoreDeclarationRiskComposite", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RISK_SCORER_PIPELINE;
  });

  function stubBothScorers(mlStackBody: unknown, aiRiskOk = true) {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("declaration-fraud")) {
        return Promise.resolve(jsonResponse(mlStackBody));
      }
      if (!aiRiskOk) return Promise.reject(new Error("down"));
      return Promise.resolve(jsonResponse({
        declaration_id: "decl-1", risk_score: 20, ml_score: 20, rule_score: 20,
        anomaly_score: 0, lane: "GREEN", triggered_rules: [], shap_explanation: null,
        model_version: 7, scored_at: "t", processing_ms: 5,
      }));
    }));
  }

  it("composes both scorers with conservative max and RED lane", async () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,ml-stack";
    stubBothScorers({ status: "OK", score: 0.9, model_name: "declaration-fraud", model_version: "0.1.0", mode: "ml", latency_ms: 2 });
    const r = await scoreDeclarationRiskComposite(BASE_REQ, BASE_ENRICHMENT);
    expect(r.combinedScore).toBe(0.9); // max(0.2, 0.9)
    expect(r.lane).toBe("RED");
    expect(Object.keys(r.scorers)).toEqual(["ai-risk-scorer", "ml-stack"]);
  });

  it("aborts fail-closed when ml-stack is down", async () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,ml-stack";
    stubBothScorers({ status: "SCORING_UNAVAILABLE", score: null, detail: "no model" });
    await expect(scoreDeclarationRiskComposite(BASE_REQ, BASE_ENRICHMENT)).rejects.toThrow(ScorerUnavailableError);
  });

  it("aborts fail-closed when ai-risk-scorer is down", async () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,ml-stack";
    stubBothScorers({ status: "OK", score: 0.1, model_name: "m", model_version: "1", mode: "ml", latency_ms: 1 }, false);
    await expect(scoreDeclarationRiskComposite(BASE_REQ, BASE_ENRICHMENT)).rejects.toThrow(ScorerUnavailableError);
  });
});
