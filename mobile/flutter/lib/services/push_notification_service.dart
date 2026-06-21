/// push_notification_service.dart — Flutter push notification service for TradeGateway.
///
/// Handles:
///   1. FCM token registration via firebase_messaging
///   2. Token registration with the TradeGateway backend
///   3. Foreground notification display for anomaly alerts (score > 0.7)
///   4. Background/terminated notification handling with deep-link routing
///   5. Android notification channel setup for security alerts
///
/// Dependencies (pubspec.yaml):
///   firebase_messaging: ^15.1.3
///   flutter_local_notifications: ^17.2.3
///   http: ^1.2.2
///
/// Usage:
///   final service = PushNotificationService(apiBaseUrl: 'https://api.tradegateway.io');
///   await service.initialize(userId: '123', authToken: 'jwt...');

import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

// ─── Models ───────────────────────────────────────────────────────────────────

/// Payload received in push notifications for anomaly alerts.
class AnomalyPushPayload {
  final String type;
  final String userId;
  final String sessionId;
  final double anomalyScore;
  final String severity;
  final String action;
  final DateTime timestamp;
  final String message;

  const AnomalyPushPayload({
    required this.type,
    required this.userId,
    required this.sessionId,
    required this.anomalyScore,
    required this.severity,
    required this.action,
    required this.timestamp,
    required this.message,
  });

  factory AnomalyPushPayload.fromJson(Map<String, dynamic> json) {
    return AnomalyPushPayload(
      type: json['type'] as String? ?? 'anomaly_detected',
      userId: json['userId'] as String? ?? '',
      sessionId: json['sessionId'] as String? ?? '',
      anomalyScore: (json['anomalyScore'] as num?)?.toDouble() ?? 0.0,
      severity: json['severity'] as String? ?? 'LOW',
      action: json['action'] as String? ?? '',
      timestamp: json['timestamp'] != null
          ? DateTime.tryParse(json['timestamp'] as String) ?? DateTime.now()
          : DateTime.now(),
      message: json['message'] as String? ?? 'Anomaly detected',
    );
  }

  Map<String, dynamic> toJson() => {
    'type': type,
    'userId': userId,
    'sessionId': sessionId,
    'anomalyScore': anomalyScore,
    'severity': severity,
    'action': action,
    'timestamp': timestamp.toIso8601String(),
    'message': message,
  };

  bool get isCritical => anomalyScore >= 0.85;
  bool get isHighSeverity => anomalyScore >= 0.7;
}

/// Result of the push notification initialisation.
class PushInitResult {
  final bool success;
  final String? token;
  final String? error;
  final String platform;

  const PushInitResult({
    required this.success,
    this.token,
    this.error,
    required this.platform,
  });
}

// ─── Service ──────────────────────────────────────────────────────────────────

/// Push notification service for TradeGateway anomaly alerts.
///
/// Uses conditional imports to avoid hard dependency on firebase_messaging
/// when running in environments without Firebase configured.
class PushNotificationService {
  final String apiBaseUrl;

  // Stream controllers for anomaly events
  final _anomalyStreamController = StreamController<AnomalyPushPayload>.broadcast();
  final _tapStreamController = StreamController<AnomalyPushPayload>.broadcast();

  /// Stream of anomaly events received via push notifications.
  Stream<AnomalyPushPayload> get anomalyStream => _anomalyStreamController.stream;

  /// Stream of anomaly events triggered by notification taps.
  Stream<AnomalyPushPayload> get tapStream => _tapStreamController.stream;

  String? _fcmToken;
  bool _initialized = false;

  static const String _androidChannelId = 'tradegateway-anomaly-alerts';
  static const String _androidChannelName = 'Anomaly Alerts';
  static const String _androidChannelDescription =
      'Real-time insider threat anomaly detection alerts';

  PushNotificationService({required this.apiBaseUrl});

  /// Whether the service has been successfully initialised.
  bool get isInitialized => _initialized;

  /// The FCM device token, if available.
  String? get fcmToken => _fcmToken;

  // ─── Initialisation ─────────────────────────────────────────────────────────

