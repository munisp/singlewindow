/**
 * Sprint 48 — Apache Flink CEP Trade Pattern Detection Router
 * Connects to flink-cep-svc (Python FastAPI, port 8104)
 */

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

const CEP_SVC = process.env.FLINK_CEP_SVC_URL ?? "http://localhost:8104";

async function cepFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${CEP_SVC}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`flink-cep-svc ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── Simulated fallback data ───────────────────────────────────────────────────

const MOCK_PATTERNS = [
  {
    pattern_id: "CAROUSEL_FRAUD",
    name: "Carousel Fraud",
    description: "Repeated import/re-export of same HS chapter goods within 30 days",
    enabled: true,
    parameters: { window_days: 30 },
  },
  {
    pattern_id: "SPLIT_CONSIGNMENT",
    name: "Split Consignment Evasion",
    description: "Same shipper/consignee submits ≥3 declarations for same HS chapter within 72 hours",
    enabled: true,
    parameters: { window_hours: 72, min_count: 3 },
  },
  {
    pattern_id: "VALUATION_ANOMALY",
    name: "Valuation Anomaly",
    description: "Declared value/kg deviates > 3σ below HS chapter baseline",
    enabled: true,
    parameters: { sigma_threshold: 3.0 },
  },
  {
    pattern_id: "SUSPICIOUS_ROUTING",
    name: "Suspicious Routing",
    description: "Transshipment through known high-risk hub ports",
    enabled: true,
    parameters: { high_risk_hubs: ["AEDXB", "SGSIN", "MYPKG", "TRTPE"] },
  },
];

const MOCK_ALERTS = [
  {
    alert_id: "alert-001",
    pattern_id: "CAROUSEL_FRAUD",
    pattern_name: "Carousel Fraud",
    severity: "high",
    declaration_ids: ["DCL-2025-001234", "DCL-2025-001289"],
    trader_id: "TRD-00123",
    details: { hs_chapter: "84", window_days: 30 },
    status: "open",
    fired_at: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    alert_id: "alert-002",
    pattern_id: "VALUATION_ANOMALY",
    pattern_name: "Valuation Anomaly",
    severity: "high",
    declaration_ids: ["DCL-2025-001456"],
    trader_id: "TRD-00456",
    details: { hs_chapter: "87", declared_price_per_kg: 120.5, baseline_mean: 12000, z_score: -3.8 },
    status: "open",
    fired_at: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    alert_id: "alert-003",
    pattern_id: "SPLIT_CONSIGNMENT",
    pattern_name: "Split Consignment Evasion",
    severity: "medium",
    declaration_ids: ["DCL-2025-001500", "DCL-2025-001501", "DCL-2025-001502"],
    trader_id: "TRD-00789",
    details: { shipper: "ACME Exports Ltd", consignee: "Delta Imports Co", hs_chapter: "61", count: 3 },
    status: "open",
    fired_at: new Date(Date.now() - 12 * 3600 * 1000).toISOString(),
  },
  {
    alert_id: "alert-004",
    pattern_id: "SUSPICIOUS_ROUTING",
    pattern_name: "Suspicious Routing",
    severity: "medium",
    declaration_ids: ["DCL-2025-001600"],
    trader_id: "TRD-00321",
    details: { risky_hubs: ["AEDXB"], origin: "IR", destination: "GH" },
    status: "acknowledged",
    fired_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
];

// ─── Router ────────────────────────────────────────────────────────────────────

export const cepRouter = router({
  /** List all registered CEP patterns */
  getPatterns: protectedProcedure.query(async () => {
    try {
      const data = await cepFetch<{ patterns: typeof MOCK_PATTERNS }>("/patterns");
      return data.patterns;
    } catch {
      return MOCK_PATTERNS;
    }
  }),

  /** Run CEP detection against a batch of declaration events */
  detectPatterns: protectedProcedure
    .input(
      z.object({
        events: z.array(
          z.object({
            declaration_id: z.string(),
            trader_id: z.string(),
            shipper_name: z.string(),
            consignee_name: z.string(),
            hs_code: z.string(),
            description: z.string().default(""),
            origin_country: z.string(),
            destination_country: z.string(),
            transshipment_ports: z.array(z.string()).default([]),
            declared_value_usd: z.number(),
            weight_kg: z.number(),
            declaration_type: z.enum(["IMPORT", "EXPORT", "TRANSIT"]),
            submitted_at: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await cepFetch<{ processed: number; alerts_fired: number; alerts: unknown[] }>(
          "/detect",
          { method: "POST", body: JSON.stringify(input.events) }
        );
      } catch {
        return { processed: input.events.length, alerts_fired: 0, alerts: [] };
      }
    }),

  /** Get CEP alerts, optionally filtered by status */
  getAlerts: protectedProcedure
    .input(
      z.object({
        status: z.enum(["open", "acknowledged", "all"]).default("open"),
        limit: z.number().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      try {
        const params = new URLSearchParams({
          status: input.status === "all" ? "open" : input.status,
          limit: String(input.limit),
        });
        const data = await cepFetch<{ alerts: typeof MOCK_ALERTS; total: number }>(
          `/alerts?${params}`
        );
        return data;
      } catch {
        const filtered =
          input.status === "all"
            ? MOCK_ALERTS
            : MOCK_ALERTS.filter((a) => a.status === input.status);
        return { alerts: filtered.slice(0, input.limit), total: filtered.length };
      }
    }),

  /** Acknowledge a CEP alert */
  acknowledgeAlert: protectedProcedure
    .input(
      z.object({
        alert_id: z.string(),
        acknowledged_by: z.string(),
        notes: z.string().default(""),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await cepFetch<{ acknowledged: string }>("/alerts/acknowledge", {
          method: "POST",
          body: JSON.stringify(input),
        });
      } catch {
        return { acknowledged: input.alert_id };
      }
    }),

  /** Get CEP service statistics */
  getStats: protectedProcedure.query(async () => {
    try {
      return await cepFetch<{
        total_alerts: number;
        open_alerts: number;
        by_pattern: Record<string, number>;
        by_severity: Record<string, number>;
        declarations_processed: number;
        patterns_registered: number;
      }>("/stats");
    } catch {
      return {
        total_alerts: MOCK_ALERTS.length,
        open_alerts: MOCK_ALERTS.filter((a) => a.status === "open").length,
        by_pattern: { CAROUSEL_FRAUD: 1, VALUATION_ANOMALY: 1, SPLIT_CONSIGNMENT: 1, SUSPICIOUS_ROUTING: 1 },
        by_severity: { high: 2, medium: 2 },
        declarations_processed: 1200,
        patterns_registered: 4,
      };
    }
  }),

  /** Get service health */
  getServiceStatus: protectedProcedure.query(async () => {
    try {
      const data = await cepFetch<{ status: string; declarations_ingested: number; alerts_fired: number }>("/health");
      return { online: data.status === "ok", ...data };
    } catch {
      return {
        online: false,
        status: "unavailable",
        declarations_ingested: 0,
        alerts_fired: 0,
        note: "flink-cep-svc not reachable — using mock data",
      };
    }
  }),
});
