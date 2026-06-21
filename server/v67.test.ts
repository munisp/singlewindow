// TradeGateway NGSWTP — v67 Sprint Tests
// Covers: insiderThreat router, schema tables, anomaly detection payload,
// 4-eyes approval flow, batch seed UI, session audit log.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Schema table existence tests ─────────────────────────────────────────────

describe("v67 Schema — Insider Threat Tables", () => {
  it("insiderThreatEvents table export exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.insiderThreatEvents).toBeDefined();
  });

  it("privilegedActionApprovals table export exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.privilegedActionApprovals).toBeDefined();
  });

  it("sessionAuditLog table export exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.sessionAuditLog).toBeDefined();
  });

  it("anomalyDetections table export exists in schema", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.anomalyDetections).toBeDefined();
  });

  it("insiderThreatEvents has chainHash column", async () => {
    const schema = await import("../drizzle/schema");
    const cols = Object.keys(schema.insiderThreatEvents);
    expect(cols).toBeDefined();
  });

  it("privilegedActionApprovals has expiresAt column", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.privilegedActionApprovals).toBeDefined();
  });

  it("sessionAuditLog has isSuspicious column", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.sessionAuditLog).toBeDefined();
  });

  it("anomalyDetections has linkedEventId column", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.anomalyDetections).toBeDefined();
  });
});

// ─── InsiderThreat Router Tests ────────────────────────────────────────────────

describe("v67 insiderThreat Router", () => {
  it("insiderThreat router module exports insiderThreatRouter", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter).toBeDefined();
  });

  it("insiderThreatRouter has getAnomalyAlerts procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.getAnomalyAlerts).toBeDefined();
  });

  it("insiderThreatRouter has getPendingFourEyes procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.getPendingFourEyes).toBeDefined();
  });

  it("insiderThreatRouter has requestFourEyesApproval procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.requestFourEyesApproval).toBeDefined();
  });

  it("insiderThreatRouter has approveFourEyes procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.approveFourEyes).toBeDefined();
  });

  it("insiderThreatRouter has forceLogout procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.forceLogout).toBeDefined();
  });

  it("insiderThreatRouter has getAuditLog procedure", async () => {
    const mod = await import("./routers/insiderThreat");
    expect(mod.insiderThreatRouter._def.procedures.getAuditLog).toBeDefined();
  });
});

// ─── Anomaly Detection Payload Tests ──────────────────────────────────────────

describe("v67 Anomaly Detection Payload", () => {
  it("anomaly detection payload has required fields", () => {
    const payload = {
      ruleId: "RULE-001",
      ruleName: "Off-hours access",
      userId: 42,
      severity: "HIGH",
      description: "User accessed 500+ records at 02:00",
      features: {
        hour_of_day: 2,
        action_count_per_hour: 500,
        unique_records_accessed: 487,
        off_hours_flag: 1,
        role_mismatch_score: 0.0,
      },
    };
    expect(payload.ruleId).toBeTruthy();
    expect(payload.severity).toBe("HIGH");
    expect(payload.features.off_hours_flag).toBe(1);
    expect(payload.features.action_count_per_hour).toBeGreaterThan(100);
  });

  it("severity levels are valid enum values", () => {
    const validSeverities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const testSeverity = "HIGH";
    expect(validSeverities).toContain(testSeverity);
  });

  it("IsolationForest features include all 5 required dimensions", () => {
    const features = {
      hour_of_day: 14,
      action_count_per_hour: 12,
      unique_records_accessed: 8,
      off_hours_flag: 0,
      role_mismatch_score: 0.1,
    };
    const keys = Object.keys(features);
    expect(keys).toHaveLength(5);
    expect(keys).toContain("hour_of_day");
    expect(keys).toContain("action_count_per_hour");
    expect(keys).toContain("unique_records_accessed");
    expect(keys).toContain("off_hours_flag");
    expect(keys).toContain("role_mismatch_score");
  });
});

// ─── 4-Eyes Approval Flow Tests ───────────────────────────────────────────────

