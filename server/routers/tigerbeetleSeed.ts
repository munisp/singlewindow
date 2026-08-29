/**
 * tigerbeetleSeed.ts — TigerBeetle system account seeding router.
 *
 * Phase-6 remediation (SW-MP2): converged to the CANONICAL Go
 * tigerbeetle-bridge (k8s Service `tigerbeetle-bridge`, HTTP /api/ledger/*,
 * port 8086). The previous client called POST /seed/system and
 * POST /seed/trader — endpoints that NO shipped bridge serves, so every seed
 * call failed. Seeding is now implemented client-side with real semantics:
 * one POST /api/ledger/accounts per account; HTTP 409 (already exists) is
 * treated as an idempotent skip.
 *
 * Provides two adminProcedure endpoints:
 *   - seedSystemAccounts: seeds the 13 WCO GL system accounts (Revenue Authority,
 *     Central Bank, Customs Escrow, Penalty Fund, Bond Escrow, Drawback Reserve,
 *     Free Zone Fund, G2G Settlement) via the canonical TigerBeetle bridge.
 *   - seedTraderAccounts: seeds 4 accounts per trader (DUTY_RECEIVABLE,
 *     DUTY_PAYABLE, BOND_ESCROW, REFUND_PAYABLE) for a given trader ID.
 *   - getSeedStatus: queries the TigerBeetle bridge health endpoint to confirm
 *     the bridge is reachable and returns a structured status report.
 *
 * All operations are idempotent — the bridge returns HTTP 409 when an
 * account already exists, which is treated as success here.
 *
 * Security: all three procedures are adminProcedure — only users with
 * role='admin' can invoke them.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";

// ─── Config ───────────────────────────────────────────────────────────────────

// Canonical Go bridge: k8s Service `tigerbeetle-bridge`, /api/ledger/* on 8086.
const TIGERBEETLE_BRIDGE_URL =
  process.env.TIGERBEETLE_BRIDGE_URL ?? process.env.TB_BRIDGE_URL ?? "http://tigerbeetle-bridge:8086";

const SEED_TIMEOUT_MS = 30_000;

// ─── Admin guard ─────────────────────────────────────────────────────────────

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Only admins can invoke TigerBeetle seed operations",
    });
  }
  return next({ ctx });
});

// ─── WCO GL system accounts (canonical bridge accountType vocabulary) ────────

interface AccountSeed {
  id: string;
  ledger: number;
  code: number;
  accountType: string;
  description: string;
  currency: string;
}

const SYSTEM_ACCOUNTS: AccountSeed[] = [
  { id: "sys-revenue-authority",   ledger: 1, code: 2001, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Revenue Authority — settled duties",       currency: "GHS" },
  { id: "sys-central-bank",        ledger: 1, code: 2002, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Central Bank settlement account",            currency: "GHS" },
  { id: "sys-customs-escrow",      ledger: 1, code: 2003, accountType: "CUSTOMS_REVENUE_PENDING",   description: "Customs Escrow — two-phase reserve",         currency: "GHS" },
  { id: "sys-penalty-fund",        ledger: 1, code: 2004, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Penalty Fund",                               currency: "GHS" },
  { id: "sys-bond-escrow",         ledger: 1, code: 3001, accountType: "BOND_DEPOSIT",              description: "Bond Escrow",                                currency: "GHS" },
  { id: "sys-drawback-reserve",    ledger: 1, code: 4001, accountType: "DRAWBACK_PAYABLE",          description: "Drawback Reserve",                           currency: "GHS" },
  { id: "sys-free-zone-fund",      ledger: 1, code: 2005, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Free Zone Fund",                             currency: "GHS" },
  { id: "sys-g2g-settlement",      ledger: 1, code: 2006, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "G2G Settlement",                             currency: "GHS" },
  { id: "customs-duty-revenue",    ledger: 1, code: 2101, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Customs duty revenue (Mojaloop settlement)", currency: "GHS" },
  { id: "ncs-revenue",             ledger: 1, code: 2102, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "NCS revenue collection",                     currency: "GHS" },
  { id: "sys-transit-guarantee",   ledger: 1, code: 3002, accountType: "BOND_DEPOSIT",              description: "Transit guarantee escrow",                   currency: "GHS" },
  { id: "sys-vat-revenue",         ledger: 1, code: 2103, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "VAT revenue",                                currency: "GHS" },
  { id: "sys-levy-revenue",        ledger: 1, code: 2104, accountType: "CUSTOMS_REVENUE_CONFIRMED", description: "Export levy revenue",                        currency: "GHS" },
];

function traderAccounts(traderId: string, currency: string): AccountSeed[] {
  return [
    { id: `trader-${traderId}-duty-receivable`, ledger: 1, code: 1001, accountType: "TRADER_LIABILITY", description: `Trader ${traderId} — duty receivable`, currency },
    { id: `trader-${traderId}-liability`,       ledger: 1, code: 1002, accountType: "TRADER_LIABILITY", description: `Trader ${traderId} — duty payable`,    currency },
    { id: `trader-${traderId}-bond`,            ledger: 1, code: 3001, accountType: "BOND_DEPOSIT",     description: `Trader ${traderId} — bond escrow`,     currency },
    { id: `trader-${traderId}-refund-payable`,  ledger: 1, code: 4001, accountType: "DRAWBACK_PAYABLE", description: `Trader ${traderId} — refund payable`,  currency },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SeedResult {
  success: boolean;
  message: string;
  accountsCreated?: number;
  accountsSkipped?: number;
  durationMs?: number;
  traderId?: string;
  error?: string;
}

async function callBridge(
  path: string,
  method: "GET" | "POST",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEED_TIMEOUT_MS);
  try {
    const res = await fetch(`${TIGERBEETLE_BRIDGE_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Creates one account on the canonical bridge.
 * Returns "created" | "skipped" (already exists). Throws on other errors.
 */
