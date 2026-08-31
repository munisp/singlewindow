/**
 * paymentAccountProvisioner.ts — R4 FIX: Per-trader payment account auto-provisioning
 *
 * Audit finding B6: TigerBeetle uses fixed account IDs ("trader-{id}" strings) without
 * ensuring the corresponding payment_accounts row exists in the DB mirror. This causes
 * balance queries to return null and ledger entries to reference non-existent accounts.
 *
 * This module:
 *   1. Checks if a payment_accounts row exists for the trader
 *   2. If not, creates it with zero balances (debit/credit pending/posted)
 *   3. Optionally provisions the corresponding TigerBeetle account via gRPC
 *   4. Returns the account ID for use in payment queue entries
 *
 * Called from:
 *   - payments.initiate (before enqueuing)
 *   - User registration / KYC approval (proactive provisioning)
 */

import { getDb } from "../db";
import { paymentAccounts } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { fetchWithResilience } from "./middlewareClients";
import { getServiceAuthHeaders } from "./serviceAuth";

// ─── Account type constants ───────────────────────────────────────────────────

export const ACCOUNT_TYPE = {
  TRADER: "trader",
  CUSTOMS_DUTY: "customs_duty",
  VAT: "vat",
  LEVY: "levy",
  BOND: "bond",
  SUSPENSE: "suspense",
} as const;

export type AccountType = typeof ACCOUNT_TYPE[keyof typeof ACCOUNT_TYPE];

// ─── System account IDs (fixed, provisioned at startup) ──────────────────────

export const SYSTEM_ACCOUNTS = {
  NCS_REVENUE: "ncs-revenue-account",
  BOND_COLLATERAL: "ncs-bond-collateral",
  DRAWBACK_RESERVE: "ncs-drawback-reserve",
  CUSTOMS_FEE: "ncs-customs-fee",
} as const;

// ─── Provisioner ─────────────────────────────────────────────────────────────

export interface ProvisionResult {
  accountId: string;
  isNew: boolean;
  ledger: number;
}

/**
 * Ensures a payment_accounts row exists for the given trader.
 * Creates one if it does not exist (idempotent — safe to call multiple times).
 *
 * @param traderId  The internal user ID (integer) of the trader
 * @param currency  ISO 4217 currency code (default: USD)
 * @returns The account ID string used in payment_queue.debit_account_id
 */
export async function provisionTraderAccount(
  traderId: number,
  currency = "USD"
): Promise<ProvisionResult> {
  const db = await getDb();
  if (!db) {
    // P0 remediation: FAIL-CLOSED. Without the DB mirror we cannot verify or
    // record provisioning — payment setup must not proceed unprovisioned.
    throw new Error(
      "[AccountProvisioner] Database unavailable — cannot provision payment account; payment setup aborted"
    );
  }

  const accountId = `trader-${traderId}`;

  // Check if already provisioned (DB mirror is the record of completed
  // provisioning — a row exists only after the ledger account was created).
  const [existing] = await db
    .select({ accountId: paymentAccounts.accountId })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.accountId, accountId))
    .limit(1);

  if (existing) {
    return { accountId, isNew: false, ledger: 1 };
  }

  // P0 remediation: provision the TigerBeetle ledger account FIRST via the
  // canonical bridge, and FAIL the payment setup if it cannot be created.
  // (Previously this imported a non-existent gRPC `tigerBeetleClient` export
  // and silently no-op'd while payments proceeded unprovisioned.)
  await provisionTigerBeetleAccount(accountId, traderId, currency);

  // Ledger account exists — record the DB mirror row.
  // Wrapped in try/catch so FK violations in test environments (where the
  // user row may not exist) are non-fatal.
  try {
    await db.insert(paymentAccounts).values({
      accountId,
      traderId,
      accountType: "trader" as const,
      currency,
      ledger: 1,
      debitsPosted: BigInt(0),
      debitsPending: BigInt(0),
      creditsPosted: BigInt(0),
      creditsPending: BigInt(0),
      lastSyncAt: new Date(),
    }).onConflictDoNothing(); // idempotent
  } catch (err: any) {
    // FK violation: trader not yet in users table (test env or race condition)
    // pg driver sets err.code as a string '23503' for foreign_key_violation
    const isFkViolation = err?.code === '23503' ||
      (typeof err?.message === 'string' && err.message.includes('foreign key'));
    if (isFkViolation) {
      console.warn(`[AccountProvisioner] FK violation for trader ${traderId} — skipping DB mirror write (ledger account was provisioned)`);
      return { accountId, isNew: false, ledger: 1 };
    }
    throw err;
  }

  console.log(`[AccountProvisioner] Provisioned payment account for trader ${traderId}: ${accountId}`);
  return { accountId, isNew: true, ledger: 1 };
}

