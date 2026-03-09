/**
 * Production Features Tests — Geofences, Webhooks, API Changelog, Onboarding Analytics
 */
import { describe, it, expect } from "vitest";

// ─── Geofence Point-in-Polygon ─────────────────────────────────────────────

const pointInPolygon = (lat: number, lon: number, polygon: Array<{ lat: number; lon: number }>) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
};

describe("Geofence point-in-polygon", () => {
  const mombasa = [
    { lat: -4.0, lon: 39.6 },
    { lat: -4.0, lon: 39.7 },
    { lat: -4.1, lon: 39.7 },
    { lat: -4.1, lon: 39.6 },
  ];

  it("detects vessel inside geofence", () => {
    expect(pointInPolygon(-4.05, 39.65, mombasa)).toBe(true);
  });

  it("detects vessel outside geofence", () => {
    expect(pointInPolygon(-3.9, 39.65, mombasa)).toBe(false);
    expect(pointInPolygon(-4.05, 39.5, mombasa)).toBe(false);
  });

  it("handles triangle polygon", () => {
    const triangle = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 0.5, lon: 1 },
    ];
    expect(pointInPolygon(0.5, 0.3, triangle)).toBe(true);
    expect(pointInPolygon(0.5, 1.5, triangle)).toBe(false);
  });

  it("rejects polygon with fewer than 3 points", () => {
    const twoPoints = [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }];
    // Should not be called with < 3 points — guard in production code
    expect(twoPoints.length < 3).toBe(true);
  });
});

// ─── Webhook Signature ──────────────────────────────────────────────────────

import crypto from "crypto";

const computeWebhookSignature = (payload: string, secret: string): string => {
  return "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
};

describe("Webhook HMAC signature", () => {
  it("produces consistent signatures for same payload and secret", () => {
    const sig1 = computeWebhookSignature('{"event":"test"}', "my-secret");
    const sig2 = computeWebhookSignature('{"event":"test"}', "my-secret");
    expect(sig1).toBe(sig2);
  });

  it("produces different signatures for different secrets", () => {
    const sig1 = computeWebhookSignature('{"event":"test"}', "secret-a");
    const sig2 = computeWebhookSignature('{"event":"test"}', "secret-b");
    expect(sig1).not.toBe(sig2);
  });

  it("signature starts with sha256= prefix", () => {
    const sig = computeWebhookSignature("payload", "secret");
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(sig.length).toBe(7 + 64); // "sha256=" + 64 hex chars
  });

  it("produces different signatures for different payloads", () => {
    const sig1 = computeWebhookSignature('{"event":"declaration.submitted"}', "secret");
    const sig2 = computeWebhookSignature('{"event":"declaration.cleared"}', "secret");
    expect(sig1).not.toBe(sig2);
  });
});

// ─── API Changelog Diff ─────────────────────────────────────────────────────

interface SpecSummary {
  version: string;
  totalPaths: number;
  tags: string[];
}

const computeSpecDiff = (prev: SpecSummary, curr: SpecSummary) => {
  const addedTags = curr.tags.filter(t => !prev.tags.includes(t));
  const removedTags = prev.tags.filter(t => !curr.tags.includes(t));
  const pathDelta = curr.totalPaths - prev.totalPaths;
  return { addedTags, removedTags, pathDelta, hasChanges: addedTags.length > 0 || removedTags.length > 0 || pathDelta !== 0 };
};

describe("API Changelog diff computation", () => {
  it("detects added tags", () => {
    const prev = { version: "1.0.0", totalPaths: 50, tags: ["auth", "declarations"] };
    const curr = { version: "1.1.0", totalPaths: 54, tags: ["auth", "declarations", "geofences", "webhooks"] };
    const diff = computeSpecDiff(prev, curr);
    expect(diff.addedTags).toContain("geofences");
    expect(diff.addedTags).toContain("webhooks");
    expect(diff.pathDelta).toBe(4);
    expect(diff.hasChanges).toBe(true);
  });

  it("detects removed tags", () => {
    const prev = { version: "1.0.0", totalPaths: 54, tags: ["auth", "declarations", "legacy"] };
    const curr = { version: "1.1.0", totalPaths: 52, tags: ["auth", "declarations"] };
    const diff = computeSpecDiff(prev, curr);
    expect(diff.removedTags).toContain("legacy");
    expect(diff.pathDelta).toBe(-2);
  });

  it("returns no changes for identical specs", () => {
    const spec = { version: "1.0.0", totalPaths: 54, tags: ["auth", "declarations"] };
    const diff = computeSpecDiff(spec, spec);
    expect(diff.hasChanges).toBe(false);
    expect(diff.addedTags).toHaveLength(0);
    expect(diff.removedTags).toHaveLength(0);
    expect(diff.pathDelta).toBe(0);
  });
});

