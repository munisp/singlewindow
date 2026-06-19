/**
 * Natural Language Financial Query Router — Sprint 97
 *
 * Allows users to query their financial data using plain English.
 * Uses LLM to translate natural language → structured query parameters,
 * then executes against the DB and returns results + explanation.
 *
 * Examples:
 *   "Show me all failed payments last month"
 *   "What is my total duty paid in Q1 2026?"
 *   "List declarations with risk score above 80"
 *   "How many green lane clearances did I have this year?"
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";

// ── Schema for structured query extracted by LLM ──────────────────────────────
const NL_QUERY_SCHEMA = {
  type: "object",
  properties: {
    queryType: {
      type: "string",
      enum: ["payments", "declarations", "transactions", "duties", "clearance_stats"],
      description: "The type of data being queried",
    },
    filters: {
      type: "object",
      properties: {
        status: { type: "string", description: "Status filter (e.g. confirmed, failed, cleared, green)" },
        dateFrom: { type: "string", description: "Start date in ISO format YYYY-MM-DD" },
        dateTo: { type: "string", description: "End date in ISO format YYYY-MM-DD" },
        riskLane: { type: "string", enum: ["green", "yellow", "red", "blue", "all"], description: "Risk lane filter" },
        minAmount: { type: "number", description: "Minimum amount filter" },
        maxAmount: { type: "number", description: "Maximum amount filter" },
        currency: { type: "string", description: "Currency code (GHS, USD, EUR, etc.)" },
        hsCode: { type: "string", description: "HS code prefix filter" },
        portOfEntry: { type: "string", description: "Port of entry filter" },
        countryOfOrigin: { type: "string", description: "Country of origin (ISO-3166 alpha-3)" },
      },
      required: [],
      additionalProperties: false,
    },
    aggregation: {
      type: "string",
      enum: ["list", "count", "sum", "average"],
      description: "How to aggregate the results",
    },
    aggregationField: {
      type: "string",
      description: "Field to aggregate on (e.g. amount, dutyAmount, riskScore)",
    },
    limit: {
      type: "integer",
      description: "Maximum number of results to return (default 20, max 100)",
    },
    explanation: {
      type: "string",
      description: "A brief human-readable explanation of what query was understood",
    },
  },
  required: ["queryType", "filters", "aggregation", "explanation"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a trade finance data analyst assistant for TradeGateway NGSWTP — a customs single window platform.
Your job is to translate natural language questions into structured query parameters.

Available data:
- payments: id, amount, currency, paymentMethod, status (pending/confirmed/failed/refunded), reference, confirmedAt, createdAt
- declarations: id, declarationNumber, declarationType (import/export/transit), status, riskLane (green/yellow/red/blue), riskScore (0-100), hsCode, goodsDescription, countryOfOrigin, portOfEntry, invoiceValue, dutyAmount, vatAmount, totalDue, submittedAt, clearedAt
- transactions (Mojaloop): transferId, fspId, fspName, amount, currency, status (PENDING/COMPLETED/FAILED/EXPIRED), payerName, createdAt
- duties: aggregated duty/VAT/levy amounts from declarations

Time references:
- "last month" = previous calendar month
- "this month" = current month
- "Q1 2026" = 2026-01-01 to 2026-03-31
- "this year" = current year
- "yesterday" = previous day
- "last week" = Mon-Sun of previous week

Always extract the most specific filters possible. If the question is ambiguous, make reasonable assumptions.
Return today's date context: ${new Date().toISOString().slice(0, 10)}`;

export const nlQueryRouter = router({
  /**
   * Parse a natural language query and return structured results.
   * The LLM extracts query intent, then we execute against the DB.
   */
  query: protectedProcedure
    .input(
      z.object({
        question: z.string().min(3).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Step 1: Use LLM to parse the natural language query
      let parsed: {
        queryType: string;
        filters: Record<string, any>;
        aggregation: string;
        aggregationField?: string;
        limit?: number;
        explanation: string;
      };

      try {
        const llmResponse = await invokeLLM({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [{ type: "text" as const, text: `Parse this query into structured parameters: "${input.question}"` }],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "nl_query_params",
              strict: true,
              schema: NL_QUERY_SCHEMA,
            },
          },
        });

        const rawContent = llmResponse?.choices?.[0]?.message?.content;
        if (!rawContent) throw new Error("No LLM response");
        const content: string = typeof rawContent === "string" ? rawContent : ((rawContent as any)[0]?.text ?? "");
        if (!content) throw new Error("Empty LLM response");
        parsed = JSON.parse(content);
      } catch (e: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to parse query: ${e.message}`,
        });
      }

      // Step 2: Execute the structured query against the DB
      const { getDb } = await import("../db");
      const { declarations, payments, mojaloopTransactions } = await import("../../drizzle/schema");
      const { and, eq, gte, lte, sql, count: countFn, sum: sumFn, avg: avgFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "finance";
      const limit = Math.min(parsed.limit ?? 20, 100);

      // Build date conditions helper
      const buildDateConditions = (dateField: any, filters: Record<string, any>) => {
        const conds: any[] = [];
        if (filters.dateFrom) conds.push(gte(dateField, new Date(filters.dateFrom)));
        if (filters.dateTo) {
          const dt = new Date(filters.dateTo);
          dt.setHours(23, 59, 59, 999);
          conds.push(lte(dateField, dt));
        }
        return conds;
      };

      let results: any[] = [];
      let summary: Record<string, any> = {};

      if (parsed.queryType === "payments") {
        const conditions: any[] = [];
        if (!isAdmin) conditions.push(eq(payments.traderId, ctx.user.id));
        if (parsed.filters.status) conditions.push(eq(payments.status, parsed.filters.status as any));
        if (parsed.filters.currency) conditions.push(eq(payments.currency, parsed.filters.currency));
        conditions.push(...buildDateConditions(payments.createdAt, parsed.filters));

        if (parsed.aggregation === "count") {
          const [r] = await db.select({ count: countFn() }).from(payments)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { count: Number(r?.count ?? 0) };
        } else if (parsed.aggregation === "sum") {
          const [r] = await db.select({ total: sumFn(payments.amount) }).from(payments)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { total: r?.total ?? "0", currency: parsed.filters.currency ?? "GHS" };
        } else {
          results = await db.select({
            id: payments.id,
            amount: payments.amount,
            currency: payments.currency,
            paymentMethod: payments.paymentMethod,
            status: payments.status,
            reference: payments.reference,
            confirmedAt: payments.confirmedAt,
            createdAt: payments.createdAt,
          }).from(payments)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(payments.createdAt)
            .limit(limit);
        }

      } else if (parsed.queryType === "declarations" || parsed.queryType === "duties" || parsed.queryType === "clearance_stats") {
        const conditions: any[] = [];
        if (!isAdmin) conditions.push(eq(declarations.traderId, ctx.user.id));
        if (parsed.filters.status) conditions.push(eq(declarations.status, parsed.filters.status as any));
        if (parsed.filters.riskLane && parsed.filters.riskLane !== "all") {
          conditions.push(eq(declarations.riskLane, parsed.filters.riskLane as any));
        }
        if (parsed.filters.hsCode) conditions.push(sql`${declarations.hsCode} LIKE ${parsed.filters.hsCode + "%"}`);
        if (parsed.filters.portOfEntry) conditions.push(eq(declarations.portOfEntry, parsed.filters.portOfEntry));
        if (parsed.filters.countryOfOrigin) conditions.push(eq(declarations.countryOfOrigin, parsed.filters.countryOfOrigin));
        conditions.push(...buildDateConditions(declarations.submittedAt, parsed.filters));

        if (parsed.aggregation === "count") {
          const [r] = await db.select({ count: countFn() }).from(declarations)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { count: Number(r?.count ?? 0) };
        } else if (parsed.aggregation === "sum") {
          const field = parsed.aggregationField === "dutyAmount" ? declarations.dutyAmount
            : parsed.aggregationField === "vatAmount" ? declarations.vatAmount
            : parsed.aggregationField === "totalDue" ? declarations.totalDue
            : declarations.invoiceValue;
          const [r] = await db.select({ total: sumFn(field) }).from(declarations)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { total: r?.total ?? "0" };
        } else {
          results = await db.select({
            id: declarations.id,
            declarationNumber: declarations.declarationNumber,
            declarationType: declarations.declarationType,
            status: declarations.status,
            riskLane: declarations.riskLane,
            riskScore: declarations.riskScore,
            hsCode: declarations.hsCode,
            goodsDescription: declarations.goodsDescription,
            invoiceValue: declarations.invoiceValue,
            dutyAmount: declarations.dutyAmount,
            totalDue: declarations.totalDue,
            submittedAt: declarations.submittedAt,
            clearedAt: declarations.clearedAt,
          }).from(declarations)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(declarations.createdAt)
            .limit(limit);
        }

      } else if (parsed.queryType === "transactions") {
        const conditions: any[] = [];
        if (!isAdmin) conditions.push(eq(mojaloopTransactions.initiatedBy, ctx.user.id));
        if (parsed.filters.status) conditions.push(eq(mojaloopTransactions.status, parsed.filters.status as any));
        conditions.push(...buildDateConditions(mojaloopTransactions.createdAt, parsed.filters));

        if (parsed.aggregation === "count") {
          const [r] = await db.select({ count: countFn() }).from(mojaloopTransactions)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { count: Number(r?.count ?? 0) };
        } else if (parsed.aggregation === "sum") {
          const [r] = await db.select({ total: sumFn(mojaloopTransactions.amount) }).from(mojaloopTransactions)
            .where(conditions.length > 0 ? and(...conditions) : undefined);
          summary = { total: r?.total ?? "0" };
        } else {
          results = await db.select({
            id: mojaloopTransactions.id,
            transferId: mojaloopTransactions.transferId,
            fspName: mojaloopTransactions.fspName,
            amount: mojaloopTransactions.amount,
            currency: mojaloopTransactions.currency,
            status: mojaloopTransactions.status,
            payerName: mojaloopTransactions.payerName,
            createdAt: mojaloopTransactions.createdAt,
          }).from(mojaloopTransactions)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(mojaloopTransactions.createdAt)
            .limit(limit);
        }
      }

      // Persist query to history
      try {
        const { nlQueryHistory } = await import("../../drizzle/schema");
        await db.insert(nlQueryHistory).values({
          userId: ctx.user.id,
          query: input.question,
          sql: JSON.stringify({ queryType: parsed.queryType, filters: parsed.filters, aggregation: parsed.aggregation }),
          resultCount: results.length,
          success: true,
        });
      } catch { /* non-fatal */ }

      return {
        question: input.question,
        explanation: parsed.explanation,
        queryType: parsed.queryType,
        aggregation: parsed.aggregation,
        filters: parsed.filters,
        results,
        summary,
        rowCount: results.length,
        hasAggregation: parsed.aggregation !== "list",
      };
    }),

  /**
   * Get suggested example queries for the current user's role.
   */
  getSuggestions: protectedProcedure
    .query(({ ctx }) => {
      const isAdmin = ctx.user.role === "admin" || ctx.user.role === "finance";
      const isOfficer = ctx.user.role === "customs_officer";

      if (isAdmin) {
        return {
          suggestions: [
            "What is the total duty revenue collected this month?",
            "Show me all failed payments in the last 7 days",
            "How many declarations were cleared via green lane this year?",
            "List declarations with risk score above 80 submitted last week",
            "What is the average invoice value for imports from China?",
            "Show me all pending payments over $10,000",
            "How many traders submitted declarations this month?",
            "What is the total VAT collected in Q1 2026?",
          ],
        };
      }

      if (isOfficer) {
        return {
          suggestions: [
            "Show me all red lane declarations submitted today",
            "How many declarations are pending examination?",
            "List declarations from China with HS code 8471",
            "Show me all declarations cleared in the last 24 hours",
            "How many declarations are in docs_required status?",
          ],
        };
      }

      return {
        suggestions: [
          "Show me all my payments from last month",
          "What is my total duty paid this year?",
          "List my failed payments",
          "How many of my declarations were cleared via green lane?",
          "Show me my pending declarations",
          "What is my total invoice value for imports this quarter?",
          "Show me my Mojaloop transactions from last week",
          "How many declarations did I submit this month?",
        ],
      };
    }),

  /**
   * Get query history for the current user (last 20 queries from DB).
   */
  getHistory: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const { getDb } = await import("../db");
        const db = await getDb();
        if (!db) return { history: [] };
        const { nlQueryHistory } = await import("../../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        const rows = await db
          .select()
          .from(nlQueryHistory)
          .where(eq(nlQueryHistory.userId, ctx.user.id))
          .orderBy(desc(nlQueryHistory.createdAt))
          .limit(20);
        return {
          history: rows.map(r => ({
            id: r.id,
            question: r.query,
            queryType: r.sql ? (() => { try { return JSON.parse(r.sql).queryType; } catch { return "unknown"; } })() : "unknown",
            rowCount: r.resultCount ?? 0,
            success: r.success,
            createdAt: r.createdAt,
          })),
        };
      } catch {
        return { history: [] };
      }
    }),
});
