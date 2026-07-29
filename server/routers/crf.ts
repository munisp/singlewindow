/**
 * crf.ts — Combined Reporting Form (CRF) Management tRPC Router
 *
 * TradeGateway NGSWTP — Manages the Combined Reporting Form (CRF),
 * which is the primary document for trade statistics reporting to
 * the National Bureau of Statistics (NBS) and CBN.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { crfDocuments, declarations } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";

function getCurrentQuarter(): string {
  const now = new Date();
  const q = Math.ceil((now.getMonth() + 1) / 3);
  return `${now.getFullYear()}-Q${q}`;
}

export const crfRouter = router({
  /**
   * create — Create a CRF for a declaration.
   */
  create: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      ucrNumber: z.string().optional(),
      reportingPeriod: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch declaration data to pre-populate CRF
      const [decl] = await db
        .select()
        .from(declarations)
        .where(eq(declarations.id, input.declarationId));

      if (!decl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      }

      const period = input.reportingPeriod ?? getCurrentQuarter();
      const crfNumber = `CRF-${period}-${Date.now().toString(36).toUpperCase()}`;

      const [crf] = await db.insert(crfDocuments).values({
        crfNumber,
        declarationId: input.declarationId,
        ucrNumber: input.ucrNumber ?? null,
        traderId: ctx.user.id,
        reportingPeriod: period,
        hsCode: decl.hsCode ?? null,
        declaredValue: decl.invoiceValue ?? null,
        currency: decl.invoiceCurrency ?? "USD",
        countryOfOrigin: decl.countryOfOrigin ?? null,
        portOfEntry: decl.portOfEntry ?? null,
        status: "DRAFT",
      }).returning();

      return crf;
    }),

  /**
   * get — Get a CRF by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [crf] = await db
        .select()
        .from(crfDocuments)
        .where(eq(crfDocuments.id, input.id));

      if (!crf) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });

      // Ensure the user owns this CRF or is an admin
      if (crf.traderId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      return crf;
    }),

  /**
   * getByNumber — Get a CRF by CRF number.
   */
  getByNumber: protectedProcedure
    .input(z.object({ crfNumber: z.string().min(1) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [crf] = await db
        .select()
        .from(crfDocuments)
        .where(eq(crfDocuments.crfNumber, input.crfNumber));

      if (!crf) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });
      return crf;
    }),

  /**
   * submit — Submit a CRF to NBS/CBN.
   */
  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Verify ownership
      const [existing] = await db
        .select({ traderId: crfDocuments.traderId, status: crfDocuments.status })
        .from(crfDocuments)
        .where(eq(crfDocuments.id, input.id));

      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });
      if (existing.traderId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      if (existing.status !== "DRAFT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `CRF is already ${existing.status}` });
      }

      const [updated] = await db
        .update(crfDocuments)
        .set({ status: "SUBMITTED", submittedAt: new Date() })
        .where(eq(crfDocuments.id, input.id))
        .returning();

      return updated;
    }),

  /**
   * accept — NBS/CBN officer accepts a CRF.
   */
  accept: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [updated] = await db
        .update(crfDocuments)
        .set({ status: "ACCEPTED", acceptedAt: new Date() })
        .where(eq(crfDocuments.id, input.id))
        .returning();

      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });
      return updated;
    }),

  /**
   * reject — NBS/CBN officer rejects a CRF.
   */
  reject: adminProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: z.string().min(1).max(512),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [updated] = await db
        .update(crfDocuments)
        .set({ status: "REJECTED", rejectedAt: new Date(), rejectionReason: input.reason })
        .where(eq(crfDocuments.id, input.id))
        .returning();

      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });
      return updated;
    }),

  /**
   * list — List CRFs for the authenticated user.
   */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED"]).optional(),
      period: z.string().regex(/^\d{4}-Q[1-4]$/).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { crfs: [], total: 0 };

      const conditions = [eq(crfDocuments.traderId, ctx.user.id)];
      if (input?.status) conditions.push(eq(crfDocuments.status, input.status));
      if (input?.period) conditions.push(eq(crfDocuments.reportingPeriod, input.period));

      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(crfDocuments)
          .where(and(...conditions))
          .orderBy(desc(crfDocuments.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(crfDocuments).where(and(...conditions)),
      ]);

      return { crfs: rows, total };
    }),

  /**
   * listAll — Admin: List all CRFs with filters.
   */
  listAll: adminProcedure
    .input(z.object({
      period: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { crfs: [], total: 0 };

      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(crfDocuments)
          .orderBy(desc(crfDocuments.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(crfDocuments),
      ]);

      return { crfs: rows, total };
    }),

  /**
   * getStats — Get CRF statistics by period.
   */
  getStats: adminProcedure
    .input(z.object({ period: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { total: 0, byStatus: {} };

      const period = input?.period ?? getCurrentQuarter();
      const rows = await db
        .select({ status: crfDocuments.status, count: count() })
        .from(crfDocuments)
        .where(eq(crfDocuments.reportingPeriod, period))
        .groupBy(crfDocuments.status);

      const byStatus: Record<string, number> = {};
      let total = 0;
      for (const row of rows) {
        byStatus[row.status] = row.count;
        total += row.count;
      }

      return { period, total, byStatus };
    }),
});
