/**
 * Onboarding Analytics Router — Sprint 72
 * Funnel metrics, step completion rates, drop-off analysis, and time-to-complete.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { onboardingAnalytics, onboardingProgress, users, aeoApplications } from "../../drizzle/schema";
import { eq, desc, and, gte, count, avg, sql } from "drizzle-orm";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}

const ONBOARDING_STEPS = [
  "company_profile",
  "kyc_documents",
  "bank_account",
  "test_declaration",
  "aeo_eligibility",
] as const;

export const onboardingAnalyticsRouter = router({
  /** Record an analytics event for the current user's onboarding session */
  record: protectedProcedure
    .input(z.object({
      step: z.enum(ONBOARDING_STEPS),
      action: z.enum(["started", "completed", "error", "skipped", "revisited"]),
      timeSpentSeconds: z.number().int().min(0).optional(),
      errorCount: z.number().int().min(0).default(0),
      metadata: z.record(z.string(), z.unknown()).default({}),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [row] = await db.insert(onboardingAnalytics).values({
        userId: ctx.user.id,
        step: input.step,
        action: input.action,
        timeSpentSeconds: input.timeSpentSeconds ?? null,
        errorCount: input.errorCount,
        metadata: input.metadata as Record<string, unknown>,
      }).returning();
      return row;
    }),

  /** Admin: get funnel overview — how many users reached each step */
  funnel: adminProcedure.query(async () => {
    const db = await requireDb();

    // Count users who started each step
    const results = await Promise.all(
      ONBOARDING_STEPS.map(async (step) => {
        const [started] = await db
          .select({ count: count() })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "started")));
        const [completed] = await db
          .select({ count: count() })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "completed")));
        const [errors] = await db
          .select({ count: count() })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "error")));
        const [avgTime] = await db
          .select({ avg: avg(onboardingAnalytics.timeSpentSeconds) })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "completed")));

        return {
          step,
          started: started?.count ?? 0,
          completed: completed?.count ?? 0,
          errors: errors?.count ?? 0,
          avgTimeSeconds: avgTime?.avg ? Math.round(Number(avgTime.avg)) : null,
          completionRate: started?.count && started.count > 0
            ? Math.round(((completed?.count ?? 0) / started.count) * 100)
            : 0,
        };
      })
    );

    return results;
  }),

  /** Admin: overall onboarding summary stats */
  summary: adminProcedure.query(async () => {
    const db = await requireDb();

    // Total users who started onboarding
    const [totalStarted] = await db
      .select({ count: count() })
      .from(onboardingProgress);

    // Users who completed all 5 steps
    const [totalCompleted] = await db
      .select({ count: count() })
      .from(onboardingProgress)
      .where(sql`${onboardingProgress.completedAt} IS NOT NULL`);

    // Users who started in last 7 days
    const [recentStarts] = await db
      .select({ count: count() })
      .from(onboardingProgress)
      .where(gte(onboardingProgress.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));

    // Users who completed in last 7 days
    const [recentCompletions] = await db
      .select({ count: count() })
      .from(onboardingProgress)
      .where(and(
        sql`${onboardingProgress.completedAt} IS NOT NULL`,
        gte(onboardingProgress.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      ));

    const total = totalStarted?.count ?? 0;
    const completed = totalCompleted?.count ?? 0;

    return {
      totalStarted: total,
      totalCompleted: completed,
      overallCompletionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
      recentStarts7d: recentStarts?.count ?? 0,
      recentCompletions7d: recentCompletions?.count ?? 0,
    };
  }),

  /** Admin: drop-off analysis — users who started but didn't complete each step */
  dropoff: adminProcedure.query(async () => {
    const db = await requireDb();

    const results = await Promise.all(
      ONBOARDING_STEPS.map(async (step) => {
        const [started] = await db
          .select({ count: count() })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "started")));
        const [completed] = await db
          .select({ count: count() })
          .from(onboardingAnalytics)
          .where(and(eq(onboardingAnalytics.step, step), eq(onboardingAnalytics.action, "completed")));

        const startCount = started?.count ?? 0;
        const completeCount = completed?.count ?? 0;
        return {
          step,
          dropoffs: Math.max(0, startCount - completeCount),
          dropoffRate: startCount > 0 ? Math.round(((startCount - completeCount) / startCount) * 100) : 0,
        };
      })
    );

    return results;
  }),

  /** Admin: recent onboarding activity feed */
  recentActivity: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const rows = await db
        .select({
          id: onboardingAnalytics.id,
          userId: onboardingAnalytics.userId,
          step: onboardingAnalytics.step,
          action: onboardingAnalytics.action,
          timeSpentSeconds: onboardingAnalytics.timeSpentSeconds,
          errorCount: onboardingAnalytics.errorCount,
          recordedAt: onboardingAnalytics.recordedAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(onboardingAnalytics)
        .leftJoin(users, eq(onboardingAnalytics.userId, users.id))
        .orderBy(desc(onboardingAnalytics.recordedAt))
        .limit(input.limit);
      return rows;
    }),

  /** Admin: AEO tier distribution — count of applications per tier */
  aeoTiers: adminProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        tier: aeoApplications.tier,
        count: count(),
      })
      .from(aeoApplications)
      .groupBy(aeoApplications.tier);
    // Return all three tiers even if count is 0
    const tierMap: Record<string, number> = { Gold: 0, Silver: 0, Standard: 0 };
    for (const row of rows) {
      if (row.tier) tierMap[row.tier] = row.count;
    }
    return Object.entries(tierMap).map(([tier, count]) => ({ tier, count }));
  }),
});

export type OnboardingAnalyticsRouter = typeof onboardingAnalyticsRouter;
