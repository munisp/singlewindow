/**
 * TradeGateway™ NGSWTP — Business Rules Engine
 * Centralised enforcement of all trade compliance business rules.
 *
 * Rules implemented:
 * 1. Declaration State Machine — valid transitions per WCO guidelines
 * 2. Permit Expiry Enforcement — OGA permits must be valid at declaration submit time
 * 3. HS Code Validation — 6-digit minimum, 8-digit for Ghana ICUMS
 * 4. Risk Score Thresholds — green/yellow/red lane assignment
 * 5. AEO Eligibility — minimum compliance score requirements
 * 6. Duty Calculation — CIF-based duty with tariff rate lookup
 * 7. Fraud Escalation — automatic escalation on risk score breach
 * 8. SLA Breach Detection — configurable SLA windows per declaration type
 * 9. Payment Idempotency — duplicate payment prevention
 * 10. Sanctions Screening — block declarations with sanctioned parties
 */

import { TRPCError } from "@trpc/server";
import crypto from "crypto";

// ─── 1. Declaration State Machine ────────────────────────────────────────────

export type DeclarationStatus =
  | "draft"
  | "submitted"
  | "under_assessment"
  | "docs_required"
  | "payment_pending"
  | "payment_confirmed"
  | "under_examination"
  | "examination_complete"
  | "cleared"
  | "rejected"
  | "cancelled";

/**
 * Valid transitions per WCO Revised Kyoto Convention (RKC) Standard 6.1.
 * Each key is the CURRENT status, values are allowed NEXT statuses.
 */
export const VALID_TRANSITIONS: Record<DeclarationStatus, DeclarationStatus[]> = {
  // Submission writes under_assessment after risk scoring. submitted remains supported
  // for imports and workflows that preserve a distinct hand-off state.
  draft: ["submitted", "under_assessment", "cancelled"],
  // SW-M13: "cleared" is NOT reachable from submitted/under_assessment —
  // clearance requires payment_confirmed (or examination_complete after a hold).
  submitted: ["under_assessment", "docs_required", "payment_pending", "under_examination", "rejected"],
  under_assessment: ["docs_required", "payment_pending", "under_examination", "rejected"],
  docs_required: ["submitted", "under_assessment", "rejected", "cancelled"],
  // payment_confirmed is written by the payment confirmation workflow; retain the
  // legacy direct paths from payment_pending while permitting the normal path.
  // SW-M13: payment_pending must pass through payment_confirmed before clearance.
  payment_pending: ["payment_confirmed", "under_examination", "rejected"],
  payment_confirmed: ["under_examination", "cleared", "rejected"],
  under_examination: ["examination_complete", "docs_required", "rejected"],
  examination_complete: ["cleared", "rejected", "payment_pending"],
  cleared: [],
  rejected: ["submitted", "under_assessment", "cancelled"],
  cancelled: [],
};

/**
 * Roles authorised to perform each transition.
 * Trader can only submit/cancel their own draft.
 * Customs officer controls examination and clearance.
 */
