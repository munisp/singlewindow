/**
 * derivedKpis.ts — KPI targets derived HONESTLY from seeded facts.
 *
 * Every KPI value here is computed from the data actually seeded into the
 * demo database (counts/sums over declarations, payments, vessels, port
 * calls). Nothing is fabricated: if the underlying table is empty the KPI
 * is 0. Rows upsert by natural key (metric_key) so reruns are no-ops.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { kpiTargets, users } from "../../drizzle/schema";

interface KpiDef {
  metricKey: string;
  label: string;
  unit: string;
  query: string; // must return a single numeric column "v"
}

const KPIS: KpiDef[] = [
  {
    metricKey: "seed.declarations.total",
    label: "Total customs declarations (seeded, trailing 90 days)",
    unit: "count",
    query: `SELECT COUNT(*)::numeric AS v FROM declarations`,
  },
  {
    metricKey: "seed.declarations.clearance_rate_pct",
    label: "Declaration clearance rate (seeded)",
    unit: "percent",
    query: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'cleared') / NULLIF(COUNT(*), 0), 2) AS v FROM declarations`,
  },
  {
    metricKey: "seed.revenue.collected_ngn",
    label: "Duty/tax revenue collected via confirmed payments, NGN (seeded; stored amounts are kobo)",
    unit: "NGN",
    query: `SELECT COALESCE(SUM(amount) / 100.0, 0)::numeric AS v FROM payments WHERE status = 'confirmed' AND currency = 'NGN'`,
  },
  {
    metricKey: "seed.vessels.tracked",
    label: "Distinct vessels with tracking events (seeded)",
    unit: "count",
    query: `SELECT COUNT(DISTINCT mmsi)::numeric AS v FROM vessel_tracking_events`,
  },
  {
    metricKey: "seed.port_calls.total",
    label: "Recorded port calls / MSW visits (seeded)",
    unit: "count",
    query: `SELECT COUNT(*)::numeric AS v FROM msw_visits`,
  },
  {
    metricKey: "seed.oga_permits.approval_rate_pct",
    label: "OGA permit approval rate (seeded)",
    unit: "percent",
    query: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'approved') / NULLIF(COUNT(*), 0), 2) AS v FROM oga_permits`,
  },
  {
    metricKey: "seed.kyc.approval_rate_pct",
    label: "KYC verification approval rate (seeded)",
    unit: "percent",
    query: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'APPROVED') / NULLIF(COUNT(*), 0), 2) AS v FROM kyc_verifications`,
  },
  {
    metricKey: "seed.payments.confirmation_rate_pct",
    label: "Payment confirmation rate (seeded)",
    unit: "percent",
    query: `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'confirmed') / NULLIF(COUNT(*), 0), 2) AS v FROM payments`,
  },
];

export async function seedDerivedKpis(db: NodePgDatabase<any>): Promise<number> {
  const admin = await db
    .select({ id: users.id })
    .from(users)
    .limit(1);
  const updatedBy = admin[0]?.id ?? null;
  let inserted = 0;
  for (const kpi of KPIS) {
    const res = await db.execute(sql.raw(kpi.query));
    const raw = (res.rows[0] as { v: string | null }).v;
    const value = raw ?? "0";
    const r = await db
      .insert(kpiTargets)
      .values({
        metricKey: kpi.metricKey,
        label: kpi.label,
        targetValue: value,
        unit: kpi.unit,
        updatedBy,
      })
      .onConflictDoNothing();
    inserted += (r as unknown as { rowCount?: number }).rowCount ?? 0;
    console.log(`[seed/kpi] ${kpi.metricKey} = ${value}`);
  }
  return inserted;
}
