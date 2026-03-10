import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb, createNotification } from "../db";
import { originCertificates, originCertStatusEnum, originCertTypeEnum, originCriteriaMet, complianceEmailSchedule, complianceEmailDeliveryLog, type OriginCertificate } from "../../drizzle/schema";
import { eq, desc, and, or, ilike, count, gte, lte, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generateCertificatePdf } from "../lib/certificatePdf";
import { notifyOwner } from "../_core/notification";

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
      // Notify the certificate owner (trader) about the revocation
      if (cert.traderId) {
        await createNotification({
          userId: cert.traderId,
          type: "system",
          title: "Certificate of Origin Revoked",
          message: `Your certificate ${updated.certNumber ?? `#${updated.id}`} has been revoked. Reason: ${input.reason}`,
          read: false,
        }).catch(() => {/* non-fatal */});
      }
      // Also notify the platform owner
      await notifyOwner({
        title: `Certificate Revoked: ${updated.certNumber ?? updated.id}`,
        content: `Admin ${ctx.user.name ?? ctx.user.id} revoked certificate ${updated.certNumber ?? updated.id}. Reason: ${input.reason}`,
      }).catch(() => {/* non-fatal */});
      return {
        id: updated.id,
        certNumber: updated.certNumber,
        status: updated.status,
        revokedAt: updated.revokedAt,
        revocationReason: updated.revocationReason,
      };
    }),

  // Admin: list all revoked certificates (paginated, with optional search + date filters)
  listRevoked: protectedProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(25),
      search: z.string().optional(),
      revokedFrom: z.date().optional(),
      revokedTo: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const offset = (input.page - 1) * input.pageSize;
      // Build filter conditions
      const conditions = [eq(originCertificates.status, "revoked")];
      if (input.search) {
        conditions.push(
          or(
            ilike(originCertificates.certNumber, `%${input.search}%`),
            ilike(originCertificates.exporterName, `%${input.search}%`),
            ilike(originCertificates.importerName, `%${input.search}%`)
          )!
        );
      }
      if (input.revokedFrom) conditions.push(gte(originCertificates.revokedAt, input.revokedFrom));
      if (input.revokedTo) conditions.push(lte(originCertificates.revokedAt, input.revokedTo));
      const whereClause = and(...conditions);
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
        .where(whereClause)
        .orderBy(desc(originCertificates.revokedAt))
        .limit(input.pageSize)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(originCertificates)
        .where(whereClause);
      return {
        rows,
        total: Number(total),
        page: input.page,
        pageSize: input.pageSize,
        totalPages: Math.ceil(Number(total) / input.pageSize),
      };
    }),

  // Top scanned certificates (by scanCount, last 30 days or all-time)
  topScanned: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(50).default(10),
      days: z.number().int().min(1).max(365).optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!['admin', 'customs_officer', 'oga_officer', 'finance'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const conditions = [sql`${originCertificates.scanCount} > 0`];
      if (input.days) {
        const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
        conditions.push(gte(originCertificates.approvedAt, cutoff));
      }
      const rows = await db
        .select({
          id: originCertificates.id,
          certNumber: originCertificates.certNumber,
          certType: originCertificates.certType,
          exporterName: originCertificates.exporterName,
          originCountry: originCertificates.originCountry,
          destinationCountry: originCertificates.destinationCountry,
          scanCount: originCertificates.scanCount,
          approvedAt: originCertificates.approvedAt,
        })
        .from(originCertificates)
        .where(and(...conditions))
        .orderBy(desc(originCertificates.scanCount))
        .limit(input.limit);
      return rows;
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

  // ─── Sprint 85: CSV export for revocation log ─────────────────────────────────────
  exportRevokedCsv: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      revokedFrom: z.date().optional(),
      revokedTo: z.date().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const conditions = [eq(originCertificates.status, 'revoked')];
      if (input.search) {
        conditions.push(
          or(
            ilike(originCertificates.certNumber, `%${input.search}%`),
            ilike(originCertificates.exporterName, `%${input.search}%`),
            ilike(originCertificates.importerName, `%${input.search}%`)
          )!
        );
      }
      if (input.revokedFrom) conditions.push(gte(originCertificates.revokedAt, input.revokedFrom));
      if (input.revokedTo) conditions.push(lte(originCertificates.revokedAt, input.revokedTo));
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
        .where(and(...conditions))
        .orderBy(desc(originCertificates.revokedAt))
        .limit(5000);
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = 'Cert Number,Type,Exporter,Importer,Origin Country,Approved At,Revoked At,Revoked By (User ID),Reason';
      const lines = rows.map(r =>
        [
          r.certNumber, r.certType, r.exporterName, r.importerName ?? '',
          r.originCountry ?? '', r.approvedAt ? new Date(r.approvedAt).toISOString() : '',
          r.revokedAt ? new Date(r.revokedAt).toISOString() : '',
          r.revokedBy ?? '', r.revocationReason ?? '',
        ].map(escape).join(',')
      );
      return {
        csv: [header, ...lines].join('\n'),
        rowCount: rows.length,
        filename: `revocation-log-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }),

  // ─── Sprint 85: CSV export for top-scanned certificates ───────────────────────────
  exportTopScannedCsv: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(500).default(100),
      days: z.number().int().min(1).max(365).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!['admin', 'customs_officer', 'oga_officer', 'finance'].includes(ctx.user.role)) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const conditions = [sql`${originCertificates.scanCount} > 0`];
      if (input.days) {
        const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000);
        conditions.push(gte(originCertificates.approvedAt, cutoff));
      }
      const rows = await db
        .select({
          id: originCertificates.id,
          certNumber: originCertificates.certNumber,
          certType: originCertificates.certType,
          exporterName: originCertificates.exporterName,
          originCountry: originCertificates.originCountry,
          destinationCountry: originCertificates.destinationCountry,
          scanCount: originCertificates.scanCount,
          approvedAt: originCertificates.approvedAt,
        })
        .from(originCertificates)
        .where(and(...conditions))
        .orderBy(desc(originCertificates.scanCount))
        .limit(input.limit);
      const escape = (v: unknown) => {
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = 'Rank,Cert Number,Type,Exporter,Origin Country,Destination Country,Scan Count,Approved At';
      const lines = rows.map((r, idx) =>
        [
          idx + 1, r.certNumber, r.certType, r.exporterName,
          r.originCountry ?? '', r.destinationCountry ?? '',
          r.scanCount ?? 0, r.approvedAt ? new Date(r.approvedAt).toISOString() : '',
        ].map(escape).join(',')
      );
      const period = input.days ? `last-${input.days}d` : 'all-time';
      return {
        csv: [header, ...lines].join('\n'),
        rowCount: rows.length,
        filename: `top-scanned-certs-${period}-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }),

  // ─── Sprint 86: Compliance email schedule CRUD ──────────────────────────────

  // List all compliance email schedule entries (admin only)
  listComplianceSchedules: adminProcedure
    .query(async () => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return db.select().from(complianceEmailSchedule).orderBy(desc(complianceEmailSchedule.createdAt));
    }),

  // Add a new compliance email recipient (admin only)
  addComplianceRecipient: adminProcedure
    .input(z.object({
      recipientEmail: z.string().email(),
      recipientName: z.string().max(256).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [row] = await db.insert(complianceEmailSchedule).values({
        recipientEmail: input.recipientEmail,
        recipientName: input.recipientName ?? null,
        isActive: true,
        createdBy: ctx.user.id,
      }).returning();
      return row;
    }),

  // Toggle active status of a compliance email recipient (admin only)
  toggleComplianceRecipient: adminProcedure
    .input(z.object({ id: z.number().int().positive(), isActive: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const [row] = await db
        .update(complianceEmailSchedule)
        .set({ isActive: input.isActive, updatedAt: new Date() })
        .where(eq(complianceEmailSchedule.id, input.id))
        .returning();
      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  // Delete a compliance email recipient (admin only)
  deleteComplianceRecipient: adminProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await db.delete(complianceEmailSchedule).where(eq(complianceEmailSchedule.id, input.id));
      return { success: true };
    }),

  // Manually trigger the nightly CSV email (admin only, for testing)
  triggerNightlyCsvEmail: adminProcedure
    .mutation(async ({ ctx }) => {
      const { runNightlyRevocationCsv } = await import('../jobs/nightlyRevocationCsv');
      const result = await runNightlyRevocationCsv(`manual:${ctx.user.id}`);
      return result;
    }),

  // List compliance email delivery history (last N entries)
  listDeliveryLogs: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(complianceEmailDeliveryLog)
        .orderBy(desc(complianceEmailDeliveryLog.triggeredAt))
        .limit(input.limit);
    }),

  // Export compliance email delivery history as CSV
  exportDeliveryLogsCsv: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { csv: '' };
      const rows = await db
        .select()
        .from(complianceEmailDeliveryLog)
        .orderBy(desc(complianceEmailDeliveryLog.triggeredAt))
        .limit(input.limit);
      const header = 'ID,Triggered At,Triggered By,Date Label,Row Count,Recipient Count,Recipients,Success,Error,Duration (ms)';
      const csvRows = rows.map(r => [
        r.id,
        new Date(r.triggeredAt).toISOString(),
        r.triggeredBy,
        r.dateLabel,
        r.rowCount,
        r.recipientCount,
        `"${r.recipients.replace(/"/g, '""')}"`,
        r.success ? 'Yes' : 'No',
        r.errorMessage ? `"${r.errorMessage.replace(/"/g, '""')}"` : '',
        r.durationMs ?? '',
      ].join(','));
      return { csv: [header, ...csvRows].join('\n') };
    }),
});
