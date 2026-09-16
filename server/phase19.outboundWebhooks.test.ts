/**
 * phase19.outboundWebhooks.test.ts — Phase 19 (F1: H2/H3/H4) pure-contract
 * tests for the governed outbound marketplace webhook runtime. No DB, no
 * network: pins topics allowlist, callback-URL validation, secret envelope,
 * signature format and the retry contract.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createHmac, randomBytes } from "crypto";
import {
  GOVERNED_PRODUCT_TOPICS,
  GOVERNED_TOPICS,
  RETRY_SCHEDULE_MS,
  MAX_ATTEMPTS,
  WebhooksNotConfiguredError,
  webhooksConfigured,
  generateSecret,
  hashSecret,
  encryptSecret,
  decryptSecret,
  validateCallbackUrl,
  signDelivery,
  topicsForProduct,
  isGovernedTopic,
} from "./webhooks/outbound";

const TEST_KEY = `test-platform-key-${randomBytes(16).toString("hex")}`;

beforeEach(() => {
  process.env.WEBHOOK_SECRET_KEY = TEST_KEY;
});
afterAll(() => {
  delete process.env.WEBHOOK_SECRET_KEY;
});

describe("governed plural topics (H2)", () => {
  it("declares declarations + payments plural topics per product", () => {
    expect(topicsForProduct("singlewindow.declarations")).toEqual([
      "declarations.submitted",
      "declarations.status_changed",
      "declarations.cleared",
    ]);
    expect(topicsForProduct("singlewindow.payments")).toEqual([
      "payments.initiated",
      "payments.confirmed",
      "payments.failed",
    ]);
    expect(GOVERNED_TOPICS).toHaveLength(6);
  });

  it("is fail-closed for unknown products and undeclared events", () => {
    expect(topicsForProduct("unknown.product")).toEqual([]);
    expect(isGovernedTopic("unknown.product", "declarations.submitted")).toBe(false);
    expect(isGovernedTopic("singlewindow.declarations", "declaration.submitted")).toBe(false); // singular rejected
    expect(isGovernedTopic("singlewindow.declarations", "admin.purge")).toBe(false);
    expect(isGovernedTopic("singlewindow.payments", "declarations.submitted")).toBe(false);
    expect(isGovernedTopic("singlewindow.declarations", "declarations.cleared")).toBe(true);
    expect(Object.isFrozen(GOVERNED_TOPICS)).toBe(true);
    expect(Object.keys(GOVERNED_PRODUCT_TOPICS).sort()).toEqual([
      "singlewindow.declarations",
      "singlewindow.payments",
    ]);
  });
});

describe("retry contract (H2)", () => {
  it("backs off 1m → 5m → 30m → 2h → 12h with max 6 attempts", () => {
    expect(RETRY_SCHEDULE_MS).toEqual([
      60_000,
      5 * 60_000,
      30 * 60_000,
      2 * 3600_000,
      12 * 3600_000,
    ]);
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe("callback URL validation (H2)", () => {
  it("accepts a plain HTTPS URL", () => {
    const r = validateCallbackUrl("https://subscriber.example.com/hooks/msw");
    expect(r.ok).toBe(true);
  });
  it("rejects non-HTTPS, credentials, query and fragment", () => {
    expect(validateCallbackUrl("http://subscriber.example.com/hooks").ok).toBe(false);
    expect(validateCallbackUrl("https://u:p@subscriber.example.com/hooks").ok).toBe(false);
    expect(validateCallbackUrl("https://subscriber.example.com/hooks?x=1").ok).toBe(false);
    expect(validateCallbackUrl("https://subscriber.example.com/hooks#frag").ok).toBe(false);
    expect(validateCallbackUrl("not-a-url").ok).toBe(false);
  });
});

describe("secret lifecycle (H3)", () => {
  it("generates whsec_ secrets and sha256 hashes them for at-rest lookup", () => {
    const s = generateSecret();
    expect(s).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(hashSecret(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecret(s)).not.toBe(s);
    expect(hashSecret(s)).toBe(hashSecret(s));
  });

  it("AES-256-GCM envelope round-trips and never stores plaintext", () => {
    const s = generateSecret();
    const enc = encryptSecret(s);
    expect(enc).not.toContain(s);
    expect(decryptSecret(enc)).toBe(s);
    // random IV → fresh ciphertext per encryption
    expect(encryptSecret(s)).not.toBe(enc);
  });

  it("envelope is keyed by the env-only WEBHOOK_SECRET_KEY", () => {
    const enc = encryptSecret("whsec_secret");
    process.env.WEBHOOK_SECRET_KEY = `other-${TEST_KEY}`;
    expect(() => decryptSecret(enc)).toThrow();
  });

  it("fails closed without WEBHOOK_SECRET_KEY (H4)", () => {
    delete process.env.WEBHOOK_SECRET_KEY;
    expect(webhooksConfigured()).toBe(false);
    expect(() => encryptSecret("x")).toThrow(WebhooksNotConfiguredError);
    expect(() => encryptSecret("x")).toThrow(/WEBHOOKS_NOT_CONFIGURED/);
    process.env.WEBHOOK_SECRET_KEY = "short";
    expect(webhooksConfigured()).toBe(false);
  });
});

describe("delivery signature (H2)", () => {
  it("signs sha256= HMAC over <deliveryId>.<timestamp>.<raw body>", () => {
    const secret = "whsec_abc";
    const deliveryId = "9f1c2d3e-0000-4000-8000-abcdefabcdef";
    const ts = 1789553230027;
    const body = JSON.stringify({ deliveryId, event: "declarations.submitted", data: { id: 7 } });
    const expected = `sha256=${createHmac("sha256", secret)
      .update(`${deliveryId}.${ts}.${body}`, "utf8")
      .digest("hex")}`;
    expect(signDelivery(secret, deliveryId, ts, body)).toBe(expected);
  });

  it("changes with delivery id, timestamp, body and secret", () => {
    const base = signDelivery("s1", "d1", 1, "body");
    expect(signDelivery("s2", "d1", 1, "body")).not.toBe(base);
    expect(signDelivery("s1", "d2", 1, "body")).not.toBe(base);
    expect(signDelivery("s1", "d1", 2, "body")).not.toBe(base);
    expect(signDelivery("s1", "d1", 1, "body2")).not.toBe(base);
  });
});
