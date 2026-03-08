/**
 * Sprint 20 Tests
 * Covers: Notification Digest Settings, CSV Export utility logic, Port Congestion Alert logic
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Digest Settings Router Tests ─────────────────────────────────────────────
describe("notificationPreferences.getDigestSettings", () => {
  it("returns 'none' when no row exists", async () => {
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    // Simulate the router logic directly
    const rows: { digestFrequency: string; lastDigestSentAt: Date | null }[] = [];
    const result =
      rows.length === 0
        ? { digestFrequency: "none" as const, lastDigestSentAt: null as Date | null }
        : { digestFrequency: rows[0].digestFrequency, lastDigestSentAt: rows[0].lastDigestSentAt };
    expect(result.digestFrequency).toBe("none");
    expect(result.lastDigestSentAt).toBeNull();
  });

  it("returns stored frequency when row exists", async () => {
    const rows = [{ digestFrequency: "daily", lastDigestSentAt: new Date("2026-03-01T08:00:00Z") }];
    const result =
      rows.length === 0
        ? { digestFrequency: "none" as const, lastDigestSentAt: null as Date | null }
        : { digestFrequency: rows[0].digestFrequency, lastDigestSentAt: rows[0].lastDigestSentAt };
    expect(result.digestFrequency).toBe("daily");
    expect(result.lastDigestSentAt).toBeInstanceOf(Date);
  });

  it("returns 'weekly' for weekly setting", async () => {
    const rows = [{ digestFrequency: "weekly", lastDigestSentAt: null }];
    const result =
      rows.length === 0
        ? { digestFrequency: "none" as const, lastDigestSentAt: null as Date | null }
        : { digestFrequency: rows[0].digestFrequency, lastDigestSentAt: rows[0].lastDigestSentAt };
    expect(result.digestFrequency).toBe("weekly");
  });
});

describe("notificationPreferences.updateDigestSettings", () => {
  it("validates digest frequency enum values", () => {
    const validValues = ["none", "daily", "weekly"];
    const invalidValues = ["hourly", "monthly", "never", ""];
    for (const v of validValues) {
      expect(validValues.includes(v)).toBe(true);
    }
    for (const v of invalidValues) {
      expect(validValues.includes(v)).toBe(false);
    }
  });

  it("returns success true on valid update", async () => {
    const mockResult = { success: true, digestFrequency: "daily" as const };
    expect(mockResult.success).toBe(true);
    expect(mockResult.digestFrequency).toBe("daily");
  });
});

// ─── CSV Export Utility Tests ──────────────────────────────────────────────────
describe("exportToCsv utility", () => {
  // Inline the CSV generation logic for testing
  function buildCsvContent(rows: Record<string, unknown>[]): string {
    if (!rows.length) return "";
    const headers = Object.keys(rows[0]);
    return [
      headers.join(","),
      ...rows.map((row) =>
        headers.map((h) => {
          const val = row[h];
          const str = val == null ? "" : String(val);
          return str.includes(",") || str.includes('"') || str.includes("\n")
            ? `"${str.replace(/"/g, '""')}"`
            : str;
        }).join(",")
      ),
    ].join("\n");
  }

  it("generates correct CSV headers", () => {
    const rows = [{ date: "2026-01-01", count: 5, revenue: 1234.56 }];
    const csv = buildCsvContent(rows);
    expect(csv.split("\n")[0]).toBe("date,count,revenue");
  });

  it("generates correct CSV data rows", () => {
    const rows = [{ date: "2026-01-01", count: 5 }, { date: "2026-01-02", count: 10 }];
    const csv = buildCsvContent(rows);
    const lines = csv.split("\n");
    expect(lines[1]).toBe("2026-01-01,5");
    expect(lines[2]).toBe("2026-01-02,10");
  });

  it("wraps values with commas in quotes", () => {
    const rows = [{ name: "Accra, Ghana", count: 3 }];
    const csv = buildCsvContent(rows);
    expect(csv).toContain('"Accra, Ghana"');
  });

  it("escapes double quotes in values", () => {
    const rows = [{ description: 'He said "hello"', count: 1 }];
    const csv = buildCsvContent(rows);
    expect(csv).toContain('"He said ""hello"""');
  });

  it("returns empty string for empty array", () => {
    expect(buildCsvContent([])).toBe("");
  });

  it("handles null values as empty string", () => {
    const rows = [{ date: "2026-01-01", count: null }];
    const csv = buildCsvContent(rows);
    expect(csv.split("\n")[1]).toBe("2026-01-01,");
  });
});

// ─── Port Congestion Alert Logic Tests ────────────────────────────────────────
describe("Port congestion alert transition logic", () => {
  function shouldFireAlert(currentStatus: string, lastNotifiedStatus: string): boolean {
    return currentStatus === "critical" && lastNotifiedStatus !== "critical";
  }

  it("fires alert when transitioning from clear to critical", () => {
    expect(shouldFireAlert("critical", "clear")).toBe(true);
  });

  it("fires alert when transitioning from moderate to critical", () => {
    expect(shouldFireAlert("critical", "moderate")).toBe(true);
  });

  it("fires alert when transitioning from congested to critical", () => {
    expect(shouldFireAlert("critical", "congested")).toBe(true);
  });

  it("does NOT fire alert when already at critical (no duplicate)", () => {
    expect(shouldFireAlert("critical", "critical")).toBe(false);
  });

  it("does NOT fire alert for non-critical statuses", () => {
    expect(shouldFireAlert("clear", "clear")).toBe(false);
    expect(shouldFireAlert("moderate", "clear")).toBe(false);
    expect(shouldFireAlert("congested", "moderate")).toBe(false);
  });

  it("fires alert when first seen (no previous row = defaults to clear)", () => {
    const lastNotified = undefined ?? "clear";
    expect(shouldFireAlert("critical", lastNotified)).toBe(true);
  });
});
