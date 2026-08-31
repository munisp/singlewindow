/**
 * WP-10 — import smoke test: verifies the modified routers (cargoTracking,
 * geofences, portCongestion) and the geo-service client resolve and compile.
 */
import { describe, it, expect } from "vitest";

describe("WP-10 modified modules import cleanly", () => {
  it("cargoTracking router + feed-state exports", async () => {
    const mod = await import("./routers/cargoTracking");
    expect(mod.cargoTrackingRouter).toBeDefined();
    expect(typeof mod.isStale).toBe("function");
    expect(typeof mod.isDemoMode).toBe("function");
  });
  it("geofences router with geo-service backed procedures", async () => {
    const mod = await import("./routers/geofences");
    expect(mod.geofencesRouter).toBeDefined();
  });
  it("portCongestion router with queue forecast procedure", async () => {
    const mod = await import("./routers/portCongestion");
    expect(mod.portCongestionRouter).toBeDefined();
    expect(mod.HEURISTIC_MODEL_LABEL).toMatch(/heuristic/);
  });
  it("geoServiceClient", async () => {
    const mod = await import("./_core/geoServiceClient");
    expect(typeof mod.geoServiceFetch).toBe("function");
    expect(typeof mod.geoServiceStatus).toBe("function");
  });
});
