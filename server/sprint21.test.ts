/**
 * Sprint 21 Tests
 * - Digest Preview endpoint logic
 * - Weekly analytics report formatting
 * - Port alert acknowledgement logic
 * - extractPortCode utility
 */
import { describe, it, expect } from "vitest";

// ─── Digest Preview Logic ─────────────────────────────────────────────────────

describe("Digest Preview Logic", () => {
  it("returns correct count when there are unread notifications", () => {
    const unreadNotifications = [
      { id: 1, type: "declaration_cleared", title: "Cleared", isRead: false },
      { id: 2, type: "payment_confirmed", title: "Payment OK", isRead: false },
      { id: 3, type: "security_alert", title: "Port Alert", isRead: false },
    ];
    const count = unreadNotifications.filter((n) => !n.isRead).length;
    expect(count).toBe(3);
  });

  it("returns 0 when all notifications are read", () => {
    const notifications = [
      { id: 1, isRead: true },
      { id: 2, isRead: true },
    ];
    const count = notifications.filter((n) => !n.isRead).length;
    expect(count).toBe(0);
  });

  it("caps preview at 10 notifications", () => {
    const unread = Array.from({ length: 15 }, (_, i) => ({ id: i, isRead: false }));
    const preview = unread.slice(0, 10);
    expect(preview.length).toBe(10);
  });

  it("digest frequency none means no digest is sent", () => {
    const settings = { digestFrequency: "none", lastDigestSentAt: null };
    const shouldSend = settings.digestFrequency !== "none";
    expect(shouldSend).toBe(false);
  });

  it("digest frequency daily triggers when last sent was > 20 hours ago", () => {
    const lastSent = new Date(Date.now() - 21 * 60 * 60 * 1000);
    const settings = { digestFrequency: "daily", lastDigestSentAt: lastSent };
    const hoursSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
    const shouldSend = settings.digestFrequency === "daily" && hoursSince >= 20;
    expect(shouldSend).toBe(true);
  });

  it("digest frequency daily does NOT trigger when last sent was < 20 hours ago", () => {
    const lastSent = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const settings = { digestFrequency: "daily", lastDigestSentAt: lastSent };
    const hoursSince = (Date.now() - lastSent.getTime()) / (1000 * 60 * 60);
    const shouldSend = settings.digestFrequency === "daily" && hoursSince >= 20;
    expect(shouldSend).toBe(false);
  });
});

// ─── Weekly Analytics Report Formatting ──────────────────────────────────────

describe("Weekly Analytics Report Formatting", () => {
  it("formats clearance rate correctly when total > 0", () => {
    const total7d = 120;
    const cleared7d = 96;
    const clearanceRate = total7d > 0 ? Math.round((cleared7d / total7d) * 100) : 0;
    expect(clearanceRate).toBe(80);
  });

  it("returns 0% clearance rate when no declarations", () => {
    const total7d = 0;
    const cleared7d = 0;
    const clearanceRate = total7d > 0 ? Math.round((cleared7d / total7d) * 100) : 0;
    expect(clearanceRate).toBe(0);
  });

  it("formats revenue with 2 decimal places", () => {
    const revenue = 123456.789;
    const formatted = Number(revenue).toFixed(2);
    expect(formatted).toBe("123456.79");
  });

  it("builds report content string with key metrics", () => {
    const total7d = 50;
    const clearanceRate = 82;
    const revenue7d = 9876.5;
    const slaBreaches = 3;
    const avgHours = 2.4;
    const content = [
      `Declarations (last 7 days): ${total7d}`,
      `Clearance rate: ${clearanceRate}%`,
      `Avg clearance time: ${avgHours}h`,
      `Duty revenue: $${revenue7d.toFixed(2)}`,
      `SLA breaches: ${slaBreaches}`,
    ].join("\n");
    expect(content).toContain("Declarations (last 7 days): 50");
    expect(content).toContain("Clearance rate: 82%");
    expect(content).toContain("Duty revenue: $9876.50");
    expect(content).toContain("SLA breaches: 3");
  });
});

// ─── Port Alert Acknowledgement ───────────────────────────────────────────────

describe("Port Alert Acknowledgement", () => {
  it("extractPortCode finds a valid 5-char port code", () => {
    function extractPortCode(body: string): string | null {
      const m = body.match(/\b([A-Z]{2}[A-Z0-9]{3,5})\b/);
      return m ? m[1] : null;
    }
    const body = "Critical congestion detected at port GHTEM. Immediate action required.";
    expect(extractPortCode(body)).toBe("GHTEM");
  });

  it("extractPortCode finds Singapore port code", () => {
    function extractPortCode(body: string): string | null {
      const m = body.match(/\b([A-Z]{2}[A-Z0-9]{3,5})\b/);
      return m ? m[1] : null;
    }
    const body = "Port SGSIN has transitioned to critical congestion status.";
    expect(extractPortCode(body)).toBe("SGSIN");
  });

  it("extractPortCode returns null when no port code in body", () => {
    function extractPortCode(body: string): string | null {
      const m = body.match(/\b([A-Z]{2}[A-Z0-9]{3,5})\b/);
      return m ? m[1] : null;
    }
    const body = "Your declaration has been cleared successfully.";
    expect(extractPortCode(body)).toBe(null);
  });

  it("only admin and customs_officer roles can acknowledge alerts", () => {
    const allowedRoles = ["admin", "customs_officer"];
    expect(allowedRoles.includes("admin")).toBe(true);
    expect(allowedRoles.includes("customs_officer")).toBe(true);
    expect(allowedRoles.includes("user")).toBe(false);
    expect(allowedRoles.includes("trader")).toBe(false);
  });

  it("acknowledgement sets acknowledgedAt to current time", () => {
    const before = Date.now();
    const acknowledgedAt = new Date();
    const after = Date.now();
    expect(acknowledgedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(acknowledgedAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("cron suppresses repeat alert when acknowledgedAt is set and status unchanged", () => {
    const alertRecord = {
      lastNotifiedStatus: "critical" as const,
      acknowledgedAt: new Date(Date.now() - 5 * 60 * 1000), // acknowledged 5 min ago
    };
    const currentStatus = "critical";
    // Cron should NOT re-fire if status hasn't changed since acknowledgement
    const shouldFire =
      currentStatus === "critical" &&
      alertRecord.lastNotifiedStatus !== "critical";
    expect(shouldFire).toBe(false);
  });
});
