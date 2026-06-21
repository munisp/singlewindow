/**
 * pushNotifications.ts — React Native push notification service for TradeGateway.
 *
 * Handles:
 *   1. FCM/APNs device token registration via Expo Notifications
 *   2. Registration of the token with the TradeGateway backend
 *   3. Foreground notification display for anomaly alerts (score > 0.7)
 *   4. Background notification handling and deep-link routing
 *   5. Notification permission request flow
 *
 * Architecture:
 *   - Uses Expo Notifications (expo-notifications) as the cross-platform abstraction
 *   - Backend endpoint: POST /api/trpc/insiderThreat.registerPushToken
 *   - Alert routing: insider.threat.detected → SecurityMonitor tab
 *
 * Usage:
 *   import { initPushNotifications, registerPushToken } from '@/services/pushNotifications';
 *   await initPushNotifications(userId, authToken);
 */

import { Platform } from "react-native";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AnomalyPushPayload {
  type: "anomaly_detected" | "anomaly_blocked" | "four_eyes_expired";
  userId: string;
  sessionId: string;
  anomalyScore: number;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  action: string;
  timestamp: string;
  message: string;
}

export interface PushRegistrationResult {
  success: boolean;
  token?: string;
  error?: string;
  platform: "ios" | "android" | "web";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ANOMALY_NOTIFICATION_CHANNEL_ID = "tradegateway-anomaly-alerts";
const HIGH_SEVERITY_THRESHOLD = 0.7;
const CRITICAL_SEVERITY_THRESHOLD = 0.85;

// ─── Permission helpers ───────────────────────────────────────────────────────

/**
 * Request notification permissions from the OS.
 * On Android 13+, POST_NOTIFICATIONS permission is required.
 * On iOS, the system prompt is shown once.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    // Dynamic import to avoid bundling issues when expo-notifications is not installed
    const Notifications = await import("expo-notifications");

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus === "granted") return true;

    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowCriticalAlerts: true, // Required for security alerts
      },
    });

    return status === "granted";
  } catch (err) {
    console.warn("[PushNotifications] expo-notifications not available:", err);
    return false;
  }
}

// ─── Channel setup (Android) ──────────────────────────────────────────────────

/**
 * Create the anomaly alert notification channel on Android.
 * IMPORTANCE_HIGH ensures the notification appears as a heads-up notification.
 */
export async function setupAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  try {
    const Notifications = await import("expo-notifications");
    await Notifications.setNotificationChannelAsync(ANOMALY_NOTIFICATION_CHANNEL_ID, {
      name: "Anomaly Alerts",
      description: "Real-time insider threat anomaly detection alerts",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF4444",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true, // Security alerts bypass Do Not Disturb
    });
  } catch (err) {
    console.warn("[PushNotifications] Failed to set Android channel:", err);
  }
}

// ─── Token registration ───────────────────────────────────────────────────────

/**
 * Get the Expo push token for this device.
 * Falls back to native FCM/APNs token if Expo token is unavailable.
 */
export async function getDevicePushToken(): Promise<string | null> {
  try {
    const Notifications = await import("expo-notifications");

    // Try Expo push token first (works with Expo Go and standalone builds)
    try {
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: process.env.EXPO_PROJECT_ID ?? "tradegateway-ngswtp",
      });
      return token.data;
    } catch {
      // Fall back to native device token (FCM on Android, APNs on iOS)
      const nativeToken = await Notifications.getDevicePushTokenAsync();
      return nativeToken.data as string;
    }
  } catch (err) {
    console.warn("[PushNotifications] Failed to get push token:", err);
    return null;
  }
}

/**
 * Register the device push token with the TradeGateway backend.
 * The backend stores the token in the user's profile and uses it
 * to send anomaly alerts via FCM/APNs.
 */
