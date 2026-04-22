/**
 * originCertificates.ts — tRPC router for Certificate of Origin management
 * Supports AfCFTA CO, COMESA CO, ECOWAS CO, EUR.1, Form A, and bilateral COs.
 * Business rules: WTO Rules of Origin Agreement, AfCFTA Protocol on Trade in Goods
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { originCertificates, users } from "../../drizzle/schema";
import { eq, desc, and, like, count, or } from "drizzle-orm";

function generateCertNumber(certType: string): string {
  const prefix = certType.toUpperCase().replace(/_/g, "-").slice(0, 8);
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${year}-${seq}`;
}

export const originCertificatesRouter = router({
  /** List certificates for the current trader */
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["draft", "submitted", "under_review", "approved", "rejected", "expired", "revoked"]).optional(),
      certType: z.enum(["form_a", "eur1", "afcfta_co", "comesa_co", "ecowas_co", "bilateral_co"]).optional(),
      search: z.string().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions: ReturnType<typeof eq>[] = [eq(originCertificates.traderId, ctx.user.id)];
      if (input.status) conditions.push(eq(originCertificates.status, input.status));
      if (input.certType) conditions.push(eq(originCertificates.certType, input.certType));
      if (input.search) {
        conditions.push(or(
          like(originCertificates.certNumber, `%${input.search}%`),
          like(originCertificates.exporterName, `%${input.search}%`),
          like(originCertificates.importerName, `%${input.search}%`),
        ) as ReturnType<typeof eq>);
      }
      const [totalRow] = await db.select({ count: count() }).from(originCertificates).where(and(...conditions));
      const items = await db.select().from(originCertificates)
        .where(and(...conditions))
        .orderBy(desc(originCertificates.createdAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Get a single certificate */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates)
        .where(and(eq(originCertificates.id, input.id), eq(originCertificates.traderId, ctx.user.id)));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      return cert;
    }),

  /** Create a new certificate application */
  create: protectedProcedure
    .input(z.object({
      declarationId: z.number().optional(),
      certType: z.enum(["form_a", "eur1", "afcfta_co", "comesa_co", "ecowas_co", "bilateral_co"]),
      exporterName: z.string().min(1),
      exporterAddress: z.string().min(1),
      importerName: z.string().min(1),
      importerAddress: z.string().min(1),
      originCountry: z.string().length(3),
      destinationCountry: z.string().length(3),
      hsCode: z.string().min(4),
      goodsDescription: z.string().min(1),
      grossWeight: z.string().optional(),
      netWeight: z.string().optional(),
      quantity: z.string().optional(),
      invoiceNumber: z.string().optional(),
      invoiceDate: z.string().optional(),
      originCriteria: z.enum(["wholly_obtained", "substantial_transformation", "value_added_rule", "tariff_shift_rule"]),
      localValueAddedPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      // Business rule: AfCFTA CO requires minimum 35% local value added
      if (input.certType === "afcfta_co" && input.originCriteria === "value_added_rule") {
        if (!input.localValueAddedPct || input.localValueAddedPct < 35) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "AfCFTA Certificate of Origin requires minimum 35% local value added" });
        }
      }
      // Business rule: COMESA CO requires minimum 35% local value added
      if (input.certType === "comesa_co" && input.originCriteria === "value_added_rule") {
        if (!input.localValueAddedPct || input.localValueAddedPct < 35) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "COMESA CO requires minimum 35% local value added" });
        }
      }
      const [cert] = await db.insert(originCertificates).values({
        ...input,
        traderId: ctx.user.id,
        status: "draft",
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : undefined,
      }).returning();
      return cert;
    }),

  /** Update a draft certificate */
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      exporterName: z.string().optional(),
      importerName: z.string().optional(),
      goodsDescription: z.string().optional(),
      hsCode: z.string().optional(),
      grossWeight: z.string().optional(),
      netWeight: z.string().optional(),
      quantity: z.string().optional(),
      invoiceNumber: z.string().optional(),
      localValueAddedPct: z.number().min(0).max(100).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates)
        .where(and(eq(originCertificates.id, input.id), eq(originCertificates.traderId, ctx.user.id)));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      if (cert.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft certificates can be edited" });
      const { id, ...updates } = input;
      const [updated] = await db.update(originCertificates)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(originCertificates.id, id))
        .returning();
      return updated;
    }),

  /** Submit a draft certificate for review */
  submit: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates)
        .where(and(eq(originCertificates.id, input.id), eq(originCertificates.traderId, ctx.user.id)));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      if (cert.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft certificates can be submitted" });
      const [updated] = await db.update(originCertificates)
        .set({ status: "submitted", updatedAt: new Date() })
        .where(eq(originCertificates.id, input.id))
        .returning();
      return updated;
    }),

  /** Admin: list all certificates */
  adminList: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      status: z.enum(["draft", "submitted", "under_review", "approved", "rejected", "expired", "revoked"]).optional(),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const conditions = input.status ? [eq(originCertificates.status, input.status)] : [];
      const [totalRow] = await db.select({ count: count() }).from(originCertificates)
        .where(conditions.length ? and(...conditions) : undefined);
      const items = await db.select({
        cert: originCertificates,
        traderName: users.name,
      }).from(originCertificates)
        .leftJoin(users, eq(originCertificates.traderId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(originCertificates.createdAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Admin: approve or reject a certificate */
  review: adminProcedure
    .input(z.object({
      id: z.number(),
      action: z.enum(["approve", "reject"]),
      reviewNotes: z.string().optional(),
      rejectionReason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates).where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      if (!["submitted", "under_review"].includes(cert.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Certificate is not in a reviewable state" });
      }
      const expiresAt = new Date();
      expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1-year validity
      const certNumber = input.action === "approve" ? generateCertNumber(cert.certType) : undefined;
      const [updated] = await db.update(originCertificates).set({
        status: input.action === "approve" ? "approved" : "rejected",
        certNumber,
        reviewNotes: input.reviewNotes,
        reviewedBy: ctx.user.id,
        approvedAt: input.action === "approve" ? new Date() : undefined,
        expiresAt: input.action === "approve" ? expiresAt : undefined,
        updatedAt: new Date(),
      }).where(eq(originCertificates.id, input.id)).returning();
      return updated;
    }),

  /** Admin: revoke an approved certificate */
  revoke: adminProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates).where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      if (cert.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "Only approved certificates can be revoked" });
      const [updated] = await db.update(originCertificates).set({
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: ctx.user.id,
        revocationReason: input.reason,
        updatedAt: new Date(),
      }).where(eq(originCertificates.id, input.id)).returning();
      return updated;
    }),

  /** Increment scan count (used by QR code verification) */
  recordScan: protectedProcedure
    .input(z.object({ certNumber: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(originCertificates)
        .where(eq(originCertificates.certNumber, input.certNumber));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      await db.update(originCertificates)
        .set({ scanCount: (cert.scanCount ?? 0) + 1, updatedAt: new Date() })
        .where(eq(originCertificates.id, cert.id));
      return { valid: cert.status === "approved", status: cert.status, certType: cert.certType };
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0, pending: 0, approved: 0, revoked: 0 };
    const [total] = await db.select({ count: count() }).from(originCertificates);
    const [pending] = await db.select({ count: count() }).from(originCertificates).where(eq(originCertificates.status, "submitted"));
    const [approved] = await db.select({ count: count() }).from(originCertificates).where(eq(originCertificates.status, "approved"));
    const [revoked] = await db.select({ count: count() }).from(originCertificates).where(eq(originCertificates.status, "revoked"));
    return { total: total?.count ?? 0, pending: pending?.count ?? 0, approved: approved?.count ?? 0, revoked: revoked?.count ?? 0 };
  }),
});

export type OriginCertificatesRouter = typeof originCertificatesRouter;
