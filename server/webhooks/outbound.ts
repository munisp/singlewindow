/**
 * outbound.ts — Phase 19 (F1: H2/H3/H4) marketplace OUTBOUND webhook runtime.
 *
 * Implements the governed contract in
 * blueeconomy-developer-platform/marketplace/webhooks.md:
 *
 *   - Governed plural event topics per product (fail-closed product
 *     allowlist — only apiIds declared in api-registry.json with their
 *     declared webhookEvents are subscribable/emittable).
 *   - HTTPS-only callback validation (no credentials/query/fragment).
 *   - Per-subscription signing secret shown ONCE at create/rotate; at rest
 *     only sha256(secret) + an AES-256-GCM envelope keyed by the env-only
 *     platform key WEBHOOK_SECRET_KEY (H3 — never plaintext).
 *   - Delivery signature: X-BlueEconomy-Signature = "sha256=" + HMAC-SHA256
 *     over `<deliveryId>.<timestamp>.<raw body>` keyed by the raw secret.
 *   - Retry/backoff 1m → 5m → 30m → 2h → 12h, at most 5 retries after the
 *     initial attempt, same X-BlueEconomy-Delivery-Id on every attempt.
 *   - Worker-owned honest delivery log: PENDING | RETRYING | DELIVERED |
 *     EXHAUSTED with lastHttpStatus / nextRetryAt; delivered_at is set by the
 *     worker only, never at insert.
 *   - X-Sandbox: true on deliveries to sandbox-key subscriptions.
 *   - Fail-closed: without WEBHOOK_SECRET_KEY registration is refused
 *     (503 WEBHOOKS_NOT_CONFIGURED) and the worker refuses to deliver
 *     unsigned webhooks.
 */
import {
  createCipheriv, createDecipheriv, createHash, createHmac, randomBytes,
} from "crypto";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { webhookDeliveries, webhookSubscriptions } from "../../drizzle/schema";

type Db = NonNullable<Awaited<ReturnType<typeof import("../db").getDb>>>;

// ─── Governed topics (mirror of api-registry.json v1.1.0 webhookEvents) ─────
// Fail-closed product allowlist: topics outside this map cannot be subscribed
// or emitted. Adding a topic is a governed registry change first.
export const GOVERNED_PRODUCT_TOPICS: Readonly<Record<string, readonly string[]>> = {
  "singlewindow.declarations": [
    "declarations.submitted",
    "declarations.status_changed",
    "declarations.cleared",
  ],
  "singlewindow.payments": [
    "payments.initiated",
    "payments.confirmed",
    "payments.failed",
  ],
};

export const GOVERNED_TOPICS: readonly string[] = Object.freeze(
  Object.values(GOVERNED_PRODUCT_TOPICS).flat()
);

/** Topics a user-scoped (tRPC) subscription may subscribe to. */
export const SUPPORTED_EVENTS = GOVERNED_TOPICS;

export function topicsForProduct(apiId: string): readonly string[] {
  return GOVERNED_PRODUCT_TOPICS[apiId] ?? [];
}

export function isGovernedTopic(apiId: string, event: string): boolean {
  return topicsForProduct(apiId).includes(event);
}

// ─── Retry contract ──────────────────────────────────────────────────────────
export const RETRY_SCHEDULE_MS = [
  60_000,        // 1 min
  5 * 60_000,    // 5 min
  30 * 60_000,   // 30 min
  2 * 3600_000,  // 2 h
  12 * 3600_000, // 12 h
] as const;
/** Initial attempt + at most 5 retries. */
export const MAX_ATTEMPTS = 1 + RETRY_SCHEDULE_MS.length;
export const DELIVERY_TIMEOUT_MS = 10_000;

export type DeliveryStatus = "PENDING" | "RETRYING" | "DELIVERED" | "EXHAUSTED";

// ─── Platform key / fail-closed configuration ────────────────────────────────
export class WebhooksNotConfiguredError extends Error {
  constructor() {
    super("WEBHOOKS_NOT_CONFIGURED: platform webhook signing key (WEBHOOK_SECRET_KEY) is not configured");
    this.name = "WebhooksNotConfiguredError";
  }
}

export function webhooksConfigured(): boolean {
  return Boolean(process.env.WEBHOOK_SECRET_KEY && process.env.WEBHOOK_SECRET_KEY.length >= 16);
}

function platformKey(): Buffer {
  const raw = process.env.WEBHOOK_SECRET_KEY;
  if (!raw || raw.length < 16) throw new WebhooksNotConfiguredError();
  // Env-only platform layer key; any sufficiently long secret is folded to
  // the AES-256 key via sha256.
  return createHash("sha256").update(raw, "utf8").digest();
}

