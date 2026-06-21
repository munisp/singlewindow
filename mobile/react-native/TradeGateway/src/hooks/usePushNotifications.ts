/**
 * usePushNotifications.ts — React hook for push notification management.
 *
 * Integrates the push notification service with the React component tree.
 * Handles:
 *   - Initialisation on mount after auth is available
 *   - Navigation to SecurityMonitor on notification tap
 *   - SSE-based local notifications when the app is foregrounded
 *   - Badge clearing when the SecurityMonitor screen is focused
 *
 * Usage:
 *   // In App.tsx or a top-level component:
 *   usePushNotifications({ userId, authToken, navigation });
 */

import { useEffect, useRef, useCallback } from "react";
import {
  initPushNotifications,
  registerNotificationTapHandler,
  showAnomalyLocalNotification,
  clearNotificationBadge,
  type AnomalyPushPayload,
} from "@/services/pushNotifications";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsePushNotificationsOptions {
  userId: string | null;
  authToken: string | null;
  apiBaseUrl: string;
  /** Called when user taps a notification — should navigate to SecurityMonitor */
  onNotificationTap?: (payload: AnomalyPushPayload) => void;
  /** Called when a new anomaly event arrives via SSE */
  onAnomalyEvent?: (payload: AnomalyPushPayload) => void;
}

interface UsePushNotificationsResult {
  isInitialized: boolean;
  pushToken: string | null;
  handleAnomalyEvent: (payload: AnomalyPushPayload) => Promise<void>;
  clearBadge: () => Promise<void>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePushNotifications({
  userId,
  authToken,
  apiBaseUrl,
  onNotificationTap,
  onAnomalyEvent,
}: UsePushNotificationsOptions): UsePushNotificationsResult {
  const isInitializedRef = useRef(false);
  const pushTokenRef = useRef<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Initialise push notifications once auth is available
  useEffect(() => {
    if (!userId || !authToken || isInitializedRef.current) return;

    let mounted = true;

    (async () => {
      const result = await initPushNotifications(userId, authToken, apiBaseUrl);

      if (!mounted) return;

      if (result.success && result.token) {
        pushTokenRef.current = result.token;
        isInitializedRef.current = true;
      }

      // Register tap handler for notification-to-screen navigation
      const cleanup = await registerNotificationTapHandler((payload) => {
        onNotificationTap?.(payload);
      });

      cleanupRef.current = cleanup;
    })();

    return () => {
      mounted = false;
    };
  }, [userId, authToken, apiBaseUrl, onNotificationTap]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  /**
   * Handle an anomaly event received via SSE.
   * Shows a local notification if the app is in the foreground and the score is high enough.
   */
  const handleAnomalyEvent = useCallback(async (payload: AnomalyPushPayload) => {
    onAnomalyEvent?.(payload);
    await showAnomalyLocalNotification(payload);
  }, [onAnomalyEvent]);

  const clearBadge = useCallback(async () => {
    await clearNotificationBadge();
  }, []);

  return {
    isInitialized: isInitializedRef.current,
    pushToken: pushTokenRef.current,
    handleAnomalyEvent,
    clearBadge,
  };
}
