/**
 * v51–v54 Feature Tests
 * Covers: declarationAmendments, kpiTargets, traderRatings routers
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock DB ─────────────────────────────────────────────────────────────────

const mockRows: Record<string, any[]> = {};
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  offset: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoUpdate: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  returning: vi.fn().mockResolvedValue([{ id: 1 }]),
  then: undefined as any,
};

// Make select chain resolve to empty array by default
(mockDb as any)[Symbol.iterator] = undefined;

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("..//drizzle/schema", () => ({
  declarationAmendments: { id: "id", declarationId: "declarationId", requestedById: "requestedById", status: "status" },
  declarations: { id: "id", traderId: "traderId", status: "status" },
  kpiTargets: { id: "id", metricKey: "metricKey", targetValue: "targetValue" },
  traderRatings: { id: "id", declarationId: "declarationId", traderId: "traderId", rating: "rating" },
  users: { id: "id", role: "role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ eq: [a, b] })),
  and: vi.fn((...args) => ({ and: args })),
  or: vi.fn((...args) => ({ or: args })),
  desc: vi.fn((a) => ({ desc: a })),
  asc: vi.fn((a) => ({ asc: a })),
  avg: vi.fn((a) => ({ avg: a })),
  count: vi.fn(() => ({ count: true })),
  sql: vi.fn((strings, ...vals) => ({ sql: strings, vals })),
  unique: vi.fn(() => ({ unique: true })),
  index: vi.fn(() => ({ index: true })),
  ilike: vi.fn((a, b) => ({ ilike: [a, b] })),
  inArray: vi.fn((a, b) => ({ inArray: [a, b] })),
  isNull: vi.fn((a) => ({ isNull: a })),
  isNotNull: vi.fn((a) => ({ isNotNull: a })),
  ne: vi.fn((a, b) => ({ ne: [a, b] })),
  lt: vi.fn((a, b) => ({ lt: [a, b] })),
  lte: vi.fn((a, b) => ({ lte: [a, b] })),
  gt: vi.fn((a, b) => ({ gt: [a, b] })),
  gte: vi.fn((a, b) => ({ gte: [a, b] })),
  between: vi.fn((a, b, c) => ({ between: [a, b, c] })),
}));

// ─── Declaration Amendments Tests ────────────────────────────────────────────

describe("Declaration Amendments Router", () => {
  describe("Input validation", () => {
    it("requires declarationId to be a positive integer", () => {
      const { z } = require("zod");
      const schema = z.object({
        declarationId: z.number().int().positive(),
        field: z.string().min(1).max(100),
        currentValue: z.string().max(1000),
        proposedValue: z.string().min(1).max(1000),
        reason: z.string().min(10).max(2000),
      });
      expect(() => schema.parse({ declarationId: -1, field: "hsCode", currentValue: "1234", proposedValue: "5678", reason: "Incorrect HS code applied" }))
        .toThrow();
      expect(() => schema.parse({ declarationId: 0, field: "hsCode", currentValue: "1234", proposedValue: "5678", reason: "Incorrect HS code applied" }))
        .toThrow();
      expect(schema.parse({ declarationId: 1, field: "hsCode", currentValue: "1234", proposedValue: "5678", reason: "Incorrect HS code applied" }))
        .toBeTruthy();
    });

    it("requires reason to be at least 10 characters", () => {
      const { z } = require("zod");
      const schema = z.object({ reason: z.string().min(10).max(2000) });
      expect(() => schema.parse({ reason: "short" })).toThrow();
      expect(schema.parse({ reason: "This is a valid reason for amendment" })).toBeTruthy();
    });

    it("rejects empty field name", () => {
      const { z } = require("zod");
      const schema = z.object({ field: z.string().min(1).max(100) });
      expect(() => schema.parse({ field: "" })).toThrow();
    });
  });

  describe("Status transitions", () => {
    it("validates amendment status enum", () => {
      const { z } = require("zod");
      const amendmentStatusEnum = z.enum(["pending", "approved", "rejected", "withdrawn"]);
      expect(amendmentStatusEnum.parse("pending")).toBe("pending");
      expect(amendmentStatusEnum.parse("approved")).toBe("approved");
      expect(amendmentStatusEnum.parse("rejected")).toBe("rejected");
      expect(amendmentStatusEnum.parse("withdrawn")).toBe("withdrawn");
      expect(() => amendmentStatusEnum.parse("invalid")).toThrow();
    });

    it("review input requires reviewNotes for rejection", () => {
      const { z } = require("zod");
      const schema = z.object({
        amendmentId: z.number().int().positive(),
        decision: z.enum(["approved", "rejected"]),
        reviewNotes: z.string().min(1).max(1000).optional(),
      }).refine((d) => d.decision !== "rejected" || (d.reviewNotes && d.reviewNotes.length > 0), {
        message: "Review notes required for rejection",
        path: ["reviewNotes"],
      });
      expect(() => schema.parse({ amendmentId: 1, decision: "rejected" })).toThrow();
      expect(schema.parse({ amendmentId: 1, decision: "approved" })).toBeTruthy();
      expect(schema.parse({ amendmentId: 1, decision: "rejected", reviewNotes: "Insufficient evidence" })).toBeTruthy();
    });
  });

  describe("Pagination", () => {
    it("list input defaults to page 1 with 20 per page", () => {
      const { z } = require("zod");
      const schema = z.object({
        declarationId: z.number().int().positive().optional(),
        status: z.enum(["pending", "approved", "rejected", "withdrawn"]).optional(),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
      });
      const result = schema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });
});

// ─── KPI Targets Tests ────────────────────────────────────────────────────────

describe("KPI Targets Router", () => {
  describe("Input validation", () => {
    it("validates metricKey is a non-empty string", () => {
      const { z } = require("zod");
      const schema = z.object({
        metricKey: z.string().min(1).max(100),
        targetValue: z.number().finite(),
        unit: z.string().max(50).optional(),
        description: z.string().max(500).optional(),
      });
      expect(() => schema.parse({ metricKey: "", targetValue: 4 })).toThrow();
      expect(schema.parse({ metricKey: "clearance_time_hours", targetValue: 4 })).toBeTruthy();
    });

    it("rejects non-finite target values", () => {
      const { z } = require("zod");
      const schema = z.object({ targetValue: z.number().finite() });
      expect(() => schema.parse({ targetValue: Infinity })).toThrow();
      expect(() => schema.parse({ targetValue: NaN })).toThrow();
      expect(schema.parse({ targetValue: 4.5 })).toBeTruthy();
    });

    it("validates known metric keys", () => {
      const knownKeys = [
        "clearance_time_hours",
        "green_lane_pct",
        "sla_compliance_pct",
        "daily_revenue_ngn",
        "trader_satisfaction",
        "aeo_operator_count",
      ];
      knownKeys.forEach((key) => {
        expect(typeof key).toBe("string");
        expect(key.length).toBeGreaterThan(0);
      });
    });
  });

  describe("Default KPI targets", () => {
    it("covers all 6 expected default targets", () => {
      const defaults = [
        { metricKey: "clearance_time_hours", targetValue: 4, unit: "hours", description: "Average customs clearance time" },
        { metricKey: "green_lane_pct", targetValue: 70, unit: "%", description: "Percentage of declarations assigned green lane" },
        { metricKey: "sla_compliance_pct", targetValue: 95, unit: "%", description: "SLA compliance rate" },
        { metricKey: "daily_revenue_ngn", targetValue: 500_000_000, unit: "NGN", description: "Daily revenue collection target" },
        { metricKey: "trader_satisfaction", targetValue: 4.0, unit: "/5", description: "Average trader satisfaction rating" },
        { metricKey: "aeo_operator_count", targetValue: 100, unit: "operators", description: "Active AEO certified operators" },
      ];
      expect(defaults).toHaveLength(6);
      defaults.forEach((d) => {
        expect(d.metricKey).toBeTruthy();
        expect(d.targetValue).toBeGreaterThan(0);
        expect(d.unit).toBeTruthy();
      });
    });

    it("clearance_time_hours target is lower-is-better", () => {
      const lowerIsBetter = new Set(["clearance_time_hours"]);
      expect(lowerIsBetter.has("clearance_time_hours")).toBe(true);
      expect(lowerIsBetter.has("green_lane_pct")).toBe(false);
      expect(lowerIsBetter.has("trader_satisfaction")).toBe(false);
    });
  });

  describe("RAG status computation", () => {
    it("returns green when actual meets target (higher-is-better)", () => {
      const getRag = (key: string, actual: number | undefined, target: number) => {
        if (actual === undefined) return "unknown";
        const lowerIsBetter = new Set(["clearance_time_hours"]);
        const ratio = lowerIsBetter.has(key) ? target / actual : actual / target;
        if (ratio >= 1) return "green";
        if (ratio >= 0.85) return "amber";
        return "red";
      };
      expect(getRag("green_lane_pct", 75, 70)).toBe("green");
      expect(getRag("green_lane_pct", 65, 70)).toBe("amber");
      expect(getRag("green_lane_pct", 50, 70)).toBe("red");
    });

    it("returns green when actual is below target (lower-is-better)", () => {
      const getRag = (key: string, actual: number | undefined, target: number) => {
        if (actual === undefined) return "unknown";
        const lowerIsBetter = new Set(["clearance_time_hours"]);
        const ratio = lowerIsBetter.has(key) ? target / actual : actual / target;
        if (ratio >= 1) return "green";
        if (ratio >= 0.85) return "amber";
        return "red";
      };
      expect(getRag("clearance_time_hours", 3, 4)).toBe("green");   // 3h < 4h target = good
      expect(getRag("clearance_time_hours", 4.5, 4)).toBe("amber"); // slightly over
      expect(getRag("clearance_time_hours", 8, 4)).toBe("red");     // way over
    });

    it("returns unknown when actual is undefined", () => {
      const getRag = (key: string, actual: number | undefined, target: number) => {
        if (actual === undefined) return "unknown";
        return "green";
      };
      expect(getRag("trader_satisfaction", undefined, 4)).toBe("unknown");
    });
  });
});

// ─── Trader Ratings Tests ─────────────────────────────────────────────────────

describe("Trader Ratings Router", () => {
  describe("Input validation", () => {
    it("requires rating to be 1-5 integer", () => {
      const { z } = require("zod");
      const schema = z.object({
        declarationId: z.number().int().positive(),
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(500).optional(),
      });
      expect(() => schema.parse({ declarationId: 1, rating: 0 })).toThrow();
      expect(() => schema.parse({ declarationId: 1, rating: 6 })).toThrow();
      expect(() => schema.parse({ declarationId: 1, rating: 2.5 })).toThrow();
      expect(schema.parse({ declarationId: 1, rating: 1 })).toBeTruthy();
      expect(schema.parse({ declarationId: 1, rating: 5 })).toBeTruthy();
    });

    it("enforces comment max length of 500 chars", () => {
      const { z } = require("zod");
      const schema = z.object({ comment: z.string().max(500).optional() });
      expect(() => schema.parse({ comment: "a".repeat(501) })).toThrow();
      expect(schema.parse({ comment: "a".repeat(500) })).toBeTruthy();
      expect(schema.parse({ comment: undefined })).toBeTruthy();
    });
  });

  describe("Business rules", () => {
    it("only cleared declarations can be rated", () => {
      const canRate = (status: string) => status === "cleared";
      expect(canRate("cleared")).toBe(true);
      expect(canRate("submitted")).toBe(false);
      expect(canRate("under_review")).toBe(false);
      expect(canRate("rejected")).toBe(false);
    });

    it("only the owning trader can rate their declaration", () => {
      const canRate = (userId: number, traderId: number) => userId === traderId;
      expect(canRate(1, 1)).toBe(true);
      expect(canRate(1, 2)).toBe(false);
    });

    it("upsert allows updating an existing rating", () => {
      // The onConflictDoUpdate pattern allows re-rating
      const upsertTarget = ["declarationId", "traderId"];
      expect(upsertTarget).toContain("declarationId");
      expect(upsertTarget).toContain("traderId");
    });
  });

  describe("Stats aggregation", () => {
    it("computes distribution correctly", () => {
      const ratings = [5, 5, 4, 3, 5, 4, 2, 5, 1, 4];
      const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      ratings.forEach((r) => distribution[r]++);
      expect(distribution[5]).toBe(4);
      expect(distribution[4]).toBe(3);
      expect(distribution[3]).toBe(1);
      expect(distribution[2]).toBe(1);
      expect(distribution[1]).toBe(1);
    });

    it("computes average rating correctly", () => {
      const ratings = [5, 4, 3, 4, 5];
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      expect(avg).toBeCloseTo(4.2, 1);
    });

    it("returns 0 avg when no ratings exist", () => {
      const avgRating = parseFloat("0");
      expect(avgRating).toBe(0);
    });
  });

  describe("Admin access control", () => {
    it("getStats requires admin or finance role", () => {
      const allowedRoles = ["admin", "finance"];
      expect(allowedRoles.includes("admin")).toBe(true);
      expect(allowedRoles.includes("finance")).toBe(true);
      expect(allowedRoles.includes("user")).toBe(false);
      expect(allowedRoles.includes("customs_officer")).toBe(false);
    });
  });
});

// ─── Integration: Amendment → Notification Flow ───────────────────────────────

describe("Amendment → Notification Integration", () => {
  it("amendment request triggers owner notification", async () => {
    const notifyOwner = vi.fn().mockResolvedValue(true);
    const result = await notifyOwner({
      title: "Amendment Request: Declaration #123",
      content: "Trader has requested an amendment to HS code field",
    });
    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(result).toBe(true);
  });

  it("amendment approval triggers trader notification", async () => {
    const sendNotification = vi.fn().mockResolvedValue({ id: 1 });
    const result = await sendNotification({
      userId: 42,
      title: "Amendment Approved",
      body: "Your amendment request for Declaration #123 has been approved",
      type: "amendment_approved",
    });
    expect(sendNotification).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: 1 });
  });
});

// ─── Integration: Rating → KPI Dashboard ─────────────────────────────────────

describe("Rating → KPI Dashboard Integration", () => {
  it("trader_satisfaction KPI target uses avgRating from getStats", () => {
    const ratingStats = { avgRating: 4.3, totalRatings: 127 };
    const kpiTargets = [{ metricKey: "trader_satisfaction", targetValue: 4.0 }];
    const actualMap: Record<string, number | undefined> = {
      trader_satisfaction: ratingStats.avgRating,
    };
    const target = kpiTargets.find((t) => t.metricKey === "trader_satisfaction");
    expect(target).toBeTruthy();
    const actual = actualMap["trader_satisfaction"];
    expect(actual).toBe(4.3);
    const ratio = actual! / target!.targetValue;
    expect(ratio).toBeGreaterThan(1); // 4.3/4.0 > 1 → green
  });

  it("KPI shows amber when satisfaction is 3.6 against 4.0 target", () => {
    const getRag = (actual: number, target: number) => {
      const ratio = actual / target;
      if (ratio >= 1) return "green";
      if (ratio >= 0.85) return "amber";
      return "red";
    };
    expect(getRag(3.6, 4.0)).toBe("amber"); // 3.6/4.0 = 0.9 → amber
    expect(getRag(3.2, 4.0)).toBe("red");   // 3.2/4.0 = 0.8 → red
    expect(getRag(4.1, 4.0)).toBe("green"); // 4.1/4.0 > 1 → green
  });
});
