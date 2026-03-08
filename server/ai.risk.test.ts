/**
 * ai.risk.test.ts — Unit tests for the AI risk scoring (ai.scoreRisk) procedure
 *
 * Tests cover:
 *  - Authentication: unauthenticated callers are rejected (UNAUTHORIZED)
 *  - Input validation: required fields, value ranges, string lengths
 *  - Response shape: all expected fields present and correctly typed
 *  - Risk lane values: only GREEN, YELLOW, RED, BLUE are valid
 *  - Risk score range: 0–100
 *  - Recommended action values: one of the four valid actions
 *  - Optional traderProfile: accepted when provided, omitted when not
 *  - Fallback behaviour: procedure returns a valid response even when LLM fails
 *
 * NOTE: The LLM call is made to the real Forge endpoint in CI. If the endpoint
 * is unavailable the procedure falls back to a structured default response —
 * tests verify that the fallback also satisfies the schema.
 */

import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── Context factories ────────────────────────────────────────────────────────

function makeCtx(role = "user"): TrpcContext {
  return {
    user: {
      id: 42,
      openId: `test-${role}`,
      email: `${role}@example.com`,
      name: `Test ${role}`,
      loginMethod: "manus",
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function makePublicCtx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

// ─── Minimal valid input ──────────────────────────────────────────────────────

const VALID_INPUT = {
  declarationId: "DECL-2026-001",
  hsCode: "8471.30.00",
  goodsDescription: "Portable laptop computers for office use",
  countryOfOrigin: "CN",
  consigneeCountry: "GH",
  declaredValue: 50_000,
  weight: 500,
} as const;

// ─── Authentication ───────────────────────────────────────────────────────────

describe("ai.scoreRisk — authentication", () => {
  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(caller.ai.scoreRisk(VALID_INPUT)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("allows authenticated user role to call scoreRisk", async () => {
    const caller = appRouter.createCaller(makeCtx("user"));
    // Should not throw UNAUTHORIZED or FORBIDDEN
    const result = await caller.ai.scoreRisk(VALID_INPUT);
    expect(result).toBeDefined();
  });
});

// ─── Input validation ─────────────────────────────────────────────────────────

describe("ai.scoreRisk — input validation", () => {
  it("rejects missing declarationId", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const input = { ...VALID_INPUT } as Record<string, unknown>;
    delete input.declarationId;
    await expect(caller.ai.scoreRisk(input as typeof VALID_INPUT)).rejects.toThrow();
  });

  it("rejects missing hsCode", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const input = { ...VALID_INPUT } as Record<string, unknown>;
    delete input.hsCode;
    await expect(caller.ai.scoreRisk(input as typeof VALID_INPUT)).rejects.toThrow();
  });

  it("rejects missing goodsDescription", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const input = { ...VALID_INPUT } as Record<string, unknown>;
    delete input.goodsDescription;
    await expect(caller.ai.scoreRisk(input as typeof VALID_INPUT)).rejects.toThrow();
  });

  it("rejects missing countryOfOrigin", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const input = { ...VALID_INPUT } as Record<string, unknown>;
    delete input.countryOfOrigin;
    await expect(caller.ai.scoreRisk(input as typeof VALID_INPUT)).rejects.toThrow();
  });

  it("rejects missing consigneeCountry", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const input = { ...VALID_INPUT } as Record<string, unknown>;
    delete input.consigneeCountry;
    await expect(caller.ai.scoreRisk(input as typeof VALID_INPUT)).rejects.toThrow();
  });

  it("accepts zero declaredValue (no lower bound in schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // The schema uses z.number() without .positive() — zero is accepted
    const result = await caller.ai.scoreRisk({ ...VALID_INPUT, declaredValue: 0 });
    expect(result).toBeDefined();
    expect(["GREEN", "YELLOW", "RED", "BLUE"]).toContain(result.riskLane);
  });

  it("accepts zero weight (no lower bound in schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // The schema uses z.number() without .positive() — zero is accepted
    const result = await caller.ai.scoreRisk({ ...VALID_INPUT, weight: 0 });
    expect(result).toBeDefined();
    expect(["GREEN", "YELLOW", "RED", "BLUE"]).toContain(result.riskLane);
  });

  it("accepts optional traderProfile when provided", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk({
      ...VALID_INPUT,
      traderProfile: {
        isAEO: true,
        complianceScore: 95,
        previousViolations: 0,
      },
    });
    expect(result).toBeDefined();
  });

  it("rejects traderProfile.complianceScore > 100", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.ai.scoreRisk({
        ...VALID_INPUT,
        traderProfile: { isAEO: false, complianceScore: 101, previousViolations: 0 },
      })
    ).rejects.toThrow();
  });

  it("rejects traderProfile.complianceScore < 0", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.ai.scoreRisk({
        ...VALID_INPUT,
        traderProfile: { isAEO: false, complianceScore: -1, previousViolations: 0 },
      })
    ).rejects.toThrow();
  });
});

