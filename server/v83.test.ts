/**
 * v83 Test Suite
 * Covers: geoipRouter, workflowSchemasRouter, LakehouseJobs cron banner,
 *         and typed retrigger form schema registry.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// SW-E: the mutation paths (uploadGeoipCsv, upsertSchema, seedDefaultSchemas)
// call db.ts helpers that throw "Database unavailable" without a database.
// Mock the db module so the ROUTER logic is unit-tested (both routers import
// ../db dynamically, which resolves to this mock). Query paths keep their
// honest empty-state behaviour.
vi.mock("./db", () => ({
  createGeoipSeedJob: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
    id: 1,
    status: "pending",
    ...data,
  })),
  getGeoipSeedJobs: vi.fn().mockResolvedValue([]),
  getGeoipSeedJobById: vi.fn().mockResolvedValue(null),
  getGeoipSeedStats: vi.fn().mockResolvedValue({
    totalRowsInserted: 0,
    lastSeedAt: null,
    seedJobs: { total: 0, pending: 0, running: 0, completed: 0, failed: 0 },
  }),
  getGeoIp: vi.fn().mockResolvedValue(null),
  listWorkflowInputSchemas: vi.fn().mockResolvedValue([]),
  getWorkflowInputSchema: vi.fn().mockResolvedValue(null),
  upsertWorkflowInputSchema: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
    id: 1,
    ...data,
  })),
  getSchemaVersionHistory: vi.fn().mockResolvedValue([]),
}));

import { geoipRouter } from "./routers/geoip";
import { workflowSchemasRouter } from "./routers/workflowSchemas";

// ─── Mock context ─────────────────────────────────────────────────────────────
const adminCtx = {
  user: { id: 1, openId: "admin-1", name: "Admin", email: "admin@test.com", role: "admin" as const },
  req: { method: "GET", cookies: {}, headers: {}, socket: {} } as any,
  res: {} as any,
};
const userCtx = {
  user: { id: 2, openId: "user-2", name: "User", email: "user@test.com", role: "user" as const },
  req: { method: "GET", cookies: {}, headers: {}, socket: {} } as any,
  res: {} as any,
};

// ─── GeoIP Router Tests ───────────────────────────────────────────────────────
describe("geoipRouter", () => {
  const caller = geoipRouter.createCaller(adminCtx);

  describe("getSeedJobs", () => {
    it("returns an array", async () => {
      const result = await caller.getSeedJobs({ limit: 10, offset: 0 });
      expect(Array.isArray(result.jobs)).toBe(true);
      expect(typeof result.total).toBe("number");
    });

    it("respects limit parameter", async () => {
      const result = await caller.getSeedJobs({ limit: 5, offset: 0 });
      expect(result.jobs.length).toBeLessThanOrEqual(5);
    });

    it("returns pagination info", async () => {
      const result = await caller.getSeedJobs({ limit: 10, offset: 0 });
      expect(result).toHaveProperty("total");
      expect(result).toHaveProperty("jobs");
    });
  });

  describe("getGeoipStats", () => {
    it("returns stats object", async () => {
      const result = await caller.getGeoipStats();
      expect(result).toHaveProperty("totalIps");
      expect(typeof result.totalIps).toBe("number");
    });

    it("returns lastSeedAt field", async () => {
      const result = await caller.getGeoipStats();
      expect(result).toHaveProperty("lastSeedAt");
    });

    it("returns seedJobs stats", async () => {
      const result = await caller.getGeoipStats();
      expect(result).toHaveProperty("seedJobs");
    });
  });

  describe("lookupIp", () => {
    it("returns geolocation for a valid IP", async () => {
      const result = await caller.lookupIp({ ip: "8.8.8.8" });
      expect(result).toHaveProperty("ip");
      expect(result).toHaveProperty("country");
      expect(result).toHaveProperty("countryCode");
    });

    it("returns ASN information", async () => {
      const result = await caller.lookupIp({ ip: "1.1.1.1" });
      expect(result).toHaveProperty("asn");
    });

    it("returns city information", async () => {
      const result = await caller.lookupIp({ ip: "192.168.1.1" });
      expect(result).toHaveProperty("city");
    });

    it("rejects IP shorter than 7 chars", async () => {
      await expect(caller.lookupIp({ ip: "1.1.1" })).rejects.toThrow();
    });
  });

  describe("uploadGeoipCsv", () => {
    it("returns a job object with status", async () => {
      const result = await caller.uploadGeoipCsv({ filename: "GeoLite2-City.csv", s3Key: "geoip/GeoLite2-City.csv" });
      expect(result).toHaveProperty("jobId");
      expect(result).toHaveProperty("status");
    });

    it("requires s3Key", async () => {
      await expect(caller.uploadGeoipCsv({ filename: "test.csv", s3Key: "" })).rejects.toThrow();
    });

    it("requires filename", async () => {
      await expect(caller.uploadGeoipCsv({ filename: "", s3Key: "geoip/test.csv" })).rejects.toThrow();
    });
  });

  describe("access control", () => {
    it("blocks non-admin from uploadGeoipCsv", async () => {
      const userCaller = geoipRouter.createCaller(userCtx);
      await expect(userCaller.uploadGeoipCsv({ s3Key: "test.csv", source: "test" })).rejects.toThrow();
    });

    it("blocks non-admin from lookupIp (admin-only procedure)", async () => {
      const userCaller = geoipRouter.createCaller(userCtx);
      await expect(userCaller.lookupIp({ ip: "8.8.8.8" })).rejects.toThrow();
    });
  });
});

// ─── WorkflowSchemas Router Tests ─────────────────────────────────────────────
describe("workflowSchemasRouter", () => {
  const adminCaller = workflowSchemasRouter.createCaller(adminCtx);
  const userCaller = workflowSchemasRouter.createCaller(userCtx);

  describe("listWorkflowTypes", () => {
    it("returns an array of workflow types", async () => {
      const result = await adminCaller.listWorkflowTypes();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("each entry has workflowType and jsonSchema", async () => {
      const result = await adminCaller.listWorkflowTypes();
      for (const entry of result) {
        expect(entry).toHaveProperty("workflowType");
        expect(entry).toHaveProperty("jsonSchema");
        expect(typeof entry.workflowType).toBe("string");
      }
    });

    it("includes DECLARATION_PROCESSING", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("DECLARATION_PROCESSING");
    });

    it("includes TRADE_STATS_ROLLUP", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("TRADE_STATS_ROLLUP");
    });

    it("includes PAYMENT_RECONCILIATION", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("PAYMENT_RECONCILIATION");
    });

    it("includes KYC_REVERIFICATION", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("KYC_REVERIFICATION");
    });

    it("includes SANCTIONS_SCREENING", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("SANCTIONS_SCREENING");
    });

    it("includes CARGO_TRACKING_SYNC", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("CARGO_TRACKING_SYNC");
    });

    it("includes AEO_RENEWAL", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("AEO_RENEWAL");
    });

    it("includes BOND_EXPIRY_CHECK", async () => {
      const result = await adminCaller.listWorkflowTypes();
      const types = result.map((r) => r.workflowType);
      expect(types).toContain("BOND_EXPIRY_CHECK");
    });

    it("allows regular users to list workflow types", async () => {
      const result = await userCaller.listWorkflowTypes();
      expect(Array.isArray(result)).toBe(true);
    });

    it("each entry has isActive field", async () => {
      const result = await adminCaller.listWorkflowTypes();
      for (const entry of result) {
        expect(entry).toHaveProperty("isActive");
      }
    });

    it("each entry has version field", async () => {
      const result = await adminCaller.listWorkflowTypes();
      for (const entry of result) {
        expect(entry).toHaveProperty("version");
        expect(typeof entry.version).toBe("number");
      }
    });
  });

  describe("getSchemaForType", () => {
    it("returns schema for DECLARATION_PROCESSING", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "DECLARATION_PROCESSING" });
      expect(result.workflowType).toBe("DECLARATION_PROCESSING");
      expect(result.jsonSchema).toHaveProperty("properties");
    });

    it("returns schema for TRADE_STATS_ROLLUP", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "TRADE_STATS_ROLLUP" });
      expect(result.workflowType).toBe("TRADE_STATS_ROLLUP");
    });

    it("returns description field", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "PAYMENT_RECONCILIATION" });
      expect(result).toHaveProperty("description");
      expect(typeof result.description).toBe("string");
    });

    it("throws NOT_FOUND for unknown workflow type", async () => {
      await expect(
        adminCaller.getSchemaForType({ workflowType: "NONEXISTENT_WORKFLOW_XYZ" })
      ).rejects.toThrow();
    });

    it("allows regular users to get schema", async () => {
      const result = await userCaller.getSchemaForType({ workflowType: "KYC_REVERIFICATION" });
      expect(result.workflowType).toBe("KYC_REVERIFICATION");
    });

    it("DECLARATION_PROCESSING schema has declarationId property", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "DECLARATION_PROCESSING" });
      const props = (result.jsonSchema as any).properties;
      expect(props).toHaveProperty("declarationId");
    });

    it("SANCTIONS_SCREENING schema has traderId property", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "SANCTIONS_SCREENING" });
      const props = (result.jsonSchema as any).properties;
      expect(props).toHaveProperty("traderId");
    });

    it("CARGO_TRACKING_SYNC schema has portCode property", async () => {
      const result = await adminCaller.getSchemaForType({ workflowType: "CARGO_TRACKING_SYNC" });
      const props = (result.jsonSchema as any).properties;
      expect(props).toHaveProperty("portCode");
    });
  });

  describe("upsertSchema", () => {
    it("allows admin to upsert a schema", async () => {
      const result = await adminCaller.upsertSchema({
        workflowType: "TEST_WORKFLOW_V83",
        jsonSchema: { type: "object", properties: { testField: { type: "string" } } },
        description: "Test workflow for v83",
        version: 1,
        isActive: true,
      });
      expect(result).toHaveProperty("workflowType");
      expect(result).toHaveProperty("message");
    });

    it("blocks non-admin from upserting schema", async () => {
      await expect(
        userCaller.upsertSchema({
          workflowType: "FORBIDDEN_WORKFLOW",
          jsonSchema: {},
          version: 1,
          isActive: true,
        })
      ).rejects.toThrow();
    });

    it("rejects empty workflowType", async () => {
      await expect(
        adminCaller.upsertSchema({ workflowType: "", jsonSchema: {}, version: 1, isActive: true })
      ).rejects.toThrow();
    });
  });

  describe("seedDefaultSchemas", () => {
    it("allows admin to seed defaults", async () => {
      const result = await adminCaller.seedDefaultSchemas();
      expect(result).toHaveProperty("seeded");
      expect(result.seeded).toBeGreaterThan(0);
      expect(result).toHaveProperty("message");
    });

    it("blocks non-admin from seeding", async () => {
      await expect(userCaller.seedDefaultSchemas()).rejects.toThrow();
    });

    it("seeds at least 8 default schemas", async () => {
      const result = await adminCaller.seedDefaultSchemas();
      expect(result.seeded).toBeGreaterThanOrEqual(8);
    });
  });
});

// ─── Schema integrity tests ───────────────────────────────────────────────────
describe("workflow schema integrity", () => {
  const caller = workflowSchemasRouter.createCaller(adminCtx);

  it("all schemas have type=object at root", async () => {
    const types = await caller.listWorkflowTypes();
    for (const entry of types) {
      const schema = entry.jsonSchema as any;
      expect(schema.type).toBe("object");
    }
  });

  it("all schemas have properties field", async () => {
    const types = await caller.listWorkflowTypes();
    for (const entry of types) {
      const schema = entry.jsonSchema as any;
      expect(schema).toHaveProperty("properties");
    }
  });

  it("DECLARATION_PROCESSING has required declarationId", async () => {
    const result = await caller.getSchemaForType({ workflowType: "DECLARATION_PROCESSING" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("declarationId");
  });

  it("PAYMENT_RECONCILIATION has required dateFrom and dateTo", async () => {
    const result = await caller.getSchemaForType({ workflowType: "PAYMENT_RECONCILIATION" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("dateFrom");
    expect(schema.required).toContain("dateTo");
  });

  it("KYC_REVERIFICATION has required profileId", async () => {
    const result = await caller.getSchemaForType({ workflowType: "KYC_REVERIFICATION" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("profileId");
  });

  it("CARGO_TRACKING_SYNC has required portCode", async () => {
    const result = await caller.getSchemaForType({ workflowType: "CARGO_TRACKING_SYNC" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("portCode");
  });

  it("AEO_RENEWAL has required applicationId", async () => {
    const result = await caller.getSchemaForType({ workflowType: "AEO_RENEWAL" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("applicationId");
  });

  it("SANCTIONS_SCREENING has required traderId", async () => {
    const result = await caller.getSchemaForType({ workflowType: "SANCTIONS_SCREENING" });
    const schema = result.jsonSchema as any;
    expect(schema.required).toContain("traderId");
  });
});
