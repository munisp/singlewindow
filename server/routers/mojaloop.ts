/**
 * mojaloop.ts — tRPC router for Mojaloop payment integration (Sprint 30)
 *
 * Integrates with the Mojaloop payment switch for interoperable duty payments.
 * Supports bank transfers, mobile money (MTN, Vodafone, AirtelTigo), and
 * real-time settlement confirmation via ILP (Interledger Protocol).
 *
 * Sprint 30 enhancements:
 *   - All transactions persisted to mojaloop_transactions DB table
 *   - Webhook callback procedure for Mojaloop switch notifications
 *   - Audit events logged on initiation and settlement
 *   - TigerBeetle ledger entry created on COMMITTED status
 *   - Payment record updated when transfer is committed
 *
 * Procedures:
 *   mojaloop.getSupportedFSPs      — List available Financial Service Providers
 *   mojaloop.getExchangeRate       — Get current exchange rate for duty calculation
 *   mojaloop.initiatePayment       — Initiate a duty payment via Mojaloop
 *   mojaloop.getPaymentStatus      — Poll payment status (DB + live API)
 *   mojaloop.listTransactions      — List Mojaloop transactions for a declaration
 *   mojaloop.listMyTransactions    — List current user's transaction history
 *   mojaloop.webhookCallback       — Receive settlement callback from Mojaloop switch
 *   mojaloop.getIntegrationStatus  — Integration health and stats
 */

import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { paymentIdempotencyKeys } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getPaymentsByDeclaration,
  createMojaloopTransaction,
  getMojaloopTransactionByTransferId,
  updateMojaloopTransaction,
  getMojaloopTransactionsByDeclaration,
  getMojaloopTransactionsByUser,
  logAuditEvent,
  getDeclarationById,
} from "../db";

const MOJALOOP_URL = process.env.MOJALOOP_URL || "http://localhost:3003";
const MOJALOOP_API_KEY = process.env.MOJALOOP_API_KEY || "";
// Shared secret for verifying webhook callbacks from the Mojaloop switch

// ─── Mojaloop service client ───────────────────────────────────────────────

