import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createSecurityAlert, getSecurityAlerts, acknowledgeAlert,
  createSanctionsCheck, getSanctionsChecksByDeclaration
} from "../db";
import { invokeLLM } from "../_core/llm";
import { nanoid } from "nanoid";
import { publishEvent, TOPICS } from "../_core/kafka";

// SW-7: NO list names are claimed here. An LLM cannot consult OFAC/UN/EU lists;
// claiming "listsChecked: [OFAC_SDN, UN_SC, …]" fabricated compliance evidence.
// Real list screening is performed by the sanctions-service (deterministic,
// versioned lists). This LLM path is a heuristic pre-screen ONLY, and the
// persisted record must say exactly that.

export type ScreeningOutcome =
  | { kind: "heuristic_result"; result: "clear" | "potential_match" | "confirmed_match"; matchDetails: Record<string, unknown> }
  | { kind: "manual_review_required"; reason: string };

// LLM heuristic pre-screen. On ANY failure → MANUAL_REVIEW_REQUIRED, never "clear".
async function screenEntity(entityName: string, entityType: string): Promise<ScreeningOutcome> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are a sanctions screening HEURISTIC assistant (not a sanctions list). You do NOT have access to OFAC, UN, EU or any other sanctions list — never claim a list was checked. Assess the entity name for sanctions-risk indicators only.
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
      if (["clear", "potential_match", "confirmed_match"].includes(parsed.result)) {
        return { kind: "heuristic_result", result: parsed.result, matchDetails: parsed };
      }
      return { kind: "manual_review_required", reason: "llm_malformed_response" };
    }
    return { kind: "manual_review_required", reason: "llm_empty_response" };
  } catch (e) {
    console.error("[Sanctions] LLM error — routing to manual review (fail closed):", e);
    return { kind: "manual_review_required", reason: "llm_unavailable" };
  }
}

// (legacy signature kept below for deletion)
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

      // SW-7: on LLM outage/malformed output the outcome is MANUAL_REVIEW_REQUIRED,
      // persisted as 'potential_match' (human review flag) — NEVER 'clear'.
      // listsChecked is EMPTY: no deterministic sanctions list was consulted by
      // this heuristic path, and the record must not claim otherwise.
      const checkResult = screening.kind === "heuristic_result" ? screening.result : "potential_match";
      const matchDetails = screening.kind === "heuristic_result"
        ? { ...screening.matchDetails, screeningMethod: "llm_heuristic_prescreen", noListsConsulted: true }
        : { screeningMethod: "llm_heuristic_prescreen", outcome: "MANUAL_REVIEW_REQUIRED", reason: screening.reason, noListsConsulted: true };

      const check = await createSanctionsCheck({
        declarationId: input.declarationId,
        entityName: input.entityName,
        entityType: input.entityType,
        checkResult,
        listsChecked: [],
        matchDetails,
        checkedBy: ctx.user.id,
      });

      // Confirmed heuristic match → alert + event (same as before, honestly labelled)
      if (screening.kind === "heuristic_result" && screening.result === "confirmed_match") {
        await createSecurityAlert({
          alertId: `SANCTIONS-${nanoid(12).toUpperCase()}`,
          severity: "critical",
          category: "compliance",
          title: `Sanctions Match: ${input.entityName}`,
          description: `Entity "${input.entityName}" flagged by heuristic pre-screen. Immediate review required.`,
          rawEvent: screening.matchDetails,
        });
        // Publish Kafka SANCTIONS_HIT event (fire-and-forget)
        publishEvent(TOPICS.SANCTIONS_HIT, {
          eventType: "sanctions.hit",
          aggregateId: input.entityName,
          payload: {
            entityName: input.entityName,
            entityType: input.entityType,
            declarationId: input.declarationId ?? null,
            checkResult: screening.result,
            matchDetails: screening.matchDetails,
            checkedBy: ctx.user.id,
          },
        }).catch(() => {});
      }

      // Manual-review outcomes also raise an alert so nothing fails silently.
      if (screening.kind === "manual_review_required") {
        await createSecurityAlert({
          alertId: `SANCTIONS-MR-${nanoid(12).toUpperCase()}`,
          severity: "high",
          category: "compliance",
          title: `Manual Sanctions Review Required: ${input.entityName}`,
          description: `Heuristic pre-screen unavailable (${screening.reason}). Entity "${input.entityName}" requires manual sanctions review. No clearance was issued.`,
          rawEvent: matchDetails,
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

  /**
   * v101: Batch screen multiple entities against sanctions lists (CSV upload support).
   */
  batchScreenEntities: protectedProcedure
    .input(z.object({
      entities: z.array(z.object({
        name: z.string().min(1),
        entityType: z.enum(["individual", "company", "vessel"]).default("company"),
        country: z.string().length(2).optional(),
        identifiers: z.record(z.string(), z.string()).optional(),
      })).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const { sanctionsChecks } = await import("../../drizzle/schema");
      const results = await Promise.all(input.entities.map(async (entity) => {
        // Simple name-based matching against existing sanctions checks
        const { ilike, or } = await import("drizzle-orm");
        const existing = await db.select().from(sanctionsChecks)
          .where(ilike(sanctionsChecks.entityName, `%${entity.name}%`))
          .limit(1);
        // SW-7: this path checks ONLY internal screening history — no external
        // list is consulted, so listsChecked must say exactly that, the result
        // must use the real enum, and no match score is fabricated.
        const prior = existing[0] ?? null;
        const priorFlagged = prior != null && prior.checkResult !== "clear";
        const [row] = await db.insert(sanctionsChecks).values({
          entityName: entity.name,
          entityType: entity.entityType as any,
          checkResult: priorFlagged ? "potential_match" : "clear",
          listsChecked: ["INTERNAL_SCREENING_HISTORY"],
          matchDetails: {
            basis: "internal_screening_history_only",
            noExternalListsConsulted: true,
            priorCheckId: prior?.id ?? null,
            priorCheckResult: prior?.checkResult ?? null,
          },
          checkedBy: ctx.user.id,
        }).returning();
        return { ...entity, isHit: row.checkResult !== "clear", matchScore: null, checkId: row.id };
      }));
      const hitCount = results.filter(r => r.isHit).length;
      return { results, hitCount, totalChecked: results.length };
    }),
});
