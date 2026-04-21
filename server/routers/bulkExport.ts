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
  // Returns a CSV/JSON/XLSX (base64) of declarations matching the given filters.
  // Traders can only export their own declarations.
  // Admins/officers can export all or filter by traderId.
  exportDeclarations: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json", "xlsx"]).default("csv"),
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

      const normalizedRows = rows.map((r) => ({
        ...r,
        submittedAt: r.submittedAt?.toISOString() ?? "",
        clearedAt: r.clearedAt?.toISOString() ?? "",
        createdAt: r.createdAt.toISOString(),
      }));

      // ── XLSX export (exceljs — no CVEs) ────────────────────────────────────
      if (input.format === "xlsx") {
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        wb.creator = "TradeGateway NGSWTP";
        wb.created = new Date();
        const ws = wb.addWorksheet("Declarations");
        ws.columns = CSV_HEADERS.map((h) => ({ header: h, key: h, width: Math.max(h.length + 2, 14) }));
        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, color: { argb: "FFD4A017" } };
        headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A1628" } };
        normalizedRows.forEach((r) => {
          ws.addRow(CSV_HEADERS.map((h) => (r as any)[h] ?? ""));
        });
        const xlsxBuffer = await wb.xlsx.writeBuffer();
        return {
          format: "xlsx" as const,
          filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
          content: Buffer.from(xlsxBuffer).toString("base64"),
          rowCount: rows.length,
        };
      }

      // ── CSV export ───────────────────────────────────────────────────────────
      const csv = rowsToCsv(CSV_HEADERS, normalizedRows as any);

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

  // ── BULK IMPORT ───────────────────────────────────────────────────────────────────────
  // Accepts a CSV payload (as a string) and batch-inserts declarations as drafts.
  // Required CSV columns: hsCode, goodsDescription, portOfEntry, countryOfOrigin,
  //   importerName, exporterName, totalValue, currency, totalWeight, numberOfPackages
  importDeclarations: protectedProcedure
    .input(
      z.object({
        csvContent: z.string().min(1).max(5_000_000), // 5 MB limit
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const { declarations } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const lines = input.csvContent.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CSV must have a header row and at least one data row" });
      }

      // Required CSV columns map to schema column names:
      // invoiceValue, invoiceCurrency, grossWeight = totalWeight in CSV
      const REQUIRED_COLS = ["hsCode", "goodsDescription", "portOfEntry", "countryOfOrigin", "invoiceValue", "invoiceCurrency", "grossWeight", "numberOfPackages"];
      const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
      const missingCols = REQUIRED_COLS.filter((c) => !headers.includes(c));
      if (missingCols.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Missing required columns: ${missingCols.join(", ")}` });
      }

      const colIdx = (name: string) => headers.indexOf(name);
      const results: Array<{ row: number; success: boolean; declarationNumber?: string; error?: string }> = [];
      let successCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        try {
          const hsCode = cells[colIdx("hsCode")] ?? "";
          const goodsDescription = cells[colIdx("goodsDescription")] ?? "";
          const portOfEntry = cells[colIdx("portOfEntry")] ?? "";
          const countryOfOrigin = cells[colIdx("countryOfOrigin")] ?? "";
          const invoiceValue = parseFloat(cells[colIdx("invoiceValue")] ?? "0");
          const invoiceCurrency = cells[colIdx("invoiceCurrency")] ?? "USD";
          const grossWeight = parseFloat(cells[colIdx("grossWeight")] ?? "0");
          const numberOfPackages = parseInt(cells[colIdx("numberOfPackages")] ?? "1", 10);

          if (!hsCode || !goodsDescription || !portOfEntry) {
            results.push({ row: i, success: false, error: "Missing required field value" });
            continue;
          }
          if (isNaN(invoiceValue) || invoiceValue < 0) {
            results.push({ row: i, success: false, error: "Invalid invoiceValue" });
            continue;
          }

          const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
          const declarationNumber = `BULK-${Date.now()}-${suffix}`;
          const netWeightRaw = headers.includes("netWeight") ? cells[colIdx("netWeight")] : null;
          const countryOfDestRaw = headers.includes("countryOfDestination") ? cells[colIdx("countryOfDestination")] : null;
          await db.insert(declarations).values({
            declarationNumber,
            traderId: ctx.user.id,
            declarationType: "import" as any,
            status: "draft" as any,
            hsCode,
            goodsDescription,
            portOfEntry,
            countryOfOrigin: countryOfOrigin || null,
            invoiceValue: String(invoiceValue),
            invoiceCurrency,
            grossWeight: String(grossWeight),
            netWeight: netWeightRaw ? String(parseFloat(netWeightRaw)) : null,
            numberOfPackages,
            countryOfDestination: countryOfDestRaw || null,
          });
          results.push({ row: i, success: true, declarationNumber });
          successCount++;
        } catch (err: any) {
          results.push({ row: i, success: false, error: err?.message ?? "Insert failed" });
        }
      }

      return {
        total: lines.length - 1,
        successCount,
        errorCount: results.filter((r) => !r.success).length,
        results,
      };
    }),
});
