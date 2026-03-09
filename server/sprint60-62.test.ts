/**
 * Sprint 60-62 Vitest Tests
 * Sprint 60: Duty Drawback Automation (eligibility, refund calculation, PDF generation)
 * Sprint 61: Trader Performance Scorecard (compliance score, percentile, AEO tier)
 * Sprint 62: Multi-Language i18n (locale structure, RTL detection, language codes)
 */
import { describe, it, expect } from "vitest";

// ─── Sprint 60: Duty Drawback Automation ─────────────────────────────────────

// Duty rates by HS chapter (first 2 digits)
const HS_DUTY_RATES: Record<string, number> = {
  "01": 0.0, "02": 0.05, "03": 0.05, "04": 0.10,
  "07": 0.05, "08": 0.05, "09": 0.10, "10": 0.05,
  "15": 0.10, "16": 0.15, "17": 0.10, "18": 0.15,
  "22": 0.20, "24": 0.25, "27": 0.05, "28": 0.05,
  "29": 0.05, "30": 0.05, "39": 0.10, "40": 0.10,
  "44": 0.05, "48": 0.05, "52": 0.10, "61": 0.20,
  "62": 0.20, "63": 0.15, "72": 0.05, "73": 0.10,
  "84": 0.05, "85": 0.05, "87": 0.10, "90": 0.05,
};

function getDutyRate(hsCode: string): number {
  const chapter = hsCode.slice(0, 2);
  return HS_DUTY_RATES[chapter] ?? 0.05;
}

interface DrawbackEligibilityInput {
  importDeclarationId: string;
  exportDeclarationId: string;
  importDate: Date;
  exportDate: Date;
  importHsCode: string;
  exportHsCode: string;
  importValueUsd: number;
  exportValueUsd: number;
  importQuantity: number;
  exportQuantity: number;
}

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  maxRefundUsd?: number;
  dutyRate?: number;
}

function checkDrawbackEligibility(input: DrawbackEligibilityInput): EligibilityResult {
  // Export must be after import
  if (input.exportDate <= input.importDate) {
    return { eligible: false, reason: "Export date must be after import date" };
  }

  // Export must be within 12 months of import
  const monthsDiff = (input.exportDate.getTime() - input.importDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsDiff > 12) {
    return { eligible: false, reason: "Export must be within 12 months of import" };
  }

  // HS codes must match at chapter level (first 2 digits)
  if (input.importHsCode.slice(0, 2) !== input.exportHsCode.slice(0, 2)) {
    return { eligible: false, reason: "HS code chapter mismatch between import and export" };
  }

  // Export quantity cannot exceed import quantity
  if (input.exportQuantity > input.importQuantity) {
    return { eligible: false, reason: "Export quantity exceeds import quantity" };
  }

  // Minimum import value $100
  if (input.importValueUsd < 100) {
    return { eligible: false, reason: "Import value below minimum threshold ($100)" };
  }

  const dutyRate = getDutyRate(input.importHsCode);
  const proportionExported = input.exportQuantity / input.importQuantity;
  const dutyPaid = input.importValueUsd * dutyRate;
  const maxRefundUsd = Math.round(dutyPaid * proportionExported * 0.99 * 100) / 100; // 99% drawback

  return {
    eligible: true,
    maxRefundUsd,
    dutyRate,
  };
}

function calculateDrawbackRefund(params: {
  importValueUsd: number;
  hsCode: string;
  exportQuantity: number;
  importQuantity: number;
  drawbackPercentage?: number;
}): { dutyPaid: number; refundAmount: number; effectiveRate: number } {
  const rate = getDutyRate(params.hsCode);
  const drawbackPct = params.drawbackPercentage ?? 0.99;
  const proportion = Math.min(params.exportQuantity / params.importQuantity, 1.0);
  const dutyPaid = params.importValueUsd * rate;
  const refundAmount = Math.round(dutyPaid * proportion * drawbackPct * 100) / 100;
  return { dutyPaid: Math.round(dutyPaid * 100) / 100, refundAmount, effectiveRate: rate };
}