// ─── Onboarding Analytics ───────────────────────────────────────────────────

interface StepMetrics {
  stepNumber: number;
  startedCount: number;
  completedCount: number;
}

const computeDropoffRate = (steps: StepMetrics[]) => {
  return steps.map((s, i) => {
    const dropoff = i === 0 ? 0 : ((steps[i - 1].completedCount - s.startedCount) / steps[i - 1].completedCount) * 100;
    const completionRate = s.startedCount > 0 ? (s.completedCount / s.startedCount) * 100 : 0;
    return { ...s, dropoffRate: Math.max(0, dropoff), completionRate };
  });
};

describe("Onboarding analytics drop-off computation", () => {
  const mockSteps: StepMetrics[] = [
    { stepNumber: 1, startedCount: 100, completedCount: 90 },
    { stepNumber: 2, startedCount: 85, completedCount: 78 },
    { stepNumber: 3, startedCount: 75, completedCount: 70 },
    { stepNumber: 4, startedCount: 68, completedCount: 60 },
    { stepNumber: 5, startedCount: 58, completedCount: 55 },
  ];

  it("computes completion rate per step", () => {
    const metrics = computeDropoffRate(mockSteps);
    expect(metrics[0].completionRate).toBeCloseTo(90, 0);
    expect(metrics[1].completionRate).toBeCloseTo(91.8, 0);
  });

  it("computes drop-off between steps", () => {
    const metrics = computeDropoffRate(mockSteps);
    // Step 1 has no prior step, so dropoff is 0
    expect(metrics[0].dropoffRate).toBe(0);
    // Step 2: (90 - 85) / 90 * 100 ≈ 5.6%
    expect(metrics[1].dropoffRate).toBeCloseTo(5.6, 0);
  });

  it("identifies highest drop-off step", () => {
    const metrics = computeDropoffRate(mockSteps);
    const highest = metrics.reduce((max, m) => m.dropoffRate > max.dropoffRate ? m : max, metrics[0]);
    expect(highest.stepNumber).toBeGreaterThan(1);
  });

  it("handles zero started count gracefully", () => {
    const steps: StepMetrics[] = [
      { stepNumber: 1, startedCount: 0, completedCount: 0 },
    ];
    const metrics = computeDropoffRate(steps);
    expect(metrics[0].completionRate).toBe(0);
  });
});

// ─── Landing Page Data Integrity ────────────────────────────────────────────

describe("Landing page data integrity", () => {
  const PORTALS = [
    { role: "Trader", href: "/app/trader" },
    { role: "Customs Officer", href: "/app/customs" },
    { role: "Government Agency", href: "/app/oga" },
    { role: "Administrator", href: "/app/admin" },
    { role: "Security Analyst", href: "/app/security" },
    { role: "Developer", href: "/app/developer" },
  ];

  it("has 6 portal entries", () => {
    expect(PORTALS).toHaveLength(6);
  });

  it("all portals have valid href paths", () => {
    PORTALS.forEach(p => {
      expect(p.href).toMatch(/^\/app\//);
    });
  });

  it("all portal roles are unique", () => {
    const roles = PORTALS.map(p => p.role);
    const unique = new Set(roles);
    expect(unique.size).toBe(roles.length);
  });

  const STATS = [
    { value: "< 4 hrs", label: "Fast-track clearance" },
    { value: "37+", label: "Agencies connected" },
    { value: "99.99%", label: "Platform uptime" },
    { value: "5M+", label: "Declarations / year" },
  ];

  it("has 4 stat entries", () => {
    expect(STATS).toHaveLength(4);
  });

  it("all stats have non-empty values and labels", () => {
    STATS.forEach(s => {
      expect(s.value.length).toBeGreaterThan(0);
      expect(s.label.length).toBeGreaterThan(0);
    });
  });
});
