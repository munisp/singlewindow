// TradeGateway NGSWTP — Server-Sent Events (SSE) for Anomaly Alerts
// Language: TypeScript (Node.js / Express)
//
// Provides GET /api/events/anomalies — a persistent SSE stream that pushes
// real-time anomaly alert events to authenticated admin clients.
//
// Architecture:
//   - An in-process EventEmitter (anomalyBus) acts as the pub/sub backbone.
//   - The Kafka consumer (server/kafkaConsumer.ts) emits events onto anomalyBus.
//   - Each SSE client subscribes to anomalyBus and receives events as
//     "text/event-stream" data frames.
//   - A heartbeat ping is sent every 30 seconds to keep the connection alive
//     through load balancers and proxies.
//   - Connections are cleaned up automatically on client disconnect.
//
// Security:
//   - The endpoint requires a valid short-lived SSE token (JWT) issued by
//     trpc.insiderThreat.getSSEToken. The token is passed as ?token=<jwt>.
//   - Only users with role=admin receive the token.
//
// Usage (frontend):
//   const es = new EventSource(`/api/events/anomalies?token=${sseToken}`);
//   es.addEventListener("anomaly", (e) => { const alert = JSON.parse(e.data); ... });
//   es.addEventListener("blocked", (e) => { const event = JSON.parse(e.data); ... });

import { EventEmitter } from "events";
import type { Request, Response } from "express";
import * as jose from "jose";
import { ENV } from "./_core/env";

// ─── Anomaly Event Bus ────────────────────────────────────────────────────────

/**
 * anomalyBus is the in-process pub/sub bus for insider threat events.
 * Kafka consumer emits here; SSE handler subscribes here.
 */
export const anomalyBus = new EventEmitter();
anomalyBus.setMaxListeners(500); // Support up to 500 concurrent SSE clients

// Event names on the bus
export const SSE_EVENT_ANOMALY = "anomaly";
export const SSE_EVENT_BLOCKED = "blocked";
export const SSE_EVENT_FOUR_EYES = "four_eyes";

// ─── SSE Token Utilities ──────────────────────────────────────────────────────

const SSE_TOKEN_AUDIENCE = "tradegateway-sse-anomalies";
const SSE_TOKEN_TTL_SECONDS = 300; // 5 minutes

/**
 * Issue a short-lived SSE token for an admin user.
 * Called from the tRPC insiderThreat.getSSEToken procedure.
 */
export async function issueSSEToken(userId: number, role: string): Promise<string> {
  if (role !== "admin") {
    throw new Error("Only admin users may receive SSE tokens");
  }
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  return new jose.SignJWT({ sub: String(userId), role })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(SSE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${SSE_TOKEN_TTL_SECONDS}s`)
    .sign(secret);
}

/**
 * Verify an SSE token and return the payload.
 * Returns null if the token is invalid or expired.
 */
export async function verifySSEToken(
  token: string
): Promise<{ userId: number; role: string } | null> {
  try {
    const secret = new TextEncoder().encode(ENV.cookieSecret);
    const { payload } = await jose.jwtVerify(token, secret, {
      audience: SSE_TOKEN_AUDIENCE,
    });
    if (!payload.sub || payload.role !== "admin") return null;
    return { userId: Number(payload.sub), role: payload.role as string };
  } catch {
    return null;
  }
}

// ─── SSE Handler ──────────────────────────────────────────────────────────────

/**
 * Express handler for GET /api/events/anomalies.
 * Streams anomaly alerts to authenticated admin clients via SSE.
 */
export async function anomalySSEHandler(req: Request, res: Response): Promise<void> {
  // Authenticate via short-lived SSE token in query string
  const token = req.query.token as string | undefined;
  if (!token) {
    res.status(401).json({ error: "Missing SSE token" });
    return;
  }

  const payload = await verifySSEToken(token);
  if (!payload) {
    res.status(403).json({ error: "Invalid or expired SSE token" });
    return;
  }

  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(`event: connected\ndata: ${JSON.stringify({ userId: payload.userId, ts: Date.now() })}\n\n`);

  // ── Heartbeat ──────────────────────────────────────────────────────────────
  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 30_000);

  // ── Event listeners ────────────────────────────────────────────────────────
  const onAnomaly = (data: unknown) => {
    res.write(`event: anomaly\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onBlocked = (data: unknown) => {
    res.write(`event: blocked\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const onFourEyes = (data: unknown) => {
    res.write(`event: four_eyes\ndata: ${JSON.stringify(data)}\n\n`);
  };

  anomalyBus.on(SSE_EVENT_ANOMALY, onAnomaly);
  anomalyBus.on(SSE_EVENT_BLOCKED, onBlocked);
  anomalyBus.on(SSE_EVENT_FOUR_EYES, onFourEyes);

  // ── Cleanup on disconnect ──────────────────────────────────────────────────
  req.on("close", () => {
    clearInterval(heartbeat);
    anomalyBus.off(SSE_EVENT_ANOMALY, onAnomaly);
    anomalyBus.off(SSE_EVENT_BLOCKED, onBlocked);
    anomalyBus.off(SSE_EVENT_FOUR_EYES, onFourEyes);
  });
}
