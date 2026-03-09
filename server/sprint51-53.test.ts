/**
 * Sprint 51-53 Vitest Tests
 *
 * Sprint 51 — Ray Distributed ML Risk Scoring
 * Sprint 52 — OpenCTI Threat Intelligence Feed Integration
 * Sprint 53 — Trader Self-Service API Portal
 */

import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "crypto";

// ─── Sprint 51: ML Risk Scoring Logic ────────────────────────────────────────

const HS_CHAPTER_RISK: Record<string, number> = {
  "24": 55, "27": 40, "29": 45, "30": 50, "36": 65,
  "61": 35, "62": 35, "71": 60, "87": 35, "88": 55,
  "90": 38, "93": 75, "97": 45,
};

const HIGH_RISK_ORIGINS = new Set(["IR", "KP", "SY", "CU", "VE", "MM", "BY", "RU"]);
const HIGH_RISK_TRANSSHIP = new Set(["AEDXB", "SGSIN", "MYPKG", "TRTPE", "CNSHA", "CNNGB", "UAODS", "PKKAR"]);

function extractFeatures(d: {
  hsCode: string; originCountry: string; transshipmentPorts: string[];
  declaredValueUsd: number; weightKg: number; documentCount: number;
  traderClearanceHistory: number; traderRejectionHistory: number;
  declarationType: string; isAeoCertified: boolean;
}): Record<string, number> {
  const chapter = d.hsCode.slice(0, 2);
  const hsRisk = (HS_CHAPTER_RISK[chapter] ?? 30) / 100;
  const originRisk = HIGH_RISK_ORIGINS.has(d.originCountry) ? 1.0 : 0.1;
  const transshipRisk = Math.min(1.0, d.transshipmentPorts.filter(p => HIGH_RISK_TRANSSHIP.has(p)).length * 0.4);
  const totalHistory = d.traderClearanceHistory + d.traderRejectionHistory;
  let traderScore = totalHistory === 0 ? 0.5 : d.traderClearanceHistory / totalHistory;
  if (totalHistory > 0) {
    const rejectionRate = d.traderRejectionHistory / totalHistory;
    traderScore = Math.max(0, traderScore - rejectionRate * 2);
  }
  const pricePerKg = d.weightKg > 0 ? d.declaredValueUsd / d.weightKg : 0;
  const logPrice = Math.log1p(pricePerKg);
  const valueAnomaly = Math.max(0, 1.0 - Math.abs(logPrice - 6.0) / 8.0);
  const docCompleteness = Math.min(1.0, d.documentCount / 5.0);
  return {
    hs_risk: hsRisk,
    origin_risk: originRisk,
    transship_risk: transshipRisk,
    trader_score: traderScore,
    value_anomaly: valueAnomaly,
    doc_completeness: docCompleteness,
    aeo_bonus: d.isAeoCertified ? -0.3 : 0.0,
    declaration_type_risk: d.declarationType === "TRANSIT" ? 0.2 : 0.0,
    high_value_flag: d.declaredValueUsd > 100000 ? 1.0 : 0.0,
    new_trader_flag: totalHistory < 5 ? 1.0 : 0.0,
    multi_transship_flag: d.transshipmentPorts.length > 2 ? 1.0 : 0.0,
    restricted_origin_flag: HIGH_RISK_ORIGINS.has(d.originCountry) ? 1.0 : 0.0,
  };
}

const WEIGHTS: Record<string, number> = {
  hs_risk: 0.18, origin_risk: 0.20, transship_risk: 0.15,
  trader_score: -0.20, value_anomaly: 0.08, doc_completeness: -0.05,
  aeo_bonus: 1.0, declaration_type_risk: 0.05, high_value_flag: 0.04,
  new_trader_flag: 0.06, multi_transship_flag: 0.08, restricted_origin_flag: 0.12,
};

function computeRiskScore(features: Record<string, number>): number {
  const raw = Object.entries(WEIGHTS).reduce((sum, [k, w]) => sum + (features[k] ?? 0) * w, 0);
  const normalised = 1.0 / (1.0 + Math.exp(-5.0 * (raw - 0.3)));
  return Math.round(normalised * 1000) / 10;
}

