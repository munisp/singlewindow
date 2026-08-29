/**
 * ledger.ts — tRPC router for TigerBeetle double-entry ledger (Sprint 31)
 *
 * Proxies to the CANONICAL Go tigerbeetle-bridge service
 * (k8s Service `tigerbeetle-bridge`, HTTP /api/ledger/*, port 8086).
 *
 * Phase-6 remediation (SW-M7/SW-19):
 *   - Money mutations NEVER write a "posted" DB row for an unexecuted
 *     transfer. When the bridge is unavailable the mutation returns 503
 *     (SERVICE_UNAVAILABLE) so the caller can retry — no fabricated
 *     tbTransferIds, no phantom "posted" rows.
 *   - Money mutations are restricted to finance/admin/customs_officer roles
 *     (step-up control: callers must hold an explicit finance-scope role;
 *     ordinary authenticated users get 403).
 *   - Debit/credit accounts are validated against a server-side allowlist
 *     pattern — callers cannot post to arbitrary accounts.
 *   - Money is exact integer minor units; no parseFloat math.
 *   - Payment risk scorer outage defaults to REVIEW with a
 *     SCORING_UNAVAILABLE flag — never LOW/APPROVE.
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

// Canonical Go bridge: k8s Service `tigerbeetle-bridge`, /api/ledger/* dialect.
const TB_BRIDGE_URL = process.env.TB_BRIDGE_URL || "http://tigerbeetle-bridge:8086";
const PAYMENT_RISK_URL = process.env.PAYMENT_RISK_URL || "http://localhost:8092";

/** Roles allowed to mutate the ledger (step-up finance control, SW-M7). */
const FINANCE_MUTATION_ROLES = ["admin", "finance", "customs_officer"] as const;

function requireFinanceMutationRole(ctx: { user: { role: string } }): void {
  if (!(FINANCE_MUTATION_ROLES as readonly string[]).includes(ctx.user.role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Ledger mutations require a finance/admin/customs_officer role",
    });
  }
}

/**
 * Server-side account allowlist (SW-M7): ledger accounts must be platform
 * accounts or per-trader accounts of a known shape.
 */
const ACCOUNT_ALLOWLIST = /^(trader-\d{1,12}-(liability|bond|escrow|duty)|customs-duty-revenue|ncs-revenue|bond-\d{1,12}-(import_bond|transit_bond|aeo_bond)|penalty-revenue-[A-Z_]{2,32}|transit-guarantee-\d{1,12}-[A-Z]{2}|system:[a-z0-9-]{2,64})$/;

function assertAllowedAccount(accountId: string): void {
  if (!ACCOUNT_ALLOWLIST.test(accountId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Account '${accountId}' is not an allowed ledger account` });
  }
}

/** Exact decimal → integer minor units (no float money math). */
export function toMinorUnits(amount: string | number): number {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s) || s === "0" || s === "0.0" || s === "0.00") {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid monetary amount: ${s}` });
  }
  const [maj, frac = ""] = s.split(".");
  return Number(BigInt(maj) * 100n + BigInt((frac + "00").slice(0, 2)));
}

