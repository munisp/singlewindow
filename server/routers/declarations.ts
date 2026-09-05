import { z } from "zod";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createDeclaration, getDeclarationById, getDeclarationsByTrader,
  getAllDeclarations, updateDeclaration, getDeclarationStats, getDeclarationStatsByTrader,
  logAuditEvent, createNotification, createUserNotification, getProfileByUserId,
  getLatestKYCVerification, withRlsContext, getDb, getPermitsByDeclaration
} from "../db";
import { declarations, declarationDocuments, clearanceCertificates } from "../../drizzle/schema";
import { renderClearanceCertificatePdf } from "../clearanceCertificatePdf";
import { eq, desc, and, inArray } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";
import { assertCan, setOwner } from "../_core/permify";
import { broadcastNotification, broadcastUnreadCount, broadcastWorkloadUpdate } from "../_core/wsServer";
import { nanoid } from "nanoid";
import { publishEvent, TOPICS } from "../_core/kafka";
import { assertValidTransition, assignRiskLane, validateHsCode, checkPermitValidity, calculateDuty, type DeclarationStatus } from "../businessRules";
import { indexDeclaration, searchDeclarations, OpenSearchUnavailableError } from "../_core/opensearch";
import { scoreDeclarationRisk, scoreDeclarationRiskComposite, configuredRiskScorers, ScorerUnavailableError, validateDeclarationWithEngine, getCargoPosition } from "../_core/polyglotClients";
import {
  getTariffClient,
  TARIFF_VESSEL_CLASSES,
  TariffConfigError,
  TariffRejectedError,
  TariffUnavailableError,
  type TariffAssessRequest,
  type TariffAssessment,
} from "../_core/tariffClient";

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

// Real AI risk scoring — Python ML scorer (primary) with LLM fallback
async function computeRiskScore(
  data: {
    hsCode: string;
    countryOfOrigin: string;
    invoiceValue: number;
    goodsDescription: string;
    declarationType: string;
  },
  opts?: {
    declarationId?: string;
    traderId?: string;
    traderHistory?: { totalDeclarations: number; rejectionRate: number; amendmentRate: number; isAEO: boolean; monthsActive: number };
  }
): Promise<{ score: number; lane: string; explanation: Record<string, unknown> }> {
  // ── 1. Configured scorer pipeline (fail-closed when a configured scorer is down) ──
  // When RISK_SCORER_PIPELINE registers additional scorers (e.g. ml-stack),
  // the composite composition is authoritative: a down scorer aborts scoring
  // (ScorerUnavailableError) instead of silently degrading to the LLM lane.
  const scorers = configuredRiskScorers();
  if (opts?.declarationId && opts?.traderId && scorers.length > 1) {
    const composite = await scoreDeclarationRiskComposite({
      declarationId: opts.declarationId,
      traderId: opts.traderId,
      declarationType: data.declarationType,
      countryOfOrigin: data.countryOfOrigin,
      countryOfDestination: "",
      totalValue: data.invoiceValue,
      totalWeight: 0,
      totalDuty: 0,
      numberOfPackages: 1,
      items: [{ hsCode: data.hsCode, description: data.goodsDescription, quantity: 1, unitValue: data.invoiceValue }],
      documents: [],
      traderHistory: opts.traderHistory ?? { totalDeclarations: 0, rejectionRate: 0, amendmentRate: 0, isAEO: false, monthsActive: 0 },
    });
    return {
      score: Math.round(composite.combinedScore * 100),
      lane: composite.lane.toLowerCase(),
      explanation: { source: "composite", pipeline: scorers, scorers: composite.scorers },
    };
  }

  // ── 1b. Python ML risk scorer (primary, single-scorer default) ──────────────
  if (opts?.declarationId && opts?.traderId) {
    try {
      const mlResult = await scoreDeclarationRisk({
        declarationId: opts.declarationId,
        traderId: opts.traderId,
        declarationType: data.declarationType,
        countryOfOrigin: data.countryOfOrigin,
        countryOfDestination: "",
        totalValue: data.invoiceValue,
        totalWeight: 0,
        totalDuty: 0,
        numberOfPackages: 1,
        items: [{ hsCode: data.hsCode, description: data.goodsDescription, quantity: 1, unitValue: data.invoiceValue }],
        documents: [],
        traderHistory: opts.traderHistory ?? { totalDeclarations: 0, rejectionRate: 0, amendmentRate: 0, isAEO: false, monthsActive: 0 },
      });
      if (mlResult) {
        return {
          score: mlResult.riskScore,
          lane: mlResult.lane.toLowerCase(),
          explanation: {
            source: "python-ml",
            mlScore: mlResult.mlScore,
            ruleScore: mlResult.ruleScore,
            anomalyScore: mlResult.anomalyScore,
            triggeredRules: mlResult.triggeredRules,
            shapExplanation: mlResult.shapExplanation,
            modelVersion: mlResult.modelVersion,
            processingMs: mlResult.processingMs,
          },
        };
      }
    } catch (mlErr) {
      console.warn("[risk-scorer] Python ML service unavailable, falling back to LLM:", mlErr);
    }
  }

  // ── 2. LLM-based risk scoring (fallback) ────────────────────────────────────
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
      // SW-18: LLM output is NOT a model score — label it, and never let an
      // LLM-assigned lane auto-clear (green is clamped to yellow/manual review).
      const llmLane = parsed.lane === "green" ? "yellow" : parsed.lane;
      return {
        score: parsed.score,
        lane: llmLane,
        explanation: {
          ...parsed,
          source: "llm-fallback",
          modelScore: false,
          warning: "LLM heuristic assessment — NOT an authoritative model score. Manual review required; auto-clearance prohibited.",
        }
      };
    }
  } catch (e) {
    console.error("[RiskScore] LLM error:", e);
  }
  // SW-18: fail CLOSED. No HS-code charcode pseudo-scores, no synthesized lanes.
  // When neither the ML scorer nor the LLM is available, scoring is UNAVAILABLE
  // and the declaration must go to manual review — never a fabricated lane.
  throw new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "SCORING_UNAVAILABLE: neither the ML risk scorer nor the LLM fallback is available. Declaration remains in draft for manual review — no risk lane was assigned.",
  });
}

// ── Phase-11: deterministic rules baseline (assignRiskLane wiring) ──────────
// assignRiskLane is the deterministic, explainable baseline lane computed from
// business rules (sanctions, high-risk origin, controlled HS, value, AEO).
// It is ALWAYS applied:
//  - as a floor under any model lane (a model may escalate, never downgrade a
//    rules-red — sanctioned parties stay red), and
//  - as the authoritative lane when no scorer is reachable, labelled
//    source:"rules" and modelScore:false so the SW-18 clearance gate still
//    requires recorded manual review (rules lanes can never auto-clear:
//    green is clamped to yellow, exactly like the LLM fallback).
const LANE_SEVERITY: Record<string, number> = { green: 0, blue: 0, yellow: 1, red: 2 };

function moreSevereLane(a: string, b: string): string {
  return (LANE_SEVERITY[a] ?? 1) >= (LANE_SEVERITY[b] ?? 1) ? a : b;
}

function clampNonModelLane(lane: string): string {
  return lane === "green" || lane === "blue" ? "yellow" : lane;
}

interface RulesBaseline {
  lane: string;
  score: number;
  reasons: string[];
}

function applyRulesBaseline(
  risk: { score: number; lane: string; explanation: Record<string, unknown> },
  baseline: RulesBaseline
): { score: number; lane: string; explanation: Record<string, unknown> } {
  const modelLane = risk.lane.toLowerCase();
  const finalLane = moreSevereLane(modelLane, baseline.lane);
  return {
    score: risk.score,
    lane: finalLane,
    explanation: {
      ...risk.explanation,
      rulesBaseline: { lane: baseline.lane, score: baseline.score, reasons: baseline.reasons },
      ...(finalLane !== modelLane
        ? { laneOverride: `rules baseline ${baseline.lane.toUpperCase()} floor applied over model lane ${modelLane.toUpperCase()}` }
        : {}),
    },
  };
}

/**
 * Platform-plane roles that bypass tenant scoping on officer declaration
 * lists. MUST stay in sync with is_platform_admin() in
 * drizzle/migrations/0064_phase11_tenant_rls.sql ('admin'/'superadmin' =
 * platform operators; 'platform_admin'/'customs_commissioner' = national
 * customs command with cross-tenant oversight). Everything else is
 * tenant-plane and sees only its own tenant's declarations.
 */