async function mojaloopAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${MOJALOOP_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Supported Financial Service Providers ─────────────────────────────────

const SUPPORTED_FSPS = [
  {
    fspId: "GCB_BANK",
    name: "Ghana Commercial Bank",
    type: "BANK",
    currency: "GHS",
    logo: "gcb",
    active: true,
    minAmount: 1,
    maxAmount: 10_000_000,
  },
  {
    fspId: "ECOBANK_GH",
    name: "Ecobank Ghana",
    type: "BANK",
    currency: "GHS",
    logo: "ecobank",
    active: true,
    minAmount: 1,
    maxAmount: 10_000_000,
  },
  {
    fspId: "STANBIC_GH",
    name: "Stanbic Bank Ghana",
    type: "BANK",
    currency: "GHS",
    logo: "stanbic",
    active: true,
    minAmount: 1,
    maxAmount: 10_000_000,
  },
  {
    fspId: "MTN_MOMO",
    name: "MTN Mobile Money",
    type: "MOBILE_MONEY",
    currency: "GHS",
    logo: "mtn",
    active: true,
    minAmount: 1,
    maxAmount: 50_000,
  },
  {
    fspId: "VODAFONE_CASH",
    name: "Vodafone Cash",
    type: "MOBILE_MONEY",
    currency: "GHS",
    logo: "vodafone",
    active: true,
    minAmount: 1,
    maxAmount: 50_000,
  },
  {
    fspId: "AIRTELTIGO_MONEY",
    name: "AirtelTigo Money",
    type: "MOBILE_MONEY",
    currency: "GHS",
    logo: "airteltigo",
    active: true,
    minAmount: 1,
    maxAmount: 30_000,
  },
  {
    fspId: "CENTRAL_BANK",
    name: "Bank of Ghana (RTGS)",
    type: "RTGS",
    currency: "GHS",
    logo: "bog",
    active: true,
    minAmount: 100_000,
    maxAmount: 999_999_999,
  },
] as const;

type FspType = "BANK" | "MOBILE_MONEY" | "RTGS";

// ─── ILP helpers ──────────────────────────────────────────────────────────

function generateILPPacket(): string {
  return Buffer.from(JSON.stringify({
    amount: 500000,
    account: `g.gh.customs.${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`,
    data: Buffer.from("TradeGateway Duty Payment").toString("base64"),
  })).toString("base64");
}

function generateCondition(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: 43 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ─── TigerBeetle account IDs ───────────────────────────────────────────────
// In production these would be fetched from the TB bridge service.
// For simulation, we use fixed account IDs for the customs authority ledger.


// ─── Router ───────────────────────────────────────────────────────────────

export const mojaloopRouter = router({
  /**
   * List all Financial Service Providers available for duty payment.
   */
  getSupportedFSPs: protectedProcedure.query(() => {
    return SUPPORTED_FSPS;
  }),

  /**
   * Get current exchange rate for duty calculation.
   * In production, this would query the Bank of Ghana API.
   */
  getExchangeRate: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3).default("GHS"),
    }))
    .query(async ({ input }) => {
      const rates: Record<string, number> = {
        "USD_GHS": 15.42,
        "EUR_GHS": 16.85,
        "GBP_GHS": 19.23,
        "CNY_GHS": 2.12,
        "JPY_GHS": 0.103,
        "GHS_GHS": 1.0,
      };

      const key = `${input.fromCurrency}_${input.toCurrency}`;
      const rate = rates[key];

      if (!rate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Exchange rate not available for ${input.fromCurrency}/${input.toCurrency}`,
        });
      }
      return {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate,
        source: "Bank of Ghana (simulated)",
        timestamp: Date.now(),
        validUntilMs: Date.now() + 300_000,
      };
    }),

  /**
   * Initiate a duty payment via the Mojaloop payment switch.
   * Persists a mojaloop_transactions record and logs an audit event.
   */
  initiatePayment: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      amount: z.number().positive(),
      currency: z.string().length(3).default("GHS"),
      fspId: z.string().min(1),
      payerAccount: z.string().min(5).describe("Bank account number or mobile money number"),
      payerName: z.string().min(2),
      paymentNote: z.string().max(128).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      const privileged = ["admin", "customs_officer", "finance", "oga_officer"].includes(ctx.user.role);
      if (!privileged && decl.traderId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not own this declaration" });
      }
      const payableAmount = Number(decl.totalDue);
      if (!Number.isFinite(payableAmount) || payableAmount <= 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Declaration has no payable amount" });
      }
      if (Math.abs(input.amount - payableAmount) > 0.005) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Payment amount does not match declaration total due" });
      }
      const fsp = SUPPORTED_FSPS.find(f => f.fspId === input.fspId);
      if (!fsp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown FSP: ${input.fspId}` });
      }
      const declarationCurrency = decl.invoiceCurrency ?? input.currency;
      if (input.currency !== declarationCurrency || declarationCurrency !== fsp.currency) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Declaration is denominated in ${declarationCurrency}, but ${fsp.name} settles in ${fsp.currency}; FX conversion is required and not implemented.`,
        });
      }
      if (!fsp.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `FSP ${fsp.name} is currently unavailable` });
      }
      if (payableAmount < fsp.minAmount || payableAmount > fsp.maxAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Amount must be between ${fsp.minAmount} and ${fsp.maxAmount} ${fsp.currency} for ${fsp.name}`,
        });
      }

      // ── Idempotency check (1B payments/day pattern) ─────────────────────────
      // Hash: userId + declarationId + amount + currency + fspId + payerAccount
      const idempotencyInput = `${ctx.user.id}:${input.declarationId}:${payableAmount}:${input.currency}:${input.fspId}:${input.payerAccount}`;
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(idempotencyInput));
      const keyHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
      const idemDb = await getDb();
      if (idemDb) {
        const [existingKey] = await idemDb.select().from(paymentIdempotencyKeys).where(eq(paymentIdempotencyKeys.keyHash, keyHash)).limit(1);
        if (existingKey) {
          const cached = existingKey.responseSnapshot as Record<string, unknown> | null;
          throw new TRPCError({
            code: "CONFLICT",
            message: `Duplicate payment detected. Transfer ${cached?.transferId ?? "unknown"} already initiated for this declaration/amount/FSP combination within 24 hours. Use the existing transfer ID to check status.`,
          });
        }
      }
      // ─────────────────────────────────────────────────────────────────────────
      const transferId = `TRF-${Date.now()}-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
      const ilpPacket = generateILPPacket();
      const condition = generateCondition();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      // Persist to DB
      const txRecord = await createMojaloopTransaction({
        transferId,
        declarationId: input.declarationId,
        initiatedBy: ctx.user.id,
        fspId: input.fspId,
        fspName: fsp.name,
        fspType: fsp.type as FspType,
        payerAccount: input.payerAccount,
        payerName: input.payerName,
        amount: payableAmount.toString(),
        currency: input.currency,
        status: "PENDING",
        ilpPacket,
        condition,
        paymentNote: input.paymentNote ?? null,
        expiresAt,
      });

      // Store idempotency key so duplicate submissions within 24h are rejected
      if (idemDb) {
        const idemExpiresAt = new Date(Date.now() + 86_400_000);
        await idemDb.insert(paymentIdempotencyKeys).values({
          keyHash,
          transferId,
          responseSnapshot: { transferId, queueId: txRecord.id, status: "PENDING" },
          expiresAt: idemExpiresAt,
        }).onConflictDoNothing();
      }
      // Log audit event
      await logAuditEvent({
        entityType: "payment",
        entityId: txRecord?.id ?? 0,
        action: "mojaloop_payment_initiated",
        actorId: ctx.user.id,
        actorType: "trader",
        newState: { transferId, fspId: input.fspId, amount: payableAmount, currency: input.currency },
      });

      // Forward to live Mojaloop switch if available
      const available = await mojaloopAvailable();
      if (!available) {
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Mojaloop switch is unavailable" });
      }
      try {
        const response = await fetch(`${MOJALOOP_URL}/transfers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${MOJALOOP_API_KEY}`,
            "FSPIOP-Source": "CUSTOMS_AUTHORITY",
            "FSPIOP-Destination": input.fspId,
          },
          body: JSON.stringify({
            transferId,
            payerFsp: input.fspId,
            payeeFsp: "CUSTOMS_AUTHORITY",
            amount: { amount: payableAmount.toString(), currency: input.currency },
            ilpPacket,
            condition,
            expiration: expiresAt.toISOString(),
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => response.statusText);
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: `Mojaloop transfer rejected (${response.status}): ${detail}` });
        }
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Mojaloop transfer request failed" });
      }

      return {
        transferId,
        status: "PENDING",
        amount: payableAmount,
        currency: input.currency,
        fspName: fsp.name,
        fspType: fsp.type,
        ilpPacket,
        condition,
        expiresAt: expiresAt.toISOString(),
        paymentInstructions: fsp.type === "MOBILE_MONEY"
          ? `Approve the payment request on your ${fsp.name} app or dial *170# to complete payment.`
          : `Transfer ${payableAmount} ${input.currency} to account: CUSTOMS-DUTY-${input.declarationId} at ${fsp.name}.`,
      };
    }),

  /**
   * Get the current status of a Mojaloop payment transfer.
   * Reads the persisted transfer state without mutating it.
   */
  getPaymentStatus: protectedProcedure
    .input(z.object({ transferId: z.string() }))
    .query(async ({ ctx, input }) => {
      const privileged = ["admin", "customs_officer", "finance", "oga_officer"].includes(ctx.user.role);
      // Try DB first
      const dbRecord = await getMojaloopTransactionByTransferId(input.transferId);

      if (!dbRecord) {
        // An ordinary caller cannot establish ownership of a transfer that is
        // not present in this application's transaction store.
        if (!privileged) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
        }
        // Try live Mojaloop API
        const available = await mojaloopAvailable();
        if (available) {
          try {
            const res = await fetch(`${MOJALOOP_URL}/transfers/${input.transferId}`, {
              headers: { "Authorization": `Bearer ${MOJALOOP_API_KEY}` },
              signal: AbortSignal.timeout(5_000),
            });
            if (res.ok) return res.json();
          } catch { /* fall through */ }
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      }

      if (!privileged && dbRecord.initiatedBy !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      return {
        transferId: input.transferId,
        status: dbRecord.status,
        amount: Number(dbRecord.amount),
        currency: dbRecord.currency,
        fspId: dbRecord.fspId,
        fspName: dbRecord.fspName,
        fspType: dbRecord.fspType,
        payerAccount: dbRecord.payerAccount,
        createdAt: dbRecord.createdAt.toISOString(),
        committedAt: dbRecord.committedAt?.toISOString() ?? null,
        ilpPacket: dbRecord.ilpPacket,
        condition: dbRecord.condition,
        fulfilment: dbRecord.fulfilment ?? null,
        isSettled: dbRecord.status === "COMMITTED",
        isFailed: dbRecord.status === "ABORTED",
        paymentInstructions: dbRecord.fspType === "MOBILE_MONEY"
          ? `Approve the payment request on your ${dbRecord.fspName} app or dial *170# to complete payment.`
          : `Transfer to account: CUSTOMS-DUTY-${dbRecord.declarationId} at ${dbRecord.fspName}.`,
      };
    }),

  /**
   * List all Mojaloop transactions for a specific declaration.
   */
  listTransactions: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getMojaloopTransactionsByDeclaration(input.declarationId);
    }),

  /**
   * List the current user's Mojaloop transaction history.
   */
  listMyTransactions: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      return getMojaloopTransactionsByUser(ctx.user.id, input.limit);
    }),

  /**
   * Legacy: list payments from the payments table for a declaration.
   */
  listPayments: protectedProcedure
    .input(z.object({ declarationId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getPaymentsByDeclaration(input.declarationId);
    }),

  /**
   * Get a summary of the Mojaloop integration status and recent transactions.
   */
  getIntegrationStatus: protectedProcedure.query(async () => {
    const available = await mojaloopAvailable();

    return {
      connected: available,
      mode: available ? "LIVE" : "UNAVAILABLE",
      switchUrl: MOJALOOP_URL,
      supportedFSPs: SUPPORTED_FSPS.filter(f => f.active).length,
      ilpVersion: "v4",
      isoStandard: "ISO 20022",
      settlementModel: "DEFERRED_NET",
    };
  }),
});
