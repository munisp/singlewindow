/**
 * v136 Sprint — Vitest test suite
 * Tests for: threshold audit log helpers, export schedule cadence, sanctions batch validation,
 * OGA bulk approve logic, AEO renewal state machine, post-clearance audit scheduling,
 * declaration risk history helpers, and notification read-receipt logic.
 */
import { describe, it, expect } from "vitest";

// ─── 1. THRESHOLD AUDIT LOG HELPERS ─────────────────────────────────────────

function buildAuditEntry(
  componentName: string,
  fromDegradedMs: number,
  toDegradedMs: number,
  changedBy: string,
  changeReason?: string
) {
  return {
    componentName,
    fromDegradedMs,
    toDegradedMs,
    fromUnhealthyMs: fromDegradedMs * 2,
    toUnhealthyMs: toDegradedMs * 2,
    changedBy,
    changeReason: changeReason ?? null,
    changedAt: new Date(),
  };
}

function computeDelta(entry: ReturnType<typeof buildAuditEntry>) {
  return entry.toDegradedMs - entry.fromDegradedMs;
}

describe("Threshold Audit Log Helpers", () => {
  it("builds a valid audit entry", () => {
    const e = buildAuditEntry("database", 200, 350, "admin@test.com", "Increased after load test");
    expect(e.componentName).toBe("database");
    expect(e.fromDegradedMs).toBe(200);
    expect(e.toDegradedMs).toBe(350);
    expect(e.changedBy).toBe("admin@test.com");
    expect(e.changeReason).toBe("Increased after load test");
  });

  it("computes positive delta correctly", () => {
    const e = buildAuditEntry("redis", 100, 250, "admin");
    expect(computeDelta(e)).toBe(150);
  });

  it("computes negative delta correctly", () => {
    const e = buildAuditEntry("kafka", 500, 300, "admin");
    expect(computeDelta(e)).toBe(-200);
  });

  it("computes zero delta for no change", () => {
    const e = buildAuditEntry("temporal", 400, 400, "admin");
    expect(computeDelta(e)).toBe(0);
  });

  it("sets unhealthy thresholds to 2x degraded", () => {
    const e = buildAuditEntry("tigerbeetle", 150, 300, "admin");
    expect(e.toUnhealthyMs).toBe(600);
    expect(e.fromUnhealthyMs).toBe(300);
  });
});

// ─── 2. EXPORT SCHEDULE CADENCE ──────────────────────────────────────────────

type Cadence = "daily" | "weekly" | "monthly";

function computeNextRunAt(cadence: Cadence, fromDate: Date = new Date()): Date {
  const next = new Date(fromDate);
  if (cadence === "daily") {
    next.setDate(next.getDate() + 1);
    next.setHours(6, 0, 0, 0);
  } else if (cadence === "weekly") {
    const daysUntilMonday = (8 - next.getDay()) % 7 || 7;
    next.setDate(next.getDate() + daysUntilMonday);
    next.setHours(6, 0, 0, 0);
  } else {
    next.setMonth(next.getMonth() + 1, 1);
    next.setHours(6, 0, 0, 0);
  }
  return next;
}

describe("Export Schedule Cadence", () => {
  const base = new Date("2026-07-14T10:00:00Z");

  it("daily schedule runs next day at 06:00", () => {
    const next = computeNextRunAt("daily", base);
    expect(next.getDate()).toBe(15);
    expect(next.getHours()).toBe(6);
    expect(next.getMinutes()).toBe(0);
  });

  it("weekly schedule runs next Monday at 06:00", () => {
    // 2026-07-14 is a Tuesday
    const next = computeNextRunAt("weekly", base);
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(6);
  });

  it("monthly schedule runs on 1st of next month at 06:00", () => {
    const next = computeNextRunAt("monthly", base);
    expect(next.getDate()).toBe(1);
    expect(next.getMonth()).toBe(7); // August (0-indexed)
    expect(next.getHours()).toBe(6);
  });

  it("all cadences produce a future date", () => {
    const now = new Date();
    expect(computeNextRunAt("daily", now) > now).toBe(true);
    expect(computeNextRunAt("weekly", now) > now).toBe(true);
    expect(computeNextRunAt("monthly", now) > now).toBe(true);
  });
});

// ─── 3. SANCTIONS BATCH VALIDATION ──────────────────────────────────────────

function validateSanctionsCsvRow(row: Record<string, string>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!row.entity_name?.trim()) errors.push("entity_name is required");
  if (!row.entity_type?.trim()) errors.push("entity_type is required");
  if (row.entity_name && row.entity_name.length > 255) errors.push("entity_name exceeds 255 chars");
  return { valid: errors.length === 0, errors };
}

