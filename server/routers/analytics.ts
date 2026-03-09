/**
 * analytics.ts — tRPC router for Delta Lake trade analytics pipeline
 * Proxies to the Python deltalake-svc (port 8103)
 */

import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";

const DELTALAKE_SVC_URL = process.env.DELTALAKE_SVC_URL ?? "http://localhost:8103";

const PERIOD_SCHEMA = z.enum(["daily", "weekly", "monthly", "quarterly"]).default("monthly");

async function deltaFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(`${DELTALAKE_SVC_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export const analyticsRouter = router({
  /** Get trade volume time-series and summary statistics */
  getTradeStats: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA }))
    .query(async ({ input }) => {
      return deltaFetch<{
        period: string;
        summary: {
          total_declarations: number;
          total_value_usd: number;
          total_duty_usd: number;
          avg_clearance_hours: number;
          lane_distribution: Record<string, number>;
        };
        time_series: Array<{
          date: string;
          declaration_count: number;
          total_value_usd: number;
          total_duty_usd: number;
          avg_clearance_hours: number;
        }>;
      }>(`/trade-stats?period=${input.period}`);
    }),

  /** Get HS code volume breakdown */
  getHsCodeVolume: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA }))
    .query(async ({ input }) => {
      return deltaFetch<{
        hs_volumes: Array<{
          hs_chapter: string;
          description: string;
          declaration_count: number;
          total_value_usd: number;
          total_duty_usd: number;
        }>;
        total_chapters: number;
        period: string;
      }>(`/hs-code-volume?period=${input.period}`);
    }),

  /** Get top trader performance metrics */
  getTraderMetrics: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA, limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      return deltaFetch<{
        traders: Array<{
          trader_id: string;
          declaration_count: number;
          total_value_usd: number;
          total_duty_usd: number;
          avg_clearance_hours: number;
          green_lane_rate: number;
          green_count: number;
          yellow_count: number;
          red_count: number;
        }>;
        total_traders: number;
        period: string;
      }>(`/trader-metrics?period=${input.period}&limit=${input.limit}`);
    }),

  /** Get trade route flow matrix */
  getRouteFlow: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA }))
    .query(async ({ input }) => {
      return deltaFetch<{
        routes: Array<{
          route: string;
          origin: string;
          destination: string;
          declaration_count: number;
          total_value_usd: number;
        }>;
        total_routes: number;
        period: string;
      }>(`/route-flow?period=${input.period}`);
    }),

  /** Get duty revenue time-series */
  getDutyRevenue: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA }))
    .query(async ({ input }) => {
      return deltaFetch<{
        period: string;
        total_duty_revenue_usd: number;
        avg_daily_revenue_usd: number;
        time_series: Array<{ date: string; duty_revenue_usd: number }>;
      }>(`/duty-revenue?period=${input.period}`);
    }),

  /** Ingest declaration events into the Delta Lake pipeline */
  ingestEvents: adminProcedure
    .input(
      z.object({
        events: z.array(
          z.object({
            declaration_id: z.string(),
            date: z.string(),
            hs_chapter: z.string(),
            origin_country: z.string(),
            dest_country: z.string(),
            declared_value_usd: z.number(),
            duty_amount_usd: z.number(),
            clearance_lane: z.string(),
            clearance_hours: z.number(),
            trader_id: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ input }) => {
      return deltaFetch<{ ingested: number; total_events: number }>("/ingest", {
        method: "POST",
        body: JSON.stringify({ events: input.events }),
      });
    }),

  /** Get overall pipeline statistics */
  getPipelineStats: protectedProcedure.query(async () => {
    return deltaFetch<{
      total_events: number;
      total_trade_value_usd: number;
      total_duty_revenue_usd: number;
      hs_chapters_tracked: number;
      origin_countries: number;
      destination_countries: number;
      date_range_days: number;
    }>("/stats");
  }),

  /** Health check for deltalake-svc */
  getServiceStatus: protectedProcedure.query(async () => {
    const result = await deltaFetch<{ status: string; service: string; events_ingested: number }>("/health");
    if (!result) return { online: false, status: "unreachable", service: "deltalake-svc", events_ingested: 0 };
    return { online: result.status === "ok", ...result };
  }),
});
