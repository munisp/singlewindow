import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { originCertificates, originCertStatusEnum, originCertTypeEnum, originCriteriaMet, type OriginCertificate } from "../../drizzle/schema";
import { eq, desc, and, or, ilike, count } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generateCertificatePdf } from "../lib/certificatePdf";

const certTypeValues = originCertTypeEnum.enumValues;
const certStatusValues = originCertStatusEnum.enumValues;
const originCriteriaValues = originCriteriaMet.enumValues;

export const rulesOfOriginRouter = router({
  // Submit a new certificate of origin
  submitCertificate: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().optional(),
      certType: z.enum(certTypeValues).default("afcfta_co"),
      exporterName: z.string().min(2).max(256),
      exporterAddress: z.string().min(5),
      importerName: z.string().min(2).max(256),
      importerAddress: z.string().min(5),
      originCountry: z.string().length(3),
      destinationCountry: z.string().length(3),
      hsCode: z.string().min(4).max(16),
      goodsDescription: z.string().min(10),
      grossWeight: z.string().optional(),
      netWeight: z.string().optional(),
      quantity: z.string().optional(),
      invoiceNumber: z.string().optional(),
      invoiceDate: z.date().optional(),
      originCriteria: z.enum(originCriteriaValues).default("substantial_transformation"),
      localValueAddedPct: z.number().int().min(0).max(100).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const certNumber = `CO-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      const [cert] = await (await getDb())!.insert(originCertificates).values({
        traderId: ctx.user.id,
        declarationId: input.declarationId ?? null,
        certType: input.certType,
        status: "submitted",
        certNumber,
        exporterName: input.exporterName,
        exporterAddress: input.exporterAddress,
        importerName: input.importerName,
        importerAddress: input.importerAddress,
        originCountry: input.originCountry,
        destinationCountry: input.destinationCountry,
        hsCode: input.hsCode,
        goodsDescription: input.goodsDescription,
        grossWeight: input.grossWeight ?? null,
        netWeight: input.netWeight ?? null,
        quantity: input.quantity ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceDate: input.invoiceDate ?? null,
        originCriteria: input.originCriteria,
        localValueAddedPct: input.localValueAddedPct ?? null,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      }).returning();
      return cert;
    }),

  // Get all certificates for the current trader
  getMyCertificates: protectedProcedure
    .input(z.object({
      status: z.enum(certStatusValues).optional(),
      search: z.string().optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = [eq(originCertificates.traderId, ctx.user.id)];
      if (input.status) conditions.push(eq(originCertificates.status, input.status));
      if (input.search) {
        conditions.push(
          or(
            ilike(originCertificates.certNumber, `%${input.search}%`),
            ilike(originCertificates.goodsDescription, `%${input.search}%`),
            ilike(originCertificates.hsCode, `%${input.search}%`)
          )!
        );
      }
      const certs = await (await getDb())!
        .select()
        .from(originCertificates)
        .where(and(...conditions))
        .orderBy(desc(originCertificates.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return certs;
    }),

  // Get a single certificate by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const [cert] = await (await getDb())!
        .select()
        .from(originCertificates)
        .where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      // Traders can only see their own; OGA officers and admins can see all
      if (cert.traderId !== ctx.user.id && !["oga_officer", "admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return cert;
    }),

  // Get certificates linked to a declaration
  getByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const certs = await (await getDb())!
        .select()
        .from(originCertificates)
        .where(eq(originCertificates.declarationId, input.declarationId))
        .orderBy(desc(originCertificates.createdAt));
      return certs;
    }),

  // OGA officer: list pending certificates for review
  listPending: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (!["oga_officer", "admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const certs = await (await getDb())!
        .select()
        .from(originCertificates)
        .where(or(
          eq(originCertificates.status, "submitted"),
          eq(originCertificates.status, "under_review")
        )!)
        .orderBy(desc(originCertificates.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return certs;
    }),

  // OGA officer: review (approve/reject) a certificate
  review: protectedProcedure
    .input(z.object({
      id: z.number().int(),
      decision: z.enum(["approved", "rejected"]),
      reviewNotes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!["oga_officer", "admin"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const [cert] = await (await getDb())!
        .select()
        .from(originCertificates)
        .where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND" });
      const [updated] = await (await getDb())!
        .update(originCertificates)
        .set({
          status: input.decision,
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          approvedAt: input.decision === "approved" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(originCertificates.id, input.id))
        .returning();
      return updated;
    }),

  // Verify a certificate by cert number (public lookup)
  verify: protectedProcedure
    .input(z.object({ certNumber: z.string() }))
    .query(async ({ input }) => {
      const [cert] = await (await getDb())!
        .select({
          id: originCertificates.id,
          certNumber: originCertificates.certNumber,
          certType: originCertificates.certType,
          status: originCertificates.status,
          exporterName: originCertificates.exporterName,
          importerName: originCertificates.importerName,
          originCountry: originCertificates.originCountry,
          destinationCountry: originCertificates.destinationCountry,
          hsCode: originCertificates.hsCode,
          goodsDescription: originCertificates.goodsDescription,
          originCriteria: originCertificates.originCriteria,
          approvedAt: originCertificates.approvedAt,
          expiresAt: originCertificates.expiresAt,
        })
        .from(originCertificates)
        .where(eq(originCertificates.certNumber, input.certNumber));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      return cert;
    }),

  // Generate a WTO-compliant PDF for an approved certificate
  generatePdf: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [cert] = await db
        .select()
        .from(originCertificates)
        .where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      // Traders can only download their own; OGA officers and admins can download any
      if (cert.traderId !== ctx.user.id && !["oga_officer", "admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const pdfBuffer = await generateCertificatePdf(cert);
      // Return as base64 so it can be decoded and downloaded in the browser
      return {
        base64: pdfBuffer.toString("base64"),
        filename: `CO-${cert.certNumber ?? cert.id}.pdf`,
        mimeType: "application/pdf",
        certNumber: cert.certNumber,
        status: cert.status,
      };
    }),

  // Admin: revoke an approved certificate
  revokeCertificate: adminProcedure
    .input(z.object({
      id: z.number().int(),
      reason: z.string().min(10, "Reason must be at least 10 characters").max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [cert] = await db
        .select()
        .from(originCertificates)
        .where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      if (cert.status !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot revoke a certificate with status '${cert.status}'. Only approved certificates can be revoked.`,
        });
      }
      const [updated] = await db
        .update(originCertificates)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          revokedBy: ctx.user.id,
          revocationReason: input.reason,
          updatedAt: new Date(),
        })
        .where(eq(originCertificates.id, input.id))
        .returning();
      return {
        id: updated.id,
        certNumber: updated.certNumber,
        status: updated.status,
        revokedAt: updated.revokedAt,
        revocationReason: updated.revocationReason,
      };
    }),

  // Admin: list all revoked certificates (paginated)
  listRevoked: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const offset = (input.page - 1) * input.pageSize;
      const rows = await db
        .select({
          id: originCertificates.id,
          certNumber: originCertificates.certNumber,
          certType: originCertificates.certType,
          exporterName: originCertificates.exporterName,
          importerName: originCertificates.importerName,
          originCountry: originCertificates.originCountry,
          approvedAt: originCertificates.approvedAt,
          revokedAt: originCertificates.revokedAt,
          revokedBy: originCertificates.revokedBy,
          revocationReason: originCertificates.revocationReason,
        })
        .from(originCertificates)
        .where(eq(originCertificates.status, "revoked"))
        .orderBy(desc(originCertificates.revokedAt))
        .limit(input.pageSize)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(originCertificates)
        .where(eq(originCertificates.status, "revoked"));
      return {
        rows,
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(Number(total) / input.pageSize),
      };
    }),

  // Get scan count for a certificate (public)
  getCertScanCount: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const [cert] = await db
        .select({ scanCount: originCertificates.scanCount })
        .from(originCertificates)
        .where(eq(originCertificates.id, input.id));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND" });
      return { scanCount: cert.scanCount ?? 0 };
    }),

  // Get summary stats for the OGA dashboard
  getStats: protectedProcedure
    .query(async ({ ctx }) => {
      if (!["oga_officer", "admin", "customs_officer"].includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const all = await (await getDb())!.select().from(originCertificates);
      const stats = {
        total: all.length,
        draft: all.filter((c: OriginCertificate) => c.status === "draft").length,
        submitted: all.filter((c: OriginCertificate) => c.status === "submitted").length,
        underReview: all.filter((c: OriginCertificate) => c.status === "under_review").length,
        approved: all.filter((c: OriginCertificate) => c.status === "approved").length,
        rejected: all.filter((c: OriginCertificate) => c.status === "rejected").length,
        expired: all.filter((c: OriginCertificate) => c.status === "expired").length,
        byType: certTypeValues.map((t: string) => ({
          type: t,
          count: all.filter((c: OriginCertificate) => c.certType === t).length,
        })),
      };
      return stats;
    }),
});
