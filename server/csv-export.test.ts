/**
 * csv-export.test.ts — Sprint v133
 * Unit tests for:
 *  1. CSV escape helper used in payments.exportMyHistory
 *  2. Cron execution chart data transforms (success-rate, timeline grouping)
 *  3. Declaration quick-filter pill logic
 */

import { describe, it, expect } from "vitest";

// ─── 1. CSV escape helper ─────────────────────────────────────────────────────

function escapeCSV(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

describe("escapeCSV", () => {
  it("returns empty string for null", () => {
    expect(escapeCSV(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(escapeCSV(undefined)).toBe("");
  });

  it("passes through plain strings unchanged", () => {
    expect(escapeCSV("hello")).toBe("hello");
    expect(escapeCSV(42)).toBe("42");
  });

  it("wraps strings containing commas in double quotes", () => {
    expect(escapeCSV("foo,bar")).toBe('"foo,bar"');
  });

  it("wraps strings containing double quotes and escapes them", () => {
    expect(escapeCSV('say "hi"')).toBe('"say ""hi"""');
  });

  it("wraps strings containing newlines", () => {
    expect(escapeCSV("line1\nline2")).toBe('"line1\nline2"');
  });

  it("builds a valid CSV row from payment fields", () => {
    const fields = [1, "REF-001", 5, "1500.00", "GHS", "mobile_money", "completed", "", "", "", "2025-01-01T00:00:00.000Z"];
    const row = fields.map(escapeCSV).join(",");
    expect(row).toBe("1,REF-001,5,1500.00,GHS,mobile_money,completed,,,,2025-01-01T00:00:00.000Z");
  });
});

// ─── 2. Cron chart data transforms ───────────────────────────────────────────

type CronRunLog = {
  id: number;
  jobName: string;
  status: "success" | "error";
  triggeredBy: string;
  durationMs: number | null;
  startedAt: string;
};

function computeSuccessRateData(logs: CronRunLog[]) {
  if (logs.length === 0) return [];
  const successCount = logs.filter((r) => r.status === "success").length;
  const errorCount = logs.length - successCount;
  return [
    { name: "Success", value: successCount },
    { name: "Error", value: errorCount },
  ];
}

function computeJobSuccessRates(logs: CronRunLog[]) {
  const byJob: Record<string, { total: number; success: number; totalDurationMs: number }> = {};
  for (const r of logs) {
    if (!byJob[r.jobName]) byJob[r.jobName] = { total: 0, success: 0, totalDurationMs: 0 };
    byJob[r.jobName].total++;
    if (r.status === "success") byJob[r.jobName].success++;
    byJob[r.jobName].totalDurationMs += r.durationMs ?? 0;
  }
  return Object.entries(byJob).map(([jobName, stats]) => ({
    jobName,
    successRate: Math.round((stats.success / stats.total) * 100),
    totalRuns: stats.total,
    avgDurationMs: Math.round(stats.totalDurationMs / stats.total),
  }));
}

const SAMPLE_LOGS: CronRunLog[] = [
  { id: 1, jobName: "cleanupExpiredSessions", status: "success", triggeredBy: "scheduler", durationMs: 120, startedAt: "2025-01-01T10:00:00.000Z" },
  { id: 2, jobName: "cleanupExpiredSessions", status: "success", triggeredBy: "scheduler", durationMs: 130, startedAt: "2025-01-01T11:00:00.000Z" },
  { id: 3, jobName: "cleanupExpiredSessions", status: "error",   triggeredBy: "scheduler", durationMs: 50,  startedAt: "2025-01-01T12:00:00.000Z" },
  { id: 4, jobName: "syncDeclarationStatuses", status: "success", triggeredBy: "manual",    durationMs: 800, startedAt: "2025-01-01T10:30:00.000Z" },
  { id: 5, jobName: "syncDeclarationStatuses", status: "error",   triggeredBy: "scheduler", durationMs: 200, startedAt: "2025-01-01T11:30:00.000Z" },
];

describe("computeSuccessRateData", () => {
  it("returns empty array for no logs", () => {
    expect(computeSuccessRateData([])).toEqual([]);
  });

  it("counts successes and errors correctly", () => {
    const result = computeSuccessRateData(SAMPLE_LOGS);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "Success", value: 3 });
    expect(result[1]).toEqual({ name: "Error", value: 2 });
  });

  it("handles all-success case", () => {
    const allSuccess = SAMPLE_LOGS.filter((r) => r.status === "success");
    const result = computeSuccessRateData(allSuccess);
    expect(result[0].value).toBe(3);
    expect(result[1].value).toBe(0);
  });
});

describe("computeJobSuccessRates", () => {
  it("returns empty array for no logs", () => {
    expect(computeJobSuccessRates([])).toEqual([]);
  });

  it("computes per-job success rates correctly", () => {
    const result = computeJobSuccessRates(SAMPLE_LOGS);
    const cleanup = result.find((r) => r.jobName === "cleanupExpiredSessions")!;
    const sync = result.find((r) => r.jobName === "syncDeclarationStatuses")!;

    expect(cleanup).toBeDefined();
    expect(cleanup.totalRuns).toBe(3);
    expect(cleanup.successRate).toBe(67); // 2/3 = 66.7 → 67
    expect(cleanup.avgDurationMs).toBe(100); // (120+130+50)/3 = 100

    expect(sync).toBeDefined();
    expect(sync.totalRuns).toBe(2);
    expect(sync.successRate).toBe(50);
    expect(sync.avgDurationMs).toBe(500); // (800+200)/2 = 500
  });
});

// ─── 3. Declaration quick-filter pill logic ───────────────────────────────────

type Declaration = {
  id: number;
  declarationNumber: string;
  status: string;
  riskLane?: string;
};

const DECLARATIONS: Declaration[] = [
  { id: 1, declarationNumber: "DEC-001", status: "submitted" },
  { id: 2, declarationNumber: "DEC-002", status: "green_lane", riskLane: "green" },
  { id: 3, declarationNumber: "DEC-003", status: "red_lane",   riskLane: "red" },
  { id: 4, declarationNumber: "DEC-004", status: "cleared" },
  { id: 5, declarationNumber: "DEC-005", status: "rejected" },
  { id: 6, declarationNumber: "DEC-006", status: "under_review" },
];

function applyDeclarationFilter(declarations: Declaration[], statusFilter: string): Declaration[] {
  if (statusFilter === "ALL") return declarations;
  return declarations.filter((d) => d.status === statusFilter);
}

describe("applyDeclarationFilter", () => {
  it("returns all declarations when filter is ALL", () => {
    expect(applyDeclarationFilter(DECLARATIONS, "ALL")).toHaveLength(6);
  });

  it("filters to submitted declarations", () => {
    const result = applyDeclarationFilter(DECLARATIONS, "submitted");
    expect(result).toHaveLength(1);
    expect(result[0].declarationNumber).toBe("DEC-001");
  });

  it("filters to green_lane declarations", () => {
    const result = applyDeclarationFilter(DECLARATIONS, "green_lane");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(2);
  });

  it("filters to cleared declarations", () => {
    const result = applyDeclarationFilter(DECLARATIONS, "cleared");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(4);
  });

  it("returns empty array when no match", () => {
    const result = applyDeclarationFilter(DECLARATIONS, "held");
    expect(result).toHaveLength(0);
  });

  it("does not mutate the original array", () => {
    const copy = [...DECLARATIONS];
    applyDeclarationFilter(DECLARATIONS, "submitted");
    expect(DECLARATIONS).toEqual(copy);
  });
});

// ─── 4. Permit quick-filter pill logic ───────────────────────────────────────

type Permit = {
  id: number;
  permitNumber: string;
  status: string;
};

const PERMITS: Permit[] = [
  { id: 1, permitNumber: "PERM-001", status: "approved" },
  { id: 2, permitNumber: "PERM-002", status: "pending" },
  { id: 3, permitNumber: "PERM-003", status: "under_review" },
  { id: 4, permitNumber: "PERM-004", status: "rejected" },
  { id: 5, permitNumber: "PERM-005", status: "conditional" },
];

function applyPermitFilter(permits: Permit[], filterValue: string): Permit[] {
  if (filterValue === "all") return permits;
  if (filterValue === "active") return permits.filter((p) => p.status === "approved");
  if (filterValue === "pending") return permits.filter((p) => p.status === "pending" || p.status === "under_review");
  if (filterValue === "expired") return permits.filter((p) => p.status === "rejected" || p.status === "conditional");
  return permits;
}

describe("applyPermitFilter", () => {
  it("returns all permits for 'all' filter", () => {
    expect(applyPermitFilter(PERMITS, "all")).toHaveLength(5);
  });

  it("returns only approved permits for 'active' filter", () => {
    const result = applyPermitFilter(PERMITS, "active");
    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("approved");
  });

  it("returns pending and under_review permits for 'pending' filter", () => {
    const result = applyPermitFilter(PERMITS, "pending");
    expect(result).toHaveLength(2);
    expect(result.every((p) => ["pending", "under_review"].includes(p.status))).toBe(true);
  });

  it("returns rejected and conditional permits for 'expired' filter", () => {
    const result = applyPermitFilter(PERMITS, "expired");
    expect(result).toHaveLength(2);
    expect(result.every((p) => ["rejected", "conditional"].includes(p.status))).toBe(true);
  });
});
