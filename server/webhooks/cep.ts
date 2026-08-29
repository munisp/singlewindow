/**
 * POST /api/webhooks/cep-event — Flink CEP Alert Webhook
 *
 * Receives real-time Complex Event Processing (CEP) alerts from the Apache Flink
 * job and inserts them into the cep_alerts table, enabling live alert streaming
 * to the PWA FlinkCepAlerts dashboard without polling.
 *
 * Security:
 *   - HMAC-SHA256 signature verification via X-CEP-Signature header.
 *   - Shared secret configured via CEP_WEBHOOK_SECRET environment variable.
 *   - Falls back to a dev-only default when the env var is absent.
 *
 * Payload schema follows the WCO Risk Management Compendium Vol 1 alert format.
 * The Flink job should POST to this endpoint immediately after a CEP pattern fires.
 *
 * After insertion the endpoint:
 *   1. Updates the parent pattern's trigger_count and last_triggered_at.
 *   2. Sends an owner notification for critical-severity alerts.
 *   3. Returns 201 with the inserted alert_id.
 */

import express, { Request, Response } from "express";
import crypto from "crypto";
import { getPool } from "../db";
import { notifyOwner } from "../_core/notification";
import { getWebhookSecret } from "../_core/webhookSecretsValidator";
import { deriveDeliveryKey, isDuplicateDelivery } from "./dedupe";

// Boot-fatal in production when unset or a known dev value (getWebhookSecret
// throws); in development the dev default is used with a loud warning.
const CEP_WEBHOOK_SECRET = getWebhookSecret("CEP_WEBHOOK_SECRET", "tradegateway-cep-webhook-secret-dev");