function bridgeUnavailable(): TRPCError {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "TigerBeetle bridge is unavailable — transfer NOT executed; retry later",
  });
}

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
      requireFinanceMutationRole(ctx);
      assertAllowedAccount(input.debitAccountId);
      assertAllowedAccount(input.creditAccountId);
      const amountMinorUnits = toMinorUnits(input.amount);

      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();

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
      const tbTransferId = (result as any).id;
      if (typeof tbTransferId !== "string" || tbTransferId.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Bridge did not return a transfer id — refusing to record an unverifiable entry",
        });
      }
      // Persist to DB for audit — ONLY with the real bridge transfer id.
      await createLedgerEntry({
        tbTransferId,
        debitAccountId: input.debitAccountId,
        creditAccountId: input.creditAccountId,
        amountMinorUnits,
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
        aggregateId: tbTransferId,
        payload: {
          debitAccountId: input.debitAccountId,
          creditAccountId: input.creditAccountId,
          amount: input.amount,
          amountMinorUnits,
          currency: input.currency,
          reference: input.reference ?? null,
          declarationId: input.declarationId ?? null,
          paymentId: input.paymentId ?? null,
          initiatedBy: ctx.user.id,
        },
      }).catch((e) => console.error("[Ledger] Kafka publish failed:", e));
      return result;
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
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      assertAllowedAccount(input.debitAccountId);
      assertAllowedAccount(input.creditAccountId);
      toMinorUnits(input.amount);
      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();
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
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();
      return tbFetch<Record<string, unknown>>(`/api/ledger/transfers/post/${input.pendingId}`, {
        method: "POST",
      });
    }),

  /**
   * Void a pending transfer (cancel the reservation).
   */
  voidPending: protectedProcedure
    .input(z.object({ pendingId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();
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
        // SW-19: fail safe — an unscored payment goes to manual REVIEW, never
        // LOW/APPROVE. The SCORING_UNAVAILABLE flag must be honoured downstream.
        return {
          traderId: input.traderId,
          riskScore: null,
          riskTier: "UNSCORED",
          recommendedAction: "REVIEW",
          flags: ["SCORING_UNAVAILABLE: risk scorer offline — payment requires manual review and must not be auto-approved"],
          modelVersion: "none",
          scoredAt: new Date().toISOString(),
          _source: "fail_closed",
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
      requireFinanceMutationRole(ctx);
      const debitAccountId = `trader-${input.traderId}-liability`;
      const creditAccountId = `bond-${input.traderId}-${input.bondType}`;
      assertAllowedAccount(debitAccountId);
      assertAllowedAccount(creditAccountId);
      const amountMinorUnits = toMinorUnits(input.bondAmount);

      const available = await tbBridgeAvailable();
      // SW-M7: NEVER record a "posted" bond deposit that was not executed.
      if (!available) throw bridgeUnavailable();

      const result = await tbFetch<Record<string, unknown>>("/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({
          debitAccountId,
          creditAccountId,
          amount: (amountMinorUnits / 100).toFixed(2),
          currency: input.currency,
          reference: `BOND-DEP-${input.declarationId}-${input.bondType}`,
          description: `Bond deposit (${input.bondType}) for declaration ${input.declarationId}`,
        }),
      });
      const tbTransferId = (result as any).id;
      if (typeof tbTransferId !== "string" || tbTransferId.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bridge did not return a transfer id" });
      }
      await createLedgerEntry({
        declarationId: input.declarationId,
        paymentId: null,
        entryType: "bond_deposit",
        debitAccountId,
        creditAccountId,
        amountMinorUnits,
        tbTransferId,
        currency: input.currency,
        reference: `BOND-DEP-${input.declarationId}-${input.bondType}`,
        status: "posted",
        metadata: { bondType: input.bondType, expiryDate: input.expiryDate },
        postedAt: new Date(),
      }).catch(e => console.warn("[Ledger] DB persist failed:", e));
      return result;
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
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      const debitAccountId = `bond-${input.traderId}-${input.bondType}`;
      const creditAccountId = `trader-${input.traderId}-liability`;
      assertAllowedAccount(debitAccountId);
      assertAllowedAccount(creditAccountId);
      const amountMinorUnits = toMinorUnits(input.bondAmount);

      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();

      const result = await tbFetch<Record<string, unknown>>("/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({
          debitAccountId,
          creditAccountId,
          amount: (amountMinorUnits / 100).toFixed(2),
          currency: input.currency,
          reference: `BOND-REL-${input.declarationId}-${input.releaseReason.slice(0, 40)}`,
          description: `Bond release (${input.bondType}) for declaration ${input.declarationId}: ${input.releaseReason}`,
        }),
      });
      const tbTransferId = (result as any).id;
      if (typeof tbTransferId !== "string" || tbTransferId.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bridge did not return a transfer id" });
      }
      await createLedgerEntry({
        declarationId: input.declarationId,
        paymentId: null,
        entryType: "bond_release",
        debitAccountId,
        creditAccountId,
        amountMinorUnits,
        tbTransferId,
        currency: input.currency,
        reference: `BOND-REL-${input.declarationId}-${input.releaseReason.slice(0, 40)}`,
        status: "posted",
        metadata: { bondType: input.bondType, releaseReason: input.releaseReason },
        postedAt: new Date(),
      }).catch(e => console.warn("[Ledger] DB persist failed:", e));
      return result;
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
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      // Officer identity comes from the verified token, never the request body.
      if (input.officerId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "officerId must match the authenticated officer" });
      }
      const debitAccountId = `trader-${input.traderId}-liability`;
      const creditAccountId = `penalty-revenue-${input.penaltyCode}`;
      assertAllowedAccount(debitAccountId);
      assertAllowedAccount(creditAccountId);
      const amountMinorUnits = toMinorUnits(input.penaltyAmount);

      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();

      const result = await tbFetch<Record<string, unknown>>("/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({
          debitAccountId,
          creditAccountId,
          amount: (amountMinorUnits / 100).toFixed(2),
          currency: input.currency,
          reference: `PENALTY-${input.declarationId}-${input.penaltyCode}`,
          description: `Penalty ${input.penaltyCode} on declaration ${input.declarationId} (officer ${ctx.user.id})`,
        }),
      });
      const tbTransferId = (result as any).id;
      if (typeof tbTransferId !== "string" || tbTransferId.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bridge did not return a transfer id" });
      }
      await createLedgerEntry({
        declarationId: input.declarationId,
        paymentId: null,
        entryType: "penalty",
        debitAccountId,
        creditAccountId,
        amountMinorUnits,
        tbTransferId,
        currency: input.currency,
        reference: `PENALTY-${input.declarationId}-${input.penaltyCode}`,
        status: "posted",
        metadata: { penaltyCode: input.penaltyCode, officerId: ctx.user.id },
        postedAt: new Date(),
      }).catch(e => console.warn("[Ledger] DB persist failed:", e));
      return result;
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
    .mutation(async ({ input, ctx }) => {
      requireFinanceMutationRole(ctx);
      const debitAccountId = `trader-${input.traderId}-liability`;
      const creditAccountId = `transit-guarantee-${input.traderId}-${input.destinationCountry}`;
      assertAllowedAccount(debitAccountId);
      assertAllowedAccount(creditAccountId);
      const amountMinorUnits = toMinorUnits(input.guaranteeAmount);

      const available = await tbBridgeAvailable();
      if (!available) throw bridgeUnavailable();

      const result = await tbFetch<Record<string, unknown>>("/api/ledger/transfers", {
        method: "POST",
        body: JSON.stringify({
          debitAccountId,
          creditAccountId,
          amount: (amountMinorUnits / 100).toFixed(2),
          currency: input.currency,
          reference: `TRANSIT-${input.declarationId}-${input.destinationCountry}`,
          description: `Transit guarantee for declaration ${input.declarationId} → ${input.destinationCountry} (${input.transitDays}d)`,
        }),
      });
      const tbTransferId = (result as any).id;
      if (typeof tbTransferId !== "string" || tbTransferId.length === 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Bridge did not return a transfer id" });
      }
      await createLedgerEntry({
        declarationId: input.declarationId,
        paymentId: null,
        entryType: "adjustment", // closest existing type; schema will add transit_guarantee in v77
        debitAccountId,
        creditAccountId,
        amountMinorUnits,
        tbTransferId,
        currency: input.currency,
        reference: `TRANSIT-${input.declarationId}-${input.destinationCountry}`,
        status: "posted",
        metadata: { destinationCountry: input.destinationCountry, transitDays: input.transitDays },
        postedAt: new Date(),
      }).catch(e => console.warn("[Ledger] DB persist failed:", e));
      return result;
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
