/**
 * WP-8 — External API key authentication + metering middleware.
 *
 * Authenticates marketplace API keys presented as `X-API-Key`, enforces:
 *   - key status (active only) and expiry
 *   - scope authorization per route
 *   - per-key sliding-window rate limit (from api_usage_logs)
 *   - sandbox routing doctrine via resolveUpstreamForKey (sandbox keys can
 *     only reach sandbox upstreams; production keys never see sandbox data)
 * and writes a metering record (api_usage_logs) per authenticated call.
 *
 * Phase 22 (API alignment): when NO X-API-Key header is present, the
 * middleware alternatively accepts `Authorization: Bearer <keycloak-jwt>`
 * verified EXACTLY the way the tRPC context verifies user tokens
 * (sdk.authenticateRequest → keycloakVerifier JWKS/RS256 + issuer/audience
 * enforcement + active-user check). The API-key path is unchanged and keeps
 * precedence when both headers are sent. Bearer-authenticated requests are
 * NOT marketplace-metered (no api key to meter against) and carry
 * `req.bearerUser` instead of `req.apiKeyContext`.
 *
 * Fail-closed: any verification failure → 401/403/429; never silently allows.
 */
import type { NextFunction, Request, Response } from "express";
import { createHmac } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, apiUsageLogs } from "../../drizzle/schema";
import { sdk } from "../_core/sdk";
import {
  keyHasScope,
  resolveUpstreamForKey,
  type UpstreamEndpoint,
} from "../marketplace/sandboxRouting";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
    apiKeyContext?: {
      keyId: number;
      keyPrefix: string;
      sandboxMode: boolean;
      scopes: string[];
      upstreamHeaders: Record<string, string>;
    };
    /** Set when the request was authenticated via a Keycloak Bearer JWT
     *  (Phase 22 alternative auth path) instead of an X-API-Key. */
    bearerUser?: {
      id: number;
      openId: string;
      role: string;
    };
    }
  }
}

function hashKey(rawKey: string): string | null {
  const secret = process.env.API_KEY_HASH_SECRET ?? process.env.JWT_SECRET;
  if (!secret) return null; // fail-closed: cannot verify without the secret
  return createHmac("sha256", secret).update(rawKey).digest("hex");
}

/**
 * Phase 22 — Bearer-token alternative auth path.
 * Verifies `Authorization: Bearer <keycloak-jwt>` with the SAME verifier the
 * tRPC context uses for user tokens (JWKS RS256 + issuer + audience + active
 * user provisioning check in sdk.authenticateRequest). Returns true and sets
 * req.bearerUser on success; false otherwise (caller denies).
 */
async function tryBearerAuth(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    // authenticateRequest verifies the Keycloak JWT (fail-closed on invalid/
    // expired/wrong-audience tokens) AND requires an active provisioned user.
    const user = await sdk.authenticateRequest(req);
    if (!user || user.status !== "active") return false;
    req.bearerUser = { id: user.id, openId: user.openId, role: user.role };
    return true;
  } catch {
    return false; // fail closed — invalid tokens never authenticate
  }
}

/**
 * Build middleware guarding an external API route.
 * @param requiredScope scope the key must hold (e.g. "reports:read")
 * @param upstream the upstream this route proxies to; undefined = unregistered
 *                 (fail-closed: nothing routes)
 */
export function requireApiKey(requiredScope: string, upstream: UpstreamEndpoint | undefined) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const startedAt = Date.now();
    const rawKey = req.header("X-API-Key");
    const deny = (status: number, error: string) => res.status(status).json({ error });

    if (!rawKey) {
      // Phase 22: no API key — accept a Bearer Keycloak JWT instead
      // (ministry-portal / mobile app contract). Fail-closed.
      if (await tryBearerAuth(req)) {
        next();
        return;
      }
      deny(401, "Missing X-API-Key header or valid Bearer token");
      return;
    }
    const keyHash = hashKey(rawKey);
    if (!keyHash) {
      deny(503, "API key verification unavailable (hash secret not configured)");
      return;
    }
    try {
      const db = await getDb();
      if (!db) {
        deny(503, "API key store unavailable");
        return;
      }
      const [key] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash));
      if (!key) {
        deny(401, "Invalid API key");
        return;
      }
      if (key.status !== "active") {
        deny(403, `API key is ${key.status}`);
        return;
      }
      if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
        deny(403, "API key has expired");
        return;
      }
      if (!keyHasScope(key.scopes, requiredScope)) {
        deny(403, `API key lacks required scope "${requiredScope}"`);
        return;
      }
      // Sandbox routing doctrine — refuse disallowed key/upstream pairs.
      const routing = resolveUpstreamForKey(
        { keyId: key.id, sandboxMode: key.sandboxMode, status: key.status },
        upstream
      );
      if (!routing.allowed) {
        deny(403, routing.reason);
        return;
      }
      // Sliding-window rate limit (metered calls in the last minute).
      const windowStart = new Date(Date.now() - 60_000);
      const usageRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(apiUsageLogs)
        .where(and(eq(apiUsageLogs.apiKeyId, key.id), gte(apiUsageLogs.createdAt, windowStart)));
      const used = Number(usageRows[0]?.count ?? 0);
      if (used >= key.rateLimit) {
        res.setHeader("Retry-After", "60");
        deny(429, "Rate limit exceeded for this API key");
        return;
      }
      // Meter the call (usage metering per key).
      await db.insert(apiUsageLogs).values({
        apiKeyId: key.id,
        endpoint: req.path,
        method: req.method,
        statusCode: 200,
        latencyMs: Date.now() - startedAt,
        sandboxMode: key.sandboxMode,
      });
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

      req.apiKeyContext = {
        keyId: key.id,
        keyPrefix: key.keyPrefix,
        sandboxMode: key.sandboxMode,
        scopes: key.scopes.split(",").map((s) => s.trim()),
        upstreamHeaders: routing.allowed ? routing.headers : {},
      };
      // Propagate sandbox marking so downstream handlers/upstreams honour it.
      if (routing.allowed && routing.headers["X-Sandbox"]) {
        res.setHeader("X-Sandbox", "true");
      }
      next();
    } catch (err) {
      deny(503, `API key verification failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  };
}
