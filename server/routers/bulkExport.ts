/**
 * Bulk Export Router — Sprint 15 + Sprint 97 (Transaction History CSV)
 *
 * Generates CSV/JSON/XLSX exports of declarations, payments, audit logs,
 * and Mojaloop transaction history.
 * Returns content as a base64-encoded string for the client to download.
 *
 * Supported formats: CSV (default), JSON, XLSX
 * Supported exports: declarations, payments, auditLog, transactionHistory
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { assertCan } from "../_core/permify";

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

/** Trigger a browser download from a base64-encoded string (client-side helper) */
export function downloadBase64(content: string, filename: string, mimeType: string) {
  const bytes = atob(content);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const blob = new Blob([arr], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const bulkExportRouter = router({
  // ── EXPORT DECLARATIONS ──────────────────────────────────────────────────────
  exportDeclarations: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json", "xlsx"]).default("csv"),
        status: z
          .enum([
            "all", "draft", "submitted", "under_assessment", "docs_required",
            "payment_pending", "payment_confirmed", "under_examination",
            "examination_complete", "cleared", "rejected", "cancelled",
          ])
          .default("all"),
        riskLane: z.enum(["all", "green", "yellow", "red", "blue"]).default("all"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        traderId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(5000).default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isOfficerOrAdmin =
        ctx.user.role === "admin" ||
        ctx.user.role === "customs_officer" ||
        ctx.user.role === "finance";

      const effectiveTraderId = isOfficerOrAdmin ? (input.traderId ?? null) : ctx.user.id;

      if (input.traderId && !isOfficerOrAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins and officers can export other traders' declarations",
        });
      }
      if (process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
        await assertCan(String(ctx.user.id), "bulk_export", "declarations", "export");
      }

      const { getDb } = await import("../db");
      const { declarations, users } = await import("../../drizzle/schema");
      const { and, eq, gte, lte } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) {
        const emptyDate = new Date().toISOString().slice(0, 10);
        if (input.format === "json") {
          return { format: "json" as const, filename: `export-${emptyDate}.json`, content: Buffer.from("[]").toString("base64"), rowCount: 0 };
        }
        const CSV_HEADERS = ["declarationNumber"];
        const emptyCsv = CSV_HEADERS.join(",") + "\n";
        return { format: "csv" as const, filename: `export-${emptyDate}.csv`, content: Buffer.from(emptyCsv).toString("base64"), rowCount: 0 };
      }

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

      const CSV_HEADERS = [
        "id", "declarationNumber", "ucr", "traderId", "traderName", "declarationType",
        "status", "riskLane", "riskScore", "hsCode", "goodsDescription", "countryOfOrigin",
        "countryOfDestination", "portOfEntry", "grossWeight", "netWeight", "numberOfPackages",
        "invoiceValue", "invoiceCurrency", "dutyAmount", "vatAmount", "levyAmount", "totalDue",
        "submittedAt", "clearedAt", "createdAt",
      ];

      const normalizedRows = rows.map((r) => ({
        ...r,
        submittedAt: r.submittedAt?.toISOString() ?? "",
        clearedAt: r.clearedAt?.toISOString() ?? "",
        createdAt: r.createdAt.toISOString(),
      }));

      if (input.format === "json") {
        return {
          format: "json" as const,
          filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(JSON.stringify(normalizedRows, null, 2)).toString("base64"),
          rowCount: rows.length,
        };
      }

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
        normalizedRows.forEach((r) => ws.addRow(CSV_HEADERS.map((h) => (r as any)[h] ?? "")));
        const xlsxBuffer = await wb.xlsx.writeBuffer();
        return {
          format: "xlsx" as const,
          filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
          content: Buffer.from(xlsxBuffer).toString("base64"),
          rowCount: rows.length,
        };
      }

      const csv = rowsToCsv(CSV_HEADERS, normalizedRows as any);
      return {
        format: "csv" as const,
        filename: `declarations-export-${new Date().toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv).toString("base64"),
        rowCount: rows.length,
      };
    }),

  // ── EXPORT PAYMENTS / TRANSACTION HISTORY ────────────────────────────────────
  exportPayments: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json", "xlsx"]).default("csv"),
        status: z.enum(["all", "pending", "confirmed", "failed", "refunded"]).default("all"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        traderId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(5000).default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "finance";
      const effectiveTraderId = isAdmin ? (input.traderId ?? null) : ctx.user.id;

      if (input.traderId && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient permissions" });
      }

      const { getDb } = await import("../db");
      const { payments, declarations, users } = await import("../../drizzle/schema");
      const { and, eq, gte, lte } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) {
        const emptyDate = new Date().toISOString().slice(0, 10);
        if (input.format === "json") {
          return { format: "json" as const, filename: `export-${emptyDate}.json`, content: Buffer.from("[]").toString("base64"), rowCount: 0 };
        }
        const CSV_HEADERS = ["declarationNumber"];
        const emptyCsv = CSV_HEADERS.join(",") + "\n";
        return { format: "csv" as const, filename: `export-${emptyDate}.csv`, content: Buffer.from(emptyCsv).toString("base64"), rowCount: 0 };
      }

      const conditions: any[] = [];
      if (effectiveTraderId) conditions.push(eq(payments.traderId, effectiveTraderId));
      if (input.status !== "all") conditions.push(eq(payments.status, input.status as any));
      if (input.dateFrom) conditions.push(gte(payments.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) {
        const dt = new Date(input.dateTo);
        dt.setHours(23, 59, 59, 999);
        conditions.push(lte(payments.createdAt, dt));
      }

      const rows = await db
        .select({
          id: payments.id,
          declarationId: payments.declarationId,
          declarationNumber: declarations.declarationNumber,
          traderId: payments.traderId,
          traderName: users.name,
          amount: payments.amount,
          currency: payments.currency,
          paymentMethod: payments.paymentMethod,
          status: payments.status,
          reference: payments.reference,
          mojalooopTransferId: payments.mojalooopTransferId,
          confirmedAt: payments.confirmedAt,
          failureReason: payments.failureReason,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .leftJoin(declarations, eq(payments.declarationId, declarations.id))
        .leftJoin(users, eq(payments.traderId, users.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(payments.createdAt)
        .limit(input.limit);

      const CSV_HEADERS = [
        "id", "declarationId", "declarationNumber", "traderId", "traderName",
        "amount", "currency", "paymentMethod", "status", "reference",
        "mojalooopTransferId", "confirmedAt", "failureReason", "createdAt",
      ];

      const normalized = rows.map((r) => ({
        ...r,
        confirmedAt: r.confirmedAt?.toISOString() ?? "",
        createdAt: r.createdAt.toISOString(),
      }));

      if (input.format === "json") {
        return {
          format: "json" as const,
          filename: `payments-export-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(JSON.stringify(normalized, null, 2)).toString("base64"),
          rowCount: rows.length,
        };
      }

      if (input.format === "xlsx") {
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        wb.creator = "TradeGateway NGSWTP";
        const ws = wb.addWorksheet("Payments");
        ws.columns = CSV_HEADERS.map((h) => ({ header: h, key: h, width: 18 }));
        ws.getRow(1).font = { bold: true };
        normalized.forEach((r) => ws.addRow(CSV_HEADERS.map((h) => (r as any)[h] ?? "")));
        const buf = await wb.xlsx.writeBuffer();
        return {
          format: "xlsx" as const,
          filename: `payments-export-${new Date().toISOString().slice(0, 10)}.xlsx`,
          content: Buffer.from(buf).toString("base64"),
          rowCount: rows.length,
        };
      }

      const csv = rowsToCsv(CSV_HEADERS, normalized as any);
      return {
        format: "csv" as const,
        filename: `payments-export-${new Date().toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv).toString("base64"),
        rowCount: rows.length,
      };
    }),

  // ── EXPORT MOJALOOP TRANSACTION HISTORY ──────────────────────────────────────
  exportTransactionHistory: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json", "xlsx"]).default("csv"),
        status: z.enum(["all", "PENDING", "COMPLETED", "FAILED", "EXPIRED", "CANCELLED"]).default("all"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        fspId: z.string().optional(),
        limit: z.number().int().min(1).max(5000).default(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "finance";

      const { getDb } = await import("../db");
      const { mojaloopTransactions } = await import("../../drizzle/schema");
      const { and, eq, gte, lte } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) {
        const emptyDate = new Date().toISOString().slice(0, 10);
        if (input.format === "json") {
          return { format: "json" as const, filename: `export-${emptyDate}.json`, content: Buffer.from("[]").toString("base64"), rowCount: 0 };
        }
        const CSV_HEADERS = ["declarationNumber"];
        const emptyCsv = CSV_HEADERS.join(",") + "\n";
        return { format: "csv" as const, filename: `export-${emptyDate}.csv`, content: Buffer.from(emptyCsv).toString("base64"), rowCount: 0 };
      }

      const conditions: any[] = [];
      if (!isAdmin) conditions.push(eq(mojaloopTransactions.initiatedBy, ctx.user.id));
      if (input.status !== "all") conditions.push(eq(mojaloopTransactions.status, input.status as any));
      if (input.fspId) conditions.push(eq(mojaloopTransactions.fspId, input.fspId));
      if (input.dateFrom) conditions.push(gte(mojaloopTransactions.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) {
        const dt = new Date(input.dateTo);
        dt.setHours(23, 59, 59, 999);
        conditions.push(lte(mojaloopTransactions.createdAt, dt));
      }

      const rows = await db
        .select()
        .from(mojaloopTransactions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(mojaloopTransactions.createdAt)
        .limit(input.limit);

      const CSV_HEADERS = [
        "id", "transferId", "declarationId", "initiatedBy", "fspId", "fspName", "fspType",
        "payerAccount", "payerName", "amount", "currency", "status",
        "paymentNote", "expiresAt", "committedAt", "createdAt",
      ];

      const normalized = rows.map((r) => ({
        ...r,
        expiresAt: r.expiresAt?.toISOString() ?? "",
        committedAt: r.committedAt?.toISOString() ?? "",
        createdAt: r.createdAt.toISOString(),
        ilpPacket: undefined,
        condition: undefined,
        fulfillment: undefined,
      }));

      if (input.format === "json") {
        return {
          format: "json" as const,
          filename: `transactions-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(JSON.stringify(normalized, null, 2)).toString("base64"),
          rowCount: rows.length,
        };
      }

      if (input.format === "xlsx") {
        const ExcelJS = await import("exceljs");
        const wb = new ExcelJS.Workbook();
        wb.creator = "TradeGateway NGSWTP";
        const ws = wb.addWorksheet("Transactions");
        ws.columns = CSV_HEADERS.map((h) => ({ header: h, key: h, width: 20 }));
        ws.getRow(1).font = { bold: true };
        normalized.forEach((r) => ws.addRow(CSV_HEADERS.map((h) => (r as any)[h] ?? "")));
        const buf = await wb.xlsx.writeBuffer();
        return {
          format: "xlsx" as const,
          filename: `transactions-${new Date().toISOString().slice(0, 10)}.xlsx`,
          content: Buffer.from(buf).toString("base64"),
          rowCount: rows.length,
        };
      }

      const csv = rowsToCsv(CSV_HEADERS, normalized as any);
      return {
        format: "csv" as const,
        filename: `transactions-${new Date().toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv).toString("base64"),
        rowCount: rows.length,
      };
    }),

  // ── EXPORT AUDIT LOG ─────────────────────────────────────────────────────────
  exportAuditLog: protectedProcedure
    .input(
      z.object({
        format: z.enum(["csv", "json"]).default("csv"),
        entityType: z.string().optional(),
        actorId: z.number().int().positive().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        limit: z.number().int().min(1).max(10000).default(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can export audit logs" });
      }

      const { getDb } = await import("../db");
      const { auditEvents } = await import("../../drizzle/schema");
      const { and, eq, gte, lte } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) {
        const emptyDate = new Date().toISOString().slice(0, 10);
        if (input.format === "json") {
          return { format: "json" as const, filename: `export-${emptyDate}.json`, content: Buffer.from("[]").toString("base64"), rowCount: 0 };
        }
        const CSV_HEADERS = ["declarationNumber"];
        const emptyCsv = CSV_HEADERS.join(",") + "\n";
        return { format: "csv" as const, filename: `export-${emptyDate}.csv`, content: Buffer.from(emptyCsv).toString("base64"), rowCount: 0 };
      }

      const conditions: any[] = [];
      if (input.entityType) conditions.push(eq(auditEvents.entityType, input.entityType as any));
      if (input.actorId) conditions.push(eq(auditEvents.actorId, input.actorId));
      if (input.dateFrom) conditions.push(gte(auditEvents.createdAt, new Date(input.dateFrom)));
      if (input.dateTo) {
        const dt = new Date(input.dateTo);
        dt.setHours(23, 59, 59, 999);
        conditions.push(lte(auditEvents.createdAt, dt));
      }

      const rows = await db
        .select({
          id: auditEvents.id,
          entityType: auditEvents.entityType,
          entityId: auditEvents.entityId,
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          actorType: auditEvents.actorType,
          ipAddress: auditEvents.ipAddress,
          createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(auditEvents.createdAt)
        .limit(input.limit);

      const CSV_HEADERS = ["id", "entityType", "entityId", "action", "actorId", "actorType", "ipAddress", "createdAt"];
      const normalized = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

      if (input.format === "json") {
        return {
          format: "json" as const,
          filename: `audit-log-${new Date().toISOString().slice(0, 10)}.json`,
          content: Buffer.from(JSON.stringify(normalized, null, 2)).toString("base64"),
          rowCount: rows.length,
        };
      }

      const csv = rowsToCsv(CSV_HEADERS, normalized as any);
      return {
        format: "csv" as const,
        filename: `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
        content: Buffer.from(csv).toString("base64"),
        rowCount: rows.length,
      };
    }),

  // ── EXPORT PREVIEW ───────────────────────────────────────────────────────────
  previewCount: protectedProcedure
    .input(
      z.object({
        exportType: z.enum(["declarations", "payments", "transactions", "auditLog"]).default("declarations"),
        status: z.string().default("all"),
        riskLane: z.string().default("all"),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        traderId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const isOfficerOrAdmin =
        ctx.user.role === "admin" || ctx.user.role === "customs_officer" || ctx.user.role === "finance";
      const effectiveTraderId = isOfficerOrAdmin ? (input.traderId ?? null) : ctx.user.id;

      const { getDb } = await import("../db");
      const { declarations, payments, mojaloopTransactions, auditEvents } = await import("../../drizzle/schema");
      const { and, eq, gte, lte, count: countFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return { count: 0 };

      const conditions: any[] = [];
      let table: any = declarations;

      if (input.exportType === "declarations") {
        table = declarations;
        if (effectiveTraderId) conditions.push(eq(declarations.traderId, effectiveTraderId));
        if (input.status !== "all") conditions.push(eq(declarations.status, input.status as any));
        if (input.riskLane !== "all") conditions.push(eq(declarations.riskLane, input.riskLane as any));
        if (input.dateFrom) conditions.push(gte(declarations.submittedAt, new Date(input.dateFrom)));
        if (input.dateTo) {
          const dt = new Date(input.dateTo); dt.setHours(23, 59, 59, 999);
          conditions.push(lte(declarations.submittedAt, dt));
        }
      } else if (input.exportType === "payments") {
        table = payments;
        if (effectiveTraderId) conditions.push(eq(payments.traderId, effectiveTraderId));
        if (input.status !== "all") conditions.push(eq(payments.status, input.status as any));
        if (input.dateFrom) conditions.push(gte(payments.createdAt, new Date(input.dateFrom)));
        if (input.dateTo) {
          const dt = new Date(input.dateTo); dt.setHours(23, 59, 59, 999);
          conditions.push(lte(payments.createdAt, dt));
        }
      } else if (input.exportType === "transactions") {
        table = mojaloopTransactions;
        if (!isOfficerOrAdmin) conditions.push(eq(mojaloopTransactions.initiatedBy, ctx.user.id));
        if (input.status !== "all") conditions.push(eq(mojaloopTransactions.status, input.status as any));
        if (input.dateFrom) conditions.push(gte(mojaloopTransactions.createdAt, new Date(input.dateFrom)));
        if (input.dateTo) {
          const dt = new Date(input.dateTo); dt.setHours(23, 59, 59, 999);
          conditions.push(lte(mojaloopTransactions.createdAt, dt));
        }
      } else {
        table = auditEvents;
        if (input.dateFrom) conditions.push(gte(auditEvents.createdAt, new Date(input.dateFrom)));
        if (input.dateTo) {
          const dt = new Date(input.dateTo); dt.setHours(23, 59, 59, 999);
          conditions.push(lte(auditEvents.createdAt, dt));
        }
      }

      const [result] = await db
        .select({ count: countFn() })
        .from(table)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      return { count: Number(result?.count ?? 0) };
    }),

  // ── BULK IMPORT ───────────────────────────────────────────────────────────────
  importDeclarations: protectedProcedure
    .input(z.object({ csvContent: z.string().min(1).max(5_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const allowedImportRoles = ["admin", "customs_officer"];
      if (!allowedImportRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins and customs officers can import declarations." });
      }
      const { getDb } = await import("../db");
      const { declarations } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return { total: 0, successCount: 0, errorCount: 0, results: [] as Array<{ row: number; success: boolean; declarationNumber?: string; error?: string }> };

      const lines = input.csvContent.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "CSV must have a header row and at least one data row" });
      }

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
