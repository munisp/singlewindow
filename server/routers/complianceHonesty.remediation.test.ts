/**
 * complianceHonesty.remediation.test.ts — Phase-6 Group 2 regression tests
 *
 * SW-7:    LLM sanctions pre-screen fails CLOSED (manual review, never clear),
 *          and never fabricates list coverage (listsChecked).
 * SW-18:   riskModel — Ray outage → SCORING_UNAVAILABLE, no synthesized scores.
 * SW-MP12: knowledgeGraph — bridge null → UNAVAILABLE, no synthetic entities.
 * SW-25:   cargoTracking — vessel route from persisted events only, explicit
 *          no-data state, never synthesized waypoints.
 * SW-21:   freeZone — reconciliation uses REAL declaration values, persists runs.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const state = {
  sanctionsInserts: [] as Array<Record<string, unknown>>,
  securityAlerts: [] as Array<Record<string, unknown>>,
  poolRows: [] as Array<Record<string, unknown>>,
  poolShouldThrow: false,
  declarationRows: [] as Array<Record<string, unknown>>,
  reconRunInserts: [] as Array<Record<string, unknown>>,
  llmShouldThrow: false,
  llmResult: null as null | Record<string, unknown>,
};

vi.mock("../db", () => ({
  createSecurityAlert: vi.fn(async (d: Record<string, unknown>) => {
    state.securityAlerts.push(d);
    return { id: 1 };
  }),
  getSecurityAlerts: vi.fn(async () => []),
  acknowledgeAlert: vi.fn(async () => ({})),
  createSanctionsCheck: vi.fn(async (d: Record<string, unknown>) => {
    state.sanctionsInserts.push(d);
    return { id: 42, ...d };
  }),
  getSanctionsChecksByDeclaration: vi.fn(async () => []),
  getDeclarationById: vi.fn(async () => null),
  getDb: vi.fn(async () => ({
    select: (fields?: unknown) => ({
      from: () => ({
        where: async () => state.declarationRows,
        orderBy: () => ({ limit: () => ({ offset: async () => [] }) }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          state.reconRunInserts.push(v);
          return [{ id: 7 }];
        },
      }),
    }),
  })),
  getPool: vi.fn(() => ({
    query: async () => {
      if (state.poolShouldThrow) throw new Error("db down");
      return { rows: state.poolRows };
    },
  })),
}));

vi.mock("../_core/kafka", () => ({
  publishEvent: vi.fn(async () => {}),
  TOPICS: { SANCTIONS_HIT: "sanctions.hit" },
}));

vi.mock("../_core/llm", () => ({
  invokeLLM: vi.fn(async () => {
    if (state.llmShouldThrow) throw new Error("LLM endpoint down");
    return {
      choices: [{ message: { content: JSON.stringify(state.llmResult ?? { result: "clear", matchDetails: { listName: "", matchedEntity: "", matchScore: 0, reason: "" }, riskIndicators: [] }) } }],
    };
  }),
}));

const adminCtx = { user: { id: 1, role: "admin", openId: "x", name: "Admin" }, req: {}, res: {} } as any;
const officerCtx = { user: { id: 2, role: "customs_officer", openId: "y", name: "Officer" }, req: {}, res: {} } as any;

beforeEach(() => {
  state.sanctionsInserts = [];
  state.securityAlerts = [];
  state.poolRows = [];
  state.poolShouldThrow = false;
  state.declarationRows = [];
  state.reconRunInserts = [];
  state.llmShouldThrow = false;
  state.llmResult = null;
  vi.unstubAllGlobals();
});

describe("SW-7: LLM sanctions pre-screen honesty", () => {
  it("LLM outage → MANUAL_REVIEW_REQUIRED persisted as potential_match, never clear", async () => {
    state.llmShouldThrow = true;
    const { securityRouter } = await import("./security");
    const caller = securityRouter.createCaller(adminCtx);
    const check = await caller.screenEntity({ entityName: "Some Entity", entityType: "company" });
    expect(state.sanctionsInserts).toHaveLength(1);
    const rec = state.sanctionsInserts[0];
    expect(rec.checkResult).toBe("potential_match"); // human review flag, NOT clear
    expect(rec.listsChecked).toEqual([]); // no list coverage fabricated
    expect((rec.matchDetails as any).outcome).toBe("MANUAL_REVIEW_REQUIRED");
    expect(state.securityAlerts.some(a => String(a.title).includes("Manual Sanctions Review"))).toBe(true);
    expect((check as any).id).toBe(42);
  });

  it("heuristic result records no list coverage either", async () => {
    state.llmResult = { result: "clear", matchDetails: { listName: "", matchedEntity: "", matchScore: 0, reason: "" }, riskIndicators: [] };
    const { securityRouter } = await import("./security");
    const caller = securityRouter.createCaller(adminCtx);
    await caller.screenEntity({ entityName: "Benign Co", entityType: "company" });
    expect(state.sanctionsInserts[0].listsChecked).toEqual([]);
    expect((state.sanctionsInserts[0].matchDetails as any).noListsConsulted).toBe(true);
  });
});

describe("SW-18: riskModel fail-closed scoring", () => {
  const features = {
    ucr: "UCR-1", hsCode: "8517", declaredValue: 1000, originCountry: "GH", destCountry: "KE",
    transitCountries: [], traderId: "t1", traderDeclarationCount: 5, traderViolationCount: 0, isExpress: false,
  };

  it("scoreDeclaration throws SCORING_UNAVAILABLE when the scorer is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const { riskModelRouter } = await import("./riskModel");
    const caller = riskModelRouter.createCaller(adminCtx);
    await expect(caller.scoreDeclaration(features)).rejects.toThrow(/SCORING_UNAVAILABLE/);
  });

  it("batchScore never synthesizes scores when the scorer is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const { riskModelRouter } = await import("./riskModel");
    const caller = riskModelRouter.createCaller(adminCtx);
    await expect(caller.batchScore({ declarations: [features] })).rejects.toThrow(/SCORING_UNAVAILABLE/);
  });

  it("getModelStats fails closed instead of returning fabricated metrics", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("connection refused"); }));
    const { riskModelRouter } = await import("./riskModel");
    const caller = riskModelRouter.createCaller(adminCtx);
    await expect(caller.getModelStats()).rejects.toThrow(/MODEL_STATS_UNAVAILABLE/);
  });
});

describe("SW-MP12: knowledgeGraph fraud network honesty", () => {
  it("bridge null → UNAVAILABLE with zero synthetic entities", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("bridge down"); }));
    const { knowledgeGraphRouter } = await import("./knowledgeGraph");
    const caller = knowledgeGraphRouter.createCaller(adminCtx);
    const result = await caller.fraudNetwork({ limit: 50, minRisk: 0.5 });
    expect((result as any).unavailable).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.stats.totalNodes).toBe(0);
    expect((result as any).fallback).toBe(false);
  });
});

describe("SW-25: vessel route from persisted events only", () => {
  it("returns persisted tracking events as waypoints", async () => {
    state.poolRows = [
      { lat: -4.05, lon: 39.66, speed: 12, heading: 90, timestamp: "2026-01-01T00:00:00Z", vesselName: "MV TEST" },
      { lat: -4.10, lon: 39.70, speed: 11, heading: 91, timestamp: "2026-01-01T01:00:00Z", vesselName: "MV TEST" },
    ];
    const { cargoTrackingRouter } = await import("./cargoTracking");
    const caller = cargoTrackingRouter.createCaller(adminCtx);
    const result = await caller.getVesselRoute({ mmsi: "636099999" });
    expect(result.waypoints).toHaveLength(2);
    expect(result.noData).toBe(false);
    expect((result as any).unavailable).toBe(false);
  });

  it("no persisted events → explicit labelled no-data state (no synthesis)", async () => {
    state.poolRows = [];
    const { cargoTrackingRouter } = await import("./cargoTracking");
    const caller = cargoTrackingRouter.createCaller(adminCtx);
    const result = await caller.getVesselRoute({ mmsi: "636000000" });
    expect(result.waypoints).toEqual([]);
    expect(result.noData).toBe(true);
    expect(String(result.message)).toContain("NO_TRACKING_DATA");
  });

  it("store down → explicit UNAVAILABLE, never fabricated waypoints", async () => {
    state.poolShouldThrow = true;
    const { cargoTrackingRouter } = await import("./cargoTracking");
    const caller = cargoTrackingRouter.createCaller(adminCtx);
    const result = await caller.getVesselRoute({ mmsi: "636099999" });
    expect((result as any).unavailable).toBe(true);
    expect(result.waypoints).toEqual([]);
  });
});

describe("SW-21: free-zone reconciliation with real declaration values", () => {
  function mockFzFetch() {
    vi.stubGlobal("fetch", vi.fn(async (url: unknown) => ({
      ok: true,
      text: async () => JSON.stringify([
        { itemId: "i1", hsCode: "8517", quantity: 10, valueUSD: 1020, declarationRef: "DECL-001" },
        { itemId: "i2", hsCode: "6403", quantity: 5, valueUSD: 500, declarationRef: "DECL-MISSING" },
        { itemId: "i3", hsCode: "0902", quantity: 2, valueUSD: 100 },
      ]),
    })));
  }

  it("computes variance from real declaration values and persists the run", async () => {
    mockFzFetch();
    state.declarationRows = [{ declarationNumber: "DECL-001", invoiceValue: "1000.00" }];
    const { freeZoneRouter } = await import("./freeZone");
    const caller = freeZoneRouter.createCaller(officerCtx);
    const result = await caller.reconcileInventory({ tolerancePct: 2 });
    // DECL-001: fz 1020 vs declared 1000 → 2% variance → matched at 2% tolerance
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].declarationRef).toBe("DECL-001");
    expect(result.matched[0].declaredValue).toBe(1000);
    // DECL-MISSING: unmatched honestly (no declaration found)
    expect(result.unmatched.some(u => u.declarationRef === "DECL-MISSING")).toBe(true);
    // UNLINKED → surplus
    expect(result.surplus).toHaveLength(1);
    // Run persisted for real history
    expect(state.reconRunInserts).toHaveLength(1);
    expect(result.runPersisted).toBe(true);
    expect(result.runId).toBe(7);
  });

  it("surplus items never require declarations", async () => {
    mockFzFetch();
    state.declarationRows = [];
    const { freeZoneRouter } = await import("./freeZone");
    const caller = freeZoneRouter.createCaller(officerCtx);
    const result = await caller.reconcileInventory({ tolerancePct: 2 });
    expect(result.matched).toHaveLength(0);
    expect(result.summary.totalItems).toBe(3);
  });
});
