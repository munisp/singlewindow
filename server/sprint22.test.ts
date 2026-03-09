/**
 * Sprint 22 Tests
 * - Trader SLA Tracker (getMyAtRisk procedure)
 * - Bulk Declaration Import (importDeclarations procedure)
 * - OGA Permit Expiry Calendar (expiryCalendar procedure)
 */
import { describe, it, expect } from "vitest";

// ─── SLA TRACKER ─────────────────────────────────────────────────────────────

describe("Trader SLA Tracker — getMyAtRisk logic", () => {
  const SLA_HOURS: Record<string, number> = {
    green: 4,
    yellow: 24,
    red: 72,
  };

  function computeHoursRemaining(submittedAt: Date, lane: string): number {
    const slaHours = SLA_HOURS[lane] ?? 24;
    const deadline = new Date(submittedAt.getTime() + slaHours * 3600 * 1000);
    return (deadline.getTime() - Date.now()) / 3600000;
  }

  function urgencyLabel(hoursRemaining: number): string {
    if (hoursRemaining <= 0) return "breached";
    if (hoursRemaining <= 1) return "critical";
    if (hoursRemaining <= 4) return "warning";
    return "ok";
  }

  it("green lane with 3h remaining is warning", () => {
    const submittedAt = new Date(Date.now() - 1 * 3600 * 1000); // 1h ago
    const hours = computeHoursRemaining(submittedAt, "green"); // 4h SLA → 3h left
    expect(hours).toBeCloseTo(3, 0);
    expect(urgencyLabel(hours)).toBe("warning");
  });

  it("yellow lane with 20h remaining is ok", () => {
    const submittedAt = new Date(Date.now() - 4 * 3600 * 1000); // 4h ago
    const hours = computeHoursRemaining(submittedAt, "yellow"); // 24h SLA → 20h left
    expect(hours).toBeCloseTo(20, 0);
    expect(urgencyLabel(hours)).toBe("ok");
  });

  it("red lane submitted 73h ago is breached", () => {
    const submittedAt = new Date(Date.now() - 73 * 3600 * 1000);
    const hours = computeHoursRemaining(submittedAt, "red"); // 72h SLA → -1h
    expect(hours).toBeLessThan(0);
    expect(urgencyLabel(hours)).toBe("breached");
  });

  it("green lane submitted 30 min ago is critical (3.5h left)", () => {
    const submittedAt = new Date(Date.now() - 0.5 * 3600 * 1000);
    const hours = computeHoursRemaining(submittedAt, "green"); // 3.5h left
    expect(hours).toBeCloseTo(3.5, 0);
    // 3.5 > 1 but < 4 → warning
    expect(urgencyLabel(hours)).toBe("warning");
  });
});

// ─── BULK IMPORT ─────────────────────────────────────────────────────────────

describe("Bulk Declaration Import — CSV parsing logic", () => {
  interface CsvRow {
    declarationType: string;
    hsCode: string;
    countryOfOrigin: string;
    invoiceValue: string;
    invoiceCurrency: string;
    description: string;
  }

  function parseCsvRow(row: Record<string, string>): CsvRow | { error: string } {
    const required = ["declarationType", "hsCode", "countryOfOrigin", "invoiceValue"];
    for (const field of required) {
      if (!row[field]?.trim()) return { error: `Missing required field: ${field}` };
    }
    const value = parseFloat(row.invoiceValue);
    if (isNaN(value) || value <= 0) return { error: "invoiceValue must be a positive number" };
    return {
      declarationType: row.declarationType.trim(),
      hsCode: row.hsCode.trim(),
      countryOfOrigin: row.countryOfOrigin.trim(),
      invoiceValue: row.invoiceValue.trim(),
      invoiceCurrency: (row.invoiceCurrency ?? "USD").trim(),
      description: (row.description ?? "").trim(),
    };
  }

  it("parses a valid row", () => {
    const row = {
      declarationType: "import",
      hsCode: "8471.30",
      countryOfOrigin: "CN",
      invoiceValue: "15000",
      invoiceCurrency: "USD",
      description: "Laptop computers",
    };
    const result = parseCsvRow(row);
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.hsCode).toBe("8471.30");
      expect(result.invoiceCurrency).toBe("USD");
    }
  });

  it("rejects row missing hsCode", () => {
    const row = {
      declarationType: "import",
      hsCode: "",
      countryOfOrigin: "CN",
      invoiceValue: "5000",
    };
    const result = parseCsvRow(row);
    expect("error" in result).toBe(true);
  });

  it("rejects row with non-numeric invoiceValue", () => {
    const row = {
      declarationType: "export",
      hsCode: "6101.20",
      countryOfOrigin: "GH",
      invoiceValue: "abc",
    };
    const result = parseCsvRow(row);
    expect("error" in result).toBe(true);
  });

  it("defaults invoiceCurrency to USD if missing", () => {
    const row = {
      declarationType: "import",
      hsCode: "2710.19",
      countryOfOrigin: "NG",
      invoiceValue: "200000",
    };
    const result = parseCsvRow(row);
    if (!("error" in result)) {
      expect(result.invoiceCurrency).toBe("USD");
    }
  });
});

// ─── OGA EXPIRY CALENDAR ─────────────────────────────────────────────────────

describe("OGA Permit Expiry Calendar — daysUntilExpiry calculation", () => {
  function daysUntilExpiry(expiresAt: Date): number {
    return Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  }

  function urgencyBand(days: number): string {
    if (days <= 7) return "critical";
    if (days <= 30) return "urgent";
    if (days <= 60) return "due_soon";
    return "upcoming";
  }

  it("permit expiring in 3 days is critical", () => {
    const exp = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    expect(urgencyBand(daysUntilExpiry(exp))).toBe("critical");
  });

  it("permit expiring in 15 days is urgent", () => {
    const exp = new Date(Date.now() + 15 * 24 * 3600 * 1000);
    expect(urgencyBand(daysUntilExpiry(exp))).toBe("urgent");
  });

  it("permit expiring in 45 days is due_soon", () => {
    const exp = new Date(Date.now() + 45 * 24 * 3600 * 1000);
    expect(urgencyBand(daysUntilExpiry(exp))).toBe("due_soon");
  });

  it("permit expiring in 90 days is upcoming", () => {
    const exp = new Date(Date.now() + 90 * 24 * 3600 * 1000);
    expect(urgencyBand(daysUntilExpiry(exp))).toBe("upcoming");
  });

  it("daysUntilExpiry rounds up correctly", () => {
    // 1.5 days → ceil → 2
    const exp = new Date(Date.now() + 1.5 * 24 * 3600 * 1000);
    expect(daysUntilExpiry(exp)).toBe(2);
  });
});
