/// TradeGateway™ NGSWTP — Flutter GoRouter Navigation
library;

import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "package:go_router/go_router.dart";
import "../providers/auth_provider.dart";
import "../screens/auth/login_screen.dart";
import "../screens/auth/biometric_screen.dart";
import "../screens/app/dashboard_screen.dart";
import "../screens/app/declarations_screen.dart";
import "../screens/app/declaration_detail_screen.dart";
import "../screens/app/new_declaration_screen.dart";
import "../screens/app/payments_screen.dart";
import "../screens/app/cargo_tracking_screen.dart";
import "../screens/app/document_vault_screen.dart";
import "../screens/app/profile_screen.dart";
import "../screens/app/notifications_screen.dart";
import "../screens/app/oga_status_screen.dart";
import "../screens/app/kyc_screen.dart";
import "../screens/app/aeo_screen.dart";
import "../screens/app/trader_scorecard_screen.dart";
import "../screens/app/system_status_screen.dart";
import "../screens/app/hs_code_lookup_screen.dart";
import "../screens/app/scan_document_screen.dart";
import "../widgets/scaffold_with_nav.dart";

final routerProvider = Provider<GoRouter>((ref) {
  final auth = ref.watch(authProvider);
  return GoRouter(
    initialLocation: "/",
    redirect: (context, state) {
      final isAuth = auth.valueOrNull?.isAuthenticated ?? false;
      final isAuthRoute = state.matchedLocation.startsWith("/auth");
      if (!isAuth && !isAuthRoute) return "/auth/login";
      if (isAuth && isAuthRoute) return "/";
      return null;
    },
    routes: [
      GoRoute(path: "/auth/login", builder: (_, __) => const LoginScreen()),
      GoRoute(path: "/auth/biometric", builder: (_, __) => const BiometricScreen()),
      ShellRoute(
        builder: (context, state, child) => ScaffoldWithNav(child: child),
        routes: [
          GoRoute(path: "/", builder: (_, __) => const DashboardScreen()),
          GoRoute(path: "/declarations", builder: (_, __) => const DeclarationsScreen()),
          GoRoute(path: "/declarations/new", builder: (_, __) => const NewDeclarationScreen()),
          GoRoute(path: "/declarations/:id", builder: (_, state) => DeclarationDetailScreen(id: int.parse(state.pathParameters["id"]!))),
          GoRoute(path: "/payments", builder: (_, __) => const PaymentsScreen()),
          GoRoute(path: "/cargo", builder: (_, __) => const CargoTrackingScreen()),
          GoRoute(path: "/documents", builder: (_, __) => const DocumentVaultScreen()),
          GoRoute(path: "/profile", builder: (_, __) => const ProfileScreen()),
          GoRoute(path: "/notifications", builder: (_, __) => const NotificationsScreen()),
          GoRoute(path: "/oga", builder: (_, __) => const OGAStatusScreen()),
          GoRoute(path: "/kyc", builder: (_, __) => const KYCScreen()),
          GoRoute(path: "/aeo", builder: (_, __) => const AEOScreen()),
          GoRoute(path: "/scorecard", builder: (_, __) => const TraderScorecardScreen()),
          GoRoute(path: "/status", builder: (_, __) => const SystemStatusScreen()),
          GoRoute(path: "/hs-lookup", builder: (_, __) => const HSCodeLookupScreen()),
          GoRoute(path: "/scan", builder: (_, __) => const ScanDocumentScreen()),
        ],
      ),
    ],
  );
});
