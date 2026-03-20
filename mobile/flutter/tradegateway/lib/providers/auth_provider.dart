/// TradeGateway™ NGSWTP — Flutter Auth Provider (Riverpod)
library;

import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:local_auth/local_auth.dart";
import "../models/user.dart";
import "../services/api_service.dart";

final _storage = const FlutterSecureStorage();
final _localAuth = LocalAuthentication();

class AuthState {
  final User? user;
  final bool loading;
  final String? error;
  const AuthState({this.user, this.loading = false, this.error});
  bool get isAuthenticated => user != null;
  AuthState copyWith({User? user, bool? loading, String? error}) =>
      AuthState(user: user ?? this.user, loading: loading ?? this.loading, error: error ?? this.error);
}

class AuthNotifier extends AsyncNotifier<AuthState> {
  @override
  Future<AuthState> build() async {
    final token = await _storage.read(key: "auth_token");
    if (token == null) return const AuthState();
    try {
      final user = await ApiService().getMe();
      return AuthState(user: user);
    } catch (_) {
      return const AuthState();
    }
  }

  Future<void> loginWithToken(String token) async {
    await _storage.write(key: "auth_token", value: token);
    state = const AsyncValue.loading();
    try {
      final user = await ApiService().getMe();
      state = AsyncValue.data(AuthState(user: user));
    } catch (e) {
      state = AsyncValue.error(e, StackTrace.current);
    }
  }

  Future<bool> authenticateWithBiometric() async {
    final canAuth = await _localAuth.canCheckBiometrics;
    if (!canAuth) return false;
    return _localAuth.authenticate(
      localizedReason: "Authenticate to access TradeGateway",
      options: const AuthenticationOptions(biometricOnly: false),
    );
  }

  Future<void> logout() async {
    try { await ApiService().logout(); } catch (_) {}
    await _storage.delete(key: "auth_token");
    state = const AsyncValue.data(AuthState());
  }
}

final authProvider = AsyncNotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);
