/**
 * Sprint 63 — WebSocket Server for Real-Time Notifications
 * Manages authenticated WebSocket connections and broadcasts notification events.
 */
import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { Server } from "http";
import { sdk } from "./sdk";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WsNotificationEvent {
  type: "notification";
  payload: {
    id: number;
    category: string;
    title: string;
    body: string;
    entityType?: string;
    entityId?: number;
    createdAt: string;
  };
}

export interface WsUnreadCountEvent {
  type: "unread_count";
  payload: { count: number };
}

// Sprint 70 — Cargo Tracking WebSocket Push
export interface WsVesselUpdateEvent {
  type: "vessel_update";
  payload: {
    vessels: Array<{
      mmsi: string;
      vesselName: string | null;
      lat: number;
      lon: number;
      speed: number | null;
      heading: number | null;
      status: string | null;
      riskFlag: "green" | "amber" | "red" | null;
      lastUpdate: string;
    }>;
    totalCount: number;
    lastRefresh: string;
  };
}

export interface WsCargoConnectionEvent {
  type: "cargo_connected";
  payload: { message: string; refreshIntervalMs: number };
}

export type WsCargoEvent = WsVesselUpdateEvent | WsCargoConnectionEvent;

// Sprint 110 — Officer Workload Dashboard
export interface WsWorkloadEvent {
  type: "workload_update";
  payload: {
    totalPending: number;
    redLane: number;
    yellowLane: number;
    greenLane: number;
    slaBreached: number;
    updatedAt: string;
  };
}

export type WsEvent = WsNotificationEvent | WsUnreadCountEvent | WsVesselUpdateEvent | WsCargoConnectionEvent | WsWorkloadEvent;

// ─── Connection Registry ──────────────────────────────────────────────────────

// Map of userId → Set of open WebSocket connections
const connections = new Map<number, Set<WebSocket>>();

// Sprint 70: Cargo tracking subscribers (anonymous — no auth required for public vessel data)
const cargoSubscribers = new Set<WebSocket>();

export function registerCargoSubscriber(ws: WebSocket): void {
  cargoSubscribers.add(ws);
}

export function removeCargoSubscriber(ws: WebSocket): void {
  cargoSubscribers.delete(ws);
}

export function getCargoSubscriberCount(): number {
  return cargoSubscribers.size;
}

export function broadcastVesselUpdate(payload: WsVesselUpdateEvent["payload"]): void {
  const message = JSON.stringify({ type: "vessel_update", payload });
  cargoSubscribers.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    } else {
      cargoSubscribers.delete(ws);
    }
  });
}

export function registerConnection(userId: number, ws: WebSocket): void {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(ws);
}

export function removeConnection(userId: number, ws: WebSocket): void {
  const userConns = connections.get(userId);
  if (userConns) {
    userConns.delete(ws);
    if (userConns.size === 0) {
      connections.delete(userId);
    }
  }
}

export function getConnectionCount(): number {
  let total = 0;
  connections.forEach((conns) => { total += conns.size; });
  return total;
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────

export function broadcastToUser(userId: number, event: WsEvent): void {
  const userConns = connections.get(userId);
  if (!userConns || userConns.size === 0) return;
  const payload = JSON.stringify(event);
  userConns.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  });
}

export function broadcastNotification(
  userId: number,
  notification: WsNotificationEvent["payload"]
): void {
  broadcastToUser(userId, { type: "notification", payload: notification });
}

export function broadcastUnreadCount(userId: number, count: number): void {
  broadcastToUser(userId, { type: "unread_count", payload: { count } });
}

// Sprint 110: Broadcast workload update to all connected customs officers / admins
export function broadcastWorkloadUpdate(payload: WsWorkloadEvent["payload"]): void {
  const message = JSON.stringify({ type: "workload_update", payload });
  connections.forEach((conns) => {
    conns.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });
}

// ─── WebSocket Server Setup ───────────────────────────────────────────────────

export function setupWebSocketServer(httpServer: Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: "/api/ws" });

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    let userId: number | null = null;

    // Authenticate via session cookie
    try {
      const cookieHeader = req.headers.cookie ?? "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const [k, ...v] = c.trim().split("=");
          return [k.trim(), v.join("=")];
        })
      );
      const sessionToken = cookies["session"];
      if (sessionToken) {
        const payload = await sdk.verifySession(sessionToken);
        if (payload?.openId) {
          // sdk.verifySession returns { openId, appId, name } — look up DB user by openId
          const { getDb } = await import("../db");
          const { users } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            const [dbUser] = await db.select({ id: users.id }).from(users).where(eq(users.openId, payload.openId)).limit(1);
            if (dbUser) userId = dbUser.id;
          }
        }
      }
    } catch {
      // Auth failure — allow connection but userId stays null (anonymous)
    }

    if (userId !== null) {
      registerConnection(userId, ws);
      // Send a welcome ping
      ws.send(JSON.stringify({ type: "connected", payload: { userId } }));
    }

    ws.on("message", (data: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof data === "string" ? data : data.toString());
        // Handle ping/pong keepalive
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
        // Sprint 70: subscribe to cargo tracking updates
        if (msg.type === "subscribe_cargo") {
          registerCargoSubscriber(ws);
          ws.send(JSON.stringify({
            type: "cargo_connected",
            payload: { message: "Subscribed to live vessel position updates", refreshIntervalMs: 15000 },
          }));
        }
        if (msg.type === "unsubscribe_cargo") {
          removeCargoSubscriber(ws);
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      if (userId !== null) {
        removeConnection(userId, ws);
      }
      // Sprint 70: clean up cargo subscriber
      removeCargoSubscriber(ws);
    });

    ws.on("error", () => {
      if (userId !== null) {
        removeConnection(userId, ws);
      }
      removeCargoSubscriber(ws);
    });
  });

  console.log("[WS] WebSocket server initialised at /api/ws");
  return wss;
}
