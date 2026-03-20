/// TradeGateway™ NGSWTP — Flutter App Entry Point
import "package:flutter/material.dart";
import "package:flutter_riverpod/flutter_riverpod.dart";
import "navigation/app_router.dart";

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: TradeGatewayApp()));
}

class TradeGatewayApp extends ConsumerWidget {
  const TradeGatewayApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: "TradeGateway™ NGSWTP",
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.dark(
          primary: const Color(0xFFD4A017),
          secondary: const Color(0xFF1E3A5F),
          surface: const Color(0xFF111827),
          background: const Color(0xFF0A1628),
          onPrimary: const Color(0xFF0A1628),
          onSecondary: Colors.white,
          onSurface: Colors.white,
          onBackground: Colors.white,
        ),
        scaffoldBackgroundColor: const Color(0xFF0A1628),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF0A1628),
          foregroundColor: Colors.white,
          elevation: 0,
        ),
        fontFamily: "Roboto",
        useMaterial3: true,
      ),
      routerConfig: router,
    );
  }
}
