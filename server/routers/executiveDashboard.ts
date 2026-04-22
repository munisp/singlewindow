import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { declarations, payments, users, aeoApplications, sanctionsChecks } from "../../drizzle/schema";
import { eq, desc, gte, count, sql, and } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { cacheWrap, cacheKey, TTL } from "../_core/cache";

// Allowed roles for the executive dashboard
const EXEC_ROLES = ["admin", "finance"] as const;

export const executiveDashboardRouter = router({
  // Real-time revenue counter — total confirmed payments
  getRevenueCounter: protectedProcedure
    .query(async ({ ctx }) => {
      if (!EXEC_ROLES.includes(ctx.user.role as typeof EXEC_ROLES[number])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const thisYear = new Date(today.getFullYear(), 0, 1);

      const [todayResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(and(gte(payments.createdAt, today), eq(payments.status, "confirmed")));

      const [monthResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(and(gte(payments.createdAt, thisMonth), eq(payments.status, "confirmed")));

      const [yearResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(and(gte(payments.createdAt, thisYear), eq(payments.status, "confirmed")));

      const [allTimeResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(eq(payments.status, "confirmed"));

      return {
        todayNaira: parseFloat(todayResult?.total ?? "0"),
        monthNaira: parseFloat(monthResult?.total ?? "0"),
        yearNaira: parseFloat(yearResult?.total ?? "0"),
        allTimeNaira: parseFloat(allTimeResult?.total ?? "0"),
        asOf: new Date(),
      };
    }),

  // Daily collection vs target gauge
  getDailyCollectionVsTarget: protectedProcedure
    .input(z.object({
      dailyTargetNaira: z.number().positive().default(500_000_000), // ₦500M default daily target
    }))
    .query(async ({ ctx, input }) => {
      if (!EXEC_ROLES.includes(ctx.user.role as typeof EXEC_ROLES[number])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [result] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
        .from(payments)
        .where(and(gte(payments.createdAt, today), eq(payments.status, "confirmed")));

      const collected = parseFloat(result?.total ?? "0");
      const pct = Math.min(100, (collected / input.dailyTargetNaira) * 100);

      return {
        collectedNaira: collected,
        targetNaira: input.dailyTargetNaira,
        pct: Math.round(pct * 10) / 10,
        onTrack: pct >= 80,
        asOf: new Date(),
      };
    }),

  // Top 10 HS chapters by revenue
  getTopHsChapters: protectedProcedure
    .input(z.object({
      startDate: z.date().optional(),
      endDate: z.date().optional(),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ ctx, input }) => {
      if (!EXEC_ROLES.includes(ctx.user.role as typeof EXEC_ROLES[number])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const startDate = input.startDate ?? new Date(new Date().getFullYear(), 0, 1);
      const endDate = input.endDate ?? new Date();

      // Join declarations and payments to get revenue by HS chapter
      const rows = await db
        .select({
          hsChapter: sql<string>`SUBSTRING(${declarations.hsCode}, 1, 2)`,
          totalRevenue: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS NUMERIC)), 0)`,
          declarationCount: count(declarations.id),
        })
        .from(declarations)
        .leftJoin(payments, eq(payments.declarationId, declarations.id))
        .where(and(
          gte(declarations.createdAt, startDate),
          gte(declarations.createdAt, startDate)
        ))
        .groupBy(sql`SUBSTRING(${declarations.hsCode}, 1, 2)`)
        .orderBy(desc(sql`SUM(CAST(${payments.amount} AS NUMERIC))`))
        .limit(input.limit);

      return rows.map(r => ({
        hsChapter: r.hsChapter ?? "Unknown",
        totalRevenueNaira: parseFloat(r.totalRevenue ?? "0"),
        declarationCount: Number(r.declarationCount ?? 0),
      }));
    }),

  // Platform-wide KPI summary for executives
  getKpiSummary: protectedProcedure
    .query(async ({ ctx }) => {
      if (!EXEC_ROLES.includes(ctx.user.role as typeof EXEC_ROLES[number])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return cacheWrap(cacheKey("exec", "kpi"), TTL.SHORT, async () => {
        const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const [totalDecls] = await db.select({ count: count() }).from(declarations);
        const [clearedDecls] = await db
          .select({ count: count() })
          .from(declarations)
          .where(eq(declarations.status, "cleared"));
        const [registeredTraders] = await db
          .select({ count: count() })
          .from(users)
          .where(eq(users.role, "user"));
        const [aeoCount] = await db
          .select({ count: count() })
          .from(aeoApplications)
          .where(eq(aeoApplications.status, "approved"));
        const [sanctionsHits] = await db
          .select({ count: count() })
          .from(sanctionsChecks)
          .where(eq(sanctionsChecks.checkResult, "confirmed_match"));
        const [monthRevenue] = await db
          .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), 0)` })
          .from(payments)
          .where(and(gte(payments.createdAt, thisMonth), eq(payments.status, "confirmed")));

        const td = Number(totalDecls?.count ?? 0);
        const cd = Number(clearedDecls?.count ?? 0);
        const rt = Number(registeredTraders?.count ?? 0);
        const ae = Number(aeoCount?.count ?? 0);
        const sh = Number(sanctionsHits?.count ?? 0);
        const mr = parseFloat(monthRevenue?.total ?? "0");
        return {
          totalDeclarations: td,
          clearedDeclarations: cd,
          clearanceRate: td > 0 ? Math.round((cd / td) * 1000) / 10 : 0,
          registeredTraders: rt,
          aeoOperators: ae,
          sanctionsHitsThisMonth: sh,
          monthRevenueNaira: mr,
          asOf: new Date(),
        };
      });
    }),

  // Export revenue data as CSV for a date range
  exportRevenueCsv: protectedProcedure
    .input(z.object({
      startDate: z.date(),
      endDate: z.date(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!EXEC_ROLES.includes(ctx.user.role as typeof EXEC_ROLES[number])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const rows = await db
        .select({
          date: sql<string>`DATE(${payments.createdAt})`,
          hsChapter: sql<string>`SUBSTRING(${declarations.hsCode}, 1, 2)`,
          corridor: sql<string>`CONCAT(${declarations.countryOfOrigin}, '->', ${declarations.countryOfDestination})`,
          totalRevenue: sql<string>`SUM(CAST(${payments.amount} AS NUMERIC))`,
          count: count(payments.id),
        })
        .from(payments)
        .leftJoin(declarations, eq(payments.declarationId, declarations.id))
        .where(and(
          gte(payments.createdAt, input.startDate),
          eq(payments.status, "confirmed")
        ))
        .groupBy(
          sql`DATE(${payments.createdAt})`,
          sql`SUBSTRING(${declarations.hsCode}, 1, 2)`,
          sql`CONCAT(${declarations.countryOfOrigin}, '->', ${declarations.countryOfDestination})`
        )
        .orderBy(desc(sql`DATE(${payments.createdAt})`));

      const header = "Date,HS Chapter,Corridor,Total Revenue (NGN),Transaction Count\n";
      const lines = rows.map(r =>
        `${r.date},${r.hsChapter ?? ""},${r.corridor ?? ""},${parseFloat(r.totalRevenue ?? "0").toFixed(2)},${r.count}`
      );
      return { csv: header + lines.join("\n"), rowCount: rows.length };
    }),
});