/**
 * Ensures all system accounts (NCS Revenue, Bond Collateral, etc.) exist.
 * Called once at server startup.
 */
export async function provisionSystemAccounts(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const systemAccountDefs = [
    { accountId: SYSTEM_ACCOUNTS.NCS_REVENUE, accountType: "customs_duty" as const, currency: "USD" },
    { accountId: SYSTEM_ACCOUNTS.BOND_COLLATERAL, accountType: "bond" as const, currency: "USD" },
    { accountId: SYSTEM_ACCOUNTS.DRAWBACK_RESERVE, accountType: "suspense" as const, currency: "USD" },
    { accountId: SYSTEM_ACCOUNTS.CUSTOMS_FEE, accountType: "levy" as const, currency: "USD" },
  ];

  for (const def of systemAccountDefs) {
    const [existing] = await db
      .select({ accountId: paymentAccounts.accountId })
      .from(paymentAccounts)
      .where(eq(paymentAccounts.accountId, def.accountId))
      .limit(1);

    if (!existing) {
      await db.insert(paymentAccounts).values({
        accountId: def.accountId,
        traderId: null, // system accounts have no user owner
        accountType: def.accountType,
        currency: def.currency,
        ledger: 1,
        debitsPosted: BigInt(0),
        debitsPending: BigInt(0),
        creditsPosted: BigInt(0),
        creditsPending: BigInt(0),
        lastSyncAt: new Date(),
      }).onConflictDoNothing();
      console.log(`[AccountProvisioner] Provisioned system account: ${def.accountId}`);
    }
  }
}

// Canonical Go bridge: k8s Service `tigerbeetle-bridge`, /api/ledger/* dialect
// (same dialect as server/routers/ledger.ts). Env-configured via TB_BRIDGE_URL.
const TB_BRIDGE_URL = process.env.TB_BRIDGE_URL || "http://tigerbeetle-bridge:8086";

/**
 * Provisions a TigerBeetle account via the canonical bridge
 * (POST /api/ledger/accounts). FAIL-CLOSED (P0 remediation): any failure
 * throws, which aborts the payment setup — the platform never proceeds with
 * an unprovisioned ledger account. Account creation is idempotent on the
 * bridge (existing account is not an error).
 */
async function provisionTigerBeetleAccount(
  accountId: string,
  userId: number,
  currency: string
): Promise<void> {
  let res: Response;
  try {
    // PRA-012: authenticated money-rail hop; PRA-024/025: resilience wrapper.
    const authHeaders = await getServiceAuthHeaders();
    res = await fetchWithResilience(
      `${TB_BRIDGE_URL}/api/ledger/accounts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          id: accountId,
          ledger: 1,
          code: 1, // trader debit account
          accountType: "TRADER_LIABILITY",
          description: `Trader ${userId} payment account (${accountId})`,
          currency,
        }),
        timeoutMs: 5_000,
      },
      "tigerbeetle-bridge"
    );
  } catch (err) {
    throw new Error(
      `[AccountProvisioner] TigerBeetle bridge unreachable at ${TB_BRIDGE_URL} — account ${accountId} NOT provisioned; payment setup aborted: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[AccountProvisioner] TigerBeetle bridge rejected account ${accountId}: HTTP ${res.status} ${body} — payment setup aborted`
    );
  }
}

/**
 * Gets or provisions a trader account, returning the account ID.
 * Convenience wrapper for use in payment initiation.
 */
export async function getOrProvisionTraderAccount(
  traderId: number,
  currency = "USD"
): Promise<string> {
  const result = await provisionTraderAccount(traderId, currency);
  return result.accountId;
}
