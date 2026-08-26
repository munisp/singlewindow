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
    if (!res.ok) {
      console.warn("[cost] upstream cost service returned a non-success response; using database fallback", {
        path,
        status: res.status,
      });
      return null;
    }
    return res.json() as Promise<T>;
  } catch (error) {
    console.warn("[cost] upstream cost service unavailable; using database fallback", {
      path,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function pgQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  await getDb();
  const pool = getPool();
  if (!pool) throw new Error("Database pool not available");
  const { rows } = await pool.query(sql, params);
  return rows as T[];
}

export const costRouter = router({

  getTenantCosts: protectedProcedure
    .input(z.object({ period: z.enum(["day", "week", "month"]).default("month") }))
    .query(async ({ input }) => {
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
