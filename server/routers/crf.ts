/**
 * crf.ts — Combined Reporting Form (CRF) Management tRPC Router
 *
 * TradeGateway NGSWTP — Manages the Combined Reporting Form (CRF),
 * which is the primary document for trade statistics reporting to
 * the National Bureau of Statistics (NBS) and CBN.
 *
 * The CRF consolidates:
 *   - Customs declaration data
 *   - Payment records
 *   - Certificate data (LPCOs)
 *   - Manifest data
 * into a single statistical report per consignment.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const crfRouter = router({
  /**
   * create — Create a CRF for a declaration.
   */
  create: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      ucrNumber: z.string().optional(),
      reportingPeriod: z.string().regex(/^\d{4}-Q[1-4]$/).optional(), // e.g. "2026-Q1"
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { crfDocuments, declarations } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      // Fetch declaration data
      const [decl] = await db.select().from(declarations).where(eq(declarations.id, input.declarationId));
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });

      const period = input.reportingPeriod ?? (() => {
        const now = new Date();
        const q = Math.ceil((now.getMonth() + 1) / 3);
        return `${now.getFullYear()}-Q${q}`;
      })();

      const crfNumber = `CRF-${period}-${Date.now().toString(36).toUpperCase()}`;

      const [crf] = await db.insert(crfDocuments).values({
        crfNumber,
        declarationId: input.declarationId,
        ucrNumber: input.ucrNumber,
        traderId: ctx.user.id,
        reportingPeriod: period,
        hsCode: decl.hsCode,
        declaredValue: decl.declaredValue,
        currency: decl.currency ?? "USD",
        countryOfOrigin: decl.countryOfOrigin,
        portOfEntry: decl.portOfDestination,
        status: "DRAFT",
      }).returning();

      return crf;
    }),

  /**
   * get — Get a CRF by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { crfDocuments } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [crf] = await db.select().from(crfDocuments).where(eq(crfDocuments.id, input.id));
      if (!crf) throw new TRPCError({ code: "NOT_FOUND", message: "CRF not found" });
      return crf;
    }),

  /**
   * submit — Submit a CRF to NBS/CBN.
   */
  submit: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { crfDocuments } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");

      const [updated] = await db
        .update(crfDocuments)
        .set({ status: "SUBMITTED", submittedAt: new Date() })
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
      period: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) return { crfs: [], total: 0 };

      const { crfDocuments } = await import("../../drizzle/schema");
      const { eq, desc, and } = await import("drizzle-orm");

      const conditions = [eq(crfDocuments.traderId, ctx.user.id)];
      if (input?.status) conditions.push(eq(crfDocuments.status, input.status));

      const rows = await db
        .select()
        .from(crfDocuments)
        .where(and(...conditions))
        .orderBy(desc(crfDocuments.createdAt))
        .limit(input?.limit ?? 20);

      return { crfs: rows, total: rows.length };
    }),

  /**
   * listAll — Admin: List all CRFs with filters.
   */
  listAll: adminProcedure
    .input(z.object({
      period: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) return { crfs: [], total: 0 };

      const { crfDocuments } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");

      const rows = await db
        .select()
        .from(crfDocuments)
        .orderBy(desc(crfDocuments.createdAt))
        .limit(input?.limit ?? 100);

      return { crfs: rows, total: rows.length };
    }),
});
