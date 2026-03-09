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
import {
  createSecurityAlert,
  updateDeclaration,
  getUsersByRole,
  createUserNotification,
} from "../db";
import type { users } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";

const WEBHOOK_SECRET = process.env.SANCTIONS_WEBHOOK_SECRET || "";

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
      // ── 1. Validate shared secret ──────────────────────────────────────────
      const providedSecret = req.headers["x-sanctions-secret"] as string;
      if (WEBHOOK_SECRET && providedSecret !== WEBHOOK_SECRET) {
        console.warn(
          "[SanctionsWebhook] Rejected: invalid secret from",
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
        if (payload.declarationId) {
          await updateDeclaration(payload.declarationId, {
            status: "rejected",
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
