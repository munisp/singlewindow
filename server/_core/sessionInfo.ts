/**
 * sessionInfo.ts — resolve the expiry of the credential that authenticated
 * the current request.
 *
 * Why this exists (Wave 3): browser portals authenticate at the edge
 * (Caddy forward_auth → oauth2-proxy → Keycloak). Keycloak tokens never
 * reach the SPA, so the client cannot read `exp` itself. This module lets
 * the server report when the current session credential expires so the SPA
 * can schedule a PROACTIVE silent renewal (refresh_token grant when tokens
 * are available, otherwise a silent SSO round-trip) instead of waiting for
 * a hard 401 bounce.
 *
 * Sources, in priority order:
 *   1. Authorization: Bearer <keycloak JWT>   (API clients)
 *   2. X-Auth-Request-Access-Token            (oauth2-proxy forward_auth)
 *   3. Local session cookie (HS256 JWT signed with JWT_SECRET)
 *
 * Fail-closed: any credential whose expiry cannot be determined yields null,
 * and the client treats "unknown expiry" as "do not schedule".
 */
import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import { decodeJwt, jwtVerify } from "jose";
import { ENV } from "./env";

export type SessionExpirySource =
  | "keycloak-bearer"
  | "edge-proxy"
  | "session-cookie";

export interface SessionExpiry {
  /** Epoch milliseconds at which the credential expires. */
  expiresAt: number;
  source: SessionExpirySource;
}

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "session";

/** Read `exp` (seconds) from a JWT payload and convert to epoch ms. */
function expToMs(exp: unknown): number | null {
  return typeof exp === "number" && Number.isFinite(exp) && exp > 0
    ? exp * 1000
    : null;
}

function stripBearer(header: string | undefined): string | null {
  if (!header) return null;
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
}

/**
 * Resolve the expiry of the credential that authenticated `req`.
 * Returns null when no credential is present or its expiry is unreadable.
 *
 * Note on verification: Bearer tokens are JWKS-verified by
 * sdk.authenticateRequest during context creation; here we only need `exp`,
 * which is not security-sensitive (the worst a forged exp can do is cause an
 * early or late renewal attempt — renewal itself still requires a valid
 * credential). For the local session cookie we DO cryptographically verify,
 * because the cookie is the sole credential and its signature check is cheap.
 */
export async function resolveSessionExpiry(
  req: Request,
): Promise<SessionExpiry | null> {
  // 1. Authorization: Bearer (Keycloak access token — API clients)
  const bearer = stripBearer(req.headers.authorization as string | undefined);
  if (bearer) {
    try {
      const exp = expToMs(decodeJwt(bearer).exp);
      if (exp) return { expiresAt: exp, source: "keycloak-bearer" };
    } catch {
      /* fall through */
    }
  }

  // 2. X-Auth-Request-Access-Token (oauth2-proxy / Caddy forward_auth).
  // The edge has already validated this token; we only read its exp.
  const proxyToken = req.headers["x-auth-request-access-token"];
  const proxyTokenStr = Array.isArray(proxyToken) ? proxyToken[0] : proxyToken;
  if (proxyTokenStr) {
    try {
      const exp = expToMs(decodeJwt(proxyTokenStr).exp);
      if (exp) return { expiresAt: exp, source: "edge-proxy" };
    } catch {
      /* fall through */
    }
  }

  // 3. Local session cookie (HS256 JWT). Verify signature before trusting exp.
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = parseCookieHeader(cookieHeader);
    const sessionCookie = cookies[SESSION_COOKIE_NAME];
    if (!sessionCookie || !ENV.cookieSecret) return null;
    const { payload } = await jwtVerify(
      sessionCookie,
      new TextEncoder().encode(ENV.cookieSecret),
      { algorithms: ["HS256"] },
    );
    const exp = expToMs(payload.exp);
    if (exp) return { expiresAt: exp, source: "session-cookie" };
  } catch {
    /* expired/invalid cookie — no expiry to report */
  }
  return null;
}
