/**
 * openData.ts — dedicated PUBLIC router for citizen-facing open data (PRA-014).
 *
 * Decision record: `getPublicTradeData` is genuinely public-facing by design —
 * aggregated, anonymized national trade statistics published under CC BY 4.0
 * (no PII, no trader-level data, cleared declarations only). It therefore
 * stays UNAUTHENTICATED, but it is the ONLY such endpoint: it lives on its
 * own router behind an explicit IP-based Redis rate limiter (60 req/min,
 * fail-closed per PRA-026: limiter down => 503 RATE_LIMITER_UNAVAILABLE, the
 * dev-only in-memory fallback requires RATE_LIMIT_ALLOW_INMEMORY_FALLBACK=true).
 *
 * Everything else that used to be public (portCongestion.*, cargoTracking.*,
 * ai.models, tradeAnalytics.*) is protectedProcedure.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { publicProcedure, router } from "../_core/trpc";
import { redisRateLimit } from "../_core/redis";
import { RateLimiterUnavailableError } from "../_core/redisRateLimiter";
import { requireDb } from "../db";

const OPEN_DATA_WINDOW_MS = 60_000;
const OPEN_DATA_MAX = 60; // 60 req/min per IP

/**
 * Public procedure with explicit IP rate limiting for open-data endpoints.
 */
const openDataProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const ip =
    (ctx.req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    ctx.req.socket?.remoteAddress ??
    "unknown";
  let allowed: boolean;
  try {
    allowed = await redisRateLimit("opendata", ip, OPEN_DATA_WINDOW_MS, OPEN_DATA_MAX);
  } catch (err) {
    if (err instanceof RateLimiterUnavailableError) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "RATE_LIMITER_UNAVAILABLE: open-data rate limiter is unavailable — request refused (fail-closed)",
      });
    }
    throw err;
  }
  if (!allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Open-data rate limit exceeded (60 req/min). Try again shortly.",
    });
  }
  return next({ ctx });
});

export const openDataRouter = router({
  /**
   * Public Trade Data API (Open Data) — aggregated, anonymized national
   * trade statistics. No auth by design (citizen advisories / open data),
   * rate-limited per IP. Moved out of tradeAnalyticsRouter under PRA-014.
   */
  getPublicTradeData: openDataProcedure
    .input(z.object({
      year:  z.number().int().min(2020).max(2030).optional(),
      month: z.number().int().min(1).max(12).optional(),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const year  = input.year  ?? new Date().getFullYear();
      const month = input.month ?? new Date().getMonth() + 1;

      // Aggregated, anonymized public trade statistics
      const { rows: [stats] } = await db.execute(sql`
        SELECT
          COUNT(*) AS total_declarations,
          COALESCE(SUM(CAST(declared_value AS NUMERIC)), 0) AS total_trade_value_usd,
          COALESCE(SUM(CAST(total_duty AS NUMERIC)), 0) AS total_duty_ngn,
          COUNT(DISTINCT country_of_origin) AS origin_countries,
          COUNT(DISTINCT port_of_entry) AS ports_active
        FROM declarations
        WHERE EXTRACT(YEAR FROM created_at) = ${year}
          AND EXTRACT(MONTH FROM created_at) = ${month}
          AND status = 'cleared'
      `);

      return {
        period: { year, month },
        statistics: {
          totalDeclarations:   Number(stats?.total_declarations ?? 0),
          totalTradeValueUsd:  Number(stats?.total_trade_value_usd ?? 0),
          totalDutyNgn:        Number(stats?.total_duty_ngn ?? 0),
          originCountries:     Number(stats?.origin_countries ?? 0),
          portsActive:         Number(stats?.ports_active ?? 0),
        },
        source: "Nigeria Customs Service — National Single Window Trade Platform",
        license: "CC BY 4.0",
        disclaimer: "Aggregated statistics. Individual transaction data is confidential.",
      };
    }),
});
