/**
 * Sprint 49 — Kubecost Per-Tenant Cost Allocation Router
 * Connects to kubecost-svc (Go, port 8105) or falls back to mock data.
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

const KUBECOST_SVC = process.env.KUBECOST_SVC_URL ?? "http://localhost:8105";

async function costFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${KUBECOST_SVC}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`kubecost-svc ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_TENANT_COSTS = [
  {
    tenant_id: "gha-001",
    tenant_name: "Ghana Revenue Authority",
    namespace: "tradegateway-gha",
    plan: "enterprise",
    period: "2025-02",
    cpu_cost_usd: 142.50,
    memory_cost_usd: 89.20,
    storage_cost_usd: 34.10,
    network_cost_usd: 12.80,
    total_cost_usd: 278.60,
    idle_cost_usd: 18.40,
    efficiency_pct: 93.4,
  },
  {
    tenant_id: "rwa-001",
    tenant_name: "Rwanda Revenue Authority",
    namespace: "tradegateway-rwa",
    plan: "standard",
    period: "2025-02",
    cpu_cost_usd: 68.30,
    memory_cost_usd: 41.10,
    storage_cost_usd: 18.90,
    network_cost_usd: 6.40,
    total_cost_usd: 134.70,
    idle_cost_usd: 22.10,
    efficiency_pct: 83.6,
  },
  {
    tenant_id: "sgp-001",
    tenant_name: "Singapore Customs",
    namespace: "tradegateway-sgp",
    plan: "enterprise",
    period: "2025-02",
    cpu_cost_usd: 198.70,
    memory_cost_usd: 124.50,
    storage_cost_usd: 52.30,
    network_cost_usd: 18.90,
    total_cost_usd: 394.40,
    idle_cost_usd: 11.20,
    efficiency_pct: 97.2,
  },
];

const MOCK_IDLE_RESOURCES = [
  {
    namespace: "tradegateway-rwa",
    resource_type: "Deployment",
    resource_name: "asean-sw-service",
    idle_cpu_cores: 0.4,
    idle_memory_gb: 0.8,
    idle_cost_usd_per_day: 3.20,
    recommendation: "Scale down replicas from 3 to 1 during off-peak hours",
  },
  {
    namespace: "tradegateway-gha",
    resource_type: "PersistentVolumeClaim",
    resource_name: "rustfs-data-pvc",
    idle_cpu_cores: 0,
    idle_memory_gb: 0,
    idle_cost_usd_per_day: 1.80,
    recommendation: "Reduce PVC size from 50Gi to 20Gi — only 8Gi used",
  },
];

const MOCK_COST_TREND = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  return {
    date: d.toISOString().slice(0, 10),
    total_cost_usd: 720 + Math.sin(i / 5) * 40 + Math.random() * 20,
    cpu_cost_usd: 380 + Math.sin(i / 5) * 20,
    memory_cost_usd: 220 + Math.sin(i / 5) * 10,
    storage_cost_usd: 90 + i * 0.5,
    network_cost_usd: 30 + Math.random() * 5,
  };
});

// ─── Router ────────────────────────────────────────────────────────────────────

export const costRouter = router({
  /** Per-tenant cost breakdown for a billing period */
  getTenantCosts: protectedProcedure
    .input(
      z.object({
        period: z.string().default("2025-02"), // YYYY-MM
      })
    )
    .query(async ({ input }) => {
      try {
        return await costFetch<typeof MOCK_TENANT_COSTS>(`/costs/tenants?period=${input.period}`);
      } catch {
        return MOCK_TENANT_COSTS;
      }
    }),

  /** Chargeback report: cost per tenant per plan tier */
  getChargebackReport: protectedProcedure
    .input(
      z.object({
        period: z.string().default("2025-02"),
      })
    )
    .query(async ({ input }) => {
      try {
        return await costFetch<{
          period: string;
          total_cluster_cost_usd: number;
          tenants: typeof MOCK_TENANT_COSTS;
        }>(`/costs/chargeback?period=${input.period}`);
      } catch {
        const total = MOCK_TENANT_COSTS.reduce((s, t) => s + t.total_cost_usd, 0);
        return {
          period: input.period,
          total_cluster_cost_usd: total,
          tenants: MOCK_TENANT_COSTS,
        };
      }
    }),

  /** Idle resource detection and rightsizing recommendations */
  getIdleResources: protectedProcedure.query(async () => {
    try {
      return await costFetch<typeof MOCK_IDLE_RESOURCES>("/costs/idle");
    } catch {
      return MOCK_IDLE_RESOURCES;
    }
  }),

  /** Cost trend over the last N days across the entire cluster */
  getCostTrend: protectedProcedure
    .input(
      z.object({
        days: z.number().min(7).max(90).default(30),
      })
    )
    .query(async ({ input }) => {
      try {
        return await costFetch<typeof MOCK_COST_TREND>(`/costs/trend?days=${input.days}`);
      } catch {
        return MOCK_COST_TREND.slice(-input.days);
      }
    }),

  /** Cluster-level cost summary */
  getClusterSummary: protectedProcedure.query(async () => {
    try {
      return await costFetch<{
        total_cost_usd: number;
        cpu_cost_usd: number;
        memory_cost_usd: number;
        storage_cost_usd: number;
        network_cost_usd: number;
        idle_cost_usd: number;
        efficiency_pct: number;
        active_tenants: number;
      }>("/costs/summary");
    } catch {
      const totals = MOCK_TENANT_COSTS.reduce(
        (acc, t) => ({
          total: acc.total + t.total_cost_usd,
          cpu: acc.cpu + t.cpu_cost_usd,
          memory: acc.memory + t.memory_cost_usd,
          storage: acc.storage + t.storage_cost_usd,
          network: acc.network + t.network_cost_usd,
          idle: acc.idle + t.idle_cost_usd,
        }),
        { total: 0, cpu: 0, memory: 0, storage: 0, network: 0, idle: 0 }
      );
      return {
        total_cost_usd: totals.total,
        cpu_cost_usd: totals.cpu,
        memory_cost_usd: totals.memory,
        storage_cost_usd: totals.storage,
        network_cost_usd: totals.network,
        idle_cost_usd: totals.idle,
        efficiency_pct: 91.4,
        active_tenants: MOCK_TENANT_COSTS.length,
      };
    }
  }),

  /** Service health */
  getServiceStatus: protectedProcedure.query(async () => {
    try {
      const data = await costFetch<{ status: string }>("/health");
      return { online: data.status === "ok", ...data };
    } catch {
      return { online: false, status: "unavailable", note: "kubecost-svc not reachable — using mock data" };
    }
  }),
});