// ─── Response shape ───────────────────────────────────────────────────────────

describe("ai.scoreRisk — response shape", () => {
  it("returns all required fields", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(result).toHaveProperty("riskScore");
    expect(result).toHaveProperty("riskLane");
    expect(result).toHaveProperty("riskFactors");
    expect(result).toHaveProperty("recommendedAction");
    expect(result).toHaveProperty("reasoning");
    expect(result).toHaveProperty("hsCodeValid");
    expect(result).toHaveProperty("valuationFlag");
    expect(result).toHaveProperty("originRisk");
    expect(result).toHaveProperty("declarationId");
    expect(result).toHaveProperty("model");
    expect(result).toHaveProperty("scoredAt");
  });

  it("riskScore is a number between 0 and 100", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(typeof result.riskScore).toBe("number");
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("riskLane is one of GREEN, YELLOW, RED, BLUE", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(["GREEN", "YELLOW", "RED", "BLUE"]).toContain(result.riskLane);
  });

  it("riskFactors is an array", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(Array.isArray(result.riskFactors)).toBe(true);
  });

  it("recommendedAction is one of the four valid values", { timeout: 30_000 }, async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect([
      "AUTO_RELEASE",
      "DOCUMENT_REVIEW",
      "PHYSICAL_INSPECTION",
      "HOLD",
    ]).toContain(result.recommendedAction);
  });

  it("reasoning is a non-empty string", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(typeof result.reasoning).toBe("string");
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  it("hsCodeValid is a boolean", { timeout: 30_000 }, async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(typeof result.hsCodeValid).toBe("boolean");
  });

  it("valuationFlag is a boolean", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(typeof result.valuationFlag).toBe("boolean");
  });

  it("originRisk is one of LOW, MEDIUM, HIGH", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(["LOW", "MEDIUM", "HIGH"]).toContain(result.originRisk);
  });

  it("declarationId matches the input declarationId", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);

    expect(result.declarationId).toBe(VALID_INPUT.declarationId);
  });

  it("scoredAt is a recent timestamp", async () => {
    const before = Date.now();
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk(VALID_INPUT);
    const after = Date.now();

    expect(typeof result.scoredAt).toBe("number");
    expect(result.scoredAt).toBeGreaterThanOrEqual(before);
    expect(result.scoredAt).toBeLessThanOrEqual(after + 30_000); // 30s tolerance for LLM latency
  }, 30_000);
});

// ─── High-risk goods scenario ─────────────────────────────────────────────────

describe("ai.scoreRisk — high-risk goods scenario", () => {
  it("scores dual-use goods from a high-risk origin", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk({
      declarationId: "DECL-2026-HIGH-001",
      hsCode: "9301.10.00",
      goodsDescription: "Military rifles and ammunition",
      countryOfOrigin: "RU",
      consigneeCountry: "GH",
      declaredValue: 500_000,
      weight: 2000,
    });

    // Should return a valid response (not throw)
    expect(result).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(["GREEN", "YELLOW", "RED", "BLUE"]).toContain(result.riskLane);
  });
});

// ─── AEO low-risk scenario ────────────────────────────────────────────────────

describe("ai.scoreRisk — AEO low-risk scenario", () => {
  it("scores a low-risk AEO declaration", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.ai.scoreRisk({
      declarationId: "DECL-2026-AEO-001",
      hsCode: "0901.11.00",
      goodsDescription: "Green coffee beans, unroasted, not decaffeinated",
      countryOfOrigin: "ET",
      consigneeCountry: "DE",
      declaredValue: 25_000,
      weight: 5000,
      traderProfile: {
        isAEO: true,
        complianceScore: 98,
        previousViolations: 0,
      },
    });

    expect(result).toBeDefined();
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
    expect(["GREEN", "YELLOW", "RED", "BLUE"]).toContain(result.riskLane);
  });
});
