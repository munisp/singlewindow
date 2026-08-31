/**
 * tradeFinance.ts — Trade Finance tRPC Router
 *
 * Provides tRPC procedures for Letters of Credit, Bank Guarantees,
 * Supply Chain Visibility (cargo tracking), and the WP-6 CamelONE-style
 * multi-bank trade-finance rail: trader consent management (grant/revoke/
 * list with digest evidence), the trade-finance application wizard and
 * status tracking, wired to the financial-controls rail via its signed,
 * fail-closed API.
 */
import { createHash } from "crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { fetchWithResilience } from "../_core/middlewareClients";
import { getDb } from "../db";
import { tradeFinanceConsentEvidence } from "../../drizzle/schema";
import {
  TradeFinanceControlsClient,
  TradeFinanceControlsUnconfiguredError,
} from "../integrations/tradeFinanceControlsClient";

// ─── WP-6 trade-finance rail (CamelONE-style multi-bank) ────────────────────

/** Fail-closed client singleton: unconfigured rail = unavailable feature. */
let wp6Client: TradeFinanceControlsClient | null = null;
function controlsClient(): TradeFinanceControlsClient {
  if (!wp6Client) {
    try {
      wp6Client = TradeFinanceControlsClient.fromEnv();
    } catch (err) {
      if (err instanceof TradeFinanceControlsUnconfiguredError) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: err.message });
      }
      throw err;
    }
  }
  return wp6Client;
}

/** Durable trader reference used across the rail boundary (tokenized). */
function traderRef(userId: number): string {
  return `sw-user-${userId}`;
}

/** sha256 digest of the canonical JSON of one rail artifact. */
function evidenceDigest(artifact: unknown): string {
  return "sha256:" + createHash("sha256").update(stableJson(artifact)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => JSON.stringify(k) + ":" + stableJson(v));
  return "{" + entries.join(",") + "}";
}

/** Persist one digest-evidence row; best-effort on the local mirror only
 *  when the database is unavailable the rail call result still stands. */