export const TRANSITION_ROLES: Record<string, string[]> = {
  "draft→submitted": ["user", "customs_officer", "admin"],
  "draft→under_assessment": ["user", "customs_officer", "admin"],
  "draft→cancelled": ["user", "admin"],
  "submitted→under_assessment": ["customs_officer", "admin"],
  "submitted→docs_required": ["customs_officer", "admin"],
  "submitted→payment_pending": ["customs_officer", "admin"],
  "submitted→under_examination": ["customs_officer", "inspector", "admin"],
  "submitted→rejected": ["customs_officer", "admin"],
  "under_assessment→docs_required": ["customs_officer", "admin"],
  "under_assessment→payment_pending": ["customs_officer", "admin"],
  "under_assessment→under_examination": ["customs_officer", "inspector", "admin"],
  "under_assessment→rejected": ["customs_officer", "admin"],
  "docs_required→submitted": ["user", "admin"],
  "docs_required→under_assessment": ["user", "admin"],
  "docs_required→rejected": ["customs_officer", "admin"],
  "docs_required→cancelled": ["user", "admin"],
  "payment_pending→payment_confirmed": ["finance", "customs_officer", "admin"],
  "payment_pending→under_examination": ["customs_officer", "admin"],
  "payment_pending→rejected": ["customs_officer", "admin"],
  "payment_confirmed→under_examination": ["customs_officer", "admin"],
  "payment_confirmed→cleared": ["customs_officer", "admin"],
  "payment_confirmed→rejected": ["customs_officer", "admin"],
  "under_examination→examination_complete": ["customs_officer", "inspector", "admin"],
  "under_examination→docs_required": ["customs_officer", "admin"],
  "under_examination→rejected": ["customs_officer", "admin"],
  "examination_complete→cleared": ["customs_officer", "admin"],
  "examination_complete→rejected": ["customs_officer", "admin"],
  "examination_complete→payment_pending": ["customs_officer", "admin"],
  "rejected→submitted": ["user", "admin"],
  "rejected→under_assessment": ["user", "admin"],
  "rejected→cancelled": ["user", "admin"],
};

export function assertValidTransition(
  currentStatus: DeclarationStatus,
  nextStatus: DeclarationStatus,
  userRole: string
): void {
  const allowed = VALID_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(nextStatus)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid status transition: ${currentStatus} → ${nextStatus}. Allowed: [${allowed.join(", ")}]`,
    });
  }
  const transitionKey = `${currentStatus}→${nextStatus}`;
  const allowedRoles = TRANSITION_ROLES[transitionKey] ?? [];
  if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Role '${userRole}' is not authorised to perform transition ${transitionKey}. Required: [${allowedRoles.join(", ")}]`,
    });
  }
}

// ─── 2. HS Code Validation ────────────────────────────────────────────────────

/**
 * Validates HS code format per WCO Harmonised System.
 * - Minimum 6 digits (international standard)
 * - Ghana ICUMS requires 8 digits (national tariff extension)
 * - Rwanda ReSW requires 8 digits
 */
export function validateHsCode(
  hsCode: string,
  country: "GH" | "RW" | "SG" | "default" = "default"
): { valid: boolean; error?: string } {
  const cleaned = hsCode.replace(/\./g, "").replace(/\s/g, "");
  if (!/^\d+$/.test(cleaned)) {
    return { valid: false, error: "HS code must contain only digits (dots are stripped automatically)" };
  }
  const minLength = country === "GH" || country === "RW" ? 8 : 6;
  if (cleaned.length < minLength) {
    return {
      valid: false,
      error: `HS code must be at least ${minLength} digits for ${country === "GH" ? "Ghana ICUMS" : country === "RW" ? "Rwanda ReSW" : "international standard"}`,
    };
  }
  if (cleaned.length > 10) {
    return { valid: false, error: "HS code must not exceed 10 digits" };
  }
  return { valid: true };
}

// ─── 3. Risk Score → Lane Assignment ─────────────────────────────────────────

export type RiskLane = "green" | "yellow" | "red";

export interface RiskScoreInput {
  riskScore: number;          // 0–100
  isAeo: boolean;             // AEO traders get preferential treatment
  isSanctioned: boolean;      // Immediate red lane
  invoiceValue: number;       // USD — high-value goods get extra scrutiny
  countryOfOrigin: string;    // ISO-2 country code
  hsCodeCategory?: string;    // Controlled goods category
}

const HIGH_RISK_COUNTRIES = new Set([
  "AF", "BY", "CU", "IR", "KP", "LY", "MM", "RU", "SD", "SY", "VE", "YE", "ZW",
]);

const CONTROLLED_HS_PREFIXES = new Set([
  "93", // Arms and ammunition
  "28", // Chemicals (dual-use)
  "84", // Nuclear reactors (dual-use)
  "85", // Electrical machinery (dual-use)
]);

