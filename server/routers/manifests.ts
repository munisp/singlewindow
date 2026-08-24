/**
 * manifests.ts — Electronic Manifest Management tRPC Router
 *
 * TradeGateway NGSWTP — Handles pre-arrival manifest submission,
 * house manifest creation, and Bill of Lading management.
 *
 * The manifest-service Go microservice handles creation and BL management.
 * The list/search procedures query PostgreSQL directly via Drizzle for performance.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { manifests, billsOfLading } from "../../drizzle/schema";
import { desc, eq, and, count } from "drizzle-orm";

const MANIFEST_SERVICE_URL = process.env.MANIFEST_SERVICE_URL ?? "http://manifest-service:8098";

async function callManifestService(path: string, method = "GET", body?: unknown) {
  const res = await fetch(`${MANIFEST_SERVICE_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => "Unknown error");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Manifest service error ${res.status}: ${err}`,
    });
  }
  return res.json();
}

export const manifestsRouter = router({
  /**
   * submit — Submit a master manifest (shipping lines/airlines).
   * Delegates to the Go manifest-service for UCR generation and Kafka publishing.
   */
  submit: protectedProcedure
    .input(z.object({
      manifestType: z.enum(["SEA", "AIR"]),
      vesselName: z.string().min(1).max(128),
      voyageNumber: z.string().min(1).max(64),
      portOfLoading: z.string().min(1).max(64),
      portOfDischarge: z.string().min(1).max(64),
      eta: z.string().datetime(),
      mmsi: z.string().min(1).max(16).optional(),
      imo: z.string().min(1).max(16).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      return callManifestService("/api/manifests", "POST", {
        ...input,
        submittedBy: ctx.user.id,
        eta: new Date(input.eta).toISOString(),
        mmsi: input.mmsi,
        imo: input.imo,
      });
    }),

  /**
   * get — Get manifest details by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      return callManifestService(`/api/manifests/${input.id}`);
    }),

  /**
   * addBillOfLading — Add a Bill of Lading to a manifest.
   */
  addBillOfLading: protectedProcedure
    .input(z.object({
      manifestId: z.number().int().positive(),
      blNumber: z.string().min(1).max(64),
      shipper: z.string().min(1).max(256),
      consignee: z.string().min(1).max(256),
      notifyParty: z.string().max(256).optional(),
      description: z.string().min(1),
      hsCode: z.string().max(16).optional(),
      weightKg: z.number().positive().optional(),
      numPackages: z.number().int().positive().optional(),
      containerNos: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const { manifestId, ...blData } = input;
      return callManifestService(`/api/manifests/${manifestId}/bl`, "POST", blData);
    }),

  /**
   * list — List manifests with optional filters.
   * Queries PostgreSQL directly for performance.
   */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "AMENDED", "REJECTED"]).optional(),
      manifestType: z.enum(["SEA", "AIR"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { manifests: [], total: 0 };

      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const conditions = [eq(manifests.submittedBy, ctx.user.id)];
      if (input?.status) conditions.push(eq(manifests.status, input.status));
      if (input?.manifestType) conditions.push(eq(manifests.manifestType, input.manifestType));

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(manifests)
          .where(and(...conditions))
          .orderBy(desc(manifests.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(manifests).where(and(...conditions)),
      ]);

      return { manifests: rows, total };
    }),

  /**
   * listAll — Admin: List all manifests.
   */
  listAll: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { manifests: [], total: 0 };

      const limit = input?.limit ?? 100;
      const offset = input?.offset ?? 0;

      const [rows, [{ total }]] = await Promise.all([
        db.select().from(manifests)
          .orderBy(desc(manifests.createdAt))
          .limit(limit)
          .offset(offset),
        db.select({ total: count() }).from(manifests),
      ]);

      return { manifests: rows, total };
    }),

  /**
   * getBLs — Get all Bills of Lading for a manifest.
   */
  getBLs: protectedProcedure
    .input(z.object({ manifestId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { bls: [], total: 0 };

      const rows = await db.select()
        .from(billsOfLading)
        .where(eq(billsOfLading.manifestId, input.manifestId))
        .orderBy(desc(billsOfLading.createdAt));

      return { bls: rows, total: rows.length };
    }),

  /**
   * amend — Amend a submitted manifest.
   */
  amend: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: z.string().min(1).max(512),
    }))
    .mutation(async ({ input }) => {
      return callManifestService(`/api/manifests/${input.id}/amend`, "POST", {
        reason: input.reason,
      });
    }),
});