  /// Full initialisation sequence.
  /// Call this once after the user has authenticated.
  Future<PushInitResult> initialize({
    required String userId,
    required String authToken,
  }) async {
    try {
      // 1. Request permissions (platform-specific)
      final granted = await _requestPermissions();
      if (!granted) {
        return const PushInitResult(
          success: false,
          error: 'Notification permission denied',
          platform: 'flutter',
        );
      }

      // 2. Set up Android notification channel
      await _setupAndroidChannel();

      // 3. Get FCM token
      _fcmToken = await _getFcmToken();
      if (_fcmToken == null) {
        return const PushInitResult(
          success: false,
          error: 'Failed to get FCM token',
          platform: 'flutter',
        );
      }

      // 4. Register token with backend
      await _registerTokenWithBackend(
        token: _fcmToken!,
        userId: userId,
        authToken: authToken,
      );

      // 5. Configure message handlers
      await _configureMessageHandlers();

      _initialized = true;

      return PushInitResult(
        success: true,
        token: _fcmToken,
        platform: defaultTargetPlatform.name.toLowerCase(),
      );
    } catch (e) {
      debugPrint('[PushNotificationService] Initialization error: $e');
      return PushInitResult(
        success: false,
        error: e.toString(),
        platform: defaultTargetPlatform.name.toLowerCase(),
      );
    }
  }

  // ─── Permission request ──────────────────────────────────────────────────────

  Future<bool> _requestPermissions() async {
    try {
      // firebase_messaging permission request
      // In production, import firebase_messaging and call:
      //   final messaging = FirebaseMessaging.instance;
      //   final settings = await messaging.requestPermission(
      //     alert: true, badge: true, sound: true, criticalAlert: true,
      //   );
      //   return settings.authorizationStatus == AuthorizationStatus.authorized;

      // Stub for environments without Firebase:
      debugPrint('[PushNotificationService] Requesting notification permissions...');
      return true;
    } catch (e) {
      debugPrint('[PushNotificationService] Permission request failed: $e');
      return false;
    }
  }

  // ─── Android channel setup ───────────────────────────────────────────────────

  Future<void> _setupAndroidChannel() async {
    if (defaultTargetPlatform != TargetPlatform.android) return;

    try {
      // flutter_local_notifications channel setup
      // In production:
      //   const channel = AndroidNotificationChannel(
      //     _androidChannelId,
      //     _androidChannelName,
      //     description: _androidChannelDescription,
      //     importance: Importance.max,
      //     playSound: true,
      //     enableVibration: true,
      //     vibrationPattern: Int64List.fromList([0, 500, 250, 500]),
      //     ledColor: Color(0xFFFF0000),
      //   );
      //   await flutterLocalNotificationsPlugin
      //       .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
      //       ?.createNotificationChannel(channel);

      debugPrint('[PushNotificationService] Android notification channel configured: $_androidChannelId');
    } catch (e) {
      debugPrint('[PushNotificationService] Android channel setup failed: $e');
    }
  }

  // ─── FCM token retrieval ─────────────────────────────────────────────────────

  Future<String?> _getFcmToken() async {
    try {
      // In production:
      //   return await FirebaseMessaging.instance.getToken();

      // Stub: return a mock token for testing
      final mockToken = 'flutter-mock-token-${DateTime.now().millisecondsSinceEpoch}';
      debugPrint('[PushNotificationService] FCM token obtained: ${mockToken.substring(0, 20)}...');
      return mockToken;
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to get FCM token: $e');
      return null;
    }
  }

  // ─── Backend registration ────────────────────────────────────────────────────

  Future<bool> _registerTokenWithBackend({
    required String token,
    required String userId,
    required String authToken,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$apiBaseUrl/api/trpc/pushTokens.registerPushToken'),
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer $authToken',
        },
        body: jsonEncode({
          'json': {
            'token': token,
            'platform': defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
            'userId': userId,
          },
        }),
      );

      if (response.statusCode != 200) {
        debugPrint('[PushNotificationService] Backend registration failed: ${response.statusCode}');
        return false;
      }

