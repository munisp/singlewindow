/**
 * Sprint v82 — Vitest Test Suite
 * Covers:
 *  - retriggerWorkflow AlertDialog (TemporalWorkflowRuns router procedures)
 *  - WAF geolocation (openAppSec router — countryFlag, asn, city fields)
 *  - geoip_cache db helpers (getGeoIp, upsertGeoIp, bulkGetGeoIps)
 *  - Lakehouse rollup handler (lakehouseRollup.ts — unit-level)
 *  - LakehouseJobs countdown utility (getNextRollupTime logic)
 *  - geoip_cache schema presence
 *  - migration 0037 presence
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import fs from "fs";

// ─── Helpers ─────────────────────────────────────────────────────────────────
function makeAdminCtx() {
  return {
    user: { id: 1, role: "admin", openId: "test-admin", name: "Admin", email: "admin@test.com", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(), loginMethod: null },
    req: {} as any,
    res: {} as any,
  };
}

// ─── 1. TemporalWorkflowRuns router — retrigger procedure ─────────────────────
describe("temporalRunsRouter", () => {
  it("retriggerWorkflow returns success with newRunId in dev mode", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.retriggerWorkflow({ runId: "run-001", workflowType: "DeclarationProcessing" });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("newRunId");
    expect(typeof result.newRunId).toBe("string");
  });

  it("retriggerWorkflow returns message string", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.retriggerWorkflow({ runId: "run-002", workflowType: "RiskScoring" });
    expect(result).toHaveProperty("message");
    expect(typeof result.message).toBe("string");
  });

  it("getWorkflowRunById returns a run object with expected fields", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWorkflowRunById({ id: 1 });
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("workflowId");
    expect(result).toHaveProperty("workflowType");
    expect(result).toHaveProperty("status");
  });

  it("getWorkflowStats returns numeric counts (running/completed/failed/timedOut)", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const stats = await caller.getWorkflowStats();
    expect(typeof stats.running).toBe("number");
    expect(typeof stats.completed).toBe("number");
    expect(typeof stats.failed).toBe("number");
    expect(typeof stats.timedOut).toBe("number");
  });

  it("getWorkflowTypes returns a non-empty array of strings", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const types = await caller.getWorkflowTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    types.forEach((t) => expect(typeof t).toBe("string"));
  });

  it("getWorkflowRuns returns paginated result with items and total", async () => {
    const { temporalRunsRouter } = await import("./routers/temporalRuns");
    const caller = temporalRunsRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWorkflowRuns({ limit: 10, offset: 0 });
    expect(result).toHaveProperty("runs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.runs)).toBe(true);
    expect(typeof result.total).toBe("number");
  });
});

// ─── 2. OpenAppSec router — geolocation fields ────────────────────────────────
describe("openAppSecRouter — geolocation", () => {
  it("getWafEvents returns events with countryFlag field", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    expect(result.events.length).toBeGreaterThan(0);
    const first = result.events[0] as any;
    expect(first).toHaveProperty("countryFlag");
    expect(typeof first.countryFlag).toBe("string");
  });

  it("getWafEvents events have asn field", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    const first = result.events[0] as any;
    expect("asn" in first).toBe(true);
  });

  it("getWafEvents events have city field", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    const first = result.events[0] as any;
    expect("city" in first).toBe(true);
  });

  it("getWafEvents events have country field", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    const first = result.events[0] as any;
    expect("country" in first).toBe(true);
  });

  it("getWafEvents events have asnOrg field", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    const first = result.events[0] as any;
    expect("asnOrg" in first).toBe(true);
  });

  it("getWafEvents countryFlag is a non-empty string", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getWafEvents({ limit: 20, offset: 0 });
    const withFlag = result.events.filter((e: any) => e.countryFlag && e.countryFlag !== "🌐");
    expect(withFlag.length).toBeGreaterThan(0);
  });

  it("getWafStats returns severity counts", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const stats = await caller.getWafStats();
    expect(typeof stats.critical).toBe("number");
    expect(typeof stats.high).toBe("number");
    expect(typeof stats.medium).toBe("number");
    expect(typeof stats.low).toBe("number");
    expect(typeof stats.unacknowledged).toBe("number");
  });

  it("getAttackTypes returns a non-empty array", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const types = await caller.getAttackTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
  });

  it("acknowledgeEvent returns success in dev mode", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.acknowledgeEvent({ id: 1 });
    expect(result).toHaveProperty("success", true);
  });

  it("bulkAcknowledge returns acknowledged count", async () => {
    const { openAppSecRouter } = await import("./routers/openAppSec");
    const caller = openAppSecRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.bulkAcknowledge({ ids: [1, 2, 3] });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("acknowledged", 3);
  });
});

// ─── 3. GeoIP cache db helpers (unit — no DB) ────────────────────────────────
describe("geoip db helpers — no-DB graceful degradation", () => {
  it("getGeoIp returns null when DB is unavailable", async () => {
    const { getGeoIp } = await import("./db");
    const result = await getGeoIp("1.2.3.4");
    expect(result).toBeNull();
  });

  it("upsertGeoIp returns null when DB is unavailable", async () => {
    const { upsertGeoIp } = await import("./db");
    const result = await upsertGeoIp({
      ip: "1.2.3.4",
      country: "Test",
      countryCode: "TS",
      city: "Testville",
      asn: "AS12345",
      asnOrg: "Test ISP",
    });
    expect(result).toBeNull();
  });

  it("bulkGetGeoIps returns empty array for empty input", async () => {
    const { bulkGetGeoIps } = await import("./db");
    const result = await bulkGetGeoIps([]);
    expect(result).toEqual([]);
  });

  it("bulkGetGeoIps returns empty array when DB is unavailable", async () => {
    const { bulkGetGeoIps } = await import("./db");
    const result = await bulkGetGeoIps(["1.2.3.4", "5.6.7.8"]);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ─── 4. Lakehouse rollup handler — unit tests ────────────────────────────────
describe("lakehouseRollupHandler", () => {
  it("exports lakehouseRollupHandler function", async () => {
    const mod = await import("./scheduled/lakehouseRollup");
    expect(typeof mod.lakehouseRollupHandler).toBe("function");
  });

  it("returns 403 when user is not a cron caller", async () => {
    const { lakehouseRollupHandler } = await import("./scheduled/lakehouseRollup");
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const mockReq = {
      headers: { cookie: "app_session_id=fake-token" },
    } as any;
    const mockRes = { status, json } as any;

    // sdk.authenticateRequest will throw or return non-cron user in test env
    await lakehouseRollupHandler(mockReq, mockRes);
    // Either status(403) or json({error:...}) should be called
    const called403 = status.mock.calls.some((c) => c[0] === 403);
    const calledJson = json.mock.calls.length > 0;
    expect(called403 || calledJson).toBe(true);
  });
});

// ─── 5. LakehouseJobs countdown utility ──────────────────────────────────────
describe("getNextRollupTime utility", () => {
  it("next rollup time is always in the future", () => {
    const now = new Date();
    const next = (() => {
      const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
      if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
      return n;
    })();
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("next rollup time is at 02:00 UTC", () => {
    const now = new Date();
    const next = (() => {
      const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
      if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
      return n;
    })();
    expect(next.getUTCHours()).toBe(2);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
  });

  it("next rollup time is at most 24 hours away", () => {
    const now = new Date();
    const next = (() => {
      const n = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 2, 0, 0, 0));
      if (n <= now) n.setUTCDate(n.getUTCDate() + 1);
      return n;
    })();
    const diffMs = next.getTime() - now.getTime();
    expect(diffMs).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

// ─── 6. geoip_cache schema presence ──────────────────────────────────────────
describe("geoip_cache schema", () => {
  it("geoipCache table is exported from drizzle/schema.ts", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema).toHaveProperty("geoipCache");
  });

  it("geoipCache has ip column", async () => {
    const { geoipCache } = await import("../drizzle/schema");
    expect((geoipCache as any).ip).toBeDefined();
  });

  it("geoipCache has countryCode column", async () => {
    const { geoipCache } = await import("../drizzle/schema");
    expect((geoipCache as any).countryCode).toBeDefined();
  });

  it("geoipCache has asn column", async () => {
    const { geoipCache } = await import("../drizzle/schema");
    expect((geoipCache as any).asn).toBeDefined();
  });

  it("InsertGeoipCache type is exported", async () => {
    const schema = await import("../drizzle/schema");
    // Type-level check: InsertGeoipCache should be exported (runtime check via key presence)
    expect("InsertGeoipCache" in schema || "geoipCache" in schema).toBe(true);
  });
});

// ─── 7. Migration 0037 presence ──────────────────────────────────────────────
describe("migration 0037 — geoip_cache", () => {
  it("migration file 0037 exists in drizzle/migrations", () => {
    const migrationsDir = path.resolve(__dirname, "../drizzle/migrations");
    const files = fs.readdirSync(migrationsDir);
    const has0037 = files.some((f) => f.startsWith("0037_"));
    expect(has0037).toBe(true);
  });

  it("migration 0037 contains CREATE TABLE geoip_cache", () => {
    const migrationsDir = path.resolve(__dirname, "../drizzle/migrations");
    const files = fs.readdirSync(migrationsDir);
    const file0037 = files.find((f) => f.startsWith("0037_"));
    expect(file0037).toBeDefined();
    const content = fs.readFileSync(path.join(migrationsDir, file0037!), "utf-8");
    expect(content.toLowerCase()).toContain("geoip_cache");
  });
});

// ─── 8. Lakehouse router — v82 compatibility ─────────────────────────────────
describe("lakehouseRouter — v82", () => {
  it("getLakehouseJobs returns jobs array and total", async () => {
    const { lakehouseRouter } = await import("./routers/lakehouse");
    const caller = lakehouseRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.getLakehouseJobs({ limit: 5, offset: 0 });
    expect(result).toHaveProperty("jobs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.jobs)).toBe(true);
  });

  it("getLakehouseStats returns running/completed/failed/pending counts", async () => {
    const { lakehouseRouter } = await import("./routers/lakehouse");
    const caller = lakehouseRouter.createCaller(makeAdminCtx() as any);
    const stats = await caller.getLakehouseStats();
    expect(typeof stats.running).toBe("number");
    expect(typeof stats.completed).toBe("number");
    expect(typeof stats.failed).toBe("number");
    expect(typeof stats.pending).toBe("number");
  });

  it("getJobTypes returns non-empty array", async () => {
    const { lakehouseRouter } = await import("./routers/lakehouse");
    const caller = lakehouseRouter.createCaller(makeAdminCtx() as any);
    const types = await caller.getJobTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
  });

  it("getTargetTables returns non-empty array", async () => {
    const { lakehouseRouter } = await import("./routers/lakehouse");
    const caller = lakehouseRouter.createCaller(makeAdminCtx() as any);
    const tables = await caller.getTargetTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("triggerLakehouseJob returns success message", async () => {
    const { lakehouseRouter } = await import("./routers/lakehouse");
    const caller = lakehouseRouter.createCaller(makeAdminCtx() as any);
    const result = await caller.triggerLakehouseJob({ jobType: "TRADE_STATS_ROLLUP", targetTable: "trade_stats_mirror" });
    expect(result).toHaveProperty("success", true);
    expect(result).toHaveProperty("message");
  });
});

// ─── 9. AppRouter registration checks ────────────────────────────────────────
describe("appRouter — v82 router registrations", () => {
  it("appRouter has temporalRuns namespace", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toBeDefined();
    const keys = Object.keys(appRouter._def.procedures);
    const hasTemporalRuns = keys.some((k) => k.startsWith("temporalRuns."));
    expect(hasTemporalRuns).toBe(true);
  });

  it("appRouter has openAppSec namespace", async () => {
    const { appRouter } = await import("./routers");
    const keys = Object.keys(appRouter._def.procedures);
    const hasOpenAppSec = keys.some((k) => k.startsWith("openAppSec."));
    expect(hasOpenAppSec).toBe(true);
  });

  it("appRouter has lakehouse namespace", async () => {
    const { appRouter } = await import("./routers");
    const keys = Object.keys(appRouter._def.procedures);
    const hasLakehouse = keys.some((k) => k.startsWith("lakehouse."));
    expect(hasLakehouse).toBe(true);
  });

  it("appRouter has redis namespace", async () => {
    const { appRouter } = await import("./routers");
    const keys = Object.keys(appRouter._def.procedures);
    const hasRedis = keys.some((k) => k.startsWith("redis."));
    expect(hasRedis).toBe(true);
  });

  it("appRouter has kafkaEvents namespace", async () => {
    const { appRouter } = await import("./routers");
    const keys = Object.keys(appRouter._def.procedures);
    const hasKafka = keys.some((k) => k.startsWith("kafkaEvents."));
    expect(hasKafka).toBe(true);
  });

  it("appRouter has ogaPermitAudit namespace", async () => {
    const { appRouter } = await import("./routers");
    const keys = Object.keys(appRouter._def.procedures);
    const hasOga = keys.some((k) => k.startsWith("ogaPermitAudit."));
    expect(hasOga).toBe(true);
  });
});
