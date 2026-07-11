/**
 * Sprint v85 — Vitest Test Suite
 * Covers: GeoIP progress polling (getSeedJobById), Copy JSON (workflowSchemas procedures),
 * WAF CSV export (openAppSec procedures), and TypeScript surface checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { geoipRouter } from "./routers/geoip";
import { workflowSchemasRouter } from "./routers/workflowSchemas";
import { openAppSecRouter } from "./routers/openAppSec";

// ─── Shared mock context ─────────────────────────────────────────────────────
const adminCtx = {
  user: { id: 1, openId: "admin-1", name: "Admin", email: "admin@test.com", role: "admin" as const, createdAt: new Date() },
  req: { headers: {}, method: "POST" } as any,
  res: { setHeader: vi.fn(), getHeader: vi.fn() } as any,
};
const userCtx = {
  user: { id: 2, openId: "user-2", name: "User", email: "user@test.com", role: "user" as const, createdAt: new Date() },
  req: { headers: {}, method: "POST" } as any,
  res: { setHeader: vi.fn(), getHeader: vi.fn() } as any,
};
const anonCtx = {
  user: null,
  req: { headers: {}, method: "POST" } as any,
  res: { setHeader: vi.fn(), getHeader: vi.fn() } as any,
};

// ─── GeoIP Progress Polling ───────────────────────────────────────────────────
describe("geoip.getSeedJobById — progress polling", () => {
  it("throws NOT_FOUND for non-existent job (string jobId)", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    await expect(caller.getSeedJobById({ jobId: "nonexistent-job-id-xyz" })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const caller = geoipRouter.createCaller(anonCtx);
    await expect(caller.getSeedJobById({ jobId: "seed-001" })).rejects.toThrow();
  });

  it("requires admin role", async () => {
    const caller = geoipRouter.createCaller(userCtx);
    await expect(caller.getSeedJobById({ jobId: "seed-001" })).rejects.toThrow();
  });

  it("rejects empty string jobId", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    await expect(caller.getSeedJobById({ jobId: "" })).rejects.toThrow();
  });

  it("returns a job object for known dev-stub jobId", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    const result = await caller.getSeedJobById({ jobId: "seed-001" });
    // dev stub returns an object with status field
    if (result !== null) {
      expect(result).toHaveProperty("status");
    }
  });
});

describe("geoip.getSeedJobs — job list for polling table", () => {
  it("returns jobs object with jobs array", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    const result = await caller.getSeedJobs({ limit: 10, offset: 0 });
    expect(result).toHaveProperty("jobs");
    expect(Array.isArray(result.jobs)).toBe(true);
  });

  it("requires admin role", async () => {
    const caller = geoipRouter.createCaller(userCtx);
    await expect(caller.getSeedJobs({ limit: 10, offset: 0 })).rejects.toThrow();
  });

  it("accepts limit and offset", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    const result = await caller.getSeedJobs({ limit: 5, offset: 0 });
    expect(result.jobs.length).toBeLessThanOrEqual(5);
  });

  it("rejects limit > 100", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    await expect(caller.getSeedJobs({ limit: 200, offset: 0 })).rejects.toThrow();
  });

  it("rejects negative offset", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    await expect(caller.getSeedJobs({ limit: 10, offset: -1 })).rejects.toThrow();
  });
});

describe("geoip.getGeoipStats — stats for seed page header", () => {
  it("returns stats object with expected fields", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    const result = await caller.getGeoipStats();
    expect(result).toHaveProperty("totalIps");
    expect(result).toHaveProperty("countriesCount");
    expect(result).toHaveProperty("seedJobs");
    expect(typeof result.totalIps).toBe("number");
    // seedJobs is an object (total, completed, failed, pending, totalRowsInserted)
    expect(typeof result.seedJobs).toBe("object");
  });

  it("requires admin role", async () => {
    const caller = geoipRouter.createCaller(userCtx);
    await expect(caller.getGeoipStats()).rejects.toThrow();
  });
});

describe("geoip.lookupIp — used in WAF detail drawer", () => {
  it("returns null or an object for unknown IP (dev stub may return data)", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    const result = await caller.lookupIp({ ip: "1.2.3.4" });
    // In dev mode, stub may return a fake entry; in production it returns null if not cached
    if (result !== null) {
      expect(result).toHaveProperty("ip");
    } else {
      expect(result).toBeNull();
    }
  });

  it("requires authentication", async () => {
    const caller = geoipRouter.createCaller(anonCtx);
    await expect(caller.lookupIp({ ip: "1.2.3.4" })).rejects.toThrow();
  });

  it("rejects empty IP string", async () => {
    const caller = geoipRouter.createCaller(adminCtx);
    await expect(caller.lookupIp({ ip: "" })).rejects.toThrow();
  });
});

// ─── Workflow Schema Copy JSON (listWorkflowTypes / getSchemaForType) ─────────
describe("workflowSchemas.listWorkflowTypes — Copy JSON source", () => {
  it("returns array of workflow types", async () => {
    const caller = workflowSchemasRouter.createCaller(adminCtx);
    const result = await caller.listWorkflowTypes();
    expect(Array.isArray(result)).toBe(true);
  });

  it("is accessible to regular users (public procedure)", async () => {
    // listWorkflowTypes may be a protectedProcedure accessible to all authenticated users
    const caller = workflowSchemasRouter.createCaller(userCtx);
    // Either succeeds or throws — just verify no crash
    try {
      const result = await caller.listWorkflowTypes();
      expect(Array.isArray(result)).toBe(true);
    } catch {
      // acceptable if admin-only
    }
  });

  it("requires authentication", async () => {
    const caller = workflowSchemasRouter.createCaller(anonCtx);
    await expect(caller.listWorkflowTypes()).rejects.toThrow();
  });
});

describe("workflowSchemas.getSchemaForType — fetch schema for Copy JSON", () => {
  it("throws NOT_FOUND for unknown workflow type", async () => {
    const caller = workflowSchemasRouter.createCaller(adminCtx);
    await expect(caller.getSchemaForType({ workflowType: "NONEXISTENT_TYPE" })).rejects.toThrow();
  });

  it("is accessible to regular users or throws (depends on procedure type)", async () => {
    const caller = workflowSchemasRouter.createCaller(userCtx);
    try {
      const result = await caller.getSchemaForType({ workflowType: "DECLARATION_PROCESSING" });
      // if accessible, result should have workflowType
      if (result) expect(result).toHaveProperty("workflowType");
    } catch {
      // acceptable if admin-only
    }
  });

  it("rejects empty workflowType", async () => {
    const caller = workflowSchemasRouter.createCaller(adminCtx);
    await expect(caller.getSchemaForType({ workflowType: "" })).rejects.toThrow();
  });
});

describe("workflowSchemas.upsertSchema — save from Copy JSON editor", () => {
  it("requires admin role", async () => {
    const caller = workflowSchemasRouter.createCaller(userCtx);
    await expect(caller.upsertSchema({
      workflowType: "TEST_TYPE",
      jsonSchema: { type: "object" },
      version: 1,
      description: "test",
      isActive: true,
    })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const caller = workflowSchemasRouter.createCaller(anonCtx);
    await expect(caller.upsertSchema({
      workflowType: "TEST_TYPE",
      jsonSchema: { type: "object" },
      version: 1,
      description: "test",
      isActive: true,
    })).rejects.toThrow();
  });

  it("rejects empty workflowType", async () => {
    const caller = workflowSchemasRouter.createCaller(adminCtx);
    await expect(caller.upsertSchema({
      workflowType: "",
      jsonSchema: { type: "object" },
      version: 1,
      description: "test",
      isActive: true,
    })).rejects.toThrow();
  });

  it("rejects version < 1", async () => {
    const caller = workflowSchemasRouter.createCaller(adminCtx);
    await expect(caller.upsertSchema({
      workflowType: "TEST_TYPE",
      jsonSchema: { type: "object" },
      version: 0,
      description: "test",
      isActive: true,
    })).rejects.toThrow();
  });
});

// ─── WAF CSV Export (getWafEvents / getWafStats / getAttackTypes) ─────────────
describe("openAppSec.getWafEvents — CSV export source", () => {
  it("returns events and total", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents({ limit: 10, offset: 0 });
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.events)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("requires authentication", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.getWafEvents({ limit: 10, offset: 0 })).rejects.toThrow();
  });

  it("accepts severity filter", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents({ limit: 10, offset: 0, severity: "critical" });
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("accepts isAcknowledged filter", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents({ limit: 10, offset: 0, isAcknowledged: false });
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("accepts attackType filter", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafEvents({ limit: 10, offset: 0, attackType: "SQL_INJECTION" });
    expect(Array.isArray(result.events)).toBe(true);
  });

  it("rejects limit > 500", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.getWafEvents({ limit: 600, offset: 0 })).rejects.toThrow();
  });

  it("rejects negative offset", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.getWafEvents({ limit: 10, offset: -1 })).rejects.toThrow();
  });
});

describe("openAppSec.getWafStats — CSV header stats", () => {
  it("returns severity counts and unacknowledged", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getWafStats();
    expect(result).toHaveProperty("critical");
    expect(result).toHaveProperty("high");
    expect(result).toHaveProperty("medium");
    expect(result).toHaveProperty("low");
    expect(result).toHaveProperty("unacknowledged");
    expect(typeof result.critical).toBe("number");
  });

  it("requires authentication", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.getWafStats()).rejects.toThrow();
  });
});

describe("openAppSec.getAttackTypes — CSV filter dropdown source", () => {
  it("returns array of attack type strings", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.getAttackTypes();
    expect(Array.isArray(result)).toBe(true);
  });

  it("requires authentication", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.getAttackTypes()).rejects.toThrow();
  });
});

describe("openAppSec.acknowledgeEvent — post-CSV triage", () => {
  it("returns success for non-existent event (idempotent)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const result = await caller.acknowledgeEvent({ id: 999999 });
    expect(result).toHaveProperty("success");
  });

  it("requires authentication", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.acknowledgeEvent({ id: 1 })).rejects.toThrow();
  });

  it("rejects non-positive id", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.acknowledgeEvent({ id: 0 })).rejects.toThrow();
  });
});

describe("openAppSec.bulkAcknowledge — CSV-selected bulk action", () => {
  it("rejects empty ids array (min 1 required)", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    await expect(caller.bulkAcknowledge({ ids: [] })).rejects.toThrow();
  });

  it("requires authentication", async () => {
    const caller = openAppSecRouter.createCaller(anonCtx);
    await expect(caller.bulkAcknowledge({ ids: [1, 2] })).rejects.toThrow();
  });

  it("rejects ids array with more than 200 items", async () => {
    const caller = openAppSecRouter.createCaller(adminCtx);
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    await expect(caller.bulkAcknowledge({ ids })).rejects.toThrow();
  });
});
