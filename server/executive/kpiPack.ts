/**
 * executive/kpiPack.ts — ministerial KPI pack + trade analytics + SLA breach
 * queries (Phase 12 Mission C). ALL aggregates are real SQL against existing
 * tables; no fabricated numbers. DB outage throws KpiPackUnavailable →
 * callers answer honest 503 (fail-closed).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";

export class KpiPackUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KpiPackUnavailable";
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new KpiPackUnavailable("Database unavailable — KPI pack cannot be computed (fail-closed)");
  return db;
}

export interface MinisterialKpiSummary {
  window: { from: string; to: string };
  generatedAt: string;
  revenueCollectedUsd: number;
  declarationsCleared: number;
  declarationsTotal: number;
  avgClearanceHours: number;
  interceptions: number;          // confirmed sanctions matches + red-lane holds in window
  electronicCoveragePct: number;  // e-documents lodged vs declarations submitted
  slaCompliancePct: number;       // OGA permits answered within their SLA deadline
}

/** Ministerial KPI pack for a trailing window (default 30 days, max 92). */
export async function computeKpiSummary(days = 30): Promise<MinisterialKpiSummary> {
  const db = await requireDb();
  const bounded = Math.min(Math.max(days, 1), 92);
  const to = new Date();
  const from = new Date(to.getTime() - bounded * 86_400_000);

  const [rev] = (await db.execute(sql`
    SELECT COALESCE(sum(amount::numeric), 0)::float8 AS total
    FROM payments
    WHERE status = 'confirmed' AND created_at >= ${from} AND created_at <= ${to}
  `)) as unknown as Array<{ total: number }>;

  const [decl] = (await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) filter (where status = 'cleared' AND cleared_at >= ${from} AND cleared_at <= ${to})::int AS cleared
    FROM declarations
  `)) as unknown as Array<{ total: number; cleared: number }>;

  const [avg] = (await db.execute(sql`
    SELECT COALESCE(avg(extract(epoch from (cleared_at - submitted_at)) / 3600.0), 0)::float8 AS hours
    FROM declarations
    WHERE status = 'cleared' AND submitted_at IS NOT NULL AND cleared_at IS NOT NULL
      AND cleared_at >= ${from} AND cleared_at <= ${to}
  `)) as unknown as Array<{ hours: number }>;

  const [inter] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM sanctions_checks
        WHERE check_result = 'confirmed_match' AND created_at >= ${from} AND created_at <= ${to})::int
      +
      (SELECT count(*) FROM declarations
        WHERE risk_lane = 'red' AND submitted_at >= ${from} AND submitted_at <= ${to})::int
      AS n
  `)) as unknown as Array<{ n: number }>;

  const [coverage] = (await db.execute(sql`
    SELECT
      (SELECT count(*) FROM declaration_documents WHERE created_at >= ${from} AND created_at <= ${to})::int AS docs,
      (SELECT count(*) FROM declarations WHERE submitted_at >= ${from} AND submitted_at <= ${to})::int AS decls
  `)) as unknown as Array<{ docs: number; decls: number }>;

  const [sla] = (await db.execute(sql`
    SELECT count(*)::int AS answered,
           count(*) filter (where responded_at IS NOT NULL AND (sla_deadline IS NULL OR responded_at <= sla_deadline))::int AS within_sla
    FROM oga_permits
    WHERE responded_at IS NOT NULL AND responded_at >= ${from} AND responded_at <= ${to}
  `)) as unknown as Array<{ answered: number; within_sla: number }>;

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    generatedAt: to.toISOString(),
    revenueCollectedUsd: Math.round(Number(rev?.total ?? 0) * 100) / 100,
    declarationsCleared: Number(decl?.cleared ?? 0),
    declarationsTotal: Number(decl?.total ?? 0),
    avgClearanceHours: Math.round(Number(avg?.hours ?? 0) * 10) / 10,
    interceptions: Number(inter?.n ?? 0),
    electronicCoveragePct: coverage?.decls > 0 ? Math.round((coverage.docs / coverage.decls) * 1000) / 10 : 0,
    slaCompliancePct: sla?.answered > 0 ? Math.round((sla.within_sla / sla.answered) * 1000) / 10 : 100,
  };
}

