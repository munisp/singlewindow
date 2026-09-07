/**
 * Phase 16 Wave P1 — Shipping-line marketplace REST surface (PARTNER tier).
 *
 *   GET /v1/shipping/berth-availability   — berth availability (port-interop slots)
 *   GET /v1/shipping/congestion-forecast  — port congestion forecast (ml-stack)
 *   GET /api/marketplace/specs/:product   — public OpenAPI 3.1 spec documents
 *
 * Both product endpoints are metered marketplace calls guarded by
 * requireApiKey("shipping:read") — entitlement, sandbox routing, rate limits
 * and per-key usage metering stay on the single existing middleware path.
 *
 * Fail-closed: typed errors map to honest states — config/unavailable → 503,
 * upstream 4xx → verbatim status; never fabricated availability/forecasts.
 */
import type { Express, Response } from "express";
import { requireApiKey } from "../middleware/apiKeyAuth";
import {
  getBerthAvailability,
  getCongestionForecast,
  SHIPPING_LINE_OPENAPI_SPECS,
  ShippingLineConfigError,
  ShippingLineRejectedError,
  ShippingLineUnavailableError,
} from "../marketplace/shippingLineProducts";

const PROD_UPSTREAM = { id: "shipping-line-api", sandbox: false } as const;

function mapProductError(res: Response, err: unknown): void {
  if (err instanceof ShippingLineConfigError || err instanceof ShippingLineUnavailableError) {
    res.status(503).json({ status: "down", error: err.message });
    return;
  }
  if (err instanceof ShippingLineRejectedError) {
    res.status(err.statusCode).json({ status: "down", error: err.message });
    return;
  }
  res.status(503).json({
    status: "down",
    error: err instanceof Error ? err.message : "Service unavailable",
  });
}

export function registerShippingLineApiRoutes(app: Express): void {
  // ── berth-availability (PARTNER) ────────────────────────────────────────────
  app.get(
    "/v1/shipping/berth-availability",
    requireApiKey("shipping:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        const result = await getBerthAvailability(
          {
            terminalId: String(req.query.terminal_id ?? ""),
            from: String(req.query.from ?? ""),
            to: String(req.query.to ?? ""),
          },
          req.apiKeyContext?.keyPrefix ?? "unknown"
        );
        res.json(result);
      } catch (err) {
        mapProductError(res, err);
      }
    }
  );

  // ── congestion-forecast (PARTNER) ───────────────────────────────────────────
  app.get(
    "/v1/shipping/congestion-forecast",
    requireApiKey("shipping:read", PROD_UPSTREAM),
    async (req, res) => {
      try {
        const result = await getCongestionForecast({
          portCode: String(req.query.port_code ?? ""),
          horizonHours: Number(req.query.horizon_hours ?? 24),
        });
        res.json(result);
      } catch (err) {
        mapProductError(res, err);
      }
    }
  );

  // ── Public OpenAPI spec documents for the shipping-line products ───────────
  app.get("/api/marketplace/specs/:product", (req, res) => {
    const spec = SHIPPING_LINE_OPENAPI_SPECS[req.params.product];
    if (!spec) {
      res.status(404).json({ error: `No published OpenAPI spec for product "${req.params.product}"` });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(spec);
  });
}
