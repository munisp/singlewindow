/**
 * WP-8 — Operational KPI computation (pure, unit-testable core).
 *
 * Binding rules:
 *  - Every KPI is computed from REAL platform rows (declarations, oga_permits,
 *    payments, vessel_tracking_events). No fabricated metrics.
 *  - Every KPI carries provenance: source tables, sample size n, time window,
 *    and computation timestamp.
 *  - When n is below the per-KPI minimum the KPI reports INSUFFICIENT_DATA —
 *    never zeros-as-real.
 *  - Estimates (paper-visit avoidance) carry an explicit methodology label.
 */

export type KpiStatus = "OK" | "INSUFFICIENT_DATA";

export interface KpiProvenance {
  sources: string[];
  n: number;
  computedAt: string;
}

export interface KpiBase {
  id: string;
  label: string;
  unit: string;
  classification: "PUBLIC";
  window: { from: string; to: string };
  status: KpiStatus;
  minSampleSize: number;
  provenance: KpiProvenance;
  methodology?: string;
}

export interface ScalarKpi extends KpiBase {
  kind: "scalar";
  value: number | null;
}

export interface PercentileKpi extends KpiBase {
  kind: "percentiles";
  value: { p50: number; p90: number; p95: number; mean: number } | null;
}

export interface BreakdownKpi extends KpiBase {
  kind: "breakdown";
  value: Record<string, number> | null;
}

export type Kpi = ScalarKpi | PercentileKpi | BreakdownKpi;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Nearest-rank percentile on an ascending-sorted array. p in (0,100]. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error("percentile of empty set");
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  return sortedAsc[Math.min(sortedAsc.length, Math.max(1, rank)) - 1];
}

export interface WindowSpec {
  from: Date;
  to: Date;
}

const windowOf = (w: WindowSpec) => ({ from: w.from.toISOString(), to: w.to.toISOString() });

function baseKpi(
  partial: Omit<KpiBase, "window" | "provenance" | "classification">,
  w: WindowSpec,
  provenance: KpiProvenance
): KpiBase {
  return { ...partial, classification: "PUBLIC", window: windowOf(w), provenance };
}

// ─── 1. Clearance time percentiles ───────────────────────────────────────────

export interface ClearanceRow {
  submittedAt: Date;
  clearedAt: Date;
}

export const CLEARANCE_MIN_N = 5;

