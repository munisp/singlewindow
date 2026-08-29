/**
 * tradeFinance.ts — Trade Finance tRPC Router
 *
 * Provides tRPC procedures for Letters of Credit, Bank Guarantees,
 * and Supply Chain Visibility (cargo tracking).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { fetchWithResilience } from "../_core/middlewareClients";

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
});
