/**
 * v134.test.ts — Sprint v134
 * Unit tests for:
 *  1. getPresetDates — date-range quick-preset helper used in Payments.tsx
 *  2. Cron threshold alert logic — jobThresholdMap + alertingJobs derivation
 *  3. inProgressDeclCount derivation — sidebar badge calculation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── 1. getPresetDates helper ─────────────────────────────────────────────────

function getPresetDates(preset: string): { startDate?: string; endDate?: string } {
  const now = new Date();
  if (preset === "7")    return { startDate: new Date(now.getTime() - 7  * 86400_000).toISOString(), endDate: now.toISOString() };
  if (preset === "30")   return { startDate: new Date(now.getTime() - 30 * 86400_000).toISOString(), endDate: now.toISOString() };
  if (preset === "90")   return { startDate: new Date(now.getTime() - 90 * 86400_000).toISOString(), endDate: now.toISOString() };
  if (preset === "year") return { startDate: new Date(now.getFullYear(), 0, 1).toISOString(), endDate: now.toISOString() };
  return {}; // "all" — no date filter
}

describe("getPresetDates", () => {
  const FIXED_NOW = new Date("2025-07-01T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty object for 'all' preset", () => {
    expect(getPresetDates("all")).toEqual({});
  });

  it("returns 7-day range for '7' preset", () => {
    const result = getPresetDates("7");
    expect(result.startDate).toBe(new Date(FIXED_NOW.getTime() - 7 * 86400_000).toISOString());
    expect(result.endDate).toBe(FIXED_NOW.toISOString());
  });

  it("returns 30-day range for '30' preset", () => {
    const result = getPresetDates("30");
    expect(result.startDate).toBe(new Date(FIXED_NOW.getTime() - 30 * 86400_000).toISOString());
    expect(result.endDate).toBe(FIXED_NOW.toISOString());
  });

  it("returns 90-day range for '90' preset", () => {
    const result = getPresetDates("90");
    expect(result.startDate).toBe(new Date(FIXED_NOW.getTime() - 90 * 86400_000).toISOString());
    expect(result.endDate).toBe(FIXED_NOW.toISOString());
  });

  it("returns year-to-date range for 'year' preset", () => {
    const result = getPresetDates("year");
    expect(result.startDate).toBe(new Date(2025, 0, 1).toISOString()); // Jan 1 2025
    expect(result.endDate).toBe(FIXED_NOW.toISOString());
  });

  it("start date is always before end date for all presets", () => {
    for (const preset of ["7", "30", "90", "year"]) {
      const { startDate, endDate } = getPresetDates(preset);
      expect(new Date(startDate!).getTime()).toBeLessThan(new Date(endDate!).getTime());
    }
  });
});

// ─── 2. Cron threshold alert logic ───────────────────────────────────────────

type ThresholdRow = {
  componentName: string;
  degradedMs: number;
  unhealthyMs: number;
};

function buildJobThresholdMap(thresholds: ThresholdRow[]): Record<string, number> {
  const map: Record<string, number> = {};
  thresholds.forEach((t) => {
    map[t.componentName] = Math.min(50, Math.max(5, Math.round(t.degradedMs / 10)));
  });
  return map;
}

type JobRate = {
  rawJobName: string;
  successRate: number;
  errorRate: number;
  totalRuns: number;
  avgDurationMs: number;
  aboveThreshold: boolean;
  threshold: number;
};

function computeJobRatesWithThresholds(
  logs: Array<{ jobName: string; status: "success" | "error"; durationMs: number | null }>,
  thresholdMap: Record<string, number>,
  defaultThreshold = 20
): JobRate[] {
  const byJob: Record<string, { total: number; success: number; totalDurationMs: number }> = {};
  for (const r of logs) {
    if (!byJob[r.jobName]) byJob[r.jobName] = { total: 0, success: 0, totalDurationMs: 0 };
    byJob[r.jobName].total++;
    if (r.status === "success") byJob[r.jobName].success++;
    byJob[r.jobName].totalDurationMs += r.durationMs ?? 0;
  }
  return Object.entries(byJob).map(([jobName, stats]) => {
    const successRate = Math.round((stats.success / stats.total) * 100);
    const errorRate = 100 - successRate;
    const threshold = thresholdMap[jobName] ?? defaultThreshold;
    return {
      rawJobName: jobName,
      successRate,
      errorRate,
      totalRuns: stats.total,
      avgDurationMs: Math.round(stats.totalDurationMs / stats.total),
      aboveThreshold: errorRate > threshold,
      threshold,
    };
  });
}

describe("buildJobThresholdMap", () => {
  it("maps degradedMs / 10 to error rate threshold", () => {
    const thresholds: ThresholdRow[] = [
      { componentName: "database",    degradedMs: 300,  unhealthyMs: 1000 },
      { componentName: "redis",       degradedMs: 50,   unhealthyMs: 200  },
    ];
    const map = buildJobThresholdMap(thresholds);
    expect(map["database"]).toBe(30);  // 300/10 = 30
    expect(map["redis"]).toBe(5);      // 50/10 = 5, clamped to min 5
  });

  it("clamps threshold to [5, 50]", () => {
    const thresholds: ThresholdRow[] = [
      { componentName: "fast", degradedMs: 10,   unhealthyMs: 50   }, // 10/10=1 → clamped to 5
      { componentName: "slow", degradedMs: 9000, unhealthyMs: 20000 }, // 9000/10=900 → clamped to 50
    ];
    const map = buildJobThresholdMap(thresholds);
    expect(map["fast"]).toBe(5);
    expect(map["slow"]).toBe(50);
  });

  it("returns empty map for empty thresholds", () => {
    expect(buildJobThresholdMap([])).toEqual({});
  });
});

describe("computeJobRatesWithThresholds", () => {
  const logs = [
    { jobName: "cleanupSessions", status: "success" as const, durationMs: 100 },
    { jobName: "cleanupSessions", status: "success" as const, durationMs: 120 },
    { jobName: "cleanupSessions", status: "error"   as const, durationMs: 50  },
    { jobName: "syncStatuses",    status: "error"   as const, durationMs: 200 },
    { jobName: "syncStatuses",    status: "error"   as const, durationMs: 180 },
    { jobName: "syncStatuses",    status: "success" as const, durationMs: 300 },
  ];

  it("marks job as aboveThreshold when error rate exceeds threshold", () => {
    // cleanupSessions: 1/3 errors = 33% error rate; threshold 20% → above
    // syncStatuses: 2/3 errors = 67% error rate; threshold 20% → above
    const result = computeJobRatesWithThresholds(logs, {}, 20);
    const cleanup = result.find(r => r.rawJobName === "cleanupSessions")!;
    const sync = result.find(r => r.rawJobName === "syncStatuses")!;
    expect(cleanup.aboveThreshold).toBe(true);  // 33% > 20%
    expect(sync.aboveThreshold).toBe(true);     // 67% > 20%
  });

  it("marks job as NOT aboveThreshold when error rate is within threshold", () => {
    // Set threshold to 50% for cleanupSessions (33% < 50%)
    const result = computeJobRatesWithThresholds(logs, { cleanupSessions: 50 }, 20);
    const cleanup = result.find(r => r.rawJobName === "cleanupSessions")!;
    expect(cleanup.aboveThreshold).toBe(false); // 33% < 50%
  });

  it("uses per-job threshold from map when available", () => {
    const result = computeJobRatesWithThresholds(logs, { syncStatuses: 80 }, 20);
    const sync = result.find(r => r.rawJobName === "syncStatuses")!;
    expect(sync.threshold).toBe(80);
    expect(sync.aboveThreshold).toBe(false); // 67% < 80%
  });

  it("returns empty array for no logs", () => {
    expect(computeJobRatesWithThresholds([], {}, 20)).toEqual([]);
  });
});

// ─── 3. Sidebar badge — inProgressDeclCount ──────────────────────────────────

type DeclStats = {
  total: number;
  cleared: number;
  pending: number;
  rejected: number;
  submitted?: number;
};

function computeInProgressCount(stats: DeclStats | null | undefined, isTrader: boolean): number {
  if (!isTrader || !stats) return 0;
  return (stats.submitted ?? 0) + (stats.pending ?? 0);
}

describe("computeInProgressCount", () => {
  it("returns 0 when user is not a trader", () => {
    const stats: DeclStats = { total: 10, cleared: 5, pending: 2, rejected: 1, submitted: 2 };
    expect(computeInProgressCount(stats, false)).toBe(0);
  });

  it("returns 0 when stats are null", () => {
    expect(computeInProgressCount(null, true)).toBe(0);
  });

  it("returns 0 when stats are undefined", () => {
    expect(computeInProgressCount(undefined, true)).toBe(0);
  });

  it("sums submitted + pending for trader", () => {
    const stats: DeclStats = { total: 10, cleared: 5, pending: 3, rejected: 1, submitted: 4 };
    expect(computeInProgressCount(stats, true)).toBe(7); // 4 + 3
  });

  it("handles missing submitted field gracefully", () => {
    const stats: DeclStats = { total: 10, cleared: 5, pending: 3, rejected: 1 };
    expect(computeInProgressCount(stats, true)).toBe(3); // 0 + 3
  });

  it("returns 0 when all in-progress counts are zero", () => {
    const stats: DeclStats = { total: 5, cleared: 5, pending: 0, rejected: 0, submitted: 0 };
    expect(computeInProgressCount(stats, true)).toBe(0);
  });
});
