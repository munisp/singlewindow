/**
 * executive/portPerformance.ts — NPA-style port performance report
 * (Phase 16 Wave P2), consumed by the ministry portal Port Performance page.
 *
 * Contract (frontend: blueeconomy-ministry-portal src/kpi-client.ts):
 *   PortPerformanceReport {
 *     generated_at, period: "weekly"|"monthly"|"quarterly",
 *     period_start, period_end,
 *     metrics: { cargo_throughput_tonnes, vessel_calls, teu_in, teu_out,
 *                transshipment_volume_teu, export_tonnes, import_tonnes }
 *   }
 *   PortPerformanceMetric { source: string, value: number|null,
 *                           delta_pct: number|null, unit: string }
 *
 * FAIL-CLOSED / REAL DATA ONLY:
 *  - every aggregate is real SQL against existing singlewindow tables;
 *  - a period with no contributing rows yields value:null (honest empty
 *    state) — never a fabricated zero or placeholder;
 *  - delta_pct is the period-over-period change vs the immediately
 *    preceding equal-length window; null unless both legs have data and the
 *    previous leg is non-zero (division by zero is never fudged);
 *  - teu_out has no aggregate source on the platform today (the
 *    port-interoperability gate surface exposes no gate-move aggregate): it
 *    is served value:null with the source naming the missing upstream
 *    (PORT_INTEROP_URL-gated), never guessed;
 *  - DB outage throws KpiPackUnavailable → the route answers 503.
 *
 * Metric → source mapping (source strings are emitted verbatim):
 *  cargo_throughput_tonnes   ← sum(bills_of_lading.weight_kg)/1000 ⋈ manifests (ata in period)
 *  vessel_calls              ← count(manifests) where manifest_type='SEA' and ata in period
 *  teu_in                    ← sum(container count) of BLs on manifests arrived (ata) in period
 *  teu_out                   ← port-interoperability gate-out moves (unavailable → null)
 *  transshipment_volume_teu  ← sum(container count) of BLs on outbound manifests
 *                              linked via transshipment_links created in period
 *  export_tonnes             ← sum(declarations.gross_weight)/1000, type 'export', submitted in period
 *  import_tonnes             ← sum(declarations.gross_weight)/1000, type 'import', submitted in period
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { KpiPackUnavailable } from "./kpiPack";

export type PortPerformancePeriod = "weekly" | "monthly" | "quarterly";

export const PORT_PERFORMANCE_PERIODS: readonly PortPerformancePeriod[] = [
  "weekly",
  "monthly",
  "quarterly",
];

const PERIOD_DAYS: Record<PortPerformancePeriod, number> = {
  weekly: 7,
  monthly: 30,
  quarterly: 91,
};

export function isPortPerformancePeriod(raw: unknown): raw is PortPerformancePeriod {
  return raw === "weekly" || raw === "monthly" || raw === "quarterly";
}

export interface PortPerformanceMetric {
  source: string;
  value: number | null;
  delta_pct: number | null;
  unit: string;
}

export interface PortPerformanceReport {
  generated_at: string;
  period: PortPerformancePeriod;
  period_start: string;
  period_end: string;
  metrics: {
    cargo_throughput_tonnes: PortPerformanceMetric;
    vessel_calls: PortPerformanceMetric;
    teu_in: PortPerformanceMetric;
    teu_out: PortPerformanceMetric;
    transshipment_volume_teu: PortPerformanceMetric;
    export_tonnes: PortPerformanceMetric;
    import_tonnes: PortPerformanceMetric;
  };
}

/** One windowed aggregate from one real source. rows=0 → honest empty. */
export interface WindowedAggregate {
  value: number;
  rows: number;
}

/**
 * Data-source seam: the production implementation is raw SQL against the
 * singlewindow database; tests inject fixtures. Each method returns the
 * aggregate for [from, to] plus the number of contributing rows.
 */
