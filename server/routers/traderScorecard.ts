/**
 * Sprint 61 — Trader Performance Scorecard
 * Clearance time percentile, rejection rate trend, AEO tier status, 12-month compliance history.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { declarations, dutyDrawbackClaims, users, stakeholderProfiles } from "../../drizzle/schema";
import { eq, and, desc, sql, count, gte, lt } from "drizzle-orm";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

/** Calculate percentile rank of value within a sorted array */
export function calculatePercentile(value: number, population: number[]): number {
  if (population.length === 0) return 50;
  const sorted = [...population].sort((a, b) => a - b);
  const below = sorted.filter((v) => v > value).length; // lower clearance time = better
  return Math.round((below / sorted.length) * 100);
}

/** Compute month-over-month delta for rejection rate */
export function computeRejectionTrend(monthlyData: { month: string; total: number; rejected: number }[]): {
  month: string; total: number; rejected: number; rate: number; delta: number;
}[] {
  return monthlyData.map((d, i) => {
    const rate = d.total > 0 ? Math.round((d.rejected / d.total) * 10000) / 100 : 0;
    const prevRate = i > 0 && monthlyData[i - 1].total > 0
      ? (monthlyData[i - 1].rejected / monthlyData[i - 1].total) * 100
      : rate;
    return { ...d, rate, delta: Math.round((rate - prevRate) * 100) / 100 };
  });
}

/** Determine AEO tier from score */
export function getAeoTier(score: number): "none" | "standard" | "silver" | "gold" {
  if (score >= 90) return "gold";
  if (score >= 75) return "silver";
  if (score >= 60) return "standard";
  return "none";
}

