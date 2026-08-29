/**
 * AEO Renewals Router — manage AEO certificate renewal workflow
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { aeoRenewals, aeoApplications, aeoRenewalDocuments } from "../../drizzle/schema";
import { storagePut } from "../storage";

// Required document types for AEO renewal
export const AEO_REQUIRED_DOCS = [
  { docType: "financial_statements", label: "Audited Financial Statements (last 2 years)", required: true },
  { docType: "compliance_record",    label: "Customs Compliance Record / No-Objection Certificate", required: true },
  { docType: "certificate_of_origin", label: "Certificate of Origin (sample)", required: true },
  { docType: "insurance_cert",       label: "Current Cargo Insurance Certificate", required: true },
  { docType: "tax_clearance",        label: "Tax Clearance Certificate", required: true },
  { docType: "company_registration", label: "Company Registration / Business Licence", required: true },
  { docType: "security_assessment",  label: "Premises Security Assessment Report", required: false },
  { docType: "training_records",     label: "Staff Customs Training Records", required: false },
];
import { eq, and, lte, desc } from "drizzle-orm";
import { createUserNotification } from "../db";

export const aeoRenewalsRouter = router({
  /** List renewals for the current trader */
  myRenewals: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(aeoRenewals)
      .where(eq(aeoRenewals.traderId, ctx.user.id))
      .orderBy(desc(aeoRenewals.createdAt));
  }),

  /** Admin: list all pending renewals */
  listPending: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    return db.select().from(aeoRenewals)
      .where(eq(aeoRenewals.status, "pending"))
      .orderBy(aeoRenewals.renewalDueDate);
  }),

  /** Trader: submit renewal documents */
  submit: protectedProcedure
    .input(z.object({ aeoApplicationId: z.number().int(), renewalDueDate: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [existing] = await db.select().from(aeoRenewals)
        .where(and(eq(aeoRenewals.aeoApplicationId, input.aeoApplicationId), eq(aeoRenewals.traderId, ctx.user.id)))
        .limit(1);
      if (existing) {
        await db.update(aeoRenewals)
          .set({ status: "docs_submitted", submittedAt: new Date(), updatedAt: new Date() })
          .where(eq(aeoRenewals.id, existing.id));
        return { id: existing.id };
      }
      const [created] = await db.insert(aeoRenewals)
        .values({
          aeoApplicationId: input.aeoApplicationId,
          traderId: ctx.user.id,
          status: "docs_submitted",
          submittedAt: new Date(),
          renewalDueDate: new Date(input.renewalDueDate),
        })
        .returning({ id: aeoRenewals.id });
      // Seed document checklist for this renewal
      await db.insert(aeoRenewalDocuments).values(
        AEO_REQUIRED_DOCS.map(d => ({
          renewalId: created.id,
          docType: d.docType,
          label: d.label,
          required: d.required,
          status: "pending",
        }))
      );
      return { id: created.id };
    }),

  /** Admin: approve or reject a renewal */
  review: adminProcedure
    .input(z.object({
      renewalId: z.number().int(),
      decision: z.enum(["approved", "rejected"]),
      reviewNotes: z.string().max(1000).optional(),
      expiryDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [renewal] = await db.select().from(aeoRenewals).where(eq(aeoRenewals.id, input.renewalId)).limit(1);
      if (!renewal) throw new Error("Renewal not found");
      await db.update(aeoRenewals)
        .set({
          status: input.decision,
          reviewedAt: new Date(),
          reviewedBy: ctx.user.id,
          reviewNotes: input.reviewNotes ?? null,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          updatedAt: new Date(),
        })
        .where(eq(aeoRenewals.id, input.renewalId));
      // Notify trader
      await createUserNotification({
        userId: renewal.traderId,
        type: "aeo_status_update",
        title: `AEO Renewal ${input.decision === "approved" ? "Approved" : "Rejected"}`,
        body: input.reviewNotes ?? `Your AEO renewal has been ${input.decision}.`,
      });
      return { success: true };
    }),

  // ─── Document Checklist ────────────────────────────────────────────────────

  /** Get document checklist for a renewal (trader or admin) */
  listDocuments: protectedProcedure
    .input(z.object({ renewalId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      if (ctx.user.role !== "admin") {
        const [renewal] = await db.select().from(aeoRenewals)
          .where(and(eq(aeoRenewals.id, input.renewalId), eq(aeoRenewals.traderId, ctx.user.id)))
          .limit(1);
        if (!renewal) throw new Error("Renewal not found or access denied");
      }
      const docs = await db.select().from(aeoRenewalDocuments)
        .where(eq(aeoRenewalDocuments.renewalId, input.renewalId))
        .orderBy(aeoRenewalDocuments.required, aeoRenewalDocuments.docType);
      if (docs.length === 0) {
        const seeded = await db.insert(aeoRenewalDocuments).values(
          AEO_REQUIRED_DOCS.map(d => ({
            renewalId: input.renewalId,
            docType: d.docType,
            label: d.label,
            required: d.required,
            status: "pending",
          }))
        ).returning();
        return seeded;
      }
      return docs;
    }),

  /** Trader: upload a document for a renewal checklist item */
  uploadDocument: protectedProcedure
    .input(z.object({
      renewalId: z.number().int(),
      docType: z.string(),
      fileName: z.string(),
      fileBase64: z.string(),
      mimeType: z.string().default("application/pdf"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [renewal] = await db.select().from(aeoRenewals)
        .where(and(eq(aeoRenewals.id, input.renewalId), eq(aeoRenewals.traderId, ctx.user.id)))
        .limit(1);
      if (!renewal) throw new Error("Renewal not found or access denied");
      // SW-S2-10: cap the base64 payload BEFORE decoding (16 MB decoded ≈ 21.3 MB
      // base64) so a giant payload cannot exhaust memory, and sanitise every
      // path segment — client-supplied docType/fileName must never inject path
      // separators or traversal into the storage key.
      const MAX_BASE64_LEN = Math.ceil((16 * 1024 * 1024) / 3) * 4;
      if (input.fileBase64.length > MAX_BASE64_LEN) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File too large — maximum 16MB" });
      }
      const buf = Buffer.from(input.fileBase64, "base64");
      if (buf.length > 16 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "File too large — maximum 16MB" });
      }
      const safeDocType = input.docType.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64);
      const safeFileName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
      const key = `aeo-renewal-docs/${ctx.user.id}/${input.renewalId}/${safeDocType}-${Date.now()}-${safeFileName}`;
      const { url } = await storagePut(key, buf, input.mimeType);
      const [existing] = await db.select().from(aeoRenewalDocuments)
        .where(and(eq(aeoRenewalDocuments.renewalId, input.renewalId), eq(aeoRenewalDocuments.docType, input.docType)))
        .limit(1);
      if (existing) {
        await db.update(aeoRenewalDocuments)
          .set({ fileUrl: url, fileKey: key, uploadedAt: new Date(), status: "uploaded", updatedAt: new Date() })
          .where(eq(aeoRenewalDocuments.id, existing.id));
        return { id: existing.id, fileUrl: url };
      }
      const [created] = await db.insert(aeoRenewalDocuments).values({
        renewalId: input.renewalId,
        docType: input.docType,
        label: input.docType.replace(/_/g, " "),
        required: false,
        fileUrl: url,
        fileKey: key,
        uploadedAt: new Date(),
        status: "uploaded",
      }).returning({ id: aeoRenewalDocuments.id });
      return { id: created.id, fileUrl: url };
    }),

  /** Admin: mark a document as accepted or rejected */
  reviewDocument: adminProcedure
    .input(z.object({
      documentId: z.number().int(),
      status: z.enum(["accepted", "rejected"]),
      reviewNotes: z.string().max(500).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(aeoRenewalDocuments)
        .set({ status: input.status, reviewNotes: input.reviewNotes ?? null, updatedAt: new Date() })
        .where(eq(aeoRenewalDocuments.id, input.documentId));
      return { success: true };
    }),

  /** Get checklist completion summary for a renewal */
  checklistSummary: protectedProcedure
    .input(z.object({ renewalId: z.number().int() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const docs = await db.select().from(aeoRenewalDocuments)
        .where(eq(aeoRenewalDocuments.renewalId, input.renewalId));
      const required = docs.filter(d => d.required);
      const uploaded = docs.filter(d => d.status === "uploaded" || d.status === "accepted");
      const accepted = docs.filter(d => d.status === "accepted");
      const rejected = docs.filter(d => d.status === "rejected");
      const requiredUploaded = required.filter(d => d.status === "uploaded" || d.status === "accepted");
      return {
        total: docs.length,
        required: required.length,
        uploaded: uploaded.length,
        accepted: accepted.length,
        rejected: rejected.length,
        requiredUploaded: requiredUploaded.length,
        completionPct: required.length > 0 ? Math.round((requiredUploaded.length / required.length) * 100) : 100,
        isReadyToSubmit: requiredUploaded.length >= required.length,
      };
    }),

  /** List renewals due within N days (for heartbeat alert job) */
  listDueSoon: adminProcedure
    .input(z.object({ daysAhead: z.number().int().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + input.daysAhead);
      return db.select().from(aeoRenewals)
        .where(and(lte(aeoRenewals.renewalDueDate, cutoff), eq(aeoRenewals.status, "pending")));
    }),
});