export interface PortPerformanceSource {
  cargoThroughputKg(from: Date, to: Date): Promise<WindowedAggregate>;
  vesselCalls(from: Date, to: Date): Promise<WindowedAggregate>;
  containersIn(from: Date, to: Date): Promise<WindowedAggregate>;
  transshipmentContainers(from: Date, to: Date): Promise<WindowedAggregate>;
  declarationTonnageKg(kind: "import" | "export", from: Date, to: Date): Promise<WindowedAggregate>;
}

const SOURCES = {
  cargo: "singlewindow: sum(bills_of_lading.weight_kg)/1000 joined manifests (ata in period)",
  vesselCalls: "singlewindow: count(manifests) where manifest_type='SEA' and ata in period",
  teuIn: "singlewindow: sum(array_length(bills_of_lading.container_nos,1)) joined manifests (ata in period)",
  transshipment:
    "singlewindow: sum(array_length(bills_of_lading.container_nos,1)) via transshipment_links outbound manifests (created in period)",
  export: "singlewindow: sum(declarations.gross_weight)/1000 where declaration_type='export' (submitted_at in period)",
  import: "singlewindow: sum(declarations.gross_weight)/1000 where declaration_type='import' (submitted_at in period)",
} as const;

/** teu_out has no real aggregate source on the platform; the source string names that gap. */
export function teuOutSourceName(): string {
  const configured = Boolean((process.env.PORT_INTEROP_URL ?? "").trim());
  return configured
    ? "port-interoperability: terminal gate-out moves (PORT_INTEROP_URL configured; gate-move aggregate endpoint not available)"
    : "port-interoperability: terminal gate-out moves (PORT_INTEROP_URL not configured)";
}

async function aggregateOf(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  valueSql: ReturnType<typeof sql>
): Promise<WindowedAggregate> {
  const [row] = (await db.execute(sql`
    SELECT COALESCE(agg.v, 0)::float8 AS value, COALESCE(agg.n, 0)::int AS rows
    FROM (${valueSql}) agg
  `)) as unknown as Array<{ value: number; rows: number }>;
  return { value: Number(row?.value ?? 0), rows: Number(row?.rows ?? 0) };
}

/** Production source: real SQL against the singlewindow schema. */
export function sqlPortPerformanceSource(): PortPerformanceSource {
  return {
    async cargoThroughputKg(from, to) {
      const db = await getDb();
      if (!db) throw new KpiPackUnavailable("Database unavailable — port performance report cannot be computed (fail-closed)");
      return aggregateOf(
        db,
        sql`SELECT sum(bl.weight_kg::numeric) AS v, count(*) AS n
            FROM bills_of_lading bl JOIN manifests m ON m.id = bl.manifest_id
            WHERE m.ata IS NOT NULL AND m.ata >= ${from} AND m.ata <= ${to} AND bl.weight_kg IS NOT NULL`,
      );
    },
    async vesselCalls(from, to) {
      const db = await getDb();
      if (!db) throw new KpiPackUnavailable("Database unavailable — port performance report cannot be computed (fail-closed)");
      return aggregateOf(
        db,
        sql`SELECT count(*) AS v, count(*) AS n FROM manifests
            WHERE manifest_type = 'SEA' AND ata IS NOT NULL AND ata >= ${from} AND ata <= ${to}`,
      );
    },
    async containersIn(from, to) {
      const db = await getDb();
      if (!db) throw new KpiPackUnavailable("Database unavailable — port performance report cannot be computed (fail-closed)");
      return aggregateOf(
        db,
        sql`SELECT sum(array_length(bl.container_nos, 1)) AS v, count(*) AS n
            FROM bills_of_lading bl JOIN manifests m ON m.id = bl.manifest_id
            WHERE m.ata IS NOT NULL AND m.ata >= ${from} AND m.ata <= ${to} AND bl.container_nos IS NOT NULL`,
      );
    },
    async transshipmentContainers(from, to) {
      const db = await getDb();
      if (!db) throw new KpiPackUnavailable("Database unavailable — port performance report cannot be computed (fail-closed)");
      return aggregateOf(
        db,
        sql`SELECT sum(array_length(bl.container_nos, 1)) AS v, count(DISTINCT tl.id) AS n
            FROM transshipment_links tl
            JOIN bills_of_lading bl ON bl.manifest_id = tl.outbound_manifest_id
            WHERE tl.created_at >= ${from} AND tl.created_at <= ${to} AND bl.container_nos IS NOT NULL`,
      );
    },
    async declarationTonnageKg(kind, from, to) {
      const db = await getDb();
      if (!db) throw new KpiPackUnavailable("Database unavailable — port performance report cannot be computed (fail-closed)");
      return aggregateOf(
        db,
        sql`SELECT sum(gross_weight::numeric) AS v, count(*) AS n FROM declarations
            WHERE declaration_type = ${kind} AND gross_weight IS NOT NULL
              AND submitted_at IS NOT NULL AND submitted_at >= ${from} AND submitted_at <= ${to}`,
      );
    },
  };
}

