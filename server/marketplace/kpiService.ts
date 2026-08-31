/**
 * WP-8 — KPI service: pulls REAL rows from the platform database and feeds
 * the pure computation core (kpiCompute.ts). Fail-closed: when the database
 * is unavailable the service throws KpiServiceUnavailable (callers respond
 * with an honest 503 "down" state — never zeros-as-real).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  computeClearanceTimePercentiles,
  computeDeclarationsByLane,
  computeFeedFreshness,
  computePaperVisitAvoidance,
  computePaymentVolumes,
  computePermitsPerHour,
  type Kpi,
  type WindowSpec,
} from "./kpiCompute";

export class KpiServiceUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KpiServiceUnavailable";
  }
}

export interface KpiReport {
  reportVersion: "1.0";
  window: { from: string; to: string };
  generatedAt: string;
  kpis: Kpi[];
}

/**
 * Compute the full operational KPI report for a trailing window ending now.
 * @param windowHours trailing window length (default 24h, max 90 days)
 */
export async function computeOperationalKpis(windowHours = 24): Promise<KpiReport> {
  const db = await getDb();
  if (!db) {
    throw new KpiServiceUnavailable("Database unavailable — KPIs cannot be computed (fail-closed)");
  }
  const boundedHours = Math.min(Math.max(windowHours, 1), 24 * 90);
  const computedAt = new Date();
  const w: WindowSpec = {
    to: computedAt,
    from: new Date(computedAt.getTime() - boundedHours * 3_600_000),
  };

  // 1. Clearance rows: declarations submitted & cleared inside the window.
  const clearanceRows = (await db.execute(sql`
    SELECT submitted_at AS "submittedAt", cleared_at AS "clearedAt"
    FROM declarations
    WHERE submitted_at IS NOT NULL AND cleared_at IS NOT NULL
      AND cleared_at >= ${w.from} AND cleared_at <= ${w.to}
  `)) as unknown as Array<{ submittedAt: string | Date; clearedAt: string | Date }>;

  // 2. Permits responded inside the window.
  const permitRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM oga_permits
    WHERE responded_at IS NOT NULL AND responded_at >= ${w.from} AND responded_at <= ${w.to}
  `)) as unknown as Array<{ n: number }>;

  // 3. Declarations by lane submitted inside the window.
  const laneRows = (await db.execute(sql`
    SELECT COALESCE(risk_lane::text, 'unknown') AS lane, count(*)::int AS n
    FROM declarations
    WHERE submitted_at IS NOT NULL AND submitted_at >= ${w.from} AND submitted_at <= ${w.to}
    GROUP BY 1
  `)) as unknown as Array<{ lane: string; n: number }>;

  // 4. Electronic documents lodged inside the window.
  const docRows = (await db.execute(sql`
    SELECT count(*)::int AS n FROM declaration_documents
    WHERE created_at >= ${w.from} AND created_at <= ${w.to}
  `)) as unknown as Array<{ n: number }>;

  // 5. Confirmed payment volumes by currency inside the window.
  const paymentRows = (await db.execute(sql`
    SELECT currency, count(*)::int AS n, COALESCE(sum(amount::numeric), 0)::float8 AS total
    FROM payments
    WHERE confirmed_at IS NOT NULL AND confirmed_at >= ${w.from} AND confirmed_at <= ${w.to}
      AND status = 'confirmed'
    GROUP BY currency
  `)) as unknown as Array<{ currency: string; n: number; total: number }>;

  // 6. Integration feed freshness (AIS geo feed).
  const feedRows = (await db.execute(sql`
    SELECT max(created_at) AS "lastEventAt", count(*)::int AS n
    FROM vessel_tracking_events
  `)) as unknown as Array<{ lastEventAt: string | Date | null; n: number }>;

  const kpis: Kpi[] = [
    computeClearanceTimePercentiles(
      clearanceRows.map((r) => ({ submittedAt: new Date(r.submittedAt), clearedAt: new Date(r.clearedAt) })),
      w,
      computedAt
    ),
    computePermitsPerHour(Number(permitRows[0]?.n ?? 0), w, computedAt),
    computeDeclarationsByLane(
      Object.fromEntries(laneRows.map((r) => [r.lane, Number(r.n)])),
      w,
      computedAt
    ),
    computePaperVisitAvoidance(Number(docRows[0]?.n ?? 0), w, computedAt),
    computePaymentVolumes(
      Object.fromEntries(paymentRows.map((r) => [r.currency, Number(r.total)])),
      paymentRows.reduce((a, r) => a + Number(r.n), 0),
      w,
      computedAt
    ),
    computeFeedFreshness(
      [
        {
          feedId: "ais-vessel-tracking",
          lastEventAt: feedRows[0]?.lastEventAt ? new Date(feedRows[0].lastEventAt) : null,
          eventCount: Number(feedRows[0]?.n ?? 0),
        },
      ],
      w,
      computedAt
    ),
  ];

  return {
    reportVersion: "1.0",
    window: { from: w.from.toISOString(), to: w.to.toISOString() },
    generatedAt: computedAt.toISOString(),
    kpis,
  };
}