export function assignRiskLane(input: RiskScoreInput): {
  lane: RiskLane;
  reasons: string[];
  score: number;
} {
  const reasons: string[] = [];
  let adjustedScore = input.riskScore;

  if (input.isSanctioned) {
    return { lane: "red", reasons: ["Sanctioned party detected — automatic red lane"], score: 100 };
  }

  if (HIGH_RISK_COUNTRIES.has(input.countryOfOrigin)) {
    adjustedScore = Math.min(100, adjustedScore + 20);
    reasons.push(`High-risk country of origin: ${input.countryOfOrigin}`);
  }

  if (input.invoiceValue > 100_000) {
    adjustedScore = Math.min(100, adjustedScore + 10);
    reasons.push(`High-value shipment: USD ${input.invoiceValue.toLocaleString()}`);
  }

  if (input.hsCodeCategory && CONTROLLED_HS_PREFIXES.has(input.hsCodeCategory.slice(0, 2))) {
    adjustedScore = Math.min(100, adjustedScore + 15);
    reasons.push(`Controlled goods category: ${input.hsCodeCategory}`);
  }

  if (input.isAeo) {
    adjustedScore = Math.max(0, adjustedScore - 20);
    reasons.push("AEO status: risk score reduced by 20 points");
  }

  let lane: RiskLane;
  if (adjustedScore >= 70) {
    lane = "red";
    reasons.push(`Risk score ${adjustedScore} ≥ 70 → physical examination required`);
  } else if (adjustedScore >= 40) {
    lane = "yellow";
    reasons.push(`Risk score ${adjustedScore} ≥ 40 → documentary review required`);
  } else {
    lane = "green";
    reasons.push(`Risk score ${adjustedScore} < 40 → auto-clearance eligible`);
  }

  return { lane, score: adjustedScore, reasons };
}

// ─── 4. AEO Eligibility Criteria ─────────────────────────────────────────────

export interface AeoEligibilityInput {
  complianceScore: number;     // 0–100 from compliance scorecard
  yearsInBusiness: number;
  declarationsLast12Months: number;
  rejectionRatePct: number;    // 0–100
  outstandingDuties: number;   // USD
  hasCriminalRecord: boolean;
  hasActiveSanctions: boolean;
}

export function checkAeoEligibility(input: AeoEligibilityInput): {
  eligible: boolean;
  score: number;
  reasons: string[];
  recommendations: string[];
} {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Hard disqualifiers
  if (input.hasCriminalRecord) {
    return { eligible: false, score: 0, reasons: ["Criminal record disqualifies AEO application"], recommendations: [] };
  }
  if (input.hasActiveSanctions) {
    return { eligible: false, score: 0, reasons: ["Active sanctions disqualify AEO application"], recommendations: [] };
  }
  if (input.outstandingDuties > 10_000) {
    reasons.push(`Outstanding duties USD ${input.outstandingDuties.toLocaleString()} exceed threshold of USD 10,000`);
    recommendations.push("Clear all outstanding duty payments before applying");
    return { eligible: false, score: 0, reasons, recommendations };
  }

  // Scoring
  if (input.complianceScore >= 80) { score += 40; }
  else if (input.complianceScore >= 60) { score += 25; recommendations.push("Improve compliance score to ≥ 80 for full points"); }
  else { score += 10; recommendations.push("Compliance score below 60 — significant improvement required"); }

  if (input.yearsInBusiness >= 3) { score += 20; }
  else if (input.yearsInBusiness >= 1) { score += 10; recommendations.push("AEO eligibility improves after 3 years in business"); }
  else { recommendations.push("Minimum 1 year in business required"); }

  if (input.declarationsLast12Months >= 50) { score += 20; }
  else if (input.declarationsLast12Months >= 10) { score += 10; recommendations.push("Increase declaration volume to ≥ 50/year for full points"); }
  else { recommendations.push("Minimum 10 declarations in last 12 months required"); }

  if (input.rejectionRatePct <= 2) { score += 20; }
  else if (input.rejectionRatePct <= 5) { score += 10; recommendations.push("Reduce rejection rate to ≤ 2% for full points"); }
  else { recommendations.push("Rejection rate > 5% disqualifies AEO — review declaration quality"); }

  const eligible = score >= 70 && input.rejectionRatePct <= 5 && input.yearsInBusiness >= 1;
  if (eligible) {
    reasons.push(`AEO eligibility score: ${score}/100 — meets minimum threshold of 70`);
  } else {
    reasons.push(`AEO eligibility score: ${score}/100 — below minimum threshold of 70`);
  }

  return { eligible, score, reasons, recommendations };
}