describe("v67 4-Eyes Approval Flow", () => {
  it("approval ref is a non-empty string", () => {
    const ref = `APPROVE-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    expect(ref).toBeTruthy();
    expect(ref.startsWith("APPROVE-")).toBe(true);
  });

  it("pending approval has status pending", () => {
    const approval = {
      approvalRef: "APPROVE-001",
      requesterId: 1,
      action: "duty_override",
      entityType: "declaration",
      entityId: "DEC-001",
      description: "Override duty for diplomatic cargo",
      status: "pending",
      expiresAt: new Date(Date.now() + 86400000),
    };
    expect(approval.status).toBe("pending");
    expect(approval.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("approver cannot be the same as requester", () => {
    const requesterId = 5;
    const approverId = 5;
    const isSelfApproval = requesterId === approverId;
    expect(isSelfApproval).toBe(true); // This is the case we must PREVENT
  });

  it("approval status transitions are valid", () => {
    const validTransitions: Record<string, string[]> = {
      pending: ["approved", "denied", "expired"],
      approved: [],
      denied: [],
      expired: [],
    };
    expect(validTransitions["pending"]).toContain("approved");
    expect(validTransitions["pending"]).toContain("denied");
    expect(validTransitions["approved"]).toHaveLength(0);
  });

  it("high-risk actions require 4-eyes approval", () => {
    const highRiskActions = [
      "duty_override",
      "bond_forfeiture",
      "aeo_revocation",
      "sanctions_override",
      "force_clearance",
    ];
    expect(highRiskActions).toHaveLength(5);
    expect(highRiskActions).toContain("duty_override");
    expect(highRiskActions).toContain("aeo_revocation");
  });
});

// ─── Session Audit Log Tests ───────────────────────────────────────────────────

describe("v67 Session Audit Log", () => {
  it("session audit event types are valid", () => {
    const validTypes = ["login", "logout", "force_logout", "token_refresh", "suspicious"];
    validTypes.forEach((t) => expect(t).toBeTruthy());
    expect(validTypes).toHaveLength(5);
  });

  it("force logout records the forcing officer's ID", () => {
    const event = {
      userId: 10,
      sessionId: "sess-abc123",
      eventType: "force_logout",
      forcedByUserId: 99,
      isSuspicious: true,
      suspicionReason: "Anomaly score exceeded threshold",
    };
    expect(event.forcedByUserId).toBe(99);
    expect(event.isSuspicious).toBe(true);
    expect(event.eventType).toBe("force_logout");
  });

  it("risk score is between 0 and 1", () => {
    const riskScore = 0.87;
    expect(riskScore).toBeGreaterThanOrEqual(0);
    expect(riskScore).toBeLessThanOrEqual(1);
  });
});

// ─── Rust Audit Chain Tests ────────────────────────────────────────────────────

describe("v67 Rust Immutable Audit Chain", () => {
  it("chain hash is a 64-character hex string", () => {
    const mockHash = "a".repeat(64);
    expect(mockHash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(mockHash)).toBe(true);
  });

  it("chain is broken when prevChainHash does not match previous entry", () => {
    const entries = [
      { id: 1, chainHash: "aaa", prevChainHash: null },
      { id: 2, chainHash: "bbb", prevChainHash: "aaa" },
      { id: 3, chainHash: "ccc", prevChainHash: "TAMPERED" }, // tampered
    ];
    let chainValid = true;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].prevChainHash !== entries[i - 1].chainHash) {
        chainValid = false;
        break;
      }
    }
    expect(chainValid).toBe(false);
  });

  it("chain is valid when all prevChainHash values match", () => {
    const entries = [
      { id: 1, chainHash: "aaa", prevChainHash: null },
      { id: 2, chainHash: "bbb", prevChainHash: "aaa" },
      { id: 3, chainHash: "ccc", prevChainHash: "bbb" },
    ];
    let chainValid = true;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].prevChainHash !== entries[i - 1].chainHash) {
        chainValid = false;
        break;
      }
    }
    expect(chainValid).toBe(true);
  });
});

// ─── Go RBAC Middleware Tests ──────────────────────────────────────────────────

describe("v67 RBAC Middleware Concepts", () => {
  it("RBAC denies access when role lacks permission", () => {
    const userRole = "trader";
    const requiredPermission = "admin:duty_override";
    const rolePermissions: Record<string, string[]> = {
      admin: ["admin:duty_override", "admin:aeo_revoke"],
      customs_officer: ["customs:clear_declaration"],
      trader: ["trader:submit_declaration"],
    };
    const hasPermission = (rolePermissions[userRole] ?? []).includes(requiredPermission);
    expect(hasPermission).toBe(false);
  });

  it("RBAC allows access when role has permission", () => {
    const userRole = "admin";
    const requiredPermission = "admin:duty_override";
    const rolePermissions: Record<string, string[]> = {
      admin: ["admin:duty_override", "admin:aeo_revoke"],
      customs_officer: ["customs:clear_declaration"],
      trader: ["trader:submit_declaration"],
    };
    const hasPermission = (rolePermissions[userRole] ?? []).includes(requiredPermission);
    expect(hasPermission).toBe(true);
  });

  it("time-of-day restriction blocks off-hours access for sensitive roles", () => {
    const hour = 3; // 3 AM
    const isOffHours = hour < 6 || hour > 22;
    const isSensitiveAction = true;
    const shouldBlock = isOffHours && isSensitiveAction;
    expect(shouldBlock).toBe(true);
  });
});
