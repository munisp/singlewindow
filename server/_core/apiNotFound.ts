/**
 * JSON 404 for unmatched /api/* routes.
 * Mounted immediately BEFORE the SPA catch-all so unknown API paths return a
 * machine-readable 404 instead of HTTP 200 + SPA HTML. All legitimate Express
 * /api/* routes (trpc, upload, webhooks, scheduled, health, cep csv) are
 * registered earlier in server/_core/index.ts, so this only catches truly
 * unknown paths. /api/auth/ is excluded: those endpoints are edge-handled
 * (Caddy forward-auth) and must never be answered by the app server.
 */
import type { Express } from "express";

export function apiNotFound(app: Express) {
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: `Unknown API route: ${req.method} ${req.baseUrl}${req.path}` } });
  });
}
