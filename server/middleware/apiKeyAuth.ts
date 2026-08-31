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
 * Fail-closed: any verification failure → 401/403/429; never silently allows.
 */
import type { NextFunction, Request, Response } from "express";
import { createHmac } from "crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, apiUsageLogs } from "../../drizzle/schema";
import {
  keyHasScope,
  resolveUpstreamForKey,
  type UpstreamEndpoint,
} from "../marketplace/sandboxRouting";

declare module "express-serve-static-core" {
  interface Request {
    apiKeyContext?: {
      keyId: number;
      keyPrefix: string;
      sandboxMode: boolean;
      scopes: string[];
      upstreamHeaders: Record<string, string>;
    };
  }
}

function hashKey(rawKey: string): string | null {
  const secret = process.env.API_KEY_HASH_SECRET ?? process.env.JWT_SECRET;
  if (!secret) return null; // fail-closed: cannot verify without the secret
  return createHmac("sha256", secret).update(rawKey).digest("hex");
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
      deny(401, "Missing X-API-Key header");
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
