/**
 * gating.ts — environment gate for the demo seeder.
 *
 * Doctrine:
 *  - HARD REFUSE when NODE_ENV=production (no override).
 *  - Require explicit SEED_DEMO=true.
 *  - Require a DATABASE_URL that is clearly non-production (localhost /
 *    loopback / unix socket) unless SEED_ALLOW_REMOTE=true is also set.
 *
 * Pure functions so the logic can be unit-tested without a database.
 */

export interface GateEnv {
  NODE_ENV?: string;
  SEED_DEMO?: string;
  SEED_ALLOW_REMOTE?: string;
  DATABASE_URL?: string;
}

export interface GateResult {
  ok: boolean;
  reason?: string;
}

const TRUTHY = new Set(["true", "1", "yes"]);

const LOCAL_HOST_PATTERN =
  /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0|postgres|pg|db|database)(:|\/|$)/i;

export function isLocalDatabaseUrl(url: string): boolean {
  // Unix-socket style: postgresql://user@%2Fhome%2Fkimi/db or ?host=/path
  if (/[?&]host=\//.test(url)) return true;
  if (/%2f/i.test(url)) return true;
  try {
    const u = new URL(url);
    return LOCAL_HOST_PATTERN.test(u.hostname);
  } catch {
    return false;
  }
}

export function checkSeedingAllowed(env: GateEnv): GateResult {
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    return {
      ok: false,
      reason:
        "REFUSED: NODE_ENV=production. The demo seeder must never run against production.",
    };
  }
  if (!TRUTHY.has((env.SEED_DEMO ?? "").toLowerCase())) {
    return {
      ok: false,
      reason:
        "REFUSED: set SEED_DEMO=true explicitly to run the demo seeder.",
    };
  }
  if (!env.DATABASE_URL) {
    return { ok: false, reason: "REFUSED: DATABASE_URL is not set." };
  }
  if (
    !isLocalDatabaseUrl(env.DATABASE_URL) &&
    !TRUTHY.has((env.SEED_ALLOW_REMOTE ?? "").toLowerCase())
  ) {
    return {
      ok: false,
      reason:
        "REFUSED: DATABASE_URL does not look local. Set SEED_ALLOW_REMOTE=true to override for a disposable remote demo database.",
    };
  }
  return { ok: true };
}

export class SeedGateError extends Error {}

/**
 * Hard-exit variant used by the CLI entrypoint. In production this is a
 * hard exit (process.exit) per doctrine; in other environments it throws
 * a SeedGateError so tests can assert on it.
 */
export function assertSeedingAllowed(env: GateEnv = process.env): void {
  const result = checkSeedingAllowed(env);
  if (result.ok) return;
  if ((env.NODE_ENV ?? "").toLowerCase() === "production") {
    // Hard exit — never rely on callers catching this.
    console.error(result.reason);
    process.exit(70);
  }
  throw new SeedGateError(result.reason);
}
