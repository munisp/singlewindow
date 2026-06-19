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

// ─── Token verification ───────────────────────────────────────────────────────
/**
 * Verifies a Keycloak Bearer token using the realm's JWKS endpoint.
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

  try {
    const issuer = `${ENV.keycloakUrl}/realms/${ENV.keycloakRealm}`;
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer,
      algorithms: ["RS256"],
    });
    return payload as KeycloakTokenPayload;
  } catch (err) {
    // Token invalid, expired, or Keycloak unreachable — log at debug level
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("fetch") && !msg.includes("ECONNREFUSED")) {
      // Only log non-connectivity errors (connectivity failures are expected in dev)
      console.debug("[KeycloakVerifier] Token verification failed:", msg);
    }
    return null;
  }
}

// ─── Role extraction ──────────────────────────────────────────────────────────
type TradeGatewayRole =
  | "admin"
  | "customs_officer"
  | "oga_officer"
  | "inspector"
  | "finance"
  | "user";

const ROLE_MAP: Record<string, TradeGatewayRole> = {
  "tradegateway-admin": "admin",
  "tradegateway-customs-officer": "customs_officer",
  "tradegateway-oga-officer": "oga_officer",
  "tradegateway-inspector": "inspector",
  "tradegateway-finance": "finance",
  "tradegateway-trader": "user",
  admin: "admin",
  customs_officer: "customs_officer",
  oga_officer: "oga_officer",
  inspector: "inspector",
  finance: "finance",
  trader: "user",
};

const ROLE_PRIORITY: Record<TradeGatewayRole, number> = {
  admin: 100,
  customs_officer: 80,
  oga_officer: 70,
  inspector: 60,
  finance: 50,
  user: 10,
};

/**
 * Extracts the highest-priority TradeGateway role from a verified Keycloak payload.
 */
export function extractRoleFromPayload(
  payload: KeycloakTokenPayload
): TradeGatewayRole | null {
  const roles: string[] = [];

  if (payload.realm_access?.roles) {
    roles.push(...payload.realm_access.roles);
  }
  if (payload.resource_access) {
    for (const client of Object.values(payload.resource_access)) {
      if (client?.roles) roles.push(...client.roles);
    }
  }

  let best: TradeGatewayRole | null = null;
  let bestPriority = -1;

  for (const r of roles) {
    const mapped = ROLE_MAP[r];
    if (mapped && ROLE_PRIORITY[mapped] > bestPriority) {
      best = mapped;
      bestPriority = ROLE_PRIORITY[mapped];
    }
  }

  return best;
}
