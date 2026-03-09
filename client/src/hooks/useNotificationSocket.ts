/**
 * Sprint 63 — useNotificationSocket
 * Maintains a WebSocket connection to /api/ws and dispatches real-time
 * notification events to registered listeners.
 */
import { useEffect, useRef, useCallback } from "react";

export interface WsNotificationPayload {
  id: number;
  category: string;
  title: string;
  body: string;
  entityType?: string;
  entityId?: number;
  createdAt: string;
}

type NotificationHandler = (notification: WsNotificationPayload) => void;
type UnreadCountHandler = (count: number) => void;

interface UseNotificationSocketOptions {
  onNotification?: NotificationHandler;
  onUnreadCount?: UnreadCountHandler;
  enabled?: boolean;
}

export function useNotificationSocket({
  onNotification,
  onUnreadCount,
  enabled = true,
}: UseNotificationSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const onNotificationRef = useRef(onNotification);
  const onUnreadCountRef = useRef(onUnreadCount);
  onNotificationRef.current = onNotification;
  onUnreadCountRef.current = onUnreadCount;

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/api/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Start keepalive ping every 30s
        const pingInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30_000);
        (ws as any)._pingInterval = pingInterval;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "notification" && onNotificationRef.current) {
            onNotificationRef.current(msg.payload as WsNotificationPayload);
          } else if (msg.type === "unread_count" && onUnreadCountRef.current) {
            onUnreadCountRef.current(msg.payload.count as number);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if ((ws as any)._pingInterval) clearInterval((ws as any)._pingInterval);
        // Reconnect after 5 seconds if still mounted
        if (mountedRef.current && enabled) {
          reconnectTimerRef.current = setTimeout(connect, 5_000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket not available (e.g., SSR or test environment)
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, enabled]);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { sendMessage };
}