describe("Sprint 60 — Duty Drawback Automation", () => {
  describe("checkDrawbackEligibility", () => {
    it("approves eligible drawback claim", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-001",
        exportDeclarationId: "EXP-001",
        importDate: new Date("2025-01-15"),
        exportDate: new Date("2025-06-10"),
        importHsCode: "8471.30",
        exportHsCode: "8471.41",
        importValueUsd: 50000,
        exportValueUsd: 55000,
        importQuantity: 100,
        exportQuantity: 80,
      });
      expect(result.eligible).toBe(true);
      expect(result.maxRefundUsd).toBeGreaterThan(0);
      expect(result.dutyRate).toBe(0.05);
    });

    it("rejects when export date is before import date", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-002",
        exportDeclarationId: "EXP-002",
        importDate: new Date("2025-06-01"),
        exportDate: new Date("2025-01-01"),
        importHsCode: "6101.20",
        exportHsCode: "6101.20",
        importValueUsd: 10000,
        exportValueUsd: 12000,
        importQuantity: 200,
        exportQuantity: 200,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Export date must be after import date");
    });

    it("rejects when export is more than 12 months after import", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-003",
        exportDeclarationId: "EXP-003",
        importDate: new Date("2023-01-01"),
        exportDate: new Date("2025-03-01"),
        importHsCode: "3004.90",
        exportHsCode: "3004.90",
        importValueUsd: 20000,
        exportValueUsd: 22000,
        importQuantity: 500,
        exportQuantity: 400,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("12 months");
    });

    it("rejects when HS code chapters do not match", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-004",
        exportDeclarationId: "EXP-004",
        importDate: new Date("2025-01-01"),
        exportDate: new Date("2025-04-01"),
        importHsCode: "8471.30",
        exportHsCode: "6101.20",
        importValueUsd: 15000,
        exportValueUsd: 16000,
        importQuantity: 50,
        exportQuantity: 50,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("HS code chapter mismatch");
    });

    it("rejects when export quantity exceeds import quantity", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-005",
        exportDeclarationId: "EXP-005",
        importDate: new Date("2025-01-01"),
        exportDate: new Date("2025-03-01"),
        importHsCode: "7208.10",
        exportHsCode: "7208.10",
        importValueUsd: 30000,
        exportValueUsd: 32000,
        importQuantity: 100,
        exportQuantity: 150, // exceeds import
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("Export quantity exceeds import quantity");
    });

    it("rejects when import value is below minimum threshold", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-006",
        exportDeclarationId: "EXP-006",
        importDate: new Date("2025-01-01"),
        exportDate: new Date("2025-02-01"),
        importHsCode: "8471.30",
        exportHsCode: "8471.30",
        importValueUsd: 50, // below $100
        exportValueUsd: 60,
        importQuantity: 1,
        exportQuantity: 1,
      });
      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("minimum threshold");
    });

    it("calculates correct 99% drawback on partial export", () => {
      const result = checkDrawbackEligibility({
        importDeclarationId: "IMP-007",
        exportDeclarationId: "EXP-007",
        importDate: new Date("2025-02-01"),
        exportDate: new Date("2025-05-01"),
        importHsCode: "6101.20", // 20% duty
        exportHsCode: "6101.30",
        importValueUsd: 100000,
        exportValueUsd: 110000,
        importQuantity: 1000,
        exportQuantity: 500, // 50% exported
      });
      expect(result.eligible).toBe(true);
      // Duty paid: 100000 * 0.20 = 20000
      // Proportion: 500/1000 = 0.5
      // Refund: 20000 * 0.5 * 0.99 = 9900
      expect(result.maxRefundUsd).toBe(9900);
    });
  });

  describe("calculateDrawbackRefund", () => {
    it("calculates full refund for 100% re-export", () => {
      const result = calculateDrawbackRefund({
        importValueUsd: 50000,
        hsCode: "2204.10", // 20% duty
        exportQuantity: 100,
        importQuantity: 100,
      });
      expect(result.dutyPaid).toBe(10000);
      expect(result.refundAmount).toBe(9900); // 99% of 10000
      expect(result.effectiveRate).toBe(0.20);
    });

    it("calculates partial refund for 60% re-export", () => {
      const result = calculateDrawbackRefund({
        importValueUsd: 100000,
        hsCode: "8471.30", // 5% duty
        exportQuantity: 60,
        importQuantity: 100,
      });
      expect(result.dutyPaid).toBe(5000);
      // 5000 * 0.6 * 0.99 = 2970
      expect(result.refundAmount).toBe(2970);
    });

    it("caps proportion at 1.0 even if exportQuantity > importQuantity", () => {
      const result = calculateDrawbackRefund({
        importValueUsd: 10000,
        hsCode: "8471.30",
        exportQuantity: 200,
        importQuantity: 100,
      });
      // proportion capped at 1.0
      expect(result.refundAmount).toBe(495); // 10000 * 0.05 * 1.0 * 0.99
    });

    it("uses custom drawback percentage when provided", () => {
      const result = calculateDrawbackRefund({
        importValueUsd: 10000,
        hsCode: "8471.30",
        exportQuantity: 100,
        importQuantity: 100,
        drawbackPercentage: 0.75,
      });
      expect(result.refundAmount).toBe(375); // 10000 * 0.05 * 1.0 * 0.75
    });
  });
});

