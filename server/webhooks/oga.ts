/**
 * POST /api/webhooks/oga — OGA Approval Callback Webhook
 *
 * Receives real-time approval/rejection callbacks from Other Government Agencies
 * (FDA, EPA, MOH, MOAG, GSA, etc.) and updates the oga_permits table.
 *
 * Security: HMAC-SHA256 signature verification via X-OGA-Signature header.
 * Payload schema follows the WCO Single Window Message Standard (SWMS) v2.1.
 */
import express, { Request, Response } from "express";
import crypto from "crypto";
import { getDb } from "../db";
import { ogaPermits, declarations } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { getWebhookSecret } from "../_core/webhookSecretsValidator";
import { deriveDeliveryKey, isDuplicateDelivery } from "./dedupe";

// Boot-fatal in production when OGA_WEBHOOK_SECRET is unset or a known dev value
// (getWebhookSecret throws); in development the dev default is used with a warning.
const OGA_WEBHOOK_SECRET = getWebhookSecret("OGA_WEBHOOK_SECRET", "tradegateway-oga-webhook-secret-dev");

// Verify HMAC-SHA256 signature from OGA system
function verifySignature(payload: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", OGA_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature.replace("sha256=", ""), "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

// OGA callback payload schema (WCO SWMS v2.1 compatible)
interface OGACallbackPayload {
  /** OGA agency code (FDA, EPA, MOH, etc.) */
  agencyCode: string;
  /** TradeGateway declaration ID */
  declarationId: number;
  /** Permit reference number assigned by OGA */
  permitRef?: string;
  /** Decision: approved | rejected | more_info_required | conditional */
  decision: "approved" | "rejected" | "more_info_required" | "conditional";
  /** ISO 8601 timestamp of decision */
  decidedAt: string;
  /** Officer who made the decision */
  officerName?: string;
  /** Conditions or rejection reason */
  remarks?: string;
  /** Conditions attached to conditional approval */
  conditions?: string[];
}

export function registerOgaWebhookRoute(app: express.Application) {
  // Raw body capture for signature verification
  app.post(
    "/api/webhooks/oga",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const rawBody = req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
      const signature = (req.headers["x-oga-signature"] as string) ?? "";

      // A valid HMAC signature is ALWAYS required — an unsigned or badly-signed
      // callback must never update permit or declaration state (fail closed).
      if (!signature || !verifySignature(rawBody, signature)) {
        return res.status(401).json({ error: "Invalid or missing X-OGA-Signature" });
      }

      let payload: OGACallbackPayload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return res.status(400).json({ error: "Invalid JSON payload" });
      }

      // Validate required fields
      if (!payload.agencyCode || !payload.declarationId || !payload.decision || !payload.decidedAt) {
        return res.status(400).json({
          error: "Missing required fields: agencyCode, declarationId, decision, decidedAt",
        });
      }

      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database unavailable" });

      try {
        // Replay dedupe: keyed by the provider delivery id (or a body hash) so a
        // redelivered decision is acknowledged without re-applying side effects.
        const deliveryKey = deriveDeliveryKey(req.headers["x-oga-delivery-id"], rawBody);
        let duplicate: boolean;
        try {
          duplicate = await isDuplicateDelivery("oga", deliveryKey);
        } catch (dedupeErr) {
          console.error("[OGA Webhook] Dedupe store unavailable:", dedupeErr);
          return res.status(503).json({ error: "Delivery verification unavailable — retry later" });
        }
        if (duplicate) {
          return res.status(200).json({ ok: true, duplicate: true, message: "Delivery already processed" });
        }

        // Find the matching OGA permit
        const [permit] = await db
          .select()
          .from(ogaPermits)
          .where(
            and(
              eq(ogaPermits.declarationId, payload.declarationId),
              eq(ogaPermits.agencyCode, payload.agencyCode)
            )
          )
          .limit(1);

        if (!permit) {
          return res.status(404).json({
            error: `No OGA permit found for declarationId=${payload.declarationId} agencyCode=${payload.agencyCode}`,
          });
        }

        // Map OGA decision to permit_status enum value
        const statusMap: Record<OGACallbackPayload["decision"], "pending" | "under_review" | "approved" | "rejected" | "not_required"> = {
          approved: "approved",
          rejected: "rejected",
          more_info_required: "under_review",
          conditional: "approved",
        };

        const newStatus = statusMap[payload.decision];
        const decidedAt = new Date(payload.decidedAt);

        // Build remarks string
        const remarksArr = [
          payload.remarks,
          payload.conditions?.length ? `Conditions: ${payload.conditions.join("; ")}` : null,
        ].filter((r): r is string => Boolean(r));

        // Update the OGA permit record
        await db
          .update(ogaPermits)
          .set({
            status: newStatus,
            permitNumber: payload.permitRef ?? permit.permitNumber,
            respondedAt: (newStatus === "approved" || newStatus === "rejected") ? decidedAt : null,
            reviewNotes: remarksArr.join(" | ") || null,
            updatedAt: new Date(),
          })
          .where(eq(ogaPermits.id, permit.id));

        // Check if all OGA permits for this declaration are now resolved
        const allPermits = await db
          .select()
          .from(ogaPermits)
          .where(eq(ogaPermits.declarationId, payload.declarationId));

        const allApproved = allPermits.every((p) =>
          p.id === permit.id ? newStatus === "approved" : p.status === "approved"
        );
        const anyRejected = allPermits.some((p) =>
          p.id === permit.id ? newStatus === "rejected" : p.status === "rejected"
        );

        // Update declaration status if all OGAs have responded
        if (anyRejected) {
          await db
            .update(declarations)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(eq(declarations.id, payload.declarationId));

          notifyOwner({
            title: `Declaration #${payload.declarationId} Rejected by ${payload.agencyCode}`,
            content: `OGA ${payload.agencyCode} rejected declaration #${payload.declarationId}. Reason: ${payload.remarks ?? "Not specified"}`,
          }).catch(() => {});
        } else if (allApproved) {
          await db
            .update(declarations)
            .set({ status: "cleared", updatedAt: new Date() })
            .where(eq(declarations.id, payload.declarationId));

          notifyOwner({
            title: `Declaration #${payload.declarationId} Fully Cleared`,
            content: `All ${allPermits.length} OGA permits approved. Declaration #${payload.declarationId} is now cleared.`,
          }).catch(() => {});
        }

        console.log(
          `[OGA Webhook] declarationId=${payload.declarationId} agency=${payload.agencyCode} decision=${payload.decision} by=${payload.officerName ?? "system"}`
        );

        return res.status(200).json({
          ok: true,
          permitId: permit.id,
          declarationId: payload.declarationId,
          agencyCode: payload.agencyCode,
          newStatus,
          allApproved,
          anyRejected,
          message: allApproved
            ? "All OGA permits approved — declaration cleared"
            : anyRejected
            ? "Declaration rejected by OGA"
            : "Permit updated — awaiting remaining OGA responses",
        });
      } catch (err) {
        console.error("[OGA Webhook] Error processing callback:", err);
        return res.status(500).json({ error: "Internal server error processing OGA callback" });
      }
    }
  );

  // GET /api/webhooks/oga/health — health check for OGA systems
  app.get("/api/webhooks/oga/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "TradeGateway OGA Webhook Receiver",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      endpoints: {
        callback: "POST /api/webhooks/oga",
        health: "GET /api/webhooks/oga/health",
      },
      supportedDecisions: ["approved", "rejected", "more_info_required", "conditional"],
      supportedAgencies: ["FDA", "EPA", "MOH", "MOFA", "MOTI", "MOAG", "MOEN", "NCA", "CEPS", "DVLA", "GSA", "GIPC"],
    });
  });
}
