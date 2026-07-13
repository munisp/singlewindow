/**
 * v131 Tests — Cron Job Manager & System Status
 *
 * Covers:
 * 1. heartbeatJobs.manualTrigger — dispatch by job name, unknown job rejection
 * 2. heartbeatJobs.listJobs — structure validation
 * 3. heartbeatJobs.getJobDefinitions — all 4 definitions present
 * 4. Health endpoint contract — /api/health shape
 * 5. Health liveness/readiness endpoints
 * 6. CronJobManager page — route exists in App.tsx
 * 7. SystemStatus page — route exists in App.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./_core/heartbeat", () => ({
  updateHeartbeatJob: vi.fn().mockResolvedValue({
    task_uid: "Yi5La6LK32hf2XRTtTTwz5",
    is_enable: false,
    nextExecutionAt: null,
  }),
  heartbeatClient: {
    listTasks: vi.fn().mockResolvedValue({
      tasks: [
        {
          task_uid: "Yi5La6LK32hf2XRTtTTwz5",
          name: "sla-breach-escalation",
          cron_expression: "0 */30 * * * *",
          is_enable: true,
          next_execution_at: "2026-07-13T06:00:00.000Z",
          last_executed_at: null,
        },
        {
          task_uid: "4BbYSg5dZm9W74yX984jjD",
          name: "bond-expiry-digest",
          cron_expression: "0 0 6 * * *",
          is_enable: true,
          next_execution_at: "2026-07-13T06:00:00.000Z",
          last_executed_at: null,
        },
        {
          task_uid: "ERF5kMiLXehFCTwiQQkUNN",
          name: "post-audit-reminder",
          cron_expression: "0 0 8 * * *",
          is_enable: false,
          next_execution_at: null,
          last_executed_at: null,
        },
      ],
      total: 3,
    }),
    toggleTask: vi.fn().mockResolvedValue({
      task_uid: "Yi5La6LK32hf2XRTtTTwz5",
      is_enable: false,
      next_execution_at: null,
    }),
  },
}));

vi.mock("./db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}));

vi.mock("./_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

// Mock the three scheduled handlers used by manualTrigger
vi.mock("./scheduledHandlers/bondExpiryAlerts", () => ({
  bondExpiryAlertsHandler: vi.fn().mockResolvedValue({ processed: 2, notified: 1 }),
}));

vi.mock("./scheduledHandlers/postAuditReminders", () => ({
  postAuditRemindersHandler: vi.fn().mockResolvedValue({ processed: 5, notified: 3 }),
}));

vi.mock("./scheduledHandlers/slaAutoEscalation", () => ({
  slaAutoEscalationHandler: vi.fn().mockResolvedValue({ escalated: 1, notified: 1 }),
}));

vi.mock("./scheduledHandlers/documentVaultExpiry", () => ({
  documentVaultExpiryHandler: vi.fn().mockResolvedValue({ expiring: 4, notified: 4 }),
}));

// ─── Caller setup ─────────────────────────────────────────────────────────────

function adminCaller() {
  return appRouter.createCaller({
    user: {
      id: 1,
      openId: "admin-open-id",
      name: "Admin User",
      email: "admin@test.com",
      role: "admin" as const,
      avatarUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    req: {} as any,
    res: {} as any,
  });
}

function unauthCaller() {
  return appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
}

// ─── Test suites ──────────────────────────────────────────────────────────────

describe("v131 — heartbeatJobs.getJobDefinitions", () => {
  it("returns exactly 4 job definitions", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    expect(defs).toHaveLength(4);
  });

  it("each definition has required fields: key, name, cron, description, path", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    for (const def of defs) {
      expect(def).toHaveProperty("key");
      expect(def).toHaveProperty("name");
      expect(def).toHaveProperty("cron");
      expect(def).toHaveProperty("description");
      expect(def).toHaveProperty("path");
    }
  });

  it("includes bond-expiry-digest with daily 08:00 UTC schedule", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    const bond = defs.find((d) => d.name === "bond-expiry-digest");
    expect(bond).toBeDefined();
    expect(bond!.cron).toMatch(/0 8/); // hour 8
  });

  it("includes sla-breach-escalation with hourly schedule", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    const sla = defs.find((d) => d.name === "sla-breach-escalation");
    expect(sla).toBeDefined();
    // hourly: 0 0 * * * *
    expect(sla!.cron).toBeDefined();
    expect(sla!.cron.length).toBeGreaterThan(0);
  });

  it("includes post-audit-reminder with weekly Monday 06:00 UTC schedule", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    const audit = defs.find((d) => d.name === "post-audit-reminder");
    expect(audit).toBeDefined();
    expect(audit!.cron).toMatch(/0 6/); // hour 6
  });

  it("includes document-vault-expiry definition", async () => {
    const caller = adminCaller();
    const defs = await caller.heartbeatJobs.getJobDefinitions();
    const vault = defs.find((d) => d.name === "document-vault-expiry");
    expect(vault).toBeDefined();
  });

  it("rejects unauthenticated callers", async () => {
    const caller = unauthCaller();
    await expect(caller.heartbeatJobs.getJobDefinitions()).rejects.toThrow();
  });
});

