/**
 * ncsNrs.ts — NCS–NRS Integration Router
 *
 * NSW Phase 1 (Mar 2026): Structured data-sharing between Nigeria Customs
 * Service (NCS) and Nigeria Revenue Service (NRS/FIRS).
 *
 * Architecture:
 *   NSW gateway adapter → declaration normaliser → landing-cost calculator
 *   → importer-TIN matching (CAC-RC/NIN) → NRS assessment pre-fill
 *   → VAT-at-border ledger → ISO 20022 payment references
 *   → 100% reconciliation audit trail
 *
 * NFRs:
 *   - Declaration-to-VAT-visibility ≤ 15 minutes
 *   - 100% reconciliation audit trail
 *   - NCS–NRS boundary respected (data-sharing only)
 *   - Mutual TLS on all inter-service calls
 *
 * Procedures:
 *   ingestDeclaration     — Push normalised NCS declaration into pipeline
 *   ingestEDI             — Push raw EDIFACT CUSCAR/CUSDEC message
 *   getLandingCost        — Get computed landing cost for a declaration
 *   getNRSPrefill         — Get NRS assessment pre-fill payload
 *   getReconciliation     — Get reconciliation summary for a period
 *   getExceptions         — Get exception queue (TIN mismatch, SLA breach)
 *   resolveException      — Resolve an exception
 *   getTINRegistry        — Search FIRS TIN registry
 *   upsertTINEntry        — Add/update a FIRS TIN registry entry
 *   updateCBNRate         — Update the CBN USD/NGN exchange rate
 *   getAuditTrail         — Get full reconciliation audit trail for a declaration
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { fetchWithResilience } from "../_core/middlewareClients";

const NCS_NRS_GATEWAY_URL = process.env.NCS_NRS_GATEWAY_URL ?? "http://ncs-nrs-gateway:8101";

async function fetchGateway(path: string, options: RequestInit = {}): Promise<Response> {
  // P0-7: timeout + retry + circuit breaker via the resilience wrapper.
  const res = await fetchWithResilience(`${NCS_NRS_GATEWAY_URL}${path}`, {
    ...options,
    timeoutMs: 5_000,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  }, "ncs-nrs-gateway");
  return res;
}

// ─── Input Schemas ─────────────────────────────────────────────────────────────

const HSLineSchema = z.object({
  line_number:       z.number().int().min(1),
  hs_code:           z.string().min(4).max(12),
  goods_description: z.string(),
  quantity:          z.number().positive(),
  unit:              z.string().default("KG"),
  unit_value_usd:    z.number().nonnegative(),
  line_value_usd:    z.number().nonnegative(),
  tariff_rate_pct:   z.number().nonnegative().optional(),
});

const NCSDeclarationSchema = z.object({
  declaration_number: z.string().min(1).max(64),
  ucr:                z.string().optional(),
  importer_name:      z.string().min(1),
  importer_tin:       z.string().length(12).optional(),
  importer_cac:       z.string().optional(),
  importer_nin:       z.string().optional(),
  hs_code:            z.string().min(4).max(12),
  goods_description:  z.string().optional(),
  country_of_origin:  z.string().length(2).optional(),
  port_of_entry:      z.string().optional(),
  invoice_value:      z.number().positive(),
  invoice_currency:   z.string().length(3).default("USD"),
  freight_cost:       z.number().nonnegative().default(0),
  insurance_cost:     z.number().nonnegative().default(0),
  gross_weight_kg:    z.number().nonnegative().optional(),
  number_of_packages: z.number().int().nonnegative().optional(),
  hs_lines:           z.array(HSLineSchema).optional().default([]),
  edi_message_id:     z.string().optional(),
  ubl_invoice_ref:    z.string().optional(),
  submitted_at:       z.string().datetime().optional(),
  ncs_status:         z.string().default("submitted"),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const ncsNrsRouter = router({

  /**
   * Push a normalised NCS declaration into the NCS→NRS pipeline.
   * Triggers: landing-cost computation, TIN matching, NRS pre-fill generation.
   */
  ingestDeclaration: protectedProcedure
    .input(NCSDeclarationSchema)
    .mutation(async ({ input }) => {
      const res = await fetchGateway("/v1/ncs/declarations/ingest", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Gateway error: ${err}` });
      }
      return res.json();
    }),

  /**
   * Push a raw EDIFACT CUSCAR/CUSDEC message into the pipeline.
   * The gateway normalises the EDI into a canonical declaration.
   */
  ingestEDI: protectedProcedure
    .input(z.object({
      message_type: z.enum(["CUSCAR", "CUSDEC"]),
      message_id:   z.string().min(1),
      raw_edi:      z.string().min(1),
      sender:       z.string().optional(),
      recipient:    z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const res = await fetchGateway("/v1/ncs/declarations/edi", {
        method: "POST",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `EDI ingest error: ${err}` });
      }
      return res.json();
    }),

  /**
   * Get the computed landing cost for a declaration.
   * Landing Cost = CIF + Import Duty + CISS (1%) + ETL (0.5%) + NTA (0.5%)
   * Import VAT = Landing Cost × 7.5% (VATA 2023)
   */
  getLandingCost: protectedProcedure
    .input(z.object({ declarationId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetchGateway(`/v1/ncs/declarations/${input.declarationId}/landing-cost`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err });
      }
      return res.json();
    }),

  /**
   * Get the NRS assessment pre-fill payload for a declaration.
   * This is the structured data sent to NRS/FIRS for VAT assessment.
   */
  getNRSPrefill: protectedProcedure
    .input(z.object({ declarationId: z.string() }))
    .query(async ({ input }) => {
      const res = await fetchGateway(`/v1/ncs/declarations/${input.declarationId}/nrs-prefill`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err });
      }
      return res.json();
    }),

  /**
   * Get the reconciliation summary for a period.
   * Includes: TIN match rate, total import VAT, SLA breach count, exception stats.
   */
  getReconciliation: protectedProcedure
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(), // "YYYY-MM"
    }))
    .query(async ({ input }) => {
      const params = input.period ? `?period=${input.period}` : "";
      const res = await fetchGateway(`/v1/ncs/reconciliation/summary${params}`);
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err });
      }
      return res.json();
    }),

  /**
   * Get the exception queue.
   * Exception types: TIN_MISMATCH, MISSING_TIN, CAC_MISMATCH, VAT_CALC_ERROR,
   *                  LATE_VISIBILITY, NRS_PUSH_FAILED
   */
  getExceptions: protectedProcedure
    .input(z.object({
      status: z.enum(["OPEN", "RESOLVED", "ESCALATED"]).default("OPEN"),
    }))
    .query(async ({ input }) => {
      const res = await fetchGateway(`/v1/ncs/exceptions?status=${input.status}`);
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err });
      }
      return res.json();
    }),

  /**
   * Resolve an exception in the queue.
   */
  resolveException: protectedProcedure
    .input(z.object({
      exceptionId:    z.string().uuid(),
      resolutionNote: z.string().min(1),
      assignedTo:     z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const res = await fetchGateway(`/v1/ncs/exceptions/${input.exceptionId}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          resolution_note: input.resolutionNote,
          assigned_to: input.assignedTo ?? ctx.user.email,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err });
      }
      return res.json();
    }),

  /**
   * Search the FIRS TIN registry by TIN, CAC-RC, NIN, or name.
   */
  searchTINRegistry: protectedProcedure
    .input(z.object({
      query:      z.string().min(2),
      searchType: z.enum(["TIN", "CAC", "NIN", "NAME"]).default("NAME"),
      limit:      z.number().int().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();

      let rows;
      switch (input.searchType) {
        case "TIN":
          rows = await db.execute(sql`
            SELECT tin, registered_name, cac_rc, nin, entity_type, tax_office, state, active
            FROM firs_tin_registry WHERE tin ILIKE ${`%${input.query}%`} LIMIT ${input.limit}
          `);
          break;
        case "CAC":
          rows = await db.execute(sql`
            SELECT tin, registered_name, cac_rc, nin, entity_type, tax_office, state, active
            FROM firs_tin_registry WHERE cac_rc ILIKE ${`%${input.query}%`} LIMIT ${input.limit}
          `);
          break;
        case "NIN":
          rows = await db.execute(sql`
            SELECT tin, registered_name, cac_rc, nin, entity_type, tax_office, state, active
            FROM firs_tin_registry WHERE nin = ${input.query} LIMIT ${input.limit}
          `);
          break;
        case "NAME":
        default:
          rows = await db.execute(sql`
            SELECT tin, registered_name, cac_rc, nin, entity_type, tax_office, state, active,
                   similarity(registered_name, ${input.query}) AS score
            FROM firs_tin_registry
            WHERE similarity(registered_name, ${input.query}) > 0.3
            ORDER BY score DESC
            LIMIT ${input.limit}
          `);
          break;
      }
      return rows.rows;
    }),

  /**
   * Add or update a FIRS TIN registry entry.
   * Used for bulk seeding from FIRS data exchange and manual corrections.
   */
  upsertTINEntry: adminProcedure
    .input(z.object({
      tin:             z.string().length(12),
      registered_name: z.string().min(1),
      cac_rc:          z.string().optional(),
      nin:             z.string().optional(),
      entity_type:     z.enum(["CORPORATE", "INDIVIDUAL"]).default("CORPORATE"),
      tax_office:      z.string().optional(),
      state:           z.string().optional(),
      active:          z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      await db.execute(sql`
        INSERT INTO firs_tin_registry (tin, registered_name, cac_rc, nin, entity_type, tax_office, state, active)
        VALUES (${input.tin}, ${input.registered_name}, ${input.cac_rc ?? null},
                ${input.nin ?? null}, ${input.entity_type}, ${input.tax_office ?? null},
                ${input.state ?? null}, ${input.active})
        ON CONFLICT (tin) DO UPDATE SET
          registered_name = EXCLUDED.registered_name,
          cac_rc = EXCLUDED.cac_rc,
          nin = EXCLUDED.nin,
          entity_type = EXCLUDED.entity_type,
          tax_office = EXCLUDED.tax_office,
          state = EXCLUDED.state,
          active = EXCLUDED.active,
          updated_at = NOW()
      `);
      return { success: true, tin: input.tin };
    }),

  /**
   * Update the CBN official USD/NGN exchange rate.
   * Rate is used in all landing cost computations.
   */
  updateCBNRate: adminProcedure
    .input(z.object({
      rate:           z.number().positive(),
      effectiveDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      source:         z.string().default("CBN_OFFICIAL"),
    }))
    .mutation(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      await db.execute(sql`
        INSERT INTO cbn_exchange_rates (currency_pair, rate, effective_date, source)
        VALUES ('USD/NGN', ${input.rate}, ${input.effectiveDate}::date, ${input.source})
        ON CONFLICT (currency_pair, effective_date) DO UPDATE SET
          rate = EXCLUDED.rate, source = EXCLUDED.source
      `);
      return { success: true, rate: input.rate, effectiveDate: input.effectiveDate };
    }),

  /**
   * Get the full reconciliation audit trail for a declaration.
   * Every event (ingestion, computation, TIN match, NRS push) is logged.
   */
  getAuditTrail: protectedProcedure
    .input(z.object({ declarationId: z.string() }))
    .query(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      const rows = await db.execute(sql`
        SELECT a.id, a.declaration_id, a.event_type, a.event_data, a.actor, a.created_at,
               d.declaration_number, d.importer_name, d.importer_tin
        FROM ncs_nrs_reconciliation_audit a
        LEFT JOIN ncs_nrs_declarations d ON d.id = a.declaration_id
        WHERE a.declaration_id::text = ${input.declarationId}
           OR d.declaration_number = ${input.declarationId}
        ORDER BY a.created_at ASC
      `);
      return rows.rows;
    }),

  /**
   * Get current CBN exchange rate.
   */
  getCBNRate: protectedProcedure
    .query(async () => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      const rows = await db.execute(sql`
        SELECT rate, effective_date, source
        FROM cbn_exchange_rates
        WHERE currency_pair = 'USD/NGN'
        ORDER BY effective_date DESC
        LIMIT 1
      `);
      return rows.rows[0] ?? { rate: 1580.0, effective_date: new Date().toISOString().split("T")[0], source: "FALLBACK" };
    }),

  /**
   * Get NCS-NRS pipeline statistics for the dashboard.
   */
  getPipelineStats: protectedProcedure
    .input(z.object({
      period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    }))
    .query(async ({ input }) => {
      const { requireDb } = await import("../db");
      const { sql } = await import("drizzle-orm");
      const db = await requireDb();
      const period = input.period ?? new Date().toISOString().slice(0, 7);

      const { rows: [stats] } = await db.execute(sql`
        SELECT
          COUNT(d.id)                                                       AS total_declarations,
          COUNT(lc.id)                                                      AS landing_costs_computed,
          COUNT(m.id) FILTER (WHERE m.match_status = 'MATCHED')            AS tin_matched,
          COUNT(m.id) FILTER (WHERE m.match_status = 'NO_MATCH')           AS tin_unmatched,
          COUNT(p.id) FILTER (WHERE p.status = 'PREFILLED')                AS prefills_sent,
          COUNT(p.id) FILTER (WHERE p.status = 'EXCEPTION')                AS prefills_exception,
          COALESCE(SUM(lc.import_vat_ngn), 0)                              AS total_vat_ngn,
          COALESCE(SUM(lc.landing_cost_ngn), 0)                            AS total_landing_cost_ngn,
          COALESCE(AVG(EXTRACT(EPOCH FROM (p.generated_at - d.submitted_at))/60), 0) AS avg_visibility_min,
          COUNT(p.id) FILTER (
            WHERE EXTRACT(EPOCH FROM (p.generated_at - d.submitted_at))/60 > 15
          )                                                                 AS sla_breaches
        FROM ncs_nrs_declarations d
        LEFT JOIN ncs_nrs_landing_costs lc ON lc.declaration_id = d.id
        LEFT JOIN ncs_nrs_tin_matches m ON m.declaration_id = d.id
        LEFT JOIN ncs_nrs_assessment_prefills p ON p.declaration_id = d.id
        WHERE TO_CHAR(d.submitted_at, 'YYYY-MM') = ${period}
      `);
      return stats ?? {};
    }),
});