// ─── Sprint 61: Trader Performance Scorecard ─────────────────────────────────

interface MonthlyRecord {
  month: string; // YYYY-MM
  cleared: number;
  rejected: number;
  underReview: number;
  avgClearanceHours: number;
}

function calculateComplianceScore(history: MonthlyRecord[]): number {
  if (history.length === 0) return 0;
  const total = history.reduce((s, h) => s + h.cleared + h.rejected + h.underReview, 0);
  if (total === 0) return 0;
  const cleared = history.reduce((s, h) => s + h.cleared, 0);
  const rejected = history.reduce((s, h) => s + h.rejected, 0);
  const avgHours = history.reduce((s, h) => s + h.avgClearanceHours, 0) / history.length;

  const clearanceRate = cleared / total;
  const rejectionRate = rejected / total;
  const speedScore = Math.max(0, 1 - avgHours / 72); // 0h = 1.0, 72h+ = 0

  const score = (clearanceRate * 50) + ((1 - rejectionRate) * 30) + (speedScore * 20);
  return Math.round(Math.min(100, Math.max(0, score)));
}

function getAeoTier(score: number): "gold" | "silver" | "standard" | "none" {
  if (score >= 90) return "gold";
  if (score >= 75) return "silver";
  if (score >= 60) return "standard";
  return "none";
}

function getClearancePercentile(traderAvgHours: number, population: number[]): number {
  if (population.length === 0) return 50;
  const faster = population.filter((h) => h > traderAvgHours).length;
  return Math.round((faster / population.length) * 100);
}

function getRejectionTrend(history: MonthlyRecord[]): { improving: boolean; delta: number } {
  if (history.length < 2) return { improving: false, delta: 0 };
  const recent = history.slice(-3);
  const older = history.slice(-6, -3);
  if (older.length === 0) return { improving: false, delta: 0 };

  const recentRate = recent.reduce((s, h) => {
    const t = h.cleared + h.rejected + h.underReview;
    return s + (t > 0 ? h.rejected / t : 0);
  }, 0) / recent.length;

  const olderRate = older.reduce((s, h) => {
    const t = h.cleared + h.rejected + h.underReview;
    return s + (t > 0 ? h.rejected / t : 0);
  }, 0) / older.length;

  const delta = recentRate - olderRate;
  return { improving: delta < 0, delta: Math.round(delta * 1000) / 10 };
}

