/**
 * Sprint v81 — Vitest test suite
 * Covers: temporalRunsRouter, openAppSecRouter, lakehouseRouter
 * All tests use the dev-stub paths (NODE_ENV !== "production")
 */
import { describe, it, expect } from "vitest";
import { appRouter } from "./routers";
import { temporalRunsRouter } from "./routers/temporalRuns";
import { openAppSecRouter } from "./routers/openAppSec";
import { lakehouseRouter } from "./routers/lakehouse";

// Admin context stub
const adminCtx = {
  user: { id: 1, name: "Admin", email: "admin@test.com", role: "admin" as const, openId: "oid-1" },
  req: {} as any,
  res: {} as any,
};

const temporalCaller = temporalRunsRouter.createCaller(adminCtx);
const wafCaller = openAppSecRouter.createCaller(adminCtx);
const lakehouseCaller = lakehouseRouter.createCaller(adminCtx);

// ─── temporalRunsRouter ───────────────────────────────────────────────────────

describe("temporalRuns.getWorkflowRuns", () => {
  it("returns runs array and total", async () => {
    const result = await temporalCaller.getWorkflowRuns({});
    expect(result).toHaveProperty("runs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.runs)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
  });

  it("returns up to limit rows", async () => {
    const result = await temporalCaller.getWorkflowRuns({ limit: 5 });
    expect(result.runs.length).toBeLessThanOrEqual(5);
  });

  it("filters by status=completed", async () => {
    const result = await temporalCaller.getWorkflowRuns({ status: "completed" });
    for (const run of result.runs) {
      expect(run.status).toBe("completed");
    }
  });

  it("filters by status=failed", async () => {
    const result = await temporalCaller.getWorkflowRuns({ status: "failed" });
    for (const run of result.runs) {
      expect(run.status).toBe("failed");
    }
  });

  it("filters by workflowType", async () => {
    const result = await temporalCaller.getWorkflowRuns({ workflowType: "DeclarationClearance" });
    for (const run of result.runs) {
      expect(run.workflowType).toBe("DeclarationClearance");
    }
  });

  it("run shape has required fields", async () => {
    const result = await temporalCaller.getWorkflowRuns({ limit: 1 });
    const run = result.runs[0];
    expect(run).toHaveProperty("id");
    expect(run).toHaveProperty("workflowId");
    expect(run).toHaveProperty("runId");
    expect(run).toHaveProperty("workflowType");
    expect(run).toHaveProperty("taskQueue");
    expect(run).toHaveProperty("status");
    expect(run).toHaveProperty("startedAt");
  });

  it("supports offset pagination", async () => {
    const page1 = await temporalCaller.getWorkflowRuns({ limit: 5, offset: 0 });
    const page2 = await temporalCaller.getWorkflowRuns({ limit: 5, offset: 5 });
    if (page1.runs.length > 0 && page2.runs.length > 0) {
      expect(page1.runs[0].id).not.toBe(page2.runs[0].id);
    }
  });
});

describe("temporalRuns.getWorkflowRunById", () => {
  it("returns a single run by id", async () => {
    const result = await temporalCaller.getWorkflowRunById({ id: 1 });
    expect(result).toHaveProperty("id", 1);
    expect(result).toHaveProperty("workflowType");
    expect(result).toHaveProperty("status");
  });

  it("returns different run for id=2", async () => {
    const r1 = await temporalCaller.getWorkflowRunById({ id: 1 });
    const r2 = await temporalCaller.getWorkflowRunById({ id: 2 });
    expect(r1.id).not.toBe(r2.id);
  });
});

describe("temporalRuns.getWorkflowStats", () => {
  it("returns stats object with running/completed/failed/timedOut", async () => {
    const stats = await temporalCaller.getWorkflowStats();
    expect(stats).toHaveProperty("running");
    expect(stats).toHaveProperty("completed");
    expect(stats).toHaveProperty("failed");
    expect(stats).toHaveProperty("timedOut");
    expect(typeof stats.running).toBe("number");
    expect(typeof stats.completed).toBe("number");
  });
});

describe("temporalRuns.retriggerWorkflow", () => {
  it("returns success and newRunId", async () => {
    const result = await temporalCaller.retriggerWorkflow({
      runId: "run-abc-123",
      workflowType: "DeclarationClearance",
    });
    expect(result.success).toBe(true);
    expect(result.newRunId).toBeTruthy();
    expect(result.message).toContain("DeclarationClearance");
  });

  it("accepts optional input params", async () => {
    const result = await temporalCaller.retriggerWorkflow({
      runId: "run-xyz-999",
      workflowType: "KYCVerification",
      input: { declarationId: 42 },
    });
    expect(result.success).toBe(true);
  });
});

describe("temporalRuns.getWorkflowTypes", () => {
  it("returns non-empty array of workflow type strings", async () => {
    const types = await temporalCaller.getWorkflowTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("DeclarationClearance");
  });
});

// ─── openAppSecRouter ─────────────────────────────────────────────────────────

describe("openAppSec.getWafEvents", () => {
  it("returns events array and total", async () => {
    const result = await wafCaller.getWafEvents({});
    expect(result).toHaveProperty("events");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.events)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
  });

  it("returns up to limit rows", async () => {
    const result = await wafCaller.getWafEvents({ limit: 5 });
    expect(result.events.length).toBeLessThanOrEqual(5);
  });

  it("filters by severity=critical", async () => {
    const result = await wafCaller.getWafEvents({ severity: "critical" });
    for (const evt of result.events) {
      expect(evt.severity).toBe("critical");
    }
  });

  it("filters by severity=high", async () => {
    const result = await wafCaller.getWafEvents({ severity: "high" });
    for (const evt of result.events) {
      expect(evt.severity).toBe("high");
    }
  });

  it("filters by isAcknowledged=false", async () => {
    const result = await wafCaller.getWafEvents({ isAcknowledged: false });
    for (const evt of result.events) {
      expect(evt.isAcknowledged).toBe(false);
    }
  });

  it("filters by isAcknowledged=true", async () => {
    const result = await wafCaller.getWafEvents({ isAcknowledged: true });
    for (const evt of result.events) {
      expect(evt.isAcknowledged).toBe(true);
    }
  });

  it("event shape has required fields", async () => {
    const result = await wafCaller.getWafEvents({ limit: 1 });
    const evt = result.events[0];
    expect(evt).toHaveProperty("id");
    expect(evt).toHaveProperty("eventId");
    expect(evt).toHaveProperty("attackType");
    expect(evt).toHaveProperty("severity");
    expect(evt).toHaveProperty("sourceIp");
    expect(evt).toHaveProperty("action");
    expect(evt).toHaveProperty("isAcknowledged");
    expect(evt).toHaveProperty("createdAt");
  });

  it("supports offset pagination", async () => {
    const page1 = await wafCaller.getWafEvents({ limit: 5, offset: 0 });
    const page2 = await wafCaller.getWafEvents({ limit: 5, offset: 5 });
    if (page1.events.length > 0 && page2.events.length > 0) {
      expect(page1.events[0].id).not.toBe(page2.events[0].id);
    }
  });
});

