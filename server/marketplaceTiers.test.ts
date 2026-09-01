/**
 * Phase 12 — marketplace monetization tier tests (pure pricing/period logic).
 */
import { describe, it, expect } from "vitest";
import {
  MarketplaceBillingError,
  MAX_INVOICE_PERIOD_DAYS,
  normalizeInvoicePeriod,
  priceBucket,
} from "./marketplace/tiers";

describe("priceBucket", () => {
  it("prices production calls at the tier unit price", () => {
    expect(priceBucket(1000, "0.002", false)).toBe("2.000000");
    expect(priceBucket(1, "0.001", false)).toBe("0.001000");
  });

  it("zero-rates sandbox calls", () => {
    expect(priceBucket(5000, "0.002", true)).toBe("0");
  });

  it("zero-rates empty buckets", () => {
    expect(priceBucket(0, "0.002", false)).toBe("0");
  });

  it("fails closed on invalid unit prices", () => {
    expect(() => priceBucket(10, "not-a-number", false)).toThrow(MarketplaceBillingError);
    expect(() => priceBucket(10, "-0.5", false)).toThrow(MarketplaceBillingError);
  });
});

describe("normalizeInvoicePeriod", () => {
  const now = new Date("2026-02-01T00:00:00Z");

  it("accepts a bounded past period", () => {
    const { from, to } = normalizeInvoicePeriod("2026-01-01", "2026-01-31", now);
    expect(from.toISOString()).toContain("2026-01-01");
    expect(to.toISOString()).toContain("2026-01-31");
  });

  it("rejects inverted periods", () => {
    expect(() => normalizeInvoicePeriod("2026-01-31", "2026-01-01", now)).toThrow(/precede/);
  });

  it("rejects invalid dates", () => {
    expect(() => normalizeInvoicePeriod("junk", "2026-01-01", now)).toThrow(/valid ISO/);
  });

  it("rejects future-bounded periods", () => {
    expect(() => normalizeInvoicePeriod("2026-01-01", "2026-03-01", now)).toThrow(/future/);
  });

  it("enforces the maximum period", () => {
    expect(() => normalizeInvoicePeriod("2025-01-01", "2026-01-31", now)).toThrow(
      new RegExp(String(MAX_INVOICE_PERIOD_DAYS))
    );
  });
});
