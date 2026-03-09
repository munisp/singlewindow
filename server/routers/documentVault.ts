/**
 * documentVault.ts — tRPC router for the Document Vault feature.
 *
 * File bytes are stored in RustFS (S3-compatible) via the Go rustfs-svc
 * microservice on port 4500. This router handles metadata persistence in
 * the PostgreSQL database and delegates all blob I/O to the Go service.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { documentVault } from "../../drizzle/schema";
import { eq, and, desc, count, sql } from "drizzle-orm";
import { rustfsUpload, rustfsPresign, rustfsDelete, rustfsHealthCheck } from "../rustfsSvcClient";
import { nanoid } from "nanoid";

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
        status: "active",
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
      const db = await getDb();
      if (!db) return [];

      const conditions = [eq(documentVault.ownerId, ctx.user.id)];
      if (input.status) conditions.push(eq(documentVault.status, input.status));
      if (input.category) conditions.push(eq(documentVault.category, input.category));

      return db.select().from(documentVault)
        .where(and(...conditions))
        .orderBy(desc(documentVault.createdAt))
        .limit(input.limit)
        .offset(input.offset);
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
});
