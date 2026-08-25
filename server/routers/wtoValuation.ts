/**
 * wtoValuation.ts — WTO Customs Valuation tRPC Router
 *
 * Provides tRPC procedures for the WTO Customs Valuation Engine.
 * Proxies requests to the Rust wto-valuation-engine microservice.
 *
 * Procedures:
 *   calculate    — Calculate customs value using WTO CVA methods
 *   getByDeclaration — Get valuation for a declaration
 *   listByTrader — List all valuations for a trader
 *   getMCVTable  — Get Minimum Customs Value table
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { fetchWithResilience } from "../_core/middlewareClients";

const WTO_VALUATION_URL = process.env.WTO_VALUATION_SERVICE_URL ?? "http://localhost:8095";

const ValuationRequestSchema = z.object({
  declarationId:      z.string().uuid(),
  hsCode:             z.string().min(4).max(10),
  originCountry:      z.string().length(3),
  destinationPort:    z.string(),
  declaredValueUsd:   z.number().positive(),
  freightUsd:         z.number().min(0).default(0),
  insuranceUsd:       z.number().min(0).default(0),
  quantity:           z.number().positive(),
  unit:               z.string().default("kg"),
  goodsDescription:   z.string().min(5),
  invoiceNumber:      z.string().optional(),
  buyerSellerRelated: z.boolean().default(false),
});

export const wtoValuationRouter = router({
  calculate: protectedProcedure
    .input(ValuationRequestSchema)
    .mutation(async ({ input }) => {
      const res = await fetchWithResilience(
        `${WTO_VALUATION_URL}/v1/valuations/calculate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            declaration_id:      input.declarationId,
            hs_code:             input.hsCode,
            origin_country:      input.originCountry,
            destination_port:    input.destinationPort,
            declared_value_usd:  input.declaredValueUsd,
            freight_usd:         input.freightUsd,
            insurance_usd:       input.insuranceUsd,
            quantity:            input.quantity,
            unit:                input.unit,
            goods_description:   input.goodsDescription,
            invoice_number:      input.invoiceNumber,
            buyer_seller_related: input.buyerSellerRelated,
          }),
        },
        "wto-valuation"
      );
      return res.json();
    }),

  getByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.string().uuid() }))
    .query(async ({ input }) => {
      const res = await fetchWithResilience(
        `${WTO_VALUATION_URL}/v1/valuations/declaration/${input.declarationId}`,
        {},
        "wto-valuation"
      );
      if (res.status === 404) return null;
      return res.json();
    }),

  listByTrader: protectedProcedure
    .input(z.object({
      traderId: z.string(),
      limit:    z.number().int().min(1).max(100).default(20),
      offset:   z.number().int().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      const rows = await db.execute(sql`
        SELECT cv.*, d.trader_id
        FROM customs_valuations cv
        JOIN declarations d ON d.id = cv.declaration_id
        WHERE d.trader_id = ${input.traderId}
        ORDER BY cv.created_at DESC
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);
      return rows;
    }),

  getMCVTable: protectedProcedure
    .query(async () => {
      // Return the NCS 2024 Minimum Customs Value table
      return {
        currency: "USD",
        effectiveDate: "2024-01-01",
        source: "NCS Valuation Circular 2024/001",
        entries: [
          { hsChapter: "10", description: "Cereals (Rice)", mvcPerKg: 0.35, unit: "kg" },
          { hsChapter: "17", description: "Sugar", mvcPerKg: 0.55, unit: "kg" },
          { hsChapter: "22", description: "Beverages", mvcPerKg: 1.20, unit: "kg" },
          { hsChapter: "30", description: "Pharmaceuticals", mvcPerKg: 8.00, unit: "kg" },
          { hsChapter: "33", description: "Cosmetics", mvcPerKg: 3.50, unit: "kg" },
          { hsChapter: "61", description: "Knitted Garments", mvcPerKg: 4.00, unit: "kg" },
          { hsChapter: "62", description: "Woven Garments", mvcPerKg: 4.50, unit: "kg" },
          { hsChapter: "63", description: "Used Clothing", mvcPerKg: 2.00, unit: "kg" },
          { hsChapter: "64", description: "Footwear", mvcPerKg: 5.00, unit: "kg" },
          { hsChapter: "85", description: "Electronics", mvcPerKg: 5.00, unit: "kg" },
          { hsChapter: "87", description: "Vehicles", mvcPerKg: 8.00, unit: "kg" },
          { hsChapter: "94", description: "Furniture", mvcPerKg: 2.50, unit: "kg" },
        ],
      };
    }),
});