export function computeClearanceTimePercentiles(
  rows: ClearanceRow[],
  w: WindowSpec,
  computedAt: Date
): PercentileKpi {
  const hours = rows
    .map((r) => (r.clearedAt.getTime() - r.submittedAt.getTime()) / 3_600_000)
    .filter((h) => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const n = hours.length;
  const base = baseKpi(
    {
      id: "clearance_time_hours",
      label: "Declaration clearance time (submission → clearance)",
      unit: "hours",
      status: n >= CLEARANCE_MIN_N ? "OK" : "INSUFFICIENT_DATA",
      minSampleSize: CLEARANCE_MIN_N,
    },
    w,
    { sources: ["declarations.submitted_at", "declarations.cleared_at"], n, computedAt: computedAt.toISOString() }
  );
  if (n < CLEARANCE_MIN_N) return { ...base, kind: "percentiles", value: null };
  return {
    ...base,
    kind: "percentiles",
    value: {
      p50: percentile(hours, 50),
      p90: percentile(hours, 90),
      p95: percentile(hours, 95),
      mean: hours.reduce((a, b) => a + b, 0) / n,
    },
  };
}

// ─── 2. Permits per hour ─────────────────────────────────────────────────────

export const PERMITS_MIN_N = 1;

export function computePermitsPerHour(
  respondedPermitCount: number,
  w: WindowSpec,
  computedAt: Date
): ScalarKpi {
  const windowHours = Math.max((w.to.getTime() - w.from.getTime()) / 3_600_000, 1e-9);
  const n = respondedPermitCount;
  const ok = n >= PERMITS_MIN_N;
  return {
    ...baseKpi(
      {
        id: "permits_per_hour",
        label: "OGA permits processed per hour",
        unit: "permits/hour",
        status: ok ? "OK" : "INSUFFICIENT_DATA",
        minSampleSize: PERMITS_MIN_N,
      },
      w,
      { sources: ["oga_permits.responded_at"], n, computedAt: computedAt.toISOString() }
    ),
    kind: "scalar",
    value: ok ? n / windowHours : null,
  };
}

// ─── 3. Declarations by risk lane ────────────────────────────────────────────

export const LANES_MIN_N = 1;

export function computeDeclarationsByLane(
  laneCounts: Record<string, number>,
  w: WindowSpec,
  computedAt: Date
): BreakdownKpi {
  const n = Object.values(laneCounts).reduce((a, b) => a + b, 0);
  const ok = n >= LANES_MIN_N;
  return {
    ...baseKpi(
      {
        id: "declarations_by_lane",
        label: "Declarations submitted by risk lane",
        unit: "declarations",
        status: ok ? "OK" : "INSUFFICIENT_DATA",
        minSampleSize: LANES_MIN_N,
      },
      w,
      { sources: ["declarations.risk_lane", "declarations.submitted_at"], n, computedAt: computedAt.toISOString() }
    ),
    kind: "breakdown",
    value: ok ? { green: 0, yellow: 0, red: 0, ...laneCounts } : null,
  };
}

// ─── 4. Paper-visit avoidance (estimation, clearly labelled) ─────────────────

/**
 * Methodology: each electronically submitted supporting document is estimated
 * to avoid 0.5 physical counter visits (industry rule-of-thumb used by
 * TradeNet-style single windows: a typical declaration pack of ~2 documents
 * would otherwise require one physical lodgement visit). This is an ESTIMATE,
 * not a measurement, and is labelled as such wherever published.
 */
export const PAPER_AVOIDANCE_METHODOLOGY =
  "ESTIMATE: electronic_documents × 0.5 visits/document. Rule-of-thumb: a typical 2-document declaration pack otherwise requires one physical lodgement visit. Not a measured value.";
export const PAPER_MIN_N = 1;

export function computePaperVisitAvoidance(
  electronicDocumentCount: number,
  w: WindowSpec,
  computedAt: Date
): ScalarKpi {
  const n = electronicDocumentCount;
  const ok = n >= PAPER_MIN_N;
  return {
    ...baseKpi(
      {
        id: "paper_visits_avoided",
        label: "Estimated physical counter visits avoided (e-lodgement)",
        unit: "visits (estimated)",
        status: ok ? "OK" : "INSUFFICIENT_DATA",
        minSampleSize: PAPER_MIN_N,
        methodology: PAPER_AVOIDANCE_METHODOLOGY,
      },
      w,
      { sources: ["declaration_documents.created_at"], n, computedAt: computedAt.toISOString() }
    ),
    kind: "scalar",
    value: ok ? Math.round(n * 0.5 * 100) / 100 : null,
  };
}

// ─── 5. Payment volumes ──────────────────────────────────────────────────────

export const PAYMENTS_MIN_N = 1;

export function computePaymentVolumes(
  volumeByCurrency: Record<string, number>,
  paymentCount: number,
  w: WindowSpec,
  computedAt: Date
): BreakdownKpi {
  const ok = paymentCount >= PAYMENTS_MIN_N;
  return {
    ...baseKpi(
      {
        id: "payment_volume",
        label: "Confirmed duty payment volume",
        unit: "currency units",
        status: ok ? "OK" : "INSUFFICIENT_DATA",
        minSampleSize: PAYMENTS_MIN_N,
      },
      w,
      { sources: ["payments.amount", "payments.currency", "payments.confirmed_at"], n: paymentCount, computedAt: computedAt.toISOString() }
    ),
    kind: "breakdown",
    value: ok ? volumeByCurrency : null,
  };
}

// ─── 6. Integration feed freshness ───────────────────────────────────────────

export interface FeedFreshnessInput {
  feedId: string;
  /** newest event observed for this feed, or null when no events exist */
  lastEventAt: Date | null;
  eventCount: number;
}

export function computeFeedFreshness(
  feeds: FeedFreshnessInput[],
  w: WindowSpec,
  computedAt: Date
): BreakdownKpi {
  const value: Record<string, number> = {};
  let n = 0;
  for (const f of feeds) {
    if (f.lastEventAt) {
      value[f.feedId] = Math.round((computedAt.getTime() - f.lastEventAt.getTime()) / 1000);
      n += f.eventCount;
    } else {
      value[f.feedId] = -1; // -1 = no events ever observed (honest unknown-age)
    }
  }
  const ok = feeds.length > 0;
  return {
    ...baseKpi(
      {
        id: "feed_freshness_seconds",
        label: "Integration feed staleness (seconds since last event; -1 = no events)",
        unit: "seconds",
        status: ok ? "OK" : "INSUFFICIENT_DATA",
        minSampleSize: 1,
      },
      w,
      { sources: ["vessel_tracking_events.created_at"], n, computedAt: computedAt.toISOString() }
    ),
    kind: "breakdown",
    value: ok ? value : null,
  };
}
