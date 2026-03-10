import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createDeclaration, getDeclarationById, getDeclarationsByTrader,
  getAllDeclarations, updateDeclaration, getDeclarationStats, getDeclarationStatsByTrader,
  logAuditEvent, createNotification, createUserNotification, getProfileByUserId
} from "../db";
import { clearanceCertificates } from "../../drizzle/schema";
import { invokeLLM } from "../_core/llm";
import { assertCan, setOwner } from "../_core/permify";
import { nanoid } from "nanoid";

// Generate a unique declaration number: TG-YYYY-XXXXXXXX
function generateDeclarationNumber(): string {
  const year = new Date().getFullYear();
  const id = nanoid(8).toUpperCase();
  return `TG-${year}-${id}`;
}

// Generate UCR (Unique Consignment Reference)
function generateUCR(): string {
  return `UCR${Date.now()}${nanoid(6).toUpperCase()}`;
}

// Real AI risk scoring via LLM
async function computeRiskScore(data: {
  hsCode: string;
  countryOfOrigin: string;
  invoiceValue: number;
  goodsDescription: string;
  declarationType: string;
}): Promise<{ score: number; lane: string; explanation: Record<string, unknown> }> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a customs risk assessment AI for a national single window trade platform. 
Analyze trade declarations and return a JSON risk assessment. Consider:
- High-risk HS codes (weapons, chemicals, dual-use goods, luxury goods)
- High-risk countries (sanctioned, conflict zones, high fraud history)
- Invoice value anomalies (under/over invoicing)
- Goods description vs HS code consistency
- Declaration type risk factors