async function recordEvidence(input: {
  consentId: string;
  traderUserId: number;
  traderRefValue: string;
  bankId: string;
  action: string;
  artifact: unknown;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(tradeFinanceConsentEvidence).values({
    consentId: input.consentId,
    traderUserId: input.traderUserId,
    traderRef: input.traderRefValue,
    bankId: input.bankId,
    action: input.action,
    envelopeDigestSha256: evidenceDigest(input.artifact),
    detail: input.artifact as Record<string, unknown>,
  });
}

const consentScopeEnum = z.enum(["DECLARATION_DIGESTS", "DUTY_PAYMENT_HISTORY", "TAX_STAMP_STATUS"]);
const digestRef = z.string().regex(/^(sha256:)?[0-9a-f]{64}$/, "dataset refs must be sha256 digests");

const tradeFinanceWp6Procedures = {
  // ── Consent management (NTP TFC pattern) ─────────────────────────────────
  consentGrant: protectedProcedure
    .input(z.object({
      consentId: z.string().min(1).max(128),
      bankId: z.string().min(1).max(128),
      scopes: z.array(consentScopeEnum).min(1),
      datasetRefs: z.record(consentScopeEnum, z.array(digestRef).min(1)),
      expiresAt: z.string().datetime(),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = controlsClient();
      const response = await client.requestConsent({
        consent_id: input.consentId,
        trader_id: traderRef(ctx.user.id),
        bank_id: input.bankId,
        scopes: input.scopes,
        dataset_refs: input.datasetRefs,
        expires_at: input.expiresAt,
      });
      await recordEvidence({
        consentId: input.consentId, traderUserId: ctx.user.id, traderRefValue: traderRef(ctx.user.id),
        bankId: input.bankId, action: "REQUESTED", artifact: response,
      });
      return response;
    }),

  consentMove: protectedProcedure
    .input(z.object({
      consentId: z.string().min(1).max(128),
      move: z.enum(["activate", "reject", "request-revocation", "confirm-revocation", "reject-revocation"]),
      version: z.number().int().positive(),
      bankId: z.string().min(1).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = controlsClient();
      const response = await client.consentMove(input.consentId, input.move, input.version);
      const actionMap: Record<string, string> = {
        activate: "ACTIVATED", reject: "REJECTED",
        "request-revocation": "REVOCATION_REQUESTED",
        "confirm-revocation": "REVOKED", "reject-revocation": "REVOCATION_REJECTED",
      };
      await recordEvidence({
        consentId: input.consentId, traderUserId: ctx.user.id, traderRefValue: traderRef(ctx.user.id),
        bankId: input.bankId, action: actionMap[input.move], artifact: response,
      });
      return response;
    }),

  consentList: protectedProcedure.query(async ({ ctx }) => {
    const client = controlsClient();
    const remote = await client.listConsents(traderRef(ctx.user.id));
    const db = await getDb();
    const evidence = db
      ? await db.select().from(tradeFinanceConsentEvidence)
      : [];
    return { consents: remote?.consents ?? [], evidenceCount: evidence.length };
  }),

  consentGet: protectedProcedure
    .input(z.object({ consentId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      return controlsClient().getConsent(input.consentId);
    }),

  consentAudit: protectedProcedure
    .input(z.object({ consentId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      const client = controlsClient();
      const remote = await client.getConsentAudit(input.consentId);
      return { ...remote, evidence_digest: evidenceDigest(remote) };
    }),

  // ── Application wizard + status tracking ─────────────────────────────────
  financeApply: protectedProcedure
    .input(z.object({
      applicationId: z.string().min(1).max(128),
      externalRef: z.string().min(1).max(128),
      bankId: z.string().min(1).max(128),
      consentId: z.string().min(1).max(128),
      product: z.enum([
        "IMPORT_LC_FACILITATION", "EXPORT_PRESHIPMENT_FINANCE",
        "INVOICE_RECEIVABLES_FINANCE", "DUTY_DEFERRAL_GUARANTEE",
      ]),
      amountMinor: z.number().int().positive(),
      currency: z.enum(["NGN", "USD"]),
      assignments: z.object({
        kycOfficer: z.string().min(1),
        creditOfficer: z.string().min(1),
        customsOfficer: z.string().min(1),
        treasuryOfficer: z.string().min(1),
      }),
    }))
    .mutation(async ({ ctx, input }) => {
      const client = controlsClient();
      return client.submitApplication({
        application_id: input.applicationId,
        external_ref: input.externalRef,
        trader_id: traderRef(ctx.user.id),
        bank_id: input.bankId,
        consent_id: input.consentId,
        product: input.product,
        amount: input.amountMinor,
        currency: input.currency,
        assignments: {
          BANK_KYC_OFFICER: input.assignments.kycOfficer,
          BANK_CREDIT_OFFICER: input.assignments.creditOfficer,
          CUSTOMS_COMPLIANCE_OFFICER: input.assignments.customsOfficer,
          BANK_TREASURY_OFFICER: input.assignments.treasuryOfficer,
          TRADER: traderRef(ctx.user.id),
        },
      });
    }),

  financeDecision: protectedProcedure
    .input(z.object({
      applicationId: z.string().min(1).max(128),
      version: z.number().int().positive(),
      decision: z.enum(["APPROVE", "REJECT"]),
    }))
    .mutation(async ({ ctx, input }) => {
      return controlsClient().recordDecision(input.applicationId, input.version, input.decision);
    }),

  financeGet: protectedProcedure
    .input(z.object({ applicationId: z.string().min(1).max(128) }))
    .query(async ({ input }) => {
      return controlsClient().getApplication(input.applicationId);
    }),

  financeList: protectedProcedure.query(async ({ ctx }) => {
    const client = controlsClient();
    return client.listApplications(traderRef(ctx.user.id));
  }),

  // Consented dataset read-back (trader verifies what the bank can see;
  // the envelope is verified inside the client before returning).
  consentedDataset: protectedProcedure
    .input(z.object({ scope: consentScopeEnum }))
    .query(async ({ ctx, input }) => {
      return controlsClient().getConsentedDataset(traderRef(ctx.user.id), input.scope);
    }),
};

const TRADE_FINANCE_URL = process.env.TRADE_FINANCE_SERVICE_URL ?? "http://localhost:8097";

/** SW-22: officers may act on behalf of an applicant; traders only for themselves. */
const OFFICER_ROLES = ["admin", "finance", "customs_officer"];

function bindApplicant(ctx: { user: { id: number; role: string } }, requestedId: string | undefined): string {
  const selfId = String(ctx.user.id);
  if (!requestedId || requestedId === selfId) return selfId;
  if (OFFICER_ROLES.includes(ctx.user.role)) return requestedId;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "You can only create trade finance instruments for yourself",
  });
}

/** SW-22: exact decimal → integer minor units (no float money at the API edge). */
function toMinorUnits(amount: number): number {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid monetary amount: ${s}` });
  }
  const [maj, frac = ""] = s.split(".");
  return Number(BigInt(maj) * 100n + BigInt((frac + "00").slice(0, 2)));
}

/** Propagate the verified caller identity to the downstream service. */
function identityHeaders(ctx: { user: { id: number; role: string } }): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-User-Id": String(ctx.user.id),
    "X-User-Role": ctx.user.role,
  };
}

export const tradeFinanceRouter = router({
  // ── Letter of Credit ──────────────────────────────────────────────────────
  createLC: protectedProcedure
    .input(z.object({
      declarationId:      z.string().uuid().optional(),
      applicantId:        z.string(),
      applicantName:      z.string(),
      beneficiaryName:    z.string(),
      beneficiaryCountry: z.string().length(3),
      issuingBank:        z.string(),
      advisingBank:       z.string().optional(),
      amount:             z.number().positive(),
      currency:           z.string().length(3).default("USD"),
      expiryDate:         z.string().datetime(),
      portOfLoading:      z.string().length(5),
      portOfDischarge:    z.string().length(5),
      goodsDescription:   z.string(),
      hsCode:             z.string(),
      incoterms:          z.string().default("CIF"),
    }))
    .mutation(async ({ input, ctx }) => {
      // SW-22: applicant identity from the verified token, never the request body.
      const applicantId = bindApplicant(ctx, input.applicantId);
      const amountMinorUnits = toMinorUnits(input.amount);
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/letters-of-credit`,
        {
          method: "POST",
          headers: identityHeaders(ctx),
          body: JSON.stringify({
            declaration_id:      input.declarationId,
            applicant_id:        applicantId,
            applicant_name:      input.applicantName,
            beneficiary_name:    input.beneficiaryName,
            beneficiary_country: input.beneficiaryCountry,
            issuing_bank:        input.issuingBank,
            advising_bank:       input.advisingBank,
            amount:              input.amount,
            amount_minor_units:  amountMinorUnits,
            currency:            input.currency,
            expiry_date:         input.expiryDate,
            port_of_loading:     input.portOfLoading,
            port_of_discharge:   input.portOfDischarge,
            goods_description:   input.goodsDescription,
            hs_code:             input.hsCode,
            incoterms:           input.incoterms,
          }),
        },
        "trade-finance"
      );
      return res.json();
    }),

  // ── Bank Guarantee ────────────────────────────────────────────────────────
  createBankGuarantee: protectedProcedure
    .input(z.object({
      declarationId: z.string().uuid().optional(),
      traderId:      z.string(),
      issuingBank:   z.string(),
      guaranteeType: z.enum(["customs_bond", "duty_deferment", "transit"]),
      amount:        z.number().positive(),
      currency:      z.string().length(3).default("NGN"),
      validDays:     z.number().int().min(30).max(730).default(365),
      dutyAmount:    z.number().min(0).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      // SW-22: trader identity from the verified token, never the request body.
      const traderId = bindApplicant(ctx, input.traderId);
      const amountMinorUnits = toMinorUnits(input.amount);
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/bank-guarantees`,
        {
          method: "POST",
          headers: identityHeaders(ctx),
          body: JSON.stringify({
            declaration_id: input.declarationId,
            trader_id:      traderId,
            issuing_bank:   input.issuingBank,
            guarantee_type: input.guaranteeType,
            amount:         input.amount,
            amount_minor_units: amountMinorUnits,
            currency:       input.currency,
            valid_days:     input.validDays,
            duty_amount:    input.dutyAmount,
          }),
        },
        "trade-finance"
      );
      return res.json();
    }),

  // ── Supply Chain Visibility ───────────────────────────────────────────────
  addTrackingEvent: protectedProcedure
    .input(z.object({
      declarationId: z.string().uuid(),
      containerNo:   z.string().optional(),
      vesselName:    z.string().optional(),
      voyageNo:      z.string().optional(),
      eventType:     z.enum(["GATE_IN", "LOADED", "DEPARTED", "ARRIVED", "DISCHARGED", "GATE_OUT", "CUSTOMS_HOLD", "RELEASED"]),
      location:      z.string(),
      latitude:      z.number().optional(),
      longitude:     z.number().optional(),
      eventTime:     z.string().datetime(),
      source:        z.string().default("CUSTOMS"),
    }))
    .mutation(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/tracking/${input.declarationId}/events`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            declaration_id: input.declarationId,
            container_no:   input.containerNo,
            vessel_name:    input.vesselName,
            voyage_no:      input.voyageNo,
            event_type:     input.eventType,
            location:       input.location,
            latitude:       input.latitude,
            longitude:      input.longitude,
            event_time:     input.eventTime,
            source:         input.source,
          }),
        },
        "trade-finance"
      );
      return res.json();
    }),

  getLC: protectedProcedure
    .input(z.object({ lcId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/letters-of-credit/${input.lcId}`,
        {},
        "trade-finance"
      );
      if (res.status === 404) return null;
      return res.json();
    }),

  listLCByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/letters-of-credit?declaration_id=${input.declarationId}`,
        {},
        "trade-finance"
      );
      return res.json();
    }),

  getBankGuarantee: protectedProcedure
    .input(z.object({ bgId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/bank-guarantees/${input.bgId}`,
        {},
        "trade-finance"
      );
      if (res.status === 404) return null;
      return res.json();
    }),

  listBGByTrader: protectedProcedure
    .input(z.object({ traderId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/bank-guarantees?trader_id=${input.traderId}`,
        {},
        "trade-finance"
      );
      return res.json();
    }),

  getTrackingHistory: protectedProcedure
    .input(z.object({ declarationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/tracking/${input.declarationId}`,
        {},
        "trade-finance"
      );
      return res.json();
    }),

  ...tradeFinanceWp6Procedures,
});

