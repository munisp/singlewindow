/**
 * mojaloop.ts — tRPC router for Mojaloop payment integration (Sprint 30)
 *
 * Integrates with the Mojaloop payment switch for interoperable duty payments.
 * Supports bank transfers, mobile money (MTN, Vodafone, AirtelTigo), and
 * real-time settlement confirmation via ILP (Interledger Protocol).
 *
 * Phase-6 remediation (SW-M1, SW-10):
 *   - Status reads are SIDE-EFFECT FREE. Settlement state only ever changes
 *     via the authenticated switch webhook (webhookCallback). No simulated
 *     state progression exists anywhere in this module.
 *   - Webhook authentication is HMAC-SHA256 (timing-safe) via the
 *     X-Mojaloop-Signature header. There is NO default webhook secret in
 *     production — the process refuses to boot without one.
 *   - COMMITTED callbacks must present a fulfilment whose SHA-256 matches the
 *     condition stored at initiation (ILP v4 semantics).
 *   - Amounts are server-authoritative (declaration.totalDue), never caller
 *     supplied, and are handled as integer minor units.
 *   - Webhook events are deduplicated by event id and by terminal state, so
 *     replays never mint duplicate ledger entries.
 *
 * Procedures:
 *   mojaloop.getSupportedFSPs      — List available Financial Service Providers
 *   mojaloop.getExchangeRate       — Get current exchange rate for duty calculation
 *   mojaloop.initiatePayment       — Initiate a duty payment via Mojaloop
 *   mojaloop.getPaymentStatus      — Poll payment status (read-only)
 *   mojaloop.listTransactions      — List Mojaloop transactions for a declaration
 *   mojaloop.listMyTransactions    — List current user's transaction history
 *   mojaloop.webhookCallback       — Receive settlement callback from Mojaloop switch
 *   mojaloop.getIntegrationStatus  — Integration health and stats
 */

import { TRPCError } from "@trpc/server";
import nodeCrypto from "crypto";
import { getDb } from "../db";
import { fetchWithResilience } from "../_core/middlewareClients";
import { getServiceAuthHeaders } from "../_core/serviceAuth";
import { SpanKind as OtelSpanKind } from "@opentelemetry/api";
import { withSpan as withOtelSpan, injectKafkaHeaders as injectOtelHeaders } from "../_core/telemetry";
import { paymentIdempotencyKeys } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import {
  getPaymentsByDeclaration,
  createMojaloopTransaction,
  getMojaloopTransactionByTransferId,
  updateMojaloopTransaction,
  getMojaloopTransactionsByDeclaration,
  getMojaloopTransactionsByUser,
  getDeclarationById,
  logAuditEvent,
  createLedgerEntry,
} from "../db";

// Fail-closed (phase-10 audit remediation, finding C-3): no deployed
// mojaloop-hub service exists; the previous localhost:3003 literal diverged
// from env.ts (3001) and compose. MOJALOOP_URL must be set explicitly or the
// switch integration reports MOJALOOP_UNCONFIGURED and stays OFFLINE.
const MOJALOOP_URL = process.env.MOJALOOP_URL ?? "";
const MOJALOOP_API_KEY = process.env.MOJALOOP_API_KEY || "";
// Canonical TigerBeetle bridge (Go service, /api/ledger/* dialect).
const TB_BRIDGE_URL = process.env.TB_BRIDGE_URL || "http://tigerbeetle-bridge:8086";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * SW-10: no default webhook secret in production — refuse to boot.
 * In non-production a clearly-labelled dev secret is tolerated so local
 * development and tests can compute signatures.
 */
function loadWebhookSecret(): string {
  const secret = process.env.MOJALOOP_WEBHOOK_SECRET;
  const weak = !secret || secret.length < 32 || secret.toLowerCase().includes("dev-webhook-secret");
  if (weak && IS_PRODUCTION) {
    throw new Error(
      "[Mojaloop] FATAL: MOJALOOP_WEBHOOK_SECRET must be set to a strong (>= 32 char), " +
      "non-default value when NODE_ENV=production. Refusing to boot."
    );
  }
  if (weak) {
    console.warn("[Mojaloop] MOJALOOP_WEBHOOK_SECRET not set — using dev-only secret. DO NOT use in production.");
    return "dev-webhook-secret";
  }
  return secret;
}
const MOJALOOP_WEBHOOK_SECRET = loadWebhookSecret();

