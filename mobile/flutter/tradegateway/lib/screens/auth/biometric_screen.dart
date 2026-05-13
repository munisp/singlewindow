/// TradeGateway™ NGSWTP — Flutter Biometric Auth Screen (v37)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class BiometricScreen extends StatefulWidget {
  const BiometricScreen({super.key});
  @override
  State<BiometricScreen> createState() => _BiometricScreenState();
}

class _BiometricScreenState extends State<BiometricScreen> {
  bool _loading = false;
  String? _error;

  Future<void> _authenticate() async {
    try {
      setState(() { _loading = true; _error = null; });
      final user = await ApiService().getMe();
      setState(() => _loading = false);
      if (user != null && mounted) {
        Navigator.pushReplacementNamed(context, "/app/dashboard");
      } else {
        setState(() => _error = "Session expired. Please log in again.");
      }
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      body: SafeArea(child: Center(child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
          const Icon(Icons.account_balance, color: Color(0xFFD4A017), size: 48),
          const SizedBox(height: 8),
          const Text("TradeGateway™", style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 48),
          Container(
            width: 120, height: 120,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: const Color(0xFF111827),
              border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.4), width: 2),
            ),
            child: Icon(Icons.fingerprint, color: _loading ? const Color(0xFF6B7280) : const Color(0xFFD4A017), size: 80),
          ),
          const SizedBox(height: 32),
          const Text("Authenticate with Biometrics", style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
          const SizedBox(height: 12),
          const Text("Use your fingerprint or face ID to access TradeGateway", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14), textAlign: TextAlign.center),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Color(0xFFEF4444), fontSize: 13), textAlign: TextAlign.center),
          ],
          const SizedBox(height: 32),
          SizedBox(width: double.infinity, child: ElevatedButton(
            onPressed: _loading ? null : _authenticate,
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 16)),
            child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Authenticate", style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          )),
          const SizedBox(height: 16),
          TextButton(
            onPressed: () => Navigator.pushReplacementNamed(context, "/auth/login"),
            child: const Text("Use password instead", style: TextStyle(color: Color(0xFF6B7280))),
          ),
        ]),
      ))),
    );
  }
}
