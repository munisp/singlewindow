/**
 * Admin Analytics Router — Sprint 19
 * Provides platform-wide metrics for the Admin Analytics Dashboard.
 * All procedures are admin-only.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { declarations, payments } from "../../drizzle/schema";
import { sql, gte, and, isNotNull } from "drizzle-orm";

const adminOnly = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

export const adminAnalyticsRouter = router({
  /**
   * Declaration throughput: count of declarations submitted per day for the last N days.
   */
  declarationThroughput: adminOnly
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          day: sql<string>`DATE(${declarations.createdAt})`.as("day"),
          count: sql<number>`COUNT(*)::int`.as("count"),
        })
        .from(declarations)
        .where(gte(declarations.createdAt, since))
        .groupBy(sql`DATE(${declarations.createdAt})`)
        .orderBy(sql`DATE(${declarations.createdAt})`);
      return rows;
    }),

  /**
   * Average clearance time (hours) by risk lane.
   * Only includes cleared declarations where both submittedAt and clearedAt are set.
   */
  clearanceTimeByLane: adminOnly.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        lane: declarations.riskLane,
        avgHours: sql<number>`
          AVG(EXTRACT(EPOCH FROM (${declarations.clearedAt} - ${declarations.submittedAt})) / 3600)::numeric(10,2)
        `.as("avg_hours"),
        count: sql<number>`COUNT(*)::int`.as("count"),
      })
      .from(declarations)
      .where(
        and(
          isNotNull(declarations.clearedAt),
          isNotNull(declarations.submittedAt),
          sql`${declarations.status} = 'cleared'`
        )
      )
      .groupBy(declarations.riskLane);
    return rows.map((r) => ({
      lane: r.lane ?? "unknown",
      avgHours: Number(r.avgHours ?? 0),
      count: r.count,
    }));
  }),

  /**
   * Duty revenue trend: total duty collected per day for the last N days.
   */
  dutyRevenueTrend: adminOnly
    .input(z.object({ days: z.number().int().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const since = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
      const rows = await db
        .select({
          day: sql<string>`DATE(${payments.createdAt})`.as("day"),
          totalRevenue: sql<number>`SUM(${payments.amount})::numeric(18,2)`.as("total_revenue"),
          count: sql<number>`COUNT(*)::int`.as("count"),
        })
        .from(payments)
        .where(
          and(
            gte(payments.createdAt, since),
            sql`${payments.status} = 'completed'`
          )
        )
        .groupBy(sql`DATE(${payments.createdAt})`)
        .orderBy(sql`DATE(${payments.createdAt})`);
      return rows.map((r) => ({
        day: r.day,
        totalRevenue: Number(r.totalRevenue ?? 0),
        count: r.count,
      }));
    }),

  /**
   * Top HS chapters by declaration volume (first 2 digits of HS code).
   */
  topHSChapters: adminOnly
    .input(z.object({ limit: z.number().int().min(5).max(20).default(10) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select({
          chapter: sql<string>`SUBSTRING(${declarations.hsCode}, 1, 2)`.as("chapter"),
          count: sql<number>`COUNT(*)::int`.as("count"),
        })
        .from(declarations)
        .where(isNotNull(declarations.hsCode))
        .groupBy(sql`SUBSTRING(${declarations.hsCode}, 1, 2)`)
        .orderBy(sql`COUNT(*) DESC`)
        .limit(input.limit);
      return rows.filter((r) => r.chapter && r.chapter.trim() !== "");
    }),

  /**
   * Declaration status distribution (all-time snapshot).
   */
  declarationsByStatus: adminOnly.query(async () => {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        status: declarations.status,
        count: sql<number>`COUNT(*)::int`.as("count"),
      })
      .from(declarations)
      .groupBy(declarations.status)
      .orderBy(sql`COUNT(*) DESC`);
    return rows;
  }),

  /**
   * Summary KPIs: total declarations, total revenue, avg clearance time, clearance rate.
   */
  kpiSummary: adminOnly.query(async () => {
    const db = await getDb();
    if (!db) return { totalDeclarations: 0, totalRevenue: 0, avgClearanceHours: null, clearanceRate: 0 };

    const [declStats] = await db
      .select({
        total: sql<number>`COUNT(*)::int`.as("total"),
        cleared: sql<number>`COUNT(*) FILTER (WHERE ${declarations.status} = 'cleared')::int`.as("cleared"),
        avgHours: sql<number>`
          AVG(EXTRACT(EPOCH FROM (${declarations.clearedAt} - ${declarations.submittedAt})) / 3600)
          FILTER (WHERE ${declarations.clearedAt} IS NOT NULL AND ${declarations.submittedAt} IS NOT NULL)
        `.as("avg_hours"),
      })
      .from(declarations);

    const [payStats] = await db
      .select({
        totalRevenue: sql<number>`COALESCE(SUM(${payments.amount}), 0)::numeric(18,2)`.as("total_revenue"),
      })
      .from(payments)
      .where(sql`${payments.status} = 'completed'`);

    const total = declStats?.total ?? 0;
    const cleared = declStats?.cleared ?? 0;
    return {
      totalDeclarations: total,
      totalRevenue: Number(payStats?.totalRevenue ?? 0),
      avgClearanceHours: declStats?.avgHours != null ? Number(Number(declStats.avgHours).toFixed(1)) : null,
      clearanceRate: total > 0 ? Math.round((cleared / total) * 100) : 0,
    };
  }),
});