/** Trade analytics aggregates for a trailing window (default 30 days). */
export async function computeTradeAnalytics(days = 30) {
  const db = await requireDb();
  const bounded = Math.min(Math.max(days, 1), 92);
  const from = new Date(Date.now() - bounded * 86_400_000);

  const byDay = (await db.execute(sql`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
           count(*)::int AS declarations,
           count(*) filter (where status = 'cleared')::int AS cleared,
           COALESCE(sum(total_due::numeric), 0)::float8 AS assessed
    FROM declarations
    WHERE created_at >= ${from}
    GROUP BY 1 ORDER BY 1
  `)) as unknown as Array<Record<string, unknown>>;

  const topHs = (await db.execute(sql`
    SELECT left(hs_code, 2) AS chapter, count(*)::int AS declarations,
           COALESCE(sum(invoice_value::numeric), 0)::float8 AS value
    FROM declarations
    WHERE hs_code IS NOT NULL AND created_at >= ${from}
    GROUP BY 1 ORDER BY 3 DESC LIMIT 10
  `)) as unknown as Array<Record<string, unknown>>;

  const byType = (await db.execute(sql`
    SELECT declaration_type::text AS type, count(*)::int AS n
    FROM declarations WHERE created_at >= ${from} GROUP BY 1
  `)) as unknown as Array<Record<string, unknown>>;

  return { windowDays: bounded, generatedAt: new Date().toISOString(), byDay, topHsChapters: topHs, byType };
}

export const SLA_BREACH_MAX_PAGE = 100;

/** SLA breach list: overdue OGA permits + overdue CRM cases (capped). */
export async function listSlaBreaches(limit = 50, offset = 0) {
  const db = await requireDb();
  const cappedLimit = Math.min(Math.max(limit, 1), SLA_BREACH_MAX_PAGE);
  const cappedOffset = Math.max(offset, 0);
  const now = new Date();

  const permits = (await db.execute(sql`
    SELECT 'oga_permit'::text AS kind, id, agency_code AS ref, sla_deadline AS due, status, created_at
    FROM oga_permits
    WHERE sla_deadline IS NOT NULL AND sla_deadline < ${now}
      AND status NOT IN ('approved', 'rejected')
    ORDER BY sla_deadline ASC LIMIT ${cappedLimit} OFFSET ${cappedOffset}
  `)) as unknown as Array<Record<string, unknown>>;

  const cases = (await db.execute(sql`
    SELECT 'crm_case'::text AS kind, id, case_number AS ref, sla_resolution_due AS due, status, created_at
    FROM crm_cases
    WHERE sla_resolution_due IS NOT NULL AND sla_resolution_due < ${now}
      AND status NOT IN ('resolved', 'closed')
    ORDER BY sla_resolution_due ASC LIMIT ${cappedLimit}
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    asOf: now.toISOString(),
    limit: cappedLimit,
    offset: cappedOffset,
    permits,
    cases,
    total: permits.length + cases.length,
  };
}

/** Customs/NCS summary from local customs tables (real aggregates). */
export async function computeCustomsSummary() {
  const db = await requireDb();
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const [status] = (await db.execute(sql`
    SELECT json_object_agg(status, n) AS by_status FROM (
      SELECT status::text AS status, count(*)::int AS n FROM declarations GROUP BY 1
    ) s
  `)) as unknown as Array<{ by_status: Record<string, number> }>;

  const [lane] = (await db.execute(sql`
    SELECT json_object_agg(lane, n) AS by_lane FROM (
      SELECT COALESCE(risk_lane::text, 'unknown') AS lane, count(*)::int AS n FROM declarations GROUP BY 1
    ) s
  `)) as unknown as Array<{ by_lane: Record<string, number> }>;

  const [rev] = (await db.execute(sql`
    SELECT COALESCE(sum(amount::numeric), 0)::float8 AS total
    FROM payments WHERE status = 'confirmed' AND created_at >= ${thisMonth}
  `)) as unknown as Array<{ total: number }>;

  const [permits] = (await db.execute(sql`
    SELECT count(*) filter (where status = 'pending')::int AS pending,
           count(*)::int AS total
    FROM oga_permits
  `)) as unknown as Array<{ pending: number; total: number }>;

  return {
    asOf: new Date().toISOString(),
    declarationsByStatus: status?.by_status ?? {},
    declarationsByLane: lane?.by_lane ?? {},
    monthRevenueUsd: Math.round(Number(rev?.total ?? 0) * 100) / 100,
    ogaPermits: { pending: Number(permits?.pending ?? 0), total: Number(permits?.total ?? 0) },
  };
}