// ─── 5. Duty Calculation (CIF-based) ─────────────────────────────────────────

export interface DutyCalculationInput {
  invoiceValue: number;        // USD FOB
  freightCost: number;         // USD
  insuranceCost: number;       // USD
  tariffRate: number;          // Percentage (0–100)
  vatRate: number;             // Percentage (default 12.5% Ghana)
  levyRate?: number;           // ECOWAS levy etc.
  exciseRate?: number;         // For excisable goods
}

export function calculateDuty(input: DutyCalculationInput): {
  cifValue: number;
  customsDuty: number;
  vat: number;
  levy: number;
  excise: number;
  totalDuties: number;
  breakdown: Record<string, number>;
} {
  const cifValue = input.invoiceValue + input.freightCost + input.insuranceCost;
  const customsDuty = (cifValue * input.tariffRate) / 100;
  const levy = (cifValue * (input.levyRate ?? 0)) / 100;
  const excise = (cifValue * (input.exciseRate ?? 0)) / 100;
  // VAT is applied on CIF + customs duty + levy + excise (Ghana standard)
  const vatBase = cifValue + customsDuty + levy + excise;
  const vat = (vatBase * input.vatRate) / 100;
  const totalDuties = customsDuty + vat + levy + excise;

  return {
    cifValue,
    customsDuty,
    vat,
    levy,
    excise,
    totalDuties,
    breakdown: {
      "CIF Value": cifValue,
      "Customs Duty": customsDuty,
      "VAT": vat,
      "ECOWAS Levy": levy,
      "Excise Duty": excise,
      "Total Payable": totalDuties,
    },
  };
}

// ─── 6. SLA Windows per Declaration Type ─────────────────────────────────────

export type DeclarationType = "import" | "export" | "transit" | "re_export" | "temporary_import";

/**
 * SLA windows in hours per WCO Time Release Study (TRS) targets.
 * Green lane: auto-clearance target
 * Yellow lane: documentary review target
 * Red lane: physical examination target
 */
export const SLA_WINDOWS: Record<DeclarationType, Record<RiskLane, number>> = {
  import: { green: 4, yellow: 24, red: 72 },
  export: { green: 2, yellow: 12, red: 48 },
  transit: { green: 1, yellow: 8, red: 24 },
  re_export: { green: 4, yellow: 24, red: 72 },
  temporary_import: { green: 8, yellow: 48, red: 120 },
};

export function getSlaDeadline(
  submittedAt: Date,
  declarationType: DeclarationType,
  lane: RiskLane
): Date {
  const hoursAllowed = SLA_WINDOWS[declarationType]?.[lane] ?? 72;
  return new Date(submittedAt.getTime() + hoursAllowed * 60 * 60 * 1000);
}

export function isSlaBreached(
  submittedAt: Date,
  currentStatus: DeclarationStatus,
  declarationType: DeclarationType,
  lane: RiskLane,
  now: Date = new Date()
): { breached: boolean; hoursOverdue: number; deadline: Date } {
  const terminalStatuses: DeclarationStatus[] = ["cleared", "rejected", "cancelled"];
  if (terminalStatuses.includes(currentStatus)) {
    return { breached: false, hoursOverdue: 0, deadline: getSlaDeadline(submittedAt, declarationType, lane) };
  }
  const deadline = getSlaDeadline(submittedAt, declarationType, lane);
  const breached = now > deadline;
  const hoursOverdue = breached ? (now.getTime() - deadline.getTime()) / (60 * 60 * 1000) : 0;
  return { breached, hoursOverdue, deadline };
}

// ─── 7. Payment Idempotency ───────────────────────────────────────────────────