async function createAccount(account: AccountSeed): Promise<"created" | "skipped"> {
  const { status, data } = await callBridge("/api/ledger/accounts", "POST", account);
  if (status === 200 || status === 201) return "created";
  if (status === 409) return "skipped";
  throw new Error(`bridge returned HTTP ${status}: ${JSON.stringify(data)}`);
}

async function seedAccounts(accounts: AccountSeed[]): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  for (const account of accounts) {
    const outcome = await createAccount(account);
    if (outcome === "created") created++;
    else skipped++;
  }
  return { created, skipped };
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const tigerbeetleSeedRouter = router({
  /**
   * seedSystemAccounts — seeds the 13 WCO GL system accounts on the canonical
   * Go bridge via POST /api/ledger/accounts (409 = idempotent skip).
   * Safe to call multiple times.
   */
  seedSystemAccounts: adminProcedure.mutation(async (): Promise<SeedResult> => {
    const start = Date.now();
    try {
      const { created, skipped } = await seedAccounts(SYSTEM_ACCOUNTS);
      return {
        success: true,
        message: `System account seed complete: ${created} created, ${skipped} already existed`,
        accountsCreated: created,
        accountsSkipped: skipped,
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `TigerBeetle system seed failed: ${msg}`,
      });
    }
  }),

  /**
   * seedTraderAccounts — seeds 4 TigerBeetle accounts for a given trader on the
   * canonical bridge. Idempotent — safe to call on every trader login.
   */
  seedTraderAccounts: adminProcedure
    .input(
      z.object({
        traderId: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_-]+$/, "traderId must be alphanumeric"),
        currency: z.string().length(3).default("NGN"),
      })
    )
    .mutation(async ({ input }): Promise<SeedResult> => {
      const start = Date.now();
      try {
        const { created, skipped } = await seedAccounts(traderAccounts(input.traderId, input.currency));
        return {
          success: true,
          message: `Trader ${input.traderId} account seed complete: ${created} created, ${skipped} already existed`,
          accountsCreated: created,
          accountsSkipped: skipped,
          traderId: input.traderId,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `TigerBeetle trader seed failed: ${msg}`,
        });
      }
    }),

  /**
   * getSeedStatus — queries the TigerBeetle bridge health endpoint and returns
   * a structured status report.
   */
  getSeedStatus: adminProcedure.query(async () => {
    let result: { status: number; data: unknown };

    try {
      result = await callBridge("/health", "GET");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        bridgeReachable: false,
        systemAccountsSeeded: false,
        error: `TigerBeetle bridge unreachable: ${msg}`,
        bridgeUrl: TIGERBEETLE_BRIDGE_URL,
      };
    }

    const data = result.data as Record<string, unknown>;
    return {
      bridgeReachable: result.status === 200,
      systemAccountsSeeded: (data?.system_accounts_seeded as boolean) ?? false,
      bridgeVersion: (data?.version as string) ?? "unknown",
      uptimeSeconds: (data?.uptime_seconds as number) ?? 0,
      bridgeUrl: TIGERBEETLE_BRIDGE_URL,
    };
  }),
});
