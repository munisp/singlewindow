/**
 * keycloakJwt.ts — Keycloak JWT validation middleware for TradeGateway NGSWTP
 *
 * Validates Keycloak-issued RS256 JWT access tokens using JWKS discovery.
 * Used by:
 *   1. Express middleware (for non-tRPC routes that need Keycloak identity)
 *   2. tRPC context enrichment (adds keycloakUser to ctx when Bearer token present)
 *   3. Caddy forward_auth header trust (X-Auth-Request-Access-Token passthrough)
 *
 * Trust chain:
 *   Caddy (forward_auth) → oauth2-proxy → Keycloak OIDC
 *   APISIX (openid-connect plugin) → Keycloak JWKS
 *   tRPC backend (this middleware) → Keycloak JWKS (independent validation)
 *
 * The middleware supports two token sources (in priority order):
 *   1. Authorization: Bearer <token>  — API clients (mobile, B2B, APISIX upstream)
 *   2. X-Auth-Request-Access-Token    — set by oauth2-proxy when Caddy forward_auth passes
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Request, Response, NextFunction } from "express";

// ── Configuration ─────────────────────────────────────────────────────────────

const KEYCLOAK_REALM_URL =
  process.env.KEYCLOAK_REALM_URL ||
  "http://keycloak:8080/realms/tradegateway";

const KEYCLOAK_JWKS_URL = `${KEYCLOAK_REALM_URL}/protocol/openid-connect/certs`;

// Expected audience — must match the Keycloak client_id configured in APISIX
const EXPECTED_AUDIENCE =
  process.env.KEYCLOAK_EXPECTED_AUDIENCE || "tradegateway-backend";

// JWKS cache TTL: jose's createRemoteJWKSet caches keys internally.
// We create the JWKS set once at module load and reuse it.
let _jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwksSet() {
  if (!_jwksSet) {
    _jwksSet = createRemoteJWKSet(new URL(KEYCLOAK_JWKS_URL), {
      cacheMaxAge: 5 * 60 * 1000, // 5 minutes
    });
  }
  return _jwksSet;
}

// ── Keycloak JWT payload shape ────────────────────────────────────────────────

export interface KeycloakTokenPayload extends JWTPayload {
  /** Keycloak preferred_username */
  preferred_username?: string;
  /** Keycloak email */
  email?: string;
  /** Keycloak email_verified */
  email_verified?: boolean;
  /** Keycloak given_name */
  given_name?: string;
  /** Keycloak family_name */
  family_name?: string;
  /** Realm-level roles */
  realm_access?: {
    roles: string[];
  };
  /** Client-level roles */
  resource_access?: Record<string, { roles: string[] }>;
  /** Keycloak session state */
  session_state?: string;
  /** Keycloak scope */
  scope?: string;
}

export interface KeycloakUser {
  sub: string;
  username: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  realmRoles: string[];
  clientRoles: string[];
  sessionState: string;
  /** Raw decoded payload for downstream use */
  payload: KeycloakTokenPayload;
}

// ── Core validation function ──────────────────────────────────────────────────

/**
 * Validates a Keycloak JWT access token and returns the decoded user.
 * Throws an error if the token is invalid, expired, or has wrong audience.
 */
export async function validateKeycloakToken(
  token: string
): Promise<KeycloakUser> {
  const jwks = getJwksSet();

  const { payload } = await jwtVerify(token, jwks, {
    issuer: KEYCLOAK_REALM_URL,
    audience: EXPECTED_AUDIENCE,
    algorithms: ["RS256"],
  });

  const kc = payload as KeycloakTokenPayload;

  const realmRoles = kc.realm_access?.roles ?? [];
  const clientRoles = Object.values(kc.resource_access ?? {}).flatMap(
    (c) => c.roles ?? []
  );

  return {
    sub: kc.sub ?? "",
    username: kc.preferred_username ?? kc.sub ?? "",
    email: kc.email ?? "",
    emailVerified: kc.email_verified ?? false,
    firstName: kc.given_name ?? "",
    lastName: kc.family_name ?? "",
    realmRoles,
    clientRoles,
    sessionState: kc.session_state ?? "",
    payload: kc,
  };
}

// ── Express middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that validates Keycloak JWT tokens.
 *
 * Sets req.keycloakUser if a valid token is found.
 * Does NOT block the request if no token is present (use requireKeycloakAuth for that).
 *
 * Token sources (in priority order):
 *   1. Authorization: Bearer <token>
 *   2. X-Auth-Request-Access-Token (set by oauth2-proxy / Caddy forward_auth)
 */
