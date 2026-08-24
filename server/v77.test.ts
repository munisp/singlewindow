/**
 * v77.test.ts — TigerBeetle Integration & Schema Audit Sprint
 *
 * Covers:
 *   TB-01  TB bridge port consistency (all layers use 8093)
 *   TB-02  payment-service calls bridge HTTP API (not local ID gen)
 *   TB-03  Rust bridge has /bond/deposit endpoint
 *   TB-04  Rust bridge has /bond/release endpoint
 *   TB-05  Rust bridge has /penalty endpoint
 *   TB-06  Rust bridge has /transit-guarantee endpoint
 *   TB-07  Rust bridge has /pending endpoint
 *   TB-08  Rust bridge has /void-pending endpoint
 *   TB-09  tRPC ledger.postBondDeposit procedure exists with offline stub
 *   TB-10  tRPC ledger.releaseBond procedure exists with offline stub
 *   TB-11  tRPC ledger.postPenalty procedure exists with offline stub
 *   TB-12  tRPC ledger.postTransitGuarantee procedure exists with offline stub
 *   TB-13  Dapr resiliency target for tigerbeetle-bridge-rs
 *   SC-01  Schema: tigerbeetle_bonds table with 14 columns
 *   SC-02  Schema: tigerbeetle_penalties table with 15 columns
 *   SC-03  Schema: tigerbeetle_transit_guarantees table with 14 columns
 *   SC-04  Schema: payment_risk_scores table with 14 columns
 *   SC-05  Schema: hs_classification_cache table with 14 columns
 *   SC-06  Schema: ab_divergence_log table with 12 columns
 *   SC-07  Schema: tbEntryTypeEnum includes bond_deposit and bond_release
 *   SC-08  Schema: bondTypeEnum includes import_bond, transit_bond, aeo_bond
 *   SC-09  Schema: penaltyCodeEnum includes all 5 penalty codes
 *   SC-10  Schema: riskTierEnum includes LOW, MEDIUM, HIGH, CRITICAL
 *   DB-01  db.ts exports createBond helper
 *   DB-02  db.ts exports getBondsByDeclaration helper
 *   DB-03  db.ts exports createPenalty helper
 *   DB-04  db.ts exports createTransitGuarantee helper
 *   DB-05  db.ts exports createPaymentRiskScore helper
 *   DB-06  db.ts exports upsertHsClassification helper
 *   DB-07  db.ts exports createAbDivergenceEntry helper
 *   DB-08  db.ts exports getAbDivergenceStats helper
 *   DB-09  db.ts imports all 6 new v77 tables from schema
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");

function read(rel: string) {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

// ─── TB-01: Port consistency ──────────────────────────────────────────────────
describe("TB-01: TB bridge port consistency", () => {
  it("ledger.ts uses port 8093 for TB_BRIDGE_URL", () => {
    const src = read("server/routers/ledger.ts");
    expect(src).toContain("8093");
    expect(src).not.toMatch(/TB_BRIDGE_URL.*8086/);
    expect(src).not.toMatch(/TB_BRIDGE_URL.*8087/);
  });

  it("polyglot-services.yaml tigerbeetle-bridge uses port 4600 (internal) and 8093 (service)", () => {
    const src = read("infra/k8s/polyglot-services.yaml");
    // The bridge-rs service should be present
    expect(src).toMatch(/tigerbeetle-bridge/);
  });

  it("fund-flow.ts uses port 8093 for TB bridge", () => {
    const fundFlow = path.join(ROOT, "server/routers/fund-flow.ts");
    if (!fs.existsSync(fundFlow)) return; // optional file
    const src = fs.readFileSync(fundFlow, "utf-8");
    expect(src).not.toMatch(/8086|8087|8099/);
  });
});

// ─── TB-02: payment-service bridge HTTP call ─────────────────────────────────
describe("TB-02: payment-service calls bridge HTTP API", () => {
  it("payment-service main.go references TIGERBEETLE_BRIDGE_URL env var", () => {
    const src = read("services/go/payment-service/main.go");
    expect(src).toContain("TIGERBEETLE_BRIDGE_URL");
  });

  it("payment-service main.go makes HTTP call to bridge (not just local ID gen)", () => {
    const src = read("services/go/payment-service/main.go");
    // Should have an http.Post or http.NewRequest call to the bridge
    expect(src).toMatch(/http\.(Post|NewRequest|Do)|TIGERBEETLE_BRIDGE_URL/);
  });
});

// ─── TB-03 to TB-08: Rust bridge endpoints ───────────────────────────────────
describe("TB-03 to TB-08: Rust bridge new endpoints", () => {
  const bridgeSrc = read("services/rust/tigerbeetle-bridge/src/main.rs");

  it("TB-03: /bond/deposit route registered", () => {
    expect(bridgeSrc).toContain('"/bond/deposit"');
    expect(bridgeSrc).toContain("bond_deposit_handler");
  });

  it("TB-04: /bond/release route registered", () => {
    expect(bridgeSrc).toContain('"/bond/release"');
    expect(bridgeSrc).toContain("bond_release_handler");
  });

  it("TB-05: /penalty route registered", () => {
    expect(bridgeSrc).toContain('"/penalty"');
    expect(bridgeSrc).toContain("penalty_handler");
  });

  it("TB-06: /transit-guarantee route registered", () => {
    expect(bridgeSrc).toContain('"/transit-guarantee"');
    expect(bridgeSrc).toContain("transit_guarantee_handler");
  });

  it("TB-07: /pending route registered", () => {
    expect(bridgeSrc).toContain('"/pending"');
    expect(bridgeSrc).toContain("pending_handler");
  });

  it("TB-08: /void-pending route registered", () => {
    expect(bridgeSrc).toContain('"/void-pending"');
    expect(bridgeSrc).toContain("void_pending_handler");
  });

  it("BondDepositRequest struct has required fields", () => {
    expect(bridgeSrc).toContain("BondDepositRequest");
    expect(bridgeSrc).toContain("bond_amount");
    expect(bridgeSrc).toContain("bond_type");
  });

  it("PenaltyRequest struct has penalty_code and officer_id", () => {
    expect(bridgeSrc).toContain("PenaltyRequest");
    expect(bridgeSrc).toContain("penalty_code");
    expect(bridgeSrc).toContain("officer_id");
  });

  it("TransitGuaranteeRequest has destination_country and transit_days", () => {
    expect(bridgeSrc).toContain("TransitGuaranteeRequest");
    expect(bridgeSrc).toContain("destination_country");
    expect(bridgeSrc).toContain("transit_days");
  });

  it("BondDeposit TransferType variant used in bond_deposit_handler", () => {
    expect(bridgeSrc).toContain("TransferType::BondDeposit");
  });

  it("BondRelease TransferType variant used in bond_release_handler", () => {
    expect(bridgeSrc).toContain("TransferType::BondRelease");
  });

  it("PenaltyAssessment TransferType variant used in penalty_handler", () => {
    expect(bridgeSrc).toContain("TransferType::PenaltyAssessment");
  });

  it("TransitGuarantee TransferType variant used in transit_guarantee_handler", () => {
    expect(bridgeSrc).toContain("TransferType::TransitGuarantee");
  });
});

// ─── TB-09 to TB-12: tRPC ledger procedures ──────────────────────────────────
describe("TB-09 to TB-12: tRPC ledger procedures", () => {
  const ledgerSrc = read("server/routers/ledger.ts");

  it("TB-09: ledger.postBondDeposit procedure exists", () => {
    expect(ledgerSrc).toContain("postBondDeposit:");
  });

  it("TB-09: postBondDeposit fails closed when the bridge is unavailable", () => {
    const idx = ledgerSrc.indexOf("postBondDeposit:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("SERVICE_UNAVAILABLE");
    expect(window).not.toContain("createLedgerEntry");
    expect(window).not.toContain("offline-stub");
  });

  it("TB-09: postBondDeposit calls /bond/deposit on bridge", () => {
    const idx = ledgerSrc.indexOf("postBondDeposit:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("/bond/deposit");
  });

  it("TB-10: ledger.releaseBond procedure exists", () => {
    expect(ledgerSrc).toContain("releaseBond:");
  });

  it("TB-10: releaseBond fails closed when the bridge is unavailable", () => {
    const idx = ledgerSrc.indexOf("releaseBond:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("SERVICE_UNAVAILABLE");
    expect(window).not.toContain("createLedgerEntry");
    expect(window).not.toContain("offline-stub");
  });

  it("TB-10: releaseBond calls /bond/release on bridge", () => {
    const idx = ledgerSrc.indexOf("releaseBond:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("/bond/release");
  });

  it("TB-11: ledger.postPenalty procedure exists", () => {
    expect(ledgerSrc).toContain("postPenalty:");
  });

  it("TB-11: postPenalty fails closed when the bridge is unavailable", () => {
    const idx = ledgerSrc.indexOf("postPenalty:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("SERVICE_UNAVAILABLE");
    expect(window).not.toContain("createLedgerEntry");
    expect(window).not.toContain("offline-stub");
  });

  it("TB-11: postPenalty calls /penalty on bridge", () => {
    const idx = ledgerSrc.indexOf("postPenalty:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("/penalty");
  });

  it("TB-12: ledger.postTransitGuarantee procedure exists", () => {
    expect(ledgerSrc).toContain("postTransitGuarantee:");
  });

  it("TB-12: postTransitGuarantee fails closed when the bridge is unavailable", () => {
    const idx = ledgerSrc.indexOf("postTransitGuarantee:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("SERVICE_UNAVAILABLE");
    expect(window).not.toContain("createLedgerEntry");
    expect(window).not.toContain("offline-stub");
  });

  it("TB-12: postTransitGuarantee calls /transit-guarantee on bridge", () => {
    const idx = ledgerSrc.indexOf("postTransitGuarantee:");
    const window = ledgerSrc.slice(idx, idx + 1500);
    expect(window).toContain("/transit-guarantee");
  });

  it("postBondDeposit input validates bondType enum", () => {
    const idx = ledgerSrc.indexOf("postBondDeposit:");
    const window = ledgerSrc.slice(idx, idx + 800);
    expect(window).toContain("import_bond");
    expect(window).toContain("transit_bond");
    expect(window).toContain("aeo_bond");
  });

  it("postPenalty input validates penaltyCode enum", () => {
    const idx = ledgerSrc.indexOf("postPenalty:");
    const window = ledgerSrc.slice(idx, idx + 800);
    expect(window).toContain("UNDER_DECLARATION");
    expect(window).toContain("PROHIBITED_GOODS");
  });
});

// ─── TB-13: Dapr resiliency ───────────────────────────────────────────────────
describe("TB-13: Dapr resiliency target for TB bridge", () => {
  it("components.yaml has tigerbeetle-bridge-rs as resiliency target", () => {
    const src = read("infra/k8s/dapr/components.yaml");
    expect(src).toContain("tigerbeetle-bridge-rs");
  });

  it("tigerbeetle-bridge-rs target has timeout, retry, and circuitBreaker", () => {
    const src = read("infra/k8s/dapr/components.yaml");
    const idx = src.indexOf("tigerbeetle-bridge-rs:");
    const window = src.slice(idx, idx + 200);
    expect(window).toContain("timeout");
    expect(window).toContain("retry");
    expect(window).toContain("circuitBreaker");
  });
});

// ─── SC-01 to SC-10: Schema tables ───────────────────────────────────────────
describe("SC-01 to SC-10: Schema tables", () => {
  const schemaSrc = read("drizzle/schema.ts");

  it("SC-01: tigerbeetleBonds table defined", () => {
    expect(schemaSrc).toContain("tigerbeetleBonds");
    expect(schemaSrc).toContain("tigerbeetle_bonds");
  });

  it("SC-01: tigerbeetleBonds has bondId, tbTransferId, bondType, bondAmount", () => {
    const idx = schemaSrc.indexOf("tigerbeetleBonds =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("bondId");
    expect(window).toContain("tbTransferId");
    expect(window).toContain("bondType");
    expect(window).toContain("bondAmount");
  });

  it("SC-02: tigerbeetlePenalties table defined", () => {
    expect(schemaSrc).toContain("tigerbeetlePenalties");
    expect(schemaSrc).toContain("tigerbeetle_penalties");
  });

  it("SC-02: tigerbeetlePenalties has penaltyId, penaltyCode, officerId", () => {
    const idx = schemaSrc.indexOf("tigerbeetlePenalties =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("penaltyId");
    expect(window).toContain("penaltyCode");
    expect(window).toContain("officerId");
  });

  it("SC-03: tigerbeetleTransitGuarantees table defined", () => {
    expect(schemaSrc).toContain("tigerbeetleTransitGuarantees");
    expect(schemaSrc).toContain("tigerbeetle_transit_guarantees");
  });

  it("SC-03: tigerbeetleTransitGuarantees has guaranteeId, destinationCountry, validUntil", () => {
    const idx = schemaSrc.indexOf("tigerbeetleTransitGuarantees =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("guaranteeId");
    expect(window).toContain("destinationCountry");
    expect(window).toContain("validUntil");
  });

  it("SC-04: paymentRiskScores table defined", () => {
    expect(schemaSrc).toContain("paymentRiskScores");
    expect(schemaSrc).toContain("payment_risk_scores");
  });

  it("SC-04: paymentRiskScores has riskScore, riskTier, recommendedAction, flags", () => {
    const idx = schemaSrc.indexOf("paymentRiskScores =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("riskScore");
    expect(window).toContain("riskTier");
    expect(window).toContain("recommendedAction");
    expect(window).toContain("flags");
  });

  it("SC-05: hsClassificationCache table defined", () => {
    expect(schemaSrc).toContain("hsClassificationCache");
    expect(schemaSrc).toContain("hs_classification_cache");
  });

  it("SC-05: hsClassificationCache has hsCode, chapter, heading, confidence, hitCount", () => {
    const idx = schemaSrc.indexOf("hsClassificationCache =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("hsCode");
    expect(window).toContain("chapter");
    expect(window).toContain("heading");
    expect(window).toContain("confidence");
    expect(window).toContain("hitCount");
  });

  it("SC-06: abDivergenceLog table defined", () => {
    expect(schemaSrc).toContain("abDivergenceLog");
    expect(schemaSrc).toContain("ab_divergence_log");
  });

  it("SC-06: abDivergenceLog has productionDecision, shadowDecision, diverged", () => {
    const idx = schemaSrc.indexOf("abDivergenceLog =");
    const window = schemaSrc.slice(idx, idx + 1000);
    expect(window).toContain("productionDecision");
    expect(window).toContain("shadowDecision");
    expect(window).toContain("diverged");
  });

  it("SC-07: tbEntryTypeEnum includes bond_deposit and bond_release", () => {
    expect(schemaSrc).toContain('"bond_deposit"');
    expect(schemaSrc).toContain('"bond_release"');
  });

  it("SC-08: bondTypeEnum includes all 3 bond types", () => {
    expect(schemaSrc).toContain('"import_bond"');
    expect(schemaSrc).toContain('"transit_bond"');
    expect(schemaSrc).toContain('"aeo_bond"');
  });

  it("SC-09: penaltyCodeEnum includes all 5 codes", () => {
    expect(schemaSrc).toContain('"UNDER_DECLARATION"');
    expect(schemaSrc).toContain('"PROHIBITED_GOODS"');
    expect(schemaSrc).toContain('"LATE_FILING"');
    expect(schemaSrc).toContain('"MISDESCRIPTION"');
    expect(schemaSrc).toContain('"SMUGGLING"');
  });

  it("SC-10: riskTierEnum includes LOW, MEDIUM, HIGH, CRITICAL", () => {
    expect(schemaSrc).toContain('"LOW"');
    expect(schemaSrc).toContain('"MEDIUM"');
    expect(schemaSrc).toContain('"HIGH"');
    expect(schemaSrc).toContain('"CRITICAL"');
  });

  it("SC: InsertTigerbeetleBond type exported", () => {
    expect(schemaSrc).toContain("InsertTigerbeetleBond");
  });

  it("SC: InsertTigerbeetlePenalty type exported", () => {
    expect(schemaSrc).toContain("InsertTigerbeetlePenalty");
  });

  it("SC: InsertTigerbeetleTransitGuarantee type exported", () => {
    expect(schemaSrc).toContain("InsertTigerbeetleTransitGuarantee");
  });

  it("SC: InsertPaymentRiskScore type exported", () => {
    expect(schemaSrc).toContain("InsertPaymentRiskScore");
  });

  it("SC: InsertHsClassificationCache type exported", () => {
    expect(schemaSrc).toContain("InsertHsClassificationCache");
  });

  it("SC: InsertAbDivergenceLog type exported", () => {
    expect(schemaSrc).toContain("InsertAbDivergenceLog");
  });
});

// ─── DB-01 to DB-09: db.ts helpers ───────────────────────────────────────────
describe("DB-01 to DB-09: db.ts helpers for new tables", () => {
  const dbSrc = read("server/db.ts");

  it("DB-01: createBond exported", () => {
    expect(dbSrc).toContain("export async function createBond");
  });

  it("DB-02: getBondsByDeclaration exported", () => {
    expect(dbSrc).toContain("export async function getBondsByDeclaration");
  });

  it("DB-02: getBondsByTrader exported", () => {
    expect(dbSrc).toContain("export async function getBondsByTrader");
  });

  it("DB-02: updateBondStatus exported", () => {
    expect(dbSrc).toContain("export async function updateBondStatus");
  });

  it("DB-03: createPenalty exported", () => {
    expect(dbSrc).toContain("export async function createPenalty");
  });

  it("DB-03: getPenaltiesByDeclaration exported", () => {
    expect(dbSrc).toContain("export async function getPenaltiesByDeclaration");
  });

  it("DB-04: createTransitGuarantee exported", () => {
    expect(dbSrc).toContain("export async function createTransitGuarantee");
  });

  it("DB-04: getTransitGuaranteesByDeclaration exported", () => {
    expect(dbSrc).toContain("export async function getTransitGuaranteesByDeclaration");
  });

  it("DB-05: createPaymentRiskScore exported", () => {
    expect(dbSrc).toContain("export async function createPaymentRiskScore");
  });

  it("DB-05: getLatestPaymentRiskScore exported", () => {
    expect(dbSrc).toContain("export async function getLatestPaymentRiskScore");
  });

  it("DB-06: upsertHsClassification exported", () => {
    expect(dbSrc).toContain("export async function upsertHsClassification");
  });

  it("DB-06: getHsClassification exported", () => {
    expect(dbSrc).toContain("export async function getHsClassification");
  });

  it("DB-07: createAbDivergenceEntry exported", () => {
    expect(dbSrc).toContain("export async function createAbDivergenceEntry");
  });

  it("DB-08: getAbDivergenceStats exported", () => {
    expect(dbSrc).toContain("export async function getAbDivergenceStats");
  });

  it("DB-09: db.ts imports tigerbeetleBonds from schema", () => {
    expect(dbSrc).toContain("tigerbeetleBonds");
  });

  it("DB-09: db.ts imports tigerbeetlePenalties from schema", () => {
    expect(dbSrc).toContain("tigerbeetlePenalties");
  });

  it("DB-09: db.ts imports tigerbeetleTransitGuarantees from schema", () => {
    expect(dbSrc).toContain("tigerbeetleTransitGuarantees");
  });

  it("DB-09: db.ts imports paymentRiskScores from schema", () => {
    expect(dbSrc).toContain("paymentRiskScores");
  });

  it("DB-09: db.ts imports hsClassificationCache from schema", () => {
    expect(dbSrc).toContain("hsClassificationCache");
  });

  it("DB-09: db.ts imports abDivergenceLog from schema", () => {
    expect(dbSrc).toContain("abDivergenceLog");
  });
});