// ─── Secret lifecycle (H3) ───────────────────────────────────────────────────
export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** AES-256-GCM envelope: base64(iv ‖ tag ‖ ciphertext). */
export function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", platformKey(), iv);
  const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptSecret(enc: string): string {
  const raw = Buffer.from(enc, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("invalid secret envelope");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", platformKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ─── Callback URL validation (contract: HTTPS, no creds/query/fragment) ─────
export function validateCallbackUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "callbackUrl is not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "callbackUrl must be HTTPS" };
  if (u.username || u.password) return { ok: false, error: "callbackUrl must not contain credentials" };
  if (u.search) return { ok: false, error: "callbackUrl must not contain a query string" };
  if (u.hash) return { ok: false, error: "callbackUrl must not contain a fragment" };
  return { ok: true, url: u.toString() };
}

// ─── Signature (X-BlueEconomy-Signature) ─────────────────────────────────────
export function signDelivery(secret: string, deliveryId: string, timestamp: number, rawBody: string): string {
  const payload = `${deliveryId}.${timestamp}.${rawBody}`;
  return `sha256=${createHmac("sha256", secret).update(payload, "utf8").digest("hex")}`;
}

export interface DeliveryEnvelope {
  deliveryId: string;
  apiId: string;
  event: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

// ─── Subscription registration (used by the REST marketplace route) ─────────
export async function registerSubscription(
  db: Db,
  args: {
    apiId: string;
    callbackUrl: string;
    events: string[];
    apiKeyId: number | null;
    userId: number | null;
    sandboxMode: boolean;
    name?: string;
  }
): Promise<{ id: number; secret: string }> {
  if (!webhooksConfigured()) throw new WebhooksNotConfiguredError();
  const allowed = topicsForProduct(args.apiId);
  if (allowed.length === 0) {
    throw new Error(`UNKNOWN_PRODUCT: apiId "${args.apiId}" publishes no governed webhook topics`);
  }
  if (!args.events.length || !args.events.every((e) => allowed.includes(e))) {
    throw new Error(`UNKNOWN_TOPIC: events must be a non-empty subset of ${allowed.join(", ")}`);
  }
  const url = validateCallbackUrl(args.callbackUrl);
  if (!url.ok) throw new Error(url.error);
  const secret = generateSecret();
  const [row] = await db
    .insert(webhookSubscriptions)
    .values({
      userId: args.userId ?? 0,
      name: args.name ?? `${args.apiId} subscription`,
      url: url.url,
      secret: null,
      secretHash: hashSecret(secret),
      secretEnc: encryptSecret(secret),
      apiId: args.apiId,
      apiKeyId: args.apiKeyId,
      sandboxMode: args.sandboxMode,
      events: args.events,
      isActive: true,
      failureCount: 0,
    })
    .returning({ id: webhookSubscriptions.id });
  return { id: row.id, secret }; // raw secret returned ONCE
}

/** Rotate a subscription secret; returns the new raw secret once. */
export async function rotateSubscriptionSecret(db: Db, id: number): Promise<string> {
  if (!webhooksConfigured()) throw new WebhooksNotConfiguredError();
  const secret = generateSecret();
  await db
    .update(webhookSubscriptions)
    .set({
      secret: null,
      secretHash: hashSecret(secret),
      secretEnc: encryptSecret(secret),
      updatedAt: new Date(),
    })
    .where(eq(webhookSubscriptions.id, id));
  return secret;
}

// ─── Event emission (outbox enqueue) ─────────────────────────────────────────
/**
 * Enqueue a governed event for every active matching subscription. Matching:
 * subscription.apiId === apiId (marketplace subs) OR legacy user subs with no
 * apiId whose events list contains the topic. Returns the number of
 * deliveries enqueued. Never throws on unknown topics in production paths —
 * callers emit only GOVERNED_TOPICS; unknown topics return 0.
 */
export async function enqueueEvent(
  db: Db,
  args: { apiId: string; event: string; data: Record<string, unknown>; occurredAt?: Date }
): Promise<number> {
  if (!isGovernedTopic(args.apiId, args.event)) return 0;
  const subs = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.isActive, true));
  const occurredAt = (args.occurredAt ?? new Date()).toISOString();
  let enqueued = 0;
  for (const sub of subs) {
    const subApiId = sub.apiId ?? args.apiId; // legacy user subs follow the emitter's product
    if (subApiId !== args.apiId) continue;
    if (sub.apiId == null && sub.userId == null) continue;
    const events = Array.isArray(sub.events) ? (sub.events as string[]) : [];
    if (!events.includes(args.event)) continue;
    const deliveryId = crypto.randomUUID();
    const envelope: DeliveryEnvelope = {
      deliveryId,
      apiId: args.apiId,
      event: args.event,
      occurredAt,
      data: args.data,
    };
    await db.insert(webhookDeliveries).values({
      subscriptionId: sub.id,
      eventType: args.event,
      payload: envelope,
      deliveryId,
      status: "PENDING",
      sandbox: sub.sandboxMode,
      attemptCount: 0,
      success: false,
      deliveredAt: null,
    });
    enqueued++;
  }
  return enqueued;
}

// ─── Delivery worker (H4) ────────────────────────────────────────────────────
export interface DeliveryAttemptResult {
  deliveryId: string;
  outcome: "delivered" | "retrying" | "exhausted" | "skipped";
  httpStatus: number | null;
  error?: string;
}