describe("Sanctions Batch CSV Validation", () => {
  it("accepts a valid row", () => {
    const result = validateSanctionsCsvRow({ entity_name: "ACME Corp", entity_type: "company", country: "US" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a row with missing entity_name", () => {
    const result = validateSanctionsCsvRow({ entity_name: "", entity_type: "individual" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("entity_name is required");
  });

  it("rejects a row with missing entity_type", () => {
    const result = validateSanctionsCsvRow({ entity_name: "Test Co", entity_type: "" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("entity_type is required");
  });

  it("rejects a row with entity_name exceeding 255 chars", () => {
    const result = validateSanctionsCsvRow({ entity_name: "A".repeat(256), entity_type: "company" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("entity_name exceeds 255 chars");
  });
});

// ─── 4. OGA BULK APPROVE LOGIC ───────────────────────────────────────────────

function validateBulkApproveInput(permitIds: number[], notes?: string, action?: "approve" | "reject"): { valid: boolean; error?: string } {
  if (!permitIds || permitIds.length === 0) return { valid: false, error: "No permits selected" };
  if (permitIds.length > 500) return { valid: false, error: "Cannot bulk process more than 500 permits at once" };
  if (action === "reject" && !notes?.trim()) return { valid: false, error: "Rejection notes are required" };
  const hasDuplicates = new Set(permitIds).size !== permitIds.length;
  if (hasDuplicates) return { valid: false, error: "Duplicate permit IDs detected" };
  return { valid: true };
}

describe("OGA Bulk Approve Validation", () => {
  it("accepts valid bulk approve input", () => {
    expect(validateBulkApproveInput([1, 2, 3], undefined, "approve").valid).toBe(true);
  });

  it("rejects empty permit list", () => {
    const r = validateBulkApproveInput([], undefined, "approve");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("No permits selected");
  });

  it("rejects more than 500 permits", () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);
    const r = validateBulkApproveInput(ids, undefined, "approve");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("500");
  });

  it("rejects rejection without notes", () => {
    const r = validateBulkApproveInput([1, 2], "", "reject");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("required");
  });

  it("accepts rejection with notes", () => {
    const r = validateBulkApproveInput([1, 2], "Missing documents", "reject");
    expect(r.valid).toBe(true);
  });

  it("rejects duplicate permit IDs", () => {
    const r = validateBulkApproveInput([1, 2, 2, 3], undefined, "approve");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Duplicate");
  });
});

// ─── 5. AEO RENEWAL STATE MACHINE ────────────────────────────────────────────

type AeoRenewalStatus = "pending" | "docs_submitted" | "under_review" | "approved" | "rejected";

const VALID_TRANSITIONS: Record<AeoRenewalStatus, AeoRenewalStatus[]> = {
  pending:        ["docs_submitted"],
  docs_submitted: ["under_review", "rejected"],
  under_review:   ["approved", "rejected"],
  approved:       [],
  rejected:       ["pending"], // allow re-application
};

function canTransition(from: AeoRenewalStatus, to: AeoRenewalStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

describe("AEO Renewal State Machine", () => {
  it("allows pending → docs_submitted", () => {
    expect(canTransition("pending", "docs_submitted")).toBe(true);
  });

  it("allows docs_submitted → under_review", () => {
    expect(canTransition("docs_submitted", "under_review")).toBe(true);
  });

  it("allows under_review → approved", () => {
    expect(canTransition("under_review", "approved")).toBe(true);
  });

  it("allows under_review → rejected", () => {
    expect(canTransition("under_review", "rejected")).toBe(true);
  });

  it("allows rejected → pending (re-application)", () => {
    expect(canTransition("rejected", "pending")).toBe(true);
  });

  it("disallows pending → approved (skipping steps)", () => {
    expect(canTransition("pending", "approved")).toBe(false);
  });

  it("disallows approved → any (terminal state)", () => {
    expect(canTransition("approved", "rejected")).toBe(false);
    expect(canTransition("approved", "pending")).toBe(false);
  });
});

// ─── 6. POST-CLEARANCE AUDIT SCHEDULING ─────────────────────────────────────

function validateAuditScheduleInput(input: {
  declarationId: number;
  traderId: number;
  auditType: string;
  scheduledDate: string;
  riskScore?: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.declarationId || input.declarationId <= 0) errors.push("Invalid declarationId");
  if (!input.traderId || input.traderId <= 0) errors.push("Invalid traderId");
  if (!["random", "risk_based", "targeted"].includes(input.auditType)) errors.push("Invalid auditType");
  if (!input.scheduledDate) errors.push("scheduledDate is required");
  const date = new Date(input.scheduledDate);
  if (isNaN(date.getTime())) errors.push("scheduledDate is not a valid date");
  if (input.riskScore !== undefined && (input.riskScore < 0 || input.riskScore > 100)) {
    errors.push("riskScore must be 0–100");
  }
  return { valid: errors.length === 0, errors };
}

describe("Post-Clearance Audit Scheduling Validation", () => {
  it("accepts valid audit schedule input", () => {
    const r = validateAuditScheduleInput({ declarationId: 1, traderId: 5, auditType: "random", scheduledDate: "2026-08-01" });
    expect(r.valid).toBe(true);
  });

  it("rejects invalid declarationId", () => {
    const r = validateAuditScheduleInput({ declarationId: 0, traderId: 5, auditType: "random", scheduledDate: "2026-08-01" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("Invalid declarationId");
  });

  it("rejects invalid auditType", () => {
    const r = validateAuditScheduleInput({ declarationId: 1, traderId: 5, auditType: "surprise", scheduledDate: "2026-08-01" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("Invalid auditType");
  });

  it("rejects invalid date string", () => {
    const r = validateAuditScheduleInput({ declarationId: 1, traderId: 5, auditType: "targeted", scheduledDate: "not-a-date" });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("scheduledDate is not a valid date");
  });

  it("rejects riskScore out of range", () => {
    const r = validateAuditScheduleInput({ declarationId: 1, traderId: 5, auditType: "risk_based", scheduledDate: "2026-08-01", riskScore: 150 });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain("riskScore must be 0–100");
  });
});

// ─── 7. DECLARATION RISK HISTORY ─────────────────────────────────────────────

function classifyRiskLane(score: number): "green" | "yellow" | "red" {
  if (score >= 70) return "red";
  if (score >= 40) return "yellow";
  return "green";
}

function computeRiskTrend(history: { riskScore: number }[]): "improving" | "worsening" | "stable" {
  if (history.length < 2) return "stable";
  const latest = history[0].riskScore;
  const previous = history[1].riskScore;
  if (latest < previous - 5) return "improving";
  if (latest > previous + 5) return "worsening";
  return "stable";
}

describe("Declaration Risk History", () => {
  it("classifies score >= 70 as red lane", () => {
    expect(classifyRiskLane(70)).toBe("red");
    expect(classifyRiskLane(95)).toBe("red");
  });

  it("classifies score 40–69 as yellow lane", () => {
    expect(classifyRiskLane(40)).toBe("yellow");
    expect(classifyRiskLane(65)).toBe("yellow");
  });

  it("classifies score < 40 as green lane", () => {
    expect(classifyRiskLane(0)).toBe("green");
    expect(classifyRiskLane(39)).toBe("green");
  });

  it("detects improving trend", () => {
    expect(computeRiskTrend([{ riskScore: 30 }, { riskScore: 60 }])).toBe("improving");
  });

  it("detects worsening trend", () => {
    expect(computeRiskTrend([{ riskScore: 75 }, { riskScore: 50 }])).toBe("worsening");
  });

  it("detects stable trend (within 5 points)", () => {
    expect(computeRiskTrend([{ riskScore: 52 }, { riskScore: 50 }])).toBe("stable");
  });

  it("returns stable for single entry", () => {
    expect(computeRiskTrend([{ riskScore: 60 }])).toBe("stable");
  });
});

// ─── 8. NOTIFICATION READ-RECEIPT LOGIC ─────────────────────────────────────

type NotifCategory = "declaration_status" | "payment" | "system" | "permit" | "aeo";

function isDeclarationNotification(category: NotifCategory): boolean {
  return category === "declaration_status";
}

function shouldAutoMarkRead(category: NotifCategory, userAction: "view_declarations" | "dismiss" | "none"): boolean {
  if (category === "declaration_status" && userAction === "view_declarations") return true;
  if (userAction === "dismiss") return true;
  return false;
}

describe("Notification Read-Receipt Logic", () => {
  it("identifies declaration_status as declaration notification", () => {
    expect(isDeclarationNotification("declaration_status")).toBe(true);
  });

  it("does not identify payment as declaration notification", () => {
    expect(isDeclarationNotification("payment")).toBe(false);
  });

  it("auto-marks read when user clicks view_declarations on declaration notif", () => {
    expect(shouldAutoMarkRead("declaration_status", "view_declarations")).toBe(true);
  });

  it("auto-marks read on dismiss for any category", () => {
    expect(shouldAutoMarkRead("payment", "dismiss")).toBe(true);
    expect(shouldAutoMarkRead("system", "dismiss")).toBe(true);
  });

  it("does not auto-mark read when no action taken", () => {
    expect(shouldAutoMarkRead("declaration_status", "none")).toBe(false);
    expect(shouldAutoMarkRead("payment", "none")).toBe(false);
  });
});
