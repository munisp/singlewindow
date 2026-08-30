/**
 * opensearch.ts — OpenSearch query procedures for TradeGateway NGSWTP
 *
 * Exposes tRPC procedures for full-text search across:
 *   - Audit trail events (indexed by _writeAuditLog in trpc.ts)
 *   - Declarations (indexed on submit/update)
 *   - Security alerts (indexed by Wazuh/SOC pipeline)
 *
 * All procedures are admin-only (protectedProcedure + role check).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { searchDocuments, OpenSearchUnavailableError } from "../_core/opensearch";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function requireAdmin(role: string | null | undefined) {
  if (role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  }
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

export const opensearchRouter = router({
  /**
   * Full-text search across the audit-trail index.
   * Supports free-text query, actor filter, entity-type filter, and date range.
   */
  searchAuditTrail: protectedProcedure
    .input(
      z.object({
        query: z.string().max(500).optional(),
        actorId: z.number().int().optional(),
        entityType: z.string().max(100).optional(),
        action: z.string().max(100).optional(),
        fromDate: z.string().datetime().optional(), // ISO-8601
        toDate: z.string().datetime().optional(),   // ISO-8601
        limit: z.number().int().min(1).max(200).default(50),
        from: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.user?.role);

      const must: object[] = [];
      const filter: object[] = [];

      // Full-text across action + entityType fields
      if (input.query && input.query.trim()) {
        must.push({
          multi_match: {
            query: input.query.trim(),
            fields: ["action", "entityType", "actorType", "ipAddress"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        });
      }

      if (input.actorId !== undefined) {
        filter.push({ term: { actorId: input.actorId } });
      }
      if (input.entityType) {
        filter.push({ term: { entityType: input.entityType } });
      }
      if (input.action) {
        filter.push({ term: { action: input.action } });
      }
      if (input.fromDate || input.toDate) {
        const range: Record<string, string> = {};
        if (input.fromDate) range.gte = input.fromDate;
        if (input.toDate) range.lte = input.toDate;
        filter.push({ range: { "@timestamp": range } });
      }

      const body: Record<string, unknown> = {
        query: {
          bool: {
            must: must.length ? must : [{ match_all: {} }],
            filter,
          },
        },
        sort: [{ "@timestamp": { order: "desc" } }],
        size: input.limit,
        from: input.from,
        highlight: {
          fields: {
            action: {},
            entityType: {},
          },
        },
      };

      let result: Awaited<ReturnType<typeof searchDocuments>>;
      try {
        result = await searchDocuments("tradegateway-audit-events", body);
      } catch (err) {
        if (err instanceof OpenSearchUnavailableError) {
          // PRA-110: typed outage — UI shows a degraded banner; never
          // empty-results-on-outage (that would hide a cluster-down incident).
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: `AUDIT_SEARCH_UNAVAILABLE: ${err.message}`,
          });
        }
        throw err;
      }
      return {
        hits: result.hits as Array<{
          id: number;
          entityType: string;
          entityId: number;
          action: string;
          actorId?: number | null;
          actorType?: string | null;
          ipAddress?: string | null;
          createdAt: string;
          _score?: number;
          _highlight?: Record<string, string[]>;
        }>,
        total: result.total,
        from: input.from,
        limit: input.limit,
      };
    }),

  /**
   * Full-text search across the declarations index.
   */
  searchDeclarations: protectedProcedure
    .input(
      z.object({
        query: z.string().max(500).optional(),
        status: z.string().max(50).optional(),
        riskLane: z.enum(["green", "yellow", "red"]).optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        from: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.user?.role);

      const must: object[] = [];
      const filter: object[] = [];

      if (input.query && input.query.trim()) {
        must.push({
          multi_match: {
            query: input.query.trim(),
            fields: [
              "declarationNumber^3",
              "ucr^2",
              "goodsDescription",
              "hsCode",
              "countryOfOrigin",
              "portOfEntry",
            ],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        });
      }

      if (input.status) filter.push({ term: { status: input.status } });
      if (input.riskLane) filter.push({ term: { riskLane: input.riskLane } });
      if (input.fromDate || input.toDate) {
        const range: Record<string, string> = {};
        if (input.fromDate) range.gte = input.fromDate;
        if (input.toDate) range.lte = input.toDate;
        filter.push({ range: { submittedAt: range } });
      }

      const body: Record<string, unknown> = {
        query: {
          bool: {
            must: must.length ? must : [{ match_all: {} }],
            filter,
          },
        },
        sort: [{ submittedAt: { order: "desc" } }],
        size: input.limit,
        from: input.from,
        highlight: {
          fields: {
            declarationNumber: {},
            goodsDescription: {},
            ucr: {},
          },
        },
      };

      const result = await searchDocuments("tradegateway-declarations", body);
      return {
        hits: result.hits as Array<{
          declarationNumber: string;
          ucr?: string;
          status: string;
          riskLane?: string;
          riskScore?: number;
          goodsDescription?: string;
          hsCode?: string;
          submittedAt?: string;
          _score?: number;
          _highlight?: Record<string, string[]>;
        }>,
        total: result.total,
        from: input.from,
        limit: input.limit,
      };
    }),

  /**
   * Full-text search across the security-alerts index.
   */
  searchSecurityAlerts: protectedProcedure
    .input(
      z.object({
        query: z.string().max(500).optional(),
        severity: z.enum(["low", "medium", "high", "critical"]).optional(),
        category: z.string().max(100).optional(),
        fromDate: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(200).default(50),
        from: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      requireAdmin(ctx.user?.role);

      const must: object[] = [];
      const filter: object[] = [];

      if (input.query && input.query.trim()) {
        must.push({
          multi_match: {
            query: input.query.trim(),
            fields: ["title^2", "description", "sourceIp", "targetService", "ruleId"],
            type: "best_fields",
            fuzziness: "AUTO",
          },
        });
      }

      if (input.severity) filter.push({ term: { severity: input.severity } });
      if (input.category) filter.push({ term: { category: input.category } });
      if (input.fromDate || input.toDate) {
        const range: Record<string, string> = {};
        if (input.fromDate) range.gte = input.fromDate;
        if (input.toDate) range.lte = input.toDate;
        filter.push({ range: { "@timestamp": range } });
      }

      const body: Record<string, unknown> = {
        query: {
          bool: {
            must: must.length ? must : [{ match_all: {} }],
            filter,
          },
        },
        sort: [{ "@timestamp": { order: "desc" } }],
        size: input.limit,
        from: input.from,
        highlight: {
          fields: { title: {}, description: {} },
        },
      };

      const result = await searchDocuments("tradegateway-security-alerts", body);
      return {
        hits: result.hits as Array<{
          alertId: string;
          severity: string;
          category: string;
          title: string;
          description?: string;
          sourceIp?: string;
          targetService?: string;
          createdAt: string;
          _score?: number;
          _highlight?: Record<string, string[]>;
        }>,
        total: result.total,
        from: input.from,
        limit: input.limit,
      };
    }),
});
