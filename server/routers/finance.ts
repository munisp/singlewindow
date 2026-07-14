/**
 * finance.ts — Finance role tRPC router
 * Provides duty revenue analytics, payment KPIs, HS chapter breakdown,
 * corridor analysis, and pending payment management for the finance role.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertCan } from "../_core/permify";
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
import { getPool } from "../db";

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

  // ─── Flutter Mobile Aliases ─────────────────────────────────────────────
  // These endpoints are called by the Flutter finance_screen.dart.
  // They map to the canonical procedures above but with mobile-friendly shapes.

  // summary — wraps kpis + 30-day trend for the Flutter Summary tab
  summary: protectedProcedure.query(async ({ ctx }) => {
    const kpis = await getFinanceKPIs();
    const trend = await getPaymentTrend(30);
    return {
      totalRevenue: kpis?.totalRevenue ?? 0,
      pendingAmount: kpis?.pendingAmount ?? 0,
      pendingCount: kpis?.pendingCount ?? 0,
      confirmedCount: kpis?.confirmedCount ?? 0,
      failedCount: kpis?.failedCount ?? 0,
      dutyRevenue: kpis?.dutyRevenue ?? 0,
      vatRevenue: kpis?.vatRevenue ?? 0,
      levyRevenue: kpis?.levyRevenue ?? 0,
      overdueCount: kpis?.overdueCount ?? 0,
      trend,
    };
  }),

  // transactions — last 50 payments for the Flutter Transactions tab
  transactions: protectedProcedure.query(async ({ ctx }) => {
    const pool = getPool();
    if (!pool) return [];
    const { rows } = await pool.query(`
      SELECT
        p.id, p.reference, p.amount, p.currency, p.status,
        p.payment_method AS "paymentMethod",
        p.created_at AS "createdAt",
        p.confirmed_at AS "confirmedAt",
        d.declaration_number AS "declarationRef",
        d.hs_code AS "hsCode",
        CASE WHEN p.status = 'confirmed' THEN 'credit' ELSE 'debit' END AS type,
        COALESCE(d.goods_description, 'Customs Duty Payment') AS description
      FROM payments p
      LEFT JOIN declarations d ON d.id = p.declaration_id
      ORDER BY p.created_at DESC
      LIMIT 50
    `);
    return rows;
  }),

  // duties — pending duty obligations for the Flutter Duties tab
  duties: protectedProcedure.query(async ({ ctx }) => {
    const pool = getPool();
    if (!pool) return [];
    const { rows } = await pool.query(`
      SELECT
        p.id, p.reference, p.amount, p.currency, p.status,
        d.declaration_number AS "declarationRef",
        d.hs_code AS "hsCode",
        COALESCE(d.goods_description, 'Customs Duty') AS description,
        (p.status = 'confirmed') AS paid,
        p.created_at AS "createdAt"
      FROM payments p
      LEFT JOIN declarations d ON d.id = p.declaration_id
      WHERE p.status IN ('pending', 'confirmed')
      ORDER BY p.created_at DESC
      LIMIT 50
    `);
    return rows;
  }),

  // clusterSummary — FinOps cost breakdown from cost_records table for Flutter Finance screen
  clusterSummary: protectedProcedure.query(async ({ ctx }) => {
    const pool = getPool();
    if (!pool) return { services: [], totalMonthly: 0, totalYtd: 0 };
    const { rows: serviceRows } = await pool.query(`
      SELECT
        service,
        namespace,
        category,
        SUM(total_cost_usd) AS total_cost,
        SUM(compute_cost_usd) AS compute_cost,
        SUM(storage_cost_usd) AS storage_cost,
        SUM(network_cost_usd) AS network_cost,
        AVG(efficiency) AS avg_efficiency,
        COUNT(*) AS days
      FROM cost_records
      WHERE period_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY service, namespace, category
      ORDER BY total_cost DESC
    `);
    const { rows: totals } = await pool.query(`
      SELECT
        SUM(CASE WHEN period_date >= CURRENT_DATE - INTERVAL '30 days' THEN total_cost_usd ELSE 0 END) AS monthly_total,
        SUM(CASE WHEN period_date >= DATE_TRUNC('year', CURRENT_DATE) THEN total_cost_usd ELSE 0 END) AS ytd_total
      FROM cost_records
    `);
    return {
      services: serviceRows.map((r: any) => ({
        service: r.service,
        namespace: r.namespace,
        category: r.category,
        totalCostUsd: Math.round(Number(r.total_cost) / 100),
        computeCostUsd: Math.round(Number(r.compute_cost) / 100),
        storageCostUsd: Math.round(Number(r.storage_cost) / 100),
        networkCostUsd: Math.round(Number(r.network_cost) / 100),
        avgEfficiency: Math.round(Number(r.avg_efficiency)),
      })),
      totalMonthly: Math.round(Number(totals[0]?.monthly_total ?? 0) / 100),
      totalYtd: Math.round(Number(totals[0]?.ytd_total ?? 0) / 100),
    };
  }),

  // CSV export: confirmed payments grouped by HS chapter and corridor for a date range
  exportCSV: protectedProcedure
    .input(z.object({
      startDate: z.string().datetime({ offset: true }).optional(),
      endDate: z.string().datetime({ offset: true }).optional(),
      limit: z.number().min(1).max(10000).default(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      await assertCan(String(ctx.user.id), "finance_report", "export", "export");
      const { getDb } = await import("../db");
      const { payments, declarations } = await import("../../drizzle/schema");
      const { eq, and, gte, lte, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions: ReturnType<typeof eq>[] = [eq(payments.status, "confirmed")];
      if (input.startDate) conditions.push(gte(payments.createdAt, new Date(input.startDate)) as any);
      if (input.endDate) conditions.push(lte(payments.createdAt, new Date(input.endDate)) as any);

      const rows = await db
        .select({
          paymentId: payments.id,
          paymentRef: payments.reference,
          declarationId: payments.declarationId,
          declarationNumber: declarations.declarationNumber,
          hsChapter: declarations.hsCode,
          corridor: declarations.portOfEntry,
          declarationType: declarations.declarationType,
          amount: payments.amount,
          currency: payments.currency,
          paymentMethod: payments.paymentMethod,
          paidAt: payments.confirmedAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(declarations, eq(payments.declarationId, declarations.id))
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(payments.confirmedAt))
        .limit(input.limit);

      // Build CSV
      const headers = [
        "Payment ID", "Payment Reference", "Declaration ID", "Declaration Number",
        "HS Chapter", "Port/Corridor", "Declaration Type",
        "Amount", "Currency", "Payment Method", "Paid At", "Created At",
      ];

      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const csvLines = [
        headers.join(","),
        ...rows.map((r) =>
          [
            r.paymentId, r.paymentRef, r.declarationId, r.declarationNumber,
            r.hsChapter ? r.hsChapter.substring(0, 2) : "",
            r.corridor, r.declarationType,
            r.amount, r.currency, r.paymentMethod,
            r.paidAt ? new Date(r.paidAt).toISOString() : "",
            r.createdAt ? new Date(r.createdAt).toISOString() : "",
          ].map(escape).join(",")
        ),
      ];

      return {
        csv: csvLines.join("\n"),
        rowCount: rows.length,
        generatedAt: new Date().toISOString(),
        filename: `duty-revenue-${new Date().toISOString().split("T")[0]}.csv`,
      };
    }),

  /**
   * emailCSV — generate the same CSV and deliver it as an in-app notification
   * (with the CSV content embedded) to the requesting user.
   */
  emailCSV: protectedProcedure
    .input(z.object({
      startDate: z.string().datetime({ offset: true }).optional(),
      endDate: z.string().datetime({ offset: true }).optional(),
      limit: z.number().min(1).max(10000).default(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      assertFinanceAccess(ctx.user.role);
      // Re-use the same query logic as exportCSV
      const { getDb } = await import("../db");
      const { createUserNotification } = await import("../db");
      const { payments, declarations } = await import("../../drizzle/schema");
      const { eq, and, gte, lte, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions: ReturnType<typeof eq>[] = [eq(payments.status, "confirmed")];
      if (input.startDate) conditions.push(gte(payments.createdAt, new Date(input.startDate)) as any);
      if (input.endDate) conditions.push(lte(payments.createdAt, new Date(input.endDate)) as any);

      const rows = await db
        .select({
          paymentId: payments.id,
          paymentRef: payments.reference,
          declarationId: payments.declarationId,
          declarationNumber: declarations.declarationNumber,
          amount: payments.amount,
          currency: payments.currency,
          paymentMethod: payments.paymentMethod,
          paidAt: payments.confirmedAt,
        })
        .from(payments)
        .leftJoin(declarations, eq(payments.declarationId, declarations.id))
        .where(conditions.length === 1 ? conditions[0] : and(...conditions))
        .orderBy(desc(payments.confirmedAt))
        .limit(input.limit);

      const dateRange = input.startDate && input.endDate
        ? `${input.startDate.split("T")[0]} to ${input.endDate.split("T")[0]}`
        : "all time";

      // Deliver as in-app notification with summary (CSV is too large for notification body;
      // we include the first 10 rows as a preview and note the full export is available via download)
      const preview = rows.slice(0, 10).map(r =>
        `${r.paymentRef ?? r.paymentId} | ${r.declarationNumber ?? "—"} | ${r.amount} ${r.currency}`
      ).join("\n");

      await createUserNotification({
        userId: ctx.user.id,
        type: "csv_export",
        title: `Finance CSV Export Ready — ${rows.length} records (${dateRange})`,
        body: `Your duty-revenue CSV export for ${dateRange} is ready.\n\nFirst ${Math.min(10, rows.length)} records:\n${preview}\n\nDownload the full CSV from the Finance Ledger page.`,
      });

      return { success: true, rowCount: rows.length, dateRange };
    }),
});