export async function registerPushTokenWithBackend(
  token: string,
  userId: string,
  authToken: string,
  apiBaseUrl: string
): Promise<boolean> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/trpc/insiderThreat.registerPushToken`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        json: {
          token,
          platform: Platform.OS as "ios" | "android",
          userId,
        },
      }),
    });

    if (!response.ok) {
      console.warn("[PushNotifications] Backend registration failed:", response.status);
      return false;
    }

    return true;
  } catch (err) {
    console.warn("[PushNotifications] Failed to register token with backend:", err);
    return false;
  }
}

// ─── Notification handlers ────────────────────────────────────────────────────

/**
 * Configure foreground notification behaviour.
 * Security alerts always show as banners even when the app is in the foreground.
 */
export async function configureForegroundHandler(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = notification.request.content.data as Partial<AnomalyPushPayload>;
        const isSecurityAlert =
          data?.type === "anomaly_detected" ||
          data?.type === "anomaly_blocked" ||
          data?.type === "four_eyes_expired";

        return {
          shouldShowAlert: true, // Always show security alerts
          shouldPlaySound: isSecurityAlert,
          shouldSetBadge: isSecurityAlert,
          priority: isSecurityAlert
            ? Notifications.AndroidNotificationPriority.MAX
            : Notifications.AndroidNotificationPriority.DEFAULT,
        };
      },
    });
  } catch (err) {
    console.warn("[PushNotifications] Failed to configure foreground handler:", err);
  }
}

// ─── Local notification dispatch ─────────────────────────────────────────────

/**
 * Show a local notification for an anomaly alert received via SSE.
 * Used when the app is in the foreground and the anomaly score exceeds the threshold.
 */
export async function showAnomalyLocalNotification(payload: AnomalyPushPayload): Promise<void> {
  if (payload.anomalyScore < HIGH_SEVERITY_THRESHOLD) return;

  try {
    const Notifications = await import("expo-notifications");

    const isCritical = payload.anomalyScore >= CRITICAL_SEVERITY_THRESHOLD;
    const emoji = isCritical ? "🚨" : "⚠️";

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${emoji} ${payload.severity} Anomaly Detected`,
        body: payload.message || `Suspicious activity by user ${payload.userId}: ${payload.action}`,
        data: payload,
        sound: "default",
        badge: 1,
        categoryIdentifier: ANOMALY_NOTIFICATION_CHANNEL_ID,
        color: isCritical ? "#FF0000" : "#FF8C00",
        ...(Platform.OS === "android" && {
          channelId: ANOMALY_NOTIFICATION_CHANNEL_ID,
          priority: Notifications.AndroidNotificationPriority.MAX,
          vibrate: [0, 500, 250, 500],
        }),
      },
      trigger: null, // Show immediately
    });
  } catch (err) {
    console.warn("[PushNotifications] Failed to show local notification:", err);
  }
}

// ─── Notification tap handler ─────────────────────────────────────────────────

export type NotificationTapHandler = (payload: AnomalyPushPayload) => void;

let _tapHandler: NotificationTapHandler | null = null;

/**
 * Register a handler that is called when the user taps a push notification.
 * The handler receives the anomaly payload and should navigate to SecurityMonitor.
 */
export async function registerNotificationTapHandler(handler: NotificationTapHandler): Promise<() => void> {
  _tapHandler = handler;

  try {
    const Notifications = await import("expo-notifications");

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Partial<AnomalyPushPayload>;
      if (data?.type && _tapHandler) {
        _tapHandler(data as AnomalyPushPayload);
      }
    });

    return () => {
      subscription.remove();
      _tapHandler = null;
    };
  } catch (err) {
    console.warn("[PushNotifications] Failed to register tap handler:", err);
    return () => {};
  }
}

// ─── Main init function ───────────────────────────────────────────────────────

/**
 * Full initialisation sequence for push notifications.
 * Call this once at app startup after the user is authenticated.
 *
 * @param userId - The authenticated user's ID
 * @param authToken - The user's JWT auth token
 * @param apiBaseUrl - The TradeGateway API base URL
 * @returns PushRegistrationResult
 */
export async function initPushNotifications(
  userId: string,
  authToken: string,
  apiBaseUrl: string
): Promise<PushRegistrationResult> {
  const platform = Platform.OS as "ios" | "android" | "web";

  // 1. Request permissions
  const granted = await requestNotificationPermissions();
  if (!granted) {
    return { success: false, error: "Notification permission denied", platform };
  }

  // 2. Set up Android channel
  await setupAndroidNotificationChannel();

  // 3. Configure foreground handler
  await configureForegroundHandler();

  // 4. Get device token
  const token = await getDevicePushToken();
  if (!token) {
    return { success: false, error: "Failed to get device push token", platform };
  }

  // 5. Register with backend
  const registered = await registerPushTokenWithBackend(token, userId, authToken, apiBaseUrl);
  if (!registered) {
    // Non-fatal: local notifications still work
    console.warn("[PushNotifications] Backend registration failed; local notifications still active");
  }

  return { success: true, token, platform };
}

// ─── Badge management ─────────────────────────────────────────────────────────

export async function clearNotificationBadge(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    await Notifications.setBadgeCountAsync(0);
  } catch {
    // Non-fatal
  }
}

export async function incrementNotificationBadge(): Promise<void> {
  try {
    const Notifications = await import("expo-notifications");
    const current = await Notifications.getBadgeCountAsync();
    await Notifications.setBadgeCountAsync(current + 1);
  } catch {
    // Non-fatal
  }
}
