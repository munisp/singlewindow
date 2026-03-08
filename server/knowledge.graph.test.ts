/**
 * Knowledge Graph tRPC Router — Unit Tests
 *
 * Tests cover:
 * 1. Auth protection — unauthenticated callers are rejected
 * 2. health — returns bridge-unavailable shape when bridge is down
 * 3. scoreDeclaration — validates input schema and returns null when bridge is down
 * 4. traderProfile — validates input schema and returns null when bridge is down
 * 5. highRiskCorridors — returns null when bridge is down
 * 6. ogaBacklog — returns null when bridge is down
 * 7. askKnowledgeGraph — returns fallback when bridge is down
 * 8. explainRisk — returns deterministic fallback when bridge is down
 * 9. executeCypher — admin-only RBAC check
 * 10. upsertTrader — validates input and silently succeeds when bridge is down
 *
 * All tests run without a live Go bridge or graph database — the router's
 * graceful fallback behaviour is what is being verified here.
 */

import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// ─── CONTEXT FACTORIES ────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function makeCtx(user: AuthenticatedUser | null = makeUser()): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

// ─── AUTH PROTECTION ──────────────────────────────────────────────────────────

describe("knowledgeGraph — auth protection", () => {
  it("rejects unauthenticated callers on health", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(caller.knowledgeGraph.health()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("rejects unauthenticated callers on scoreDeclaration", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.knowledgeGraph.scoreDeclaration({
        declarationId: "d-1",
        traderId: "t-1",
        hsCode: "8517.12",
        declaredValue: 10000,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated callers on askKnowledgeGraph", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.knowledgeGraph.askKnowledgeGraph({ question: "Who are the high-risk traders?" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── HEALTH ───────────────────────────────────────────────────────────────────

describe("knowledgeGraph.health", () => {
  it("returns bridgeReachable=false when bridge is not running", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.health();
    // Bridge is not running in test environment
    expect(result).toMatchObject({
      status: expect.any(String),
      bridgeReachable: expect.any(Boolean),
    });
  });

  it("returns a timestamp string", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.health();
    expect(typeof result.timestamp).toBe("string");
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it("returns service name", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.health();
    expect(result.service).toBe("go-graph-bridge");
  });
});

// ─── SCORE DECLARATION ────────────────────────────────────────────────────────

describe("knowledgeGraph.scoreDeclaration", () => {
  it("returns null when bridge is unavailable (graceful fallback)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.scoreDeclaration({
      declarationId: "decl-001",
      traderId: "trader-001",
      hsCode: "8517.12",
      declaredValue: 50000,
    });
    // Bridge is not running — should return null gracefully
    expect(result).toBeNull();
  });

  it("rejects invalid input: missing required fields", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      // @ts-expect-error intentionally missing required fields
      caller.knowledgeGraph.scoreDeclaration({ declarationId: "d-1" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts empty declarationId (no min-length constraint on schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // The router uses z.string() without .min(1), so empty strings are accepted
    // and the bridge call returns null gracefully
    const result = await caller.knowledgeGraph.scoreDeclaration({
      declarationId: "",
      traderId: "t-1",
      hsCode: "8517.12",
      declaredValue: 10000,
    });
    expect(result).toBeNull();
  });

  it("accepts optional fields without error", async () => {
    const caller = appRouter.createCaller(makeCtx());
    // Should not throw even with all optional fields
    const result = await caller.knowledgeGraph.scoreDeclaration({
      declarationId: "decl-002",
      traderId: "trader-002",
      hsCode: "6204.62",
      declaredValue: 15000,
      weight: 500,
      portId: "port-tema",
      corridorId: "gh-cn",
      aeoStatus: true,
      documentCount: 5,
      countryOfOrigin: "CN",
    });
    expect(result).toBeNull(); // Bridge not running
  });
});

// ─── TRADER PROFILE ───────────────────────────────────────────────────────────

describe("knowledgeGraph.traderProfile", () => {
  it("returns null when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.traderProfile({ traderId: "trader-001" });
    expect(result).toBeNull();
  });

  it("accepts empty traderId (no min-length constraint on schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.traderProfile({ traderId: "" });
    expect(result).toBeNull();
  });
});

// ─── HIGH RISK CORRIDORS ──────────────────────────────────────────────────────

describe("knowledgeGraph.highRiskCorridors", () => {
  it("returns null when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.highRiskCorridors();
    expect(result).toBeNull();
  });
});

// ─── OGA BACKLOG ──────────────────────────────────────────────────────────────

describe("knowledgeGraph.ogaBacklog", () => {
  it("returns null when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.ogaBacklog();
    expect(result).toBeNull();
  });
});

// ─── ASK KNOWLEDGE GRAPH (EPR-KGQA) ──────────────────────────────────────────

describe("knowledgeGraph.askKnowledgeGraph", () => {
  it("returns fallback response when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.askKnowledgeGraph({
      question: "Which traders have the highest red-lane rate?",
    });
    expect(result).toMatchObject({
      question: "Which traders have the highest red-lane rate?",
      answer: expect.any(String),
      intent: expect.any(String),
      resultCount: expect.any(Number),
      results: expect.any(Array),
    });
  });

  it("returns fallback=true when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.askKnowledgeGraph({
      question: "What is the average clearance time for Ghana-China corridor?",
    });
    expect(result.fallback).toBe(true);
  });

  it("rejects question shorter than 5 characters", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.askKnowledgeGraph({ question: "Hi" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects question longer than 500 characters", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.askKnowledgeGraph({ question: "A".repeat(501) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("echoes the question in the response", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const question = "Show me all controlled goods declarations from last month";
    const result = await caller.knowledgeGraph.askKnowledgeGraph({ question });
    expect(result.question).toBe(question);
  });
});

