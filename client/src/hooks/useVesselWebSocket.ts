/**
 * Sprint 70 — Cargo Tracking WebSocket Real-Time Push
 *
 * useVesselWebSocket: subscribes to the /api/ws channel and listens for
 * "vessel_update" events broadcast by the server every 15 seconds.
 *
 * Graceful fallback: if WebSocket is unavailable or the connection drops,
 * the hook signals the caller to fall back to 30-second tRPC polling.
 */

import { useEffect, useRef, useState, useCallback } from "react";

export type VesselPosition = {
  mmsi: string;
  vesselName: string | null;
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  status: string | null;
  riskFlag: "green" | "amber" | "red" | null;
  lastUpdate: string;
};

export type WsConnectionStatus = "connecting" | "live" | "reconnecting" | "fallback";

interface UseVesselWebSocketResult {
  vessels: VesselPosition[];
  connectionStatus: WsConnectionStatus;
  lastRefresh: string | null;
  totalCount: number;
}

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;
const WS_TIMEOUT_MS = 8000; // if no message in 8s, consider connection stale

export function useVesselWebSocket(enabled = true): UseVesselWebSocketResult {
  const [vessels, setVessels] = useState<VesselPosition[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<WsConnectionStatus>("connecting");
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
  }, []);

  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = setTimeout(() => {
      // No message received in WS_TIMEOUT_MS — mark as reconnecting
      setConnectionStatus("reconnecting");
    }, WS_TIMEOUT_MS);
  }, []);

  const connect = useCallback(() => {
    if (!enabled) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus(reconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting");

    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        // Subscribe to cargo tracking channel
        ws.send(JSON.stringify({ type: "subscribe_cargo" }));
        resetStaleTimer();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);

          if (msg.type === "cargo_connected") {
            setConnectionStatus("live");
            resetStaleTimer();
          }

          if (msg.type === "vessel_update") {
            setVessels(msg.payload.vessels ?? []);
            setTotalCount(msg.payload.totalCount ?? 0);
            setLastRefresh(msg.payload.lastRefresh ?? new Date().toISOString());
            setConnectionStatus("live");
            resetStaleTimer();
          }

          if (msg.type === "pong") {
            resetStaleTimer();
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        clearTimers();
        if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setConnectionStatus("reconnecting");
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          setConnectionStatus("fallback");
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket constructor failed (e.g., in SSR or unsupported environment)
      setConnectionStatus("fallback");
    }
  }, [enabled, clearTimers, resetStaleTimer]);

  // Keepalive ping every 30 seconds
  useEffect(() => {
    const pingInterval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
    return () => clearInterval(pingInterval);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setConnectionStatus("fallback");
      return;
    }
    connect();
    return () => {
      clearTimers();
      if (wsRef.current) {
        wsRef.current.send(JSON.stringify({ type: "unsubscribe_cargo" }));
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [enabled, connect, clearTimers]);

  return { vessels, connectionStatus, lastRefresh, totalCount };
}
