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
import { getDb } from "../db";
import { users, declarations } from "../../drizzle/schema";
import { eq, and, count, desc, sql } from "drizzle-orm";

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

  /**
   * v120: autoRebalanceWorkload — redistribute unassigned declarations evenly
   * across available customs officers, using a round-robin assignment strategy
   * weighted by current queue depth. Returns the number of assignments made.
   */
  autoRebalanceWorkload: protectedProcedure
    .input(z.object({
      maxAssignmentsPerOfficer: z.number().int().min(1).max(200).default(50),
      dryRun: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!["admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Customs officer or admin access required" });
      }

      const db = await getDb();
      if (!db) return { assigned: 0, dryRun: input.dryRun, reason: "Database unavailable" };

      // Get all active customs officers
      const officers = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.role, "customs_officer"))
        .limit(100);

      if (officers.length === 0) return { assigned: 0, dryRun: input.dryRun, reason: "No active officers found" };

      // Get current queue depth per officer
      const queueRows = await db
        .select({ officerId: declarations.assignedOfficerId, depth: count() })
        .from(declarations)
        .where(
          and(
            sql`${declarations.assignedOfficerId} IS NOT NULL`,
            sql`${declarations.status} IN ('submitted', 'under_assessment', 'docs_required', 'payment_pending', 'under_examination')`
          )
        )
        .groupBy(declarations.assignedOfficerId);

      const queueMap: Record<number, number> = {};
      for (const row of queueRows) {
        if (row.officerId) queueMap[row.officerId] = Number(row.depth);
      }

      // Get unassigned declarations
      const unassigned = await db
        .select({ id: declarations.id })
        .from(declarations)
        .where(
          and(
            sql`${declarations.assignedOfficerId} IS NULL`,
            sql`${declarations.status} IN ('submitted', 'under_assessment', 'docs_required')`
          )
        )
        .orderBy(declarations.submittedAt)
        .limit(officers.length * input.maxAssignmentsPerOfficer);

      if (unassigned.length === 0) return { assigned: 0, dryRun: input.dryRun, reason: "No unassigned declarations" };

      // Sort officers by queue depth (ascending) for round-robin
      const sortedOfficers = [...officers].sort((a, b) => (queueMap[a.id] ?? 0) - (queueMap[b.id] ?? 0));

      let assigned = 0;
      const assignments: Array<{ declarationId: number; officerId: number; officerName: string | null }> = [];

      for (let i = 0; i < unassigned.length; i++) {
        const officer = sortedOfficers[i % sortedOfficers.length];
        const currentDepth = queueMap[officer.id] ?? 0;
        if (currentDepth >= input.maxAssignmentsPerOfficer) continue;

        assignments.push({ declarationId: unassigned[i].id, officerId: officer.id, officerName: officer.name });
        queueMap[officer.id] = (queueMap[officer.id] ?? 0) + 1;
        assigned++;
      }

      if (!input.dryRun && assignments.length > 0) {
        for (const a of assignments) {
          await db.update(declarations)
            .set({ assignedOfficerId: a.officerId, updatedAt: new Date() })
            .where(eq(declarations.id, a.declarationId));
        }
      }

      return {
        assigned,
        dryRun: input.dryRun,
        officerCount: officers.length,
        assignments: input.dryRun ? assignments.slice(0, 20) : [],
        message: input.dryRun
          ? `Dry run: would assign ${assigned} declarations across ${officers.length} officers`
          : `Assigned ${assigned} declarations across ${officers.length} officers`,
      };
    }),

  /**
   * v120: getWorkloadDistribution — return a histogram of queue depth per officer
   * for the workload balancer dashboard widget.
   */
  getWorkloadDistribution: protectedProcedure.query(async ({ ctx }) => {
    if (!["admin", "customs_officer"].includes(ctx.user.role)) {
      throw new TRPCError({ code: "FORBIDDEN" });
    }

    const db = await getDb();
    if (!db) return { officers: [], totalUnassigned: 0 };

    const queueRows = await db
      .select({
        officerId: declarations.assignedOfficerId,
        officerName: users.name,
        depth: count(),
      })
      .from(declarations)
      .innerJoin(users, eq(declarations.assignedOfficerId, users.id))
      .where(
        sql`${declarations.status} IN ('submitted', 'under_assessment', 'docs_required', 'payment_pending', 'under_examination')`
      )
      .groupBy(declarations.assignedOfficerId, users.name)
      .orderBy(desc(count()));

    const [unassignedRow] = await db
      .select({ total: count() })
      .from(declarations)
      .where(
        and(
          sql`${declarations.assignedOfficerId} IS NULL`,
          sql`${declarations.status} IN ('submitted', 'under_assessment', 'docs_required')`
        )
      );

    const totalAssigned = queueRows.reduce((s, r) => s + Number(r.depth), 0);
    const avgDepth = queueRows.length > 0 ? Math.round(totalAssigned / queueRows.length) : 0;

    return {
      officers: queueRows.map((r) => ({
        officerId: r.officerId,
        officerName: r.officerName,
        queueDepth: Number(r.depth),
        overloaded: Number(r.depth) > avgDepth * 1.5,
      })),
      totalUnassigned: Number(unassignedRow?.total ?? 0),
      avgDepth,
      totalAssigned,
    };
  }),
});