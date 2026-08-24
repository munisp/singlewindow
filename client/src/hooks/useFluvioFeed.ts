/**
 * useFluvioFeed — WebSocket hook for the Fluvio real-time event consumer.
 *
 * Connects to the fluvio-consumer Go service WebSocket endpoint and delivers
 * a stream of AIS vessel position events and declaration lifecycle events.
 *
 * Usage:
 *   const { events, status, lastUpdated, pause, resume } = useFluvioFeed();
 */

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type FluvioEventType =
  | "ais.vessel_position"
  | "declaration.submitted"
  | "declaration.cleared"
  | "cargo.gate_in"
  | "cargo.gate_out"
  | "payment.confirmed"
  | "risk.score_computed";

export interface VesselPosition {
  mmsi: string;
  vesselName: string;
  lat: number;
  lng: number;
  speed: number;      // knots
  heading: number;    // degrees
  portCode: string;
  timestamp: string;  // ISO-8601
}

export interface FluvioEvent {
  id: string;
  type: FluvioEventType;
  topic: string;
  partition: number;
  offset: number;
  timestamp: string;
  payload: VesselPosition | Record<string, unknown>;
}

export type FeedStatus = "connecting" | "connected" | "paused" | "reconnecting" | "error" | "unconfigured" | "unavailable";
export type SourceStatus = "connected" | "unconfigured" | "unavailable";

// ── Constants ─────────────────────────────────────────────────────────────────

const FLUVIO_WS_URL = import.meta.env.VITE_FLUVIO_WS_URL ?? "ws://localhost:8093/api/stream/ws";
const MAX_EVENTS = 500;           // ring buffer size
const RECONNECT_DELAY_MS = 3000;  // 3 s between reconnect attempts
const MAX_RECONNECT_ATTEMPTS = 10;

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFluvioFeed(options?: {
  filterType?: FluvioEventType;
  maxEvents?: number;
  autoConnect?: boolean;
}) {
  const {
    filterType,
    maxEvents = MAX_EVENTS,
    autoConnect = true,
  } = options ?? {};

  const [events, setEvents] = useState<FluvioEvent[]>([]);
  const [status, setStatus] = useState<FeedStatus>("connecting");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  const [sourceReason, setSourceReason] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pausedRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;

    setStatus("connecting");

    try {
      const ws = new WebSocket(FLUVIO_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        setStatus("connected");
        setReconnectCount(0);
      };

      ws.onmessage = (evt) => {
        if (!mountedRef.current || pausedRef.current) return;
        try {
          const parsed: unknown = JSON.parse(evt.data as string);
          if (typeof parsed !== "object" || parsed === null) return;
          if ("status" in parsed && (
            parsed.status === "connected" ||
            parsed.status === "unconfigured" ||
            parsed.status === "unavailable"
          )) {
            if (parsed.status === "connected") {
              setSourceStatus(null);
              setSourceReason(null);
              setStatus("connected");
              const lastEvent = "last_event" in parsed && typeof parsed.last_event === "string"
                ? new Date(parsed.last_event)
                : new Date();
              setLastUpdated(lastEvent);
              return;
            }
            setSourceStatus(parsed.status);
            setSourceReason("reason" in parsed && typeof parsed.reason === "string" ? parsed.reason : null);
            setStatus(parsed.status);
            return;
          }
          setSourceStatus(null);
          setSourceReason(null);
          const event = parsed as FluvioEvent;
          if (filterType && event.type !== filterType) return;

          setEvents(prev => {
            const next = [event, ...prev];
            return next.length > maxEvents ? next.slice(0, maxEvents) : next;
          });
          setLastUpdated(new Date());
        } catch {
          // Ignore malformed frames
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("error");
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        if (pausedRef.current) {
          setStatus("paused");
          return;
        }
        setReconnectCount(prev => {
          const next = prev + 1;
          if (next <= MAX_RECONNECT_ATTEMPTS) {
            setStatus("reconnecting");
            reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
          } else {
            setStatus("error");
          }
          return next;
        });
      };
    } catch {
      setStatus("error");
    }
  }, [filterType, maxEvents]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    wsRef.current?.close();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    connect();
  }, [connect]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (autoConnect) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [autoConnect, connect]);

  // Derived: only AIS vessel positions
  const vesselPositions = events
    .filter(e => e.type === "ais.vessel_position")
    .map(e => e.payload as VesselPosition);

  return {
    events,
    vesselPositions,
    status,
    sourceStatus,
    sourceReason,
    lastUpdated,
    reconnectCount,
    pause,
    resume,
    clearEvents,
    isLive: status === "connected" && sourceStatus === null,
  };
}
