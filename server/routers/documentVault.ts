/**
 * documentVault.ts — tRPC router for the Document Vault feature.
 *
 * File bytes are stored in RustFS (S3-compatible) via the Go rustfs-svc
 * microservice on port 4500. This router handles metadata persistence in
 * the PostgreSQL database and delegates all blob I/O to the Go service.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb, withRlsContext } from "../db";
import { documentVault, documentShares, documentVersions, userNotifications } from "../../drizzle/schema";
import { eq, and, desc, count, sql, lte, gte, asc } from "drizzle-orm";
import { rustfsUpload, rustfsPresign, rustfsDelete, rustfsHealthCheck, rustfsScan } from "../rustfsSvcClient";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { notifyOwner } from "../_core/notification";

const DOCUMENT_CATEGORIES = [
  "commercial_invoice", "bill_of_lading", "packing_list",
  "certificate_of_origin", "phytosanitary_cert", "import_permit",
  "export_permit", "insurance_cert", "customs_bond",
  "kyc_identity", "kyc_business", "aeo_supporting",
  "post_clearance", "correspondence", "other",
] as const;

const ACCESS_LEVELS = ["private", "shared_with_customs", "shared_with_oga", "public"] as const;

export const documentVaultRouter = router({

  upload: protectedProcedure
    .input(z.object({
      filename: z.string().min(1).max(255),
      contentType: z.string().min(1),
      fileData: z.string().describe("Base64-encoded file content"),
      sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
      category: z.enum(DOCUMENT_CATEGORIES),
      accessLevel: z.enum(ACCESS_LEVELS).default("private"),
      description: z.string().max(1000).optional(),
      declarationId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const healthy = await rustfsHealthCheck();
      if (!healthy) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Document storage service is unavailable. Please try again shortly.",
        });
      }

      const buffer = Buffer.from(input.fileData, "base64");

      // ── ClamAV virus scan (pre-upload) ────────────────────────────────────
      // Runs before any S3 write. Gracefully skips when ClamAV DB is absent.
      const scanResult = await rustfsScan(buffer, input.filename);
      if (!scanResult.clean && !scanResult.skipped) {
        const { logAuditEvent } = await import("../db");
        await logAuditEvent({
          actorId: ctx.user.id,
          actorType: "user",
          action: "malware_detected",
          entityType: "document_vault" as any,
          entityId: ctx.user.id,
          metadata: { filename: input.filename, threat: scanResult.threat, sizeBytes: input.sizeBytes },
        });
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `File rejected: malware detected (${scanResult.threat}). Upload blocked for security.`,
        });
      }
      if (scanResult.skipped) {
        // SW-S2-8: an unscanned file is NEVER silently activated — it is stored
        // in 'quarantined' status (invisible to normal 'active' listings) until
        // a successful AV scan clears it.
        console.warn(`[DocumentVault] ClamAV scan unavailable for ${input.filename} — storing as QUARANTINED`);
      }
      // ─────────────────────────────────────────────────────────────────────

      const suffix = nanoid(10);
      const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `vault/${ctx.user.id}/${input.category}/${suffix}-${safeFilename}`;

      const { key, url } = await rustfsUpload(buffer, fileKey, input.contentType);

      const [record] = await db.insert(documentVault).values({
        ownerId: ctx.user.id,
        declarationId: input.declarationId ?? null,
        fileKey: key,
        url,
        filename: input.filename,
        mimeType: input.contentType,
        sizeBytes: input.sizeBytes,
        category: input.category,
        accessLevel: input.accessLevel,
        // Quarantined until a successful AV scan when the scanner was unavailable.
        status: scanResult.skipped ? "quarantined" : "active",
        description: input.description ?? null,
      }).returning();

      return record;
    }),

  list: protectedProcedure
    .input(z.object({
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      status: z.enum(["active", "revoked", "expired"]).default("active"),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
      .query(async ({ ctx, input }) => {
      return withRlsContext(ctx.user, async (db) => {
        const conditions = [eq(documentVault.ownerId, ctx.user.id)];
        if (input.status) conditions.push(eq(documentVault.status, input.status));
        if (input.category) conditions.push(eq(documentVault.category, input.category));
        return db.select().from(documentVault)
          .where(and(...conditions))
          .orderBy(desc(documentVault.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      });
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [doc] = await db.select().from(documentVault)
        .where(eq(documentVault.id, input.id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const isOwner = doc.ownerId === ctx.user.id;
      const isPrivileged = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isOwner && !isPrivileged) throw new TRPCError({ code: "FORBIDDEN" });

      return doc;
    }),

  download: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      expiresIn: z.number().int().min(60).max(86400).default(3600),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [doc] = await db.select().from(documentVault)
        .where(eq(documentVault.id, input.id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      if (doc.status !== "active") throw new TRPCError({ code: "FORBIDDEN", message: "Document is not active" });

      const isOwner = doc.ownerId === ctx.user.id;
      const isPrivileged = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);
      if (!isOwner && !isPrivileged) throw new TRPCError({ code: "FORBIDDEN" });

      const presignedUrl = await rustfsPresign(doc.fileKey, input.expiresIn);
      return {
        url: presignedUrl,
        filename: doc.filename,
        mimeType: doc.mimeType,
        expiresAt: new Date(Date.now() + input.expiresIn * 1000),
      };
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [doc] = await db.select().from(documentVault)
        .where(eq(documentVault.id, input.id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      const isOwner = doc.ownerId === ctx.user.id;
      const isAdmin = ctx.user.role === "admin";
      if (!isOwner && !isAdmin) throw new TRPCError({ code: "FORBIDDEN" });

      const [updated] = await db.update(documentVault)
        .set({ status: "revoked", revokedBy: ctx.user.id, revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(documentVault.id, input.id))
        .returning();

      return updated;
    }),

  permanentDelete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const [doc] = await db.select().from(documentVault)
        .where(eq(documentVault.id, input.id))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });

      await rustfsDelete(doc.fileKey).catch(err => {
        console.warn(`[DocumentVault] Failed to delete from RustFS: ${err.message}`);
      });

      await db.delete(documentVault).where(eq(documentVault.id, input.id));
      return { deleted: true };
    }),

  adminList: protectedProcedure
    .input(z.object({
      ownerId: z.number().int().positive().optional(),
      category: z.enum(DOCUMENT_CATEGORIES).optional(),
      status: z.enum(["active", "revoked", "expired"]).optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });

      const db = await getDb();
      if (!db) return [];

      const conditions = [];
      if (input.ownerId) conditions.push(eq(documentVault.ownerId, input.ownerId));
      if (input.status) conditions.push(eq(documentVault.status, input.status));
      if (input.category) conditions.push(eq(documentVault.category, input.category));

      const query = db.select().from(documentVault);
      if (conditions.length > 0) query.where(and(...conditions));

      return query.orderBy(desc(documentVault.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    }),

  stats: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return { totalFiles: 0, totalBytes: 0, activeFiles: 0, revokedFiles: 0 };

    const [row] = await db.select({
      totalFiles: count(),
      totalBytes: sql<number>`COALESCE(SUM(${documentVault.sizeBytes}), 0)`,
      activeFiles: sql<number>`COUNT(*) FILTER (WHERE ${documentVault.status} = 'active')`,
      revokedFiles: sql<number>`COUNT(*) FILTER (WHERE ${documentVault.status} = 'revoked')`,
    })
      .from(documentVault)
      .where(eq(documentVault.ownerId, ctx.user.id));

    return {
      totalFiles: Number(row.totalFiles),
      totalBytes: Number(row.totalBytes),
      activeFiles: Number(row.activeFiles),
      revokedFiles: Number(row.revokedFiles),
    };
  }),

  health: protectedProcedure.query(async () => {
    const db = await getDb();
    const svcHealthy = await rustfsHealthCheck();
    return { database: !!db, rustfsSvc: svcHealthy };
  }),

  // ── Document Sharing ──────────────────────────────────────────────────────

  share: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      expiresInHours: z.number().int().min(1).max(720).default(24),
      password: z.string().min(4).max(64).optional(),
      maxDownloads: z.number().int().min(1).max(1000).optional(),
      label: z.string().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [doc] = await db
        .select({ id: documentVault.id, ownerId: documentVault.ownerId, filename: documentVault.filename, status: documentVault.status })
        .from(documentVault)
        .where(eq(documentVault.id, input.documentId))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (doc.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot share a revoked document" });
      if (doc.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this document" });
      }

      const token = nanoid(48);
      const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000);
      const passwordHash = input.password ? await bcrypt.hash(input.password, 10) : null;

      const [share] = await db
        .insert(documentShares)
        .values({
          documentId: input.documentId,
          createdBy: ctx.user.id,
          token,
          passwordHash,
          expiresAt,
          maxDownloads: input.maxDownloads ?? null,
          label: input.label ?? null,
        })
        .returning();

      // Fire-and-forget owner notification — never block the response
      notifyOwner({
        title: `Document shared: ${doc.filename}`,
        content: `A share link was created for "${doc.filename}" (ID: ${doc.id}) by user ${ctx.user.id}.\nExpires: ${expiresAt.toISOString()}${input.label ? `\nLabel: ${input.label}` : ""}${passwordHash ? "\nPassword protected: yes" : ""}`,
      }).catch(() => {/* non-critical */});

      return {
        shareId: share.id,
        token: share.token,
        expiresAt: share.expiresAt,
        hasPassword: !!passwordHash,
        maxDownloads: share.maxDownloads,
        label: share.label,
      };
    }),

  verifyShare: publicProcedure
    .input(z.object({
      token: z.string().min(1),
      password: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [share] = await db
        .select()
        .from(documentShares)
        .where(eq(documentShares.token, input.token))
        .limit(1);

      if (!share) throw new TRPCError({ code: "NOT_FOUND", message: "Share link not found" });
      if (share.revokedAt) throw new TRPCError({ code: "FORBIDDEN", message: "This share link has been revoked" });
      if (share.expiresAt < new Date()) throw new TRPCError({ code: "FORBIDDEN", message: "This share link has expired" });
      if (share.maxDownloads !== null && share.downloadCount >= share.maxDownloads) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Download limit reached" });
      }

      if (share.passwordHash) {
        if (!input.password) throw new TRPCError({ code: "FORBIDDEN", message: "Password required" });
        const valid = await bcrypt.compare(input.password, share.passwordHash);
        if (!valid) throw new TRPCError({ code: "FORBIDDEN", message: "Incorrect password" });
      }

      const [doc] = await db
        .select({ fileKey: documentVault.fileKey, filename: documentVault.filename, status: documentVault.status })
        .from(documentVault)
        .where(eq(documentVault.id, share.documentId))
        .limit(1);

      if (!doc || doc.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document is no longer available" });
      }

      const presignedUrl = await rustfsPresign(doc.fileKey, 3600);

      await db
        .update(documentShares)
        .set({ downloadCount: share.downloadCount + 1 })
        .where(eq(documentShares.id, share.id));

      return {
        url: presignedUrl,
        filename: doc.filename,
        expiresAt: share.expiresAt,
        downloadsRemaining: share.maxDownloads !== null
          ? share.maxDownloads - share.downloadCount - 1
          : null,
      };
    }),

  listShares: protectedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const [doc] = await db
        .select({ ownerId: documentVault.ownerId })
        .from(documentVault)
        .where(eq(documentVault.id, input.documentId))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (doc.ownerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      return db
        .select({
          id: documentShares.id,
          token: documentShares.token,
          label: documentShares.label,
          expiresAt: documentShares.expiresAt,
          maxDownloads: documentShares.maxDownloads,
          downloadCount: documentShares.downloadCount,
          hasPassword: sql<boolean>`(${documentShares.passwordHash} IS NOT NULL)`,
          revokedAt: documentShares.revokedAt,
          createdAt: documentShares.createdAt,
        })
        .from(documentShares)
        .where(eq(documentShares.documentId, input.documentId))
        .orderBy(desc(documentShares.createdAt));
    }),

  revokeShare: protectedProcedure
    .input(z.object({ shareId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [share] = await db
        .select({ id: documentShares.id, createdBy: documentShares.createdBy })
        .from(documentShares)
        .where(eq(documentShares.id, input.shareId))
        .limit(1);

      if (!share) throw new TRPCError({ code: "NOT_FOUND", message: "Share not found" });
      if (share.createdBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

       const [updated] = await db
        .update(documentShares)
        .set({ revokedAt: new Date() })
        .where(eq(documentShares.id, input.shareId))
        .returning();
      return { revoked: true, shareId: updated.id };
    }),

  /**
   * List all active documents attached to a specific declaration.
   * Accessible by the document owner, customs officers, OGA officers, and admins.
   */
  listByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const isPrivileged = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);

      const conditions = [
        eq(documentVault.declarationId, input.declarationId),
        eq(documentVault.status, "active"),
      ];

      // Non-privileged users can only see their own documents
      if (!isPrivileged) {
        conditions.push(eq(documentVault.ownerId, ctx.user.id));
      }

      return db
        .select()
        .from(documentVault)
        .where(and(...conditions))
        .orderBy(desc(documentVault.createdAt));
    }),

  /**
   * Sprint 117: Soft-delete a document — sets status to 'deleted' and removes the blob.
   * Only the document owner or privileged officers (admin, customs_officer, oga_officer) can delete.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [doc] = await db
        .select()
        .from(documentVault)
        .where(and(eq(documentVault.id, input.id), eq(documentVault.status, "active")))
        .limit(1);

      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found or already deleted" });

      const isPrivileged = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);
      if (!isPrivileged && doc.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to delete this document" });
      }

      // Soft-delete in DB
      await db
        .update(documentVault)
        .set({ status: "deleted" as any, updatedAt: new Date() })
        .where(eq(documentVault.id, input.id));

      // Best-effort blob removal from RustFS/S3
      try {
        if (doc.fileKey) await rustfsDelete(doc.fileKey);
      } catch {
        // Non-fatal: blob removal failure doesn't block the soft-delete
      }

      return { success: true, id: input.id };
    }),

  /**
   * Sprint 118: Archive a document version before it is replaced.
   * Called by the frontend replace flow: saves old doc metadata to document_versions,
   * then the caller deletes the old doc and uploads the new one.
   */
  archiveVersion: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      replacedByUserId: z.number().int().positive().optional(),
      reason: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [doc] = await db
        .select()
        .from(documentVault)
        .where(and(eq(documentVault.id, input.documentId), eq(documentVault.status, "active")))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found or not active" });
      const isPrivileged = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);
      if (!isPrivileged && doc.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      const [version] = await db.insert(documentVersions).values({
        originalDocumentId: doc.id,
        fileName: doc.filename,
        s3Key: doc.fileKey,
        s3Url: doc.url,
        mimeType: doc.mimeType,
        fileSize: doc.sizeBytes,
        category: doc.category,
        description: doc.description,
        uploadedBy: doc.ownerId,
        replacedBy: input.replacedByUserId ?? ctx.user.id,
        replacedAt: new Date(),
        versionNote: input.reason ?? "User-initiated replace",
      }).returning();
      return version;
    }),

  /**
   * Sprint 118: List version history for a document (all previous versions archived on replace).
   * Accessible by the document owner, admins, and officers.
   */
  listVersions: protectedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const isPrivileged = ["admin", "customs_officer", "oga_officer"].includes(ctx.user.role);
      const [doc] = await db
        .select({ ownerId: documentVault.ownerId })
        .from(documentVault)
        .where(eq(documentVault.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      if (!isPrivileged && doc.ownerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return db
        .select()
        .from(documentVersions)
        .where(eq(documentVersions.originalDocumentId, input.documentId))
        .orderBy(desc(documentVersions.replacedAt));
    }),

  /**
   * v114: getExpiringDocuments — list documents whose share links or vault entries
   * are expiring within the next N days. Used by the expiry-alert Heartbeat job.
   */
  getExpiringDocuments: protectedProcedure
    .input(z.object({
      daysAhead: z.number().int().min(1).max(90).default(7),
      includeExpired: z.boolean().default(false),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { documents: [], total: 0 };

      const isPrivileged = ["admin", "customs_officer"].includes(ctx.user.role);
      const cutoff = new Date(Date.now() + input.daysAhead * 24 * 60 * 60 * 1000);
      const now = new Date();

      const rows = await db
        .select({
          id: documentVault.id,
          filename: documentVault.filename,
          category: documentVault.category,
          ownerId: documentVault.ownerId,
          expiresAt: documentVault.expiresAt,
          status: documentVault.status,
        })
        .from(documentVault)
        .where(
          and(
            isPrivileged ? undefined : eq(documentVault.ownerId, ctx.user.id),
            lte(documentVault.expiresAt, cutoff),
            input.includeExpired ? undefined : gte(documentVault.expiresAt, now),
          )
        )
        .orderBy(asc(documentVault.expiresAt))
        .limit(200);

      return {
        documents: rows.filter((r) => r.expiresAt !== null),
        total: rows.filter((r) => r.expiresAt !== null).length,
        cutoffDate: cutoff.toISOString(),
      };
    }),

  /**
   * v114: sendExpiryAlerts — admin/heartbeat job that scans for documents expiring
   * within the configured window and sends in-app notifications to document owners.
   * Returns the count of alerts dispatched.
   */
  sendExpiryAlerts: protectedProcedure
    .input(z.object({
      daysAhead: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ ctx, input }) => {
      const isPrivileged = ["admin", "customs_officer"].includes(ctx.user.role);
      if (!isPrivileged) throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });

      const db = await getDb();
      if (!db) return { dispatched: 0, reason: "Database unavailable" };

      const cutoff = new Date(Date.now() + input.daysAhead * 24 * 60 * 60 * 1000);
      const now = new Date();

      const expiring = await db
        .select({
          id: documentVault.id,
          filename: documentVault.filename,
          ownerId: documentVault.ownerId,
          expiresAt: documentVault.expiresAt,
        })
        .from(documentVault)
        .where(and(lte(documentVault.expiresAt, cutoff), gte(documentVault.expiresAt, now)))
        .limit(500);

      let dispatched = 0;
      for (const doc of expiring) {
        if (!doc.expiresAt) continue;
        const daysLeft = Math.ceil((doc.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        await db.insert(userNotifications).values({
          userId: doc.ownerId,
          type: "document_required",
          title: `Document expiring in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
          body: `Your document "${doc.filename}" (ID: ${doc.id}) will expire on ${doc.expiresAt.toLocaleDateString("en-GB")}. Please renew or re-upload it to avoid disruption.`,
          isRead: false,
        }).catch(() => {/* ignore duplicate notification errors */});
        dispatched++;
      }

      return { dispatched, daysAhead: input.daysAhead, scannedAt: new Date().toISOString() };
    }),
});