describe("openAppSec.acknowledgeEvent", () => {
  it("returns success and id", async () => {
    const result = await wafCaller.acknowledgeEvent({ id: 1 });
    expect(result.success).toBe(true);
    expect(result.id).toBe(1);
    expect(result.acknowledgedBy).toBe(1);
  });
});

describe("openAppSec.bulkAcknowledge", () => {
  it("returns acknowledged count", async () => {
    const result = await wafCaller.bulkAcknowledge({ ids: [1, 2, 3] });
    expect(result.success).toBe(true);
    expect(result.acknowledged).toBe(3);
  });

  it("handles single id", async () => {
    const result = await wafCaller.bulkAcknowledge({ ids: [5] });
    expect(result.acknowledged).toBe(1);
  });
});

describe("openAppSec.getWafStats", () => {
  it("returns stats with all severity levels and unacknowledged", async () => {
    const stats = await wafCaller.getWafStats();
    expect(stats).toHaveProperty("critical");
    expect(stats).toHaveProperty("high");
    expect(stats).toHaveProperty("medium");
    expect(stats).toHaveProperty("low");
    expect(stats).toHaveProperty("unacknowledged");
    expect(typeof stats.critical).toBe("number");
    expect(typeof stats.unacknowledged).toBe("number");
  });
});

describe("openAppSec.getAttackTypes", () => {
  it("returns non-empty array of attack type strings", async () => {
    const types = await wafCaller.getAttackTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("SQL_INJECTION");
    expect(types).toContain("XSS");
  });
});

// ─── lakehouseRouter ──────────────────────────────────────────────────────────

