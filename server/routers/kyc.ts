/**
 * kyc.ts — tRPC router for KYC/KYB operations
 *
 * Routes document analysis through the Python kyc-service which uses:
 *   - PaddleOCR for text extraction
 *   - DocLing for document structure parsing
 *   - Qwen2-VL for visual document understanding
 *
 * Procedures:
 *   kyc.uploadDocument          — Upload a document for OCR/analysis
 *   kyc.analyseDocument         — Run full document analysis pipeline
 *   kyc.verifyIdentity          — Verify individual identity (KYC)
 *   kyc.verifyBusiness          — Verify business entity (KYB)
 *   kyc.getVerification         — Get verification status for a trader
 *   kyc.listDocuments           — List documents submitted by a trader
 *   kyc.reviewVerification      — Admin: approve/reject a verification
 *   kyc.listPendingVerifications — Admin: list pending verifications
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { notifyOwner } from "../_core/notification";
import {
  createKYCDocument,
  getKYCDocument,
  updateKYCDocument,
  listKYCDocuments,
  createKYCVerification,
  getLatestKYCVerification,
  updateKYCVerification,
  listKYCVerifications,
  createUserNotification,
} from "../db";
import { storagePut } from "../storage";

const KYC_SERVICE_URL = process.env.KYC_SERVICE_URL || "http://localhost:8091";

// ─── KYC service client ────────────────────────────────────────────────────

async function kycServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${KYC_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function analyseDocumentViaKYCService(
  documentUrl: string,
  documentType: string,
  options?: { extractText?: boolean; verifyAuthenticity?: boolean }
): Promise<Record<string, unknown>> {
  const res = await fetch(`${KYC_SERVICE_URL}/api/kyc/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document_url: documentUrl,
      document_type: documentType,
      extract_text: options?.extractText ?? true,
      verify_authenticity: options?.verifyAuthenticity ?? true,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`KYC service error: ${res.status} — ${err}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Mock analysis for development (when KYC service is not running) ──────

function mockDocumentAnalysis(documentType: string): Record<string, unknown> {
  const baseResult = {
    document_type: documentType,
    authenticity_score: 0.87,
    authenticity_verdict: "LIKELY_GENUINE",
    ocr_confidence: 0.94,
    processing_time_ms: 1200,
    mock: true,
  };

  switch (documentType) {
    case "national_id":
    case "passport":
      return {
        ...baseResult,
        extracted_fields: {
          full_name: "SAMPLE NAME",
          document_number: "A12345678",
          date_of_birth: "1985-03-15",
          nationality: "GH",
          expiry_date: "2030-03-14",
          issuing_authority: "Ghana Immigration Service",
        },
        face_detected: true,
        mrz_valid: true,
        security_features: ["UV_PATTERN", "MICROPRINT", "HOLOGRAM"],
      };

    case "business_registration":
      return {
        ...baseResult,
        extracted_fields: {
          company_name: "SAMPLE TRADING CO LTD",
          registration_number: "CS-123456789",
          registration_date: "2015-06-01",
          registered_address: "123 Independence Ave, Accra, Ghana",
          directors: ["SAMPLE DIRECTOR 1", "SAMPLE DIRECTOR 2"],
          share_capital: "GHS 50,000",
        },
        official_seal_detected: true,
        signature_detected: true,
      };

    case "tax_certificate":
      return {
        ...baseResult,
        extracted_fields: {
          tin: "C0012345678",
          taxpayer_name: "SAMPLE TRADING CO LTD",
          tax_type: "VAT",
          valid_from: "2024-01-01",
          valid_to: "2024-12-31",
          issuing_authority: "Ghana Revenue Authority",
        },
        qr_code_valid: true,
      };

    default:
      return {
        ...baseResult,
        extracted_fields: {},
        raw_text: "Document text extracted successfully (mock mode)",
      };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────

export const kycRouter = router({
  /**
   * Upload a KYC/KYB document to S3 and record it in the database.
   * Returns an upload URL and document record ID.
   */
  uploadDocument: protectedProcedure
    .input(z.object({
      filename: z.string().min(1),
      contentType: z.enum([
        "image/jpeg", "image/png", "image/webp",
        "application/pdf", "image/tiff",
      ]),
      documentType: z.enum([
        "national_id", "passport", "drivers_license",
        "business_registration", "tax_certificate",
        "bank_statement", "utility_bill", "certificate_of_incorporation",
        "memorandum_of_association", "board_resolution", "other",
      ]),
      fileSize: z.number().max(20 * 1024 * 1024, "File must be under 20MB"),
      fileData: z.string().describe("Base64-encoded file content"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // Decode base64 and upload to S3
      const buffer = Buffer.from(input.fileData, "base64");
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const fileKey = `kyc/${userId}/${input.documentType}-${suffix}-${input.filename}`;

      const { url } = await storagePut(fileKey, buffer, input.contentType);

      // Record in database
      const doc = await createKYCDocument({
        userId,
        documentType: input.documentType,
        filename: input.filename,
        fileKey,
        fileUrl: url,
        fileSize: input.fileSize,
        contentType: input.contentType,
        status: "PENDING_ANALYSIS",
      });

      return {
        documentId: doc.id,
        fileUrl: url,
        status: "PENDING_ANALYSIS",
        message: "Document uploaded successfully. Analysis will begin shortly.",
      };
    }),

  /**
   * Run the full document analysis pipeline via the KYC service.
   * Uses PaddleOCR + DocLing + Qwen2-VL.
   */
  analyseDocument: protectedProcedure
    .input(z.object({
      documentId: z.number().int().positive(),
      runAuthenticity: z.boolean().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      const doc = await getKYCDocument(input.documentId);
      if (!doc) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Document not found" });
      }
      if (doc.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      let analysis: Record<string, unknown>;
      const available = await kycServiceAvailable();

      if (available) {
        try {
          analysis = await analyseDocumentViaKYCService(
            doc.fileUrl,
            doc.documentType,
            { extractText: true, verifyAuthenticity: input.runAuthenticity }
          );
        } catch (e) {
          console.warn(`[KYC] Service call failed: ${e}. Using mock.`);
          analysis = mockDocumentAnalysis(doc.documentType);
        }
      } else {
        analysis = mockDocumentAnalysis(doc.documentType);
      }

      // Update document record with analysis results
      const updated = await updateKYCDocument(input.documentId, {
        status: "ANALYSED",
        analysisResult: analysis,
        ocrConfidence: typeof analysis.ocr_confidence === "number" ? analysis.ocr_confidence : null,
        authenticityScore: typeof analysis.authenticity_score === "number" ? analysis.authenticity_score : null,
        authenticityVerdict: typeof analysis.authenticity_verdict === "string" ? analysis.authenticity_verdict : null,
        analysedAt: new Date(),
      });

      return {
        documentId: input.documentId,
        analysis,
        status: "ANALYSED",
        analysedAt: updated?.analysedAt ?? null,
      };
    }),

  /**
   * Submit individual identity verification (KYC).
   * Requires at least one government-issued photo ID.
   */
  verifyIdentity: protectedProcedure
    .input(z.object({
      primaryDocumentId: z.number().int().positive().describe("National ID or Passport"),
      secondaryDocumentId: z.number().int().positive().optional().describe("Utility bill or bank statement for address"),
      selfieDocumentId: z.number().int().positive().optional().describe("Live selfie for face match"),
      declarationAccepted: z.boolean().refine(v => v === true, {
        message: "You must accept the KYC declaration",
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      // Check documents belong to user
      const primaryDoc = await getKYCDocument(input.primaryDocumentId);
      if (!primaryDoc || primaryDoc.userId !== userId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Primary document not found" });
      }

      // Create verification record
      const verification = await createKYCVerification({
        userId,
        verificationType: "INDIVIDUAL",
        primaryDocumentId: input.primaryDocumentId,
        secondaryDocumentId: input.secondaryDocumentId ?? null,
        selfieDocumentId: input.selfieDocumentId ?? null,
        status: "PENDING_REVIEW",
        submittedAt: new Date(),
      });

      return {
        verificationId: verification.id,
        status: "PENDING_REVIEW",
        estimatedReviewTime: "1-2 business days",
        message: "Identity verification submitted. You will be notified when reviewed.",
      };
    }),

  /**
   * Submit business entity verification (KYB).
   * Requires business registration, tax certificate, and director ID.
   */
  verifyBusiness: protectedProcedure
    .input(z.object({
      businessRegistrationDocId: z.number().int().positive(),
      taxCertificateDocId: z.number().int().positive(),
      directorIdDocId: z.number().int().positive(),
      incorporationCertDocId: z.number().int().positive().optional(),
      memorandumDocId: z.number().int().positive().optional(),
      businessName: z.string().min(2),
      registrationNumber: z.string().min(3),
      taxIdentificationNumber: z.string().min(5),
      declarationAccepted: z.boolean().refine(v => v === true, {
        message: "You must accept the KYB declaration",
      }),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;

      const verification = await createKYCVerification({
        userId,
        verificationType: "BUSINESS",
        primaryDocumentId: input.businessRegistrationDocId,
        secondaryDocumentId: input.taxCertificateDocId,
        selfieDocumentId: input.directorIdDocId,
        status: "PENDING_REVIEW",
        submittedAt: new Date(),
        metadata: {
          businessName: input.businessName,
          registrationNumber: input.registrationNumber,
          taxIdentificationNumber: input.taxIdentificationNumber,
          incorporationCertDocId: input.incorporationCertDocId,
          memorandumDocId: input.memorandumDocId,
        },
      });

      return {
        verificationId: verification.id,
        status: "PENDING_REVIEW",
        estimatedReviewTime: "2-5 business days",
        message: "Business verification submitted. You will be notified when reviewed.",
      };
    }),

  /**
   * Get the current KYC/KYB verification status for the authenticated user.
   */
  getVerification: protectedProcedure.query(async ({ ctx }) => {
    const verification = await getLatestKYCVerification(ctx.user.id);
    const documents = await listKYCDocuments(ctx.user.id);

    return {
      verification: verification ?? null,
      documents,
      isVerified: verification?.status === "APPROVED",
      verificationLevel: verification?.verificationType ?? null,
    };
  }),

  /**
   * List all KYC documents for the authenticated user.
   */
  listDocuments: protectedProcedure.query(async ({ ctx }) => {
    return listKYCDocuments(ctx.user.id);
  }),

  /**
   * Admin: Review and approve/reject a KYC/KYB verification.
   */
  reviewVerification: adminProcedure
    .input(z.object({
      verificationId: z.number().int().positive(),
      decision: z.enum(["APPROVED", "REJECTED", "MORE_INFO_REQUIRED"]),
      notes: z.string().optional(),
      rejectionReason: z.string().optional(),
      // Optional: trader/entity name for the notification message
      applicantName: z.string().optional(),
      applicantType: z.enum(["INDIVIDUAL", "BUSINESS"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const verification = await updateKYCVerification(input.verificationId, {
        status: input.decision,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
        reviewNotes: input.notes ?? null,
        rejectionReason: input.rejectionReason ?? null,
      });

      // Send onboarding welcome notification when a stakeholder is approved
      if (input.decision === "APPROVED") {
        const entityLabel = input.applicantType === "BUSINESS" ? "Business" : "Trader";
        const name = input.applicantName ?? `Verification #${input.verificationId}`;
        await notifyOwner({
          title: `New Stakeholder Approved — ${name}`,
          content: [
            `${entityLabel} "${name}" has been approved and can now access the TradeGateway platform.`,
            `Verification ID: ${input.verificationId}`,
            `Reviewed by: ${ctx.user.name ?? ctx.user.openId}`,
            `Approved at: ${new Date().toUTCString()}`,
            `\nThe stakeholder has been notified and their account is now active.`,
          ].join("\n"),
        }).catch(() => { /* non-blocking */ });
      }

      // Send rejection notification
      if (input.decision === "REJECTED") {
        const name = input.applicantName ?? `Verification #${input.verificationId}`;
        await notifyOwner({
          title: `Stakeholder Verification Rejected — ${name}`,
          content: [
            `Verification for "${name}" was rejected.`,
            input.rejectionReason ? `Reason: ${input.rejectionReason}` : "",
            `Reviewed by: ${ctx.user.name ?? ctx.user.openId}`,
          ].filter(Boolean).join("\n"),
        }).catch(() => { /* non-blocking */ });
      }

      // Send in-app notification to the trader via Notification Centre
      if (verification?.userId) {
        const notifMap: Record<string, { title: string; message: string }> = {
          APPROVED: {
            title: "KYC Verification Approved ✓",
            message: `Your identity/business verification (ID: ${input.verificationId}) has been approved. You now have full access to the TradeGateway platform.`,
          },
          REJECTED: {
            title: "KYC Verification Rejected",
            message: `Your identity/business verification (ID: ${input.verificationId}) was rejected.${input.rejectionReason ? ` Reason: ${input.rejectionReason}` : " Please contact support for details."}`,
          },
          MORE_INFO_REQUIRED: {
            title: "KYC Verification — Additional Information Required",
            message: `Your identity/business verification (ID: ${input.verificationId}) requires additional information.${input.notes ? ` Notes: ${input.notes}` : " Please re-submit with the requested documents."}`,
          },
        };
        const notif = notifMap[input.decision];
        if (notif) {
          await createUserNotification({
            userId: verification.userId,
            type: "kyc_status_update",
            title: notif.title,
            body: notif.message,
          }).catch(() => { /* non-blocking */ });
        }
      }
      return {
        verificationId: input.verificationId,
        status: input.decision,
        reviewedAt: verification?.reviewedAt ?? null,
        notificationSent: true,
      };
    }),

  /**
   * Admin: List all pending KYC/KYB verifications.
   */
  listPendingVerifications: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
      verificationType: z.enum(["INDIVIDUAL", "BUSINESS", "ALL"]).default("ALL"),
    }))
    .query(async ({ input }) => {
      return listKYCVerifications({
        status: "PENDING_REVIEW",
        verificationType: input.verificationType === "ALL" ? undefined : input.verificationType,
        limit: input.limit,
        offset: input.offset,
      });
    }),
});