const PLATFORM_WIDE_ROLES = ["platform_admin", "admin", "superadmin", "customs_commissioner"];

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
      // Business Rule: Validate HS code format (WCO Harmonised System)
      const hsValidation = validateHsCode(input.hsCode, (input.countryOfOrigin as any) ?? "default");
      if (!hsValidation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: hsValidation.error ?? "Invalid HS code" });
      }
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

      // B5 FIX: KYC gate — trader must have an approved KYC verification before submitting.
      // This prevents unverified traders from injecting declarations into the customs workflow.
      const kycRecord = await getLatestKYCVerification(ctx.user.id);
      if (!kycRecord || kycRecord.status !== 'APPROVED') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'KYC verification required. Please complete identity verification before submitting declarations. ' +
            `Current KYC status: ${kycRecord?.status ?? 'not started'}.`,
        });
      }

      // Phase-11 (Permit Expiry Enforcement): every permit already issued for
      // this declaration must be valid at submission — fail CLOSED on expired
      // or malformed approvals. Pending permit requests carry no expiry yet
      // and are validated at clearance (see updateStatus) instead.
      const existingPermits = await getPermitsByDeclaration(input.id);
      for (const permit of existingPermits) {
        if (permit.status !== "approved") continue;
        if (!permit.permitNumber || !permit.expiresAt) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `PERMIT_INVALID: approved ${permit.agencyName} permit #${permit.id} lacks a permit number or expiry — resubmit the permit request before submitting this declaration`,
          });
        }
        const validity = checkPermitValidity({
          permitNumber: permit.permitNumber,
          expiryDate: new Date(permit.expiresAt),
          issuingAgency: permit.agencyName,
        });
        if (!validity.valid) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `PERMIT_EXPIRED: ${validity.error}`,
          });
        }
      }

      // Phase-11: deterministic rules baseline lane (assignRiskLane), always
      // computed BEFORE model scoring. Model lanes may escalate beyond it but
      // never downgrade it; when no scorer is reachable it is the lane.
      const profile = await getProfileByUserId(ctx.user.id);
      const baseline = assignRiskLane({
        riskScore: 0,
        isAeo: profile?.aeoStatus === "certified",
        isSanctioned: Array.isArray(decl.sanctionsFlags) && (decl.sanctionsFlags as unknown[]).length > 0,
        invoiceValue: parseFloat(decl.invoiceValue ?? "0"),
        countryOfOrigin: decl.countryOfOrigin ?? "",
        hsCodeCategory: decl.hsCode ?? undefined,
      });

      // Run AI risk scoring — Python ML scorer (primary) with LLM fallback;
      // deterministic rules lane when no scorer is reachable.
      let risk: { score: number; lane: string; explanation: Record<string, unknown> };
      try {
        const modelRisk = await computeRiskScore(
          {
            hsCode: decl.hsCode ?? "",
            countryOfOrigin: decl.countryOfOrigin ?? "",
            invoiceValue: parseFloat(decl.invoiceValue ?? "0"),
            goodsDescription: decl.goodsDescription ?? "",
            declarationType: decl.declarationType,
          },
          {
            declarationId: String(input.id),
            traderId: String(ctx.user.id),
          }
        );
        risk = applyRulesBaseline(modelRisk, baseline);
      } catch (e) {
        // Only a scoring outage falls through to the deterministic rules
        // lane; any other error (validation etc.) propagates unchanged.
        if (!(e instanceof TRPCError) || e.code !== "SERVICE_UNAVAILABLE") throw e;
        risk = {
          score: baseline.score,
          lane: clampNonModelLane(baseline.lane),
          explanation: {
            source: "rules",
            modelScore: false,
            reasons: baseline.reasons,
            warning: "SCORING_UNAVAILABLE: no ML/LLM scorer reachable — deterministic business-rules lane applied. Manual review required; auto-clearance prohibited.",
          },
        };
      }

      // Compute duties (flat-rate ESTIMATE: 10% duty + 15% VAT on CIF value)
      // via the shared business-rule CIF computation (calculateDuty — integer
      // minor units, half-up rounding; SW-17).
      // This is NOT an authoritative tariff assessment: it is labelled
      // ESTIMATE_UNVERIFIED and payment initiation against it is blocked in
      // production (see payments.initiate / mojaloop.initiatePayment).
      // PRA-100: the authoritative path is declarations.assessDuty below,
      // which calls the financial-controls tariff engine and replaces this
      // estimate with a TARIFF_ENGINE_VERIFIED assessment. The declaration
      // record does not carry vessel/voyage particulars, so the engine call
      // cannot be made implicitly here without fabricating vesselGrt —
      // assessDuty takes those particulars as explicit input instead.
      const invoiceRaw = String(decl.invoiceValue ?? "").trim();
      if (!/^\d+(\.\d{1,2})?$/.test(invoiceRaw)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Invalid invoice value '${invoiceRaw}' — cannot compute duties` });
      }
      const estimate = calculateDuty({
        invoiceValue: parseFloat(invoiceRaw), // CIF basis: no separate freight/insurance on the declaration record
        freightCost: 0,
        insuranceCost: 0,
        tariffRate: 10,
        vatRate: 15,
      });
      const duty = estimate.customsDuty;
      const vat = estimate.vat;
      const total = estimate.totalDuties;
      const dutyEstimateExplanation = {
        ...risk.explanation,
        dutyAssessment: "ESTIMATE_UNVERIFIED",
        dutyBasis: "Flat-rate estimate (10% duty + 15% VAT on CIF) — NOT from the tariff engine. Obtain an authoritative assessment via declarations.assessDuty; payment against this estimate is blocked in production.",
      };

      // Permify: setOwner is called on create; submit is gated by traderId check above.
      // assertCan is reserved for cross-role operations (approve, release, assess).

      const updated = await updateDeclaration(input.id, {
        status: "under_assessment",
        riskScore: String(risk.score),
        riskLane: risk.lane as any,
        aiExplanation: dutyEstimateExplanation,
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

      // Publish Kafka event for downstream consumers (risk engine, OGA routing, analytics)
      publishEvent(TOPICS.DECLARATION_SUBMITTED, {
        eventType: "declaration.submitted",
        aggregateId: String(input.id),
        payload: {
          declarationId: input.id,
          declarationNumber: decl.declarationNumber,
          traderId: ctx.user.id,
          riskLane: risk.lane,
          riskScore: risk.score,
          hsCode: decl.hsCode,
          countryOfOrigin: decl.countryOfOrigin,
          totalDue: total.toFixed(2),
          currency: decl.invoiceCurrency,
          submittedAt: new Date().toISOString(),
        },
        metadata: { userId: String(ctx.user.id) },
            }).catch(() => { /* non-blocking — Kafka unavailable in demo mode */ });
      // R5 FIX: Index in OpenSearch for full-text search (non-blocking)
      indexDeclaration({
        id: input.id,
        declarationNumber: decl.declarationNumber,
        ucr: decl.ucr,
        traderId: ctx.user.id,
        declarationType: decl.declarationType,
        status: 'under_assessment',
        riskLane: risk.lane,
        riskScore: String(risk.score),
        hsCode: decl.hsCode,
        goodsDescription: decl.goodsDescription,
        countryOfOrigin: decl.countryOfOrigin,
        countryOfDestination: decl.countryOfDestination,
        portOfEntry: decl.portOfEntry,
        invoiceValue: decl.invoiceValue,
        invoiceCurrency: decl.invoiceCurrency,
        submittedAt: new Date(),
        createdAt: decl.createdAt,
      }).catch(() => {});
      return updated;
    }),

  /**
   * PRA-100: authoritative statutory duty assessment via the financial-controls
   * tariff engine (W-FEAT-4). Replaces the flat-rate ESTIMATE_UNVERIFIED with a
   * TARIFF_ENGINE_VERIFIED assessment, opening the production payment gates
   * (payments.initiate / mojaloop.initiatePayment) for real, replay-safe amounts.
   *
   * The declaration record carries no vessel/voyage particulars, so they are
   * explicit input here — never fabricated from cargo fields. Money moves in
   * integer minor units end-to-end. Fail-closed:
   *   - TARIFF_SERVICE_URL unset        → PRECONDITION_FAILED (configuration error),
   *   - engine unreachable/breaker open → SERVICE_UNAVAILABLE (classified),
   *   - engine 4xx rejection            → BAD_REQUEST with the upstream reason.
   * No path in this procedure fabricates a rate.
   */
  assessDuty: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      vesselGrt: z.number().int().positive(),
      vesselClass: z.enum(TARIFF_VESSEL_CLASSES),
      voyageType: z.enum(["INTERNATIONAL", "CABOTAGE"]),
      routeKind: z.enum(["SEA", "INLAND_WATERWAY"]).default("SEA"),
      // This platform is the Nigerian single window: the declaration's port of
      // entry is a Nigerian port. Callers may override for honest edge cases
      // (e.g. transit declarations with no Nigerian port call).
      nigeriaPortCall: z.boolean().default(true),
      grossFreightUsdMinor: z.number().int().nonnegative(),
      cargoCategory: z.string().min(1).max(128).optional(),
      voyageFlags: z.array(z.string().min(1).max(128)).max(16).optional(),
      asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "asOf must be YYYY-MM-DD").optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      const officerRoles = ["admin", "customs_officer", "finance"];
      if (decl.traderId !== ctx.user.id && !officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (!["under_assessment", "payment_pending"].includes(decl.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Declaration status '${decl.status}' is not assessable — submit the declaration first (and do not re-assess after clearance).`,
        });
      }

      // The engine aggregates statutory totals in USD and NGN minor units only.
      // Anything else would require a fabricated FX conversion — refuse.
      const currency = (decl.invoiceCurrency ?? "USD").toUpperCase();
      if (currency !== "USD" && currency !== "NGN") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Declaration currency ${currency} is not assessable by the tariff engine (USD/NGN totals only) — no FX conversion is fabricated.`,
        });
      }

      const assessRequest: TariffAssessRequest = {
        vesselGrt: input.vesselGrt,
        vesselClass: input.vesselClass,
        entityRef: `trader:${decl.traderId}`,
        cargoCategory: input.cargoCategory ?? decl.hsCode ?? "UNSPECIFIED",
        voyageType: input.voyageType,
        routeKind: input.routeKind,
        nigeriaPortCall: input.nigeriaPortCall,
        grossFreightUsdMinor: input.grossFreightUsdMinor,
        ...(input.voyageFlags?.length ? { voyageFlags: input.voyageFlags } : {}),
        ...(input.asOf ? { asOf: input.asOf } : {}),
      };

      // Replay-safe idempotency: the same declaration + identical request
      // replays the SAME assessment server-side; a changed request gets a new
      // key instead of an idempotency conflict.
      const requestFingerprint = createHash("sha256").update(JSON.stringify(assessRequest)).digest("hex").slice(0, 24);
      const idempotencyKey = `tg-decl-${decl.id}-${requestFingerprint}`;

      let assessment: TariffAssessment;
      try {
        assessment = await getTariffClient().assess(assessRequest, {
          idempotencyKey,
          correlationId: `decl-${decl.id}`,
        });
      } catch (err) {
        if (err instanceof TariffConfigError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Tariff engine is not configured: ${err.message}` });
        }
        if (err instanceof TariffUnavailableError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Tariff engine unavailable (${err.reason}): ${err.message}` });
        }
        if (err instanceof TariffRejectedError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }

      // Map engine lines onto the declaration money columns, all integer minor
      // units in the declaration currency. Ship dues are the "duty" head; all
      // other charged statutory instruments are levies; the engine does not
      // assess VAT, so vatAmount is honestly zeroed — the full itemized
      // breakdown is preserved in aiExplanation.tariffAssessment.
      const charged = assessment.lines.filter((l) => l.applicability === "CHARGED" && l.currency === currency);
      const dutyMinor = charged
        .filter((l) => l.instrument === "NPA_SHIP_DUES")
        .reduce((sum, l) => sum + l.amountMinor, 0);
      const levyMinor = charged
        .filter((l) => l.instrument !== "NPA_SHIP_DUES")
        .reduce((sum, l) => sum + l.amountMinor, 0);
      const totalMinor = currency === "NGN" ? assessment.totalNgnMinor : assessment.totalUsdMinor;

      const previousExplanation =
        decl.aiExplanation && typeof decl.aiExplanation === "object"
          ? (decl.aiExplanation as Record<string, unknown>)
          : {};
      const aiExplanation = {
        ...previousExplanation,
        dutyAssessment: "TARIFF_ENGINE_VERIFIED",
        dutyBasis:
          `Authoritative assessment ${assessment.assessmentId} from the tariff engine ` +
          `(asOf ${assessment.asOf}, requester ${assessment.requester}). Statutory line items ` +
          `are versioned, effective-dated rates with encoded exemptions — no flat-rate estimation.`,
        tariffAssessment: {
          assessmentId: assessment.assessmentId,
          asOf: assessment.asOf,
          correlationId: assessment.correlationId,
          idempotencyKey,
          currency,
          dutyMinor,
          levyMinor,
          vatMinor: 0,
          totalMinor,
          lines: assessment.lines,
          provisional: assessment.lines.some((l) => l.provisional),
        },
      };

      const updated = await updateDeclaration(decl.id, {
        dutyAmount: (dutyMinor / 100).toFixed(2),
        vatAmount: "0.00",
        levyAmount: (levyMinor / 100).toFixed(2),
        totalDue: (totalMinor / 100).toFixed(2),
        aiExplanation,
      });

      await logAuditEvent({
        entityType: "declaration",
        entityId: decl.id,
        action: "tariff_assessed",
        actorId: ctx.user.id,
        actorType: officerRoles.includes(ctx.user.role) ? "officer" : "trader",
        previousState: { dutyAssessment: previousExplanation.dutyAssessment ?? null, totalDue: decl.totalDue },
        newState: {
          dutyAssessment: "TARIFF_ENGINE_VERIFIED",
          tariffAssessmentId: assessment.assessmentId,
          totalDue: (totalMinor / 100).toFixed(2),
          currency,
        },
      });

      await createUserNotification({
        userId: decl.traderId,
        type: "tariff_assessed",
        title: "Duty Assessment Complete",
        body: `Declaration ${decl.declarationNumber} assessed by the tariff engine: ${(totalMinor / 100).toFixed(2)} ${currency} due (assessment ${assessment.assessmentId}).`,
        declarationId: decl.id,
      }).catch(() => { /* non-blocking */ });

      return {
        declaration: updated,
        assessment: {
          assessmentId: assessment.assessmentId,
          asOf: assessment.asOf,
          currency,
          dutyMinor,
          levyMinor,
          vatMinor: 0,
          totalMinor,
          lines: assessment.lines,
        },
      };
    }),

  // R5 FIX: Full-text search across declarations using OpenSearch
  fullTextSearch: protectedProcedure
    .input(z.object({
      query: z.string().min(2).max(200),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const traderId = ctx.user.role === 'admin' || ctx.user.role === 'customs_officer' ? undefined : ctx.user.id;
      try {
        return await searchDeclarations(input.query, traderId, input.limit);
      } catch (err) {
        if (err instanceof OpenSearchUnavailableError) {
          // PRA-110: distinguish cluster-down from zero-results.
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: `DECLARATION_SEARCH_UNAVAILABLE: ${err.message}`,
          });
        }
        throw err;
      }
    }),
  // Get trader's own declarations — RLS-enforced at the database level
  myDeclarations: protectedProcedure
    .input(z.object({
      limit: z.number().default(20),
      offset: z.number().default(0),
      search: z.string().optional(),
      status: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const { ilike, and: andOp, or: orOp } = await import("drizzle-orm");
      return withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
        const conditions = [eq(declarations.traderId, ctx.user.id)];
        if (input.search && input.search.trim()) {
          const q = `%${input.search.trim()}%`;
          conditions.push(
            orOp(
              ilike(declarations.declarationNumber, q),
              ilike(declarations.ucr, q),
              ilike(declarations.goodsDescription, q),
              ilike(declarations.hsCode, q),
            ) as any
          );
        }
        if (input.status) {
          conditions.push(eq(declarations.status, input.status as any));
        }
        return db.select().from(declarations)
          .where(andOp(...conditions))
          .orderBy(desc(declarations.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      });
    }),

  // Get a single declaration — officers bypass RLS; traders go through RLS context
  byId: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer", "security"];
      // Both officers and traders use withRlsContext so PostgreSQL RLS policies are satisfied
      const results = await withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
        const { users: usersTable } = await import("../../drizzle/schema");
        const { eq: eqOp, and: andOp } = await import("drizzle-orm");
        const baseQuery = db
          .select({
            id: declarations.id,
            declarationNumber: declarations.declarationNumber,
            ucr: declarations.ucr,
            traderId: declarations.traderId,
            traderName: usersTable.name,
            traderEmail: usersTable.email,
            declarationType: declarations.declarationType,
            status: declarations.status,
            riskLane: declarations.riskLane,
            riskScore: declarations.riskScore,
            hsCode: declarations.hsCode,
            goodsDescription: declarations.goodsDescription,
            countryOfOrigin: declarations.countryOfOrigin,
            countryOfDestination: declarations.countryOfDestination,
            portOfEntry: declarations.portOfEntry,
            grossWeight: declarations.grossWeight,
            netWeight: declarations.netWeight,
            numberOfPackages: declarations.numberOfPackages,
            invoiceValue: declarations.invoiceValue,
            invoiceCurrency: declarations.invoiceCurrency,
            dutyAmount: declarations.dutyAmount,
            vatAmount: declarations.vatAmount,
            levyAmount: declarations.levyAmount,
            totalDue: declarations.totalDue,
            assignedOfficerId: declarations.assignedOfficerId,
            aiExplanation: declarations.aiExplanation,
            sanctionsFlags: declarations.sanctionsFlags,
            submittedAt: declarations.submittedAt,
            clearedAt: declarations.clearedAt,
            createdAt: declarations.createdAt,
            updatedAt: declarations.updatedAt,
          })
          .from(declarations)
          .leftJoin(usersTable, eqOp(declarations.traderId, usersTable.id));
        if (officerRoles.includes(ctx.user.role)) {
          return baseQuery.where(eqOp(declarations.id, input.id)).limit(1);
        }
        return baseQuery.where(andOp(eqOp(declarations.id, input.id), eqOp(declarations.traderId, ctx.user.id))).limit(1);
      });
      if (!results[0]) throw new TRPCError({ code: "NOT_FOUND" });
      return results[0];
    }),

  // Get all declarations (customs officers / admin / finance / inspector / oga_officer)
  // Sprint 112: Upgraded to cursor-based pagination (lastId + limit) for efficiency
  all: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      lastId: z.number().optional(),   // cursor: last seen declaration ID (for "load more")
      status: z.string().optional(),
      riskLane: z.string().optional(),
      search: z.string().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // Tenant-plane officer roles + the platform-plane exception roles
      // (PLATFORM_WIDE_ROLES) may list declarations; tenant-plane roles are
      // tenant-scoped below.
      const allowedRoles = [...PLATFORM_WIDE_ROLES, "customs_officer", "inspector", "finance", "oga_officer", "security"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      return withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
        const { desc, and, gte, lte, eq: eqOp, or, ilike, lt, inArray } = await import("drizzle-orm");
        const { declarations: decl, users: usersTable, tenantUsers: tenantUsersTable } = await import("../../drizzle/schema");
        const conditions: any[] = [];

        // ── Phase-11: tenant scoping for officer declaration lists ──────────
        // Officers only see declarations filed by traders who belong to one of
        // the officer's own tenants (tenant_users membership). A declaration's
        // tenant is the filing trader's tenant.
        //
        // PLATFORM-WIDE EXCEPTION: roles in PLATFORM_WIDE_ROLES bypass tenant
        // restriction. This set intentionally mirrors is_platform_admin() in
        // drizzle/migrations/0064_phase11_tenant_rls.sql — 'admin' /
        // 'superadmin' (platform operators) and 'platform_admin' /
        // 'customs_commissioner' (national customs command) are platform-plane
        // roles with cross-tenant oversight duties; tenant-plane officer roles
        // (customs_officer, inspector, finance, oga_officer, security) are
        // always tenant-scoped. Fail closed: an officer with no tenant
        // membership sees an empty list.
        if (!PLATFORM_WIDE_ROLES.includes(ctx.user.role)) {
          const officerTenants = await db
            .select({ tenantId: tenantUsersTable.tenantId })
            .from(tenantUsersTable)
            .where(eqOp(tenantUsersTable.userId, ctx.user.id));
          const tenantIds = [...new Set(officerTenants.map((r) => r.tenantId))];
          if (tenantIds.length === 0) {
            return { items: [], hasMore: false, nextCursor: undefined };
          }
          conditions.push(
            inArray(
              decl.traderId,
              db.select({ id: tenantUsersTable.userId })
                .from(tenantUsersTable)
                .where(inArray(tenantUsersTable.tenantId, tenantIds))
            )
          );
        }

        if (input.dateFrom) conditions.push(gte(decl.submittedAt, input.dateFrom));
        if (input.dateTo) conditions.push(lte(decl.submittedAt, input.dateTo));
        if (input.status && input.status !== "all") conditions.push(eqOp(decl.status, input.status as any));
        if (input.riskLane && input.riskLane !== "all") conditions.push(eqOp(decl.riskLane, input.riskLane as any));
        if (input.search && input.search.trim()) {
          const term = `%${input.search.trim()}%`;
          conditions.push(or(
            ilike(decl.declarationNumber, term),
            ilike(decl.ucr, term),
            ilike(usersTable.name, term),
            ilike(decl.goodsDescription, term),
            ilike(decl.hsCode, term),
          ));
        }
        // Cursor: only fetch records with id < lastId (keyset pagination on descending id)
        if (input.lastId) conditions.push(lt(decl.id, input.lastId));

        const fetchLimit = input.limit + 1; // fetch one extra to detect hasMore
        const base = db
          .select({
            id: decl.id,
            declarationNumber: decl.declarationNumber,
            ucr: decl.ucr,
            traderId: decl.traderId,
            traderName: usersTable.name,
            traderEmail: usersTable.email,
            declarationType: decl.declarationType,
            status: decl.status,
            riskLane: decl.riskLane,
            riskScore: decl.riskScore,
            hsCode: decl.hsCode,
            goodsDescription: decl.goodsDescription,
            countryOfOrigin: decl.countryOfOrigin,
            countryOfDestination: decl.countryOfDestination,
            portOfEntry: decl.portOfEntry,
            invoiceValue: decl.invoiceValue,
            invoiceCurrency: decl.invoiceCurrency,
            dutyAmount: decl.dutyAmount,
            vatAmount: decl.vatAmount,
            totalDue: decl.totalDue,
            assignedOfficerId: decl.assignedOfficerId,
            aiExplanation: decl.aiExplanation,
            submittedAt: decl.submittedAt,
            clearedAt: decl.clearedAt,
            createdAt: decl.createdAt,
            updatedAt: decl.updatedAt,
          })
          .from(decl)
          .leftJoin(usersTable, eqOp(decl.traderId, usersTable.id));
        const filtered = conditions.length > 0 ? base.where(and(...conditions)) : base;
        const rows = await filtered.orderBy(desc(decl.id)).limit(fetchLimit);
        const hasMore = rows.length > input.limit;
        const items = hasMore ? rows.slice(0, input.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;
        return { items, hasMore, nextCursor };
      });
    }),

  /**
   * Cancel a declaration (Phase-11: makes the previously unreachable
   * 'cancelled' state honestly reachable).
   * - Trader: may cancel their OWN declaration, only while it is in a
   *   cancellable pre-payment state (draft / submitted / docs_required /
   *   rejected per VALID_TRANSITIONS).
   * - Officer (customs_officer): may cancel an in-assessment declaration
   *   and MUST provide a reason; admin may cancel wherever the transition
   *   table allows. Terminal states (cleared/cancelled) reject.
   */
  cancel: protectedProcedure
    .input(z.object({
      id: z.number(),
      reason: z.string().min(5).max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      const isOwner = decl.traderId === ctx.user.id;
      const isOfficer = ["customs_officer", "admin"].includes(ctx.user.role);
      if (!isOwner && !isOfficer) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You may only cancel your own declarations." });
      }
      // Officer cancellation of someone else's declaration requires a reason.
      if (isOfficer && !isOwner && !input.reason) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A reason is required when an officer cancels a declaration." });
      }
      // State machine enforcement (WCO RKC 6.1) — rejects terminal states and
      // role-inappropriate transitions (e.g. trader cancelling under_assessment).
      assertValidTransition(
        (decl.status ?? "draft") as DeclarationStatus,
        "cancelled",
        isOfficer ? ctx.user.role : "user"
      );

      const updated = await updateDeclaration(input.id, { status: "cancelled" } as any);

      await logAuditEvent({
        entityType: "declaration",
        entityId: input.id,
        action: "cancelled",
        actorId: ctx.user.id,
        actorType: isOfficer ? "customs_officer" : "trader",
        previousState: { status: decl.status },
        newState: { status: "cancelled" },
        metadata: { reason: input.reason ?? null, cancelledBy: isOfficer ? "officer" : "trader" },
      });

      // Notify the trader when an officer cancels their declaration
      if (isOfficer && !isOwner) {
        await createNotification({
          userId: decl.traderId,
          // notification_type enum has no 'declaration_cancelled' value;
          // 'declaration_status_change' is the honest generic (title/body
          // carry the specifics).
          type: "declaration_status_change",
          title: "Declaration Cancelled",
          message: `Your declaration ${decl.declarationNumber} was cancelled by customs. Reason: ${input.reason}`,
          entityType: "declaration",
          entityId: input.id,
        });
      }

      publishEvent(TOPICS.DECLARATION_UPDATED ?? TOPICS.DECLARATION_SUBMITTED, {
        eventType: "declaration.cancelled",
        aggregateId: String(input.id),
        payload: {
          declarationId: input.id,
          declarationNumber: decl.declarationNumber,
          traderId: decl.traderId,
          previousStatus: decl.status,
          cancelledBy: isOfficer ? "officer" : "trader",
          reason: input.reason ?? null,
        },
        metadata: { userId: String(ctx.user.id) },
      }).catch(() => { /* non-blocking */ });

      return updated;
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

      // Business Rule: Enforce declaration state machine (WCO RKC Standard 6.1)
      assertValidTransition(
        (decl.status ?? "draft") as DeclarationStatus,
        input.status as DeclarationStatus,
        ctx.user.role
      );

      // SW-M13: clearance additionally requires that no active hold exists.
      // A red/yellow risk lane is an inspection hold: it must have been
      // discharged through examination_complete before clearance.
      if (input.status === "cleared") {
        const lane = (decl as { riskLane?: string | null }).riskLane;
        if ((lane === "red" || lane === "yellow") && decl.status !== "examination_complete") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Active ${lane}-lane inspection hold — declaration must complete examination before clearance`,
          });
        }
        // SW-18: a declaration whose risk output is a non-model estimate (LLM
        // fallback) may not be cleared without a manual-review annotation.
        const explanation = (decl as { aiExplanation?: Record<string, unknown> | null }).aiExplanation;
        if (explanation && (explanation as any).modelScore === false && !(explanation as any).manualReviewCompleted) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Risk assessment is a non-model (LLM heuristic) output — manual review must be recorded before clearance",
          });
        }
        // Phase-11 (mirrors Go store.go:352-355): clearance hard-blocks when
        // any OGA permit raised for this declaration is not approved, or is
        // approved but expired. Permits are terminal-state — a rejected
        // permit must be re-applied as a new request and approved first.
        const clearancePermits = await getPermitsByDeclaration(input.id);
        for (const permit of clearancePermits) {
          if (permit.status === "not_required") continue;
          if (permit.status !== "approved") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `PERMIT_NOT_APPROVED: ${permit.agencyName} permit #${permit.id} is '${permit.status}' — clearance requires all OGA permits approved`,
            });
          }
          if (!permit.permitNumber || !permit.expiresAt) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `PERMIT_INVALID: approved ${permit.agencyName} permit #${permit.id} lacks a permit number or expiry`,
            });
          }
          const validity = checkPermitValidity({
            permitNumber: permit.permitNumber,
            expiryDate: new Date(permit.expiresAt),
            issuingAgency: permit.agencyName,
          });
          if (!validity.valid) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `PERMIT_EXPIRED: ${validity.error}`,
            });
          }
        }
      }

      // Permify: assert officer can assess this declaration
      const permifyAction = input.status === "cleared" ? "release" :
        input.status === "under_examination" ? "hold" : "assess";
      await assertCan(String(ctx.user.id), "declaration", String(input.id), permifyAction);

      const updateData: Record<string, unknown> = { status: input.status };
      if (input.status === "cleared") updateData.clearedAt = new Date();

      // SW-18: a non-model (rules-fallback) risk score requires a recorded
      // manual review before clearance. Completing the physical examination
      // IS that manual review — record it on examination_complete so the
      // clearance gate in this same procedure can be satisfied. Without this,
      // any declaration scored during a scoring outage could never be cleared.
      if (input.status === "examination_complete") {
        const explanation = (decl as { aiExplanation?: Record<string, unknown> | null }).aiExplanation;
        if (explanation && (explanation as any).modelScore === false && !(explanation as any).manualReviewCompleted) {
          updateData.aiExplanation = {
            ...explanation,
            manualReviewCompleted: true,
            manualReviewBy: ctx.user.id,
            manualReviewAt: new Date().toISOString(),
          };
        }
      }

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
      // Values must be members of the notification_type pgEnum — invalid
      // literals make the insert fail AFTER the status update has committed.
      const userNotifType = input.status === "cleared" ? "declaration_cleared" :
        input.status === "rejected" ? "declaration_rejected" :
        input.status === "docs_required" ? "document_required" : "declaration_status_change";
      const savedNotif = await createUserNotification({
        userId: decl.traderId,
        type: userNotifType,
        title: `Declaration ${input.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}`,
        body: statusMessages[input.status] ?? `Declaration ${decl.declarationNumber} status: ${input.status}.`,
        declarationId: input.id,
      });

      // Sprint 63: Real-time WebSocket push to trader
      if (savedNotif) {
        broadcastNotification(decl.traderId, {
          id: savedNotif.id,
          category: "declaration",
          title: savedNotif.title,
          body: savedNotif.body ?? "",
          entityType: "declaration",
          entityId: input.id,
          createdAt: savedNotif.createdAt?.toISOString() ?? new Date().toISOString(),
        });
      }

      // Publish Kafka event for declaration status change (downstream: analytics, OGA, trader portal)
      const statusTopic = input.status === "cleared" ? TOPICS.DECLARATION_CLEARED :
        input.status === "rejected" ? TOPICS.DECLARATION_REJECTED : TOPICS.DECLARATION_UPDATED;
      publishEvent(statusTopic, {
        eventType: `declaration.${input.status}`,
        aggregateId: String(input.id),
        payload: {
          declarationId: input.id,
          declarationNumber: decl.declarationNumber,
          traderId: decl.traderId,
          previousStatus: decl.status,
          newStatus: input.status,
          changedBy: ctx.user.id,
          changedByRole: ctx.user.role,
          notes: input.notes,
        },
        metadata: { userId: String(ctx.user.id) },
      }).catch(() => { /* non-blocking */ });

      // Sprint 110: broadcast workload update to all connected officers after status change
      (async () => {
        try {
          const { count, eq: eqOp } = await import("drizzle-orm");
          const { declarations: decl } = await import("../../drizzle/schema");
          const db2 = await (await import("../db")).getDb();
          if (!db2) return;
          const [total, red, yellow, green] = await Promise.all([
            db2.select({ count: count() }).from(decl).where(eqOp(decl.status, "submitted" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "red" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "yellow" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "green" as any)),
          ]);
          // Count SLA breaches: submitted declarations older than 24h
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const { lt } = await import("drizzle-orm");
          const [breached] = await db2.select({ count: count() }).from(decl)
            .where((await import("drizzle-orm")).and(
              eqOp(decl.status, "submitted" as any),
              lt(decl.submittedAt, cutoff)
            ));
          broadcastWorkloadUpdate({
            totalPending: total[0]?.count ?? 0,
            redLane: red[0]?.count ?? 0,
            yellowLane: yellow[0]?.count ?? 0,
            greenLane: green[0]?.count ?? 0,
            slaBreached: breached?.count ?? 0,
            updatedAt: new Date().toISOString(),
          });
        } catch { /* non-critical */ }
      })();

      return updated;
    }),

  // Dashboard stats (admin/officers get platform-wide stats; traders get their own stats)
  stats: protectedProcedure.query(async ({ ctx }) => {
    const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer", "security"];
    if (officerRoles.includes(ctx.user.role)) {
      return withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
        const { count, eq } = await import("drizzle-orm");
        const { declarations: decl } = await import("../../drizzle/schema");
        const [total, cleared, pending, rejected, redLane, yellowLane, greenLane] = await Promise.all([
          db.select({ count: count() }).from(decl),
          db.select({ count: count() }).from(decl).where(eq(decl.status, "cleared" as any)),
          db.select({ count: count() }).from(decl).where(eq(decl.status, "submitted" as any)),
          db.select({ count: count() }).from(decl).where(eq(decl.status, "rejected" as any)),
          db.select({ count: count() }).from(decl).where(eq(decl.riskLane, "red" as any)),
          db.select({ count: count() }).from(decl).where(eq(decl.riskLane, "yellow" as any)),
          db.select({ count: count() }).from(decl).where(eq(decl.riskLane, "green" as any)),
        ]);
        return {
          total: total[0]?.count ?? 0,
          cleared: cleared[0]?.count ?? 0,
          pending: pending[0]?.count ?? 0,
          rejected: rejected[0]?.count ?? 0,
          redLane: redLane[0]?.count ?? 0,
          yellowLane: yellowLane[0]?.count ?? 0,
          greenLane: greenLane[0]?.count ?? 0,
          // Aliases for client/test compatibility
          red: redLane[0]?.count ?? 0,
          yellow: yellowLane[0]?.count ?? 0,
          green: greenLane[0]?.count ?? 0,
        };
      });
    }
    // Trader: return their own stats
    return withRlsContext({ id: ctx.user.id, role: ctx.user.role }, async (db) => {
      const { count, eq, and } = await import("drizzle-orm");
      const { declarations: decl } = await import("../../drizzle/schema");
      const [total, cleared, pending, rejected, submitted] = await Promise.all([
        db.select({ count: count() }).from(decl).where(eq(decl.traderId, ctx.user.id)),
        db.select({ count: count() }).from(decl).where(and(eq(decl.traderId, ctx.user.id), eq(decl.status, "cleared" as any))),
        db.select({ count: count() }).from(decl).where(and(eq(decl.traderId, ctx.user.id), eq(decl.status, "payment_pending" as any))),
        db.select({ count: count() }).from(decl).where(and(eq(decl.traderId, ctx.user.id), eq(decl.status, "rejected" as any))),
        db.select({ count: count() }).from(decl).where(and(eq(decl.traderId, ctx.user.id), eq(decl.status, "submitted" as any))),
      ]);
      return {
        total: total[0]?.count ?? 0,
        cleared: cleared[0]?.count ?? 0,
        pending: pending[0]?.count ?? 0,
        rejected: rejected[0]?.count ?? 0,
        submitted: submitted[0]?.count ?? 0,
      };
    });
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

      const clearedDate = decl.clearedAt
        ? new Date(decl.clearedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
        : new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

      // Render a real in-process PDF (pdfkit — server/executive/briefing.ts
      // pattern). FAIL-CLOSED: no shell-out chain, no HTML fallback — any
      // render failure rejects and no certificate is issued.
      const pdfBuffer = await renderClearanceCertificatePdf(decl, clearedDate);

      const { storagePut, storageDelete } = await import("../storage");
      const { nanoid: nanoId } = await import("nanoid");
      const fileKey = `clearance-certificates/${decl.declarationNumber}-${nanoId(6)}.pdf`;
      const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");

      // Persist the certificate record transactionally with the download: if
      // the insert fails the certificate is NOT delivered — the uploaded
      // object is deleted best-effort and the request hard-fails (500).
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) {
        try { await storageDelete(fileKey); } catch { /* best-effort cleanup */ }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database unavailable — clearance certificate was not issued",
        });
      }
      try {
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
      } catch (err) {
        try { await storageDelete(fileKey); } catch { /* best-effort cleanup */ }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to persist the clearance certificate record — certificate not issued",
          cause: err,
        });
      }

      return { url, format: "pdf" as const, declarationNumber: decl.declarationNumber };
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

  // ─── Declaration Documents CRUD ──────────────────────────────────────────
  /** Upload a document reference for a declaration */
  addDocument: protectedProcedure
    .input(z.object({
      declarationId: z.number(),
      documentType: z.enum(["invoice", "bill_of_lading", "packing_list", "certificate_of_origin", "permit", "other"]),
      fileName: z.string().min(1),
      fileUrl: z.string().url(),
      fileSizeBytes: z.number().int().positive().optional(),
      mimeType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      const officerRoles = ["admin", "customs_officer", "inspector"];
      if (decl.traderId !== ctx.user.id && !officerRoles.includes(ctx.user.role))
        throw new TRPCError({ code: "FORBIDDEN" });
      const { addDocument: addDoc } = await import("../db");
      const doc = await addDoc({
        declarationId: input.declarationId,
        documentType: input.documentType as any,
        fileName: input.fileName,
        fileUrl: input.fileUrl,
        fileSizeBytes: input.fileSizeBytes ?? null,
        mimeType: input.mimeType ?? null,
      });
      await logAuditEvent({
        actorId: ctx.user.id,
        action: "declaration.document.added",
        entityType: "declaration",
        entityId: input.declarationId,
        metadata: { documentType: input.documentType, fileName: input.fileName },
      });
      return doc;
    }),

  /** List all documents for a declaration */
  listDocuments: protectedProcedure
    .input(z.object({ declarationId: z.number() }))
    .query(async ({ ctx, input }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND" });
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer"];
      if (decl.traderId !== ctx.user.id && !officerRoles.includes(ctx.user.role))
        throw new TRPCError({ code: "FORBIDDEN" });
      const { getDocumentsByDeclaration } = await import("../db");
      return getDocumentsByDeclaration(input.declarationId);
    }),

  /** Delete a document (uploader or admin only) */
  deleteDocument: protectedProcedure
    .input(z.object({ documentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { getDb } = await import("../db");
      const dbClient = await getDb();
      if (!dbClient) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [doc] = await dbClient.select().from(declarationDocuments)
        .where(eq(declarationDocuments.id, input.documentId))
        .limit(1);
      if (!doc) throw new TRPCError({ code: "NOT_FOUND" });
      // Only admin can delete; traders cannot delete submitted documents
      if (ctx.user.role !== "admin" && ctx.user.role !== "customs_officer")
        throw new TRPCError({ code: "FORBIDDEN" });
      await dbClient!.delete(declarationDocuments)
        .where(eq(declarationDocuments.id, input.documentId));
      await logAuditEvent({
        actorId: ctx.user.id,
        action: "declaration.document.deleted",
        entityType: "declaration",
        entityId: doc.declarationId,
        metadata: { documentId: input.documentId, fileName: doc.fileName },
      });
      return { success: true };
    }),

  /**
   * Sprint 112 — Assign Officer to Declaration
   * Allows admin/customs_officer to assign a declaration to a specific officer.
   * Broadcasts workload update after assignment.
   */
  assignOfficer: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      officerId: z.number().int().positive().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });

      const db = await (await import("../db")).getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const { eq } = await import("drizzle-orm");
      const { declarations: decl, users } = await import("../../drizzle/schema");

      // Verify declaration exists
      const [existing] = await db.select().from(decl).where(eq(decl.id, input.declarationId)).limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });

      // Verify officer exists and has correct role (if assigning)
      let officerName = "Unassigned";
      if (input.officerId !== null) {
        const [officer] = await db.select({ id: users.id, name: users.name, role: users.role })
          .from(users).where(eq(users.id, input.officerId)).limit(1);
        if (!officer) throw new TRPCError({ code: "NOT_FOUND", message: "Officer not found" });
        const officerRoles = ["admin", "customs_officer", "inspector"];
        if (!officerRoles.includes(officer.role)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "User is not a customs officer" });
        }
        officerName = officer.name ?? `Officer #${input.officerId}`;
      }

      // Update the assignment
      await db.update(decl)
        .set({ assignedOfficerId: input.officerId })
        .where(eq(decl.id, input.declarationId));

      await logAuditEvent({
        actorId: ctx.user.id,
        action: "declaration.officer_assigned",
        entityType: "declaration",
        entityId: input.declarationId,
        metadata: {
          officerId: input.officerId,
          officerName,
          previousOfficerId: existing.assignedOfficerId,
          declarationNumber: existing.declarationNumber,
        },
      });

      // Notify the newly assigned officer
      if (input.officerId !== null) {
        const savedNotif = await createUserNotification({
          userId: input.officerId,
          type: "declaration_assigned",
          title: "Declaration Assigned to You",
          body: `Declaration ${existing.declarationNumber} has been assigned to you for review. Risk lane: ${existing.riskLane ?? "pending"}.`,
          declarationId: input.declarationId,
        });
        if (savedNotif) {
          broadcastNotification(input.officerId, {
            id: savedNotif.id,
            category: "assignment",
            title: savedNotif.title,
            body: savedNotif.body ?? "",
            entityType: "declaration",
            entityId: input.declarationId,
            createdAt: savedNotif.createdAt?.toISOString() ?? new Date().toISOString(),
          });
        }
      }

      // Broadcast workload update to all connected officers
      (async () => {
        try {
          const { count, eq: eqOp, and: andOp, isNotNull, lt, sql } = await import("drizzle-orm");
          const db2 = await (await import("../db")).getDb();
          if (!db2) return;
          const [total, red, yellow, green] = await Promise.all([
            db2.select({ count: count() }).from(decl).where(eqOp(decl.status, "submitted" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "red" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "yellow" as any)),
            db2.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "green" as any)),
          ]);
          const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const [breached] = await db2.select({ count: count() }).from(decl)
            .where(andOp(eqOp(decl.status, "submitted" as any), lt(decl.submittedAt, cutoff)));
          broadcastWorkloadUpdate({
            totalPending: total[0]?.count ?? 0,
            redLane: red[0]?.count ?? 0,
            yellowLane: yellow[0]?.count ?? 0,
            greenLane: green[0]?.count ?? 0,
            slaBreached: breached?.count ?? 0,
            updatedAt: new Date().toISOString(),
          });
        } catch { /* non-critical */ }
      })();

      return { success: true, declarationId: input.declarationId, officerId: input.officerId, officerName };
    }),

  /**
   * Sprint 112 — List customs officers for assignment dropdown
   */
  listOfficers: protectedProcedure.query(async ({ ctx }) => {
    const allowedRoles = ["admin", "customs_officer"];
    if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await (await import("../db")).getDb();
    if (!db) return [];
    const { users } = await import("../../drizzle/schema");
    const { inArray: inArr } = await import("drizzle-orm");
    return db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(inArr(users.role, ["admin", "customs_officer", "inspector"] as any[]))
      .orderBy(users.name);
  }),

  /**
   * Sprint 110 — Officer Workload Dashboard
   * Returns per-officer queue counts and platform-wide lane breakdown.
   * Only accessible to admin, customs_officer, inspector, and finance roles.
   */
  workload: protectedProcedure.query(async ({ ctx }) => {
    const allowedRoles = ["admin", "customs_officer", "inspector", "finance"];
    if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });

    const db = await (await import("../db")).getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const { count, eq: eqOp, and: andOp, isNotNull, lt, sql } = await import("drizzle-orm");
    const { declarations: decl, users } = await import("../../drizzle/schema");

    // Platform-wide lane and status counts
    const [totalPending, redLane, yellowLane, greenLane] = await Promise.all([
      db.select({ count: count() }).from(decl).where(eqOp(decl.status, "submitted" as any)),
      db.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "red" as any)),
      db.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "yellow" as any)),
      db.select({ count: count() }).from(decl).where(eqOp(decl.riskLane, "green" as any)),
    ]);

    // SLA breaches: submitted declarations older than 24h
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [slaBreached] = await db.select({ count: count() }).from(decl)
      .where(andOp(eqOp(decl.status, "submitted" as any), lt(decl.submittedAt, cutoff24h)));

    // Per-officer queue: count of declarations assigned to each officer
    const officerQueues = await db
      .select({
        officerId: decl.assignedOfficerId,
        officerName: users.name,
        officerEmail: users.email,
        queueCount: count(),
        redCount: sql<number>`SUM(CASE WHEN ${decl.riskLane} = 'red' THEN 1 ELSE 0 END)`,
        yellowCount: sql<number>`SUM(CASE WHEN ${decl.riskLane} = 'yellow' THEN 1 ELSE 0 END)`,
        greenCount: sql<number>`SUM(CASE WHEN ${decl.riskLane} = 'green' THEN 1 ELSE 0 END)`,
        clearedCount: sql<number>`SUM(CASE WHEN ${decl.status} = 'cleared' THEN 1 ELSE 0 END)`,
      })
      .from(decl)
      .leftJoin(users, eqOp(decl.assignedOfficerId, users.id))
      .where(isNotNull(decl.assignedOfficerId))
      .groupBy(decl.assignedOfficerId, users.name, users.email);

    // Unassigned declarations
    const [unassigned] = await db.select({ count: count() }).from(decl)
      .where(andOp(eqOp(decl.status, "submitted" as any), sql`${decl.assignedOfficerId} IS NULL`));

    return {
      totalPending: totalPending[0]?.count ?? 0,
      redLane: redLane[0]?.count ?? 0,
      yellowLane: yellowLane[0]?.count ?? 0,
      greenLane: greenLane[0]?.count ?? 0,
      slaBreached: slaBreached?.count ?? 0,
      unassigned: unassigned?.count ?? 0,
      officerQueues: officerQueues.map((o) => ({
        officerId: o.officerId,
        officerName: o.officerName ?? "Unknown Officer",
        officerEmail: o.officerEmail ?? "",
        queueCount: Number(o.queueCount),
        redCount: Number(o.redCount ?? 0),
        yellowCount: Number(o.yellowCount ?? 0),
        greenCount: Number(o.greenCount ?? 0),
        clearedCount: Number(o.clearedCount ?? 0),
      })),
      updatedAt: new Date().toISOString(),
    };
  }),

  /** Export a single declaration as a PDF summary — available to the declaration owner and officers */
  /** Bulk export multiple declarations as a ZIP archive of HTML summaries — officers only */
  bulkExportZip: protectedProcedure
    .input(z.object({ ids: z.array(z.number()).min(1).max(50), label: z.string().max(256).optional() }))
    .mutation(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer"];
      if (!officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only customs officers can bulk-export declarations." });
      }
      const { getDeclarationById } = await import("../db");
      const { storagePut } = await import("../storage");
      const { nanoid: nanoId } = await import("nanoid");
      const { zipSync, strToU8 } = await import("fflate");
      const generatedDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

      function buildHtml(decl: any): string {
        const statusLabel = (decl.status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
        const riskLane = decl.riskLane ?? null;
        const laneLabel = riskLane ? riskLane.replace(/_lane$/, "").toUpperCase() + " LANE" : "N/A";
        const laneColor = riskLane === "green_lane" ? "#16a34a" : riskLane === "yellow_lane" ? "#d97706" : riskLane === "red_lane" ? "#dc2626" : "#6b7280";
        const riskScore = decl.riskScore !== null && decl.riskScore !== undefined ? Number(decl.riskScore) : null;
        const scoreColor = riskScore !== null ? (riskScore < 30 ? "#16a34a" : riskScore < 60 ? "#d97706" : "#dc2626") : "#6b7280";
        return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
body{font-family:'Helvetica Neue',Arial,sans-serif;margin:0;padding:40px;color:#1a1a2e;font-size:13px}
.header{text-align:center;border-bottom:3px solid #D4A017;padding-bottom:20px;margin-bottom:24px}
.header h1{font-size:26px;color:#0A1628;margin:0 0 4px;letter-spacing:1px}
.header h2{font-size:14px;color:#D4A017;margin:0;font-weight:500}
.meta{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;margin-bottom:24px;font-size:11px;color:#6b7280}
.status-badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;background:#f3f4f6;color:#374151}
.lane-badge{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;color:white;background:${laneColor}}
.section{margin-bottom:20px;page-break-inside:avoid}
.section-title{font-size:10px;font-weight:700;color:#D4A017;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid #e5e7eb;padding-bottom:5px;margin-bottom:10px}
table{width:100%;border-collapse:collapse}
td{padding:5px 8px;vertical-align:top}
td:first-child{color:#6b7280;width:45%;font-size:11px}
td:last-child{font-weight:600;font-size:12px}
tr:nth-child(even){background:#f9fafb}
.risk-score{font-size:28px;font-weight:900;color:${scoreColor}}
.footer{text-align:center;font-size:10px;color:#9ca3af;margin-top:40px;border-top:1px solid #e5e7eb;padding-top:12px}
</style></head><body>
<div class="header"><h1>NATIONAL TRADE GATEWAY</h1><h2>DECLARATION SUMMARY REPORT</h2></div>
<div class="meta">
  <span>Declaration: <strong>${decl.declarationNumber}</strong></span>
  <span>UCR: <strong>${decl.ucr ?? "N/A"}</strong></span>
  <span>Generated: <strong>${generatedDate}</strong></span>
  <span>Status: <span class="status-badge">${statusLabel}</span></span>
  <span>Risk Lane: <span class="lane-badge">${laneLabel}</span></span>
</div>
<div class="section"><div class="section-title">Goods &amp; Shipment</div><table>
  <tr><td>Declaration Type</td><td>${(decl.declarationType ?? "").replace(/_/g, " ").toUpperCase()}</td></tr>
  <tr><td>HS Code</td><td>${decl.hsCode ?? "N/A"}</td></tr>
  <tr><td>Goods Description</td><td>${decl.goodsDescription ?? "N/A"}</td></tr>
  <tr><td>Gross Weight</td><td>${decl.grossWeight ? `${decl.grossWeight} kg` : "N/A"}</td></tr>
  <tr><td>Net Weight</td><td>${decl.netWeight ? `${decl.netWeight} kg` : "N/A"}</td></tr>
  <tr><td>Number of Packages</td><td>${decl.numberOfPackages ?? "N/A"}</td></tr>
  <tr><td>Port of Entry</td><td>${decl.portOfEntry ?? "N/A"}</td></tr>
  <tr><td>Country of Origin</td><td>${decl.countryOfOrigin ?? "N/A"}</td></tr>
</table></div>
<div class="section"><div class="section-title">Financial</div><table>
  <tr><td>Invoice Value</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.invoiceValue ?? "N/A"}</td></tr>
  <tr><td>Duty Amount</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.dutyAmount ?? "0.00"}</td></tr>
  <tr><td>VAT Amount</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.vatAmount ?? "0.00"}</td></tr>
  <tr><td>Total Due</td><td><strong>${decl.invoiceCurrency ?? "USD"} ${decl.totalDue ?? "0.00"}</strong></td></tr>
</table></div>
${riskScore !== null ? `<div class="section"><div class="section-title">Risk Assessment</div><table>
  <tr><td>Risk Score</td><td><span class="risk-score">${riskScore}</span> / 100</td></tr>
  <tr><td>Risk Lane</td><td>${laneLabel}</td></tr>
</table></div>` : ""}
<div class="footer">Generated by National Trade Gateway Single Window Platform &nbsp;|&nbsp; ${generatedDate}<br>Declaration: ${decl.declarationNumber} &nbsp;|&nbsp; OFFICIAL USE</div>
</body></html>`;
      }

      const zipEntries: Record<string, Uint8Array> = {};
      const results: Array<{ id: number; declarationNumber: string; ok: boolean }> = [];
      for (const id of input.ids) {
        try {
          const decl = await getDeclarationById(id);
          if (!decl) { results.push({ id, declarationNumber: `#${id}`, ok: false }); continue; }
          const html = buildHtml(decl);
          const filename = `${decl.declarationNumber ?? `decl-${id}`}.html`;
          zipEntries[filename] = strToU8(html);
          results.push({ id, declarationNumber: decl.declarationNumber, ok: true });
        } catch {
          results.push({ id, declarationNumber: `#${id}`, ok: false });
        }
      }
      if (Object.keys(zipEntries).length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No declarations could be exported." });
      }
      const zipBuffer = Buffer.from(zipSync(zipEntries));
      const fileKey = `bulk-exports/declarations-${nanoId(8)}.zip`;
      const { url } = await storagePut(fileKey, zipBuffer, "application/zip");
      // Sprint 116: persist export record so officers can re-download from history
      const { bulkExports } = await import("../../drizzle/schema");
      const db = await getDb();
      const successCount = results.filter(r => r.ok).length;
      const failedCount = results.filter(r => !r.ok).length;
      let exportId: number | undefined;
      if (db) {
        const [inserted] = await db.insert(bulkExports).values({
          userId: ctx.user.id,
          declarationIds: JSON.stringify(input.ids),
          declarationCount: successCount,
          failedCount,
          s3Url: url,
          s3Key: fileKey,
          fileSizeBytes: zipBuffer.byteLength,
          label: input.label ?? null,
          // Expire after 7 days
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        }).returning({ id: bulkExports.id });
        exportId = inserted?.id;
      }
      await logAuditEvent({
        actorId: ctx.user.id,
        action: "declarations.bulkExportZip",
        entityType: "declaration",
        entityId: 0,
        metadata: { count: successCount, ids: input.ids, exportId },
      });
      return { url, count: successCount, failed: failedCount, exportId };
    }),

  exportSummaryPDF: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer"];
      const decl = await getDeclarationById(input.id);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      if (ctx.user.role === "user" && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const isOfficer = officerRoles.includes(ctx.user.role);
      const generatedDate = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
      const statusLabel = (decl.status ?? "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
      const riskLane = (decl as any).riskLane ?? null;
      const laneLabel = riskLane ? riskLane.replace(/_lane$/, "").toUpperCase() + " LANE" : "N/A";
      const laneColor = riskLane === "green_lane" ? "#16a34a" : riskLane === "yellow_lane" ? "#d97706" : riskLane === "red_lane" ? "#dc2626" : "#6b7280";
      const riskScore = (decl as any).riskScore !== null && (decl as any).riskScore !== undefined ? Number((decl as any).riskScore) : null;
      const scoreColor = riskScore !== null ? (riskScore < 30 ? "#16a34a" : riskScore < 60 ? "#d97706" : "#dc2626") : "#6b7280";
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 0; padding: 40px; color: #1a1a2e; font-size: 13px; }
    .header { text-align: center; border-bottom: 3px solid #D4A017; padding-bottom: 20px; margin-bottom: 24px; }
    .header h1 { font-size: 26px; color: #0A1628; margin: 0 0 4px; letter-spacing: 1px; }
    .header h2 { font-size: 14px; color: #D4A017; margin: 0; font-weight: 500; }
    .meta { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; margin-bottom: 24px; font-size: 11px; color: #6b7280; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; background: #f3f4f6; color: #374151; }
    .lane-badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 700; color: white; background: ${laneColor}; }
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title { font-size: 10px; font-weight: 700; color: #D4A017; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 5px 8px; vertical-align: top; }
    td:first-child { color: #6b7280; width: 45%; font-size: 11px; }
    td:last-child { font-weight: 600; font-size: 12px; }
    tr:nth-child(even) { background: #f9fafb; }
    .risk-score { font-size: 28px; font-weight: 900; color: ${scoreColor}; }
    .footer { text-align: center; font-size: 10px; color: #9ca3af; margin-top: 40px; border-top: 1px solid #e5e7eb; padding-top: 12px; }
    .watermark { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-45deg); font-size: 80px; color: rgba(212,160,23,0.05); font-weight: 900; letter-spacing: 8px; pointer-events: none; }
    .confidential { color: #dc2626; font-size: 10px; font-weight: 700; text-align: center; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="watermark">NGSWTP</div>
  <div class="confidential">${isOfficer ? "OFFICIAL USE — CUSTOMS AUTHORITY" : "TRADER COPY — CONFIDENTIAL"}</div>
  <div class="header">
    <h1>NATIONAL TRADE GATEWAY</h1>
    <h2>DECLARATION SUMMARY REPORT</h2>
  </div>
  <div class="meta">
    <span>Declaration: <strong>${decl.declarationNumber}</strong></span>
    <span>UCR: <strong>${decl.ucr ?? "N/A"}</strong></span>
    <span>Generated: <strong>${generatedDate}</strong></span>
    <span>Status: <span class="status-badge">${statusLabel}</span></span>
    <span>Risk Lane: <span class="lane-badge">${laneLabel}</span></span>
  </div>
  <div class="section">
    <div class="section-title">Goods &amp; Shipment</div>
    <table>
      <tr><td>Declaration Type</td><td>${(decl.declarationType ?? "").replace(/_/g, " ").toUpperCase()}</td></tr>
      <tr><td>HS Code</td><td>${decl.hsCode ?? "N/A"}</td></tr>
      <tr><td>Goods Description</td><td>${decl.goodsDescription ?? "N/A"}</td></tr>
      <tr><td>Gross Weight</td><td>${decl.grossWeight ? `${decl.grossWeight} kg` : "N/A"}</td></tr>
      <tr><td>Net Weight</td><td>${decl.netWeight ? `${decl.netWeight} kg` : "N/A"}</td></tr>
      <tr><td>Number of Packages</td><td>${decl.numberOfPackages ?? "N/A"}</td></tr>
      <tr><td>Port of Entry</td><td>${decl.portOfEntry ?? "N/A"}</td></tr>
      <tr><td>Country of Origin</td><td>${decl.countryOfOrigin ?? "N/A"}</td></tr>
    </table>
  </div>
  <div class="section">
    <div class="section-title">Parties</div>
    <table>
      <tr><td>Importer Name</td><td>${(decl as any).importerName ?? "N/A"}</td></tr>
      <tr><td>Importer TIN</td><td>${(decl as any).importerTin ?? "N/A"}</td></tr>
      <tr><td>Exporter Name</td><td>${(decl as any).exporterName ?? "N/A"}</td></tr>
      <tr><td>Country of Export</td><td>${(decl as any).countryOfExport ?? "N/A"}</td></tr>
    </table>
  </div>
  <div class="section">
    <div class="section-title">Financial</div>
    <table>
      <tr><td>Invoice Value</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.invoiceValue ?? "N/A"}</td></tr>
      <tr><td>Duty Amount</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.dutyAmount ?? "0.00"}</td></tr>
      <tr><td>VAT Amount</td><td>${decl.invoiceCurrency ?? "USD"} ${decl.vatAmount ?? "0.00"}</td></tr>
      <tr><td>Total Due</td><td><strong>${decl.invoiceCurrency ?? "USD"} ${decl.totalDue ?? "0.00"}</strong></td></tr>
      ${(decl as any).paymentReference ? `<tr><td>Payment Reference</td><td>${(decl as any).paymentReference}</td></tr>` : ""}
    </table>
  </div>
  ${riskScore !== null ? `
  <div class="section">
    <div class="section-title">Risk Assessment</div>
    <table>
      <tr><td>Risk Score</td><td><span class="risk-score">${riskScore}</span> / 100</td></tr>
      <tr><td>Risk Lane</td><td>${laneLabel}</td></tr>
    </table>
  </div>` : ""}
  ${(decl as any).notes ? `
  <div class="section">
    <div class="section-title">Customs Notes</div>
    <p style="font-style:italic;color:#92400e;background:#fffbeb;padding:10px;border-radius:4px;">${(decl as any).notes}</p>
  </div>` : ""}
  <div class="footer">
    Generated by National Trade Gateway Single Window Platform &nbsp;|&nbsp; ${generatedDate}<br>
    Declaration: ${decl.declarationNumber} &nbsp;|&nbsp; This document is for reference only.
  </div>
</body>
</html>`;
      const { storagePut } = await import("../storage");
      const { nanoid: nanoId } = await import("nanoid");
      const { execSync } = await import("child_process");
      const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
      const { tmpdir } = await import("os");
      const { join } = await import("path");
      const tmpHtml = join(tmpdir(), `decl-summary-${nanoId(8)}.html`);
      const tmpPdf = join(tmpdir(), `decl-summary-${nanoId(8)}.pdf`);
      try {
        writeFileSync(tmpHtml, htmlContent, "utf-8");
        execSync(`manus-md-to-pdf "${tmpHtml}" "${tmpPdf}" 2>/dev/null || wkhtmltopdf "${tmpHtml}" "${tmpPdf}" 2>/dev/null || chromium-browser --headless --no-sandbox --print-to-pdf="${tmpPdf}" "${tmpHtml}" 2>/dev/null || true`, { timeout: 30_000 });
        let pdfBuffer: Buffer;
        try {
          pdfBuffer = readFileSync(tmpPdf);
        } catch {
          const htmlBuffer = readFileSync(tmpHtml);
          const fileKey = `declaration-summaries/${decl.declarationNumber}-${nanoId(6)}.html`;
          const { url } = await storagePut(fileKey, htmlBuffer, "text/html");
          await logAuditEvent({ actorId: ctx.user.id, action: "declarations.exportSummaryPDF", entityType: "declaration", entityId: decl.id, metadata: { format: "html" } });
          return { url, format: "html" as const, declarationNumber: decl.declarationNumber };
        }
        const fileKey = `declaration-summaries/${decl.declarationNumber}-${nanoId(6)}.pdf`;
        const { url } = await storagePut(fileKey, pdfBuffer, "application/pdf");
        await logAuditEvent({ actorId: ctx.user.id, action: "declarations.exportSummaryPDF", entityType: "declaration", entityId: decl.id, metadata: { format: "pdf" } });
        return { url, format: "pdf" as const, declarationNumber: decl.declarationNumber };
      } finally {
        try { unlinkSync(tmpHtml); } catch { /* ignore */ }
        try { unlinkSync(tmpPdf); } catch { /* ignore */ }
      }
    }),

  // Sprint 117: bulk assign declarations to an officer
  bulkAssign: protectedProcedure
    .input(z.object({
      declarationIds: z.array(z.number().int().positive()).min(1).max(100),
      officerId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "inspector"];
      if (!officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only customs officers can bulk assign declarations." });
      }
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const { users } = await import("../../drizzle/schema");
      const [officer] = await db.select({ id: users.id, name: users.name })
        .from(users).where(eq(users.id, input.officerId)).limit(1);
      if (!officer) throw new TRPCError({ code: "NOT_FOUND", message: "Officer not found" });
      await db.update(declarations)
        .set({ assignedOfficerId: input.officerId, updatedAt: new Date() })
        .where(inArray(declarations.id, input.declarationIds));
      // Broadcast a workload refresh signal
      broadcastWorkloadUpdate({
        totalPending: input.declarationIds.length,
        redLane: 0,
        yellowLane: 0,
        greenLane: 0,
        slaBreached: 0,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent({
        actorId: ctx.user.id as unknown as number,
        action: "declarations.bulkAssign",
        entityType: "declaration" as any,
        entityId: input.declarationIds[0],
        metadata: { declarationIds: input.declarationIds, officerId: input.officerId, officerName: officer.name, count: input.declarationIds.length },
      });
      return { assigned: input.declarationIds.length, officerId: input.officerId, officerName: officer.name };
    }),

  // Sprint 49: bulk status update for admin/officer
  bulkUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number().int()).min(1).max(100),
      status: z.enum(["docs_required", "payment_pending", "under_examination", "examination_complete", "cleared", "rejected"]),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "customs_officer", "inspector"];
      if (!allowedRoles.includes(ctx.user.role)) throw new TRPCError({ code: "FORBIDDEN" });
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      const updateData: Record<string, unknown> = { status: input.status, updatedAt: new Date() };
      if (input.status === "cleared") updateData.clearedAt = new Date();
      await db.update(declarations).set(updateData as any).where(inArray(declarations.id, input.ids));
      await logAuditEvent({
        actorId: ctx.user.id as unknown as number,
        action: "declarations.bulkUpdateStatus",
        entityType: "declaration" as any,
        entityId: input.ids[0],
        metadata: { ids: input.ids, status: input.status, count: input.ids.length, notes: input.notes },
      });
      return { updated: input.ids.length, status: input.status };
    }),

  // Sprint 116: list bulk export history for the current officer
  listBulkExports: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      const officerRoles = ["admin", "customs_officer", "inspector", "finance", "oga_officer"];
      if (!officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only customs officers can view export history." });
      }
      const { bulkExports } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(bulkExports)
        .where(eq(bulkExports.userId, ctx.user.id))
        .orderBy(desc(bulkExports.createdAt))
        .limit(input.limit);
      return rows;
    }),

  /**
   * v95: Get risk score change history for a declaration (from audit events).
   */
  getRiskScoreHistory: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) return [];
      const { auditEvents } = await import("../../drizzle/schema");
      const { eq, and, desc } = await import("drizzle-orm");
      const rows = await db.select().from(auditEvents)
        .where(and(
          eq(auditEvents.entityType, "declaration"),
          eq(auditEvents.entityId, input.declarationId),
        ))
        .orderBy(desc(auditEvents.createdAt))
        .limit(100);
      // Filter to events that contain risk score information
      return rows.filter(r => {
        const ns = r.newState as any;
        const ps = r.previousState as any;
        return ns?.riskScore !== undefined || ps?.riskScore !== undefined ||
               ns?.riskLane !== undefined || ps?.riskLane !== undefined ||
               r.action === "risk_score_updated" || r.action === "lane_assigned";
      });
    }),
});
