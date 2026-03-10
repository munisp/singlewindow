/**
 * execDigest.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Executive Dashboard — Daily Email Digest
 *
 * Fires at 03:00 UTC every day (scheduled in server/_core/index.ts).
 *
 * Collects yesterday's KPIs from the database:
 *   • Total declarations submitted
 *   • Green / Yellow / Red lane breakdown
 *   • Duty revenue collected (₦)
 *   • Average clearance time (hours)
 *   • Active SLA breaches
 *   • AEO operator count
 *   • Sanctions hits
 *   • Pilot report summary (if Apapa pilot data exists for yesterday)
 *
 * Sends a structured owner notification via the built-in notifyOwner helper.
 * Returns a summary object for use in tests.
 */

import { getDb } from "../db";
import { notifyOwner } from "../_core/notification";
import { sendDigestEmail } from "../lib/digestEmail";
import {
  declarations,
  payments,
  users,
  aeoApplications,
  sanctionsChecks,
  pilotReports,
  onboardingAnalytics,
} from "../../drizzle/schema";
import { eq, gte, lt, and, count, sql, avg, desc } from "drizzle-orm";

export interface OnboardingDropOffStep {
  step: string;
  completions: number;
  dropOffRate: number;
}

export interface ExecDigestResult {
  date: string;
  totalDeclarations: number;
  greenLane: number;
  yellowLane: number;
  redLane: number;
  clearanceRatePct: number;
  dutyRevenueNaira: number;
  avgClearanceHours: number | null;
  activeSlaBreaches: number;
  aeoOperators: number;
  sanctionsHits: number;
  pilotGreenPct: number | null;
  pilotAvgClearanceHours: number | null;
  onboardingDropOff: OnboardingDropOffStep[];
  notificationSent: boolean;
  emailSent: boolean;
  emailRecipients?: string[];
  emailSkipReason?: string;
}

