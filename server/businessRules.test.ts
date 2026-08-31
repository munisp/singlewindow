/**
 * Business Rules Engine — Vitest Test Suite
 * Covers all 10 business rule functions with edge cases.
 */
import { describe, it, expect } from "vitest";
import {
  assertValidTransition,
  validateHsCode,
  assignRiskLane,
  checkAeoEligibility,
  calculateDuty,
  getSlaDeadline,
  isSlaBreached,
  generatePaymentIdempotencyKey,
  checkPermitValidity,
  determineFraudEscalation,
  VALID_TRANSITIONS,
} from "./businessRules";

// ─── 1. Declaration State Machine ────────────────────────────────────────────

describe("assertValidTransition", () => {
  it("allows draft → submitted for trader", () => {
    expect(() => assertValidTransition("draft", "submitted", "user")).not.toThrow();
  });

  // SW-M13: "cleared" is NOT reachable directly from submitted — clearance
  // requires payment + examination. The valid officer clearance paths are
  // payment_confirmed→cleared and examination_complete→cleared.
  it("rejects submitted → cleared (must pass payment/examination first)", () => {
    expect(() => assertValidTransition("submitted", "cleared", "customs_officer")).toThrow("Invalid status transition");
  });

  it("allows examination_complete → cleared for customs_officer", () => {
    expect(() => assertValidTransition("examination_complete", "cleared", "customs_officer")).not.toThrow();
  });

  it("throws on invalid transition draft → cleared", () => {
    expect(() => assertValidTransition("draft", "cleared", "customs_officer")).toThrow("Invalid status transition");
  });

  it("throws on forbidden role: trader cannot clear", () => {
    // examination_complete → cleared is a VALID transition, but not for traders
    expect(() => assertValidTransition("examination_complete", "cleared", "user")).toThrow("not authorised");
  });

  it("allows payment_pending → payment_confirmed for finance only", () => {
    expect(() => assertValidTransition("payment_pending", "payment_confirmed", "finance")).not.toThrow();
    expect(() => assertValidTransition("payment_pending", "payment_confirmed", "user")).toThrow("not authorised");
  });

  it("terminal statuses have no valid transitions", () => {
    expect(VALID_TRANSITIONS.cleared).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
  });

  it("allows rejected → submitted for trader (resubmission)", () => {
    expect(() => assertValidTransition("rejected", "submitted", "user")).not.toThrow();
  });
});

// ─── 2. HS Code Validation ────────────────────────────────────────────────────

describe("validateHsCode", () => {
  it("accepts valid 6-digit HS code (international)", () => {
    expect(validateHsCode("010121", "default").valid).toBe(true);
  });

  it("accepts valid 8-digit HS code for Ghana", () => {
    expect(validateHsCode("01012100", "GH").valid).toBe(true);
  });

  it("rejects 6-digit code for Ghana (requires 8)", () => {
    const result = validateHsCode("010121", "GH");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("8 digits");
  });

  it("strips dots from HS code", () => {
    expect(validateHsCode("01.01.21", "default").valid).toBe(true);
  });

  it("rejects non-numeric HS code", () => {
    expect(validateHsCode("ABC123", "default").valid).toBe(false);
  });

  it("rejects HS code longer than 10 digits", () => {
    expect(validateHsCode("01234567890", "default").valid).toBe(false);
  });
});

// ─── 3. Risk Lane Assignment ──────────────────────────────────────────────────

describe("assignRiskLane", () => {
  it("assigns green lane for low-risk AEO trader", () => {
    const result = assignRiskLane({
      riskScore: 20,
      isAeo: true,
      isSanctioned: false,
      invoiceValue: 5000,
      countryOfOrigin: "DE",
    });
    expect(result.lane).toBe("green");
  });

  it("assigns red lane for sanctioned party", () => {
    const result = assignRiskLane({
      riskScore: 10,
      isAeo: false,
      isSanctioned: true,
      invoiceValue: 1000,
      countryOfOrigin: "US",
    });
    expect(result.lane).toBe("red");
    expect(result.score).toBe(100);
  });

  it("assigns yellow lane for medium risk", () => {
    const result = assignRiskLane({
      riskScore: 45,
      isAeo: false,
      isSanctioned: false,
      invoiceValue: 10000,
      countryOfOrigin: "CN",
    });
    expect(result.lane).toBe("yellow");
  });

  it("adds 20 points for high-risk country", () => {
    const result = assignRiskLane({
      riskScore: 55,
      isAeo: false,
      isSanctioned: false,
      invoiceValue: 1000,
      countryOfOrigin: "IR",
    });
    expect(result.score).toBeGreaterThanOrEqual(70);
    expect(result.lane).toBe("red");
  });

  it("AEO reduces score by 20 points", () => {
    const withAeo = assignRiskLane({ riskScore: 50, isAeo: true, isSanctioned: false, invoiceValue: 1000, countryOfOrigin: "US" });
    const withoutAeo = assignRiskLane({ riskScore: 50, isAeo: false, isSanctioned: false, invoiceValue: 1000, countryOfOrigin: "US" });
    expect(withAeo.score).toBe(withoutAeo.score - 20);
  });
});

