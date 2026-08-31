/**
 * WP-8 — Public marketplace + KPI + status REST surface.
 *
 *   GET /api/marketplace/catalogue  — signed API catalogue (envelope v1.0)
 *   GET /api/kpis/public            — PUBLIC-classification operational KPIs
 *   GET /api/kpis/snapshot          — signed KPI snapshot export (digest + JWS)
 *   GET /api/status                 — public platform status surface
 *
 * Fail-closed doctrine:
 *  - KPI endpoints return honest 503 "down" when the DB is unavailable.
 *  - Signed exports return 503 when no signing key is configured rather than
 *    emitting an unsigned export presented as signed.
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "../db";
import { buildSignedCatalogue } from "../marketplace/apiCatalogue";
import { computeOperationalKpis, KpiServiceUnavailable } from "../marketplace/kpiService";
import { signPayloadJws, signingConfigured } from "../lib/envelopeSign";
import { canonicalizeJcs, type JsonValue } from "../lib/jcs";
import { buildHealthReport } from "./health";

export function registerMarketplacePublicRoutes(app: Express): void {
  // ── Signed API catalogue (public, tamper-evident) ──────────────────────────
  app.get("/api/marketplace/catalogue", (_req, res) => {
    try {
      const signed = buildSignedCatalogue();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(signed);
    } catch (err) {
      res.status(503).json({
        status: "down",
        error: err instanceof Error ? err.message : "Catalogue unavailable",
      });
    }
  });

  // ── Public operational KPIs ────────────────────────────────────────────────
  app.get("/api/kpis/public", async (req, res) => {
    try {
      const windowHours = Number(req.query.windowHours ?? 24);
      const report = await computeOperationalKpis(
        Number.isFinite(windowHours) ? windowHours : 24
      );
      res.json({ classification: "PUBLIC", ...report });
    } catch (err) {
      if (err instanceof KpiServiceUnavailable) {
        res.status(503).json({ status: "down", error: err.message });
        return;
      }
      res.status(500).json({
        status: "down",
        error: err instanceof Error ? err.message : "KPI computation failed",
      });
    }
  });

  // ── Signed KPI snapshot export (ministerial reporting) ────────────────────
  app.get("/api/kpis/snapshot", async (req, res) => {
    if (!signingConfigured()) {
      res.status(503).json({
        status: "down",
        error:
          "KPI snapshot export is unavailable: signing key not configured (env-only secrets policy). No unsigned export will be issued.",
      });
      return;
    }
    try {
      const windowHours = Number(req.query.windowHours ?? 24);
      const report = await computeOperationalKpis(
        Number.isFinite(windowHours) ? windowHours : 24
      );
      const snapshot = {
        envelopeVersion: "1.0",
        classification: "PUBLIC",
        purpose: "ministerial-reporting",
        producer: "singlewindow",
        ...report,
      };
      const canonical = canonicalizeJcs(snapshot as unknown as JsonValue);
      const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
      const signed = signPayloadJws({ sha256: digest, snapshot } as unknown as JsonValue, "singlewindow-0");
      res.json({
        envelopeVersion: "1.0",
        snapshot,
        sha256: digest,
        jws: signed.jws,
        kid: signed.kid,
      });
    } catch (err) {
      const status = err instanceof KpiServiceUnavailable ? 503 : 500;
      res.status(status).json({
        status: "down",
        error: err instanceof Error ? err.message : "KPI snapshot failed",
      });
    }
  });

  // ── Public platform status surface ────────────────────────────────────────
  app.get("/api/status", async (_req, res) => {
    try {
      const report = await buildHealthReport();
      // Feed staleness from the real geo feed event store (WP-10 alignment).
      let feedStatus: { feedId: string; status: "fresh" | "stale" | "no_data"; lastEventAt: string | null; ageSeconds: number | null }[] = [];
      try {
        const db = await getDb();
        if (db) {
          const rows = (await db.execute(sql`
            SELECT max(created_at) AS "lastEventAt" FROM vessel_tracking_events
          `)) as unknown as Array<{ lastEventAt: string | Date | null }>;
          const last = rows[0]?.lastEventAt ? new Date(rows[0].lastEventAt) : null;
          const ageSeconds = last ? Math.round((Date.now() - last.getTime()) / 1000) : null;
          feedStatus = [
            {
              feedId: "ais-vessel-tracking",
              status: last ? (ageSeconds! <= 900 ? "fresh" : "stale") : "no_data",
              lastEventAt: last ? last.toISOString() : null,
              ageSeconds,
            },
          ];
        }
      } catch {
        feedStatus = [{ feedId: "ais-vessel-tracking", status: "no_data", lastEventAt: null, ageSeconds: null }];
      }

      const degradedComponents = Object.entries(report.components)
        .filter(([, c]) => c.status !== "ok")
        .map(([name, c]) => ({ component: name, status: c.status, message: c.message ?? null }));
      const staleFeeds = feedStatus.filter((f) => f.status !== "fresh");

      // Honest degradation banners — only when something is actually wrong.
      const banners: string[] = [];
      if (report.status === "down") banners.push("Platform core database is unavailable. Service is down.");
      for (const c of degradedComponents) {
        if (c.status === "degraded") banners.push(`Component "${c.component}" is degraded: ${c.message ?? "no detail"}`);
      }
      for (const f of staleFeeds) {
        banners.push(
          f.status === "no_data"
            ? `Feed "${f.feedId}" has no recorded events.`
            : `Feed "${f.feedId}" is stale (last event ${f.ageSeconds}s ago).`
        );
      }

      const overall: "operational" | "degraded" | "down" =
        report.status === "down" ? "down" : banners.length > 0 ? "degraded" : "operational";

      res.status(report.status === "down" ? 503 : 200).json({
        status: overall,
        checkedAt: report.timestamp,
        version: report.version,
        uptimeSeconds: report.uptime,
        components: Object.entries(report.components).map(([name, c]) => ({
          name,
          status: c.status,
          latencyMs: c.latencyMs ?? null,
          optional: c.optional ?? false,
        })),
        feeds: feedStatus,
        banners,
      });
    } catch (err) {
      res.status(503).json({
        status: "down",
        error: err instanceof Error ? err.message : "Status check failed",
        checkedAt: new Date().toISOString(),
      });
    }
  });

  console.log("[WP-8] Marketplace/KPI/status public routes registered");
}