describe("Sprint 61 — Trader Performance Scorecard", () => {
  const goodHistory: MonthlyRecord[] = Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, "0")}`,
    cleared: 95,
    rejected: 2,
    underReview: 3,
    avgClearanceHours: 6,
  }));

  const poorHistory: MonthlyRecord[] = Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, "0")}`,
    cleared: 60,
    rejected: 30,
    underReview: 10,
    avgClearanceHours: 48,
  }));

  describe("calculateComplianceScore", () => {
    it("returns high score for excellent trader", () => {
      const score = calculateComplianceScore(goodHistory);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it("returns low score for poor compliance", () => {
      const score = calculateComplianceScore(poorHistory);
      expect(score).toBeLessThan(60);
    });

    it("returns 0 for empty history", () => {
      expect(calculateComplianceScore([])).toBe(0);
    });

    it("returns 0 for zero declarations", () => {
      const emptyMonths: MonthlyRecord[] = [
        { month: "2025-01", cleared: 0, rejected: 0, underReview: 0, avgClearanceHours: 0 },
      ];
      expect(calculateComplianceScore(emptyMonths)).toBe(0);
    });

    it("caps score at 100", () => {
      const perfectHistory: MonthlyRecord[] = Array.from({ length: 12 }, (_, i) => ({
        month: `2025-${String(i + 1).padStart(2, "0")}`,
        cleared: 100,
        rejected: 0,
        underReview: 0,
        avgClearanceHours: 0,
      }));
      const score = calculateComplianceScore(perfectHistory);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe("getAeoTier", () => {
    it("returns gold for score >= 90", () => {
      expect(getAeoTier(90)).toBe("gold");
      expect(getAeoTier(95)).toBe("gold");
      expect(getAeoTier(100)).toBe("gold");
    });

    it("returns silver for score 75-89", () => {
      expect(getAeoTier(75)).toBe("silver");
      expect(getAeoTier(82)).toBe("silver");
      expect(getAeoTier(89)).toBe("silver");
    });

    it("returns standard for score 60-74", () => {
      expect(getAeoTier(60)).toBe("standard");
      expect(getAeoTier(67)).toBe("standard");
      expect(getAeoTier(74)).toBe("standard");
    });

    it("returns none for score < 60", () => {
      expect(getAeoTier(0)).toBe("none");
      expect(getAeoTier(59)).toBe("none");
    });
  });

  describe("getClearancePercentile", () => {
    const population = [4, 6, 8, 10, 12, 16, 24, 36, 48, 72];

    it("returns high percentile for fast trader", () => {
      const pct = getClearancePercentile(3, population);
      expect(pct).toBe(100); // faster than all
    });

    it("returns 0 percentile for slowest trader", () => {
      const pct = getClearancePercentile(100, population);
      expect(pct).toBe(0); // slower than all
    });

    it("returns 50th percentile for median trader", () => {
      const pct = getClearancePercentile(11, population);
      // 5 traders slower (12,16,24,36,48,72) out of 10 → 60th
      expect(pct).toBeGreaterThan(40);
      expect(pct).toBeLessThan(80);
    });

    it("returns 50 for empty population", () => {
      expect(getClearancePercentile(10, [])).toBe(50);
    });
  });

  describe("getRejectionTrend", () => {
    it("detects improving trend when recent rejections are lower", () => {
      const history: MonthlyRecord[] = [
        // older 3 months: high rejection
        { month: "2025-01", cleared: 70, rejected: 20, underReview: 10, avgClearanceHours: 12 },
        { month: "2025-02", cleared: 72, rejected: 18, underReview: 10, avgClearanceHours: 12 },
        { month: "2025-03", cleared: 74, rejected: 16, underReview: 10, avgClearanceHours: 12 },
        // recent 3 months: low rejection
        { month: "2025-04", cleared: 90, rejected: 5, underReview: 5, avgClearanceHours: 8 },
        { month: "2025-05", cleared: 92, rejected: 4, underReview: 4, avgClearanceHours: 8 },
        { month: "2025-06", cleared: 93, rejected: 3, underReview: 4, avgClearanceHours: 8 },
      ];
      const trend = getRejectionTrend(history);
      expect(trend.improving).toBe(true);
      expect(trend.delta).toBeLessThan(0);
    });

    it("detects worsening trend when recent rejections are higher", () => {
      const history: MonthlyRecord[] = [
        { month: "2025-01", cleared: 95, rejected: 2, underReview: 3, avgClearanceHours: 6 },
        { month: "2025-02", cleared: 94, rejected: 2, underReview: 4, avgClearanceHours: 6 },
        { month: "2025-03", cleared: 93, rejected: 3, underReview: 4, avgClearanceHours: 6 },
        { month: "2025-04", cleared: 80, rejected: 12, underReview: 8, avgClearanceHours: 18 },
        { month: "2025-05", cleared: 78, rejected: 14, underReview: 8, avgClearanceHours: 20 },
        { month: "2025-06", cleared: 76, rejected: 16, underReview: 8, avgClearanceHours: 22 },
      ];
      const trend = getRejectionTrend(history);
      expect(trend.improving).toBe(false);
      expect(trend.delta).toBeGreaterThan(0);
    });

    it("returns no trend for single month", () => {
      const history: MonthlyRecord[] = [
        { month: "2025-01", cleared: 90, rejected: 5, underReview: 5, avgClearanceHours: 8 },
      ];
      const trend = getRejectionTrend(history);
      expect(trend.improving).toBe(false);
      expect(trend.delta).toBe(0);
    });
  });
});

// ─── Sprint 62: Multi-Language i18n ──────────────────────────────────────────

const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", dir: "ltr" as const },
  { code: "fr", label: "Français", dir: "ltr" as const },
  { code: "ar", label: "العربية", dir: "rtl" as const },
];

const RTL_LANGUAGES = new Set(["ar"]);

function getDocumentDirection(lang: string): "ltr" | "rtl" {
  return RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
}

function isLanguageSupported(code: string): boolean {
  return SUPPORTED_LANGUAGES.some((l) => l.code === code);
}

// Sample translation keys that must exist in all locales
const REQUIRED_KEYS = [
  "app.name",
  "app.tagline",
  "nav.declarations",
  "nav.logout",
  "status.cleared",
  "status.rejected",
  "declaration.new",
  "declaration.hsCode",
  "risk.green",
  "risk.red",
  "aeo.title",
  "common.loading",
  "common.save",
  "common.cancel",
  "language.select",
];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce((acc: unknown, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

import enTranslation from "../client/src/i18n/locales/en/translation.json";
import frTranslation from "../client/src/i18n/locales/fr/translation.json";
import arTranslation from "../client/src/i18n/locales/ar/translation.json";

describe("Sprint 62 — Multi-Language i18n", () => {
  describe("Language configuration", () => {
    it("supports exactly 3 languages: en, fr, ar", () => {
      expect(SUPPORTED_LANGUAGES).toHaveLength(3);
      const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
      expect(codes).toContain("en");
      expect(codes).toContain("fr");
      expect(codes).toContain("ar");
    });

    it("English and French are LTR", () => {
      const en = SUPPORTED_LANGUAGES.find((l) => l.code === "en");
      const fr = SUPPORTED_LANGUAGES.find((l) => l.code === "fr");
      expect(en?.dir).toBe("ltr");
      expect(fr?.dir).toBe("ltr");
    });

    it("Arabic is RTL", () => {
      const ar = SUPPORTED_LANGUAGES.find((l) => l.code === "ar");
      expect(ar?.dir).toBe("rtl");
    });

    it("isLanguageSupported returns true for supported codes", () => {
      expect(isLanguageSupported("en")).toBe(true);
      expect(isLanguageSupported("fr")).toBe(true);
      expect(isLanguageSupported("ar")).toBe(true);
    });

    it("isLanguageSupported returns false for unsupported codes", () => {
      expect(isLanguageSupported("zh")).toBe(false);
      expect(isLanguageSupported("es")).toBe(false);
      expect(isLanguageSupported("de")).toBe(false);
      expect(isLanguageSupported("")).toBe(false);
    });
  });

  describe("RTL direction detection", () => {
    it("returns rtl for Arabic", () => {
      expect(getDocumentDirection("ar")).toBe("rtl");
    });

    it("returns ltr for English", () => {
      expect(getDocumentDirection("en")).toBe("ltr");
    });

    it("returns ltr for French", () => {
      expect(getDocumentDirection("fr")).toBe("ltr");
    });

    it("returns ltr for unknown language (safe default)", () => {
      expect(getDocumentDirection("zh")).toBe("ltr");
      expect(getDocumentDirection("")).toBe("ltr");
    });
  });

  describe("English locale completeness", () => {
    REQUIRED_KEYS.forEach((key) => {
      it(`has translation key: ${key}`, () => {
        const value = getNestedValue(enTranslation as unknown as Record<string, unknown>, key);
        expect(value).toBeDefined();
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe("French locale completeness", () => {
    REQUIRED_KEYS.forEach((key) => {
      it(`has translation key: ${key}`, () => {
        const value = getNestedValue(frTranslation as unknown as Record<string, unknown>, key);
        expect(value).toBeDefined();
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe("Arabic locale completeness", () => {
    REQUIRED_KEYS.forEach((key) => {
      it(`has translation key: ${key}`, () => {
        const value = getNestedValue(arTranslation as unknown as Record<string, unknown>, key);
        expect(value).toBeDefined();
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
      });
    });
  });

  describe("Locale content validation", () => {
    it("English app name is correct", () => {
      expect(enTranslation.app.name).toBe("TradeGateway™ NGSWTP");
    });

    it("French app name is correct", () => {
      expect(frTranslation.app.name).toBe("TradeGateway™ NGSWTP");
    });

    it("Arabic app name is correct", () => {
      expect(arTranslation.app.name).toBe("TradeGateway™ NGSWTP");
    });

    it("French translations differ from English", () => {
      expect(frTranslation.nav.logout).not.toBe(enTranslation.nav.logout);
      expect(frTranslation.status.cleared).not.toBe(enTranslation.status.cleared);
    });

    it("Arabic translations differ from English", () => {
      expect(arTranslation.nav.logout).not.toBe(enTranslation.nav.logout);
      expect(arTranslation.status.cleared).not.toBe(enTranslation.status.cleared);
    });

    it("all locales have the same number of top-level keys", () => {
      const enKeys = Object.keys(enTranslation).sort();
      const frKeys = Object.keys(frTranslation).sort();
      const arKeys = Object.keys(arTranslation).sort();
      expect(frKeys).toEqual(enKeys);
      expect(arKeys).toEqual(enKeys);
    });
  });
});