export async function runExecDailyDigest(): Promise<ExecDigestResult> {
  console.log("[Cron] Executive daily digest starting…");

  const db = await getDb();
  if (!db) {
    console.warn("[Cron] DB unavailable — skipping executive daily digest");
    return {
      date: new Date().toISOString().slice(0, 10),
      totalDeclarations: 0,
      greenLane: 0,
      yellowLane: 0,
      redLane: 0,
      clearanceRatePct: 0,
      dutyRevenueNaira: 0,
      avgClearanceHours: null,
      activeSlaBreaches: 0,
      aeoOperators: 0,
      sanctionsHits: 0,
      pilotGreenPct: null,
      pilotAvgClearanceHours: null,
      onboardingDropOff: [],
      notificationSent: false,
      emailSent: false,
      emailSkipReason: "DB unavailable",
    };
  }

  // ── Date range: yesterday 00:00 UTC → 23:59:59 UTC ───────────────────────
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const todayMidnight = new Date(yesterday);
  todayMidnight.setUTCDate(todayMidnight.getUTCDate() + 1);

  const dateLabel = yesterday.toISOString().slice(0, 10);

  // ── 1. Declarations ───────────────────────────────────────────────────────
  const declRows = await db
    .select({
      riskLane: declarations.riskLane,
      status: declarations.status,
      count: count(),
    })
    .from(declarations)
    .where(and(gte(declarations.createdAt, yesterday), lt(declarations.createdAt, todayMidnight)))
    .groupBy(declarations.riskLane, declarations.status);

  let totalDeclarations = 0;
  let greenLane = 0;
  let yellowLane = 0;
  let redLane = 0;
  let clearedCount = 0;

  for (const row of declRows) {
    const n = Number(row.count ?? 0);
    totalDeclarations += n;
    if (row.riskLane === "green") greenLane += n;
    else if (row.riskLane === "yellow") yellowLane += n;
    else if (row.riskLane === "red") redLane += n;
    if (row.status === "cleared") clearedCount += n;
  }

  const clearanceRatePct = totalDeclarations > 0
    ? Math.round((clearedCount / totalDeclarations) * 1000) / 10
    : 0;

  // ── 2. Duty revenue (confirmed payments) ─────────────────────────────────
  const [revenueRow] = await db
    .select({ total: sql<string>`COALESCE(SUM(CAST(${payments.amount} AS NUMERIC)), 0)` })
    .from(payments)
    .where(and(
      gte(payments.createdAt, yesterday),
      lt(payments.createdAt, todayMidnight),
      eq(payments.status, "confirmed")
    ));
  const dutyRevenueNaira = parseFloat(revenueRow?.total ?? "0");

  // ── 3. Average clearance time (hours) ─────────────────────────────────────
  const [avgRow] = await db
    .select({
      avgMs: sql<string>`AVG(EXTRACT(EPOCH FROM (${declarations.clearedAt} - ${declarations.submittedAt})) * 1000)`,
    })
    .from(declarations)
    .where(and(
      gte(declarations.clearedAt, yesterday),
      lt(declarations.clearedAt, todayMidnight),
      eq(declarations.status, "cleared"),
      sql`${declarations.submittedAt} IS NOT NULL`,
      sql`${declarations.clearedAt} IS NOT NULL`
    ));
  const avgMs = parseFloat(avgRow?.avgMs ?? "0");
  const avgClearanceHours = avgMs > 0 ? Math.round((avgMs / 3_600_000) * 10) / 10 : null;

  // ── 4. Active SLA breaches ────────────────────────────────────────────────
  // Declarations still in processing states beyond their SLA threshold
  const SLA_HOURS: Record<string, number> = {
    green: 4, yellow: 24, red: 72, blue: 48,
  };
  const processingStatuses = ["submitted", "under_review", "inspection_required", "payment_pending"];
  const processingDecls = await db
    .select({
      riskLane: declarations.riskLane,
      submittedAt: declarations.submittedAt,
    })
    .from(declarations)
    .where(sql`${declarations.status} = ANY(ARRAY[${sql.raw(processingStatuses.map(s => `'${s}'`).join(","))}]::text[]) AND ${declarations.submittedAt} IS NOT NULL`);

  let activeSlaBreaches = 0;
  for (const d of processingDecls) {
    if (!d.submittedAt) continue;
    const lane = d.riskLane ?? "green";
    const slaHours = SLA_HOURS[lane] ?? 4;
    const elapsedHours = (now.getTime() - new Date(d.submittedAt).getTime()) / 3_600_000;
    if (elapsedHours > slaHours) activeSlaBreaches++;
  }

  // ── 5. AEO operators ──────────────────────────────────────────────────────
  const [aeoRow] = await db
    .select({ count: count() })
    .from(aeoApplications)
    .where(eq(aeoApplications.status, "approved"));
  const aeoOperators = Number(aeoRow?.count ?? 0);

  // ── 6. Sanctions hits (yesterday) ────────────────────────────────────────
  const [sanctionsRow] = await db
    .select({ count: count() })
    .from(sanctionsChecks)
    .where(and(
      gte(sanctionsChecks.createdAt, yesterday),
      lt(sanctionsChecks.createdAt, todayMidnight),
      eq(sanctionsChecks.checkResult, "confirmed_match")
    ));
  const sanctionsHits = Number(sanctionsRow?.count ?? 0);

  // ── 7. Onboarding drop-off (this week) ──────────────────────────────────
  const ONBOARDING_STEPS = [
    "role_selection",
    "company_profile",
    "kyc_documents",
    "bank_details",
    "first_declaration",
    "aeo_interest",
  ];
  let onboardingDropOff: OnboardingDropOffStep[] = [];
  try {
    const oneWeekAgo = new Date(now);
    oneWeekAgo.setUTCDate(oneWeekAgo.getUTCDate() - 7);
    // Count completions per step in the last 7 days
    const stepRows = await db
      .select({
        step: onboardingAnalytics.step,
        completions: count(),
      })
      .from(onboardingAnalytics)
      .where(and(
        gte(onboardingAnalytics.recordedAt, oneWeekAgo),
        eq(onboardingAnalytics.action, "complete")
      ))
      .groupBy(onboardingAnalytics.step);

    const stepMap = new Map(stepRows.map(r => [r.step, Number(r.completions)]));
    const maxCompletions = Math.max(...ONBOARDING_STEPS.map(s => stepMap.get(s) ?? 0), 1);

    // Find top 3 drop-off steps (steps with highest relative drop from previous step)
    const stepCounts = ONBOARDING_STEPS.map(s => stepMap.get(s) ?? 0);
    const dropOffSteps: OnboardingDropOffStep[] = [];
    for (let i = 0; i < ONBOARDING_STEPS.length; i++) {
      const prev = i === 0 ? maxCompletions : stepCounts[i - 1];
      const curr = stepCounts[i];
      const dropOffRate = prev > 0 ? Math.round(((prev - curr) / prev) * 1000) / 10 : 0;
      dropOffSteps.push({ step: ONBOARDING_STEPS[i], completions: curr, dropOffRate });
    }
    // Sort by drop-off rate descending, take top 3
    onboardingDropOff = dropOffSteps
      .sort((a, b) => b.dropOffRate - a.dropOffRate)
      .slice(0, 3);
  } catch {
    // Non-fatal — onboarding analytics may be empty
  }

  // ── 8. Pilot report for yesterday ────────────────────────────────────────
  let pilotGreenPct: number | null = null;
  let pilotAvgClearanceHours: number | null = null;
  try {
    const [pilotRow] = await db
      .select()
      .from(pilotReports)
      .where(sql`DATE(${pilotReports.reportDate}) = DATE(${yesterday.toISOString()})`);
    if (pilotRow) {
      const total = pilotRow.totalDeclarations ?? 0;
      const green = pilotRow.greenLane ?? 0;
      pilotGreenPct = total > 0 ? Math.round((green / total) * 1000) / 10 : null;
      pilotAvgClearanceHours = pilotRow.avgClearanceHoursX100 != null
        ? pilotRow.avgClearanceHoursX100 / 100
        : null;
    }
  } catch {
    // Pilot tables may not exist in all environments — non-fatal
  }

  // ── 8. Format and send notification ──────────────────────────────────────
  const fmt = (n: number) => n.toLocaleString("en-NG");
  const fmtNaira = (n: number) =>
    n >= 1_000_000_000
      ? `₦${(n / 1_000_000_000).toFixed(2)}B`
      : n >= 1_000_000
      ? `₦${(n / 1_000_000).toFixed(1)}M`
      : `₦${fmt(Math.round(n))}`;

  const lines: string[] = [
    `Executive Dashboard — Daily Digest for ${dateLabel}`,
    `Generated: ${now.toUTCString()}`,
    ``,
    `━━ DECLARATIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  Total submitted:     ${fmt(totalDeclarations)}`,
    `  Green lane:          ${fmt(greenLane)}  (${totalDeclarations > 0 ? Math.round(greenLane / totalDeclarations * 100) : 0}%)`,
    `  Yellow lane:         ${fmt(yellowLane)}  (${totalDeclarations > 0 ? Math.round(yellowLane / totalDeclarations * 100) : 0}%)`,
    `  Red lane:            ${fmt(redLane)}  (${totalDeclarations > 0 ? Math.round(redLane / totalDeclarations * 100) : 0}%)`,
    `  Clearance rate:      ${clearanceRatePct}%`,
    avgClearanceHours != null
      ? `  Avg clearance time:  ${avgClearanceHours}h`
      : `  Avg clearance time:  N/A`,
    ``,
    `━━ REVENUE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  Duty collected:      ${fmtNaira(dutyRevenueNaira)}`,
    ``,
    `━━ COMPLIANCE ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `  Active SLA breaches: ${fmt(activeSlaBreaches)}`,
    `  AEO operators:       ${fmt(aeoOperators)}`,
    `  Sanctions hits:      ${fmt(sanctionsHits)}`,
  ];

  if (pilotGreenPct !== null || pilotAvgClearanceHours !== null) {
    lines.push(
      ``,
      `━━ APAPA PILOT (Yesterday) ━━━━━━━━━━━━━━━━━━━━━━━`,
      pilotGreenPct !== null
        ? `  Green-lane rate:     ${pilotGreenPct}%`
        : `  Green-lane rate:     N/A`,
      pilotAvgClearanceHours !== null
        ? `  Avg clearance time:  ${pilotAvgClearanceHours}h`
        : `  Avg clearance time:  N/A`
    );
  }

  if (onboardingDropOff.length > 0) {
    lines.push(
      ``,
      `━━ ONBOARDING DROP-OFF (Top 3, Last 7 Days) ━━━━━━`,
      ...onboardingDropOff.map(s =>
        `  ${s.step.replace(/_/g, " ").padEnd(20)} ${s.completions} completions  (${s.dropOffRate}% drop-off)`
      )
    );
  }

  lines.push(
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Log in to the Executive Dashboard for full charts and drill-down.`
  );

  let notificationSent = false;
  try {
    notificationSent = await notifyOwner({
      title: `[Daily Digest ${dateLabel}] ${fmt(totalDeclarations)} decls | ${fmtNaira(dutyRevenueNaira)} duty | ${clearanceRatePct}% cleared`,
      content: lines.join("\n"),
    });
  } catch (err) {
    console.error("[Cron] Executive daily digest notification failed:", err);
  }

  // Build partial result so we can pass it to sendDigestEmail
  const partialResult = {
    date: dateLabel,
    totalDeclarations,
    greenLane,
    yellowLane,
    redLane,
    clearanceRatePct,
    dutyRevenueNaira,
    avgClearanceHours,
    activeSlaBreaches,
    aeoOperators,
    sanctionsHits,
    pilotGreenPct,
    pilotAvgClearanceHours,
    onboardingDropOff,
    notificationSent,
    emailSent: false,
  } satisfies ExecDigestResult;

  // Send SMTP email digest (gracefully skipped if SendGrid not configured)
  const emailResult = await sendDigestEmail(partialResult);

  const result: ExecDigestResult = {
    ...partialResult,
    emailSent: emailResult.sent,
    emailRecipients: emailResult.recipients,
    emailSkipReason: emailResult.reason,
  };

  console.log(
    `[Cron] Executive daily digest complete — ${fmt(totalDeclarations)} decls, ` +
    `${fmtNaira(dutyRevenueNaira)} duty, ${clearanceRatePct}% cleared, ` +
    `notification: ${notificationSent}, email: ${result.emailSent}` +
    (result.emailSkipReason ? ` (${result.emailSkipReason})` : "")
  );

  return result;
}