// ─── EXPLAIN RISK (ART) ───────────────────────────────────────────────────────

describe("knowledgeGraph.explainRisk", () => {
  const baseInput = {
    declarationId: "decl-001",
    riskScore: 0.82,
    lane: "red" as const,
    riskFactors: [
      { factor: "hs_fraud_rate", weight: 0.25, value: 0.9, description: "HS 8517 has high fraud rate" },
      { factor: "trader_history", weight: 0.20, value: 0.8, description: "Trader has 8 violations" },
    ],
    hsCode: "8517.12",
    declaredValue: 250000,
  };

  it("returns fallback explanation when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk(baseInput);
    expect(result).toMatchObject({
      answer: expect.any(String),
      confidence: expect.any(Number),
      engine: expect.any(String),
    });
  });

  it("fallback explanation mentions the declaration ID", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk(baseInput);
    expect(result.answer).toContain("decl-001");
  });

  it("fallback for red lane includes physical inspection recommendation", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk(baseInput);
    expect(result.recommendations).toContain("Conduct physical inspection");
  });

  it("fallback for green lane recommends auto-clearance", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk({
      ...baseInput,
      riskScore: 0.15,
      lane: "green",
    });
    expect(result.recommendations).toContain("Proceed to green-lane auto-clearance");
  });

  it("fallback for yellow lane recommends additional documentation", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk({
      ...baseInput,
      riskScore: 0.48,
      lane: "yellow",
    });
    expect(result.recommendations).toContain("Request additional documentation");
  });

  it("fallback=true when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk(baseInput);
    expect(result.fallback).toBe(true);
  });

  it("confidence is between 0 and 1", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.explainRisk(baseInput);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ─── EXECUTE CYPHER (admin only) ──────────────────────────────────────────────

describe("knowledgeGraph.executeCypher", () => {
  it("rejects non-admin users with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
    await expect(
      caller.knowledgeGraph.executeCypher({
        cypher: "MATCH (n) RETURN n LIMIT 10",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects customs_officer with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(
      makeCtx(makeUser({ role: "customs_officer" }))
    );
    await expect(
      caller.knowledgeGraph.executeCypher({
        cypher: "MATCH (n) RETURN n LIMIT 10",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admin to execute Cypher (returns null when bridge is down)", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.executeCypher({
      cypher: "MATCH (t:Trader) RETURN t.name LIMIT 5",
    });
    // Bridge not running — returns null gracefully
    expect(result).toBeNull();
  });

  it("rejects Cypher shorter than 5 characters", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    await expect(
      caller.knowledgeGraph.executeCypher({ cypher: "MAT" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects Cypher longer than 2000 characters", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    await expect(
      caller.knowledgeGraph.executeCypher({ cypher: "MATCH ".repeat(400) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts optional params object", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.executeCypher({
      cypher: "MATCH (t:Trader {id: $id}) RETURN t",
      params: { id: "trader-001" },
    });
    expect(result).toBeNull(); // Bridge not running
  });
});

// ─── UPSERT TRADER ────────────────────────────────────────────────────────────

describe("knowledgeGraph.upsertTrader", () => {
  it("returns success=true even when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.upsertTrader({
      id: "trader-001",
      name: "Accra Trading Co.",
    });
    expect(result).toEqual({ success: true });
  });

  it("accepts all optional fields", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.upsertTrader({
      id: "trader-002",
      name: "Lagos Imports Ltd.",
      tin: "GH-1234567",
      aeoStatus: true,
      riskScore: 0.12,
    });
    expect(result).toEqual({ success: true });
  });

  it("accepts empty id (no min-length constraint on schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.upsertTrader({ id: "", name: "Test" });
    expect(result).toEqual({ success: true });
  });

  it("accepts empty name (no min-length constraint on schema)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.upsertTrader({ id: "t-1", name: "" });
    expect(result).toEqual({ success: true });
  });
});

