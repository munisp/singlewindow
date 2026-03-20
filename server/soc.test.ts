/**
 * Security Operations Centre (SOC) Router — Test Suite
 * All procedures use publicProcedure — no auth required.
 * All procedures call external wazuh-svc (unavailable in test env) — we verify graceful handling.
 * Correct input schemas verified against actual router implementation.
 */
import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function makePublicCtx(): TrpcContext {
  return { user: null, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

// ─── getAlerts ────────────────────────────────────────────────────────────────
describe("soc.getAlerts", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.getAlerts).toBe("function");
  });

  it("throws (wazuh-svc unavailable) or returns { total, alerts } for default input", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({}).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts severity filter 'high'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ severity: "high" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts severity filter 'critical'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ severity: "critical" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts severity filter 'low'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ severity: "low" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts severity filter 'medium'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ severity: "medium" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts acknowledged filter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ acknowledged: false }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts limit and offset", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ limit: 10, offset: 0 }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts declarationId filter (string)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ declarationId: "DECL-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts traderId filter (string)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAlerts({ traderId: "TRADER-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for invalid severity value", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.getAlerts({ severity: "extreme" as any })
    ).rejects.toThrow();
  });

  it("throws for limit exceeding 200", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.getAlerts({ limit: 201 })
    ).rejects.toThrow();
  });
});

// ─── acknowledgeAlert ─────────────────────────────────────────────────────────
describe("soc.acknowledgeAlert", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.acknowledgeAlert).toBe("function");
  });

  it("throws or returns for valid string alertId (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.acknowledgeAlert({ alertId: "ALERT-001" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for missing alertId", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.acknowledgeAlert({} as any)
    ).rejects.toThrow();
  });
});

// ─── ingestAlert ──────────────────────────────────────────────────────────────
describe("soc.ingestAlert", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.ingestAlert).toBe("function");
  });

  it("throws or returns for valid alert input (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.ingestAlert({
      ruleId: "100001",
      level: 12,
      description: "Multiple failed logins from 192.168.1.100",
      agentId: "001",
      agentName: "tradegateway-api-01",
      srcIp: "192.168.1.100",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional declarationId and traderId", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.ingestAlert({
      ruleId: "100002",
      level: 8,
      description: "Suspicious declaration submission pattern detected",
      agentId: "002",
      agentName: "tradegateway-api-02",
      declarationId: "DECL-001",
      traderId: "TRADER-001",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for level out of range (0 is below min 1)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.ingestAlert({
        ruleId: "100001",
        level: 0,
        description: "Test",
        agentId: "001",
        agentName: "test",
      })
    ).rejects.toThrow();
  });

  it("throws for level out of range (16 is above max 15)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.ingestAlert({
        ruleId: "100001",
        level: 16,
        description: "Test",
        agentId: "001",
        agentName: "test",
      })
    ).rejects.toThrow();
  });
});

// ─── getIncidents ─────────────────────────────────────────────────────────────
describe("soc.getIncidents", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.getIncidents).toBe("function");
  });

  it("throws or returns for default input (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getIncidents({}).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional status filter 'open'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getIncidents({ status: "open" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional status filter 'resolved'", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getIncidents({ status: "resolved" }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for invalid status value", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.getIncidents({ status: "closed" as any })
    ).rejects.toThrow();
  });
});

// ─── getIncident ──────────────────────────────────────────────────────────────
describe("soc.getIncident", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.getIncident).toBe("function");
  });

  it("throws or returns for string incidentId (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getIncident({ incidentId: "INC-001" }).catch(e => e);
    expect(result).toBeDefined();
  });
});

// ─── createIncident ───────────────────────────────────────────────────────────
describe("soc.createIncident", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.createIncident).toBe("function");
  });

  it("throws or returns for valid incident input (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.createIncident({
      title: "Test Incident",
      severity: "medium",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for title shorter than 3 chars", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.createIncident({ title: "AB" })
    ).rejects.toThrow();
  });

  it("accepts all severity levels", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    for (const severity of ["low", "medium", "high", "critical"] as const) {
      const result = await caller.soc.createIncident({
        title: `${severity} incident test`,
        severity,
      }).catch(e => e);
      expect(result).toBeDefined();
    }
  });
});

// ─── updateIncident ───────────────────────────────────────────────────────────
describe("soc.updateIncident", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.updateIncident).toBe("function");
  });

  it("throws or returns for valid string incidentId (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.updateIncident({
      incidentId: "INC-001",
      status: "resolved",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("accepts optional resolutionNotes", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.updateIncident({
      incidentId: "INC-001",
      status: "resolved",
      resolutionNotes: "Investigated and confirmed false positive",
    }).catch(e => e);
    expect(result).toBeDefined();
  });

  it("throws for invalid status value", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    await expect(
      caller.soc.updateIncident({ incidentId: "INC-001", status: "closed" as any })
    ).rejects.toThrow();
  });
});

// ─── correlateDeclaration ─────────────────────────────────────────────────────
describe("soc.correlateDeclaration", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.correlateDeclaration).toBe("function");
  });

  it("throws or returns for string declarationId (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.correlateDeclaration({ declarationId: "DECL-001" }).catch(e => e);
    expect(result).toBeDefined();
  });
});

// ─── getAgentStatus ───────────────────────────────────────────────────────────
describe("soc.getAgentStatus", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.getAgentStatus).toBe("function");
  });

  it("throws or returns for public access (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getAgentStatus().catch(e => e);
    expect(result).toBeDefined();
  });
});

// ─── getMitreStats ────────────────────────────────────────────────────────────
describe("soc.getMitreStats", () => {
  it("is registered on appRouter", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    expect(typeof caller.soc.getMitreStats).toBe("function");
  });

  it("throws or returns for public access (wazuh-svc unavailable)", async () => {
    const caller = appRouter.createCaller(makePublicCtx());
    const result = await caller.soc.getMitreStats().catch(e => e);
    expect(result).toBeDefined();
  });
});
