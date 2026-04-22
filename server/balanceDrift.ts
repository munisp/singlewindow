/**
 * balanceDrift.ts — Daily Balance Mirror Reconciliation
 *
 * Compares the payment_accounts balance mirror against the sum of committed
 * payment_queue items. Any non-zero drift triggers an owner notification and
 * is logged to the console for operator investigation.
 *
 * Reconciliation SQL (conceptual):
 *   SELECT
 *     pa.account_id,
 *     pa.credits_posted                         AS mirror_credits,
 *     SUM(pq.amount_minor_units) FILTER (...)   AS queue_credits,
 *     pa.credits_posted - SUM(...)              AS drift
 *   FROM payment_accounts pa
 *   LEFT JOIN payment_queue pq ON pq.credit_account_id = pa.account_id
 *     AND pq.status = 'committed'
 *   GROUP BY pa.id
 *   HAVING ABS(drift) > 0;
 */

import { eq, sql, and } from "drizzle-orm";
import { paymentAccounts, paymentQueue } from "../drizzle/schema";
import { getDb } from "./db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DriftRecord {
  accountId: string;
  currency: string;
  mirrorCredits: bigint;
  queueCredits: bigint;
  creditDrift: bigint;
  mirrorDebits: bigint;
  queueDebits: bigint;
  debitDrift: bigint;
}

export interface ReconciliationResult {
  checkedAt: Date;
  accountsChecked: number;
  driftingAccounts: DriftRecord[];
  totalCreditDrift: bigint;
  totalDebitDrift: bigint;
  clean: boolean;
}

// ─── Core reconciliation logic ────────────────────────────────────────────────

export async function runBalanceDriftCheck(): Promise<ReconciliationResult> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable — cannot run balance drift check");
  }

  const checkedAt = new Date();

  // Fetch all accounts
  const accounts = await db.select().from(paymentAccounts);

  if (accounts.length === 0) {
    return {
      checkedAt,
      accountsChecked: 0,
      driftingAccounts: [],
      totalCreditDrift: BigInt(0),
      totalDebitDrift: BigInt(0),
      clean: true,
    };
  }

  const driftingAccounts: DriftRecord[] = [];
  let totalCreditDrift = BigInt(0);
  let totalDebitDrift = BigInt(0);

  for (const account of accounts) {
    // Sum committed credits for this account (where it is the credit side)
    const [creditRow] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${paymentQueue.amountMinorUnits}), 0)`,
      })
      .from(paymentQueue)
      .where(
        and(
          eq(paymentQueue.creditAccountId, account.accountId),
          eq(paymentQueue.status, "committed"),
        ),
      );

    // Sum committed debits for this account (where it is the debit side)
    const [debitRow] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${paymentQueue.amountMinorUnits}), 0)`,
      })
      .from(paymentQueue)
      .where(
        and(
          eq(paymentQueue.debitAccountId, account.accountId),
          eq(paymentQueue.status, "committed"),
        ),
      );

    const queueCredits = BigInt(creditRow?.total ?? "0");
    const queueDebits  = BigInt(debitRow?.total ?? "0");
    const mirrorCredits = account.creditsPosted;
    const mirrorDebits  = account.debitsPosted;

    const creditDrift = mirrorCredits - queueCredits;
    const debitDrift  = mirrorDebits  - queueDebits;

    const absCreditDrift = creditDrift < BigInt(0) ? -creditDrift : creditDrift;
    const absDebitDrift  = debitDrift  < BigInt(0) ? -debitDrift  : debitDrift;

    if (absCreditDrift > BigInt(0) || absDebitDrift > BigInt(0)) {
      driftingAccounts.push({
        accountId: account.accountId,
        currency: account.currency,
        mirrorCredits,
        queueCredits,
        creditDrift,
        mirrorDebits,
        queueDebits,
        debitDrift,
      });
      totalCreditDrift += absCreditDrift;
      totalDebitDrift  += absDebitDrift;
    }
  }

  return {
    checkedAt,
    accountsChecked: accounts.length,
    driftingAccounts,
    totalCreditDrift,
    totalDebitDrift,
    clean: driftingAccounts.length === 0,
  };
}

// ─── Format drift report for notification ────────────────────────────────────

function formatDriftReport(result: ReconciliationResult): string {
  const lines: string[] = [
    `Balance Drift Reconciliation Report`,
    `Checked at: ${result.checkedAt.toUTCString()}`,
    `Accounts checked: ${result.accountsChecked}`,
    `Drifting accounts: ${result.driftingAccounts.length}`,
    ``,
  ];

  if (result.clean) {
    lines.push("✓ All accounts are in balance. No drift detected.");
    return lines.join("\n");
  }

  lines.push(`⚠ DRIFT DETECTED — ${result.driftingAccounts.length} account(s) out of balance:`);
  lines.push("");

  for (const d of result.driftingAccounts) {
    const toDecimal = (v: bigint) => (Number(v) / 100).toFixed(2);
    lines.push(`Account: ${d.accountId} (${d.currency})`);
    if (d.creditDrift !== BigInt(0)) {
      lines.push(
        `  Credits — Mirror: ${toDecimal(d.mirrorCredits)}, Queue sum: ${toDecimal(d.queueCredits)}, ` +
        `Drift: ${toDecimal(d.creditDrift < BigInt(0) ? -d.creditDrift : d.creditDrift)} ` +
        `(${d.creditDrift > BigInt(0) ? "mirror OVER" : "mirror UNDER"})`,
      );
    }
    if (d.debitDrift !== BigInt(0)) {
      lines.push(
        `  Debits  — Mirror: ${toDecimal(d.mirrorDebits)}, Queue sum: ${toDecimal(d.queueDebits)}, ` +
        `Drift: ${toDecimal(d.debitDrift < BigInt(0) ? -d.debitDrift : d.debitDrift)} ` +
        `(${d.debitDrift > BigInt(0) ? "mirror OVER" : "mirror UNDER"})`,
      );
    }
    lines.push("");
  }

  lines.push(
    `Total credit drift: ${(Number(result.totalCreditDrift) / 100).toFixed(2)}`,
    `Total debit drift:  ${(Number(result.totalDebitDrift) / 100).toFixed(2)}`,
    ``,
    `Action required: Run the reconciliation SQL in docs/1b-payments-architecture.md`,
    `and investigate each drifting account before the next business day.`,
  );

  return lines.join("\n");
}

// ─── Scheduled reconciliation runner ─────────────────────────────────────────

export async function runScheduledBalanceDriftCheck(): Promise<void> {
  console.log("[Reconcile] Starting daily balance drift check…");

  try {
    const result = await runBalanceDriftCheck();

    if (result.clean) {
      console.log(
        `[Reconcile] ✓ Clean — ${result.accountsChecked} account(s) checked, no drift.`,
      );
      return;
    }

    const report = formatDriftReport(result);
    console.warn("[Reconcile] ⚠ Drift detected:\n" + report);

    // Notify the platform owner
    try {
      const { notifyOwner } = await import("./_core/notification");
      await notifyOwner({
        title: `⚠ Balance Drift Detected — ${result.driftingAccounts.length} account(s)`,
        content: report,
      });
      console.log("[Reconcile] Owner notified of balance drift.");
    } catch (notifyErr) {
      console.error("[Reconcile] Failed to notify owner:", notifyErr);
    }
  } catch (err) {
    console.error("[Reconcile] Balance drift check failed:", err);
  }
}
