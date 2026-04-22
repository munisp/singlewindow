/**
 * clearanceCertificates.ts — tRPC router for customs clearance certificates
 * Generates and manages official clearance certificates for cleared declarations.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { clearanceCertificates, declarations } from "../../drizzle/schema";
import { eq, desc, and, count } from "drizzle-orm";
import { storagePut } from "../storage";

function generateCertContent(cert: {
  declarationRef: string;
  goodsDescription: string | null;
  totalDutyPaid: string | null;
  currency: string | null;
  clearedAt: Date | null;
}): string {
  const date = cert.clearedAt ? cert.clearedAt.toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
  return `CUSTOMS CLEARANCE CERTIFICATE
=====================================
Reference: ${cert.declarationRef}
Date: ${date}
Goods: ${cert.goodsDescription ?? "N/A"}
Total Duty Paid: ${cert.currency ?? "USD"} ${cert.totalDutyPaid ?? "0.00"}
Status: CLEARED
=====================================
This certificate confirms that the above goods have been cleared through customs.
Issued by: TradeGateway™ NGSWTP
`;
}

export const clearanceCertificatesRouter = router({
  /** List clearance certificates for the current trader */
  list: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const [totalRow] = await db.select({ count: count() }).from(clearanceCertificates)
        .where(eq(clearanceCertificates.traderId, ctx.user.id));
      const items = await db.select().from(clearanceCertificates)
        .where(eq(clearanceCertificates.traderId, ctx.user.id))
        .orderBy(desc(clearanceCertificates.generatedAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  /** Get a single clearance certificate */
  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [cert] = await db.select().from(clearanceCertificates)
        .where(and(eq(clearanceCertificates.id, input.id), eq(clearanceCertificates.traderId, ctx.user.id)));
      if (!cert) throw new TRPCError({ code: "NOT_FOUND", message: "Certificate not found" });
      return cert;
    }),

  /** Admin: generate a clearance certificate for a cleared declaration */
  generate: adminProcedure
    .input(z.object({
      declarationId: z.number(),
      totalDutyPaid: z.string().optional(),
      currency: z.string().default("USD"),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [decl] = await db.select().from(declarations).where(eq(declarations.id, input.declarationId));
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (decl.status !== "cleared") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Clearance certificate can only be generated for cleared declarations" });
      }
      // Check if certificate already exists
      const [existing] = await db.select().from(clearanceCertificates)
        .where(eq(clearanceCertificates.declarationId, input.declarationId));
      if (existing) return existing;
      // Generate certificate content and upload to S3
      const certData = {
        declarationRef: decl.declarationNumber ?? `DECL-${decl.id}`,
        goodsDescription: decl.goodsDescription,
        totalDutyPaid: input.totalDutyPaid ?? null,
        currency: input.currency,
        clearedAt: decl.clearedAt,
      };
      const content = generateCertContent(certData);
      const fileKey = `clearance-certs/${decl.id}-${Date.now()}.txt`;
      const { url } = await storagePut(fileKey, Buffer.from(content), "text/plain");
      const [cert] = await db.insert(clearanceCertificates).values({
        declarationId: input.declarationId,
        traderId: decl.traderId,
        fileKey,
        fileUrl: url,
        declarationRef: certData.declarationRef,
        goodsDescription: certData.goodsDescription,
        totalDutyPaid: input.totalDutyPaid,
        currency: input.currency,
        clearedAt: decl.clearedAt,
        generatedBy: ctx.user.id,
      }).returning();
      return cert;
    }),

  /** Admin: list all clearance certificates */
  adminList: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { items: [], total: 0 };
      const [totalRow] = await db.select({ count: count() }).from(clearanceCertificates);
      const items = await db.select().from(clearanceCertificates)
        .orderBy(desc(clearanceCertificates.generatedAt))
        .limit(input.limit).offset(input.offset);
      return { items, total: totalRow?.count ?? 0 };
    }),

  stats: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return { total: 0 };
    const [total] = await db.select({ count: count() }).from(clearanceCertificates);
    return { total: total?.count ?? 0 };
  }),
});

export type ClearanceCertificatesRouter = typeof clearanceCertificatesRouter;