/**
 * Generates a deterministic idempotency key for a payment.
 * Prevents duplicate payments for the same declaration + amount + currency.
 */
export function generatePaymentIdempotencyKey(
  declarationId: number,
  amount: number,
  currency: string,
  traderId: number
): string {
  const raw = `${declarationId}:${amount.toFixed(2)}:${currency}:${traderId}`;
  // Simple hash — in production use SHA-256
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `PAY-${Math.abs(hash).toString(16).toUpperCase().padStart(8, "0")}`;
}

// ─── 8. Permit Validity Check ─────────────────────────────────────────────────

export interface PermitValidityInput {
  permitNumber: string;
  expiryDate: Date;
  issuingAgency: string;
  declarationDate?: Date;
}

export function checkPermitValidity(input: PermitValidityInput): {
  valid: boolean;
  daysUntilExpiry: number;
  warning?: string;
  error?: string;
} {
  const checkDate = input.declarationDate ?? new Date();
  const msUntilExpiry = input.expiryDate.getTime() - checkDate.getTime();
  const daysUntilExpiry = Math.floor(msUntilExpiry / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry < 0) {
    return {
      valid: false,
      daysUntilExpiry,
      error: `Permit ${input.permitNumber} from ${input.issuingAgency} expired ${Math.abs(daysUntilExpiry)} days ago`,
    };
  }

  if (daysUntilExpiry <= 7) {
    return {
      valid: true,
      daysUntilExpiry,
      warning: `Permit ${input.permitNumber} expires in ${daysUntilExpiry} days — renew immediately`,
    };
  }

  if (daysUntilExpiry <= 30) {
    return {
      valid: true,
      daysUntilExpiry,
      warning: `Permit ${input.permitNumber} expires in ${daysUntilExpiry} days — renewal recommended`,
    };
  }

  return { valid: true, daysUntilExpiry };
}

// ─── 9. Fraud Escalation Thresholds ──────────────────────────────────────────

export interface FraudEscalationInput {
  riskScore: number;
  anomalyCount: number;
  sanctionsHit: boolean;
  invoiceValueDiscrepancyPct: number;  // % difference between declared and assessed value
  priorFraudCases: number;
}

export type FraudEscalationLevel = "none" | "monitor" | "investigate" | "escalate" | "block";

export function determineFraudEscalation(input: FraudEscalationInput): {
  level: FraudEscalationLevel;
  reasons: string[];
  recommendedActions: string[];
} {
  const reasons: string[] = [];
  const recommendedActions: string[] = [];

  if (input.sanctionsHit) {
    return {
      level: "block",
      reasons: ["Sanctions screening hit — automatic block"],
      recommendedActions: ["Freeze declaration", "Notify compliance officer", "File SAR report"],
    };
  }

  if (input.priorFraudCases >= 3) {
    reasons.push(`${input.priorFraudCases} prior fraud cases on record`);
    return {
      level: "block",
      reasons,
      recommendedActions: ["Block all pending declarations", "Notify senior compliance officer", "Initiate formal investigation"],
    };
  }

  if (input.invoiceValueDiscrepancyPct > 30) {
    reasons.push(`Invoice value discrepancy: ${input.invoiceValueDiscrepancyPct.toFixed(1)}% (threshold: 30%)`);
    recommendedActions.push("Request supporting invoices and price certificates");
  }

  if (input.riskScore >= 80 || input.anomalyCount >= 5) {
    reasons.push(`Risk score: ${input.riskScore}, Anomaly count: ${input.anomalyCount}`);
    return {
      level: "escalate",
      reasons,
      recommendedActions: [...recommendedActions, "Assign to senior customs officer", "Initiate post-clearance audit"],
    };
  }

  if (input.riskScore >= 60 || input.anomalyCount >= 3 || input.invoiceValueDiscrepancyPct > 15) {
    reasons.push(`Risk score: ${input.riskScore}, Anomaly count: ${input.anomalyCount}`);
    return {
      level: "investigate",
      reasons,
      recommendedActions: [...recommendedActions, "Request additional documentation", "Cross-check with trade partners"],
    };
  }

  if (input.riskScore >= 40 || input.anomalyCount >= 1) {
    reasons.push(`Risk score: ${input.riskScore} — monitoring threshold exceeded`);
    return {
      level: "monitor",
      reasons,
      recommendedActions: [...recommendedActions, "Flag for enhanced monitoring", "Review next 3 declarations"],
    };
  }

  return { level: "none", reasons: ["No fraud indicators detected"], recommendedActions: [] };
}