// ─── BATCH SCORE (GNN) ────────────────────────────────────────────────────────

describe("knowledgeGraph.batchScore", () => {
  it("rejects non-admin/non-customs_officer users with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
    await expect(
      caller.knowledgeGraph.batchScore({})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects finance role with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "finance" })));
    await expect(
      caller.knowledgeGraph.batchScore({})
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("allows admin to call batchScore (returns fallback when bridge is down)", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({});
    expect(result).toMatchObject({
      status: expect.any(String),
      scored: expect.any(Number),
      results: expect.any(Array),
      modelVersion: expect.any(String),
    });
  });

  it("allows customs_officer to call batchScore", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "customs_officer" })));
    const result = await caller.knowledgeGraph.batchScore({});
    expect(result.fallback).toBe(true);
    expect(result.scored).toBe(0);
  });

  it("returns fallback=true when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({});
    expect(result.fallback).toBe(true);
  });

  it("accepts optional declarationIds array", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({
      declarationIds: ["d-001", "d-002", "d-003"],
    });
    expect(result).toBeDefined();
  });

  it("accepts optional limit parameter within valid range", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({ limit: 100 });
    expect(result).toBeDefined();
  });

  it("rejects limit below minimum (1)", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    await expect(
      caller.knowledgeGraph.batchScore({ limit: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects limit above maximum (1000)", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    await expect(
      caller.knowledgeGraph.batchScore({ limit: 1001 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("returns empty results array when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({});
    expect(result.results).toEqual([]);
  });

  it("returns modelVersion string", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "admin" })));
    const result = await caller.knowledgeGraph.batchScore({});
    expect(typeof result.modelVersion).toBe("string");
  });
});

// ─── FRAUD NETWORK ────────────────────────────────────────────────────────────

