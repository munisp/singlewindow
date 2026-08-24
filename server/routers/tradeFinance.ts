/**
 * tradeFinance.ts — Trade Finance tRPC Router
 *
 * Provides tRPC procedures for Letters of Credit, Bank Guarantees,
 * and Supply Chain Visibility (cargo tracking).
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { fetchWithResilience } from "../_core/middlewareClients";
import { resolveActingPrincipal } from "../_core/mandateAuthorization";

const TRADE_FINANCE_URL = process.env.TRADE_FINANCE_SERVICE_URL ?? "http://localhost:8097";

export const tradeFinanceRouter = router({
  // ── Letter of Credit ──────────────────────────────────────────────────────
  createLC: protectedProcedure
    .input(z.object({
      declarationId:      z.string().uuid().optional(),
      applicantId:        z.string(),
      principalUserId:    z.number().int().positive().optional(),
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
      const resolved = await resolveActingPrincipal(input.principalUserId, ctx.user);
      const applicantId = ["admin", "customs_officer", "finance", "oga_officer"].includes(ctx.user.role) && !input.principalUserId
        ? input.applicantId
        : String(resolved.principalUserId);
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/letters-of-credit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            declaration_id:      input.declarationId,
            applicant_id:        applicantId,
            acting_agent_id:     resolved.actingAgentId,
            applicant_name:      input.applicantName,
            beneficiary_name:    input.beneficiaryName,
            beneficiary_country: input.beneficiaryCountry,
            issuing_bank:        input.issuingBank,
            advising_bank:       input.advisingBank,
            amount:              input.amount,
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
      principalUserId: z.number().int().positive().optional(),
      issuingBank:   z.string(),
      guaranteeType: z.enum(["customs_bond", "duty_deferment", "transit"]),
      amount:        z.number().positive(),
      currency:      z.string().length(3).default("NGN"),
      validDays:     z.number().int().min(30).max(730).default(365),
      dutyAmount:    z.number().min(0).default(0),
    }))
    .mutation(async ({ input, ctx }) => {
      const resolved = await resolveActingPrincipal(input.principalUserId, ctx.user);
      const traderId = ["admin", "customs_officer", "finance", "oga_officer"].includes(ctx.user.role) && !input.principalUserId
        ? input.traderId
        : String(resolved.principalUserId);
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/bank-guarantees`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            declaration_id: input.declarationId,
            trader_id:      traderId,
            acting_agent_id: resolved.actingAgentId,
            issuing_bank:   input.issuingBank,
            guarantee_type: input.guaranteeType,
            amount:         input.amount,
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
    .query(async ({ input, ctx }) => {
      const traderId = ["admin", "customs_officer", "finance", "oga_officer"].includes(ctx.user.role)
        ? input.traderId
        : String(ctx.user.id);
      const res = await fetchWithResilience(
        `${TRADE_FINANCE_URL}/v1/bank-guarantees?trader_id=${traderId}`,
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
