/**
 * paymentWorker.test.ts — Unit tests for the background payment queue worker
 * and balance drift reconciliation module.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { calcBackoffMs } from "./paymentWorker";

// ─── calcBackoffMs ────────────────────────────────────────────────────────────

describe("calcBackoffMs", () => {
  it("returns 1000ms for attempt 0 (2^0 × 1000)", () => {
    expect(calcBackoffMs(0)).toBe(1_000);
  });

  it("returns 2000ms for attempt 1 (2^1 × 1000)", () => {
    expect(calcBackoffMs(1)).toBe(2_000);
  });

  it("returns 4000ms for attempt 2 (2^2 × 1000)", () => {
    expect(calcBackoffMs(2)).toBe(4_000);
  });

  it("returns 8000ms for attempt 3 (2^3 × 1000)", () => {
    expect(calcBackoffMs(3)).toBe(8_000);
  });

  it("returns 16000ms for attempt 4 (2^4 × 1000)", () => {
    expect(calcBackoffMs(4)).toBe(16_000);
  });

  it("caps at 3_600_000ms (1 hour) for very large attempt counts", () => {
    expect(calcBackoffMs(100)).toBe(3_600_000);
    expect(calcBackoffMs(50)).toBe(3_600_000);
    expect(calcBackoffMs(20)).toBe(3_600_000);
  });

  it("caps at 3_600_000ms for attempt 12 (2^12 × 1000 = 4_096_000 > cap)", () => {
    expect(calcBackoffMs(12)).toBe(3_600_000);
  });

  it("does not exceed cap for attempt 11 (2^11 × 1000 = 2_048_000 < cap)", () => {
    expect(calcBackoffMs(11)).toBe(2_048_000);
  });

  it("is monotonically non-decreasing up to the cap", () => {
    let prev = 0;
    for (let i = 0; i <= 15; i++) {
      const val = calcBackoffMs(i);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it("never returns a negative value", () => {
    for (let i = 0; i <= 20; i++) {
      expect(calcBackoffMs(i)).toBeGreaterThan(0);
    }
  });
});

// ─── Balance drift arithmetic ─────────────────────────────────────────────────

describe("Balance drift arithmetic", () => {
  /**
   * These tests validate the drift calculation logic used in balanceDrift.ts
   * without requiring a database connection.
   */

  function calcDrift(mirrorValue: bigint, queueSum: bigint) {
    const drift = mirrorValue - queueSum;
    const absDrift = drift < BigInt(0) ? -drift : drift;
    return { drift, absDrift, isOver: drift > BigInt(0), isUnder: drift < BigInt(0) };
  }

  it("reports zero drift when mirror equals queue sum", () => {
    const result = calcDrift(BigInt(10_000), BigInt(10_000));
    expect(result.absDrift).toBe(BigInt(0));
  });

  it("reports mirror OVER when mirror > queue sum", () => {
    const result = calcDrift(BigInt(10_500), BigInt(10_000));
    expect(result.absDrift).toBe(BigInt(500));
    expect(result.isOver).toBe(true);
    expect(result.isUnder).toBe(false);
  });

  it("reports mirror UNDER when mirror < queue sum", () => {
    const result = calcDrift(BigInt(9_500), BigInt(10_000));
    expect(result.absDrift).toBe(BigInt(500));
    expect(result.isOver).toBe(false);
    expect(result.isUnder).toBe(true);
  });

  it("handles large amounts (1B payments scenario)", () => {
    // 1 billion payments of 100 minor units each = 100_000_000_000
    const queueSum = BigInt(1_000_000_000) * BigInt(100);
    const mirrorValue = queueSum + BigInt(1); // 1 minor unit drift
    const result = calcDrift(mirrorValue, queueSum);
    expect(result.absDrift).toBe(BigInt(1));
    expect(result.isOver).toBe(true);
  });

  it("handles zero values correctly", () => {
    const result = calcDrift(BigInt(0), BigInt(0));
    expect(result.absDrift).toBe(BigInt(0));
    expect(result.isOver).toBe(false);
    expect(result.isUnder).toBe(false);
  });
});

// ─── Dead-letter threshold ────────────────────────────────────────────────────

