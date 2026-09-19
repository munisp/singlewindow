/**
 * roleClaimMap.ts — Phase 20 (GAP 5): fail-closed Keycloak claim → platform role mapping.
 *
 * Single source of truth used by BOTH keycloakVerifier (verified-token path)
 * and keycloakRoleSync (claim-sync path). Previous behaviour mapped ANY bare
 * realm claim named `admin`, `customs_officer`, … to the equivalent platform
 * role — any realm issuing a bare `admin` role silently minted a platform
 * admin. That is removed.
 *
 * Rules (fail-closed):
 *   1. Catalogue-prefixed claims (`tradegateway-*`) map as before — these are
 *      under this platform's control.
 *   2. Bare/unprefixed claims map ONLY if explicitly allowlisted via the
 *      ADMIN_ROLE_CLAIM_MAP env var (format: "claim=role,claim=role", e.g.
 *      "admin=admin,customs_officer=customs_officer"). Absent allowlist →
 *      bare claims grant nothing.
 *   3. A bare claim can NEVER map to `admin` unless it is in the allowlist;
 *      the allowlist is also REQUIRED in production for any admin mapping.
 *   4. Claims that look privileged but are not mapped are returned in
 *      `unmappedPrivilegedClaims` so callers can record an honest PENDING
 *      role request instead of silently dropping them.
 *   5. No recognised claim → lowest-privilege role "user" (never null-silent
 *      privilege retention).
 */

export type TradeGatewayRole =
  | "admin"
  | "customs_officer"
  | "oga_officer"
  | "inspector"
  | "finance"
  | "user";

/** Claims controlled by this platform's realm catalogue — always trusted. */
const CATALOGUE_ROLE_MAP: Record<string, TradeGatewayRole> = {
  "tradegateway-admin": "admin",
  "tradegateway-customs-officer": "customs_officer",
  "tradegateway-oga-officer": "oga_officer",
  "tradegateway-inspector": "inspector",
  "tradegateway-finance": "finance",
  "tradegateway-trader": "user",
};

/**
 * Claims that are privileged IF mapped. When such a claim arrives unmapped
 * (not in the catalogue, not allowlisted) the caller records a pending
 * role request rather than granting access.
 */
const PRIVILEGED_CLAIM_NAMES = new Set([
  "admin",
  "customs_officer",
  "oga_officer",
  "inspector",
  "finance",
  "tradegateway-admin",
  "tradegateway-customs-officer",
  "tradegateway-oga-officer",
  "tradegateway-inspector",
  "tradegateway-finance",
]);

const VALID_ROLES = new Set<TradeGatewayRole>([
  "admin",
  "customs_officer",
  "oga_officer",
  "inspector",
  "finance",
  "user",
]);

const ROLE_PRIORITY: Record<TradeGatewayRole, number> = {
  admin: 100,
  customs_officer: 80,
  oga_officer: 70,
  inspector: 60,
  finance: 50,
  user: 10,
};

export interface RoleClaimMapping {
  /** Highest-priority mapped role; "user" when nothing mapped (lowest privilege). */
  role: TradeGatewayRole;
  /** Whether any claim mapped at all (false → defaulted to lowest privilege). */
  mapped: boolean;
  /** Privileged-looking claims that were NOT granted (need maker-checker). */
  unmappedPrivilegedClaims: string[];
}

/**
 * Parses ADMIN_ROLE_CLAIM_MAP ("claim=role,claim=role"). Invalid entries are
 * ignored (fail-closed). Bare claims may never be allowlisted to "admin"
 * unless the entry is EXACTLY the claim the realm issues — that is the
 * operator's explicit choice; everything else is rejected.
 */
export function parseAdminRoleClaimMap(
  raw: string | undefined | null
): Record<string, TradeGatewayRole> {
  const out: Record<string, TradeGatewayRole> = {};
  if (!raw) return out;
  for (const entry of raw.split(",")) {
    const [claim, role] = entry.split("=").map((s) => s.trim());
    if (!claim || !role) continue;
    if (claim in CATALOGUE_ROLE_MAP) continue; // already trusted, no override
    if (!VALID_ROLES.has(role as TradeGatewayRole)) continue;
    out[claim] = role as TradeGatewayRole;
  }
  return out;
}

let _cachedAllowlistRaw: string | null | undefined = undefined;
let _cachedAllowlist: Record<string, TradeGatewayRole> = {};

/** Allowlist from env, cached per process (env is static at boot). */
export function getAdminRoleClaimAllowlist(): Record<string, TradeGatewayRole> {
  const raw = process.env.ADMIN_ROLE_CLAIM_MAP;
  if (raw !== _cachedAllowlistRaw) {
    _cachedAllowlistRaw = raw;
    _cachedAllowlist = parseAdminRoleClaimMap(raw);
  }
  return _cachedAllowlist;
}

/** Test hook: reset the cached allowlist after mutating process.env. */
export function resetAdminRoleClaimAllowlistCache(): void {
  _cachedAllowlistRaw = undefined;
  _cachedAllowlist = {};
}

/**
 * Maps a set of Keycloak claims to a platform role under the fail-closed
 * rules above.
 */
export function mapKeycloakClaims(claims: string[]): RoleClaimMapping {
  const allowlist = getAdminRoleClaimAllowlist();

  let best: TradeGatewayRole | null = null;
  let bestPriority = -1;
  const unmappedPrivilegedClaims: string[] = [];

  for (const claim of claims) {
    const catalogueRole = CATALOGUE_ROLE_MAP[claim];
    const allowlistedRole = allowlist[claim];
    const mapped = catalogueRole ?? allowlistedRole ?? null;

    if (mapped && ROLE_PRIORITY[mapped] > bestPriority) {
      best = mapped;
      bestPriority = ROLE_PRIORITY[mapped];
      continue;
    }
    if (!mapped && PRIVILEGED_CLAIM_NAMES.has(claim)) {
      unmappedPrivilegedClaims.push(claim);
    }
  }

  return {
    role: best ?? "user",
    mapped: best !== null,
    unmappedPrivilegedClaims,
  };
}

/** Extracts realm + client roles from a decoded Keycloak payload. */
export function collectClaimsFromPayload(payload: {
  realm_access?: { roles?: string[] };
  resource_access?: Record<string, { roles?: string[] }>;
}): string[] {
  const claims: string[] = [];
  if (payload.realm_access?.roles && Array.isArray(payload.realm_access.roles)) {
    claims.push(...payload.realm_access.roles);
  }
  if (payload.resource_access) {
    for (const client of Object.values(payload.resource_access)) {
      if (client?.roles && Array.isArray(client.roles)) claims.push(...client.roles);
    }
  }
  return claims;
}
