/**
 * paymentWorker.ts — Background Payment Queue Worker
 *
 * Implements the async payment processing pattern from:
 *   https://backend.how/posts/1b-payments-per-day/
 *   https://github.com/pratikgajjar/1b-payments
 *
 * Architecture:
 *   1. Poll payment_queue WHERE status='queued' AND next_retry_at <= NOW()
 *   2. Claim each row by setting status='processing' (optimistic lock via UPDATE … WHERE status='queued')
 *   3. Call the Mojaloop ILP switch (or simulate in dev mode)
 *   4. On success: status='committed', update balance mirror, update mojaloop_transactions
 *   5. On failure: increment attempt_count, compute exp back-off, status='failed' or 'dead_letter'
 *
 * Exponential back-off: delay = min(2^attempt × 1_000ms, 3_600_000ms)
 * Dead-letter threshold: attempt_count >= max_attempts (default 5)
 */

import { eq, and, lte, inArray, sql } from "drizzle-orm";
import {
  paymentQueue,
  paymentAccounts,
} from "../drizzle/schema";
import { getDb } from "./db";
import crypto from "crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const MOJALOOP_URL = process.env.MOJALOOP_URL ?? "http://localhost:3003";
const MOJALOOP_API_KEY = process.env.MOJALOOP_API_KEY ?? "";
const WORKER_BATCH_SIZE = 50;          // items per poll cycle
const WORKER_INTERVAL_MS = 5_000;      // poll every 5 s
const HEARTBEAT_TIMEOUT_MS = 60_000;   // reclaim items stuck in 'processing' > 60 s

// ─── Back-off helper ─────────────────────────────────────────────────────────

export function calcBackoffMs(attempt: number): number {
  return Math.min(Math.pow(2, attempt) * 1_000, 3_600_000);
}

// ─── Mojaloop availability check ─────────────────────────────────────────────

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

// ─── Call Mojaloop ILP switch — R3 FIX: proper ILP Prepare/Fulfil choreography ──
//
// Mojaloop ILP v4 two-phase transfer:
//   Phase 1 — POST /transfers (RESERVED): creates the transfer with a cryptographic condition.
//   Phase 2 — PUT  /transfers/{id} (COMMITTED): fulfils the condition, releases the funds.
//
// FSPIOP headers required by the Mojaloop API spec:
//   FSPIOP-Source:      the sending DFSP (Customs Authority FSP)
//   FSPIOP-Destination: the receiving DFSP (NCS Revenue Account FSP)
//   Content-Type:       application/vnd.interoperability.transfers+json;version=1.1
//
// ILP condition/fulfilment (SW-M15): the condition is SHA-256 of a CSPRNG
// 32-byte preimage that is generated per transfer, stored SERVER-SIDE ONLY
// (payment_queue.metadata.ilpPreimage), and revealed to the switch only at
// execution time (Phase 2 fulfil call). Anyone who knows only the transferId
// can NOT compute a valid fulfilment.

function generateIlpPreimage(): Buffer {
  return crypto.randomBytes(32);
}

function ilpConditionFromPreimage(preimage: Buffer): string {
  return crypto.createHash("sha256").update(preimage).digest("base64url");
}

