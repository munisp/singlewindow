/**
 * finance.ts — Finance role tRPC router
 * Provides duty revenue analytics, payment KPIs, HS chapter breakdown,
 * corridor analysis, and pending payment management for the finance role.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getFinanceKPIs,
  getRevenueByHsChapter,
  getRevenueByCountry,
  getPaymentTrend,
  getRevenueByDeclarationType,
  getPortRevenueBreakdown,
  getPendingPaymentsList,
  getRiskLaneRevenueBreakdown,
  getAllPayments,
} from "../db";

// Only finance role and admin can access finance procedures
function assertFinanceAccess(role: string) {
  if (role !== "finance" && role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Finance or Admin role required" });
  }
}

export const financeRouter = router({
  // Overall KPI summary: total revenue, pending, confirmed, duty/VAT/levy breakdown
  kpis: protectedProcedure.query(async ({ ctx }) => {
    assertFinanceAccess(ctx.user.role);
    const kpis = await getFinanceKPIs();
    if (!kpis) {
      return {
        totalRevenue: 0,
        pendingAmount: 0,
        pendingCount: 0,
        confirmedCount: 0,
        failedCount: 0,
        dutyRevenue: 0,
        vatRevenue: 0,
        levyRevenue: 0,
        overdueCount: 0,
      };
    }
    return kpis;
  }),

  // Revenue breakdown by HS chapter (first 2 digits)
  revenueByHsChapter: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(15) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      return getRevenueByHsChapter(input.limit);
    }),

  // Revenue breakdown by country of origin
  revenueByCountry: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(30).default(10) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      return getRevenueByCountry(input.limit);
    }),

  // Payment volume trend over last N days
  paymentTrend: protectedProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      return getPaymentTrend(input.days);
    }),

  // Revenue breakdown by declaration type (import/export/transit/re_export)
  revenueByDeclarationType: protectedProcedure.query(async ({ ctx }) => {
    assertFinanceAccess(ctx.user.role);
    return getRevenueByDeclarationType();
  }),

  // Revenue breakdown by port of entry (corridor analysis)
  revenueByPort: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      return getPortRevenueBreakdown(input.limit);
    }),

  // Pending payments list with declaration details
  pendingPayments: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      return getPendingPaymentsList(input.limit);
    }),

  // Revenue breakdown by risk lane (green/yellow/red/blue)
  revenueByRiskLane: protectedProcedure.query(async ({ ctx }) => {
    assertFinanceAccess(ctx.user.role);
    return getRiskLaneRevenueBreakdown();
  }),

  // All payments with pagination (for detailed transaction view)
  allPayments: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(200).default(50), offset: z.number().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      const txs = await getAllPayments(input.limit, input.offset);
      return { transactions: txs, total: txs.length };
    }),
});