// ─── 10. Export all rules as a single object for easy import ─────────────────

export const BusinessRules = {
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
  TRANSITION_ROLES,
  SLA_WINDOWS,
};

// ─── 11. Live Exchange Rate Fetcher (R2 FIX) ─────────────────────────────────
//
// Replaces the previously hardcoded USD conversion rates with a live fetch
// from the European Central Bank (ECB) XML feed — free, no API key required.
// Falls back to a conservative in-memory cache on network failure.
//
// Usage:
//   const rate = await getExchangeRate("GHS", "USD");
//   const usd = amount / rate;  // convert GHS → USD

const _rateCache = new Map<string, { rate: number; fetchedAt: number }>();
const RATE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Conservative fallback rates (updated 2026-06) — used only when ECB is unreachable
const FALLBACK_RATES_TO_EUR: Record<string, number> = {
  USD: 1.08, GBP: 0.86, GHS: 16.5, RWF: 1430, KES: 140, NGN: 1680,
  ZAR: 20.1, XOF: 655.96, XAF: 655.96, SGD: 1.46, JPY: 163, CNY: 7.8,
};

/**
 * Returns the exchange rate from `fromCurrency` to `toCurrency`.
 * Fetches from ECB on first call or after TTL expiry; uses in-memory cache otherwise.
 */
export async function getExchangeRate(fromCurrency: string, toCurrency: string): Promise<number> {
  if (fromCurrency === toCurrency) return 1;

  const cacheKey = `${fromCurrency}:${toCurrency}`;
  const cached = _rateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < RATE_TTL_MS) return cached.rate;

  try {
    // ECB provides EUR-based rates; convert via EUR as pivot
    const res = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml", {
      signal: AbortSignal.timeout(5000),
    });
    const xml = await res.text();
    const rates: Record<string, number> = { EUR: 1 };
    const re = /currency='([A-Z]+)' rate='([0-9.]+)'/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) rates[m[1]] = parseFloat(m[2]);

    const fromRate = rates[fromCurrency] ?? FALLBACK_RATES_TO_EUR[fromCurrency];
    const toRate   = rates[toCurrency]   ?? FALLBACK_RATES_TO_EUR[toCurrency];
    if (!fromRate || !toRate) throw new Error(`Unknown currency pair: ${fromCurrency}/${toCurrency}`);

    const rate = toRate / fromRate;
    _rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
    return rate;
  } catch (err) {
    console.warn(`[ExchangeRate] ECB fetch failed (${err}), using fallback rates`);
    const fromRate = FALLBACK_RATES_TO_EUR[fromCurrency] ?? 1;
    const toRate   = FALLBACK_RATES_TO_EUR[toCurrency]   ?? 1;
    return toRate / fromRate;
  }
}

/**
 * Converts an amount from one currency to another using live rates.
 */
export async function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string
): Promise<{ convertedAmount: number; rate: number; source: "live" | "fallback" }> {
  const rate = await getExchangeRate(fromCurrency, toCurrency);
  return {
    convertedAmount: parseFloat((amount * rate).toFixed(2)),
    rate,
    source: _rateCache.has(`${fromCurrency}:${toCurrency}`) ? "live" : "fallback",
  };
}

// ─── 12. AEO Suspension Cascade (R2 FIX) ─────────────────────────────────────
//
// When an AEO certificate is suspended or revoked, the following must happen:
// 1. aeoApplications.status → "suspended" | "revoked"
// 2. stakeholderProfiles.aeoStatus → "suspended" | null
// 3. All pending declarations by this trader get risk re-scored (AEO discount removed)
// 4. Audit event logged
//
// This function returns the cascade payload; the caller (aeo.ts router) executes the DB writes.