/** Period-over-period delta in percent; null unless both legs are real and prev ≠ 0. */
export function computeDeltaPct(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function toMetric(
  agg: WindowedAggregate,
  prev: WindowedAggregate,
  source: string,
  unit: string,
  scale = 1
): PortPerformanceMetric {
  const value = agg.rows > 0 ? Math.round((agg.value / scale) * 100) / 100 : null;
  const previous = prev.rows > 0 ? prev.value / scale : null;
  return { source, value, delta_pct: computeDeltaPct(value, previous), unit };
}

export interface ComputeOptions {
  source?: PortPerformanceSource;
  now?: Date;
}

/** Compute the port performance report for a period (fail-closed). */
export async function computePortPerformanceReport(
  period: PortPerformancePeriod,
  opts: ComputeOptions = {}
): Promise<PortPerformanceReport> {
  if (!isPortPerformancePeriod(period)) {
    throw new KpiPackUnavailable(`Unknown port performance period: ${String(period)}`);
  }
  const source = opts.source ?? sqlPortPerformanceSource();
  const now = opts.now ?? new Date();
  const days = PERIOD_DAYS[period];
  const to = now;
  const from = new Date(to.getTime() - days * 86_400_000);
  const prevFrom = new Date(from.getTime() - days * 86_400_000);

  const [
    cargoNow, cargoPrev,
    callsNow, callsPrev,
    teuInNow, teuInPrev,
    tsNow, tsPrev,
    expNow, expPrev,
    impNow, impPrev,
  ] = await Promise.all([
    source.cargoThroughputKg(from, to), source.cargoThroughputKg(prevFrom, from),
    source.vesselCalls(from, to), source.vesselCalls(prevFrom, from),
    source.containersIn(from, to), source.containersIn(prevFrom, from),
    source.transshipmentContainers(from, to), source.transshipmentContainers(prevFrom, from),
    source.declarationTonnageKg("export", from, to), source.declarationTonnageKg("export", prevFrom, from),
    source.declarationTonnageKg("import", from, to), source.declarationTonnageKg("import", prevFrom, from),
  ]);

  return {
    generated_at: to.toISOString(),
    period,
    period_start: from.toISOString(),
    period_end: to.toISOString(),
    metrics: {
      cargo_throughput_tonnes: toMetric(cargoNow, cargoPrev, SOURCES.cargo, "tonnes", 1000),
      vessel_calls: toMetric(callsNow, callsPrev, SOURCES.vesselCalls, "calls"),
      teu_in: toMetric(teuInNow, teuInPrev, SOURCES.teuIn, "TEU"),
      // FAIL-CLOSED: no real gate-out aggregate exists on the platform; the
      // metric is served null with the source naming the missing upstream.
      teu_out: { source: teuOutSourceName(), value: null, delta_pct: null, unit: "TEU" },
      transshipment_volume_teu: toMetric(tsNow, tsPrev, SOURCES.transshipment, "TEU"),
      export_tonnes: toMetric(expNow, expPrev, SOURCES.export, "tonnes", 1000),
      import_tonnes: toMetric(impNow, impPrev, SOURCES.import, "tonnes", 1000),
    },
  };
}
