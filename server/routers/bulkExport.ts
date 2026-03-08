/**
 * Bulk Declaration Export Router — Sprint 15
 *
 * Generates CSV exports of declarations with flexible filters.
 * Returns CSV as a base64-encoded string for the client to download.
 *
 * Supported formats: CSV (default), JSON
 * Supported filters: status, riskLane, dateFrom, dateTo, traderId (admin only)
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowsToCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsv(row[h])).join(",")
  );
  return [headerLine, ...dataLines].join("\r\n");
}

export const bulkExportRouter = router({
  // ── EXPORT DECLARATIONS ──────────────────────────────────────────────────────
  // Returns a CSV (base64) of declarations matching the given filters.
  // Traders can only export their own declarations.
  // Admins/officers can export all or filter by traderId.
  exportDeclarations: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("csv"),
        status: z
          .enum([
            "all",
            "draft",
            "submitted",
            "under_assessment",
            "docs_required",
            "payment_pending",
            "payment_confirmed",
            "under_examination",
            "examination_complete",
            "cleared",
            "rejected",
            "cancelled",
          ])
          .default("all"),
        riskLane: z.enum(["all", "green", "yellow", "red", "blue"]).default("all"),
        dateFrom: z.string().optional(), // ISO date string
        dateTo: z.string().optional(),   // ISO date string
        traderId: z.number().int().positive().optional(), // admin only
        limit: z.number().int().min(1).max(5000).default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isOfficerOrAdmin =
        ctx.user.role === "admin" ||
        ctx.user.role === "customs_officer" ||
        ctx.user.role === "finance";

      // Traders can only export their own data
      const effectiveTraderId = isOfficerOrAdmin
        ? (input.traderId ?? null)
        : ctx.user.id;

      if (input.traderId && !isOfficerOrAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and officers can export other traders' declarations",
        });
      }

      const { getDb } = await import("../db");
      const { declarations, users } = await import("../../drizzle/schema");
      const { and, eq, inArray, gte, lte, isNotNull } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Build where conditions
      const conditions: any[] = [];

      if (effectiveTraderId) {
        conditions.push(eq(declarations.traderId, effectiveTraderId));
      }

      if (input.status !== "all") {
        conditions.push(eq(declarations.status, input.status as any));
      }

      if (input.riskLane !== "all") {
        conditions.push(eq(declarations.riskLane, input.riskLane as any));
      }

      if (input.dateFrom) {
        conditions.push(gte(declarations.submittedAt, new Date(input.dateFrom)));
      }

      if (input.dateTo) {
        const dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
        conditions.push(lte(declarations.submittedAt, dateTo));
      }

      const rows = await db
        .select({
          id: declarations.id,
          declarationNumber: declarations.declarationNumber,
          ucr: declarations.ucr,
          traderId: declarations.traderId,
          traderName: users.name,
          declarationType: declarations.declarationType,
          status: declarations.status,
          riskLane: declarations.riskLane,
          riskScore: declarations.riskScore,
          hsCode: declarations.hsCode,
          goodsDescription: declarations.goodsDescription,
          countryOfOrigin: declarations.countryOfOrigin,
          countryOfDestination: declarations.countryOfDestination,
          portOfEntry: declarations.portOfEntry,
          grossWeight: declarations.grossWeight,
          netWeight: declarations.netWeight,
          numberOfPackages: declarations.numberOfPackages,
          invoiceValue: declarations.invoiceValue,
          invoiceCurrency: declarations.invoiceCurrency,
          dutyAmount: declarations.dutyAmount,
          vatAmount: declarations.vatAmount,
          levyAmount: declarations.levyAmount,
          totalDue: declarations.totalDue,
          submittedAt: declarations.submittedAt,
          clearedAt: declarations.clearedAt,
          createdAt: declarations.createdAt,
        })
        .from(declarations)
        .leftJoin(users, eq(declarations.traderId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(declarations.createdAt)
        .limit(input.limit);

      if (input.format === "json") {
        const jsonStr = JSON.stringify(
          rows.map((r) => ({
            ...r,
            submittedAt: r.submittedAt?.toISOString() ?? null,
            clearedAt: r.clearedAt?.toISOString() ?? null,
            createdAt: r.createdAt.toISOString(),
          })),
          null,
          2
        );
        return {
          format: "json" as const,
          filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(jsonStr).toString("base64"),
          rowCount: rows.length,
        };
      }

      // CSV export
      const CSV_HEADERS = [
        "id",
        "declarationNumber",
        "ucr",
        "traderId",
        "traderName",
        "declarationType",
        "status",
        "riskLane",
        "riskScore",
        "hsCode",
        "goodsDescription",
        "countryOfOrigin",
        "countryOfDestination",
        "portOfEntry",
        "grossWeight",
        "netWeight",
        "numberOfPackages",
        "invoiceValue",
        "invoiceCurrency",
        "dutyAmount",
        "vatAmount",
        "levyAmount",
        "totalDue",
        "submittedAt",
        "clearedAt",
        "createdAt",
      ];

      const csvRows = rows.map((r) => ({
        ...r,
        submittedAt: r.submittedAt?.toISOString() ?? "",
        clearedAt: r.clearedAt?.toISOString() ?? "",
        createdAt: r.createdAt.toISOString(),
      }));

      const csv = rowsToCsv(CSV_HEADERS, csvRows as any);

      return {
        format: "csv" as const,
        filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv).toString("base64"),
        rowCount: rows.length,
      };
    }),

  // ── EXPORT PREVIEW ───────────────────────────────────────────────────────────
  // Returns a count of how many rows would be exported with the given filters.
  previewCount: protectedProcedure
    .input(
      z.object({
        status: z.string().default("all"),
        riskLane: z.string().default("all"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        traderId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const isOfficerOrAdmin =
        ctx.user.role === "admin" ||
        ctx.user.role === "customs_officer" ||
        ctx.user.role === "finance";

      const effectiveTraderId = isOfficerOrAdmin
        ? (input.traderId ?? null)
        : ctx.user.id;

      const { getDb } = await import("../db");
      const { declarations } = await import("../../drizzle/schema");
      const { and, eq, gte, lte, count: countFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { count: 0 };

      const conditions: any[] = [];
      if (effectiveTraderId) conditions.push(eq(declarations.traderId, effectiveTraderId));
      if (input.status !== "all") conditions.push(eq(declarations.status, input.status as any));
      if (input.riskLane !== "all") conditions.push(eq(declarations.riskLane, input.riskLane as any));
      if (input.dateFrom) conditions.push(gte(declarations.submittedAt, new Date(input.dateFrom)));
      if (input.dateTo) {
        const dateTo = new Date(input.dateTo);
        dateTo.setHours(23, 59, 59, 999);
        conditions.push(lte(declarations.submittedAt, dateTo));
      }

      const [result] = await db
        .select({ count: countFn() })
        .from(declarations)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { count: Number(result?.count ?? 0) };
    }),
});
