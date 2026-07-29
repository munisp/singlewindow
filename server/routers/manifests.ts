/**
 * manifests.ts — Electronic Manifest Management tRPC Router
 *
 * TradeGateway NGSWTP — Handles pre-arrival manifest submission,
 * house manifest creation, and Bill of Lading management.
 *
 * Delegates to the Go manifest-service microservice.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

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
   */
  submit: protectedProcedure
    .input(z.object({
      manifestType: z.enum(["SEA", "AIR"]),
      vesselName: z.string().min(1).max(128),
      voyageNumber: z.string().min(1).max(64),
      portOfLoading: z.string().min(1).max(64),
      portOfDischarge: z.string().min(1).max(64),
      eta: z.string().datetime(),
    }))
    .mutation(async ({ input, ctx }) => {
      return callManifestService("/api/manifests", "POST", {
        ...input,
        submittedBy: ctx.user.id,
        eta: new Date(input.eta).toISOString(),
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
   * addBillOfLading — Add or update a Bill of Lading within a manifest.
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
   */
  list: protectedProcedure
    .input(z.object({
      status: z.enum(["DRAFT", "SUBMITTED", "ACCEPTED", "AMENDED", "REJECTED"]).optional(),
      manifestType: z.enum(["SEA", "AIR"]).optional(),
      limit: z.number().int().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx }) => {
      const db = await import("../db").then(m => m.getDb());
      if (!db) return { manifests: [], total: 0 };
      const { manifests } = await import("../../drizzle/schema");
      const { desc } = await import("drizzle-orm");
      const rows = await db.select().from(manifests).orderBy(desc(manifests.createdAt)).limit(50);
      return { manifests: rows, total: rows.length };
    }),
});