export async function keycloakJwtMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }

    const user = await validateKeycloakToken(token);
    (req as any).keycloakUser = user;
  } catch (err) {
    // Invalid token — clear any existing keycloakUser but do not block
    (req as any).keycloakUser = null;
    if (process.env.NODE_ENV !== "production") {
      console.warn("[keycloakJwt] Token validation failed:", (err as Error).message);
    }
  }
  next();
}

/**
 * Express middleware that requires a valid Keycloak JWT.
 * Returns 401 if no valid token is present.
 * Returns 403 if the token is valid but the user lacks required roles.
 */
export function requireKeycloakAuth(requiredRoles?: string[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractToken(req);
    if (!token) {
      res.status(401).json({ error: "Authentication required", code: "NO_TOKEN" });
      return;
    }

    let user: KeycloakUser;
    try {
      user = await validateKeycloakToken(token);
    } catch (err) {
      res.status(401).json({
        error: "Invalid or expired token",
        code: "INVALID_TOKEN",
        detail: (err as Error).message,
      });
      return;
    }

    if (requiredRoles && requiredRoles.length > 0) {
      const hasRole = requiredRoles.some(
        (role) =>
          user.realmRoles.includes(role) || user.clientRoles.includes(role)
      );
      if (!hasRole) {
        res.status(403).json({
          error: "Insufficient permissions",
          code: "FORBIDDEN",
          required: requiredRoles,
          actual: user.realmRoles,
        });
        return;
      }
    }

    (req as any).keycloakUser = user;
    next();
  };
}

// ── tRPC context helper ───────────────────────────────────────────────────────

/**
 * Extracts and validates a Keycloak token from an Express request for use
 * in the tRPC context. Returns null if no token is present or token is invalid.
 *
 * Usage in server/_core/context.ts:
 *   const keycloakUser = await getKeycloakUserFromRequest(req);
 *   return { ...existingCtx, keycloakUser };
 */
export async function getKeycloakUserFromRequest(
  req: Request
): Promise<KeycloakUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  try {
    return await validateKeycloakToken(token);
  } catch {
    return null;
  }
}

// ── JWKS health check ─────────────────────────────────────────────────────────

export interface JwksStatus {
  reachable: boolean;
  issuer: string;
  jwksUrl: string;
  keyCount: number;
  error?: string;
  checkedAt: string;
}

/**
 * Fetches the JWKS endpoint and returns health status.
 * Used by the keycloak.getJwksStatus tRPC procedure.
 */
export async function getJwksStatus(): Promise<JwksStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(KEYCLOAK_JWKS_URL, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      return {
        reachable: false,
        issuer: KEYCLOAK_REALM_URL,
        jwksUrl: KEYCLOAK_JWKS_URL,
        keyCount: 0,
        error: `HTTP ${res.status} ${res.statusText}`,
        checkedAt,
      };
    }
    const jwks = await res.json() as { keys?: unknown[] };
    return {
      reachable: true,
      issuer: KEYCLOAK_REALM_URL,
      jwksUrl: KEYCLOAK_JWKS_URL,
      keyCount: jwks.keys?.length ?? 0,
      checkedAt,
    };
  } catch (err) {
    return {
      reachable: false,
      issuer: KEYCLOAK_REALM_URL,
      jwksUrl: KEYCLOAK_JWKS_URL,
      keyCount: 0,
      error: (err as Error).message,
      checkedAt,
    };
  }
}

/**
 * Forces JWKS cache invalidation by recreating the JWKS set.
 * Called by keycloak.refreshJWKS tRPC procedure.
 */
export function invalidateJwksCache(): void {
  _jwksSet = null;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function extractToken(req: Request): string | null {
  // Priority 1: Authorization: Bearer <token>
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  // Priority 2: X-Auth-Request-Access-Token (set by oauth2-proxy / Caddy forward_auth)
  const proxyToken = req.headers["x-auth-request-access-token"];
  if (proxyToken && typeof proxyToken === "string") {
    return proxyToken.trim();
  }

  return null;
}

// ── Type augmentation for Express Request ─────────────────────────────────────
declare global {
  namespace Express {
    interface Request {
      keycloakUser?: KeycloakUser | null;
    }
  }
}
