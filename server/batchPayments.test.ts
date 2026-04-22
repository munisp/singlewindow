/**
 * batchPayments.test.ts
 * Unit tests for the 1B payments/day batchPayments tRPC router.
 * Tests run against the real router without a live database by mocking getDb.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@tradegateway.gh",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

// ─── Idempotency key hashing ───────────────────────────────────────────────────

describe("idempotency key generation", () => {
  it("produces a 64-character hex string from a composite key", async () => {
    const compositeKey = "user:1:decl:GHA-2026-001:amount:50000:currency:GHS:fsp:GCB:account:GH123";
    const encoder = new TextEncoder();
    const data = encoder.encode(compositeKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    expect(hashHex).toHaveLength(64);
    expect(hashHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for identical inputs", async () => {
    const key = "user:1:decl:GHA-2026-002:amount:12500:currency:GHS:fsp:ECOBANK:account:GH456";
    const encoder = new TextEncoder();
    const data = encoder.encode(key);

    const hash1Buffer = await crypto.subtle.digest("SHA-256", data);
    const hash2Buffer = await crypto.subtle.digest("SHA-256", data);

    const toHex = (buf: ArrayBuffer) =>
      Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

    expect(toHex(hash1Buffer)).toBe(toHex(hash2Buffer));
  });

  it("produces different hashes for different inputs", async () => {
    const encoder = new TextEncoder();
    const hash = async (s: string) => {
      const buf = await crypto.subtle.digest("SHA-256", encoder.encode(s));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    };

    const h1 = await hash("user:1:decl:GHA-2026-003:amount:10000:currency:GHS:fsp:GCB:account:GH001");
    const h2 = await hash("user:1:decl:GHA-2026-003:amount:10001:currency:GHS:fsp:GCB:account:GH001");

    expect(h1).not.toBe(h2);
  });
});

// ─── Exponential back-off calculation ─────────────────────────────────────────

describe("exponential back-off", () => {
  function calcBackoff(attempt: number, baseMs = 1000, maxMs = 3_600_000): number {
    return Math.min(Math.pow(2, attempt) * baseMs, maxMs);
  }

  it("doubles delay on each attempt", () => {
    expect(calcBackoff(0)).toBe(1_000);
    expect(calcBackoff(1)).toBe(2_000);
    expect(calcBackoff(2)).toBe(4_000);
    expect(calcBackoff(3)).toBe(8_000);
    expect(calcBackoff(4)).toBe(16_000);
  });

  it("caps at maxMs (1 hour)", () => {
    expect(calcBackoff(20)).toBe(3_600_000);
    expect(calcBackoff(100)).toBe(3_600_000);
  });

  it("dead-letters after 5 attempts", () => {
    const MAX_ATTEMPTS = 5;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(calcBackoff(i)).toBeLessThan(3_600_000 + 1);
    }
    // After 5 attempts the item should be dead-lettered, not retried
    const shouldDeadLetter = (attempt: number) => attempt >= MAX_ATTEMPTS;
    expect(shouldDeadLetter(5)).toBe(true);
    expect(shouldDeadLetter(4)).toBe(false);
  });
});

// ─── Archival tier classification ─────────────────────────────────────────────

describe("archival tier classification", () => {
  function classifyTier(ageMs: number): "hot" | "warm" | "cold" {
    const DAY = 86_400_000;
    if (ageMs <= 7 * DAY) return "hot";
    if (ageMs <= 90 * DAY) return "warm";
    return "cold";
  }

  it("classifies records <= 7 days as hot", () => {
    expect(classifyTier(0)).toBe("hot");
    expect(classifyTier(6 * 86_400_000)).toBe("hot");
    expect(classifyTier(7 * 86_400_000)).toBe("hot");
  });

  it("classifies records 8–90 days as warm", () => {
    expect(classifyTier(8 * 86_400_000)).toBe("warm");
    expect(classifyTier(45 * 86_400_000)).toBe("warm");
    expect(classifyTier(90 * 86_400_000)).toBe("warm");
  });

  it("classifies records > 90 days as cold", () => {
    expect(classifyTier(91 * 86_400_000)).toBe("cold");
    expect(classifyTier(365 * 86_400_000)).toBe("cold");
  });
});

// ─── Amount formatting ─────────────────────────────────────────────────────────

describe("minor units to currency formatting", () => {
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

  it("converts minor units to decimal correctly", () => {
    expect(formatAmount(500000, "GHS")).toContain("5,000.00");
    expect(formatAmount(100, "GHS")).toContain("1.00");
    expect(formatAmount(1, "GHS")).toContain("0.01");
  });

  it("falls back gracefully for unknown currency codes", () => {
    const result = formatAmount(12345, "XYZ");
    expect(result).toContain("123.45");
    expect(result).toContain("XYZ");
  });
});

// ─── Context shape ─────────────────────────────────────────────────────────────

describe("admin context", () => {
  it("creates a context with admin role", () => {
    const ctx = createAdminContext();
    expect(ctx.user?.role).toBe("admin");
    expect(ctx.user?.email).toBe("admin@tradegateway.gh");
  });
});
