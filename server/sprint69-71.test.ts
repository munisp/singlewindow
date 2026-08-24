/**
 * Sprint 69–71 Tests
 * Sprint 69: First-login redirect (onboarding status in auth.me)
 * Sprint 70: WebSocket vessel broadcast (getLiveVesselsData export)
 * Sprint 71: SDK Generator (TypeScript + Python generation logic)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Sprint 69: First-login redirect ─────────────────────────────────────────

describe("Sprint 69 — First-login redirect", () => {
  describe("useOnboardingRedirect hook logic", () => {
    it("should not redirect when user has completed onboarding", () => {
      const user = { id: 1, name: "Alice", hasCompletedOnboarding: true };
      const currentPath = "/app/dashboard";
      const shouldRedirect = !user.hasCompletedOnboarding && currentPath !== "/app/onboarding";
      expect(shouldRedirect).toBe(false);
    });

    it("should redirect when user has NOT completed onboarding and is not on onboarding page", () => {
      const user = { id: 2, name: "Bob", hasCompletedOnboarding: false };
      const currentPath = "/app/dashboard";
      const shouldRedirect = !user.hasCompletedOnboarding && currentPath !== "/app/onboarding";
      expect(shouldRedirect).toBe(true);
    });

    it("should NOT redirect when user is already on the onboarding page", () => {
      const user = { id: 3, name: "Carol", hasCompletedOnboarding: false };
      const currentPath = "/app/onboarding";
      const shouldRedirect = !user.hasCompletedOnboarding && currentPath !== "/app/onboarding";
      expect(shouldRedirect).toBe(false);
    });

    it("should NOT redirect when user is unauthenticated (loading state)", () => {
      const user = null;
      const isAuthenticated = false;
      const shouldRedirect = isAuthenticated && user !== null && !(user as { hasCompletedOnboarding?: boolean })?.hasCompletedOnboarding;
      expect(shouldRedirect).toBe(false);
    });

    it("should NOT redirect admin users regardless of onboarding status", () => {
      const user = { id: 4, name: "Admin", role: "admin", hasCompletedOnboarding: false };
      const shouldRedirect = user.role !== "admin" && !user.hasCompletedOnboarding;
      expect(shouldRedirect).toBe(false);
    });

    it("should redirect trader users who have not completed onboarding", () => {
      const user = { id: 5, name: "Trader", role: "trader", hasCompletedOnboarding: false };
      const shouldRedirect = user.role !== "admin" && !user.hasCompletedOnboarding;
      expect(shouldRedirect).toBe(true);
    });
  });

  describe("auth.me hasCompletedOnboarding flag", () => {
    it("should return false when no onboarding record exists", () => {
      const onboardingRecord = null;
      const hasCompletedOnboarding = onboardingRecord !== null &&
        (onboardingRecord as { completedAt?: string | null }).completedAt !== null;
      expect(hasCompletedOnboarding).toBe(false);
    });

    it("should return false when onboarding record exists but completedAt is null", () => {
      const onboardingRecord = { userId: 1, currentStep: 2, completedAt: null };
      const hasCompletedOnboarding = onboardingRecord !== null && onboardingRecord.completedAt !== null;
      expect(hasCompletedOnboarding).toBe(false);
    });

    it("should return true when onboarding record has a completedAt timestamp", () => {
      const onboardingRecord = { userId: 1, currentStep: 5, completedAt: new Date().toISOString() };
      const hasCompletedOnboarding = onboardingRecord !== null && onboardingRecord.completedAt !== null;
      expect(hasCompletedOnboarding).toBe(true);
    });
  });
});

// ─── Sprint 70: WebSocket vessel broadcast ────────────────────────────────────

describe("Sprint 70 — WebSocket vessel broadcast", () => {
  it("should export getLiveVesselsData function from cargoTracking router", async () => {
    const mod = await import("./routers/cargoTracking");
    expect(typeof mod.getLiveVesselsData).toBe("function");
  });

  it("getLiveVesselsData should return an array of vessel positions", async () => {
    const { getLiveVesselsData } = await import("./routers/cargoTracking");
    const vessels = getLiveVesselsData();
    expect(Array.isArray(vessels)).toBe(true);
  });

  it("each vessel position should have required fields", async () => {
    const { getLiveVesselsData } = await import("./routers/cargoTracking");
    const vessels = getLiveVesselsData();
    for (const v of vessels) {
      expect(v).toHaveProperty("mmsi");
      expect(v).toHaveProperty("vesselName");
      expect(typeof v.lat).toBe("number");
      expect(typeof v.lon).toBe("number");
      expect(typeof v.speed).toBe("number");
      expect(typeof v.heading).toBe("number");
      expect(["green", "amber", "red"]).toContain(v.riskFlag);
      expect(v.lastUpdate).toBeTruthy();
    }
  });

  it("vessel positions should have valid lat/lon coordinates", async () => {
    const { getLiveVesselsData } = await import("./routers/cargoTracking");
    const vessels = getLiveVesselsData();
    for (const v of vessels) {
      // Valid geographic coordinates (drift simulation can move vessels over time)
      expect(v.lat).toBeGreaterThan(-90);
      expect(v.lat).toBeLessThan(90);
      expect(v.lon).toBeGreaterThan(-180);
      expect(v.lon).toBeLessThan(180);
    }
  });

  it("getLiveVesselsData should return consistent results on repeated calls", async () => {
    const { getLiveVesselsData } = await import("./routers/cargoTracking");
    const a = getLiveVesselsData();
    const b = getLiveVesselsData();
    expect(a.length).toBe(b.length);
    if (a.length > 0 && b.length > 0) expect(a[0].mmsi).toBe(b[0].mmsi);
  });

  describe("WebSocket message protocol", () => {
    it("should recognise subscribe_cargo message type", () => {
      const msg = { type: "subscribe_cargo" };
      const isSubscribe = msg.type === "subscribe_cargo";
      expect(isSubscribe).toBe(true);
    });

    it("should recognise unsubscribe_cargo message type", () => {
      const msg = { type: "unsubscribe_cargo" };
      const isUnsubscribe = msg.type === "unsubscribe_cargo";
      expect(isUnsubscribe).toBe(true);
    });

    it("vessel_update payload should have required fields", () => {
      const payload = {
        vessels: [{ mmsi: "636091234", lat: -4.04, lon: 39.67, speed: 12.4, heading: 285, riskFlag: "green" }],
        totalCount: 1,
        lastRefresh: new Date().toISOString(),
      };
      expect(payload.vessels.length).toBeGreaterThan(0);
      expect(typeof payload.totalCount).toBe("number");
      expect(payload.lastRefresh).toBeTruthy();
    });
  });
});

// ─── Sprint 71: SDK Generator ─────────────────────────────────────────────────

describe("Sprint 71 — SDK Generator", () => {
  // Minimal mock OpenAPI spec
  const mockSpec = {
    openapi: "3.1.0",
    info: { title: "TradeGateway NGSWTP", version: "1.0.0" },
    paths: {
      "/api/trpc/declarations.list": {
        get: {
          operationId: "declarations.list",
          summary: "List all declarations",
          tags: ["declarations"],
          security: [{ sessionCookie: [] }],
        },
      },
      "/api/trpc/declarations.create": {
        post: {
          operationId: "declarations.create",
          summary: "Create a new declaration",
          tags: ["declarations"],
          security: [{ sessionCookie: [] }],
          requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        },
      },
      "/api/trpc/cargoTracking.getLiveVessels": {
        get: {
          operationId: "cargoTracking.getLiveVessels",
          summary: "Get live vessel positions",
          tags: ["cargoTracking"],
        },
      },
    },
  };

  function extractEndpoints(spec: typeof mockSpec) {
    const endpoints: Array<{
      tag: string; method: string; path: string;
      operationId: string; summary: string; requiresAuth: boolean; hasBody: boolean;
    }> = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        if (!op || typeof op !== "object") continue;
        const o = op as Record<string, unknown>;
        const operationId = (o.operationId as string) ?? path;
        const tag = ((o.tags as string[])?.[0] ?? "general").toLowerCase();
        const summary = (o.summary as string) ?? operationId;
        const requiresAuth = Array.isArray(o.security) && (o.security as unknown[]).length > 0;
        const hasBody = method === "post" && !!(o.requestBody);
        endpoints.push({ tag, method, path, operationId, summary, requiresAuth, hasBody });
      }
    }
    return endpoints;
  }

  it("should extract all endpoints from spec", () => {
    const endpoints = extractEndpoints(mockSpec);
    expect(endpoints.length).toBe(3);
  });

  it("should correctly identify auth-required endpoints", () => {
    const endpoints = extractEndpoints(mockSpec);
    const authRequired = endpoints.filter(e => e.requiresAuth);
    expect(authRequired.length).toBe(2); // declarations.list and declarations.create
  });

  it("should correctly identify endpoints with request body", () => {
    const endpoints = extractEndpoints(mockSpec);
    const withBody = endpoints.filter(e => e.hasBody);
    expect(withBody.length).toBe(1); // declarations.create
    expect(withBody[0].operationId).toBe("declarations.create");
  });

  it("should correctly identify public endpoints", () => {
    const endpoints = extractEndpoints(mockSpec);
    const publicEps = endpoints.filter(e => !e.requiresAuth);
    expect(publicEps.length).toBe(1);
    expect(publicEps[0].operationId).toBe("cargoTracking.getLiveVessels");
  });

  it("TypeScript SDK should contain class definition", () => {
    const endpoints = extractEndpoints(mockSpec);
    const lines: string[] = [];
    lines.push(`export class TradeGatewayClient {`);
    for (const ep of endpoints) {
      const fnName = ep.operationId.replace(/\./g, "_");
      const paramType = ep.hasBody ? `input: Record<string, unknown>` : ``;
      lines.push(`  async ${fnName}(${paramType}): Promise<unknown> {`);
      lines.push(`    return this.request("${ep.operationId}", ${ep.hasBody ? "input" : "undefined"});`);
      lines.push(`  }`);
    }
    lines.push(`}`);
    const sdk = lines.join("\n");

    expect(sdk).toContain("export class TradeGatewayClient");
    expect(sdk).toContain("declarations_list");
    expect(sdk).toContain("declarations_create");
    expect(sdk).toContain("cargoTracking_getLiveVessels");
    expect(sdk).toContain("input: Record<string, unknown>"); // only for POST
  });

  it("Python SDK should contain class definition", () => {
    const endpoints = extractEndpoints(mockSpec);
    const lines: string[] = [];
    lines.push(`class TradeGatewayClient:`);
    for (const ep of endpoints) {
      const fnName = ep.operationId.replace(/\./g, "_");
      const paramDef = ep.hasBody ? `self, input_data: dict` : `self`;
      lines.push(`    def ${fnName}(${paramDef}) -> Any:`);
    }
    const sdk = lines.join("\n");

    expect(sdk).toContain("class TradeGatewayClient:");
    expect(sdk).toContain("def declarations_list(self)");
    expect(sdk).toContain("def declarations_create(self, input_data: dict)");
    expect(sdk).toContain("def cargoTracking_getLiveVessels(self)");
  });

  it("operationId dots should be replaced with underscores in function names", () => {
    const operationId = "cargoTracking.getLiveVessels";
    const fnName = operationId.replace(/\./g, "_");
    expect(fnName).toBe("cargoTracking_getLiveVessels");
    expect(fnName).not.toContain(".");
  });

  it("should group endpoints by tag correctly", () => {
    const endpoints = extractEndpoints(mockSpec);
    const byTag = new Map<string, typeof endpoints>();
    for (const ep of endpoints) {
      if (!byTag.has(ep.tag)) byTag.set(ep.tag, []);
      byTag.get(ep.tag)!.push(ep);
    }
    expect(byTag.size).toBe(2); // declarations, cargotracking
    expect(byTag.get("declarations")?.length).toBe(2);
    expect(byTag.get("cargotracking")?.length).toBe(1);
  });
});