// ─── 4. AEO Eligibility ───────────────────────────────────────────────────────

describe("checkAeoEligibility", () => {
  it("approves eligible trader with high scores", () => {
    const result = checkAeoEligibility({
      complianceScore: 85,
      yearsInBusiness: 5,
      declarationsLast12Months: 100,
      rejectionRatePct: 1,
      outstandingDuties: 0,
      hasCriminalRecord: false,
      hasActiveSanctions: false,
    });
    expect(result.eligible).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(70);
  });

  it("rejects trader with criminal record", () => {
    const result = checkAeoEligibility({
      complianceScore: 90,
      yearsInBusiness: 10,
      declarationsLast12Months: 200,
      rejectionRatePct: 0,
      outstandingDuties: 0,
      hasCriminalRecord: true,
      hasActiveSanctions: false,
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects trader with outstanding duties > $10,000", () => {
    const result = checkAeoEligibility({
      complianceScore: 90,
      yearsInBusiness: 5,
      declarationsLast12Months: 100,
      rejectionRatePct: 1,
      outstandingDuties: 15000,
      hasCriminalRecord: false,
      hasActiveSanctions: false,
    });
    expect(result.eligible).toBe(false);
  });

  it("rejects trader with rejection rate > 5%", () => {
    const result = checkAeoEligibility({
      complianceScore: 85,
      yearsInBusiness: 5,
      declarationsLast12Months: 100,
      rejectionRatePct: 8,
      outstandingDuties: 0,
      hasCriminalRecord: false,
      hasActiveSanctions: false,
    });
    expect(result.eligible).toBe(false);
  });
});

// ─── 5. Duty Calculation ──────────────────────────────────────────────────────

describe("calculateDuty", () => {
  it("calculates CIF value correctly", () => {
    const result = calculateDuty({
      invoiceValue: 10000,
      freightCost: 500,
      insuranceCost: 100,
      tariffRate: 20,
      vatRate: 12.5,
    });
    expect(result.cifValue).toBe(10600);
    expect(result.customsDuty).toBe(2120);
  });

  it("applies VAT on CIF + duty base", () => {
    const result = calculateDuty({
      invoiceValue: 10000,
      freightCost: 0,
      insuranceCost: 0,
      tariffRate: 0,
      vatRate: 12.5,
    });
    expect(result.vat).toBe(1250);
  });

  it("includes ECOWAS levy", () => {
    const result = calculateDuty({
      invoiceValue: 10000,
      freightCost: 0,
      insuranceCost: 0,
      tariffRate: 20,
      vatRate: 12.5,
      levyRate: 0.5,
    });
    expect(result.levy).toBe(50);
    expect(result.totalDuties).toBeGreaterThan(result.customsDuty + result.vat);
  });

  it("totalDuties equals sum of all components", () => {
    const result = calculateDuty({
      invoiceValue: 5000,
      freightCost: 200,
      insuranceCost: 50,
      tariffRate: 15,
      vatRate: 12.5,
      levyRate: 1,
      exciseRate: 5,
    });
    const expected = result.customsDuty + result.vat + result.levy + result.excise;
    expect(result.totalDuties).toBeCloseTo(expected, 2);
  });
});

// ─── 6. SLA Breach Detection ──────────────────────────────────────────────────

describe("isSlaBreached", () => {
  it("detects breach for import green lane after 4 hours", () => {
    const submittedAt = new Date(Date.now() - 5 * 60 * 60 * 1000); // 5 hours ago
    const result = isSlaBreached(submittedAt, "submitted", "import", "green");
    expect(result.breached).toBe(true);
    expect(result.hoursOverdue).toBeGreaterThan(0);
  });

  it("no breach for cleared declaration", () => {
    const submittedAt = new Date(Date.now() - 100 * 60 * 60 * 1000); // 100 hours ago
    const result = isSlaBreached(submittedAt, "cleared", "import", "green");
    expect(result.breached).toBe(false);
  });

  it("no breach within SLA window", () => {
    const submittedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    const result = isSlaBreached(submittedAt, "submitted", "import", "green");
    expect(result.breached).toBe(false);
  });

  it("red lane has 72-hour SLA for imports", () => {
    const deadline = getSlaDeadline(new Date(0), "import", "red");
    expect(deadline.getTime()).toBe(72 * 60 * 60 * 1000);
  });
});

// ─── 7. Payment Idempotency ───────────────────────────────────────────────────

describe("generatePaymentIdempotencyKey", () => {
  it("generates consistent key for same inputs", () => {
    const key1 = generatePaymentIdempotencyKey(123, 1000.00, "GHS", 456);
    const key2 = generatePaymentIdempotencyKey(123, 1000.00, "GHS", 456);
    expect(key1).toBe(key2);
  });

  it("generates different keys for different amounts", () => {
    const key1 = generatePaymentIdempotencyKey(123, 1000.00, "GHS", 456);
    const key2 = generatePaymentIdempotencyKey(123, 1001.00, "GHS", 456);
    expect(key1).not.toBe(key2);
  });

  it("key starts with PAY-", () => {
    const key = generatePaymentIdempotencyKey(1, 100, "USD", 1);
    expect(key.startsWith("PAY-")).toBe(true);
  });
});

// ─── 8. Permit Validity ───────────────────────────────────────────────────────

describe("checkPermitValidity", () => {
  it("returns valid for permit expiring in 60 days", () => {
    const expiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const result = checkPermitValidity({ permitNumber: "P001", expiryDate: expiry, issuingAgency: "FDA" });
    expect(result.valid).toBe(true);
    expect(result.warning).toBeUndefined();
  });

  it("returns warning for permit expiring in 5 days", () => {
    const expiry = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const result = checkPermitValidity({ permitNumber: "P001", expiryDate: expiry, issuingAgency: "FDA" });
    expect(result.valid).toBe(true);
    expect(result.warning).toContain("expires in 5 days");
  });

  it("returns invalid for expired permit", () => {
    const expiry = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const result = checkPermitValidity({ permitNumber: "P001", expiryDate: expiry, issuingAgency: "FDA" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });
});

// ─── 9. Fraud Escalation ──────────────────────────────────────────────────────

describe("determineFraudEscalation", () => {
  it("blocks sanctioned parties immediately", () => {
    const result = determineFraudEscalation({
      riskScore: 10,
      anomalyCount: 0,
      sanctionsHit: true,
      invoiceValueDiscrepancyPct: 0,
      priorFraudCases: 0,
    });
    expect(result.level).toBe("block");
  });

  it("escalates on high risk score", () => {
    const result = determineFraudEscalation({
      riskScore: 85,
      anomalyCount: 6,
      sanctionsHit: false,
      invoiceValueDiscrepancyPct: 5,
      priorFraudCases: 0,
    });
    expect(result.level).toBe("escalate");
  });

  it("investigates on medium risk", () => {
    const result = determineFraudEscalation({
      riskScore: 65,
      anomalyCount: 3,
      sanctionsHit: false,
      invoiceValueDiscrepancyPct: 10,
      priorFraudCases: 0,
    });
    expect(result.level).toBe("investigate");
  });

  it("monitors on low risk with anomaly", () => {
    const result = determineFraudEscalation({
      riskScore: 42,
      anomalyCount: 1,
      sanctionsHit: false,
      invoiceValueDiscrepancyPct: 5,
      priorFraudCases: 0,
    });
    expect(result.level).toBe("monitor");
  });

  it("returns none for clean trader", () => {
    const result = determineFraudEscalation({
      riskScore: 10,
      anomalyCount: 0,
      sanctionsHit: false,
      invoiceValueDiscrepancyPct: 2,
      priorFraudCases: 0,
    });
    expect(result.level).toBe("none");
  });

  it("blocks trader with 3+ prior fraud cases", () => {
    const result = determineFraudEscalation({
      riskScore: 20,
      anomalyCount: 0,
      sanctionsHit: false,
      invoiceValueDiscrepancyPct: 0,
      priorFraudCases: 3,
    });
    expect(result.level).toBe("block");
  });
});
