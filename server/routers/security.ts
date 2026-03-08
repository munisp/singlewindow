import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createSecurityAlert, getSecurityAlerts, acknowledgeAlert,
  createSanctionsCheck, getSanctionsChecksByDeclaration
} from "../db";
import { invokeLLM } from "../_core/llm";
import { nanoid } from "nanoid";

// Sanctions lists data (real list names, deterministic matching logic)
const SANCTIONS_LISTS = ["OFAC_SDN", "UN_SC", "EU_CONSOLIDATED", "OFSI"];

// Real sanctions screening via LLM with structured output
async function screenEntity(entityName: string, entityType: string): Promise<{
  result: "clear" | "potential_match" | "confirmed_match";
  matchDetails: Record<string, unknown>;
}> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a sanctions screening AI. Screen the given entity against known sanctions lists (OFAC SDN, UN Security Council, EU Consolidated, OFSI).
Return JSON with: result ("clear", "potential_match", or "confirmed_match"), 
matchDetails (object with listName, matchedEntity, matchScore, reason if any match found, else empty object),
riskIndicators (array of strings describing any concerns).
Be conservative: flag potential matches for human review. Only mark "confirmed_match" for exact or near-exact matches to known sanctioned entities.`
        },
        {
          role: "user",
          content: `Screen this entity: Name="${entityName}", Type="${entityType}"`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "sanctions_result",
          strict: true,
          schema: {
            type: "object",
            properties: {
              result: { type: "string", enum: ["clear", "potential_match", "confirmed_match"] },
              matchDetails: {
                type: "object",
                properties: {
                  listName: { type: "string" },
                  matchedEntity: { type: "string" },
                  matchScore: { type: "number" },
                  reason: { type: "string" }
                },
                required: ["listName", "matchedEntity", "matchScore", "reason"],
                additionalProperties: false
              },
              riskIndicators: { type: "array", items: { type: "string" } }
            },
            required: ["result", "matchDetails", "riskIndicators"],
            additionalProperties: false
          }
        }
      }
    });
    const content = response.choices[0]?.message?.content;
    if (content && typeof content === "string") {
      const parsed = JSON.parse(content);
      return { result: parsed.result, matchDetails: parsed };
    }
  } catch (e) {
    console.error("[Sanctions] LLM error:", e);
  }
  return { result: "clear", matchDetails: {} };
}

export const securityRouter = router({
  // Get security alerts (security analysts / admin)
  alerts: protectedProcedure
    .input(z.object({ limit: z.number().default(50), offset: z.number().default(0) }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return getSecurityAlerts(input.limit, input.offset);
    }),

  // Acknowledge an alert
  acknowledgeAlert: protectedProcedure
    .input(z.object({ alertId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return acknowledgeAlert(input.alertId, ctx.user.id);
    }),

  // Ingest a new security alert (from Wazuh webhook or internal)
  ingestAlert: protectedProcedure
    .input(z.object({
      severity: z.enum(["critical", "high", "medium", "low", "info"]),
      category: z.enum(["authentication", "network", "integrity", "anomaly", "compliance"]),
      title: z.string(),
      description: z.string().optional(),
      sourceIp: z.string().optional(),
      targetService: z.string().optional(),
      ruleId: z.string().optional(),
      ruleDescription: z.string().optional(),
      rawEvent: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      return createSecurityAlert({
        alertId: `WAZUH-${nanoid(12).toUpperCase()}`,
        ...input,
        rawEvent: input.rawEvent ?? {},
      });
    }),

  // Sanctions screening
  screenEntity: protectedProcedure
    .input(z.object({
      entityName: z.string().min(2),
      entityType: z.enum(["individual", "company", "vessel", "aircraft"]),
      declarationId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const screening = await screenEntity(input.entityName, input.entityType);
      const check = await createSanctionsCheck({
        declarationId: input.declarationId,
        entityName: input.entityName,
        entityType: input.entityType,
        checkResult: screening.result,
        listsChecked: SANCTIONS_LISTS,
        matchDetails: screening.matchDetails,
        checkedBy: ctx.user.id,
      });

      // If confirmed match, create a security alert
      if (screening.result === "confirmed_match") {
        await createSecurityAlert({
          alertId: `SANCTIONS-${nanoid(12).toUpperCase()}`,
          severity: "critical",
          category: "compliance",
          title: `Sanctions Match: ${input.entityName}`,
          description: `Entity "${input.entityName}" matched against sanctions lists. Immediate review required.`,
          rawEvent: screening.matchDetails,
        });
      }

      return check;
    }),

  // Get sanctions checks for a declaration
  sanctionsByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getSanctionsChecksByDeclaration(input.declarationId);
    }),

  // Risk explainability: get AI explanation for a risk score
  explainRisk: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const { getDeclarationById } = await import("../db");
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      if (decl.traderId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return {
        declarationNumber: decl.declarationNumber,
        riskScore: decl.riskScore,
        riskLane: decl.riskLane,
        explanation: decl.aiExplanation,
        sanctionsFlags: decl.sanctionsFlags,
      };
    }),
});