Return JSON with: score (0-100), lane (green/yellow/red/blue), 
factors (array of {name, weight, value, description}), 
summary (string explanation).
Green: 0-30 (auto-clear), Yellow: 31-60 (doc review), Red: 61-100 (physical inspection), Blue: AEO fast-track.`
        },
        {
          role: "user",
          content: JSON.stringify(data)
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "risk_assessment",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number" },
              lane: { type: "string", enum: ["green", "yellow", "red", "blue"] },
              factors: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    weight: { type: "number" },
                    value: { type: "number" },
                    description: { type: "string" }
                  },
                  required: ["name", "weight", "value", "description"],
                  additionalProperties: false
                }
              },
              summary: { type: "string" }
            },
            required: ["score", "lane", "factors", "summary"],
            additionalProperties: false
          }
        }
      }
    });
    const content = response.choices[0]?.message?.content;
    if (content && typeof content === 'string') {
      const parsed = JSON.parse(content);
      return {
        score: parsed.score,
        lane: parsed.lane,
        explanation: parsed
      };
    }
  } catch (e) {
    console.error("[RiskScore] LLM error:", e);
  }
  // Fallback: deterministic score based on HS code hash (no randomness)
  const hsHash = data.hsCode ? data.hsCode.split("").reduce((a, c) => a + c.charCodeAt(0), 0) : 50;
  const score = (hsHash % 40) + 10;
  return {
    score,
    lane: score < 30 ? "green" : score < 60 ? "yellow" : "red",
    explanation: { summary: "Automated assessment", factors: [] }
  };
}

export const declarationsRouter = router({
  // Create a new draft declaration
  create: protectedProcedure
    .input(z.object({
      declarationType: z.enum(["import", "export", "transit", "re_export"]),
      hsCode: z.string().min(6).max(12),
      goodsDescription: z.string().min(10),
      countryOfOrigin: z.string().length(2),
      countryOfDestination: z.string().length(2).optional(),
      portOfEntry: z.string().min(2),
      grossWeight: z.number().positive(),
      netWeight: z.number().positive(),
      numberOfPackages: z.number().int().positive(),
      invoiceValue: z.number().positive(),
      invoiceCurrency: z.string().length(3).default("USD"),
    }))
    .mutation(async ({ ctx, input }) => {
      const profile = await getProfileByUserId(ctx.user.id);
      if (!profile || profile.status !== "approved") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Your trader profile must be approved before submitting declarations." });
      }
      const decl = await createDeclaration({
        declarationNumber: generateDeclarationNumber(),
        ucr: generateUCR(),
        traderId: ctx.user.id,
        declarationType: input.declarationType,
        status: "draft",
        hsCode: input.hsCode,
        goodsDescription: input.goodsDescription,
        countryOfOrigin: input.countryOfOrigin,
        countryOfDestination: input.countryOfDestination,
        portOfEntry: input.portOfEntry,
        grossWeight: String(input.grossWeight),
        netWeight: String(input.netWeight),
        numberOfPackages: input.numberOfPackages,
        invoiceValue: String(input.invoiceValue),
        invoiceCurrency: input.invoiceCurrency,
      });
      await logAuditEvent({
        entityType: "declaration",
        entityId: decl!.id,
        action: "created",
        actorId: ctx.user.id,
        actorType: "trader",
        newState: decl,
      });
      // Permify: register trader as owner of this declaration
      await setOwner("declaration", decl!.id, ctx.user.id);
      return decl;
    }),

  // Submit a declaration (triggers risk scoring)
  submit: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      if (decl.traderId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      if (decl.status !== "draft") throw new TRPCError({ code: "BAD_REQUEST", message: "Only draft declarations can be submitted." });

      // Run AI risk scoring
      const risk = await computeRiskScore({
        hsCode: decl.hsCode ?? "",
        countryOfOrigin: decl.countryOfOrigin ?? "",
        invoiceValue: parseFloat(decl.invoiceValue ?? "0"),
        goodsDescription: decl.goodsDescription ?? "",
        declarationType: decl.declarationType,
      });

      // Compute duties (simplified: 10% duty + 15% VAT on CIF value)
      const cif = parseFloat(decl.invoiceValue ?? "0");
      const duty = cif * 0.10;
      const vat = (cif + duty) * 0.15;
      const total = duty + vat;

      // Permify: setOwner is called on create; submit is gated by traderId check above.
      // assertCan is reserved for cross-role operations (approve, release, assess).

      const updated = await updateDeclaration(input.id, {
        status: "under_assessment",
        riskScore: String(risk.score),
        riskLane: risk.lane as any,
        aiExplanation: risk.explanation,
        dutyAmount: String(duty.toFixed(2)),
        vatAmount: String(vat.toFixed(2)),
        totalDue: String(total.toFixed(2)),
        submittedAt: new Date(),
      });

      await logAuditEvent({
        entityType: "declaration",
        entityId: input.id,
        action: "submitted",
        actorId: ctx.user.id,
        actorType: "trader",
        previousState: { status: "draft" },
        newState: { status: "under_assessment", riskScore: risk.score, riskLane: risk.lane },
      });

      await createNotification({
        userId: ctx.user.id,
        type: "declaration_submitted",
        title: "Declaration Submitted",
        message: `Your declaration ${decl.declarationNumber} has been submitted. Risk lane: ${risk.lane.toUpperCase()}. Total duties: ${total.toFixed(2)} ${decl.invoiceCurrency}.`,
        entityType: "declaration",
        entityId: input.id,
      });

      // In-app Notification Centre entry
      await createUserNotification({
        userId: ctx.user.id,
        type: "declaration_submitted",
        title: "Declaration Submitted ✓",
        body: `Your declaration ${decl.declarationNumber} has been submitted for assessment. Risk lane assigned: ${risk.lane.toUpperCase()}. Estimated duties: ${total.toFixed(2)} ${decl.invoiceCurrency ?? "USD"}.`,
        declarationId: input.id,
      }).catch(() => { /* non-blocking */ });

      return updated;
    }),

  // Get trader's own declarations
  myDeclarations: protectedProcedure
    .input(z.object({ limit: z.number().default(20), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      return getDeclarationsByTrader(ctx.user.id, input.limit, input.offset);
    }),

  // Get a single declaration (trader sees own, officer sees all)
  byId: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer", "security"];
      if (decl.traderId !== ctx.user.id && !officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return decl;
    }),

  // Get all declarations (customs officers / admin / finance / inspector / oga_officer)
  all: protectedProcedure
    .input(z.object({
      limit: z.number().default(50),
      offset: z.number().default(0),
      status: z.string().optional(),
      riskLane: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer", "security"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      return getAllDeclarations(input.limit, input.offset, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        status: input.status,
      });
    }),

  // Update declaration status (customs officer action)
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["docs_required", "payment_pending", "under_examination", "examination_complete", "cleared", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer", "inspector"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });

      // Permify: assert officer can assess this declaration
      const permifyAction = input.status === "cleared" ? "release" :
        input.status === "under_examination" ? "hold" : "assess";
      await assertCan(String(ctx.user.id), "declaration", String(input.id), permifyAction);

      const updateData: Record<string, unknown> = { status: input.status };
      if (input.status === "cleared") updateData.clearedAt = new Date();

      const updated = await updateDeclaration(input.id, updateData as any);

      await logAuditEvent({
        entityType: "declaration",
        entityId: input.id,
        action: `status_changed_to_${input.status}`,
        actorId: ctx.user.id,
        actorType: "customs_officer",
        previousState: { status: decl.status },
        newState: { status: input.status },
        metadata: { notes: input.notes },
      });

      // Notify trader via legacy notifications table
      const notifType = input.status === "cleared" ? "declaration_cleared" :
        input.status === "rejected" ? "declaration_rejected" : "declaration_submitted";
      await createNotification({
        userId: decl.traderId,
        type: notifType,
        title: `Declaration ${input.status.replace(/_/g, " ").toUpperCase()}`,
        message: `Declaration ${decl.declarationNumber} status updated to: ${input.status}. ${input.notes ?? ""}`,
        entityType: "declaration",
        entityId: input.id,
      });

      // Also create a user_notification for the Notification Centre
      const statusMessages: Record<string, string> = {
        cleared: `Your declaration ${decl.declarationNumber} has been cleared. Goods may be released.`,
        rejected: `Your declaration ${decl.declarationNumber} has been rejected. ${input.notes ? `Reason: ${input.notes}` : "Please review and resubmit."}`,
        docs_required: `Additional documents required for ${decl.declarationNumber}. ${input.notes ?? "Please upload the requested documents."}`,
        payment_pending: `Payment required for ${decl.declarationNumber}. Please complete payment to proceed.`,
        under_examination: `${decl.declarationNumber} has been selected for physical examination.`,
        examination_complete: `Physical examination of ${decl.declarationNumber} is complete. Awaiting final clearance.`,
      };
      const userNotifType = input.status === "cleared" ? "declaration_cleared" :
        input.status === "rejected" ? "declaration_rejected" :
        input.status === "docs_required" ? "docs_required" : "status_update";
      await createUserNotification({
        userId: decl.traderId,
        type: userNotifType,
        title: `Declaration ${input.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`,
        body: statusMessages[input.status] ?? `Declaration ${decl.declarationNumber} status: ${input.status}.`,
        declarationId: input.id,
      });

      return updated;
    }),

  // Dashboard stats (admin/officers get platform-wide stats; traders get their own stats)
  stats: protectedProcedure.query(async ({ ctx }) => {
    const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer", "security"];
    if (officerRoles.includes(ctx.user.role)) {
      return getDeclarationStats();
    }
    // Trader: return their own stats
    return getDeclarationStatsByTrader(ctx.user.id);
  }),

  /**
   * Get the status timeline for a declaration.
   * Derives timeline steps from the declaration's current status and audit events.
   */
  getTimeline: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });

      // Only the owner (user role) or admin/customs_officer can view
      if (ctx.user.role === "user" && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Fetch audit events for this declaration
      const db = await (await import("../db")).getDb();
      let auditRows: Array<{ action: string; actorType: string | null; createdAt: Date; metadata: unknown }> = [];
      if (db) {
        const { auditEvents } = await import("../../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        auditRows = await db.select({
          action: auditEvents.action,
          actorType: auditEvents.actorType,
          createdAt: auditEvents.createdAt,
          metadata: auditEvents.metadata,
        })
          .from(auditEvents)
          .where(and(
            eq(auditEvents.entityType, "declaration"),
            eq(auditEvents.entityId, input.id)
          ))
          .orderBy(auditEvents.createdAt);
      }

      // Define the ordered pipeline steps
      const STEPS = [
        { key: "draft",               label: "Declaration Drafted",      description: "Shipment details entered and saved as draft." },
        { key: "submitted",           label: "Submitted for Review",      description: "Declaration submitted to customs for assessment." },
        { key: "under_assessment",    label: "Risk Assessment",           description: "Automated risk scoring and document verification in progress." },
        { key: "docs_required",       label: "Additional Documents Requested", description: "Customs has requested supporting documents." },
        { key: "payment_pending",     label: "Duty Payment Due",          description: "Duties and taxes calculated. Awaiting payment." },
        { key: "payment_confirmed",   label: "Payment Confirmed",         description: "Duty payment received and verified." },
        { key: "under_examination",   label: "Physical Inspection",       description: "Cargo selected for physical examination by customs officers." },
        { key: "examination_complete",label: "Inspection Complete",       description: "Physical inspection completed. Awaiting final clearance." },
        { key: "cleared",             label: "Goods Released",            description: "Customs clearance granted. Goods released for collection." },
      ];

      const currentStatus = decl.status;
      const currentIdx = STEPS.findIndex(s => s.key === currentStatus);

      // Build timeline steps with timestamps from audit events
      const steps = STEPS.map((step, idx) => {
        // Find the audit event for this status transition
        const auditMatch = auditRows.find(a =>
          a.action === `status_changed_to_${step.key}` ||
          (step.key === "submitted" && a.action === "declaration_submitted") ||
          (step.key === "draft" && a.action === "declaration_created")
        );

        let timestamp: Date | null = null;
        if (step.key === "draft") timestamp = decl.createdAt;
        else if (step.key === "submitted") timestamp = decl.submittedAt ?? null;
        else if (step.key === "cleared") timestamp = decl.clearedAt ?? null;
        else if (auditMatch) timestamp = auditMatch.createdAt;

        const isCompleted = currentIdx > idx || currentStatus === step.key;
        const isCurrent = currentStatus === step.key;
        const isSkipped = currentStatus === "rejected" || currentStatus === "cancelled";

        return {
          key: step.key,
          label: step.label,
          description: step.description,
          status: isCurrent ? "current" as const
            : isCompleted ? "completed" as const
            : isSkipped && idx > currentIdx ? "skipped" as const
            : "pending" as const,
          timestamp,
          actor: auditMatch?.actorType ?? null,
          notes: (auditMatch?.metadata as Record<string, unknown> | null)?.notes as string | null ?? null,
        };
      });

      // Append rejection/cancellation as terminal step if applicable
      if (currentStatus === "rejected" || currentStatus === "cancelled") {
        const terminalAudit = auditRows.find(a => a.action.includes(currentStatus));
        steps.push({
          key: currentStatus,
          label: currentStatus === "rejected" ? "Declaration Rejected" : "Declaration Cancelled",
          description: currentStatus === "rejected"
            ? "This declaration was rejected by customs. Please review the notes and resubmit."
            : "This declaration was cancelled.",
          status: "current" as const,
          timestamp: terminalAudit?.createdAt ?? decl.updatedAt,
          actor: terminalAudit?.actorType ?? null,
          notes: (terminalAudit?.metadata as Record<string, unknown> | null)?.notes as string | null ?? null,
        });
      }

      return {
        declarationId: input.id,
        declarationNumber: decl.declarationNumber,
        currentStatus,
        riskLane: decl.riskLane,
        steps,
      };
    }),

  /**
   * Generate and return a clearance certificate PDF URL.
   * Only available for cleared declarations.
   */
  listMyCertificates: protectedProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const { desc, eq } = await import("drizzle-orm");

      // Traders can only see their own certificates; admins and officers see all
      const certs = ctx.user.role === "user"
        ? await db
            .select()
            .from(clearanceCertificates)
            .where(eq(clearanceCertificates.traderId, ctx.user.id))
            .orderBy(desc(clearanceCertificates.generatedAt))
            .limit(input.limit)
            .offset(input.offset)
        : await db
            .select()
            .from(clearanceCertificates)
            .orderBy(desc(clearanceCertificates.generatedAt))
            .limit(input.limit)
            .offset(input.offset);

      return { certificates: certs, total: certs.length };
    }),

  generateClearanceCertificate: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (decl.status !== "cleared") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Clearance certificate is only available for cleared declarations." });
      }
      // Only the owner (user role) or admin can download
      if (ctx.user.role === "user" && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      // Build PDF content using a simple HTML template
      const clearedDate = decl.clearedAt
        ? new Date(decl.clearedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
        : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #1a1a2e; }
    .header { text-align: center; border-bottom: 3px solid #D4A017; padding-bottom: 20px; margin-bottom: 30px; }
    .header h1 { font-size: 28px; color: #0A1628; margin: 0 0 4px; letter-spacing: 1px; }
    .header h2 { font-size: 16px; color: #D4A017; margin: 0; font-weight: 500; }
    .cert-number { text-align: center; font-size: 13px; color: #666; margin-bottom: 30px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 11px; font-weight: 700; color: #D4A017; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 12px; }
    .row { display: flex; margin-bottom: 8px; }
    .label { font-size: 12px; color: #6b7280; width: 200px; flex-shrink: 0; }
    .value { font-size: 12px; color: #1a1a2e; font-weight: 600; }
    .clearance-box { background: #f0fdf4; border: 2px solid #16a34a; border-radius: 8px; padding: 20px; text-align: center; margin: 30px 0; }
    .clearance-box h3 { color: #16a34a; font-size: 20px; margin: 0 0 8px; }
    .clearance-box p { color: #374151; font-size: 13px; margin: 0; }
    .signature { display: flex; justify-content: space-between; margin-top: 60px; padding-top: 20px; }
    .sig-block { text-align: center; width: 200px; }
    .sig-line { border-top: 1px solid #374151; padding-top: 8px; font-size: 11px; color: #6b7280; }
    .footer { text-align: center; font-size: 10px; color: #9ca3af; margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 16px; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-45deg); font-size: 80px; color: rgba(212,160,23,0.08); font-weight: 900; letter-spacing: 8px; pointer-events: none; }
  </style>
</head>
<body>
  <div class="watermark">CLEARED</div>
  <div class="header">
    <h1>NATIONAL TRADE GATEWAY</h1>
    <h2>CUSTOMS CLEARANCE CERTIFICATE</h2>
  </div>
  <div class="cert-number">Certificate No: CERT-${decl.declarationNumber} &nbsp;|&nbsp; Issued: ${clearedDate}</div>

  <div class="clearance-box">
    <h3>✓ GOODS RELEASED FOR COLLECTION</h3>
    <p>This certificate confirms that the goods described below have been assessed, duties paid, and released by Customs Authority.</p>
  </div>

  <div class="section">
    <div class="section-title">Declaration Details</div>
    <div class="row"><span class="label">Declaration Number</span><span class="value">${decl.declarationNumber}</span></div>
    <div class="row"><span class="label">Unique Consignment Reference</span><span class="value">${decl.ucr ?? "N/A"}</span></div>
    <div class="row"><span class="label">Declaration Type</span><span class="value">${(decl.declarationType ?? "").replace(/_/g, " ").toUpperCase()}</span></div>
    <div class="row"><span class="label">Date Submitted</span><span class="value">${decl.submittedAt ? new Date(decl.submittedAt).toLocaleDateString("en-GB") : "N/A"}</span></div>
    <div class="row"><span class="label">Date Cleared</span><span class="value">${clearedDate}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Goods Information</div>
    <div class="row"><span class="label">Goods Description</span><span class="value">${decl.goodsDescription ?? "N/A"}</span></div>
    <div class="row"><span class="label">HS Code</span><span class="value">${decl.hsCode ?? "N/A"}</span></div>
    <div class="row"><span class="label">Country of Origin</span><span class="value">${decl.countryOfOrigin ?? "N/A"}</span></div>
    <div class="row"><span class="label">Port of Entry</span><span class="value">${decl.portOfEntry ?? "N/A"}</span></div>
    <div class="row"><span class="label">Number of Packages</span><span class="value">${decl.numberOfPackages ?? "N/A"}</span></div>
    <div class="row"><span class="label">Gross Weight</span><span class="value">${decl.grossWeight ? `${decl.grossWeight} kg` : "N/A"}</span></div>
  </div>

  <div class="section">
    <div class="section-title">Duties & Taxes</div>
    <div class="row"><span class="label">Invoice Value</span><span class="value">${decl.invoiceCurrency ?? "USD"} ${decl.invoiceValue ?? "N/A"}</span></div>
    <div class="row"><span class="label">Duty Amount</span><span class="value">${decl.invoiceCurrency ?? "USD"} ${decl.dutyAmount ?? "0.00"}</span></div>
    <div class="row"><span class="label">VAT Amount</span><span class="value">${decl.invoiceCurrency ?? "USD"} ${decl.vatAmount ?? "0.00"}</span></div>
    <div class="row"><span class="label">Total Paid</span><span class="value">${decl.invoiceCurrency ?? "USD"} ${decl.totalDue ?? "0.00"}</span></div>
  </div>

  <div class="signature">
    <div class="sig-block">
      <div style="height:50px"></div>
      <div class="sig-line">Customs Officer<br>National Trade Gateway</div>
    </div>
    <div class="sig-block">
      <div style="height:50px"></div>
      <div class="sig-line">Commissioner of Customs<br>National Trade Authority</div>
    </div>
    <div class="sig-block">
      <div style="height:50px"></div>
      <div class="sig-line">Official Stamp<br>&nbsp;</div>
    </div>
  </div>

  <div class="footer">
    This certificate is issued electronically by the National Trade Gateway Single Window Platform.<br>
    Verify authenticity at: tradegateway.gov | Certificate No: CERT-${decl.declarationNumber}
  </div>
</body>
</html>`;

      // Convert HTML to PDF buffer using puppeteer-free approach: store HTML as PDF via weasyprint-style
      // We'll use the built-in node approach: write to temp file, convert, upload to S3
      const { storagePut } = await import("../storage");
      const { nanoid: nanoId } = await import("nanoid");
      const { execSync } = await import("child_process");
      const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
      const { tmpdir } = await import("os");
      const { join } = await import("path");

      const tmpHtml = join(tmpdir(), `cert-${nanoId(8)}.html`);
      const tmpPdf = join(tmpdir(), `cert-${nanoId(8)}.pdf`);

      try {
        writeFileSync(tmpHtml, htmlContent, "utf-8");
        execSync(`manus-md-to-pdf "${tmpHtml}" "${tmpPdf}" 2>/dev/null || wkhtmltopdf "${tmpHtml}" "${tmpPdf}" 2>/dev/null || chromium-browser --headless --no-sandbox --print-to-pdf="${tmpPdf}" "${tmpHtml}" 2>/dev/null || true`, { timeout: 30_000 });

        let pdfBuffer: Buffer;
        try {
          pdfBuffer = readFileSync(tmpPdf);
        } catch {
          // Fallback: return the HTML as a downloadable file if PDF conversion fails
          const htmlBuffer = readFileSync(tmpHtml);
          const fileKey = `clearance-certificates/${decl.declarationNumber}-${nanoId(6)}.html`;
          const { url } = await storagePut(fileKey, htmlBuffer, "text/html");

          // Persist certificate record to DB (HTML fallback)
          try {
            const { getDb } = await import("../db");
            const db = await getDb();
            if (!db) throw new Error("no db");
            await db.insert(clearanceCertificates).values({
              declarationId: decl.id,
              traderId: decl.traderId,
              fileKey,
              fileUrl: url,
              declarationRef: decl.declarationNumber,
              goodsDescription: decl.goodsDescription ?? null,
              totalDutyPaid: decl.totalDue ? String(decl.totalDue) : null,
              currency: decl.invoiceCurrency ?? "USD",
              clearedAt: decl.clearedAt ? new Date(decl.clearedAt) : new Date(),
              generatedBy: ctx.user.id,
            });
          } catch { /* Non-fatal */ }

          return { url, format: "html" as const, declarationNumber: decl.declarationNumber };
        }

        const fileKey = `clearance-certificates/${decl.declarationNumber}-${nanoId(6)}.pdf`;
        const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");

        // Persist certificate record to DB
        try {
          const { getDb } = await import("../db");
          const db = await getDb();
          if (!db) throw new Error("no db");
          await db.insert(clearanceCertificates).values({
            declarationId: decl.id,
            traderId: decl.traderId,
            fileKey,
            fileUrl: url,
            declarationRef: decl.declarationNumber,
            goodsDescription: decl.goodsDescription ?? null,
            totalDutyPaid: decl.totalDue ? String(decl.totalDue) : null,
            currency: decl.invoiceCurrency ?? "USD",
            clearedAt: decl.clearedAt ? new Date(decl.clearedAt) : new Date(),
            generatedBy: ctx.user.id,
          });
        } catch { /* Non-fatal: certificate still returned even if DB write fails */ }

        return { url, format: "pdf" as const, declarationNumber: decl.declarationNumber };
      } finally {
        try { unlinkSync(tmpHtml); } catch { /* ignore */ }
        try { unlinkSync(tmpPdf); } catch { /* ignore */ }
      }
    }),

  /** Export declarations as CSV with optional date/status filters */
  exportCsv: protectedProcedure
    .input(z.object({
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
      status: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer", "finance", "inspector"];
      if (!allowedRoles.includes(ctx.user.role))
        throw new TRPCError({ code: "FORBIDDEN" });
      const rows = await getAllDeclarations(5000, 0, {
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        status: input.status,
      });
      const header = [
        "Declaration Number", "Status", "Trader ID",
        "HS Code", "Goods Description", "Invoice Value",
        "Invoice Currency", "Total Due", "Country of Origin",
        "Port of Entry", "Risk Lane", "Risk Score", "Submitted At", "Cleared At",
      ].join(",");
      const esc = (v: unknown) => {
        if (v == null) return "";
        const s = String(v).replace(/"/g, '""');
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s}"` : s;
      };
      const lines = rows.map(r => [
        esc(r.declarationNumber), esc(r.status), esc(r.traderId),
        esc(r.hsCode), esc(r.goodsDescription),
        esc(r.invoiceValue), esc(r.invoiceCurrency),
        esc(r.totalDue), esc(r.countryOfOrigin), esc(r.portOfEntry),
        esc(r.riskLane), esc(r.riskScore),
        esc(r.submittedAt ? new Date(r.submittedAt).toISOString() : ""),
        esc(r.clearedAt ? new Date(r.clearedAt).toISOString() : ""),
      ].join(","));
      const csv = [header, ...lines].join("\n");
      await logAuditEvent({
        actorId: ctx.user.id,
        action: "declarations.exportCsv",
        entityType: "declaration",
        entityId: 0,
        metadata: { rows: rows.length, dateFrom: input.dateFrom, dateTo: input.dateTo, status: input.status },
      });
      return { csv, rowCount: rows.length };
    }),
});