// ─── Mojaloop service client ───────────────────────────────────────────────

async function mojaloopAvailable(): Promise<boolean> {
  if (!MOJALOOP_URL) return false; // MOJALOOP_UNCONFIGURED — fail closed
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

// ─── Money helpers (integer minor units — no float money math) ──────────────

/**
 * Converts a decimal string/number (major units, max 2dp) to integer minor
 * units using exact decimal arithmetic. Throws on invalid input.
 */
export function toMinorUnits(amount: string | number): number {
  const s = String(amount).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid monetary amount: ${s}` });
  }
  const [maj, frac = ""] = s.split(".");
  return Number(BigInt(maj) * 100n + BigInt((frac + "00").slice(0, 2)));
}

function minorToMajorString(minor: number): string {
  return (minor / 100).toFixed(2);
}

// ─── ILP helpers (SW-10/SW-M15: CSPRNG preimage, derived condition) ─────────

/** Generates a 32-byte CSPRNG preimage (server-side secret). */
export function generateIlpPreimage(): Buffer {
  return nodeCrypto.randomBytes(32);
}

/** ILP condition = base64url(SHA-256(preimage)). */
export function ilpConditionFromPreimage(preimage: Buffer): string {
  return nodeCrypto.createHash("sha256").update(preimage).digest("base64url");
}

/**
 * Verifies a presented fulfilment against a stored condition:
 * base64url-decode the fulfilment and check SHA-256(preimage) == condition.
 * Timing-safe comparison.
 */
export function verifyIlpFulfilment(fulfilmentB64: string, conditionB64: string): boolean {
  try {
    const preimage = Buffer.from(fulfilmentB64, "base64url");
    if (preimage.length !== 32) return false;
    const computed = nodeCrypto.createHash("sha256").update(preimage).digest();
    const expected = Buffer.from(conditionB64, "base64url");
    return computed.length === expected.length && nodeCrypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

/** Builds an ILP Prepare packet payload with the REAL amount and destination. */
function buildILPPacket(amountMinorUnits: number, destinationAccount: string, data: string): string {
  return Buffer.from(JSON.stringify({
    amount: amountMinorUnits.toString(),
    account: destinationAccount,
    data: Buffer.from(data).toString("base64"),
  })).toString("base64");
}

// ─── Webhook signature helpers ───────────────────────────────────────────────

/** Canonical string that the switch signs for a webhook callback. */
export function webhookSigningPayload(parts: {
  transferId: string;
  transferState: string;
  fulfilment?: string;
  completedTimestamp?: string;
  eventId?: string;
}): string {
  return [
    parts.transferId,
    parts.transferState,
    parts.fulfilment ?? "",
    parts.completedTimestamp ?? "",
    parts.eventId ?? "",
  ].join(".");
}

export function computeWebhookSignature(payload: string, secret: string = MOJALOOP_WEBHOOK_SECRET): string {
  return nodeCrypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Timing-safe verification of the X-Mojaloop-Signature header. */
export function verifyWebhookSignature(payload: string, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  const provided = signatureHeader.replace(/^sha256=/, "");
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  const expected = computeWebhookSignature(payload);
  try {
    return nodeCrypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

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
   * Live rates from the ECB eurofxref-daily feed only — the previous hardcoded
   * "Bank of Ghana (simulated)" rate table was removed (phase-10 audit
   * remediation, finding B-4). Fails closed with FX_RATE_UNAVAILABLE when the
   * live feed is unreachable or does not publish the pair.
   */
  getExchangeRate: protectedProcedure
    .input(z.object({
      fromCurrency: z.string().length(3),
      toCurrency: z.string().length(3).default("GHS"),
    }))
    .query(async ({ input }) => {
      const { getLiveExchangeRate } = await import("../businessRules");
      let rate: number;
      try {
        rate = await getLiveExchangeRate(input.fromCurrency, input.toCurrency);
      } catch (err) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: `FX_RATE_UNAVAILABLE: no live exchange rate for ${input.fromCurrency}/${input.toCurrency} (${err instanceof Error ? err.message : String(err)}) — fail-closed, no hardcoded rates are served`,
        });
      }

      return {
        fromCurrency: input.fromCurrency,
        toCurrency: input.toCurrency,
        rate,
        source: "ECB eurofxref-daily (live)",
        timestamp: Date.now(),
        validUntilMs: Date.now() + 300_000,
      };
    }),

  /**
   * Initiate a duty payment via the Mojaloop payment switch.
   * The amount is SERVER-AUTHORITATIVE: it is read from the declaration's
   * assessed totalDue, never from the request body. Persists a
   * mojaloop_transactions record and logs an audit event.
   */
  initiatePayment: protectedProcedure
    .input(z.object({
      declarationId: z.number().int().positive(),
      // Optional caller expectation — validated against the server-authoritative
      // amount. A mismatch is rejected; it is NEVER used as the transfer amount.
      amount: z.number().positive().optional(),
      currency: z.string().length(3).default("GHS"),
      fspId: z.string().min(1),
      payerAccount: z.string().min(5).describe("Bank account number or mobile money number"),
      payerName: z.string().min(2),
      paymentNote: z.string().max(128).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const fsp = SUPPORTED_FSPS.find(f => f.fspId === input.fspId);
      if (!fsp) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown FSP: ${input.fspId}` });
      }
      if (!fsp.active) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `FSP ${fsp.name} is currently unavailable` });
      }

      // ── Server-authoritative amount (SW-10) ──────────────────────────────
      const decl = await getDeclarationById(input.declarationId);
      if (!decl) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Declaration not found" });
      }
      const officerRoles = ["admin", "customs_officer", "finance"];
      if (decl.traderId !== ctx.user.id && !officerRoles.includes(ctx.user.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only pay for your own declarations" });
      }
      if (!decl.totalDue || Number(decl.totalDue) <= 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Declaration has no assessed amount due. An assessment must exist before payment can be initiated.",
        });
      }
      // SW-17: an unverified flat-rate estimate is not a payable amount in production.
      // PRA-100: the authoritative path is declarations.assessDuty (tariff engine);
      // a TARIFF_ENGINE_VERIFIED assessment clears this gate.
      const explanation = (decl as { aiExplanation?: Record<string, unknown> | null }).aiExplanation;
      if (IS_PRODUCTION && explanation && (explanation as any).dutyAssessment === "ESTIMATE_UNVERIFIED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Duty amount is an unverified estimate. Run declarations.assessDuty to obtain an authoritative tariff-engine assessment before payment.",
        });
      }

      const amountMinorUnits = toMinorUnits(decl.totalDue);
      const amountMajor = Number(minorToMajorString(amountMinorUnits));

      if (input.amount !== undefined && Math.abs(input.amount - amountMajor) > 0.005) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Amount mismatch: declaration total due is ${amountMajor.toFixed(2)} ${decl.invoiceCurrency ?? input.currency}. Refresh and retry.`,
        });
      }
      if (amountMajor < fsp.minAmount || amountMajor > fsp.maxAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Amount must be between ${fsp.minAmount} and ${fsp.maxAmount} ${fsp.currency} for ${fsp.name}`,
        });
      }

      // ── Idempotency check (1B payments/day pattern) ─────────────────────────
      const idempotencyInput = `${ctx.user.id}:${input.declarationId}:${amountMinorUnits}:${input.currency}:${input.fspId}:${input.payerAccount}`;
      const keyHash = await sha256Hex(idempotencyInput);
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
      const transferId = `TRF-${Date.now()}-${nodeCrypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;

      // SW-10/SW-M15: CSPRNG preimage, derived condition. The preimage is stored
      // server-side ONLY (in the fulfilment column) and is never returned to the
      // client. It is revealed to the switch only at execution time.
      const preimage = generateIlpPreimage();
      const condition = ilpConditionFromPreimage(preimage);
      const fulfilmentPreimage = preimage.toString("base64url");
      const ilpPacket = buildILPPacket(
        amountMinorUnits,
        `g.gh.customs.declaration-${input.declarationId}`,
        `TradeGateway Duty Payment ${decl.declarationNumber ?? input.declarationId}`,
      );
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
        amount: minorToMajorString(amountMinorUnits),
        currency: input.currency,
        status: "PENDING",
        ilpPacket,
        condition,
        fulfilment: fulfilmentPreimage,
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
        newState: { transferId, fspId: input.fspId, amountMinorUnits, currency: input.currency },
      });

      // Forward to live Mojaloop switch. If the switch is unreachable the
      // transfer stays PENDING and the caller is told honestly — no simulated
      // progression will ever move it forward.
      const available = await mojaloopAvailable();
      if (available) {
        try {
          // P0-7: money-movement calls go through the resilience wrapper
          // (timeout + retry + circuit breaker) — a raw fetch without a
          // timeout can hang a payment request indefinitely.
          // Phase-7 OTel: FSPIOP client span per transfer call; the FSPIOP
          // correlation ID (transferId) is a span attribute, and traceparent is
          // propagated to the switch via the fetch headers.
          const transferHeaders: Record<string, string> = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${MOJALOOP_API_KEY}`,
            "FSPIOP-Source": "CUSTOMS_AUTHORITY",
            "FSPIOP-Destination": input.fspId,
          };
          injectOtelHeaders(transferHeaders);
          await withOtelSpan(
            "mojaloop.transfers.prepare",
            {
              kind: OtelSpanKind.CLIENT,
              attributes: {
                "mojaloop.correlation_id": transferId,
                "fspiop.source": "CUSTOMS_AUTHORITY",
                "fspiop.destination": input.fspId,
                "payment.amount_minor_units": amountMinorUnits,
                "payment.currency": input.currency,
              },
            },
            () => fetchWithResilience(`${MOJALOOP_URL}/transfers`, {
              method: "POST",
              timeoutMs: 10_000,
              headers: transferHeaders,
              body: JSON.stringify({
                transferId,
                payerFsp: input.fspId,
                payeeFsp: "CUSTOMS_AUTHORITY",
                amount: { amount: minorToMajorString(amountMinorUnits), currency: input.currency },
                ilpPacket,
                condition,
                expiration: expiresAt.toISOString(),
              }),
            }, "mojaloop-switch")
          );
        } catch (e) {
          console.warn(`[Mojaloop] Transfer request to switch failed: ${e}. Transfer remains PENDING.`);
        }
      }

      return {
        transferId,
        status: "PENDING",
        amount: amountMajor,
        amountMinorUnits,
        currency: input.currency,
        fspName: fsp.name,
        fspType: fsp.type,
        ilpPacket,
        condition,
        expiresAt: expiresAt.toISOString(),
        paymentInstructions: fsp.type === "MOBILE_MONEY"
          ? `Approve the payment request on your ${fsp.name} app or dial *170# to complete payment.`
          : `Transfer ${amountMajor.toFixed(2)} ${input.currency} to account: CUSTOMS-DUTY-${input.declarationId} at ${fsp.name}.`,
        switchReachable: available,
      };
    }),

  /**
   * Get the current status of a Mojaloop payment transfer.
   * SIDE-EFFECT FREE (SW-M1): this query never mutates the transfer, never
   * fabricates a fulfilment, and never writes ledger or audit rows. Settlement
   * state advances only via the authenticated switch webhook.
   */
  getPaymentStatus: protectedProcedure
    .input(z.object({ transferId: z.string() }))
    .query(async ({ input }) => {
      // Try DB first
      const dbRecord = await getMojaloopTransactionByTransferId(input.transferId);

      if (!dbRecord) {
        // Try live Mojaloop API
        const available = await mojaloopAvailable();
        if (available) {
          try {
            const statusHeaders: Record<string, string> = { "Authorization": `Bearer ${MOJALOOP_API_KEY}` };
            injectOtelHeaders(statusHeaders);
            const res = await withOtelSpan(
              "mojaloop.transfers.status",
              {
                kind: OtelSpanKind.CLIENT,
                attributes: { "mojaloop.correlation_id": input.transferId },
              },
              () => fetch(`${MOJALOOP_URL}/transfers/${input.transferId}`, {
                headers: statusHeaders,
                signal: AbortSignal.timeout(5_000),
              })
            );
            if (res.ok) return res.json();
          } catch { /* fall through */ }
        }
        throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      }

      const status = dbRecord.status;

      return {
        transferId: input.transferId,
        status,
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
        // The fulfilment preimage is only ever disclosed after the switch has
        // committed the transfer. Before that it stays server-side.
        fulfilment: status === "COMMITTED" ? dbRecord.fulfilment ?? null : null,
        isSettled: status === "COMMITTED",
        isFailed: status === "ABORTED",
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
   * Webhook callback from the Mojaloop switch.
   *
   * Authentication (SW-10): HMAC-SHA256 signature in the X-Mojaloop-Signature
   * header over the canonical payload, verified timing-safe against
   * MOJALOOP_WEBHOOK_SECRET (no production default — boot-fatal).
   *
   * Verification: a COMMITTED callback must carry a fulfilment whose SHA-256
   * matches the condition stored at initiation (ILP v4).
   *
   * Idempotency: event ids are deduplicated via the payment_idempotency_keys
   * table, and a COMMITTED replay on an already-COMMITTED transfer is a no-op —
   * replays never mint a second ledger entry.
   */
  webhookCallback: publicProcedure
    .input(z.object({
      transferId: z.string(),
      transferState: z.enum(["RECEIVED", "RESERVED", "COMMITTED", "ABORTED"]),
      fulfilment: z.string().optional(),
      completedTimestamp: z.string().optional(),
      eventId: z.string().max(128).optional(),
      errorInformation: z.object({
        errorCode: z.string(),
        errorDescription: z.string(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // ── Verify HMAC signature (timing-safe, from header — never the body) ──
      const signatureHeader = (ctx as any).req?.headers?.["x-mojaloop-signature"] as string | undefined;
      const signingPayload = webhookSigningPayload(input);
      if (!verifyWebhookSignature(signingPayload, signatureHeader)) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid or missing webhook signature" });
      }

      // ── Event-id replay dedupe ────────────────────────────────────────────
      const db = await getDb();
      if (input.eventId && db) {
        const eventHash = await sha256Hex(`mojaloop-webhook:${input.eventId}`);
        const [seen] = await db.select().from(paymentIdempotencyKeys)
          .where(eq(paymentIdempotencyKeys.keyHash, eventHash)).limit(1);
        if (seen) {
          return { success: true, transferId: input.transferId, idempotentReplay: true };
        }
      }

      const tx = await getMojaloopTransactionByTransferId(input.transferId);
      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transfer not found" });
      }

      // Terminal-state replay dedupe: a second COMMITTED never mints a second
      // ledger entry.
      if (tx.status === "COMMITTED" && input.transferState === "COMMITTED") {
        return { success: true, transferId: input.transferId, newStatus: "COMMITTED", idempotentReplay: true };
      }
      if (tx.status === "COMMITTED" || tx.status === "ABORTED") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Transfer ${input.transferId} is already in terminal state ${tx.status}`,
        });
      }

      const updateData: Record<string, unknown> = {
        status: input.transferState,
        webhookPayload: input,
      };

      if (input.transferState === "COMMITTED") {
        // ── ILP fulfilment verification (SW-10) ──────────────────────────────
        if (!input.fulfilment || !tx.condition || !verifyIlpFulfilment(input.fulfilment, tx.condition)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Fulfilment does not satisfy the transfer condition",
          });
        }

        updateData.fulfilment = input.fulfilment;
        updateData.committedAt = input.completedTimestamp
          ? new Date(input.completedTimestamp)
          : new Date();

        // ── Post the settlement to the canonical TigerBeetle bridge ─────────
        // No fabricated transfer ids: the ledger row is written only with the
        // id returned by the bridge. If the bridge is down we return 503 so the
        // switch retries — the mirror is never written for an unexecuted post.
        const amountMinorUnits = toMinorUnits(tx.amount as unknown as string);
        // PRA-012: authenticated service-to-service hop (fail closed when
        // unconfigured); PRA-024/025: timeout + backoff/jitter + breaker.
        const bridgeAuth = await getServiceAuthHeaders();
        const bridgeRes = await fetchWithResilience(
          `${TB_BRIDGE_URL}/api/ledger/transfers`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bridgeAuth },
            body: JSON.stringify({
              debitAccountId: `trader-${tx.initiatedBy}-liability`,
              creditAccountId: "customs-duty-revenue",
              amount: minorToMajorString(amountMinorUnits),
              currency: tx.currency,
              reference: `DUTY-${tx.declarationId ?? "N/A"}`,
              description: `Duty payment settled via Mojaloop (${input.transferId})`,
            }),
            timeoutMs: 10_000,
          },
          "tigerbeetle-bridge"
        ).catch(() => null);

        if (!bridgeRes || !bridgeRes.ok) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "Ledger bridge unavailable — settlement not recorded; switch should retry the callback",
          });
        }
        const bridgeBody = await bridgeRes.json().catch(() => ({})) as Record<string, unknown>;
        const tbTransferId = typeof bridgeBody.id === "string" && bridgeBody.id.length > 0 && bridgeBody.id.length <= 40
          ? bridgeBody.id
          : null;
        if (!tbTransferId) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "Ledger bridge did not return a transfer id — settlement not recorded; switch should retry",
          });
        }

        await createLedgerEntry({
          tbTransferId,
          debitAccountId: `trader-${tx.initiatedBy}-liability`,
          creditAccountId: "customs-duty-revenue",
          amountMinorUnits,
          currency: tx.currency,
          ledger: 1,
          entryType: "duty_payment",
          status: "posted",
          declarationId: tx.declarationId ?? undefined,
          mojaloopTransferId: input.transferId,
          reference: `DUTY-${tx.declarationId ?? "N/A"}`,
          description: `Duty payment settled via Mojaloop webhook (${input.transferId})`,
          postedAt: new Date(),
        }).catch(e => console.warn("[TigerBeetle] Webhook ledger mirror failed:", e));

        // Log audit event
        await logAuditEvent({
          entityType: "payment",
          entityId: tx.id,
          action: "mojaloop_webhook_committed",
          actorId: tx.initiatedBy,
          actorType: "system",
          newState: { transferId: input.transferId, status: "COMMITTED", tbTransferId },
        });
      }

      if (input.transferState === "ABORTED") {
        updateData.abortedAt = new Date();
        updateData.failureReason = input.errorInformation?.errorDescription ?? "Transfer aborted";

        await logAuditEvent({
          entityType: "payment",
          entityId: tx.id,
          action: "mojaloop_webhook_aborted",
          actorId: tx.initiatedBy,
          actorType: "system",
          newState: { transferId: input.transferId, status: "ABORTED", error: input.errorInformation },
        });
      }

      await updateMojaloopTransaction(input.transferId, updateData as any);

      // Record the processed event id AFTER successful handling
      if (input.eventId && db) {
        const eventHash = await sha256Hex(`mojaloop-webhook:${input.eventId}`);
        await db.insert(paymentIdempotencyKeys).values({
          keyHash: eventHash,
          transferId: input.transferId,
          responseSnapshot: { transferId: input.transferId, status: input.transferState },
          expiresAt: new Date(Date.now() + 86_400_000),
        }).onConflictDoNothing();
      }

      return { success: true, transferId: input.transferId, newStatus: input.transferState };
    }),

  /**
   * Get a summary of the Mojaloop integration status and recent transactions.
   */
  getIntegrationStatus: protectedProcedure.query(async () => {
    const available = await mojaloopAvailable();

    return {
      connected: available,
      configured: Boolean(MOJALOOP_URL),
      mode: available ? "LIVE" : MOJALOOP_URL ? "OFFLINE" : "MOJALOOP_UNCONFIGURED",
      switchUrl: MOJALOOP_URL || null,
      supportedFSPs: SUPPORTED_FSPS.filter(f => f.active).length,
      ilpVersion: "v4",
      isoStandard: "ISO 20022",
      settlementModel: "DEFERRED_NET",
    };
  }),
});
