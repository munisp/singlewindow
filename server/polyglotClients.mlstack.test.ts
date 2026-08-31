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
  scoreDeclarationFraudWithMlStack,
  scoreDeclarationRiskComposite,
  ScorerUnavailableError,
  type RiskScoreRequest,
} from "./_core/polyglotClients";

const BASE_REQ: RiskScoreRequest = {
  declarationId: "decl-1",
  traderId: "trader-1",
  declarationType: "IMPORT",
  countryOfOrigin: "KP",
  countryOfDestination: "",
  totalValue: 1_000_000,
  totalWeight: 100,
  totalDuty: 0,
  numberOfPackages: 10,
  items: [{ hsCode: "9301", description: "arms", quantity: 1, unitValue: 1_000_000 }],
  documents: [],
  traderHistory: { totalDeclarations: 100, rejectionRate: 0.5, amendmentRate: 0, isAEO: true, monthsActive: 12 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("buildDeclarationFraudFeatures", () => {
  it("builds the ordered 10-feature contract", () => {
    const f = buildDeclarationFraudFeatures(BASE_REQ);
    expect(f).toHaveLength(10);
    expect(f[1]).toBe(0.9); // high-risk HS chapter 93
    expect(f[2]).toBe(0.85); // high-risk origin KP
    expect(f[4]).toBe(0.5); // trader rejection rate
    expect(f[6]).toBe(1); // AEO
    expect(f[9]).toBe(1); // controlled goods
  });

  it("handles empty/defaults deterministically", () => {
    const f = buildDeclarationFraudFeatures({
      ...BASE_REQ,
      countryOfOrigin: "",
      totalValue: 0,
      totalWeight: 0,
      items: [],
      traderHistory: { totalDeclarations: 0, rejectionRate: 0, amendmentRate: 0, isAEO: false, monthsActive: 0 },
    });
    expect(f[0]).toBe(0);
    expect(f[1]).toBe(0.2);
    expect(f[2]).toBe(0.15);
    expect(f[9]).toBe(0);
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
    const r = await scoreDeclarationFraudWithMlStack(BASE_REQ);
    expect(r.score).toBe(0.87);
    expect(r.modelVersion).toBe("0.1.0");
    const call = (fetch as any).mock.calls[0];
    expect(call[0]).toContain("/score/declaration-fraud");
    const body = JSON.parse(call[1].body);
    expect(body.entity_id).toBe("decl-1");
    expect(body.features).toHaveLength(10);
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
    const r = await scoreDeclarationRiskComposite(BASE_REQ);
    expect(r.combinedScore).toBe(0.9); // max(0.2, 0.9)
    expect(r.lane).toBe("RED");
    expect(Object.keys(r.scorers)).toEqual(["ai-risk-scorer", "ml-stack"]);
  });

  it("aborts fail-closed when ml-stack is down", async () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,ml-stack";
    stubBothScorers({ status: "SCORING_UNAVAILABLE", score: null, detail: "no model" });
    await expect(scoreDeclarationRiskComposite(BASE_REQ)).rejects.toThrow(ScorerUnavailableError);
  });

  it("aborts fail-closed when ai-risk-scorer is down", async () => {
    process.env.RISK_SCORER_PIPELINE = "ai-risk-scorer,ml-stack";
    stubBothScorers({ status: "OK", score: 0.1, model_name: "m", model_version: "1", mode: "ml", latency_ms: 1 }, false);
    await expect(scoreDeclarationRiskComposite(BASE_REQ)).rejects.toThrow(ScorerUnavailableError);
  });
});
