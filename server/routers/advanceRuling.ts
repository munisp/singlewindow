/**
 * advanceRuling.ts — AEO MRA & Advance Ruling tRPC Router
 *
 * Implements WTO TFA Article 3 — Advance Ruling and
 * WCO SAFE Framework Pillar 2 — AEO Mutual Recognition.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { fetchWithResilience } from "../_core/middlewareClients";

const AEO_MRA_URL = process.env.AEO_MRA_SERVICE_URL ?? "http://localhost:8096";

export const advanceRulingRouter = router({
  // AEO Mutual Recognition Validation
  validateAEO: protectedProcedure
    .input(z.object({
      traderId:       z.string(),
      aeoNumber:      z.string().min(3),
      issuingCountry: z.string().length(3),
      declarationId:  z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => {
      const res = await fetchWithResilience(
        `${AEO_MRA_URL}/v1/aeo/validate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trader_id:       input.traderId,
            aeo_number:      input.aeoNumber,
            issuing_country: input.issuingCountry,
            declaration_id:  input.declarationId ?? "",
          }),
        },
        "aeo-mra"
      );
      return res.json();
    }),

  // Submit Advance Ruling Request (Trader)
  submitRequest: protectedProcedure
    .input(z.object({
      traderId:         z.string(),
      rulingType:       z.enum(["tariff_classification", "origin", "valuation"]),
      goodsDescription: z.string().min(20),
      hsCodeRequested:  z.string().optional(),
      originCountry:    z.string().length(3).optional(),
      declaredValue:    z.number().positive().optional(),
      justification:    z.string().min(50),
      supportingDocs:   z.array(z.string()).default([]),
    }))
    .mutation(async ({ input }) => {
      const res = await fetchWithResilience(
        `${AEO_MRA_URL}/v1/advance-rulings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trader_id:          input.traderId,
            ruling_type:        input.rulingType,
            goods_description:  input.goodsDescription,
            hs_code_requested:  input.hsCodeRequested,
            origin_country:     input.originCountry,
            declared_value:     input.declaredValue,
            justification:      input.justification,
            supporting_docs:    input.supportingDocs,
          }),
        },
        "aeo-mra"
      );
      return res.json();
    }),

  // Issue Ruling Decision (Customs Officer / Admin)
  issueDecision: adminProcedure
    .input(z.object({
      rulingId:          z.string().uuid(),
      hsCodeDecided:     z.string().optional(),
      originDecided:     z.string().length(3).optional(),
      valuationDecided:  z.number().positive().optional(),
      decision:          z.string().min(10),
      decisionRationale: z.string().min(50),
      issuedBy:          z.string(),
    }))
    .mutation(async ({ input }) => {
      const res = await fetchWithResilience(
        `${AEO_MRA_URL}/v1/advance-rulings/${input.rulingId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hs_code_decided:     input.hsCodeDecided,
            origin_decided:      input.originDecided,
            valuation_decided:   input.valuationDecided,
            decision:            input.decision,
            decision_rationale:  input.decisionRationale,
            issued_by:           input.issuedBy,
          }),
        },
        "aeo-mra"
      );
      return res.json();
    }),

  // Get a specific ruling
  getById: protectedProcedure
    .input(z.object({ rulingId: z.string().uuid() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${AEO_MRA_URL}/v1/advance-rulings/${input.rulingId}`,
        {},
        "aeo-mra"
      );
      return res.json();
    }),

  // List rulings for a trader
  listByTrader: protectedProcedure
    .input(z.object({
      traderId: z.string(),
      status:   z.enum(["pending", "under_review", "issued", "revoked"]).optional(),
      limit:    z.number().int().min(1).max(100).default(20),
      offset:   z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${AEO_MRA_URL}/v1/advance-rulings/trader/${input.traderId}?status=${input.status ?? ""}&limit=${input.limit}&offset=${input.offset}`,
        {},
        "aeo-mra"
      );
      return res.json();
    }),

  // Get MRA partner list
  getMRAPartners: protectedProcedure
    .query(async () => {
      return [
        {
          countryCode: "EU",
          name: "European Union",
          type: "Full MRA",
          benefits: ["Reduced examination rate (5%)", "Priority processing", "Mutual AEO recognition"],
          signedDate: "2023-03-15",
        },
        {
          countryCode: "US",
          name: "United States (C-TPAT)",
          type: "Security MRA",
          benefits: ["Front-of-line processing", "Reduced documentation", "Priority clearance"],
          signedDate: "2022-11-01",
        },
        {
          countryCode: "CN",
          name: "China (GACC)",
          type: "Security MRA",
          benefits: ["Expedited clearance", "Reduced inspection rate"],
          signedDate: "2024-01-20",
        },
        {
          countryCode: "GH",
          name: "Ghana (ECOWAS)",
          type: "ECOWAS MRA",
          benefits: ["ETL exemption", "Expedited clearance"],
          signedDate: "2021-06-01",
        },
      ];
    }),
});
