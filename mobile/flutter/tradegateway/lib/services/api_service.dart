/// TradeGateway™ NGSWTP — Flutter API Service
/// Connects to the tRPC backend using Dio HTTP client.
/// Mirrors the React Native tRPC client for full API parity.
library;

import "dart:convert";
import "package:dio/dio.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "../models/declarations.dart";
import "../models/payments.dart";
import "../models/user.dart";

const String _kApiBase = String.fromEnvironment(
  "TRADEGATEWAY_API_URL",
  defaultValue: "https://api.tradegateway.gov.ng",
);

class ApiService {
  static final ApiService _instance = ApiService._internal();
  factory ApiService() => _instance;
  ApiService._internal();

  final _storage = const FlutterSecureStorage();

  late final Dio _dio = Dio(
    BaseOptions(
      baseUrl: "$_kApiBase/api/trpc",
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      headers: {"Content-Type": "application/json"},
    ),
  )..interceptors.addAll([
      _AuthInterceptor(_storage),
      _RetryInterceptor(),
      LogInterceptor(requestBody: false, responseBody: false),
    ]);

  // ─── Auth ──────────────────────────────────────────────────────────────────

  Future<User?> getMe() async {
    final res = await _dio.get("/auth.me");
    return _parseResult<User>(res, User.fromJson);
  }

  Future<void> logout() async {
    await _dio.post("/auth.logout", data: {"json": {}});
    await _storage.delete(key: "auth_token");
  }

  // ─── Declarations ──────────────────────────────────────────────────────────

  Future<DeclarationListResult> listDeclarations({
    int page = 1,
    int limit = 20,
    String? status,
    String? search,
  }) async {
    final res = await _dio.get("/declarations.list", queryParameters: {
      "input": jsonEncode({"json": {"page": page, "limit": limit, if (status != null) "status": status, if (search != null) "search": search}}),
    });
    return _parseResult<DeclarationListResult>(res, DeclarationListResult.fromJson);
  }

  Future<Declaration> getDeclaration(int id) async {
    final res = await _dio.get("/declarations.getById", queryParameters: {
      "input": jsonEncode({"json": {"id": id}}),
    });
    return _parseResult<Declaration>(res, Declaration.fromJson);
  }

  Future<Declaration> createDeclaration(Map<String, dynamic> data) async {
    final res = await _dio.post("/declarations.create", data: {"json": data});
    return _parseResult<Declaration>(res, Declaration.fromJson);
  }

  Future<Declaration> updateDeclaration(int id, Map<String, dynamic> data) async {
    final res = await _dio.post("/declarations.update", data: {"json": {"id": id, ...data}});
    return _parseResult<Declaration>(res, Declaration.fromJson);
  }

  Future<void> submitDeclaration(int id) async {
    await _dio.post("/declarations.submit", data: {"json": {"id": id}});
  }

  Future<Map<String, dynamic>> getDeclarationStats() async {
    final res = await _dio.get("/declarations.getStats");
    return _parseRaw(res);
  }

  Future<List<Map<String, dynamic>>> searchHsCode(String query) async {
    final res = await _dio.get("/declarations.searchHsCode", queryParameters: {
      "input": jsonEncode({"json": {"query": query}}),
    });
    return List<Map<String, dynamic>>.from(_parseRaw(res)["results"] ?? []);
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> listPayments({int page = 1, int limit = 20}) async {
    final res = await _dio.get("/payments.list", queryParameters: {
      "input": jsonEncode({"json": {"page": page, "limit": limit}}),
    });
    return _parseRaw(res);
  }

  Future<Map<String, dynamic>> initiatePayment(Map<String, dynamic> data) async {
    final res = await _dio.post("/payments.initiate", data: {"json": data});
    return _parseRaw(res);
  }

  Future<Map<String, dynamic>> getPaymentStats() async {
    final res = await _dio.get("/payments.getStats");
    return _parseRaw(res);
  }

  // ─── Cargo Tracking ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> listCargoTracking({int page = 1}) async {
    final res = await _dio.get("/cargoTracking.list", queryParameters: {
      "input": jsonEncode({"json": {"page": page}}),
    });
    return _parseRaw(res);
  }

  Future<Map<String, dynamic>> trackByUCR(String ucr) async {
    final res = await _dio.get("/cargoTracking.getByUCR", queryParameters: {
      "input": jsonEncode({"json": {"ucr": ucr}}),
    });
    return _parseRaw(res);
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> listNotifications({int limit = 20, bool unreadOnly = false}) async {
    final res = await _dio.get("/userNotifications.list", queryParameters: {
      "input": jsonEncode({"json": {"limit": limit, "unreadOnly": unreadOnly}}),
    });
    return _parseRaw(res);
  }

  Future<void> markNotificationRead(int id) async {
    await _dio.post("/userNotifications.markRead", data: {"json": {"id": id}});
  }

  // ─── System Status ────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getSystemStatus() async {
    final res = await _dio.get("/system.systemStatus");
    return _parseRaw(res);
  }

  // ─── KYC ──────────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getKYCStatus() async {
    final res = await _dio.get("/kyc.getStatus");
    return _parseRaw(res);
  }

  // ─── Trader Scorecard ─────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getTraderScorecard() async {
    final res = await _dio.get("/traderScorecard.getScorecard");
    return _parseRaw(res);
  }

  // ─── Document Vault ───────────────────────────────────────────────────────

  Future<Map<String, dynamic>> listDocuments({int page = 1}) async {
    final res = await _dio.get("/documentVault.list", queryParameters: {
      "input": jsonEncode({"json": {"page": page}}),
    });
    return _parseRaw(res);
  }

  // ─── Profile ──────────────────────────────────────────────────────────────

  Future<Map<String, dynamic>> getMyProfile() async {
    final res = await _dio.get("/profiles.getMyProfile");
    return _parseRaw(res);
  }

  Future<Map<String, dynamic>> updateProfile(Map<String, dynamic> data) async {
    final res = await _dio.post("/profiles.updateProfile", data: {"json": data});
    return _parseRaw(res);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  T _parseResult<T>(Response res, T Function(Map<String, dynamic>) fromJson) {
    final data = res.data as Map<String, dynamic>;
    final result = data["result"]?["data"]?["json"] ?? data["result"]?["data"];
    return fromJson(result as Map<String, dynamic>);
  }

  Map<String, dynamic> _parseRaw(Response res) {
    final data = res.data as Map<String, dynamic>;
    return (data["result"]?["data"]?["json"] ?? data["result"]?["data"]) as Map<String, dynamic>? ?? {};
  }
}

// ─── Interceptors ─────────────────────────────────────────────────────────────

class _AuthInterceptor extends Interceptor {
  final FlutterSecureStorage _storage;
  _AuthInterceptor(this._storage);

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final token = await _storage.read(key: "auth_token");
    if (token != null) {
      options.headers["Authorization"] = "Bearer $token";
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      await _storage.delete(key: "auth_token");
    }
    handler.next(err);
  }
}

class _RetryInterceptor extends Interceptor {
  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.type == DioExceptionType.connectionTimeout || err.type == DioExceptionType.receiveTimeout) {
      try {
        final response = await Dio().fetch(err.requestOptions);
        handler.resolve(response);
        return;
      } catch (_) {}
    }
    handler.next(err);
  }
}