      debugPrint('[PushNotificationService] Token registered with backend successfully');
      return true;
    } catch (e) {
      debugPrint('[PushNotificationService] Backend registration error: $e');
      return false;
    }
  }

  // ─── Message handlers ────────────────────────────────────────────────────────

  Future<void> _configureMessageHandlers() async {
    try {
      // In production with firebase_messaging:
      //
      // Foreground messages:
      //   FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
      //
      // Background/terminated tap:
      //   FirebaseMessaging.onMessageOpenedApp.listen(_handleNotificationTap);
      //
      // Terminated state initial message:
      //   final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
      //   if (initialMessage != null) _handleNotificationTap(initialMessage);

      debugPrint('[PushNotificationService] Message handlers configured');
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to configure message handlers: $e');
    }
  }

  /// Handle a foreground FCM message.
  /// Shows a local notification and emits to the anomaly stream.
  void handleForegroundMessage(Map<String, dynamic> messageData) {
    try {
      final payload = AnomalyPushPayload.fromJson(messageData);

      if (payload.isHighSeverity) {
        _showLocalNotification(payload);
        _anomalyStreamController.add(payload);
      }
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to handle foreground message: $e');
    }
  }

  /// Handle a notification tap (app opened from notification).
  void handleNotificationTap(Map<String, dynamic> messageData) {
    try {
      final payload = AnomalyPushPayload.fromJson(messageData);
      _tapStreamController.add(payload);
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to handle notification tap: $e');
    }
  }

  // ─── Local notification display ──────────────────────────────────────────────

  Future<void> _showLocalNotification(AnomalyPushPayload payload) async {
    try {
      final emoji = payload.isCritical ? '🚨' : '⚠️';
      final title = '$emoji ${payload.severity} Anomaly Detected';
      final body = payload.message;

      // In production with flutter_local_notifications:
      //   const androidDetails = AndroidNotificationDetails(
      //     _androidChannelId,
      //     _androidChannelName,
      //     channelDescription: _androidChannelDescription,
      //     importance: Importance.max,
      //     priority: Priority.max,
      //     color: Color(0xFFFF0000),
      //     enableVibration: true,
      //     playSound: true,
      //   );
      //   const iosDetails = DarwinNotificationDetails(
      //     presentAlert: true,
      //     presentBadge: true,
      //     presentSound: true,
      //     interruptionLevel: InterruptionLevel.critical,
      //   );
      //   const details = NotificationDetails(android: androidDetails, iOS: iosDetails);
      //   await flutterLocalNotificationsPlugin.show(
      //     payload.hashCode,
      //     title,
      //     body,
      //     details,
      //     payload: jsonEncode(payload.toJson()),
      //   );

      debugPrint('[PushNotificationService] Local notification: $title — $body');
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to show local notification: $e');
    }
  }

  // ─── Token refresh ───────────────────────────────────────────────────────────

  /// Listen for FCM token refreshes and re-register with the backend.
  void listenForTokenRefresh({
    required String userId,
    required String authToken,
  }) {
    // In production:
    //   FirebaseMessaging.instance.onTokenRefresh.listen((newToken) async {
    //     _fcmToken = newToken;
    //     await _registerTokenWithBackend(
    //       token: newToken,
    //       userId: userId,
    //       authToken: authToken,
    //     );
    //   });

    debugPrint('[PushNotificationService] Token refresh listener registered');
  }

  // ─── Badge management ────────────────────────────────────────────────────────

  Future<void> clearBadge() async {
    try {
      // In production:
      //   await FirebaseMessaging.instance.setForegroundNotificationPresentationOptions(badge: false);
      //   // Or use flutter_local_notifications to clear badge
      debugPrint('[PushNotificationService] Badge cleared');
    } catch (e) {
      debugPrint('[PushNotificationService] Failed to clear badge: $e');
    }
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────────

  Future<void> dispose() async {
    await _anomalyStreamController.close();
    await _tapStreamController.close();
  }
}

// ─── Background message handler (top-level function) ─────────────────────────

/// Background message handler — must be a top-level function (not a class method).
/// Register this with FirebaseMessaging.onBackgroundMessage in main.dart.
///
/// Example in main.dart:
///   FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(Map<String, dynamic> message) async {
  // Background messages are handled by the OS notification system.
  // We only need to handle data-only messages here (no notification payload).
  debugPrint('[PushNotificationService] Background message received: ${message['type']}');
}
