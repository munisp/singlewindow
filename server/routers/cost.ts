/**
 * Cost/FinOps Router — DB-backed (v37)
 * Table: cost_records
 */
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb, getPool } from "../db";

const COST_SERVICE_URL = process.env.COST_SERVICE_URL ?? "http://localhost:8097";

async function costFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${COST_SERVICE_URL}${path}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch { return null; }
}

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("Database pool not available");
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

async function ensureCostSeed() {
  const [{ cnt }] = await pgQuery<{ cnt: string }>("SELECT COUNT(*) as cnt FROM cost_records");
  if (parseInt(cnt, 10) > 0) return;
  const services = [
    { tenant: "customs-authority", ns: "customs", svc: "declaration-engine", cat: "compute", compute: 320, storage: 45, network: 28 },
    { tenant: "customs-authority", ns: "customs", svc: "risk-ai-engine", cat: "compute", compute: 480, storage: 80, network: 35 },
    { tenant: "customs-authority", ns: "customs", svc: "workflow-engine", cat: "compute", compute: 180, storage: 30, network: 20 },
    { tenant: "port-authority", ns: "port", svc: "cargo-tracking", cat: "compute", compute: 240, storage: 60, network: 45 },
    { tenant: "port-authority", ns: "port", svc: "vessel-ais", cat: "network", compute: 120, storage: 20, network: 90 },
    { tenant: "revenue-authority", ns: "revenue", svc: "payment-gateway", cat: "compute", compute: 200, storage: 40, network: 30 },
    { tenant: "platform", ns: "infra", svc: "postgresql", cat: "database", compute: 280, storage: 150, network: 15 },
    { tenant: "platform", ns: "infra", svc: "redis-cache", cat: "database", compute: 80, storage: 40, network: 10 },
    { tenant: "platform", ns: "monitoring", svc: "prometheus-grafana", cat: "monitoring", compute: 90, storage: 120, network: 8 },
    { tenant: "platform", ns: "security", svc: "wazuh-siem", cat: "security", compute: 160, storage: 200, network: 12 },
  ];
  const now = new Date();
  for (let d = 29; d >= 0; d--) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    const dateStr = date.toISOString().substring(0, 10);
    for (const s of services) {
      const jitter = 0.85 + Math.random() * 0.3;
      const compute = Math.round(s.compute * jitter);
      const storage = Math.round(s.storage * jitter);
      const network = Math.round(s.network * jitter);
      await pgQuery(
        `INSERT INTO cost_records
          (tenant_name, namespace, service, category, period_date,
           compute_cost_usd, storage_cost_usd, network_cost_usd, total_cost_usd,
           cpu_request_millicores, memory_request_mib, efficiency, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT DO NOTHING`,
        [s.tenant, s.ns, s.svc, s.cat, dateStr,
         compute, storage, network, compute + storage + network,
         Math.round(500 + Math.random() * 1500),
         Math.round(512 + Math.random() * 3584),
         Math.round(55 + Math.random() * 35)]
      );
    }
  }
}

