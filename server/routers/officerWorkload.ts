/**
 * Officer Workload Router
 *
 * Provides customs supervisor visibility into:
 *   - Each officer's current case queue depth
 *   - Average declaration review time (hours)
 *   - SLA compliance rate (% reviewed within target time)
 *   - Team-level summary stats
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

export const officerWorkloadRouter = router({
  // ── TEAM SUMMARY ─────────────────────────────────────────────────────────────
  // Returns aggregate workload stats for all officers (admin/supervisor only).
  getTeamSummary: protectedProcedure
    .input(
      z.object({
        periodDays: z.number().int().min(1).max(90).default(30),
        slaTargetHours: z.number().min(1).max(168).default(24),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin or customs officer role required" });
      }
      const { getDb } = await import("../db");
      const { users, declarations, fraudCases } = await import("../../drizzle/schema");
      const { eq, and, gte, isNotNull, count, sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date();
      since.setDate(since.getDate() - input.periodDays);

      // Get all customs officers
      const officers = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.role, "customs_officer"));

      if (officers.length === 0) {
        return {
          officers: [],
          teamStats: {
            totalOfficers: 0,
            totalQueueDepth: 0,
            avgReviewTimeHours: null,
            slaComplianceRate: null,
            periodDays: input.periodDays,
            slaTargetHours: input.slaTargetHours,
          },
        };
      }

      const officerIds = officers.map((o) => o.id);

      // Queue depth: declarations currently assigned to each officer that are pending/under_review
      const queueRows = await db
        .select({
          officerId: declarations.assignedOfficerId,
          queueDepth: count(),
        })
        .from(declarations)
        .where(
          and(
            isNotNull(declarations.assignedOfficerId),
            sql`${declarations.status} IN ('submitted', 'under_review', 'pending_payment')`
          )
        )
        .groupBy(declarations.assignedOfficerId);

      const queueMap = new Map<number, number>();
      for (const row of queueRows) {
        if (row.officerId != null) queueMap.set(row.officerId, Number(row.queueDepth));
      }

      // Cleared declarations in period: compute avg review time (submittedAt → clearedAt)
      const clearedRows = await db
        .select({
          officerId: declarations.assignedOfficerId,
          submittedAt: declarations.submittedAt,
          clearedAt: declarations.clearedAt,
        })
        .from(declarations)
        .where(
          and(
            isNotNull(declarations.assignedOfficerId),
            isNotNull(declarations.submittedAt),
            isNotNull(declarations.clearedAt),
            gte(declarations.clearedAt, since),
            eq(declarations.status, "cleared")
          )
        )
        .limit(5000);

      // Group by officer
      type OfficerStats = {
        reviewTimes: number[];
        withinSla: number;
        total: number;
      };
      const statsMap = new Map<number, OfficerStats>();

      for (const row of clearedRows) {
        if (row.officerId == null || !row.submittedAt || !row.clearedAt) continue;
        const hours =
          (new Date(row.clearedAt).getTime() - new Date(row.submittedAt).getTime()) /
          (1000 * 60 * 60);
        if (!statsMap.has(row.officerId)) {
          statsMap.set(row.officerId, { reviewTimes: [], withinSla: 0, total: 0 });
        }
        const s = statsMap.get(row.officerId)!;
        s.reviewTimes.push(hours);
        s.total++;
        if (hours <= input.slaTargetHours) s.withinSla++;
      }

      // Open fraud cases per officer
      const caseRows = await db
        .select({
          officerId: fraudCases.assignedTo,
          openCases: count(),
        })
        .from(fraudCases)
        .where(
          and(
            isNotNull(fraudCases.assignedTo),
            sql`${fraudCases.status} IN ('open', 'under_review')`
          )
        )
        .groupBy(fraudCases.assignedTo);

      const caseMap = new Map<number, number>();
      for (const row of caseRows) {
        if (row.officerId != null) caseMap.set(row.officerId, Number(row.openCases));
      }

      // Build per-officer result
      const officerResults = officers.map((o) => {
        const stats = statsMap.get(o.id);
        const avgReviewHours =
          stats && stats.reviewTimes.length > 0
            ? stats.reviewTimes.reduce((a, b) => a + b, 0) / stats.reviewTimes.length
            : null;
        const slaRate =
          stats && stats.total > 0 ? (stats.withinSla / stats.total) * 100 : null;

        return {
          id: o.id,
          name: o.name ?? `Officer #${o.id}`,
          email: o.email ?? null,
          queueDepth: queueMap.get(o.id) ?? 0,
          openFraudCases: caseMap.get(o.id) ?? 0,
          declarationsReviewedInPeriod: stats?.total ?? 0,
          avgReviewTimeHours: avgReviewHours != null ? Math.round(avgReviewHours * 10) / 10 : null,
          slaComplianceRate: slaRate != null ? Math.round(slaRate * 10) / 10 : null,
          withinSlaCount: stats?.withinSla ?? 0,
          breachedSlaCount: stats ? stats.total - stats.withinSla : 0,
        };
      });

      // Team-level aggregates
      const allReviewTimes = clearedRows
        .filter((r) => r.submittedAt && r.clearedAt)
        .map(
          (r) =>
            (new Date(r.clearedAt!).getTime() - new Date(r.submittedAt!).getTime()) /
            (1000 * 60 * 60)
        );
      const teamAvgHours =
        allReviewTimes.length > 0
          ? allReviewTimes.reduce((a, b) => a + b, 0) / allReviewTimes.length
          : null;
      const teamWithinSla = allReviewTimes.filter((h) => h <= input.slaTargetHours).length;
      const teamSlaRate =
        allReviewTimes.length > 0 ? (teamWithinSla / allReviewTimes.length) * 100 : null;

      return {
        officers: officerResults,
        teamStats: {
          totalOfficers: officers.length,
          totalQueueDepth: officerResults.reduce((s, o) => s + o.queueDepth, 0),
          avgReviewTimeHours: teamAvgHours != null ? Math.round(teamAvgHours * 10) / 10 : null,
          slaComplianceRate: teamSlaRate != null ? Math.round(teamSlaRate * 10) / 10 : null,
          periodDays: input.periodDays,
          slaTargetHours: input.slaTargetHours,
        },
      };
    }),

  // ── MY WORKLOAD ───────────────────────────────────────────────────────────────
  // Returns the current officer's own queue and recent performance.
  getMyWorkload: protectedProcedure
    .input(z.object({ periodDays: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "customs_officer" && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer role required" });
      }
      const { getDb } = await import("../db");
      const { declarations, fraudCases } = await import("../../drizzle/schema");
      const { eq, and, gte, isNotNull, count, sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const since = new Date();
      since.setDate(since.getDate() - input.periodDays);

      const [queueRow] = await db
        .select({ queueDepth: count() })
        .from(declarations)
        .where(
          and(
            eq(declarations.assignedOfficerId, ctx.user.id),
            sql`${declarations.status} IN ('submitted', 'under_review', 'pending_payment')`
          )
        );

      const clearedRows = await db
        .select({
          submittedAt: declarations.submittedAt,
          clearedAt: declarations.clearedAt,
        })
        .from(declarations)
        .where(
          and(
            eq(declarations.assignedOfficerId, ctx.user.id),
            isNotNull(declarations.submittedAt),
            isNotNull(declarations.clearedAt),
            gte(declarations.clearedAt, since),
            eq(declarations.status, "cleared")
          )
        )
        .limit(1000);

      const [openCasesRow] = await db
        .select({ openCases: count() })
        .from(fraudCases)
        .where(
          and(
            eq(fraudCases.assignedTo, ctx.user.id),
            sql`${fraudCases.status} IN ('open', 'under_review')`
          )
        );

      const reviewTimes = clearedRows
        .filter((r) => r.submittedAt && r.clearedAt)
        .map(
          (r) =>
            (new Date(r.clearedAt!).getTime() - new Date(r.submittedAt!).getTime()) /
            (1000 * 60 * 60)
        );

      const avgHours =
        reviewTimes.length > 0
          ? reviewTimes.reduce((a, b) => a + b, 0) / reviewTimes.length
          : null;

      return {
        queueDepth: Number(queueRow?.queueDepth ?? 0),
        openFraudCases: Number(openCasesRow?.openCases ?? 0),
        declarationsReviewedInPeriod: clearedRows.length,
        avgReviewTimeHours: avgHours != null ? Math.round(avgHours * 10) / 10 : null,
        periodDays: input.periodDays,
      };
    }),
});