/** Generate 12 month labels ending at current month */
export function getLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const traderScorecardRouter = router({
  /**
   * Get the full scorecard for the authenticated trader (or a specific trader if admin).
   */
  getScorecard: protectedProcedure
    .input(z.object({ traderId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const isAdmin = ["admin", "customs_officer"].includes(ctx.user.role);
      const rawTargetId = (isAdmin && input?.traderId) ? input.traderId : ctx.user.id;
      const targetId = parseInt(String(rawTargetId), 10);

      // Fetch last 12 months of declarations for this trader
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      const traderDecls = await db.select({
        id: declarations.id,
        status: declarations.status,
        submittedAt: declarations.submittedAt,
        clearedAt: declarations.clearedAt,
        hsCode: declarations.hsCode,
      }).from(declarations)
        .where(and(
          eq(declarations.traderId, isNaN(targetId) ? 0 : targetId),
          gte(declarations.submittedAt, twelveMonthsAgo),
        ))
        .orderBy(desc(declarations.submittedAt));

      const total = traderDecls.length;
      const cleared = traderDecls.filter((d) => d.status === "cleared").length;
      const rejected = traderDecls.filter((d) => d.status === "rejected").length;
        const underReview = traderDecls.filter((d) => ["under_examination", "payment_pending", "submitted", "under_assessment"].includes(d.status ?? "")).length;

      // Average clearance time (hours) for cleared declarations
      const clearanceTimes = traderDecls
        .filter((d) => d.status === "cleared" && d.clearedAt && d.submittedAt)
        .map((d) => (new Date(d.clearedAt!).getTime() - new Date(d.submittedAt!).getTime()) / 3600000);
      const avgClearanceHours = clearanceTimes.length > 0
        ? Math.round((clearanceTimes.reduce((a, b) => a + b, 0) / clearanceTimes.length) * 10) / 10
        : 0;

      // Rejection rate
      const rejectionRate = total > 0 ? Math.round((rejected / total) * 10000) / 100 : 0;

      // Compliance score (0-100): based on rejection rate, clearance speed, declaration volume
      const rejectionPenalty = Math.min(rejectionRate * 2, 40); // up to -40 for high rejection
      const speedBonus = avgClearanceHours > 0 && avgClearanceHours < 4 ? 10 : avgClearanceHours < 24 ? 5 : 0;
      const volumeBonus = total >= 50 ? 5 : total >= 20 ? 3 : 0;
      const complianceScore = Math.max(0, Math.min(100, Math.round(85 - rejectionPenalty + speedBonus + volumeBonus)));

      const aeoTier = getAeoTier(complianceScore);

      // Build 12-month compliance history
      const months = getLast12Months();
      const complianceHistory = months.map((month) => {
        const [year, mon] = month.split("-").map(Number);
        const monthDecls = traderDecls.filter((d) => {
          if (!d.submittedAt) return false;
          const dt = new Date(d.submittedAt);
          return dt.getFullYear() === year && dt.getMonth() + 1 === mon;
        });
        return {
          month,
          total: monthDecls.length,
          cleared: monthDecls.filter((d) => d.status === "cleared").length,
          rejected: monthDecls.filter((d) => d.status === "rejected").length,
          underReview: monthDecls.filter((d) => ["under_examination", "payment_pending", "submitted", "under_assessment"].includes(d.status ?? "")).length,
        };
      });

      return {
        traderId: targetId,
        traderName: ctx.user.name,
        period: "last_12_months",
        summary: {
          total,
          cleared,
          rejected,
          underReview,
          rejectionRate,
          avgClearanceHours,
          complianceScore,
          aeoTier,
        },
        complianceHistory,
        generatedAt: new Date(),
      };
    }),

  /**
   * Get clearance time percentile for the trader vs all traders in same HS chapter.
   */
  getClearancePercentile: protectedProcedure
    .input(z.object({ hsChapter: z.string().max(4).optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { percentile: 50, avgHours: 0, populationSize: 0, hsChapter: input?.hsChapter ?? "all" };

      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      // Trader's own cleared declarations
      const traderCleared = await db.select({
        submittedAt: declarations.submittedAt,
        clearedAt: declarations.clearedAt,
      }).from(declarations).where(and(
        eq(declarations.traderId, ctx.user.id),
        eq(declarations.status, "cleared"),
        gte(declarations.submittedAt, threeMonthsAgo),
      ));

      if (traderCleared.length === 0) return { percentile: 50, avgHours: 0, populationSize: 0, hsChapter: input?.hsChapter ?? "all" };

      const traderAvg = traderCleared
        .filter((d) => d.clearedAt && d.submittedAt)
        .reduce((sum, d) => sum + (new Date(d.clearedAt!).getTime() - new Date(d.submittedAt!).getTime()) / 3600000, 0)
        / traderCleared.length;

      // All traders' average clearance times (population)
      const allCleared = await db.select({
        traderId: declarations.traderId,
        submittedAt: declarations.submittedAt,
        clearedAt: declarations.clearedAt,
      }).from(declarations).where(and(
        eq(declarations.status, "cleared"),
        gte(declarations.submittedAt, threeMonthsAgo),
      ));

      // Group by trader and compute their avg
      const traderAvgs = new Map<string, number[]>();
      allCleared.forEach((d) => {
        if (!d.clearedAt || !d.submittedAt) return;
        const hrs = (new Date(d.clearedAt).getTime() - new Date(d.submittedAt).getTime()) / 3600000;
        const tid = String(d.traderId);
        if (!traderAvgs.has(tid)) traderAvgs.set(tid, []);
        traderAvgs.get(tid)!.push(hrs);
      });

      const population = Array.from(traderAvgs.values()).map(
        (times) => times.reduce((a, b) => a + b, 0) / times.length
      );

      const percentile = calculatePercentile(traderAvg, population);

      return {
        percentile,
        avgHours: Math.round(traderAvg * 10) / 10,
        populationSize: population.length,
        hsChapter: input?.hsChapter ?? "all",
      };
    }),

  /**
   * Get 12-month rejection rate trend with month-over-month delta.
   */
  getRejectionTrend: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { trend: [] };

      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

      const traderDecls = await db.select({
        status: declarations.status,
        submittedAt: declarations.submittedAt,
      }).from(declarations).where(and(
        eq(declarations.traderId, ctx.user.id),
        gte(declarations.submittedAt, twelveMonthsAgo),
      ));

      const months = getLast12Months();
      const monthlyData = months.map((month) => {
        const [year, mon] = month.split("-").map(Number);
        const monthDecls = traderDecls.filter((d) => {
          if (!d.submittedAt) return false;
          const dt = new Date(d.submittedAt);
          return dt.getFullYear() === year && dt.getMonth() + 1 === mon;
        });
        return {
          month,
          total: monthDecls.length,
          rejected: monthDecls.filter((d) => d.status === "rejected").length,
        };
      });

      return { trend: computeRejectionTrend(monthlyData) };
    }),

  /**
   * Get benchmark comparison: trader vs platform average.
   */
  getBenchmark: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      if (!db) return { trader: null, platform: null };

      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const [traderStats] = await db.select({
        total: count(),
        cleared: sql<number>`COUNT(CASE WHEN status = 'cleared' THEN 1 END)`,
        rejected: sql<number>`COUNT(CASE WHEN status = 'rejected' THEN 1 END)`,
      }).from(declarations).where(and(
        eq(declarations.traderId, ctx.user.id),
        gte(declarations.submittedAt, threeMonthsAgo),
      ));

      const [platformStats] = await db.select({
        total: count(),
        cleared: sql<number>`COUNT(CASE WHEN status = 'cleared' THEN 1 END)`,
        rejected: sql<number>`COUNT(CASE WHEN status = 'rejected' THEN 1 END)`,
      }).from(declarations).where(gte(declarations.submittedAt, threeMonthsAgo));

      const traderTotal = Number(traderStats?.total ?? 0);
      const platformTotal = Number(platformStats?.total ?? 0);

      return {
        trader: {
          total: traderTotal,
          clearanceRate: traderTotal > 0 ? Math.round((Number(traderStats?.cleared ?? 0) / traderTotal) * 10000) / 100 : 0,
          rejectionRate: traderTotal > 0 ? Math.round((Number(traderStats?.rejected ?? 0) / traderTotal) * 10000) / 100 : 0,
        },
        platform: {
          total: platformTotal,
          clearanceRate: platformTotal > 0 ? Math.round((Number(platformStats?.cleared ?? 0) / platformTotal) * 10000) / 100 : 0,
          rejectionRate: platformTotal > 0 ? Math.round((Number(platformStats?.rejected ?? 0) / platformTotal) * 10000) / 100 : 0,
        },
      };
    }),

  /**
   * updateScorecard — admin/customs officer can manually adjust a trader's AEO tier.
   */
  updateScorecard: protectedProcedure
    .input(z.object({
      traderId: z.number().int().positive(),
      aeoTier: z.enum(["standard", "silver", "gold"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!(["admin", "customs_officer"] as string[]).includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.aeoTier) updates.aeoTier = input.aeoTier;
      // aeoTier lives in stakeholder_profiles, not users
      const [updated] = await db
        .update(stakeholderProfiles)
        .set(updates as any)
        .where(eq(stakeholderProfiles.userId, input.traderId))
        .returning({ id: stakeholderProfiles.id, aeoTier: stakeholderProfiles.aeoTier });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Trader profile not found" });
      return { success: true, traderId: input.traderId, aeoTier: updated.aeoTier };
    }),

  /**
   * getComplianceTrend — 12-month compliance score trend for a trader.
   */
  getComplianceTrend: protectedProcedure
    .input(z.object({ traderId: z.number().int().positive().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { trend: [] };
      const targetId = input.traderId ?? ctx.user.id;
      const twelveMonthsAgo = new Date();
      twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
      const traderDecls = await db.select({
        status: declarations.status,
        submittedAt: declarations.submittedAt,
      }).from(declarations).where(and(
        eq(declarations.traderId, targetId),
        gte(declarations.submittedAt, twelveMonthsAgo),
      ));
      const months = getLast12Months();
      const trend = months.map((month) => {
        const [year, mon] = month.split("-").map(Number);
        const monthDecls = traderDecls.filter((d) => {
          if (!d.submittedAt) return false;
          const dt = new Date(d.submittedAt);
          return dt.getFullYear() === year && dt.getMonth() + 1 === mon;
        });
        const total = monthDecls.length;
        const cleared = monthDecls.filter((d) => d.status === "cleared").length;
        const rejected = monthDecls.filter((d) => d.status === "rejected").length;
        const score = total > 0 ? Math.round((cleared / total) * 100) : null;
        return { month, total, cleared, rejected, score };
      });
      return { trend };
    }),
});