export const costRouter = router({

  getTenantCosts: protectedProcedure
    .input(z.object({ period: z.enum(["day", "week", "month"]).default("month") }))
    .query(async ({ input }) => {
      await ensureCostSeed();
      const live = await costFetch<unknown[]>(`/costs/tenants?period=${input.period}`);
      if (live) return live;
      const days = input.period === "day" ? 1 : input.period === "week" ? 7 : 30;
      const rows = await pgQuery(
        `SELECT tenant_name,
          SUM(compute_cost_usd) AS compute_cost_usd,
          SUM(storage_cost_usd) AS storage_cost_usd,
          SUM(network_cost_usd) AS network_cost_usd,
          SUM(total_cost_usd) AS total_cost_usd,
          ROUND(AVG(efficiency)) AS avg_efficiency
         FROM cost_records
         WHERE period_date >= CURRENT_DATE - INTERVAL '1 day' * $1
         GROUP BY tenant_name
         ORDER BY total_cost_usd DESC`,
        [days]
      );
      const total = (rows as { total_cost_usd: number }[]).reduce((s, r) => s + Number(r.total_cost_usd), 0);
      return { tenants: rows, total_cost_usd: total, period: input.period };
    }),

  getCostTrend: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      await ensureCostSeed();
      const live = await costFetch<unknown[]>(`/costs/trend?days=${input.days}`);
      if (live) return live;
      return pgQuery(
        `SELECT period_date,
          SUM(compute_cost_usd) AS compute_cost_usd,
          SUM(storage_cost_usd) AS storage_cost_usd,
          SUM(network_cost_usd) AS network_cost_usd,
          SUM(total_cost_usd) AS total_cost_usd
         FROM cost_records
         WHERE period_date >= CURRENT_DATE - INTERVAL '1 day' * $1
         GROUP BY period_date
         ORDER BY period_date ASC`,
        [input.days]
      );
    }),

  getIdleResources: protectedProcedure.query(async () => {
    const live = await costFetch<unknown[]>("/costs/idle");
    if (live) return live;
    return pgQuery(
      `SELECT tenant_name, namespace, service, category,
        ROUND(AVG(efficiency)) AS avg_efficiency,
        SUM(total_cost_usd) AS wasted_cost_usd,
        SUM(cpu_request_millicores) AS cpu_request_millicores,
        SUM(memory_request_mib) AS memory_request_mib
       FROM cost_records
       WHERE period_date >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY tenant_name, namespace, service, category
       HAVING AVG(efficiency) < 40
       ORDER BY wasted_cost_usd DESC`
    );
  }),

  getCostSummary: protectedProcedure.query(async () => {
    await ensureCostSeed();
    const [month, prevMonth, byCategory] = await Promise.all([
      pgQuery(
        `SELECT SUM(total_cost_usd) AS total, SUM(compute_cost_usd) AS compute,
                SUM(storage_cost_usd) AS storage, SUM(network_cost_usd) AS network,
                ROUND(AVG(efficiency)) AS avg_efficiency
         FROM cost_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days'`
      ),
      pgQuery<{ total: string }>(
        `SELECT SUM(total_cost_usd) AS total FROM cost_records
         WHERE period_date >= CURRENT_DATE - INTERVAL '60 days'
           AND period_date < CURRENT_DATE - INTERVAL '30 days'`
      ),
      pgQuery(
        `SELECT category, SUM(total_cost_usd) AS total
         FROM cost_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY category ORDER BY total DESC`
      ),
    ]);
    const curr = Number((month as { total: number }[])[0]?.total ?? 0);
    const prev = Number(prevMonth[0]?.total ?? 1);
    return {
      current_month: month[0],
      prev_month_total: prev,
      mom_change_pct: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0,
      by_category: byCategory,
    };
  }),

  recordCost: adminProcedure
    .input(z.object({
      tenantName: z.string(),
      namespace: z.string(),
      service: z.string(),
      category: z.enum(["compute", "storage", "network", "database", "monitoring", "security", "other"]),
      periodDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      computeCostUsd: z.number().min(0).default(0),
      storageCostUsd: z.number().min(0).default(0),
      networkCostUsd: z.number().min(0).default(0),
      cpuRequestMillicores: z.number().optional(),
      memoryRequestMib: z.number().optional(),
      efficiency: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      const total = input.computeCostUsd + input.storageCostUsd + input.networkCostUsd;
      await pgQuery(
        `INSERT INTO cost_records
          (tenant_name, namespace, service, category, period_date,
           compute_cost_usd, storage_cost_usd, network_cost_usd, total_cost_usd,
           cpu_request_millicores, memory_request_mib, efficiency, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
        [input.tenantName, input.namespace, input.service, input.category, input.periodDate,
         input.computeCostUsd, input.storageCostUsd, input.networkCostUsd, total,
         input.cpuRequestMillicores ?? null, input.memoryRequestMib ?? null, input.efficiency ?? null]
      );
      return { success: true, total };
    }),

  // Alias: UI calls getClusterSummary
  getClusterSummary: protectedProcedure.query(async () => {
    await ensureCostSeed();
    const [month, prevMonth, byCategory] = await Promise.all([
      pgQuery(
        `SELECT SUM(total_cost_usd) AS total, SUM(compute_cost_usd) AS compute,
                SUM(storage_cost_usd) AS storage, SUM(network_cost_usd) AS network,
                ROUND(AVG(efficiency)) AS avg_efficiency
         FROM cost_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days'`
      ),
      pgQuery<{ total: string }>(
        `SELECT SUM(total_cost_usd) AS total FROM cost_records
         WHERE period_date >= CURRENT_DATE - INTERVAL '60 days'
           AND period_date < CURRENT_DATE - INTERVAL '30 days'`
      ),
      pgQuery(
        `SELECT category, SUM(total_cost_usd) AS total
         FROM cost_records WHERE period_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY category ORDER BY total DESC`
      ),
    ]);
    const curr = Number((month as any[])[0]?.total ?? 0);
    const prev = Number(prevMonth[0]?.total ?? 1);
    return {
      current_month: (month as any[])[0] ?? {},
      prev_month_total: prev,
      mom_change_pct: prev > 0 ? Math.round(((curr - prev) / prev) * 100) : 0,
      by_category: byCategory,
    };
  }),

  getChargebackReport: protectedProcedure
    .input(z.object({ period: z.enum(["day", "week", "month"]).default("month") }))
    .query(async ({ input }) => {
      await ensureCostSeed();
      const days = input.period === "day" ? 1 : input.period === "week" ? 7 : 30;
      return pgQuery(
        `SELECT tenant_name, namespace,
                SUM(total_cost_usd) AS total_cost_usd,
                SUM(compute_cost_usd) AS compute_cost_usd,
                SUM(storage_cost_usd) AS storage_cost_usd,
                SUM(network_cost_usd) AS network_cost_usd,
                ROUND(AVG(efficiency)) AS avg_efficiency,
                COUNT(*) AS record_count
         FROM cost_records
         WHERE period_date >= CURRENT_DATE - INTERVAL '1 day' * $1
         GROUP BY tenant_name, namespace
         ORDER BY total_cost_usd DESC`,
        [days]
      );
    }),

  getServiceStatus: protectedProcedure.query(async () => {
    const [{ cnt }] = await pgQuery<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM cost_records"
    );
    return {
      service: "db",
      records: parseInt(cnt, 10),
      lastCheck: new Date().toISOString(),
    };
  }),
});
