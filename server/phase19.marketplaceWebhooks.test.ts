/**
 * phase19.marketplaceWebhooks.test.ts — Phase 19 (F1/H2) REST surface tests
 * for POST /api/marketplace/webhooks and GET .../deliveries. The api-key
 * middleware is stubbed to an authenticated key context; the DB is stubbed
 * where a query would otherwise be needed. Pins fail-closed behaviour:
 * 503 WEBHOOKS_NOT_CONFIGURED without the platform key, 400 on ungoverned
 * apiIds/topics and non-HTTPS callback URLs.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "http";

vi.mock("./middleware/apiKeyAuth", () => ({
  requireApiKey: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.apiKeyContext = {
      keyId: 42,
      keyPrefix: "bk_test",
      sandboxMode: false,
      scopes: ["webhooks:write", "webhooks:read"],
      upstreamHeaders: {},
    };
    next();
  },
}));

vi.mock("./db", () => ({
  // Non-null dummy db — request validation in the route runs before any
  // real query on the 4xx paths under test.
  getDb: vi.fn(async () => ({})),
}));

const { registerMarketplaceWebhookRoutes } = await import("./routes/marketplaceWebhooks");

let server: Server | null = null;
let base = "";

async function startApp() {
  const app = express();
  app.use(express.json());
  registerMarketplaceWebhookRoutes(app);
  server = app.listen(0);
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}

afterAll(() => server?.close());

beforeEach(async () => {
  server?.close();
  delete process.env.WEBHOOK_SECRET_KEY;
  await startApp();
});

describe("POST /api/marketplace/webhooks", () => {
  it("is fail-closed: 503 WEBHOOKS_NOT_CONFIGURED without the platform key", async () => {
    const res = await fetch(`${base}/api/marketplace/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiId: "singlewindow.declarations",
        events: ["declarations.submitted"],
        callbackUrl: "https://sub.example.com/hook",
      }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "WEBHOOKS_NOT_CONFIGURED" });
  });

  it("rejects ungoverned apiIds (400) when configured", async () => {
    process.env.WEBHOOK_SECRET_KEY = "test-platform-key-0123456789";
    const res = await fetch(`${base}/api/marketplace/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiId: "unknown.product",
        events: ["declarations.submitted"],
        callbackUrl: "https://sub.example.com/hook",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/publishes no governed webhook topics/);
  });

  it("rejects topics outside the product allowlist (400)", async () => {
    process.env.WEBHOOK_SECRET_KEY = "test-platform-key-0123456789";
    const res = await fetch(`${base}/api/marketplace/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiId: "singlewindow.declarations",
        events: ["payments.confirmed"],
        callbackUrl: "https://sub.example.com/hook",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/non-empty subset/);
  });

  it("rejects non-HTTPS callback URLs (400)", async () => {
    process.env.WEBHOOK_SECRET_KEY = "test-platform-key-0123456789";
    const res = await fetch(`${base}/api/marketplace/webhooks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiId: "singlewindow.payments",
        events: ["payments.confirmed"],
        callbackUrl: "http://sub.example.com/hook",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/HTTPS/);
  });
});
