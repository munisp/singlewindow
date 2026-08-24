/**
 * analytics.ts — tRPC router for Delta Lake trade analytics pipeline
 * Proxies to the Python deltalake-svc (port 8103)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";

const DELTALAKE_SVC_URL = ENV.deltaLakeSvcUrl;

const PERIOD_SCHEMA = z.enum(["daily", "weekly", "monthly", "quarterly"]).default("monthly");

async function deltaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(`${DELTALAKE_SVC_URL}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null);
      const reason = typeof body === "object" && body !== null && "detail" in body
        ? JSON.stringify(body.detail)
        : `HTTP ${res.status}`;
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Analytics unavailable — ${reason}` });
    }
    return res.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    const reason = error instanceof Error ? error.message : "connection failed";
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Analytics unavailable — ${reason}` });
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
          total_value_usd?: number;
          total_duty_usd?: number;
        };
        time_series: Array<{
          date: string;
          declaration_count: number;
          total_value_usd?: number;
          total_duty_usd?: number;
        }>;
      }>(`/trade-stats?period=${input.period}`);
    }),

  /** Get HS code volume breakdown */
  getHsCodeVolume: protectedProcedure
    .input(z.object({ period: PERIOD_SCHEMA }))
    .query(async ({ input }) => {
      return deltaFetch<{
        hs_volumes: Array<{
          hs_code: string;
          declaration_count: number;
          total_value_usd?: number;
          total_duty_usd?: number;
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
          total_value_usd?: number;
          total_duty_usd?: number;
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
        total_duty_revenue_usd?: number;
        time_series: Array<{ date: string; duty_revenue_usd: number }>;
      }>(`/duty-revenue?period=${input.period}`);
    }),

  /** Get overall pipeline statistics */
  getPipelineStats: protectedProcedure.query(async () => {
    return deltaFetch<{
      total_events: number;
      total_trade_value_usd: number;
      total_duty_revenue_usd: number;
      origin_countries?: number;
      destination_countries?: number;
    }>("/stats");
  }),

  /** Health check for deltalake-svc */
  getServiceStatus: protectedProcedure.query(async () => {
    const result = await deltaFetch<{
      status: string;
      service: string;
      source: string;
      declarations_available: number;
    }>("/health");
    return { online: result.status === "ok", ...result };
  }),
});