export type AeoSuspensionReason =
  | "compliance_breach"
  | "criminal_investigation"
  | "customs_fraud"
  | "voluntary_withdrawal"
  | "non_renewal";

export interface AeoSuspensionCascade {
  newAeoStatus: "suspended" | "revoked";
  profileAeoStatus: "suspended" | null;
  riskScoreAdjustment: number;  // +20 points (AEO discount removed)
  requiresRiskRescore: boolean;
  auditNote: string;
}

export function computeAeoSuspensionCascade(
  reason: AeoSuspensionReason,
  isSuspension: boolean  // true = suspend, false = revoke
): AeoSuspensionCascade {
  const newAeoStatus = isSuspension ? "suspended" : "revoked";
  return {
    newAeoStatus,
    profileAeoStatus: isSuspension ? "suspended" : null,
    riskScoreAdjustment: +20,  // AEO discount was -20; removing it adds +20
    requiresRiskRescore: true,
    auditNote: `AEO certificate ${newAeoStatus} due to: ${reason}. ` +
      `All pending declarations will be re-scored without AEO preferential treatment.`,
  };
}

// ─── 13. Duty Drawback Time-Limit Enforcement (R2 FIX) ───────────────────────
//
// WCO Revised Kyoto Convention Chapter 4 Standard 4.15:
// Duty drawback claims must be filed within 3 years of the date of clearance.
// Some jurisdictions (Ghana: 1 year, Rwanda: 2 years) impose shorter limits.

export type DrawbackJurisdiction = "GH" | "RW" | "SG" | "default";

const DRAWBACK_DEADLINE_YEARS: Record<DrawbackJurisdiction, number> = {
  GH: 1,      // Ghana Customs Act 2022, Section 89
  RW: 2,      // Rwanda Revenue Authority Regulations
  SG: 3,      // Singapore Customs Act, Section 93
  default: 3, // WCO RKC Standard 4.15
};

export function checkDrawbackTimelimit(
  clearanceDate: Date,
  filingDate: Date = new Date(),
  jurisdiction: DrawbackJurisdiction = "default"
): { eligible: boolean; daysRemaining: number; deadlineDate: Date; error?: string } {
  const years = DRAWBACK_DEADLINE_YEARS[jurisdiction];
  const deadlineDate = new Date(clearanceDate);
  deadlineDate.setFullYear(deadlineDate.getFullYear() + years);

  const daysRemaining = Math.floor((deadlineDate.getTime() - filingDate.getTime()) / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return {
      eligible: false,
      daysRemaining,
      deadlineDate,
      error: `Drawback filing deadline exceeded. Claims must be filed within ${years} year(s) of clearance ` +
        `(${jurisdiction === "default" ? "WCO RKC Standard 4.15" : `${jurisdiction} jurisdiction`}). ` +
        `Clearance: ${clearanceDate.toISOString().slice(0, 10)}, Deadline: ${deadlineDate.toISOString().slice(0, 10)}.`,
    };
  }

  return { eligible: true, daysRemaining, deadlineDate };
}

// ─── 14. Payment Idempotency Key (SHA-256 upgrade) ───────────────────────────
//
// Replaces the weak bitwise hash in rule #7 with a proper SHA-256 HMAC.

export function generatePaymentIdempotencyKeySHA256(
  declarationId: number,
  amount: number,
  currency: string,
  traderId: number
): string {
  const raw = `${declarationId}:${amount.toFixed(2)}:${currency}:${traderId}`;
  return "PAY-" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16).toUpperCase();
}

// ─── Update BusinessRules export ─────────────────────────────────────────────
// Re-export the extended rules object (augments the one exported above)
export const BusinessRulesV2 = {
  ...BusinessRules,
  getExchangeRate,
  convertCurrency,
  computeAeoSuspensionCascade,
  checkDrawbackTimelimit,
  generatePaymentIdempotencyKeySHA256,
};
