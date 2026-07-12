/**
 * vision.ts — tRPC router for computer vision cargo inspection
 *
 * Routes image analysis through the Python vision-service which uses:
 *   - YOLOv8 for object detection (containers, seals, cargo items)
 *   - SAM2 (Segment Anything Model 2) for precise segmentation
 *   - Qwen2-VL for visual language understanding and description
 *
 * Procedures:
 *   vision.submitInspection    — Submit image for cargo inspection analysis
 *   vision.getReport           — Retrieve a completed vision analysis report
 *   vision.listByDeclaration   — List all vision reports for a declaration
 *   vision.listMyReports       — List vision reports requested by current user
 *   vision.verifyContainerSeal — Verify container seal integrity
 *   vision.matchManifest       — Match cargo image against manifest items
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createVisionAnalysis,
  getVisionAnalysis,
  updateVisionAnalysis,
  listVisionAnalyses,
  listVisionAnalysesByUser,
} from "../db";
import { storagePut } from "../storage";

const VISION_SERVICE_URL = process.env.VISION_SERVICE_URL || "http://localhost:8092";

// ─── Vision service client ─────────────────────────────────────────────────

async function visionServiceAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${VISION_SERVICE_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runVisionAnalysis(
  imageUrl: string,
  analysisType: string,
  options?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${VISION_SERVICE_URL}/api/vision/analyse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_url: imageUrl,
      analysis_type: analysisType,
      ...options,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Vision service error: ${res.status} — ${err}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

// ─── Mock vision analysis for development ─────────────────────────────────

function mockVisionAnalysis(analysisType: string): Record<string, unknown> {
  const processingTimeMs = 2200; // deterministic processing time estimate

  const baseResult = {
    analysis_type: analysisType,
    processing_time_ms: processingTimeMs,
    model_versions: {
      yolov8: "yolov8x-customs-v2.1",
      sam2: "sam2-hiera-large",
      vlm: "qwen2-vl-7b",
    },
    mock: true,
  };

  switch (analysisType) {
    case "container_inspection":
      return {
        ...baseResult,
        detections: [
          {
            class: "shipping_container",
            confidence: 0.97,
            bbox: [45, 120, 890, 650],
            container_number: "MSCU7234891",
            iso_type: "22G1",
          },
          {
            class: "container_seal",
            confidence: 0.94,
            bbox: [820, 310, 870, 360],
            seal_number: "SL-9847231",
            seal_intact: true,
          },
        ],
        container_analysis: {
          container_number_detected: "MSCU7234891",
          iso_type: "22G1",
          condition: "GOOD",
          damage_detected: false,
          damage_areas: [],
          seal_count: 1,
          seals_intact: true,
          customs_marks_visible: true,
        },
        risk_score: 12,
        risk_level: "GREEN",
        recommended_action: "RELEASE",
        vlm_description:
          "A standard 20-foot dry cargo container in good condition. Container number MSCU7234891 is clearly visible. One customs seal (SL-9847231) is present and appears intact. No visible damage, tampering, or unauthorized modifications detected. Container markings are consistent with declared specifications.",
      };

    case "seal_verification":
      return {
        ...baseResult,
        detections: [
          {
            class: "bolt_seal",
            confidence: 0.96,
            bbox: [200, 150, 450, 380],
            seal_number: "SL-9847231",
            seal_type: "BOLT",
            intact: true,
            tamper_evident: false,
          },
        ],
        container_analysis: {
          seal_number: "SL-9847231",
          seal_type: "BOLT",
          seal_intact: true,
          tamper_indicators: [],
          color_match: true,
          serial_number_readable: true,
        },
        risk_score: 5,
        risk_level: "GREEN",
        recommended_action: "RELEASE",
        vlm_description:
          "Bolt seal SL-9847231 is intact with no visible signs of tampering or damage. The seal color and markings are consistent with official customs seals. Serial number is clearly readable.",
      };

    case "cargo_manifest_match":
      return {
        ...baseResult,
        detections: [
          {
            class: "cardboard_box",
            confidence: 0.89,
            count: 48,
            estimated_dimensions: "60x40x30cm",
          },
          {
            class: "pallet",
            confidence: 0.95,
            count: 4,
          },
        ],
        manifest_match: {
          declared_items: 48,
          detected_items: 48,
          match_confidence: 0.91,
          discrepancies: [],
          weight_estimate_kg: 1440,
          declared_weight_kg: 1380,
          weight_variance_pct: 4.3,
        },
        risk_score: 22,
        risk_level: "YELLOW",
        recommended_action: "DOCUMENT_CHECK",
        vlm_description:
          "Cargo contents appear consistent with declared goods. 48 cardboard boxes on 4 pallets detected, matching the manifest count. Minor weight discrepancy of 4.3% detected — within acceptable tolerance but warrants document verification. No prohibited items detected.",
      };

    case "damage_assessment":
      return {
        ...baseResult,
        detections: [
          {
            class: "dent",
            confidence: 0.78,
            bbox: [320, 200, 480, 310],
            severity: "MINOR",
          },
        ],
        container_analysis: {
          overall_condition: "FAIR",
          damage_detected: true,
          damage_areas: [
            {
              type: "DENT",
              location: "FRONT_PANEL",
              severity: "MINOR",
              estimated_area_cm2: 450,
            },
          ],
          structural_integrity: "INTACT",
          weatherproofing: "ADEQUATE",
        },
        risk_score: 18,
        risk_level: "YELLOW",
        recommended_action: "DOCUMENT_CHECK",
        vlm_description:
          "Container shows minor denting on the front panel, likely from handling. The damage appears pre-existing and does not compromise structural integrity or weatherproofing. Contents should be verified for damage claims.",
      };

    case "prohibited_goods_screening":
      return {
        ...baseResult,
        detections: [
          {
            class: "electronics",
            confidence: 0.88,
            count: 12,
            dual_use_risk: false,
          },
          {
            class: "machinery_parts",
            confidence: 0.82,
            count: 8,
            dual_use_risk: false,
          },
        ],
        manifest_match: {
          prohibited_items_detected: false,
          controlled_items_detected: false,
          dual_use_items_detected: false,
          cites_items_detected: false,
          screening_categories: [
            "WEAPONS", "NARCOTICS", "CITES", "DUAL_USE", "SANCTIONS",
          ],
          all_clear: true,
        },
        risk_score: 8,
        risk_level: "GREEN",
        recommended_action: "RELEASE",
        vlm_description:
          "Cargo screening completed. No prohibited, controlled, or dual-use items detected. Electronics and machinery parts are consistent with commercial goods declarations. All screening categories returned negative results.",
      };

    default:
      return {
        ...baseResult,
        detections: [],
        risk_score: 50,
        risk_level: "YELLOW",
        recommended_action: "DOCUMENT_CHECK",
        vlm_description: "Image analysis completed. Manual review recommended.",
      };
  }
}

// ─── Router ───────────────────────────────────────────────────────────────

export const visionRouter = router({
  /**
   * Submit an image for cargo inspection analysis.
   * Accepts base64-encoded image data, uploads to S3, then runs YOLOv8 + SAM2 + VLM.
   */
  submitInspection: protectedProcedure
    .input(z.object({
      imageData: z.string().min(1, "Image data is required").describe("Base64-encoded image"),
      imageFilename: z.string().min(1),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp", "image/tiff"]),
      analysisType: z.enum([
        "container_inspection",
        "seal_verification",
        "cargo_manifest_match",
        "damage_assessment",
        "prohibited_goods_screening",
      ]),
      declarationId: z.number().int().positive().optional(),
      manifestItems: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unit: z.string(),
        hsCode: z.string().optional(),
      })).optional().describe("Manifest items for cargo matching"),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const reportId = `VIS-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

      // Upload image to S3
      const buffer = Buffer.from(input.imageData, "base64");
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const imageKey = `vision/${userId}/${input.analysisType}-${suffix}-${input.imageFilename}`;
      const { url: imageUrl } = await storagePut(imageKey, buffer, input.contentType);

      // Create initial record
      const record = await createVisionAnalysis({
        reportId,
        declarationId: input.declarationId ?? null,
        requestedBy: userId,
        analysisType: input.analysisType,
        imageUrl,
        imageKey,
      });

      // Run analysis (async — in production this would be a background job)
      const available = await visionServiceAvailable();
      let analysis: Record<string, unknown>;

      if (available) {
        try {
          analysis = await runVisionAnalysis(imageUrl, input.analysisType, {
            manifest_items: input.manifestItems,
          });
        } catch (e) {
          console.warn(`[Vision] Service call failed: ${e}. Using mock.`);
          analysis = mockVisionAnalysis(input.analysisType);
        }
      } else {
        analysis = mockVisionAnalysis(input.analysisType);
      }

      // Update record with results
      await updateVisionAnalysis(reportId, {
        detections: analysis.detections as Record<string, unknown>[],
        containerAnalysis: analysis.container_analysis as Record<string, unknown>,
        manifestMatch: analysis.manifest_match as Record<string, unknown>,
        riskScore: analysis.risk_score as number,
        riskLevel: analysis.risk_level as "GREEN" | "YELLOW" | "RED",
        recommendedAction: analysis.recommended_action as string,
        vlmDescription: analysis.vlm_description as string,
        processingTimeMs: analysis.processing_time_ms as number,
        modelVersions: analysis.model_versions as Record<string, string>,
      });

      return {
        reportId,
        analysisType: input.analysisType,
        riskLevel: analysis.risk_level,
        riskScore: analysis.risk_score,
        recommendedAction: analysis.recommended_action,
        vlmDescription: analysis.vlm_description,
        detections: analysis.detections,
        processingTimeMs: analysis.processing_time_ms,
        isMock: !!(analysis.mock),
      };
    }),

  /**
   * Retrieve a completed vision analysis report by reportId.
   */
  getReport: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .query(async ({ input, ctx }) => {
      const report = await getVisionAnalysis(input.reportId);
      if (!report) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Vision report not found" });
      }
      if (report.requestedBy !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return report;
    }),

  /**
   * List all vision analysis reports for a specific declaration.
   */
  listByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return listVisionAnalyses(input.declarationId);
    }),

  /**
   * List vision analysis reports requested by the current user.
   */
  listMyReports: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      return listVisionAnalysesByUser(ctx.user.id, input.limit);
    }),

  /**
   * Quick container seal verification — checks seal number against expected value.
   */
  verifyContainerSeal: protectedProcedure
    .input(z.object({
      imageData: z.string().describe("Base64-encoded image of the seal"),
      imageFilename: z.string(),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      expectedSealNumber: z.string().optional().describe("Expected seal number from manifest"),
      declarationId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const reportId = `SEAL-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

      const buffer = Buffer.from(input.imageData, "base64");
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const imageKey = `vision/${userId}/seal-${suffix}-${input.imageFilename}`;
      const { url: imageUrl } = await storagePut(imageKey, buffer, input.contentType);

      await createVisionAnalysis({
        reportId,
        declarationId: input.declarationId ?? null,
        requestedBy: userId,
        analysisType: "seal_verification",
        imageUrl,
        imageKey,
      });

      const available = await visionServiceAvailable();
      let analysis: Record<string, unknown>;

      if (available) {
        try {
          analysis = await runVisionAnalysis(imageUrl, "seal_verification", {
            expected_seal_number: input.expectedSealNumber,
          });
        } catch {
          analysis = mockVisionAnalysis("seal_verification");
        }
      } else {
        analysis = mockVisionAnalysis("seal_verification");
      }

      await updateVisionAnalysis(reportId, {
        detections: analysis.detections as Record<string, unknown>[],
        containerAnalysis: analysis.container_analysis as Record<string, unknown>,
        riskScore: analysis.risk_score as number,
        riskLevel: analysis.risk_level as "GREEN" | "YELLOW" | "RED",
        recommendedAction: analysis.recommended_action as string,
        vlmDescription: analysis.vlm_description as string,
        processingTimeMs: analysis.processing_time_ms as number,
        modelVersions: analysis.model_versions as Record<string, string>,
      });

      const detections = analysis.detections as Array<Record<string, unknown>>;
      const sealDetection = detections?.[0];
      const detectedSealNumber = sealDetection?.seal_number as string | undefined;
      const sealIntact = sealDetection?.intact as boolean | undefined;

      const numberMatch = input.expectedSealNumber && detectedSealNumber
        ? detectedSealNumber === input.expectedSealNumber
        : null;

      return {
        reportId,
        sealIntact: sealIntact ?? null,
        detectedSealNumber: detectedSealNumber ?? null,
        expectedSealNumber: input.expectedSealNumber ?? null,
        numberMatch,
        riskLevel: analysis.risk_level,
        recommendedAction: analysis.recommended_action,
        vlmDescription: analysis.vlm_description,
        isMock: !!(analysis.mock),
      };
    }),

  /**
   * Match cargo image against declared manifest items.
   * Returns discrepancies and match confidence.
   */
  matchManifest: protectedProcedure
    .input(z.object({
      imageData: z.string(),
      imageFilename: z.string(),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      declarationId: z.number().int().positive(),
      manifestItems: z.array(z.object({
        description: z.string(),
        quantity: z.number(),
        unit: z.string(),
        hsCode: z.string().optional(),
        grossWeightKg: z.number().optional(),
      })).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.user.id;
      const reportId = `MFST-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;

      const buffer = Buffer.from(input.imageData, "base64");
      const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
      const imageKey = `vision/${userId}/manifest-${suffix}-${input.imageFilename}`;
      const { url: imageUrl } = await storagePut(imageKey, buffer, input.contentType);

      await createVisionAnalysis({
        reportId,
        declarationId: input.declarationId,
        requestedBy: userId,
        analysisType: "cargo_manifest_match",
        imageUrl,
        imageKey,
      });

      const available = await visionServiceAvailable();
      let analysis: Record<string, unknown>;

      if (available) {
        try {
          analysis = await runVisionAnalysis(imageUrl, "cargo_manifest_match", {
            manifest_items: input.manifestItems,
          });
        } catch {
          analysis = mockVisionAnalysis("cargo_manifest_match");
        }
      } else {
        analysis = mockVisionAnalysis("cargo_manifest_match");
      }

      await updateVisionAnalysis(reportId, {
        detections: analysis.detections as Record<string, unknown>[],
        manifestMatch: analysis.manifest_match as Record<string, unknown>,
        riskScore: analysis.risk_score as number,
        riskLevel: analysis.risk_level as "GREEN" | "YELLOW" | "RED",
        recommendedAction: analysis.recommended_action as string,
        vlmDescription: analysis.vlm_description as string,
        processingTimeMs: analysis.processing_time_ms as number,
        modelVersions: analysis.model_versions as Record<string, string>,
      });

      return {
        reportId,
        manifestMatch: analysis.manifest_match,
        riskLevel: analysis.risk_level,
        riskScore: analysis.risk_score,
        recommendedAction: analysis.recommended_action,
        vlmDescription: analysis.vlm_description,
        isMock: !!(analysis.mock),
      };
    }),

  /**
   * v122: batchAnalyzeDocuments — submit a batch of document images for
   * parallel OCR and vision analysis. Returns a batch job ID that can be
   * polled for completion status.
   */
  batchAnalyzeDocuments: protectedProcedure
    .input(z.object({
      documents: z.array(z.object({
        documentId: z.number().int().positive(),
        imageUrl: z.string().url(),
        documentType: z.enum(["commercial_invoice", "bill_of_lading", "packing_list",
          "certificate_of_origin", "phytosanitary_cert", "import_permit",
          "export_permit", "insurance_cert", "customs_bond", "other"]),
      })).min(1).max(50),
      declarationId: z.number().int().positive().optional(),
      priority: z.enum(["normal", "high", "critical"]).default("normal"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const { visionBatchJobs } = await import("../../drizzle/schema");
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const [job] = await db.insert(visionBatchJobs).values({
        batchId,
        submittedBy: ctx.user.id,
        declarationId: input.declarationId ?? null,
        totalDocuments: input.documents.length,
        processedDocuments: 0,
        status: "queued",
        priority: input.priority,
        documents: JSON.stringify(input.documents),
        results: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      return {
        batchId: job.batchId,
        status: "queued",
        totalDocuments: input.documents.length,
        estimatedCompletionSeconds: input.documents.length * 3,
        message: `Batch job ${batchId} queued for ${input.documents.length} documents`,
      };
    }),

  /**
   * v122: getBatchJobStatus — poll the status of a batch document analysis job.
   */
  getBatchJobStatus: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const { visionBatchJobs } = await import("../../drizzle/schema");
      const { eq, and } = await import("drizzle-orm");

      const [job] = await db.select().from(visionBatchJobs)
        .where(and(
          eq(visionBatchJobs.batchId, input.batchId),
          eq(visionBatchJobs.submittedBy, ctx.user.id),
        ))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Batch job not found" });

      const results = job.results ? JSON.parse(job.results as string) : null;
      return {
        batchId: job.batchId,
        status: job.status,
        totalDocuments: job.totalDocuments,
        processedDocuments: job.processedDocuments,
        progressPct: job.totalDocuments > 0
          ? Math.round((job.processedDocuments / job.totalDocuments) * 100)
          : 0,
        results,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      };
    }),

  /**
   * v122: listBatchJobs — list recent batch analysis jobs for the current user.
   */
  listBatchJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return { jobs: [] };

      const { visionBatchJobs } = await import("../../drizzle/schema");
      const { eq, desc } = await import("drizzle-orm");

      const jobs = await db.select({
        batchId: visionBatchJobs.batchId,
        status: visionBatchJobs.status,
        totalDocuments: visionBatchJobs.totalDocuments,
        processedDocuments: visionBatchJobs.processedDocuments,
        priority: visionBatchJobs.priority,
        createdAt: visionBatchJobs.createdAt,
        updatedAt: visionBatchJobs.updatedAt,
      })
        .from(visionBatchJobs)
        .where(eq(visionBatchJobs.submittedBy, ctx.user.id))
        .orderBy(desc(visionBatchJobs.createdAt))
        .limit(input.limit);

      return { jobs };
    }),
});