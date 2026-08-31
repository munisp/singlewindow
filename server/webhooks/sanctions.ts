/**
 * sanctions.ts — Real-time sanctions hit webhook
 *
 * Receives POST /api/webhooks/sanctions-hit from the Python sanctions-service
 * when a trader or consignee matches a UN/OFAC/EU sanctions list entry.
 *
 * On receipt:
 *  1. Validates the shared secret header (SANCTIONS_WEBHOOK_SECRET)
 *  2. Creates a SecurityAlert DB record (type: sanctions_hit)
 *  3. Updates the related declaration status to "held_sanctions"
 *  4. Pushes an in-app notification to all security officers
 *  5. Notifies the platform owner via the built-in notification API
 */

import type { Express, Request, Response } from "express";
import crypto from "crypto";
import {
  createSecurityAlert,
  updateDeclaration,
  getUsersByRole,
  createUserNotification,
} from "../db";
import type { users } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { getWebhookSecret } from "../_core/webhookSecretsValidator";
import { isDuplicateDelivery } from "./dedupe";

// Boot-fatal in production when unset or a known dev value (getWebhookSecret
// throws); in development the dev default is used with a loud warning.
const WEBHOOK_SECRET = getWebhookSecret("SANCTIONS_WEBHOOK_SECRET", "tradegateway-sanctions-webhook-secret-dev");

/** Timing-safe shared-secret comparison (never early-exit on mismatch). */
function secretsEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    // Compare against self to keep timing roughly constant, then fail.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

interface SanctionsHitPayload {
  declarationId?: number;
  traderId?: number;
  entityName: string;
  matchedList: "UN" | "OFAC" | "EU" | "INTERPOL" | "LOCAL";
  matchScore: number; // 0-1 Jaro-Winkler similarity
  matchedEntry: string;
  screeningId: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

export function registerSanctionsWebhookRoute(app: Express): void {
  app.post(
    "/api/webhooks/sanctions-hit",
    async (req: Request, res: Response) => {
      // ── 1. Validate shared secret (always required, timing-safe) ──────────
      const providedSecret = (req.headers["x-sanctions-secret"] as string) ?? "";
      if (!providedSecret || !secretsEqual(providedSecret, WEBHOOK_SECRET)) {
        console.warn(
          "[SanctionsWebhook] Rejected: invalid or missing secret from",
          req.ip
        );
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const payload = req.body as SanctionsHitPayload;

      if (!payload.entityName || !payload.matchedList || !payload.screeningId) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      // ── 1b. Replay dedupe by screeningId ──────────────────────────────────
      try {
        if (await isDuplicateDelivery("sanctions", payload.screeningId)) {
          res.status(200).json({ received: true, duplicate: true, message: "Screening result already processed" });
          return;
        }
      } catch (dedupeErr) {
        console.error("[SanctionsWebhook] Dedupe store unavailable:", dedupeErr);
        res.status(503).json({ error: "Delivery verification unavailable — retry later" });
        return;
      }

      console.log(
        `[SanctionsWebhook] Hit received: ${payload.entityName} matched ${payload.matchedList} (score: ${payload.matchScore})`
      );

      try {
        // ── 2. Create SecurityAlert DB record ──────────────────────────────
        const alert = await createSecurityAlert({
          alertId: payload.screeningId,
          severity: payload.matchScore >= 0.95 ? "critical" : "high",
          category: "compliance",
          title: `Sanctions Hit — ${payload.matchedList}`,
          description: `Entity "${payload.entityName}" matched "${payload.matchedEntry}" on the ${payload.matchedList} sanctions list (similarity: ${(payload.matchScore * 100).toFixed(1)}%).`,
          rawEvent: {
            screeningId: payload.screeningId,
            matchedList: payload.matchedList,
            matchScore: payload.matchScore,
            matchedEntry: payload.matchedEntry,
            timestamp: payload.timestamp,
            ...payload.details,
          },
          targetService: "sanctions-service",
        });

        // ── 3. Hold the declaration if one is referenced ───────────────────
        // A sanctions hit is NOT a rejection: the declaration is placed in the
        // real 'held_sanctions' status pending compliance officer adjudication.
        if (payload.declarationId) {
          await updateDeclaration(payload.declarationId, {
            status: "held_sanctions",
          }).catch((e) =>
            console.warn("[SanctionsWebhook] Could not update declaration:", e)
          );
        }

        // ── 4. Notify all security officers ───────────────────────────────
        const securityOfficers = await getUsersByRole("security_officer").catch(
          () => [] as Array<typeof users.$inferSelect>
        );

        await Promise.allSettled(
          securityOfficers.map((officer: typeof users.$inferSelect) =>
            createUserNotification({
              userId: officer.id,
              type: "sanctions_hit",
              title: `🚨 Sanctions Hit — ${payload.matchedList}`,
              body: `"${payload.entityName}" matched "${payload.matchedEntry}" (${(payload.matchScore * 100).toFixed(1)}% confidence). Declaration ${payload.declarationId ? `#${payload.declarationId}` : "N/A"} has been placed on hold.`,
              declarationId: payload.declarationId,
            })
          )
        );

        // ── 5. Notify platform owner ───────────────────────────────────────
        await notifyOwner({
          title: `Sanctions Hit — ${payload.matchedList}`,
          content: `Entity "${payload.entityName}" matched "${payload.matchedEntry}" on the ${payload.matchedList} list (score: ${(payload.matchScore * 100).toFixed(1)}%). Alert ID: ${alert?.id ?? "N/A"}. Declaration ${payload.declarationId ? `#${payload.declarationId} placed on hold` : "no declaration referenced"}.`,
        }).catch(() => {});

        res.status(200).json({
          received: true,
          alertId: alert?.id,
          declarationHeld: !!payload.declarationId,
          officersNotified: securityOfficers.length,
        });
      } catch (err) {
        console.error("[SanctionsWebhook] Processing error:", err);
        res.status(500).json({ error: "Internal processing error" });
      }
    }
  );
}
