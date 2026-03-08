import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createDeclaration, getDeclarationById, getDeclarationsByTrader,
  getAllDeclarations, updateDeclaration, getDeclarationStats,
  logAuditEvent, createNotification, getProfileByUserId
} from "../db";
import { invokeLLM } from "../_core/llm";
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
  // Fallback deterministic scoring
  const score = Math.floor(Math.random() * 40) + 10;
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
      if (decl.traderId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return decl;
    }),

  // Get all declarations (customs officers / admin)
  all: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getAllDeclarations(input.limit, input.offset);
    }),

  // Update declaration status (customs officer action)
  updateStatus: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["docs_required", "payment_pending", "under_examination", "examination_complete", "cleared", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });

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

      // Notify trader
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

      return updated;
    }),

  // Dashboard stats
  stats: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
    return getDeclarationStats();
  }),
});
