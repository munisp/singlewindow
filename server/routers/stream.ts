/**
 * stream.ts — tRPC router for the Fluvio real-time cargo event stream (Sprint 34)
 *
 * Proxies to the Go fluvio-consumer service (port 8093) which subscribes to
 * the "cargo-events" Fluvio topic and maintains a WebSocket hub + ring buffer.
 *
 * Procedures:
 *   stream.getRecentEvents      — get last N events from ring buffer (optional declarationId filter)
 *   stream.getServiceStatus     — get fluvio-consumer health
 *   stream.publishTestEvent     — inject a synthetic event (dev/test only)
 *   stream.getWebSocketUrl      — get the WebSocket URL for browser direct connection
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";

const FLUVIO_SVC_URL = process.env.FLUVIO_SVC_URL || "http://localhost:8093";
const FLUVIO_WS_URL = process.env.FLUVIO_WS_URL || "ws://localhost:8093";

async function fluvioAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${FLUVIO_SVC_URL}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const streamRouter = router({
  /**
   * Get recent cargo events from the ring buffer.
   * Optionally filter by declarationId.
   */
  getRecentEvents: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(500).default(50),
      declarationId: z.number().optional(),
    }))
    .query(async ({ input }) => {
      const available = await fluvioAvailable();
      if (!available) {
        return { events: [], count: 0, source: "unavailable", unavailable: true, reason: "Fluvio consumer unavailable" };
      }
      const params = new URLSearchParams({ limit: String(input.limit) });
      if (input.declarationId) params.set("declarationId", String(input.declarationId));
      const res = await fetch(`${FLUVIO_SVC_URL}/api/stream/events?${params}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Fluvio consumer error (${res.status})`,
        });
      }
      const data = await res.json() as { events: object[]; count: number };
      return { ...data, source: "live" };
    }),

  /**
   * Get the WebSocket URL for direct browser connection.
   * The browser uses this URL to open a persistent WebSocket to the
   * fluvio-consumer service, receiving events in real time.
   */
  getWebSocketUrl: protectedProcedure
    .input(z.object({ declarationId: z.number().optional() }))
    .query(async ({ input }) => {
      const available = await fluvioAvailable();
      const params = input.declarationId
        ? `?declarationId=${input.declarationId}`
        : "";
      return {
        available,
        wsUrl: available ? `${FLUVIO_WS_URL}/api/stream/ws${params}` : null,
        httpUrl: `${FLUVIO_SVC_URL}/api/stream/events${params}`,
        pollingIntervalMs: available ? null : 5_000,
      };
    }),

  /**
   * Get the health status of the fluvio-consumer service.
   */
  getServiceStatus: protectedProcedure.query(async () => {
    const available = await fluvioAvailable();
    if (!available) {
      return {
        available: false,
        topic: "cargo-events",
        mode: "unavailable",
        message: "Fluvio consumer is unavailable",
      };
    }
    const res = await fetch(`${FLUVIO_SVC_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    const data = await res.json() as Record<string, unknown>;
    return { available: true, mode: "live", ...data };
  }),

  /**
   * Inject a synthetic event into the ring buffer (dev/test only).
   */
  publishTestEvent: protectedProcedure
    .input(z.object({
      eventType: z.string().min(1),
      declarationId: z.number().optional(),
      ucr: z.string().optional(),
      containerRef: z.string().optional(),
      portCode: z.string().optional(),
      message: z.string().optional(),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("INFO"),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const available = await fluvioAvailable();
      if (!available) {
        throw new TRPCError({
          code: "SERVICE_UNAVAILABLE",
          message: "Fluvio consumer is offline — cannot publish test events",
        });
      }
      const event = {
        event_id: `TEST-${Date.now()}`,
        event_type: input.eventType,
        declaration_id: input.declarationId ?? null,
        ucr: input.ucr ?? "",
        container_ref: input.containerRef ?? "",
        port_code: input.portCode ?? "GHTEM",
        location: "Test Location",
        actor: `admin:${ctx.user.id}`,
        message: input.message ?? `Test event: ${input.eventType}`,
        severity: input.severity,
        timestamp: new Date().toISOString(),
        partition: 0,
        offset: -1,
      };
      const res = await fetch(`${FLUVIO_SVC_URL}/api/stream/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to publish test event (${res.status})`,
        });
      }
      return res.json();
    }),
});