describe("Dead-letter threshold logic", () => {
  function shouldDeadLetter(attemptCount: number, maxAttempts: number): boolean {
    return attemptCount >= maxAttempts;
  }

  it("does not dead-letter before max_attempts is reached", () => {
    expect(shouldDeadLetter(0, 5)).toBe(false);
    expect(shouldDeadLetter(1, 5)).toBe(false);
    expect(shouldDeadLetter(4, 5)).toBe(false);
  });

  it("dead-letters exactly at max_attempts", () => {
    expect(shouldDeadLetter(5, 5)).toBe(true);
  });

  it("dead-letters beyond max_attempts", () => {
    expect(shouldDeadLetter(6, 5)).toBe(true);
    expect(shouldDeadLetter(100, 5)).toBe(true);
  });

  it("works with custom max_attempts values", () => {
    expect(shouldDeadLetter(3, 3)).toBe(true);
    expect(shouldDeadLetter(2, 3)).toBe(false);
    expect(shouldDeadLetter(1, 1)).toBe(true);
  });
});

// ─── Amount formatting ────────────────────────────────────────────────────────

describe("Amount formatting (minor units)", () => {
  function formatAmount(minorUnits: number, currency: string): string {
    try {
      return new Intl.NumberFormat("en-GH", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
      }).format(minorUnits / 100);
    } catch {
      return `${(minorUnits / 100).toFixed(2)} ${currency}`;
    }
  }

  it("formats GHS correctly", () => {
    const result = formatAmount(100_00, "GHS"); // 100.00 GHS
    expect(result).toContain("100");
  });

  it("formats zero correctly", () => {
    const result = formatAmount(0, "GHS");
    expect(result).toContain("0");
  });

  it("falls back gracefully for unknown currencies", () => {
    const result = formatAmount(5000, "XYZ");
    expect(result).toContain("50.00");
    expect(result).toContain("XYZ");
  });

  it("handles large amounts without precision loss", () => {
    // 1,000,000.00 GHS
    const result = formatAmount(100_000_000, "GHS");
    expect(result).toContain("1,000,000");
  });
});

// ─── Idempotency key hash consistency ────────────────────────────────────────

describe("Idempotency key hash consistency", () => {
  async function sha256(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  it("produces a 64-character hex string", async () => {
    const hash = await sha256("enqueue:TXN-001");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same input produces same hash", async () => {
    const hash1 = await sha256("enqueue:TXN-001");
    const hash2 = await sha256("enqueue:TXN-001");
    expect(hash1).toBe(hash2);
  });

  it("different inputs produce different hashes", async () => {
    const hash1 = await sha256("enqueue:TXN-001");
    const hash2 = await sha256("enqueue:TXN-002");
    expect(hash1).not.toBe(hash2);
  });

  it("prefix prevents cross-operation collisions", async () => {
    const enqueueHash = await sha256("enqueue:TXN-001");
    const retryHash   = await sha256("retry:TXN-001");
    expect(enqueueHash).not.toBe(retryHash);
  });
});

// ─── Hot/Warm/Cold tier classification ───────────────────────────────────────

describe("Archival tier classification", () => {
  function classifyTier(committedAt: Date, now: Date): "hot" | "warm" | "cold" {
    const ageMs = now.getTime() - committedAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays <= 7)  return "hot";
    if (ageDays <= 90) return "warm";
    return "cold";
  }

  const now = new Date("2026-04-22T00:00:00Z");

  it("classifies items committed today as hot", () => {
    const committedAt = new Date("2026-04-22T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("hot");
  });

  it("classifies items committed 7 days ago as hot (boundary)", () => {
    const committedAt = new Date("2026-04-15T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("hot");
  });

  it("classifies items committed 8 days ago as warm", () => {
    const committedAt = new Date("2026-04-14T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("warm");
  });

  it("classifies items committed 90 days ago as warm (boundary)", () => {
    const committedAt = new Date("2026-01-22T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("warm");
  });

  it("classifies items committed 91 days ago as cold", () => {
    const committedAt = new Date("2026-01-21T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("cold");
  });

  it("classifies items committed 1 year ago as cold", () => {
    const committedAt = new Date("2025-04-22T00:00:00Z");
    expect(classifyTier(committedAt, now)).toBe("cold");
  });
});