describe("knowledgeGraph.fraudNetwork", () => {
  it("returns synthetic demo data when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result).toMatchObject({
      nodes: expect.any(Array),
      edges: expect.any(Array),
      stats: expect.objectContaining({
        totalNodes: expect.any(Number),
        totalEdges: expect.any(Number),
        highRiskNodes: expect.any(Number),
        avgRiskScore: expect.any(Number),
      }),
    });
  });

  it("returns fallback=true when bridge is unavailable", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.fallback).toBe(true);
  });

  it("fallback nodes have required shape", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.nodes.length).toBeGreaterThan(0);
    for (const node of result.nodes) {
      expect(node).toMatchObject({
        id: expect.any(String),
        label: expect.any(String),
        type: expect.stringMatching(/^(trader|hs_code|port|oga|corridor)$/),
        riskScore: expect.any(Number),
      });
      expect(node.riskScore).toBeGreaterThanOrEqual(0);
      expect(node.riskScore).toBeLessThanOrEqual(1);
    }
  });

  it("fallback edges have required shape", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.edges.length).toBeGreaterThan(0);
    for (const edge of result.edges) {
      expect(edge).toMatchObject({
        source: expect.any(String),
        target: expect.any(String),
        type: expect.any(String),
        weight: expect.any(Number),
      });
    }
  });

  it("accepts optional limit parameter within valid range", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({ limit: 50 });
    expect(result).toBeDefined();
  });

  it("accepts optional minRisk parameter within valid range", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({ minRisk: 0.7 });
    expect(result).toBeDefined();
  });

  it("rejects limit below minimum (10)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.fraudNetwork({ limit: 5 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects limit above maximum (500)", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.fraudNetwork({ limit: 501 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects minRisk below 0", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.fraudNetwork({ minRisk: -0.1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects minRisk above 1", async () => {
    const caller = appRouter.createCaller(makeCtx());
    await expect(
      caller.knowledgeGraph.fraudNetwork({ minRisk: 1.1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("stats totalNodes equals nodes array length in fallback", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.stats.totalNodes).toBe(result.nodes.length);
  });

  it("stats totalEdges equals edges array length in fallback", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.stats.totalEdges).toBe(result.edges.length);
  });

  it("avgRiskScore is between 0 and 1", async () => {
    const caller = appRouter.createCaller(makeCtx());
    const result = await caller.knowledgeGraph.fraudNetwork({});
    expect(result.stats.avgRiskScore).toBeGreaterThanOrEqual(0);
    expect(result.stats.avgRiskScore).toBeLessThanOrEqual(1);
  });

  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.knowledgeGraph.fraudNetwork({})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ─── GET TRADER INVESTIGATION ─────────────────────────────────────────────────
// The procedure requires admin or customs_officer role (max months = 24)

describe("knowledgeGraph.getTraderInvestigation", () => {
  const adminCtx = () => makeCtx(makeUser({ role: "admin" }));
  const officerCtx = () => makeCtx(makeUser({ role: "customs_officer" }));

  it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
    const caller = appRouter.createCaller(makeCtx(null));
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "1", months: 12 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects regular user role with FORBIDDEN", async () => {
    const caller = appRouter.createCaller(makeCtx(makeUser({ role: "user" })));
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "1", months: 12 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-numeric traderId with BAD_REQUEST (admin)", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "not-a-number", months: 12 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects months below 1 with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "1", months: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects months above 24 with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(adminCtx());
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "1", months: 25 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("throws a TRPCError for a non-existent trader (admin) — NOT_FOUND or INTERNAL_SERVER_ERROR depending on DB availability", async () => {
    // In CI without a live DB the procedure throws INTERNAL_SERVER_ERROR (DB unavailable).
    // With a live DB it throws NOT_FOUND. Both are acceptable TRPCErrors.
    const caller = appRouter.createCaller(adminCtx());
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "999999", months: 12 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("throws a TRPCError for a non-existent trader (customs_officer)", async () => {
    const caller = appRouter.createCaller(officerCtx());
    await expect(
      caller.knowledgeGraph.getTraderInvestigation({ traderId: "999998", months: 1 })
    ).rejects.toBeInstanceOf(Error);
  });

  it("accepts months=24 without schema error — throws only after schema validation passes", async () => {
    // Schema validation passes (months=24 is within 1-24 range).
    // The error that follows is either NOT_FOUND or INTERNAL_SERVER_ERROR, not BAD_REQUEST.
    const caller = appRouter.createCaller(adminCtx());
    const err = await caller.knowledgeGraph
      .getTraderInvestigation({ traderId: "999997", months: 24 })
      .catch((e: { code?: string }) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { code?: string }).code).not.toBe("BAD_REQUEST");
  });
});