async function attemptDelivery(
  db: Db,
  delivery: typeof webhookDeliveries.$inferSelect,
  fetchImpl: typeof fetch,
  now: Date
): Promise<DeliveryAttemptResult> {
  const [sub] = await db
    .select()
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.id, delivery.subscriptionId));
  const base = { deliveryId: delivery.deliveryId ?? String(delivery.id), httpStatus: null as number | null };
  if (!sub || !sub.isActive) {
    return { ...base, outcome: "skipped", error: "subscription inactive or missing" };
  }
  if (!webhooksConfigured() || !sub.secretEnc) {
    // Refuse to deliver unsigned webhooks — leave the row for a configured
    // future run; never fabricate a signature.
    return { ...base, outcome: "skipped", error: "webhook signing not configured" };
  }
  let secret: string;
  try {
    secret = decryptSecret(sub.secretEnc);
  } catch {
    return { ...base, outcome: "skipped", error: "subscription secret undecryptable" };
  }

  const envelope = delivery.payload as DeliveryEnvelope;
  const rawBody = JSON.stringify(envelope);
  const timestamp = Math.floor(now.getTime() / 1000);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-BlueEconomy-Delivery-Id": envelope.deliveryId,
    "X-BlueEconomy-Event": envelope.event,
    "X-BlueEconomy-Timestamp": String(timestamp),
    "X-BlueEconomy-Signature": signDelivery(secret, envelope.deliveryId, timestamp, rawBody),
  };
  if (sub.sandboxMode) headers["X-Sandbox"] = "true";

  const attemptNo = delivery.attemptCount + 1;
  let httpStatus: number | null = null;
  let error: string | undefined;
  let ok = false;
  let responseBody: string | null = null;
  try {
    const res = await fetchImpl(sub.url, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    httpStatus = res.status;
    ok = res.status >= 200 && res.status < 300;
    responseBody = (await res.text().catch(() => "")).slice(0, 1024);
  } catch (err) {
    error = err instanceof Error ? err.message : "network error";
  }

  const attempts = attemptNo;
  if (ok) {
    await db
      .update(webhookDeliveries)
      .set({
        status: "DELIVERED",
        success: true,
        attemptCount: attempts,
        lastAttemptAt: now,
        deliveredAt: now,
        lastHttpStatus: httpStatus,
        statusCode: httpStatus,
        responseBody,
        nextRetryAt: null,
      })
      .where(eq(webhookDeliveries.id, delivery.id));
    await db
      .update(webhookSubscriptions)
      .set({ lastDeliveredAt: now, failureCount: 0, updatedAt: now })
      .where(eq(webhookSubscriptions.id, sub.id));
    return { ...base, outcome: "delivered", httpStatus };
  }

  const exhausted = attempts >= MAX_ATTEMPTS;
  const nextRetryAt = exhausted ? null : new Date(now.getTime() + RETRY_SCHEDULE_MS[attempts - 1]);
  await db
    .update(webhookDeliveries)
    .set({
      status: exhausted ? "EXHAUSTED" : "RETRYING",
      success: false,
      attemptCount: attempts,
      lastAttemptAt: now,
      lastHttpStatus: httpStatus,
      statusCode: httpStatus,
      responseBody: responseBody ?? error ?? null,
      nextRetryAt,
    })
    .where(eq(webhookDeliveries.id, delivery.id));
  await db
    .update(webhookSubscriptions)
    .set({ failureCount: (sub.failureCount ?? 0) + 1, updatedAt: now })
    .where(eq(webhookSubscriptions.id, sub.id));
  return { ...base, outcome: exhausted ? "exhausted" : "retrying", httpStatus, error };
}

let workerRunning = false;

/**
 * Process all due deliveries (PENDING, or RETRYING with nextRetryAt <= now).
 * Overlap-guarded: a second concurrent tick returns immediately. Refuses to
 * run at all when signing is not configured (never delivers unsigned).
 */
export async function processDueDeliveries(
  db: Db,
  opts: { fetchImpl?: typeof fetch; now?: Date; limit?: number } = {}
): Promise<{ processed: number; results: DeliveryAttemptResult[]; skippedReason?: string }> {
  if (workerRunning) return { processed: 0, results: [], skippedReason: "overlap" };
  if (!webhooksConfigured()) return { processed: 0, results: [], skippedReason: "not_configured" };
  workerRunning = true;
  try {
    const now = opts.now ?? new Date();
    const due = await db
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          or(eq(webhookDeliveries.status, "PENDING"), eq(webhookDeliveries.status, "RETRYING")),
          or(isNull(webhookDeliveries.nextRetryAt), lte(webhookDeliveries.nextRetryAt, now))
        )
      )
      .limit(opts.limit ?? 25);
    const results: DeliveryAttemptResult[] = [];
    for (const d of due) {
      results.push(await attemptDelivery(db, d, opts.fetchImpl ?? fetch, now));
    }
    return { processed: results.length, results };
  } finally {
    workerRunning = false;
  }
}

/** Test hook: reset the overlap guard. */
export function __resetWorkerGuard(): void {
  workerRunning = false;
}