// ─── Signature verification ───────────────────────────────────────────────────
function verifySignature(rawBody: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", CEP_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  const provided = signature.replace(/^sha256=/, "");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Payload schema (WCO Risk Management Compendium Vol 1 compatible) ─────────
interface CepEventPayload {
  /** WCO pattern identifier, e.g. "WCO-CEP-001" */
  patternId: string;
  /** Human-readable pattern name */
  patternName: string;
  /** Severity: critical | high | medium | low */
  severity: "critical" | "high" | "medium" | "low";
  /**
   * Structured evidence object — contents depend on the pattern type.
   * Examples: { trader, declarations[], hs_code } for split shipment,
   *           { vessel, mmsi, ports_transited[] } for port hopping.
   */
  details: Record<string, unknown>;
  /**
   * Risk score 0-100 calculated by the Flink ML risk model.
   * Higher scores indicate greater confidence in the alert.
   */
  riskScore: number;
  /** ISO 8601 timestamp when the pattern was triggered */
  detectedAt?: string;
}

// ─── Route registration ───────────────────────────────────────────────────────
export function registerCepWebhookRoute(app: express.Application) {
  /**
   * POST /api/webhooks/cep-event
   *
   * Headers:
   *   Content-Type: application/json
   *   X-CEP-Signature: sha256=<hmac>
   *
   * Body: CepEventPayload (JSON)
   *
   * Responses:
   *   201 { alertId, patternId, severity, riskScore, insertedAt }
   *   400 { error: "..." }   — validation failure
   *   401 { error: "..." }   — signature mismatch
   *   500 { error: "..." }   — database error
   */
  app.post(
    "/api/webhooks/cep-event",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      // ── 1. Signature verification ──────────────────────────────────────────
      const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : "";
      const signature = String(req.headers["x-cep-signature"] ?? "");

      // A valid HMAC signature is ALWAYS required (fail closed) — an unsigned
      // or badly-signed event must never create alerts.
      if (!signature || !verifySignature(rawBody, signature)) {
        res.status(401).json({ error: "Invalid or missing X-CEP-Signature" });
        return;
      }

      // ── 2. Parse & validate payload ────────────────────────────────────────
      let payload: CepEventPayload;
      try {
        payload = JSON.parse(rawBody || "{}") as CepEventPayload;
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      const { patternId, patternName, severity, details, riskScore, detectedAt } = payload;

      if (!patternId || typeof patternId !== "string") {
        res.status(400).json({ error: "patternId is required (string)" });
        return;
      }
      if (!patternName || typeof patternName !== "string") {
        res.status(400).json({ error: "patternName is required (string)" });
        return;
      }
      if (!["critical", "high", "medium", "low"].includes(severity)) {
        res.status(400).json({ error: "severity must be critical | high | medium | low" });
        return;
      }
      if (typeof riskScore !== "number" || riskScore < 0 || riskScore > 100) {
        res.status(400).json({ error: "riskScore must be a number between 0 and 100" });
        return;
      }
      if (!details || typeof details !== "object") {
        res.status(400).json({ error: "details must be a non-null object" });
        return;
      }

      // ── 2b. Replay dedupe by delivery id (or body hash) ────────────────────
      const deliveryKey = deriveDeliveryKey(req.headers["x-cep-delivery-id"], rawBody);
      try {
        if (await isDuplicateDelivery("cep", deliveryKey)) {
          res.status(200).json({ received: true, duplicate: true, message: "Delivery already processed" });
          return;
        }
      } catch (dedupeErr) {
        console.error("[CEP Webhook] Dedupe store unavailable:", dedupeErr);
        res.status(503).json({ error: "Delivery verification unavailable — retry later" });
        return;
      }

      // ── 3. Generate alert ID (CEP-YYYY-NNNN) from a DB sequence ────────────
      // A sequence avoids the COUNT(*)+1 race that produced duplicate alert_ids
      // under concurrent deliveries.
      const pool = getPool();
      if (!pool) {
        res.status(500).json({ error: "Database unavailable" });
        return;
      }

      const year = new Date().getFullYear();
      const { rows: seqRows } = await pool.query(`SELECT nextval('cep_alert_seq') AS seq`);
      const seqVal = seqRows[0]?.seq;
      if (seqVal == null) {
        res.status(500).json({ error: "Failed to allocate alert id" });
        return;
      }
      const alertId = `CEP-${year}-${String(seqVal).padStart(4, "0")}`;

      const detectedAtTs = detectedAt ? new Date(detectedAt) : new Date();

      // ── 4. Insert alert into cep_alerts ────────────────────────────────────
      try {
        await pool.query(
          `INSERT INTO cep_alerts
             (alert_id, pattern_id, pattern_name, severity, status, details, risk_score, detected_at)
           VALUES ($1, $2, $3, $4, 'open', $5, $6, $7)`,
          [
            alertId,
            patternId,
            patternName,
            severity,
            JSON.stringify(details),
            riskScore,
            detectedAtTs,
          ]
        );
      } catch (dbErr: any) {
        console.error("[CEP Webhook] DB insert error:", dbErr?.message);
        res.status(500).json({ error: "Failed to persist alert" });
        return;
      }

      // ── 5. Update parent pattern trigger_count + last_triggered_at ─────────
      try {
        await pool.query(
          `UPDATE cep_patterns
           SET trigger_count = trigger_count + 1,
               last_triggered_at = $1,
               updated_at = NOW()
           WHERE pattern_id = $2`,
          [detectedAtTs, patternId]
        );
      } catch (updateErr: any) {
        // Non-fatal — alert was already inserted; log and continue.
        console.warn("[CEP Webhook] Pattern update warning:", updateErr?.message);
      }

      // ── 6. Owner notification for critical alerts ──────────────────────────
      if (severity === "critical") {
        try {
          const traderInfo =
            typeof details.trader === "string"
              ? ` — Trader: ${details.trader}`
              : "";
          await notifyOwner({
            title: `🚨 Critical CEP Alert: ${patternName}`,
            content:
              `Alert ID: ${alertId}\n` +
              `Pattern: ${patternId} — ${patternName}\n` +
              `Risk Score: ${riskScore}/100${traderInfo}\n` +
              `Detected: ${detectedAtTs.toISOString()}\n` +
              `Details: ${JSON.stringify(details, null, 2)}`,
          });
        } catch (notifyErr: any) {
          // Non-fatal — alert is persisted; notification is best-effort.
          console.warn("[CEP Webhook] Owner notification failed:", notifyErr?.message);
        }
      }

      // ── 7. Respond 201 ─────────────────────────────────────────────────────
      res.status(201).json({
        alertId,
        patternId,
        severity,
        riskScore,
        insertedAt: detectedAtTs.toISOString(),
        message: "CEP alert persisted successfully",
      });
    }
  );
}