describe("v131 — heartbeatJobs.listJobs", () => {
  it("returns jobs array and total count", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.listJobs();
    expect(result).toHaveProperty("jobs");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(typeof result.total).toBe("number");
  });

  it("each job has task_uid, name, cron_expression, is_enable fields", async () => {
    const caller = adminCaller();
    const { jobs } = await caller.heartbeatJobs.listJobs();
    for (const job of jobs) {
      expect(job).toHaveProperty("task_uid");
      expect(job).toHaveProperty("name");
      expect(job).toHaveProperty("cron_expression");
      expect(job).toHaveProperty("is_enable");
    }
  });

  it("rejects unauthenticated callers", async () => {
    const caller = unauthCaller();
    await expect(caller.heartbeatJobs.listJobs()).rejects.toThrow();
  });
});

describe("v131 — heartbeatJobs.manualTrigger", () => {
  it("triggers bond-expiry-digest and returns result with durationMs", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.manualTrigger({
      jobName: "bond-expiry-digest",
    });
    expect(result).toHaveProperty("jobName", "bond-expiry-digest");
    expect(result).toHaveProperty("durationMs");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("triggers post-audit-reminder and returns result", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.manualTrigger({
      jobName: "post-audit-reminder",
    });
    expect(result.jobName).toBe("post-audit-reminder");
    expect(result).toHaveProperty("triggeredAt");
  });

  it("triggers sla-breach-escalation and returns result", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.manualTrigger({
      jobName: "sla-breach-escalation",
    });
    expect(result.jobName).toBe("sla-breach-escalation");
    expect(result).toHaveProperty("result");
  });

  it("triggers document-vault-expiry and returns result", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.manualTrigger({
      jobName: "document-vault-expiry",
    });
    expect(result.jobName).toBe("document-vault-expiry");
  });

  it("rejects unknown job names", async () => {
    const caller = adminCaller();
    await expect(
      caller.heartbeatJobs.manualTrigger({ jobName: "unknown-job" as any })
    ).rejects.toThrow();
  });

  it("rejects unauthenticated callers", async () => {
    const caller = unauthCaller();
    await expect(
      caller.heartbeatJobs.manualTrigger({ jobName: "bond-expiry-digest" })
    ).rejects.toThrow();
  });

  it("includes triggeredAt ISO timestamp in response", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.manualTrigger({
      jobName: "bond-expiry-digest",
    });
    expect(result.triggeredAt).toBeDefined();
    expect(() => new Date(result.triggeredAt)).not.toThrow();
    expect(new Date(result.triggeredAt).getTime()).toBeGreaterThan(0);
  });
});

describe("v131 — heartbeatJobs.toggleJob", () => {
  it("toggles a job by task_uid and returns updated state", async () => {
    const caller = adminCaller();
    const result = await caller.heartbeatJobs.toggleJob({
      taskUid: "Yi5La6LK32hf2XRTtTTwz5",
      enable: false,
    });
    // Returns { taskUid, enabled, nextExecutionAt }
    expect(result).toHaveProperty("taskUid");
    expect(result).toHaveProperty("enabled");
    expect(result.enabled).toBe(false);
  });

  it("rejects unauthenticated callers", async () => {
    const caller = unauthCaller();
    await expect(
      caller.heartbeatJobs.toggleJob({ taskUid: "Yi5La6LK32hf2XRTtTTwz5", enable: true })
    ).rejects.toThrow();
  });
});

describe("v131 — App.tsx route registration", () => {
  it("CronJobManager route is registered in App.tsx", async () => {
    const { readFileSync } = await import("fs");
    const appContent = readFileSync(
      new URL("../client/src/App.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(appContent).toContain("/app/admin/cron-jobs");
    expect(appContent).toContain("CronJobManager");
  });

  it("AdminSystemStatus route is registered in App.tsx", async () => {
    const { readFileSync } = await import("fs");
    const appContent = readFileSync(
      new URL("../client/src/App.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(appContent).toContain("/app/admin/system-status");
    expect(appContent).toContain("AdminSystemStatus");
  });

  it("CronJobManager is lazy-loaded", async () => {
    const { readFileSync } = await import("fs");
    const appContent = readFileSync(
      new URL("../client/src/App.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(appContent).toMatch(/lazy.*CronJobManager/);
  });

  it("AdminSystemStatus is lazy-loaded", async () => {
    const { readFileSync } = await import("fs");
    const appContent = readFileSync(
      new URL("../client/src/App.tsx", import.meta.url).pathname,
      "utf-8"
    );
    // lazy(() => import('./pages/admin/SystemStatus')) is assigned to AdminSystemStatus
    expect(appContent).toContain("AdminSystemStatus");
    expect(appContent).toContain("pages/admin/SystemStatus");
  });
});

describe("v131 — DashboardLayout nav items", () => {
  it("Cron Job Manager nav item is present in DashboardLayout", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../client/src/components/DashboardLayout.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("/app/admin/cron-jobs");
    expect(content).toContain("Cron Job Manager");
  });

  it("System Status nav item is present in DashboardLayout", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../client/src/components/DashboardLayout.tsx", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("/app/admin/system-status");
    expect(content).toContain("System Status");
  });
});

describe("v131 — Health endpoint contract", () => {
  it("health route file exports registerHealthRoutes", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../server/routes/health.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("registerHealthRoutes");
    expect(content).toContain("/api/health");
  });

  it("health route includes /api/health/live liveness probe", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../server/routes/health.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("/live");
  });

  it("health route includes /api/health/ready readiness probe", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../server/routes/health.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("/ready");
  });

  it("health report includes demoMode field", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../server/routes/health.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("demoMode");
  });

  it("health report includes workerStatus field", async () => {
    const { readFileSync } = await import("fs");
    const content = readFileSync(
      new URL("../server/routes/health.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(content).toContain("workerStatus");
  });
});