/** Verifies a fulfilment against the transfer condition (timing-safe). */
function verifyIlpFulfilment(fulfilmentB64: string, conditionB64: string): boolean {
  try {
    const preimage = Buffer.from(fulfilmentB64, "base64url");
    if (preimage.length !== 32) return false;
    const computed = crypto.createHash("sha256").update(preimage).digest();
    const expected = Buffer.from(conditionB64, "base64url");
    return computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

/**
 * Returns the stored preimage for this transfer, generating and persisting a
 * new CSPRNG one on first use (so retries reuse the same condition).
 */
async function ensureIlpPreimage(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  item: typeof paymentQueue.$inferSelect,
): Promise<Buffer> {
  const meta = ((item.metadata ?? {}) as Record<string, unknown>);
  const existing = meta.ilpPreimage;
  if (typeof existing === "string" && existing.length > 0) {
    return Buffer.from(existing, "base64url");
  }
  const preimage = generateIlpPreimage();
  await db
    .update(paymentQueue)
    .set({
      metadata: { ...meta, ilpPreimage: preimage.toString("base64url") },
      updatedAt: new Date(),
    })
    .where(eq(paymentQueue.id, item.id));
  return preimage;
}

const FSPIOP_SOURCE = process.env.MOJALOOP_FSPIOP_SOURCE ?? "CUSTOMS_AUTHORITY_DFSP";
const FSPIOP_DESTINATION = process.env.MOJALOOP_FSPIOP_DESTINATION ?? "NCS_REVENUE_DFSP";
const MOJALOOP_CONTENT_TYPE = "application/vnd.interoperability.transfers+json;version=1.1";

async function callMojaloopTransfer(
  item: typeof paymentQueue.$inferSelect,
  preimage: Buffer,
): Promise<{
  success: boolean;
  fulfilment?: string;
  error?: string;
}> {
  const available = await mojaloopAvailable();

  if (!available) {
    // A payment provider outage is an unknown external outcome, never a successful settlement.
    // Keep the queue item retryable/dead-letterable until a real provider status lookup is available.
    return { success: false, error: "Mojaloop unavailable; settlement outcome is not confirmed" };
  }

  const condition = ilpConditionFromPreimage(preimage);
  // The fulfilment (the preimage itself) is revealed to the switch ONLY in the
  // Phase-2 execution call below.
  const fulfilment = preimage.toString("base64url");
  const expiration = new Date(Date.now() + 30_000).toISOString(); // 30 s ILP expiry

  // ── Phase 1: POST /transfers — RESERVED ────────────────────────────────────
  try {
    const prepareRes = await fetch(`${MOJALOOP_URL}/transfers`, {
      method: "POST",
      headers: {
        "Content-Type": MOJALOOP_CONTENT_TYPE,
        "Accept": MOJALOOP_CONTENT_TYPE,
        "Authorization": `Bearer ${MOJALOOP_API_KEY}`,
        "FSPIOP-Source": FSPIOP_SOURCE,
        "FSPIOP-Destination": FSPIOP_DESTINATION,
        "Date": new Date().toUTCString(),
      },
      body: JSON.stringify({
        transferId: item.transferId,
        payerFsp: FSPIOP_SOURCE,
        payeeFsp: FSPIOP_DESTINATION,
        amount: {
          amount: (Number(item.amountMinorUnits) / 100).toFixed(2),
          currency: item.currency,
        },
        ilpPacket: Buffer.from(JSON.stringify({
          amount: item.amountMinorUnits.toString(),
          account: `g.${FSPIOP_DESTINATION}.${item.creditAccountId}`,
          data: item.transferId,
        })).toString("base64url"),
        condition,
        expiration,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    // Mojaloop returns 202 Accepted for async processing; 200 for sync
    if (!prepareRes.ok && prepareRes.status !== 202) {
      const errText = await prepareRes.text().catch(() => prepareRes.statusText);
      return { success: false, error: `ILP Prepare failed — HTTP ${prepareRes.status}: ${errText}` };
    }
  } catch (err) {
    return { success: false, error: `ILP Prepare error: ${err instanceof Error ? err.message : String(err)}` };
  }

  // ── Phase 2: PUT /transfers/{id} — COMMITTED ────────────────────────────────
  try {
    const fulfillRes = await fetch(`${MOJALOOP_URL}/transfers/${item.transferId}`, {
      method: "PUT",
      headers: {
        "Content-Type": MOJALOOP_CONTENT_TYPE,
        "Accept": MOJALOOP_CONTENT_TYPE,
        "Authorization": `Bearer ${MOJALOOP_API_KEY}`,
        "FSPIOP-Source": FSPIOP_SOURCE,
        "FSPIOP-Destination": FSPIOP_DESTINATION,
        "Date": new Date().toUTCString(),
      },
      body: JSON.stringify({
        fulfilment,
        completedTimestamp: new Date().toISOString(),
        transferState: "COMMITTED",
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (fulfillRes.ok || fulfillRes.status === 202) {
      const body = await fulfillRes.json().catch(() => ({}));
      // If the switch echoes a fulfilment, it MUST satisfy the condition.
      if (typeof (body as any).fulfilment === "string" &&
          !verifyIlpFulfilment((body as any).fulfilment, condition)) {
        return { success: false, error: "Switch returned a fulfilment that does not satisfy the transfer condition" };
      }
      return { success: true, fulfilment: (body as any).fulfilment ?? fulfilment };
    }

    const errText = await fulfillRes.text().catch(() => fulfillRes.statusText);
    return { success: false, error: `ILP Fulfil failed — HTTP ${fulfillRes.status}: ${errText}` };
  } catch (err) {
    return { success: false, error: `ILP Fulfil error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Update balance mirror ────────────────────────────────────────────────────

async function updateBalanceMirror(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  item: typeof paymentQueue.$inferSelect,
): Promise<void> {
  const amount = item.amountMinorUnits;

  // Debit account: increase debits_posted
  await db
    .update(paymentAccounts)
    .set({
      debitsPosted: sql`${paymentAccounts.debitsPosted} + ${amount}`,
      debitsPending: sql`GREATEST(${paymentAccounts.debitsPending} - ${amount}, 0)`,
      lastSyncAt: new Date(),
    })
    .where(eq(paymentAccounts.accountId, item.debitAccountId));

  // Credit account: increase credits_posted
  await db
    .update(paymentAccounts)
    .set({
      creditsPosted: sql`${paymentAccounts.creditsPosted} + ${amount}`,
      creditsPending: sql`GREATEST(${paymentAccounts.creditsPending} - ${amount}, 0)`,
      lastSyncAt: new Date(),
    })
    .where(eq(paymentAccounts.accountId, item.creditAccountId));
}

// ─── Process a single queue item ─────────────────────────────────────────────

async function processItem(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  item: typeof paymentQueue.$inferSelect,
): Promise<void> {
  const preimage = await ensureIlpPreimage(db, item);
  const { success, fulfilment, error } = await callMojaloopTransfer(item, preimage);

  if (success) {
    const now = new Date();

    // Commit the queue item
    await db
      .update(paymentQueue)
      .set({
        status: "committed",
        committedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(paymentQueue.id, item.id));

    // Update the balance mirror
    try {
      await updateBalanceMirror(db, item);
    } catch (mirrorErr) {
      console.error(`[Worker] Balance mirror update failed for ${item.transferId}:`, mirrorErr);
      // Non-fatal: the payment is committed; mirror can be reconciled later
    }

    // Update the mojaloop_transactions record if it exists
    try {
      const { updateMojaloopTransaction } = await import("./db");
      await updateMojaloopTransaction(item.transferId, {
        status: "COMMITTED",
        fulfilment: fulfilment ?? null,
        committedAt: now,
      });
    } catch {
      // Non-fatal: mojaloop_transactions may not exist for queue-only items
    }

    console.log(`[Worker] ✓ Committed ${item.transferId} (attempt ${item.attemptCount + 1})`);
  } else {
    const newAttemptCount = item.attemptCount + 1;
    const isDead = newAttemptCount >= item.maxAttempts;
    const now = new Date();
    const nextRetryAt = isDead
      ? null
      : new Date(now.getTime() + calcBackoffMs(newAttemptCount));

    await db
      .update(paymentQueue)
      .set({
        status: isDead ? "dead_letter" : "failed",
        attemptCount: newAttemptCount,
        lastError: error ?? "Unknown error",
        nextRetryAt,
        deadLetteredAt: isDead ? now : null,
        updatedAt: now,
      })
      .where(eq(paymentQueue.id, item.id));

    if (isDead) {
      console.warn(
        `[Worker] ✗ Dead-lettered ${item.transferId} after ${newAttemptCount} attempts. Last error: ${error}`,
      );
      // Notify owner about dead-lettered payment
      try {
        const { notifyOwner } = await import("./_core/notification");
        await notifyOwner({
          title: `Payment Dead-Lettered: ${item.transferId}`,
          content: `Transfer ${item.transferId} has been dead-lettered after ${newAttemptCount} attempts.\n\nLast error: ${error}\n\nDebit: ${item.debitAccountId} → Credit: ${item.creditAccountId}\nAmount: ${Number(item.amountMinorUnits) / 100} ${item.currency}\n\nUse the Payment Queue dashboard to retry.`,
        });
      } catch {
        // Notification failure is non-fatal
      }
    } else {
      console.warn(
        `[Worker] ✗ Failed ${item.transferId} (attempt ${newAttemptCount}/${item.maxAttempts}). ` +
        `Next retry at ${nextRetryAt?.toISOString()}. Error: ${error}`,
      );
    }
  }
}

// ─── Heartbeat recovery ───────────────────────────────────────────────────────
// Reclaim items stuck in 'processing' for longer than HEARTBEAT_TIMEOUT_MS.
// This handles worker crashes mid-flight.

async function recoverStuckItems(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
): Promise<void> {
  const stuckBefore = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS);
  await db
    .update(paymentQueue)
    .set({
      status: "queued",
      nextRetryAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(paymentQueue.status, "processing"),
        lte(paymentQueue.updatedAt, stuckBefore),
      ),
    );
}

// ─── Main worker loop ─────────────────────────────────────────────────────────

export async function runPaymentWorkerCycle(): Promise<number> {
  const db = await getDb();
  if (!db) {
    console.warn("[Worker] DB unavailable — skipping payment worker cycle");
    return 0;
  }

  try {
    // 1. Recover any items stuck in 'processing' from a previous crashed cycle
    await recoverStuckItems(db);

    // 2. Claim a bounded batch in the database. Rechecking status in the UPDATE
    //    prevents a concurrent worker from claiming a row already claimed by another worker.
    const now = new Date();
    const candidateIds = db
      .select({ id: paymentQueue.id })
      .from(paymentQueue)
      .where(
        and(
          eq(paymentQueue.status, "queued"),
          lte(paymentQueue.nextRetryAt, now),
        ),
      )
      .orderBy(paymentQueue.nextRetryAt, paymentQueue.id)
      .limit(WORKER_BATCH_SIZE);
    const claimed = await db
      .update(paymentQueue)
      .set({ status: "processing", updatedAt: now })
      .where(and(eq(paymentQueue.status, "queued"), inArray(paymentQueue.id, candidateIds)))
      .returning({
        id: paymentQueue.id,
        transferId: paymentQueue.transferId,
        debitAccountId: paymentQueue.debitAccountId,
        creditAccountId: paymentQueue.creditAccountId,
        amountMinorUnits: paymentQueue.amountMinorUnits,
        currency: paymentQueue.currency,
        ledger: paymentQueue.ledger,
        status: paymentQueue.status,
        attemptCount: paymentQueue.attemptCount,
        maxAttempts: paymentQueue.maxAttempts,
        lastError: paymentQueue.lastError,
        nextRetryAt: paymentQueue.nextRetryAt,
        deadLetteredAt: paymentQueue.deadLetteredAt,
        committedAt: paymentQueue.committedAt,
        metadata: paymentQueue.metadata,
        createdAt: paymentQueue.createdAt,
        updatedAt: paymentQueue.updatedAt,
      });

    if (claimed.length === 0) return 0;

    console.log(`[Worker] Processing ${claimed.length} payment(s)…`);

    // 3. Process each item (sequential to avoid hammering Mojaloop)
    for (const item of claimed) {
      try {
        await processItem(db, item as typeof paymentQueue.$inferSelect);
      } catch (err) {
        console.error(`[Worker] Unexpected error processing ${item.transferId}:`, err);
        // Reset to queued so it will be retried
        await db
          .update(paymentQueue)
          .set({
            status: "queued",
            nextRetryAt: new Date(Date.now() + calcBackoffMs(item.attemptCount)),
            lastError: err instanceof Error ? err.message : String(err),
            updatedAt: new Date(),
          })
          .where(eq(paymentQueue.id, item.id));
      }
    }
    return claimed.length;
  } catch (err) {
    console.error("[Worker] Payment worker cycle error:", err);
    return 0;
  }
}

// ─── Worker health state ─────────────────────────────────────────────────────────

let workerTimer: ReturnType<typeof setInterval> | null = null;
let _workerStartedAt: Date | null = null;
let _workerLastCycleAt: Date | null = null;
let _workerItemsProcessedTotal = 0;

export function getWorkerStatus() {
  return {
    running: workerTimer !== null,
    startedAt: _workerStartedAt,
    lastCycleAt: _workerLastCycleAt,
    itemsProcessedTotal: _workerItemsProcessedTotal,
  };
}

// ─── Start the worker ─────────────────────────────────────────────────────────

export function startPaymentWorker(): void {
  if (workerTimer) return; // already running
  _workerStartedAt = new Date();
  console.log(`[Worker] Payment queue worker started (interval: ${WORKER_INTERVAL_MS}ms, batch: ${WORKER_BATCH_SIZE})`);
  // Run immediately on startup, then on interval
  runPaymentWorkerCycle().then((n) => { _workerLastCycleAt = new Date(); _workerItemsProcessedTotal += (n ?? 0); }).catch(console.error);
  workerTimer = setInterval(() => {
    runPaymentWorkerCycle().then((n) => { _workerLastCycleAt = new Date(); _workerItemsProcessedTotal += (n ?? 0); }).catch(console.error);
  }, WORKER_INTERVAL_MS);
}

export function stopPaymentWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
    console.log("[Worker] Payment queue worker stopped");
  }
}