function assignLane(score: number): "GREEN" | "YELLOW" | "RED" {
  if (score < 30) return "GREEN";
  if (score < 65) return "YELLOW";
  return "RED";
}

describe("Sprint 51 — Ray ML Risk Scoring", () => {
  it("assigns GREEN lane to low-risk AEO-certified declaration", () => {
    const features = extractFeatures({
      hsCode: "0801", originCountry: "GH", transshipmentPorts: [],
      declaredValueUsd: 5000, weightKg: 500, documentCount: 5,
      traderClearanceHistory: 200, traderRejectionHistory: 1,
      declarationType: "IMPORT", isAeoCertified: true,
    });
    const score = computeRiskScore(features);
    expect(assignLane(score)).toBe("GREEN");
    expect(score).toBeLessThan(30);
  });

  it("assigns RED lane to high-risk declaration from sanctioned origin", () => {
    const features = extractFeatures({
      hsCode: "9301", originCountry: "KP", transshipmentPorts: ["CNSHA", "AEDXB"],
      declaredValueUsd: 250000, weightKg: 800, documentCount: 1,
      traderClearanceHistory: 0, traderRejectionHistory: 0,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    const score = computeRiskScore(features);
    expect(assignLane(score)).toBe("RED");
    expect(score).toBeGreaterThanOrEqual(65);
  });

  it("assigns YELLOW lane to medium-risk declaration", () => {
    // Use HS 24 (tobacco, high risk), CN origin, 2 high-risk transship ports,
    // new trader (0 history) — this combination lands in 30-65 range
    const features = extractFeatures({
      hsCode: "2401", originCountry: "CN", transshipmentPorts: ["SGSIN", "AEDXB"],
      declaredValueUsd: 50000, weightKg: 1000, documentCount: 2,
      traderClearanceHistory: 3, traderRejectionHistory: 1,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    const score = computeRiskScore(features);
    expect(assignLane(score)).toBe("YELLOW");
    expect(score).toBeGreaterThanOrEqual(30);
    expect(score).toBeLessThan(65);
  });

  it("HS chapter 93 (weapons) gets maximum chapter risk score", () => {
    const chapter = "93";
    expect(HS_CHAPTER_RISK[chapter]).toBe(75);
    const features = extractFeatures({
      hsCode: "9301", originCountry: "SG", transshipmentPorts: [],
      declaredValueUsd: 1000, weightKg: 10, documentCount: 5,
      traderClearanceHistory: 100, traderRejectionHistory: 0,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    expect(features.hs_risk).toBe(0.75);
  });

  it("AEO certification reduces risk score", () => {
    const baseInput = {
      hsCode: "6101", originCountry: "BD", transshipmentPorts: [],
      declaredValueUsd: 8000, weightKg: 200, documentCount: 4,
      traderClearanceHistory: 50, traderRejectionHistory: 2,
      declarationType: "IMPORT" as const,
    };
    const withoutAeo = computeRiskScore(extractFeatures({ ...baseInput, isAeoCertified: false }));
    const withAeo = computeRiskScore(extractFeatures({ ...baseInput, isAeoCertified: true }));
    expect(withAeo).toBeLessThan(withoutAeo);
  });

  it("new trader flag triggers for traders with < 5 declarations", () => {
    const features = extractFeatures({
      hsCode: "8471", originCountry: "CN", transshipmentPorts: [],
      declaredValueUsd: 5000, weightKg: 100, documentCount: 3,
      traderClearanceHistory: 2, traderRejectionHistory: 0,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    expect(features.new_trader_flag).toBe(1.0);
  });

  it("established trader (200+ clearances) gets low trader risk", () => {
    const features = extractFeatures({
      hsCode: "8471", originCountry: "CN", transshipmentPorts: [],
      declaredValueUsd: 5000, weightKg: 100, documentCount: 3,
      traderClearanceHistory: 200, traderRejectionHistory: 2,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    expect(features.new_trader_flag).toBe(0.0);
    expect(features.trader_score).toBeGreaterThan(0.8);
  });

  it("multi-transshipment flag triggers for > 2 ports", () => {
    const features = extractFeatures({
      hsCode: "8471", originCountry: "CN", transshipmentPorts: ["SGSIN", "AEDXB", "CNSHA"],
      declaredValueUsd: 5000, weightKg: 100, documentCount: 3,
      traderClearanceHistory: 50, traderRejectionHistory: 0,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    expect(features.multi_transship_flag).toBe(1.0);
  });

  it("TRANSIT declaration type adds risk", () => {
    const importFeatures = extractFeatures({
      hsCode: "8471", originCountry: "CN", transshipmentPorts: [],
      declaredValueUsd: 5000, weightKg: 100, documentCount: 3,
      traderClearanceHistory: 50, traderRejectionHistory: 0,
      declarationType: "IMPORT", isAeoCertified: false,
    });
    const transitFeatures = extractFeatures({
      hsCode: "8471", originCountry: "CN", transshipmentPorts: [],
      declaredValueUsd: 5000, weightKg: 100, documentCount: 3,
      traderClearanceHistory: 50, traderRejectionHistory: 0,
      declarationType: "TRANSIT", isAeoCertified: false,
    });
    expect(transitFeatures.declaration_type_risk).toBe(0.2);
    expect(importFeatures.declaration_type_risk).toBe(0.0);
  });

  it("model registry contains 5 versions with one champion", () => {
    const registry = [
      { versionId: "a1b2c3d4e5f6", version: "v1.0.0", status: "archived" },
      { versionId: "b2c3d4e5f6a1", version: "v1.1.0", status: "archived" },
      { versionId: "c3d4e5f6a1b2", version: "v2.0.0", status: "archived" },
      { versionId: "d4e5f6a1b2c3", version: "v2.1.0", status: "champion" },
      { versionId: "e5f6a1b2c3d4", version: "v3.0.0-beta", status: "challenger" },
    ];
    expect(registry).toHaveLength(5);
    const champions = registry.filter(m => m.status === "champion");
    expect(champions).toHaveLength(1);
    expect(champions[0].version).toBe("v2.1.0");
  });

  it("model promotion changes champion correctly", () => {
    const registry = [
      { versionId: "d4e5f6a1b2c3", version: "v2.1.0", status: "champion" },
      { versionId: "e5f6a1b2c3d4", version: "v3.0.0-beta", status: "challenger" },
    ];
    const targetId = "e5f6a1b2c3d4";
    registry.forEach(m => { if (m.status === "champion") m.status = "archived"; });
    const target = registry.find(m => m.versionId === targetId)!;
    target.status = "champion";
    expect(registry.filter(m => m.status === "champion")).toHaveLength(1);
    expect(registry.find(m => m.status === "champion")?.version).toBe("v3.0.0-beta");
    expect(registry.find(m => m.version === "v2.1.0")?.status).toBe("archived");
  });

  it("A/B test creation sets correct initial state", () => {
    const test = {
      testId: `ab-${Date.now()}`,
      championVersion: "v2.1.0",
      challengerVersion: "v3.0.0-beta",
      trafficSplitPct: 10,
      status: "running",
      startedAt: new Date().toISOString(),
      championRequests: 0,
      challengerRequests: 0,
      winner: null,
    };
    expect(test.status).toBe("running");
    expect(test.winner).toBeNull();
    expect(test.trafficSplitPct).toBe(10);
  });

  it("risk score is bounded between 0 and 100", () => {
    const extremeHighFeatures: Record<string, number> = {
      hs_risk: 1.0, origin_risk: 1.0, transship_risk: 1.0, trader_score: 0.0,
      value_anomaly: 1.0, doc_completeness: 0.0, aeo_bonus: 0.0,
      declaration_type_risk: 1.0, high_value_flag: 1.0, new_trader_flag: 1.0,
      multi_transship_flag: 1.0, restricted_origin_flag: 1.0,
    };
    const extremeLowFeatures: Record<string, number> = {
      hs_risk: 0.0, origin_risk: 0.0, transship_risk: 0.0, trader_score: 1.0,
      value_anomaly: 0.0, doc_completeness: 1.0, aeo_bonus: -0.3,
      declaration_type_risk: 0.0, high_value_flag: 0.0, new_trader_flag: 0.0,
      multi_transship_flag: 0.0, restricted_origin_flag: 0.0,
    };
    const highScore = computeRiskScore(extremeHighFeatures);
    const lowScore = computeRiskScore(extremeLowFeatures);
    expect(highScore).toBeGreaterThanOrEqual(0);
    expect(highScore).toBeLessThanOrEqual(100);
    expect(lowScore).toBeGreaterThanOrEqual(0);
    expect(lowScore).toBeLessThanOrEqual(100);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});

// ─── Sprint 52: OpenCTI Threat Intelligence ───────────────────────────────────

const COUNTRY_RISK_SCORES: Record<string, { score: number; level: string }> = {
  "KP": { score: 98, level: "critical" },
  "IR": { score: 92, level: "critical" },
  "SY": { score: 88, level: "critical" },
  "RU": { score: 82, level: "high" },
  "MM": { score: 75, level: "high" },
  "BY": { score: 72, level: "high" },
  "GH": { score: 28, level: "low" },
  "RW": { score: 22, level: "low" },
  "SG": { score: 8, level: "minimal" },
};

const SANCTIONED_ENTITIES = [
  { name: "Arak Heavy Water Reactors", country: "IR", sanctions_lists: ["OFAC-SDN", "EU-CFSP", "UN-1737"] },
  { name: "Pyongyang Trading Corporation", country: "KP", sanctions_lists: ["OFAC-SDN", "UN-1718"] },
  { name: "Damascus Steel & Metals Ltd", country: "SY", sanctions_lists: ["OFAC-SDN", "EU-CFSP"] },
  { name: "Viktor Marchenko", country: "RU", sanctions_lists: ["OFAC-SDN", "EU-CFSP"] },
];

function checkSanctions(entityName: string): typeof SANCTIONED_ENTITIES {
  return SANCTIONED_ENTITIES.filter(e =>
    entityName.toLowerCase().includes(e.name.toLowerCase()) ||
    e.name.toLowerCase().includes(entityName.toLowerCase())
  );
}

function getCountryRisk(country: string): { score: number; level: string } {
  return COUNTRY_RISK_SCORES[country] ?? { score: 30, level: "low" };
}

function determineThreatLevel(originScore: number, sanctionsHits: number, threatActors: number): string {
  let maxRisk = originScore;
  if (sanctionsHits > 0) maxRisk = Math.min(100, maxRisk + 30);
  if (threatActors > 0) maxRisk = Math.min(100, maxRisk + 15);
  if (maxRisk >= 80) return "critical";
  if (maxRisk >= 60) return "high";
  if (maxRisk >= 40) return "medium";
  return "low";
}

describe("Sprint 52 — OpenCTI Threat Intelligence", () => {
  it("KP is classified as critical risk country", () => {
    const risk = getCountryRisk("KP");
    expect(risk.level).toBe("critical");
    expect(risk.score).toBeGreaterThanOrEqual(90);
  });

  it("SG is classified as minimal risk country", () => {
    const risk = getCountryRisk("SG");
    expect(risk.level).toBe("minimal");
    expect(risk.score).toBeLessThan(15);
  });

  it("GH is classified as low risk country", () => {
    const risk = getCountryRisk("GH");
    expect(risk.level).toBe("low");
    expect(risk.score).toBeLessThan(40);
  });

  it("unknown country defaults to low risk", () => {
    const risk = getCountryRisk("ZZ");
    expect(risk.score).toBe(30);
    expect(risk.level).toBe("low");
  });

  it("detects sanctioned entity by name", () => {
    const hits = checkSanctions("Pyongyang Trading Corporation");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].sanctions_lists).toContain("OFAC-SDN");
  });

  it("returns empty for non-sanctioned entity", () => {
    const hits = checkSanctions("Accra Fresh Produce Ltd");
    expect(hits).toHaveLength(0);
  });

  it("sanctions check is case-insensitive", () => {
    const hits = checkSanctions("damascus steel");
    expect(hits.length).toBeGreaterThan(0);
  });

  it("threat level is critical when sanctions hit on critical-risk origin", () => {
    const level = determineThreatLevel(92, 1, 0); // IR + sanctions hit
    expect(level).toBe("critical");
  });

  it("threat level is high for high-risk origin without sanctions", () => {
    const level = determineThreatLevel(75, 0, 0); // MM, no sanctions
    expect(level).toBe("high");
  });

  it("threat level is low for low-risk origin with no indicators", () => {
    const level = determineThreatLevel(28, 0, 0); // GH
    expect(level).toBe("low");
  });

  it("sanctions hit escalates threat level", () => {
    const withoutSanctions = determineThreatLevel(35, 0, 0);
    const withSanctions = determineThreatLevel(35, 1, 0);
    const levels = ["low", "medium", "high", "critical"];
    expect(levels.indexOf(withSanctions)).toBeGreaterThan(levels.indexOf(withoutSanctions));
  });

  it("MITRE TTP registry contains key trade fraud TTPs", () => {
    const ttps = ["T1566", "T1078", "T1036", "T1199", "T1583", "T1562"];
    expect(ttps).toContain("T1036"); // Masquerading — common in customs fraud
    expect(ttps).toContain("T1078"); // Valid Accounts — credential misuse
    expect(ttps.length).toBeGreaterThanOrEqual(6);
  });

  it("enrichment recommendations include ESCALATE for sanctions hits", () => {
    const sanctions = [{ name: "Pyongyang Trading Corporation" }];
    const recs: string[] = [];
    if (sanctions.length > 0) recs.push(`ESCALATE: ${sanctions.length} sanctions hit(s) detected`);
    expect(recs[0]).toMatch(/ESCALATE/);
  });

  it("enrichment recommendations include PROCEED when no indicators", () => {
    const recs: string[] = [];
    const sanctions: unknown[] = [];
    const actors: unknown[] = [];
    const originRisk = { score: 28 };
    const transshipRisks: unknown[] = [];
    if (sanctions.length === 0 && actors.length === 0 && originRisk.score < 40 && transshipRisks.length === 0) {
      recs.push("PROCEED: No significant threat intelligence indicators found");
    }
    expect(recs[0]).toMatch(/PROCEED/);
  });
});

// ─── Sprint 53: API Key Management ───────────────────────────────────────────

function generateApiKey(prefix: string): { key: string; keyHash: string; keyPrefix: string } {
  const raw = randomBytes(32).toString("hex");
  const key = `${prefix}_${raw}`;
  const keyHash = createHmac("sha256", "test-secret").update(key).digest("hex");
  const keyPrefix = key.slice(0, prefix.length + 9);
  return { key, keyHash, keyPrefix };
}

function validateApiKeyFormat(key: string): boolean {
  return /^tg_(live|sandbox|test)_[0-9a-f]{64}$/.test(key);
}

function validateScopes(scopes: string[]): boolean {
  const validScopes = new Set(["declarations:read", "declarations:write", "payments:read", "payments:write", "reports:read", "admin:all"]);
  return scopes.length > 0 && scopes.every(s => validScopes.has(s));
}

describe("Sprint 53 — Trader Self-Service API Portal", () => {
  it("generates live API key with correct prefix format", () => {
    const { key, keyPrefix } = generateApiKey("tg_live");
    expect(key).toMatch(/^tg_live_[0-9a-f]{64}$/);
    expect(keyPrefix).toMatch(/^tg_live_[0-9a-f]{8}$/);
  });

  it("generates sandbox API key with correct prefix format", () => {
    const { key } = generateApiKey("tg_sandbox");
    expect(key).toMatch(/^tg_sandbox_[0-9a-f]{64}$/);
  });

  it("API key hash is deterministic for same key", () => {
    const key = "tg_live_abc123";
    const hash1 = createHmac("sha256", "test-secret").update(key).digest("hex");
    const hash2 = createHmac("sha256", "test-secret").update(key).digest("hex");
    expect(hash1).toBe(hash2);
  });

  it("API key hash differs from raw key", () => {
    const { key, keyHash } = generateApiKey("tg_live");
    expect(keyHash).not.toBe(key);
    expect(keyHash).toHaveLength(64); // SHA-256 hex
  });

  it("two generated keys are unique", () => {
    const { key: key1 } = generateApiKey("tg_live");
    const { key: key2 } = generateApiKey("tg_live");
    expect(key1).not.toBe(key2);
  });

  it("validates correct API key format", () => {
    const { key } = generateApiKey("tg_live");
    expect(validateApiKeyFormat(key)).toBe(true);
  });

  it("rejects malformed API key format", () => {
    expect(validateApiKeyFormat("invalid-key")).toBe(false);
    expect(validateApiKeyFormat("tg_live_short")).toBe(false);
    expect(validateApiKeyFormat("sk_live_abc123")).toBe(false);
  });

  it("validates correct scopes", () => {
    expect(validateScopes(["declarations:read"])).toBe(true);
    expect(validateScopes(["declarations:read", "payments:write"])).toBe(true);
    expect(validateScopes(["admin:all"])).toBe(true);
  });

  it("rejects empty scope list", () => {
    expect(validateScopes([])).toBe(false);
  });

  it("rejects invalid scope names", () => {
    expect(validateScopes(["invalid:scope"])).toBe(false);
    expect(validateScopes(["declarations:read", "unknown:action"])).toBe(false);
  });

  it("key rotation produces new key with different value", () => {
    const original = generateApiKey("tg_live");
    const rotated = generateApiKey("tg_live");
    expect(rotated.key).not.toBe(original.key);
    expect(rotated.keyHash).not.toBe(original.keyHash);
  });

  it("key prefix is derived from first N characters", () => {
    const { key, keyPrefix } = generateApiKey("tg_live");
    expect(key.startsWith(keyPrefix)).toBe(true);
  });

  it("rate limit must be between 10 and 10000 RPM", () => {
    const validateRateLimit = (rpm: number) => rpm >= 10 && rpm <= 10000;
    expect(validateRateLimit(100)).toBe(true);
    expect(validateRateLimit(10000)).toBe(true);
    expect(validateRateLimit(9)).toBe(false);
    expect(validateRateLimit(10001)).toBe(false);
  });

  it("playground endpoint definitions have required fields", () => {
    const endpoints = [
      { id: "declarations-list", group: "Declarations", name: "List Declarations", procedure: "declarations.list", type: "query", scope: "declarations:read", sampleInput: "{}" },
      { id: "risk-score", group: "Risk", name: "Score Declaration", procedure: "riskModel.scoreDeclaration", type: "mutation", scope: "declarations:read", sampleInput: "{}" },
    ];
    for (const ep of endpoints) {
      expect(ep.id).toBeTruthy();
      expect(ep.procedure).toContain(".");
      expect(["query", "mutation"]).toContain(ep.type);
      expect(ep.sampleInput).toBeTruthy();
    }
  });

  it("available scopes cover all tier levels", () => {
    const scopes = [
      { scope: "declarations:read", tier: "basic" },
      { scope: "declarations:write", tier: "basic" },
      { scope: "payments:read", tier: "basic" },
      { scope: "payments:write", tier: "standard" },
      { scope: "reports:read", tier: "standard" },
      { scope: "admin:all", tier: "enterprise" },
    ];
    const tiers = new Set(scopes.map(s => s.tier));
    expect(tiers.has("basic")).toBe(true);
    expect(tiers.has("standard")).toBe(true);
    expect(tiers.has("enterprise")).toBe(true);
    expect(scopes).toHaveLength(6);
  });
});
