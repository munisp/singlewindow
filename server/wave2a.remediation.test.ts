/**
 * Wave-2A remediation tests — RBAC gaps (A1–A6), geo data integrity (A7),
 * and declaration amendment date shaping (A10).
 *
 * RBAC tests use a trader (role "user", no Keycloak roles) context and assert
 * FORBIDDEN; the server-side role check must be authoritative.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import { readFileSync } from "fs";
import path from "path";

const traderCtx = {
  req: {} as any,
  res: {} as any,
  user: { id: 9001, role: "user" as const, openId: "trader-open-id", name: "Trader" },
  keycloakRoles: ["tradegateway-trader"],
};

const adminCtx = {
  req: {} as any,
  res: {} as any,
  user: { id: 1, role: "admin" as const, openId: "admin-open-id", name: "Admin" },
  keycloakRoles: ["tradegateway-admin"],
};

async function expectForbidden(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({ code: "FORBIDDEN" });
}

// ─── A1: apisixAudit must be admin-only ──────────────────────────────────────
describe("A1 — apisixAudit RBAC", () => {
  it("getRouteAudit rejects a trader with FORBIDDEN", async () => {
    const { apisixAuditRouter } = await import("./routers/apisixAudit");
    const caller = apisixAuditRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getRouteAudit({ limit: 10 }));
  });
  it("getRouteIds rejects a trader with FORBIDDEN", async () => {
    const { apisixAuditRouter } = await import("./routers/apisixAudit");
    const caller = apisixAuditRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getRouteIds());
  });
});

// ─── A2: bonded warehouse management must require customs/admin ─────────────
describe("A2 — bondedWarehouse RBAC", () => {
  it("listWarehouses rejects a trader with FORBIDDEN", async () => {
    const { bondedWarehouseRouter } = await import("./routers/bondedWarehouse");
    const caller = bondedWarehouseRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.listWarehouses({ limit: 10, offset: 0 }));
  });
  it("getInventory rejects a trader with FORBIDDEN", async () => {
    const { bondedWarehouseRouter } = await import("./routers/bondedWarehouse");
    const caller = bondedWarehouseRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getInventory({ warehouseId: 1 } as any));
  });
  it("listPermits rejects a trader with FORBIDDEN", async () => {
    const { bondedWarehouseRouter } = await import("./routers/bondedWarehouse");
    const caller = bondedWarehouseRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.listPermits({} as any));
  });
  it("getDashboardStats rejects a trader with FORBIDDEN", async () => {
    const { bondedWarehouseRouter } = await import("./routers/bondedWarehouse");
    const caller = bondedWarehouseRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getDashboardStats());
  });
});

// ─── A3: sensitive status endpoints must be admin-only, no internal URLs ────
describe("A3 — status endpoint RBAC and payload hygiene", () => {
  it("system.health rejects a trader with FORBIDDEN", async () => {
    const { systemRouter } = await import("./_core/systemRouter");
    const caller = systemRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.health({ timestamp: Date.now() }));
  });
  it("keycloak.getServiceStatus rejects a trader with FORBIDDEN", async () => {
    const { keycloakRouter } = await import("./routers/keycloak");
    const caller = keycloakRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getServiceStatus());
  });
  it("keycloak.getServiceStatus payload never contains serviceUrl", async () => {
    const { keycloakRouter } = await import("./routers/keycloak");
    const caller = keycloakRouter.createCaller(adminCtx as any);
    const result = await caller.getServiceStatus();
    expect(result).toHaveProperty("available");
    expect(result).not.toHaveProperty("serviceUrl");
    expect(JSON.stringify(result)).not.toMatch(/localhost:8087|http:\/\/[a-z0-9.-]+:\d+/i);
  });
  it("wazuh.getSecurityScore rejects a trader with FORBIDDEN", async () => {
    const { wazuhRouter } = await import("./routers/wazuh");
    const caller = wazuhRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getSecurityScore());
  });
});

// ─── A4: webhooks.list is caller-scoped (decision: user-scoped by design) ────
describe("A4 — webhooks ownership scoping", () => {
  it("webhooks.list filters by the caller's userId (ownership filter present)", () => {
    const src = readFileSync(path.resolve(__dirname, "routers/webhooks.ts"), "utf8");
    const listBlock = src.slice(src.indexOf("list:"), src.indexOf("create:"));
    expect(listBlock).toContain("webhookSubscriptions.userId");
    expect(listBlock).toContain("ctx.user.id");
  });
  it("webhooks mutations scope every row operation to the caller's userId", () => {
    const src = readFileSync(path.resolve(__dirname, "routers/webhooks.ts"), "utf8");
    // update/delete/rotateSecret/deliveries all AND(id, userId) — no cross-user access
    const count = (src.match(/eq\(webhookSubscriptions\.userId, ctx\.user\.id\)/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(5);
  });
});

// ─── A6: threatIntel/soc — role gate first, then typed degraded errors ──────
describe("A6 — threatIntel/soc RBAC + honest degradation", () => {
  it("threatIntel.getIndicators rejects a trader with FORBIDDEN", async () => {
    const { threatIntelRouter } = await import("./routers/threatIntel");
    const caller = threatIntelRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getIndicators());
  });
  it("threatIntel.getStats rejects a trader with FORBIDDEN", async () => {
    const { threatIntelRouter } = await import("./routers/threatIntel");
    const caller = threatIntelRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getStats());
  });
  it("soc.getAlerts rejects a trader with FORBIDDEN", async () => {
    const { socRouter } = await import("./routers/soc");
    const caller = socRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getAlerts({ limit: 10, offset: 0 }));
  });
  it("soc.getIncidents rejects a trader with FORBIDDEN", async () => {
    const { socRouter } = await import("./routers/soc");
    const caller = socRouter.createCaller(traderCtx as any);
    await expectForbidden(caller.getIncidents({ limit: 10, offset: 0 }));
  });
  it("admin caller receives typed SERVICE_UNAVAILABLE (not raw 'fetch failed') when upstream is down", async () => {
    const { socRouter } = await import("./routers/soc");
    const caller = socRouter.createCaller(adminCtx as any);
    const err = await caller.getAlerts({ limit: 1, offset: 0 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("SERVICE_UNAVAILABLE");
    expect((err as TRPCError).message).not.toContain("fetch failed");
    expect((err as TRPCError).message).toMatch(/unavailable/i);
  });
  it("threatIntel admin caller receives typed SERVICE_UNAVAILABLE when upstream is down", async () => {
    const { threatIntelRouter } = await import("./routers/threatIntel");
    const caller = threatIntelRouter.createCaller(adminCtx as any);
    const err = await caller.getIndicators().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("SERVICE_UNAVAILABLE");
    expect((err as TRPCError).message).not.toContain("fetch failed");
  });
});

// ─── A7: geo data shaping ────────────────────────────────────────────────────
describe("A7 — congestion data shaping", () => {
  it("toFiniteNumber converts NaN/junk to fallback", async () => {
    const { toFiniteNumber } = await import("./routers/portCongestion");
    expect(toFiniteNumber(NaN, 7)).toBe(7);
    expect(toFiniteNumber("NaN", 7)).toBe(7);
    expect(toFiniteNumber(Infinity, 7)).toBe(7);
    expect(toFiniteNumber(undefined, 7)).toBe(7);
    expect(toFiniteNumber("12.5", 7)).toBe(12.5);
    expect(toFiniteNumber(3, 7)).toBe(3);
  });
  it("normalizeCountryCode maps alpha-2, truncations and names to ISO alpha-3", async () => {
    const { normalizeCountryCode } = await import("./routers/portCongestion");
    expect(normalizeCountryCode("Nig")).toBe("NGA");
    expect(normalizeCountryCode("NG")).toBe("NGA");
    expect(normalizeCountryCode("NGA")).toBe("NGA");
    expect(normalizeCountryCode("Nigeria")).toBe("NGA");
    expect(normalizeCountryCode("gh")).toBe("GHA");
    expect(normalizeCountryCode("Ghana")).toBe("GHA");
    expect(normalizeCountryCode("")).toBe("");
    // Unknown codes pass through uppercased, never fabricated
    expect(normalizeCountryCode("de")).toBe("DE");
  });
  it("predictCongestionScore never emits NaN, even with zero/NaN bases", async () => {
    const { predictCongestionScore } = await import("./routers/portCongestion");
    const zeroBase = predictCongestionScore({ baseVessels: 0, baseDwellHours: 0, baseDeclarations: 0, hoursFromNow: 1 });
    expect(Number.isFinite(zeroBase.score)).toBe(true);
    expect(zeroBase.score).toBe(0);
    const nanBase = predictCongestionScore({ baseVessels: NaN, baseDwellHours: NaN, baseDeclarations: NaN, hoursFromNow: 5 });
    expect(Number.isFinite(nanBase.score)).toBe(true);
    expect(Number.isFinite(nanBase.vesselCount)).toBe(true);
    expect(Number.isFinite(nanBase.avgDwellHours)).toBe(true);
    expect(Number.isFinite(nanBase.pendingDeclarations)).toBe(true);
  });
});

describe("A7 — vessel data shaping", () => {
  it("clampVesselSpeedKn clamps impossible speeds and junk", async () => {
    const { clampVesselSpeedKn, MAX_PLAUSIBLE_SPEED_KN } = await import("./routers/cargoTracking");
    expect(clampVesselSpeedKn(93.7)).toBe(MAX_PLAUSIBLE_SPEED_KN);
    expect(clampVesselSpeedKn(81)).toBe(MAX_PLAUSIBLE_SPEED_KN);
    expect(clampVesselSpeedKn(NaN)).toBe(0);
    expect(clampVesselSpeedKn("NaN")).toBe(0);
    expect(clampVesselSpeedKn(-3)).toBe(0);
    expect(clampVesselSpeedKn(undefined)).toBe(0);
    expect(clampVesselSpeedKn(12.4)).toBe(12.4);
  });
  it("sanitizeEta nulls invalid dates and stale past ETAs for underway vessels", async () => {
    const { sanitizeEta } = await import("./routers/cargoTracking");
    const now = new Date("2026-01-01T00:00:00Z");
    expect(sanitizeEta("not-a-date", "underway", now)).toBeNull();
    expect(sanitizeEta(null, "underway", now)).toBeNull();
    // Past ETA + underway is contradictory ("Arrived" while moving) → null
    expect(sanitizeEta("2025-12-31T00:00:00Z", "underway", now)).toBeNull();
    // Past ETA for a moored vessel is legitimate (it arrived)
    expect(sanitizeEta("2025-12-31T00:00:00Z", "moored", now)).toBe("2025-12-31T00:00:00.000Z");
    // Future ETA for underway vessel is legitimate
    expect(sanitizeEta("2026-01-02T00:00:00Z", "underway", now)).toBe("2026-01-02T00:00:00.000Z");
  });
});

// ─── A10: amendment date shaping ─────────────────────────────────────────────
describe("A10 — declaration amendment dates", () => {
  it("shapeAmendment emits ISO strings and a createdAt alias, never undefined", async () => {
    const { shapeAmendment } = await import("./routers/declarationAmendments");
    const shaped = shapeAmendment({
      id: 1,
      requestedAt: new Date("2025-05-01T12:00:00Z"),
      reviewedAt: null,
    } as any);
    expect(shaped.requestedAt).toBe("2025-05-01T12:00:00.000Z");
    expect(shaped.createdAt).toBe("2025-05-01T12:00:00.000Z");
    expect(shaped.reviewedAt).toBeNull();
    expect(new Date(shaped.createdAt!).toString()).not.toBe("Invalid Date");
  });
  it("shapeAmendment maps junk dates to null rather than 'Invalid Date'", async () => {
    const { shapeAmendment } = await import("./routers/declarationAmendments");
    const shaped = shapeAmendment({ requestedAt: "garbage", reviewedAt: "garbage" } as any);
    expect(shaped.requestedAt).toBeNull();
    expect(shaped.createdAt).toBeNull();
    expect(shaped.reviewedAt).toBeNull();
  });
});
