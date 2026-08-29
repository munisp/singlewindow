/**
 * dedupe.ts — Webhook replay deduplication (Phase-6 remediation)
 *
 * Records each inbound webhook delivery in the webhook_receipts table keyed by
 * (source, deliveryKey). The first delivery inserts and returns { duplicate: false };
 * replays hit the unique constraint and return { duplicate: true } so callers can
 * acknowledge the delivery (HTTP 200) without re-applying side effects.
 *
 * Fail-closed: if the dedupe record cannot be written (e.g. DB down), the caller
 * MUST treat the delivery as unprocessable — we surface the error rather than
 * letting a replay through.
 */
import crypto from "crypto";
import { getPool } from "../db";

export type WebhookSource = "oga" | "sanctions" | "cep";

/**
 * Derive a stable delivery key: prefer the provider's delivery id header,
 * otherwise a SHA-256 of the raw body (identical re-POSTs dedupe together).
 */
export function deriveDeliveryKey(deliveryIdHeader: unknown, rawBody: string): string {
  const header = typeof deliveryIdHeader === "string" ? deliveryIdHeader.trim() : "";
  if (header.length > 0 && header.length <= 200) return header;
  return `sha256:${crypto.createHash("sha256").update(rawBody).digest("hex")}`;
}

/**
 * Record a delivery. Returns true when this delivery was ALREADY recorded
 * (replay) and must not be processed again. Throws when the record cannot be
 * written — callers must convert that into a 5xx so the sender retries later.
 */
export async function isDuplicateDelivery(source: WebhookSource, deliveryKey: string): Promise<boolean> {
  const pool = getPool();
  if (!pool) throw new Error("Database unavailable — cannot verify webhook delivery");
  const { rowCount } = await pool.query(
    `INSERT INTO webhook_receipts (source, delivery_key) VALUES ($1, $2)
     ON CONFLICT ON CONSTRAINT webhook_receipts_source_key_unique DO NOTHING`,
    [source, deliveryKey]
  );
  return (rowCount ?? 0) === 0;
}
