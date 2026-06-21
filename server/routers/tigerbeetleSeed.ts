/**
 * tigerbeetleSeed.ts — TigerBeetle system account seeding router.
 *
 * Provides two adminProcedure endpoints:
 *   - seedSystemAccounts: seeds the 13 WCO GL system accounts (Revenue Authority,
 *     Central Bank, Customs Escrow, Penalty Fund, Bond Escrow, Drawback Reserve,
 *     Free Zone Fund, G2G Settlement) via the Rust TigerBeetle bridge.
 *   - seedTraderAccounts: seeds 4 accounts per trader (DUTY_RECEIVABLE,
 *     DUTY_PAYABLE, BOND_ESCROW, REFUND_PAYABLE) for a given trader ID.
 *   - getSeedStatus: queries the TigerBeetle bridge health endpoint to confirm
 *     system accounts exist and returns a structured status report.
 *
 * All operations are idempotent — the Rust bridge returns HTTP 409 when an
 * account already exists, which is treated as success here.
 *
 * Security: all three procedures are adminProcedure — only users with
 * role='admin' can invoke them.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";

// ─── Config ───────────────────────────────────────────────────────────────────

const TIGERBEETLE_BRIDGE_URL =
  process.env.TIGERBEETLE_BRIDGE_URL ?? "http://localhost:8087";

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

// ─── Router ───────────────────────────────────────────────────────────────────

export const tigerbeetleSeedRouter = router({
  /**
   * seedSystemAccounts — seeds the 13 WCO GL system accounts.
   *
   * Calls POST /seed/system on the Rust TigerBeetle bridge.
   * Returns a structured result with counts and duration.
   * Safe to call multiple times — idempotent.
   */
  seedSystemAccounts: adminProcedure.mutation(async (): Promise<SeedResult> => {
    const start = Date.now();
    let result: { status: number; data: unknown };

    try {
      result = await callBridge("/seed/system", "POST");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `TigerBeetle bridge unreachable: ${msg}`,
      });
    }

    const durationMs = Date.now() - start;
    const data = result.data as Record<string, unknown>;

    // 200 = seeded, 409 = already exists (both are success)
    if (result.status === 200 || result.status === 409) {
      return {
        success: true,
        message:
          result.status === 409
            ? "System accounts already exist (idempotent seed)"
            : "System accounts seeded successfully",
        accountsCreated: (data?.accounts_created as number) ?? 0,
        accountsSkipped: (data?.accounts_skipped as number) ?? 0,
        durationMs,
      };
    }

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `TigerBeetle bridge returned HTTP ${result.status}: ${JSON.stringify(data)}`,
    });
  }),

  /**
   * seedTraderAccounts — seeds 4 TigerBeetle accounts for a given trader.
   *
   * Calls POST /seed/trader on the Rust TigerBeetle bridge with the trader ID.
   * Creates: DUTY_RECEIVABLE, DUTY_PAYABLE, BOND_ESCROW, REFUND_PAYABLE.
   * Idempotent — safe to call on every trader login or registration.
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
      let result: { status: number; data: unknown };

      try {
        result = await callBridge("/seed/trader", "POST", {
          trader_id: input.traderId,
          currency: input.currency,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `TigerBeetle bridge unreachable: ${msg}`,
        });
      }

      const durationMs = Date.now() - start;
      const data = result.data as Record<string, unknown>;

      if (result.status === 200 || result.status === 409) {
        return {
          success: true,
          message:
            result.status === 409
              ? `Accounts for trader ${input.traderId} already exist`
              : `4 accounts seeded for trader ${input.traderId}`,
          accountsCreated: (data?.accounts_created as number) ?? 0,
          accountsSkipped: (data?.accounts_skipped as number) ?? 0,
          traderId: input.traderId,
          durationMs,
        };
      }

      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `TigerBeetle bridge returned HTTP ${result.status}: ${JSON.stringify(data)}`,
      });
    }),

  /**
   * getSeedStatus — queries the TigerBeetle bridge health and seed status.
   *
   * Returns whether system accounts exist, the bridge version, and uptime.
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
