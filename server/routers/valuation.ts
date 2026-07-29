/**
 * valuation.ts — Customs Valuation Database tRPC Router
 *
 * TradeGateway NGSWTP — Provides access to the customs valuation reference
 * database used by NCS to verify declared values against market benchmarks.
 *
 * The valuation database stores:
 *   - Reference prices for HS codes (WTO Customs Valuation Agreement)
 *   - Historical transaction values for statistical analysis
 *   - Suspected undervaluation alerts
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { valuationReferences } from "../../drizzle/schema";
import { eq, ilike, like, or, count, sql } from "drizzle-orm";

export const valuationRouter = router({
  /**
   * getReference — Get reference price for an HS code.
   */
  getReference: protectedProcedure
    .input(z.object({
      hsCode: z.string().min(4).max(10),
      countryOfOrigin: z.string().length(2).optional(),
      currency: z.string().length(3).default("USD"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Search by exact HS code first, then by chapter (first 4 digits)
      const chapter = input.hsCode.substring(0, 4);
      const rows = await db
        .select()
        .from(valuationReferences)
        .where(like(valuationReferences.hsCode, `${chapter}%`))
        .limit(10);

      return {
        hsCode: input.hsCode,
        references: rows,
        count: rows.length,
      };
    }),

  /**
   * search — Search valuation database by commodity description or HS code.
   */
  search: protectedProcedure
    .input(z.object({
      query: z.string().min(2),
      limit: z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { results: [], total: 0 };

      const rows = await db
        .select()
        .from(valuationReferences)
        .where(or(
          ilike(valuationReferences.description, `%${input.query}%`),
          ilike(valuationReferences.hsCode, `%${input.query}%`),
        ))
        .limit(input.limit);

      return { results: rows, total: rows.length };
    }),

  /**
   * checkUndervaluation — Check if a declared value is below the reference price.
   * Returns a flag and discrepancy percentage if the value is suspicious.
   */
  checkUndervaluation: protectedProcedure
    .input(z.object({
      hsCode: z.string().min(4),
      declaredValue: z.number().positive(),
      weightKg: z.number().positive().optional(),
      currency: z.string().length(3).default("USD"),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { flagged: false, reason: "DB unavailable" };

      const chapter = input.hsCode.substring(0, 4);
      const refs = await db
        .select()
        .from(valuationReferences)
        .where(like(valuationReferences.hsCode, `${chapter}%`))
        .limit(5);

      if (refs.length === 0) {
        return { flagged: false, reason: "No reference data available for this HS code" };
      }

      const avgRefPrice = refs.reduce((sum, r) => sum + Number(r.referencePrice || 0), 0) / refs.length;
      const threshold = avgRefPrice * 0.7; // Flag if declared value is < 70% of reference

      if (input.declaredValue < threshold) {
        const discrepancyPct = ((avgRefPrice - input.declaredValue) / avgRefPrice * 100).toFixed(1);
        return {
          flagged: true,
          reason: `Declared value ${input.declaredValue} ${input.currency} is ${discrepancyPct}% below reference price ${avgRefPrice.toFixed(2)} ${input.currency}`,
          referencePrice: avgRefPrice,
          declaredValue: input.declaredValue,
          discrepancyPct,
          riskLevel: Number(discrepancyPct) > 50 ? "HIGH" : "MEDIUM",
        };
      }

      return {
        flagged: false,
        referencePrice: avgRefPrice,
        declaredValue: input.declaredValue,
        discrepancyPct: "0.0",
        riskLevel: "LOW",
      };
    }),

  /**
   * upsertReference — Admin: Add or update a valuation reference.
   */
  upsertReference: adminProcedure
    .input(z.object({
      hsCode: z.string().min(4).max(10),
      description: z.string().min(1),
      referencePrice: z.number().positive(),
      currency: z.string().length(3).default("USD"),
      unit: z.string().max(32).default("kg"),
      source: z.string().max(128).optional(),
      validFrom: z.string().datetime().optional(),
      validTo: z.string().datetime().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [row] = await db
        .insert(valuationReferences)
        .values({
          hsCode: input.hsCode,
          description: input.description,
          referencePrice: String(input.referencePrice),
          currency: input.currency,
          unit: input.unit,
          source: input.source ?? "NCS",
          validFrom: input.validFrom ? new Date(input.validFrom) : new Date(),
          validTo: input.validTo ? new Date(input.validTo) : null,
        })
        .onConflictDoUpdate({
          target: valuationReferences.hsCode,
          set: {
            description: input.description,
            referencePrice: String(input.referencePrice),
            currency: input.currency,
            unit: input.unit,
            source: input.source ?? "NCS",
            updatedAt: new Date(),
          },
        })
        .returning();

      return row;
    }),

  /**
   * list — List all valuation references (paginated).
   */
  list: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { references: [], total: 0 };

      const limit = input?.limit ?? 50;
      const offset = input?.offset ?? 0;

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(valuationReferences).limit(limit).offset(offset),
        db.select({ total: count() }).from(valuationReferences),
      ]);

      return { references: rows, total };
    }),

  /**
   * deleteReference — Admin: Delete a valuation reference.
   */
  deleteReference: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [deleted] = await db
        .delete(valuationReferences)
        .where(eq(valuationReferences.id, input.id))
        .returning();

      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "Reference not found" });
      return { deleted: true, id: input.id };
    }),
});