describe("lakehouse.getLakehouseJobs", () => {
  it("returns jobs array and total", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({});
    expect(result).toHaveProperty("jobs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(result.total).toBeGreaterThan(0);
  });

  it("returns up to limit rows", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({ limit: 5 });
    expect(result.jobs.length).toBeLessThanOrEqual(5);
  });

  it("filters by status=completed", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({ status: "completed" });
    for (const job of result.jobs) {
      expect(job.status).toBe("completed");
    }
  });

  it("filters by status=failed", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({ status: "failed" });
    for (const job of result.jobs) {
      expect(job.status).toBe("failed");
    }
  });

  it("filters by jobType", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({ jobType: "DELTA_COMPACTION" });
    for (const job of result.jobs) {
      expect(job.jobType).toBe("DELTA_COMPACTION");
    }
  });

  it("job shape has required fields", async () => {
    const result = await lakehouseCaller.getLakehouseJobs({ limit: 1 });
    const job = result.jobs[0];
    expect(job).toHaveProperty("id");
    expect(job).toHaveProperty("jobId");
    expect(job).toHaveProperty("jobType");
    expect(job).toHaveProperty("targetTable");
    expect(job).toHaveProperty("status");
    expect(job).toHaveProperty("createdAt");
  });

  it("supports offset pagination", async () => {
    const page1 = await lakehouseCaller.getLakehouseJobs({ limit: 5, offset: 0 });
    const page2 = await lakehouseCaller.getLakehouseJobs({ limit: 5, offset: 5 });
    if (page1.jobs.length > 0 && page2.jobs.length > 0) {
      expect(page1.jobs[0].id).not.toBe(page2.jobs[0].id);
    }
  });
});

describe("lakehouse.getLakehouseJobById", () => {
  it("returns a single job by id", async () => {
    const result = await lakehouseCaller.getLakehouseJobById({ id: 1 });
    expect(result).toHaveProperty("id", 1);
    expect(result).toHaveProperty("jobType");
    expect(result).toHaveProperty("status");
  });
});

describe("lakehouse.getLakehouseStats", () => {
  it("returns stats with all status counts", async () => {
    const stats = await lakehouseCaller.getLakehouseStats();
    expect(stats).toHaveProperty("pending");
    expect(stats).toHaveProperty("running");
    expect(stats).toHaveProperty("completed");
    expect(stats).toHaveProperty("failed");
    expect(typeof stats.completed).toBe("number");
  });
});

describe("lakehouse.triggerLakehouseJob", () => {
  it("returns success and jobId", async () => {
    const result = await lakehouseCaller.triggerLakehouseJob({
      jobType: "DELTA_COMPACTION",
      targetTable: "trade_stats_mirror",
    });
    expect(result.success).toBe(true);
    expect(result.jobId).toBeTruthy();
    expect(result.message).toContain("DELTA_COMPACTION");
  });

  it("accepts optional params", async () => {
    const result = await lakehouseCaller.triggerLakehouseJob({
      jobType: "PARQUET_EXPORT",
      targetTable: "declaration_events_mirror",
      params: { batchSize: 10000 },
    });
    expect(result.success).toBe(true);
  });
});

describe("lakehouse.getJobTypes", () => {
  it("returns non-empty array of job type strings", async () => {
    const types = await lakehouseCaller.getJobTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(0);
    expect(types).toContain("DELTA_COMPACTION");
    expect(types).toContain("PARQUET_EXPORT");
  });
});

describe("lakehouse.getTargetTables", () => {
  it("returns non-empty array of target table strings", async () => {
    const tables = await lakehouseCaller.getTargetTables();
    expect(Array.isArray(tables)).toBe(true);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain("trade_stats_mirror");
    expect(tables).toContain("declaration_events_mirror");
  });
});

// ─── appRouter registration checks ───────────────────────────────────────────

describe("appRouter — v81 router registration", () => {
  it("appRouter has temporalRuns namespace", () => {
    expect(appRouter._def.procedures).toHaveProperty("temporalRuns.getWorkflowRuns");
  });

  it("appRouter has openAppSec namespace", () => {
    expect(appRouter._def.procedures).toHaveProperty("openAppSec.getWafEvents");
  });

  it("appRouter has lakehouse namespace", () => {
    expect(appRouter._def.procedures).toHaveProperty("lakehouse.getLakehouseJobs");
  });

  it("temporalRuns has 5 procedures", () => {
    const procedures = Object.keys(appRouter._def.procedures).filter(k => k.startsWith("temporalRuns."));
    expect(procedures.length).toBeGreaterThanOrEqual(5);
  });

  it("openAppSec has 4 procedures", () => {
    const procedures = Object.keys(appRouter._def.procedures).filter(k => k.startsWith("openAppSec."));
    expect(procedures.length).toBeGreaterThanOrEqual(4);
  });

  it("lakehouse has 5 procedures", () => {
    const procedures = Object.keys(appRouter._def.procedures).filter(k => k.startsWith("lakehouse."));
    expect(procedures.length).toBeGreaterThanOrEqual(5);
  });
});
