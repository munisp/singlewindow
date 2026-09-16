/**
 * marketplaceWebhooks.ts — Phase 19 (F1/H2): governed REST surface for
 * marketplace webhook subscriptions, implementing
 * blueeconomy-developer-platform/marketplace/webhooks.md:
 *
 *   POST /api/marketplace/webhooks                 — register a subscription
 *   GET  /api/marketplace/webhooks/{id}/deliveries — honest delivery log
 *
 * Both endpoints are API-key scoped (requireApiKey, metered via
 * api_usage_logs like every other marketplace route). The subscription is
 * bound to the registering key: the delivery log of a subscription is only
 * visible to the key that created it. Registration is fail-closed:
 *   - 503 WEBHOOKS_NOT_CONFIGURED when the platform has no webhook signing
 *     key (never registers a subscription it cannot sign for);
 *   - 400 for non-HTTPS callback URLs, ungoverned apiIds or topics.
 * The signing secret is returned exactly once in the creation response and
 * stored hashed + AES-256-GCM encrypted at rest (H3).
 */
import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { webhookDeliveries, webhookSubscriptions } from "../../drizzle/schema";
import { requireApiKey } from "../middleware/apiKeyAuth";
import {
  registerSubscription,
  topicsForProduct,
  validateCallbackUrl,
  WebhooksNotConfiguredError,
  webhooksConfigured,
} from "../webhooks/outbound";

const PROD_UPSTREAM = { id: "marketplace-webhooks", sandbox: false } as const;

export function registerMarketplaceWebhookRoutes(app: Express): void {
  app.post(
    "/api/marketplace/webhooks",
    requireApiKey("webhooks:write", PROD_UPSTREAM),
    async (req, res) => {
      if (!webhooksConfigured()) {
        res.status(503).json({ error: "WEBHOOKS_NOT_CONFIGURED" });
        return;
      }
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      const body = (req.body ?? {}) as { apiId?: unknown; events?: unknown; callbackUrl?: unknown };
      const apiId = typeof body.apiId === "string" ? body.apiId : "";
      const events = Array.isArray(body.events) ? body.events.filter((e): e is string => typeof e === "string") : [];
      const callbackUrl = typeof body.callbackUrl === "string" ? body.callbackUrl : "";
      const allowed = topicsForProduct(apiId);
      if (!allowed.length) {
        res.status(400).json({ error: `apiId "${apiId}" publishes no governed webhook topics` });
        return;
      }
      if (!events.length || !events.every((e) => allowed.includes(e))) {
        res.status(400).json({ error: `events must be a non-empty subset of: ${allowed.join(", ")}` });
        return;
      }
      const url = validateCallbackUrl(callbackUrl);
      if (!url.ok) {
        res.status(400).json({ error: url.error });
        return;
      }
      try {
        const ctx = req.apiKeyContext!;
        const { apiKeys } = await import("../../drizzle/schema");
        const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, ctx.keyId));
        const { id, secret } = await registerSubscription(db, {
          apiId,
          callbackUrl: url.url,
          events,
          apiKeyId: ctx.keyId,
          userId: key?.userId ?? null,
          sandboxMode: ctx.sandboxMode,
        });
        res.status(201).json({
          id,
          apiId,
          events,
          callbackUrl: url.url,
          sandbox: ctx.sandboxMode,
          // Returned exactly once — only the hash + envelope exist at rest.
          secret,
          signatureHeader: "X-BlueEconomy-Signature",
          signatureScheme: "sha256=HMAC-SHA256(<deliveryId>.<timestamp>.<raw body>)",
        });
      } catch (err) {
        if (err instanceof WebhooksNotConfiguredError) {
          res.status(503).json({ error: "WEBHOOKS_NOT_CONFIGURED" });
          return;
        }
        res.status(400).json({ error: err instanceof Error ? err.message : "registration failed" });
      }
    }
  );

  app.get(
    "/api/marketplace/webhooks/:id/deliveries",
    requireApiKey("webhooks:read", PROD_UPSTREAM),
    async (req, res) => {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "Database unavailable" });
        return;
      }
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ error: "invalid subscription id" });
        return;
      }
      const [sub] = await db
        .select()
        .from(webhookSubscriptions)
        .where(and(eq(webhookSubscriptions.id, id), eq(webhookSubscriptions.apiKeyId, req.apiKeyContext!.keyId)));
      if (!sub) {
        res.status(404).json({ error: "subscription not found" });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
      const rows = await db
        .select()
        .from(webhookDeliveries)
        .where(eq(webhookDeliveries.subscriptionId, id))
        .orderBy(desc(webhookDeliveries.id))
        .limit(limit);
      res.json({
        subscriptionId: id,
        apiId: sub.apiId,
        deliveries: rows.map((r) => ({
          deliveryId: r.deliveryId,
          event: r.eventType,
          status: r.status,
          attemptCount: r.attemptCount,
          lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
          lastHttpStatus: r.lastHttpStatus,
          nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
          deliveredAt: r.deliveredAt?.toISOString() ?? null,
          sandbox: r.sandbox,
        })),
      });
    }
  );
}
