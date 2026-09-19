/**
 * keycloakVerifier.ts
 * Real Keycloak OIDC token verification using JWKS (RS256).
 * Uses the `jose` library (already installed) to fetch and cache the
 * Keycloak JWKS endpoint and verify incoming Bearer tokens.
 *
 * Falls back gracefully when Keycloak is unreachable (returns null).
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { ENV } from "./env";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface KeycloakTokenPayload extends JWTPayload {
  /** Keycloak subject (user UUID in the realm) */
  sub: string;
  /** Preferred username */
  preferred_username?: string;
  /** Email */
  email?: string;
  /** Email verified flag */
  email_verified?: boolean;
  /** Realm-level roles */
  realm_access?: { roles: string[] };
  /** Client-level roles */
  resource_access?: Record<string, { roles: string[] }>;
  /** Authorized party (client_id that requested the token) */
  azp?: string;
}

// ─── JWKS cache ───────────────────────────────────────────────────────────────
// createRemoteJWKSet already caches keys in-memory and re-fetches on key rotation.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    const jwksUri = `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}/protocol/openid-connect/certs`;
    _jwks = createRemoteJWKSet(new URL(jwksUri));
  }
  return _jwks;
}

/** Force a JWKS cache refresh (e.g. after key rotation). */
export function resetJwksCache(): void {
  _jwks = null;
}

// ─── Audience enforcement (PRA-106, Phase 9) ────────────────────────────────
// A Keycloak-issued token is only valid for THIS API if its `aud` claim
// includes ENV.keycloakTokenAudience. Production refuses to boot without
// KEYCLOAK_TOKEN_AUDIENCE (validateProductionConfig); as defence in depth the
// verifier itself also fails closed in production if it is somehow unset.
let _audWarningLogged = false;

function requiredAudience(): string | null {
  const aud = ENV.keycloakTokenAudience.trim();
  if (aud) return aud;
  if (ENV.isProduction) return null; // fail closed — reject every token
  if (!_audWarningLogged) {
    _audWarningLogged = true;
    console.warn(
      "[KeycloakVerifier] KEYCLOAK_TOKEN_AUDIENCE unset — token audience is NOT being " +
        "verified (dev-only posture; production refuses to boot without it)."
    );
  }
  return ""; // dev: no audience check, warning logged once
}

// ─── Token verification ───────────────────────────────────────────────────────
/**
 * Verifies a Keycloak Bearer token using the realm's JWKS endpoint.
 * Enforces issuer, RS256, expiry, and (when configured — always in
 * production) the expected audience.
 *
 * @returns Decoded payload on success, null if the token is absent/invalid/expired
 *          or if Keycloak is unreachable.
 */
export async function verifyKeycloakToken(
  bearerToken: string | undefined | null
): Promise<KeycloakTokenPayload | null> {
  if (!bearerToken) return null;

  // Strip "Bearer " prefix if present
  const token = bearerToken.startsWith("Bearer ")
    ? bearerToken.slice(7)
    : bearerToken;

  if (!token) return null;

  const audience = requiredAudience();
  if (audience === null) {
    console.error("[KeycloakVerifier] KEYCLOAK_TOKEN_AUDIENCE unset in production — rejecting token (fail closed)");
    return null;
  }

  try {
    const issuer = `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}`;
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
      algorithms: ["RS256"],
      ...(audience ? { audience } : {}),
    });
    return payload as KeycloakTokenPayload;
  } catch (err) {
    // Token invalid, expired, wrong audience, or Keycloak unreachable — log at debug level
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("fetch") && !msg.includes("ECONNREFUSED")) {
      // Only log non-connectivity errors (connectivity failures are expected in dev)
      console.debug("[KeycloakVerifier] Token verification failed:", msg);
    }
    return null;
  }
}

// ─── Role extraction ──────────────────────────────────────────────────────────
// Phase 20 (GAP 5): mapping lives in ./roleClaimMap (single source of truth,
// shared with keycloakRoleSync). Bare realm claims no longer auto-map; they
// require an explicit ADMIN_ROLE_CLAIM_MAP allowlist entry.
import {
  collectClaimsFromPayload,
  mapKeycloakClaims,
  type RoleClaimMapping,
  type TradeGatewayRole,
} from "./roleClaimMap";

export type { RoleClaimMapping, TradeGatewayRole };

/**
 * Extracts the full fail-closed role mapping from a verified Keycloak payload.
 */
export function extractRoleMappingFromPayload(
  payload: KeycloakTokenPayload
): RoleClaimMapping {
  return mapKeycloakClaims(collectClaimsFromPayload(payload));
}

/**
 * Extracts the highest-priority TradeGateway role from a verified Keycloak payload.
 * Returns null only when NO claim mapped — callers must treat that as
 * lowest-privilege ("user"), never as "keep whatever the token implies".
 */
export function extractRoleFromPayload(
  payload: KeycloakTokenPayload
): TradeGatewayRole | null {
  const mapping = extractRoleMappingFromPayload(payload);
  return mapping.mapped ? mapping.role : null;
}
