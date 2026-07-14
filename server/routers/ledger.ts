/**
 * ledger.ts — tRPC router for TigerBeetle double-entry ledger (Sprint 31)
 *
 * Proxies to the Rust tigerbeetle-bridge service (port 8093).
 * Falls back to DB-persisted ledger entries when the bridge is unavailable.
 *
 * Procedures:
 *   ledger.getAccount        — get account details and balance
 *   ledger.getBalance        — get account balance
 *   ledger.postTransfer      — post an immediate double-entry transfer
 *   ledger.pendingTransfer   — create a two-phase pending transfer (reserve funds)
 *   ledger.postPending       — finalize a pending transfer (commit)
 *   ledger.voidPending       — void a pending transfer (cancel reservation)
 *   ledger.getTransfer       — get a transfer by ID
 *   ledger.listByDeclaration — list ledger entries for a declaration
 *   ledger.listByPayment     — list ledger entries for a payment
 *   ledger.getSummary        — get ledger summary (balances, recent transfers)
 *   ledger.scorePaymentRisk  — call Python payment-risk-scorer before transfer
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { publishEvent, TOPICS } from "../_core/kafka";
import {
  getLedgerEntriesByDeclaration,
  getLedgerEntriesByPayment,
  getRecentLedgerEntries,
  createLedgerEntry,
} from "../db";

const TB_BRIDGE_URL = process.env.TB_BRIDGE_URL || "http://tigerbeetle-bridge:8093";
const PAYMENT_RISK_URL = process.env.PAYMENT_RISK_URL || "http://localhost:8092";

async function tbBridgeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${TB_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function riskScorerAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${PAYMENT_RISK_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function tbFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${TB_BRIDGE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `TigerBeetle bridge error (${res.status}): ${body}`,
    });
  }
  return res.json() as Promise<T>;
}

export const ledgerRouter = router({
  /**
   * Get account details and current balance from the TigerBeetle bridge.
   */
  getAccount: protectedProcedure
    .input(z.object({ accountId: z.string().min(1) }))
    .query(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
      }
      return tbFetch<Record<string, unknown>>(`/api/ledger/accounts/${input.accountId}`);
    }),

  /**
   * Get the current balance of a ledger account.
   */
  getBalance: protectedProcedure
    .input(z.object({ accountId: z.string().min(1) }))
    .query(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
      }
      return tbFetch<Record<string, unknown>>(`/api/ledger/accounts/${input.accountId}/balance`);
    }),

  /**
   * Post an immediate double-entry transfer.
   */
  postTransfer: protectedProcedure
    .input(z.object({
      debitAccountId: z.string().min(1),
      creditAccountId: z.string().min(1),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Amount must be a positive decimal"),
      currency: z.string().length(3).default("GHS"),
      reference: z.string().max(128).optional(),
      description: z.string().max(512).optional(),
      declarationId: z.number().int().positive().optional(),
      paymentId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const available = await tbBridgeAvailable();
      if (available) {
        const result = await tbFetch<Record<string, unknown>>("/api/ledger/transfers", {
          method: "POST",
          body: JSON.stringify({
            debitAccountId: input.debitAccountId,
            creditAccountId: input.creditAccountId,
            amount: input.amount,
            currency: input.currency,
            reference: input.reference,
            description: input.description,
          }),
        });
        // Persist to DB for audit
        await createLedgerEntry({
          tbTransferId: (result as any).id ?? crypto.randomUUID(),
          debitAccountId: input.debitAccountId,
          creditAccountId: input.creditAccountId,
          amountMinorUnits: Math.round(parseFloat(input.amount) * 100),
          currency: input.currency,
          ledger: 1,
          entryType: "duty_payment",
          status: "posted",
          declarationId: input.declarationId,
          paymentId: input.paymentId,
          reference: input.reference,
          description: input.description,
          postedAt: new Date(),
        }).catch(e => console.warn("[Ledger] DB persist failed:", e));
        // Publish Kafka PAYMENT_INITIATED event (fire-and-forget)
        publishEvent(TOPICS.PAYMENT_INITIATED, {
          eventType: "payment.initiated",
          aggregateId: (result as any).id ?? input.reference ?? "unknown",
          payload: {
            debitAccountId: input.debitAccountId,
            creditAccountId: input.creditAccountId,
            amount: input.amount,
            currency: input.currency,
            reference: input.reference ?? null,
            declarationId: input.declarationId ?? null,
            paymentId: input.paymentId ?? null,
            initiatedBy: ctx.user.id,
          },
        }).catch(() => {});
        return result;
      }

      // Fallback: persist to DB only
      const entry = await createLedgerEntry({
        tbTransferId: crypto.randomUUID(),
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amountMinorUnits: Math.round(parseFloat(input.amount) * 100),
        currency: input.currency,
        ledger: 1,
        entryType: "duty_payment",
        status: "posted",
        declarationId: input.declarationId,
        paymentId: input.paymentId,
        reference: input.reference,
        description: input.description,
        postedAt: new Date(),
      });
      return { ...entry, _source: "db_fallback" };
    }),

  /**
   * Create a two-phase pending transfer (reserve funds).
   */
  pendingTransfer: protectedProcedure
    .input(z.object({
      debitAccountId: z.string().min(1),
      creditAccountId: z.string().min(1),
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      currency: z.string().length(3).default("GHS"),
      reference: z.string().max(128).optional(),
      description: z.string().max(512).optional(),
    }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
      }
      return tbFetch<Record<string, unknown>>("/api/ledger/transfers/pending", {
        method: "POST",
        body: JSON.stringify(input),
      });
    }),

  /**
   * Finalize a pending transfer (commit the reservation).
   */
  postPending: protectedProcedure
    .input(z.object({ pendingId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
      }
      return tbFetch<Record<string, unknown>>(`/api/ledger/transfers/post/${input.pendingId}`, {
        method: "POST",
      });
    }),

  /**
   * Void a pending transfer (cancel the reservation).
   */
  voidPending: protectedProcedure
    .input(z.object({ pendingId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
      }
      return tbFetch<Record<string, unknown>>(`/api/ledger/transfers/void/${input.pendingId}`, {
        method: "POST",
      });
    }),

  /**
   * Get a transfer by its TigerBeetle transfer ID.
   */
  getTransfer: protectedProcedure
    .input(z.object({ transferId: z.string().min(1) }))
    .query(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (available) {
        return tbFetch<Record<string, unknown>>(`/api/ledger/transfers/${input.transferId}`);
      }
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "TigerBeetle bridge is unavailable" });
    }),

  /**
   * List ledger entries for a specific declaration (from DB).
   */
  listByDeclaration: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getLedgerEntriesByDeclaration(input.declarationId);
    }),

  /**
   * List ledger entries for a specific payment (from DB).
   */
  listByPayment: protectedProcedure
    .input(z.object({ paymentId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getLedgerEntriesByPayment(input.paymentId);
    }),

  /**
   * Get ledger summary: all account balances + recent transfers.
   * Calls the Go bridge; falls back to DB recent entries.
   */
  getSummary: protectedProcedure.query(async () => {
    const available = await tbBridgeAvailable();
    if (available) {
      return tbFetch<Record<string, unknown>>("/api/ledger/summary");
    }
    // DB fallback
    const recent = await getRecentLedgerEntries(20);
    return {
      recentTransfers: recent,
      summary: {
        mode: "db_fallback",
        note: "TigerBeetle bridge unavailable — showing DB ledger entries only",
      },
    };
  }),

  /**
   * Score payment risk via the Python payment-risk-scorer service.
   * Call this before initiating a Mojaloop transfer to get risk tier and action.
   */
  scorePaymentRisk: protectedProcedure
    .input(z.object({
      traderId: z.string().min(1),
      declarationId: z.string().optional(),
      amount: z.number().positive(),
      currency: z.string().length(3).default("GHS"),
      fspId: z.string().min(1),
      fspType: z.enum(["BANK", "MOBILE_MONEY", "RTGS"]),
      payerAccount: z.string().min(5),
      declarationValue: z.number().positive().optional(),
      traderComplianceScore: z.number().min(0).max(1).optional(),
      isFirstPayment: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const available = await riskScorerAvailable();
      if (!available) {
        // Return a default LOW risk score when scorer is unavailable
        return {
          traderId: input.traderId,
          riskScore: 0.10,
          riskTier: "LOW",
          recommendedAction: "APPROVE",
          flags: ["SCORER_UNAVAILABLE: risk scorer offline — defaulting to LOW"],
          modelVersion: "fallback",
          scoredAt: new Date().toISOString(),
          _source: "fallback",
        };
      }

      const res = await fetch(`${PAYMENT_RISK_URL}/api/payment-risk/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trader_id: input.traderId,
          declaration_id: input.declarationId,
          amount: input.amount,
          currency: input.currency,
          fsp_id: input.fspId,
          fsp_type: input.fspType,
          payer_account: input.payerAccount,
          declaration_value: input.declarationValue,
          trader_compliance_score: input.traderComplianceScore,
          is_first_payment: input.isFirstPayment,
        }),
        signal: AbortSignal.timeout(5_000),
      });

      if (!res.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Payment risk scorer error: ${res.status}`,
        });
      }

      return res.json();
    }),

  /**
   * Post a bond/security deposit to TigerBeetle.
   * Debit: trader liability → Credit: security deposit account.
   */
  postBondDeposit: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      traderId: z.number().int().positive(),
      bondAmount: z.number().positive(),
      currency: z.string().length(3),
      bondType: z.enum(["import_bond", "transit_bond", "aeo_bond"]),
      expiryDate: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        return await createLedgerEntry({
          declarationId: input.declarationId,
          paymentId: null,
          entryType: "bond_deposit",
          debitAccountId: `trader-${input.traderId}-liability`,
          creditAccountId: `bond-${input.traderId}-${input.bondType}`,
          amountMinorUnits: Math.round(input.bondAmount * 100),
          tbTransferId: `TB-BOND-DEP-${input.declarationId}-${Date.now()}`,
          currency: input.currency,
          reference: `BOND-DEP-${input.declarationId}-${input.bondType}`,
          status: "posted",
          metadata: { bondType: input.bondType, expiryDate: input.expiryDate, _source: "db-ledger-fallback", _tag: "offline-stub" },
        });
      }
      return tbFetch<Record<string, unknown>>("/bond/deposit", {
        method: "POST",
        body: JSON.stringify({
          declaration_id: input.declarationId,
          trader_id: input.traderId,
          bond_amount: input.bondAmount,
          currency: input.currency,
          bond_type: input.bondType,
          expiry_date: input.expiryDate,
        }),
      });
    }),

  /**
   * Release a bond/security deposit back to the trader.
   * Debit: security deposit account → Credit: trader liability.
   */
  releaseBond: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      traderId: z.number().int().positive(),
      bondAmount: z.number().positive(),
      currency: z.string().length(3),
      bondType: z.enum(["import_bond", "transit_bond", "aeo_bond"]),
      releaseReason: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        return await createLedgerEntry({
          declarationId: input.declarationId,
          paymentId: null,
          entryType: "bond_release",
          debitAccountId: `bond-${input.traderId}-${input.bondType}`,
          creditAccountId: `trader-${input.traderId}-liability`,
          amountMinorUnits: Math.round(input.bondAmount * 100),
          tbTransferId: `TB-BOND-REL-${input.declarationId}-${Date.now()}`,
          currency: input.currency,
          reference: `BOND-REL-${input.declarationId}-${input.releaseReason}`,
          status: "posted",
          metadata: { bondType: input.bondType, releaseReason: input.releaseReason, _source: "db-ledger-fallback", _tag: "offline-stub" },
        });
      }
      return tbFetch<Record<string, unknown>>("/bond/release", {
        method: "POST",
        body: JSON.stringify({
          declaration_id: input.declarationId,
          trader_id: input.traderId,
          bond_amount: input.bondAmount,
          currency: input.currency,
          bond_type: input.bondType,
          release_reason: input.releaseReason,
        }),
      });
    }),

  /**
   * Post a penalty/fine to TigerBeetle.
   * Debit: trader liability → Credit: penalty revenue account.
   */
  postPenalty: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      traderId: z.number().int().positive(),
      penaltyAmount: z.number().positive(),
      currency: z.string().length(3),
      penaltyCode: z.enum(["UNDER_DECLARATION", "PROHIBITED_GOODS", "LATE_FILING", "MISDESCRIPTION", "SMUGGLING"]),
      officerId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        return await createLedgerEntry({
          declarationId: input.declarationId,
          paymentId: null,
          entryType: "penalty",
          debitAccountId: `trader-${input.traderId}-liability`,
          creditAccountId: `penalty-revenue-${input.penaltyCode}`,
          amountMinorUnits: Math.round(input.penaltyAmount * 100),
          tbTransferId: `TB-PENALTY-${input.declarationId}-${Date.now()}`,
          currency: input.currency,
          reference: `PENALTY-${input.declarationId}-${input.penaltyCode}`,
          status: "posted",
          metadata: { penaltyCode: input.penaltyCode, officerId: input.officerId, _source: "db-ledger-fallback", _tag: "offline-stub" },
        });
      }
      return tbFetch<Record<string, unknown>>("/penalty", {
        method: "POST",
        body: JSON.stringify({
          declaration_id: input.declarationId,
          trader_id: input.traderId,
          penalty_amount: input.penaltyAmount,
          currency: input.currency,
          penalty_code: input.penaltyCode,
          officer_id: input.officerId,
        }),
      });
    }),

  /**
   * Issue a transit guarantee to TigerBeetle (COMESA/ASEAN cross-border).
   * Debit: trader liability → Credit: transit guarantee account.
   */
  postTransitGuarantee: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      traderId: z.number().int().positive(),
      guaranteeAmount: z.number().positive(),
      currency: z.string().length(3),
      destinationCountry: z.string().length(2),
      transitDays: z.number().int().positive().max(365),
    }))
    .mutation(async ({ input }) => {
      const available = await tbBridgeAvailable();
      if (!available) {
        return await createLedgerEntry({
          declarationId: input.declarationId,
          paymentId: null,
          entryType: "adjustment", // closest existing type; schema will add transit_guarantee in v77
          debitAccountId: `trader-${input.traderId}-liability`,
          creditAccountId: `transit-guarantee-${input.traderId}-${input.destinationCountry}`,
          amountMinorUnits: Math.round(input.guaranteeAmount * 100),
          tbTransferId: `TB-TRANSIT-${input.declarationId}-${Date.now()}`,
          currency: input.currency,
          reference: `TRANSIT-${input.declarationId}-${input.destinationCountry}`,
          status: "posted",
          metadata: { destinationCountry: input.destinationCountry, transitDays: input.transitDays, _source: "db-ledger-fallback", _tag: "offline-stub" },
        });
      }
      return tbFetch<Record<string, unknown>>("/transit-guarantee", {
        method: "POST",
        body: JSON.stringify({
          declaration_id: input.declarationId,
          trader_id: input.traderId,
          guarantee_amount: input.guaranteeAmount,
          currency: input.currency,
          destination_country: input.destinationCountry,
          transit_days: input.transitDays,
        }),
      });
    }),

  /**
   * exportCSV — export ledger entries as CSV for Finance Officers.
   * Supports date range, entry type, and declaration filtering.
   */
  exportCSV: protectedProcedure
    .input(z.object({
      startDate: z.string().datetime({ offset: true }).optional(),
      endDate: z.string().datetime({ offset: true }).optional(),
      entryType: z.string().optional(),
      declarationId: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10000).default(5000),
    }))
    .mutation(async ({ ctx, input }) => {
      const allowedRoles = ["admin", "finance", "customs_officer"];
      if (!allowedRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Finance access required" });
      }
      const { getDb } = await import("../db");
      const { tigerBeetleLedgerEntries } = await import("../../drizzle/schema");
      const { and, gte, lte, eq, desc } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const conditions: ReturnType<typeof eq>[] = [];
      if (input.startDate) conditions.push(gte(tigerBeetleLedgerEntries.createdAt, new Date(input.startDate)) as any);
      if (input.endDate) conditions.push(lte(tigerBeetleLedgerEntries.createdAt, new Date(input.endDate)) as any);
      if (input.entryType) conditions.push(eq(tigerBeetleLedgerEntries.entryType, input.entryType as any));
      if (input.declarationId) conditions.push(eq(tigerBeetleLedgerEntries.declarationId, input.declarationId));
      const rows = await db
        .select()
        .from(tigerBeetleLedgerEntries)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(tigerBeetleLedgerEntries.createdAt))
        .limit(input.limit);
      const headers = [
        "ID", "TB Transfer ID", "Entry Type", "Status",
        "Debit Account", "Credit Account", "Amount (Minor Units)", "Currency",
        "Declaration ID", "Payment ID", "Reference", "Description",
        "Posted At", "Created At",
      ];
      const escape = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n")
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };
      const csvLines = [
        headers.join(","),
        ...rows.map((r) =>
          [
            r.id, r.tbTransferId, r.entryType, r.status,
            r.debitAccountId, r.creditAccountId, r.amountMinorUnits, r.currency,
            r.declarationId ?? "", r.paymentId ?? "", r.reference ?? "", r.description ?? "",
            r.postedAt ? new Date(r.postedAt).toISOString() : "",
            r.createdAt ? new Date(r.createdAt).toISOString() : "",
          ].map(escape).join(",")
        ),
      ];
      return {
        csv: csvLines.join("\n"),
        rowCount: rows.length,
        filename: `ledger-export-${new Date().toISOString().split("T")[0]}.csv`,
      };
    }),
});
