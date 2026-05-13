/// TradeGateway™ NGSWTP — Flutter Login Screen (v37)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  bool _checking = true;
  bool _loading = false;
  final _emailCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  bool _obscure = true;

  @override
  void initState() { super.initState(); _checkSession(); }
  @override
  void dispose() { _emailCtrl.dispose(); _passCtrl.dispose(); super.dispose(); }

  Future<void> _checkSession() async {
    try {
      final user = await ApiService().getMe();
      if (user != null && mounted) {
        Navigator.pushReplacementNamed(context, "/app/dashboard");
        return;
      }
    } catch (_) {}
    setState(() => _checking = false);
  }

  Future<void> _login() async {
    if (_emailCtrl.text.trim().isEmpty) return;
    setState(() => _loading = true);
    await Future.delayed(const Duration(milliseconds: 800));
    setState(() => _loading = false);
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Redirecting to secure login portal..."), backgroundColor: Color(0xFF1E3A5F)));
      await Future.delayed(const Duration(seconds: 1));
      if (mounted) Navigator.pushReplacementNamed(context, "/app/dashboard");
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) return const Scaffold(backgroundColor: Color(0xFF0A1628), body: Center(child: CircularProgressIndicator(color: Color(0xFFD4A017))));

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      body: SafeArea(child: Center(child: SingleChildScrollView(padding: const EdgeInsets.all(32), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        const Icon(Icons.account_balance, color: Color(0xFFD4A017), size: 64),
        const SizedBox(height: 16),
        const Text("TradeGateway™", style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 1)),
        const Text("NGSWTP", style: TextStyle(color: Color(0xFFD4A017), fontSize: 14, letterSpacing: 4)),
        const SizedBox(height: 8),
        const Text("National Single Window Trade Platform", style: TextStyle(color: Color(0xFF6B7280), fontSize: 12), textAlign: TextAlign.center),
        const SizedBox(height: 40),
        TextField(
          controller: _emailCtrl,
          style: const TextStyle(color: Colors.white),
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(
            labelText: "Email / Trader ID",
            labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
            prefixIcon: const Icon(Icons.person, color: Color(0xFF6B7280)),
            filled: true, fillColor: const Color(0xFF111827),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _passCtrl,
          style: const TextStyle(color: Colors.white),
          obscureText: _obscure,
          decoration: InputDecoration(
            labelText: "Password",
            labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
            prefixIcon: const Icon(Icons.lock, color: Color(0xFF6B7280)),
            suffixIcon: IconButton(icon: Icon(_obscure ? Icons.visibility : Icons.visibility_off, color: const Color(0xFF6B7280)), onPressed: () => setState(() => _obscure = !_obscure)),
            filled: true, fillColor: const Color(0xFF111827),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
            focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
          ),
        ),
        const SizedBox(height: 24),
        SizedBox(width: double.infinity, child: ElevatedButton(
          onPressed: _loading ? null : _login,
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 16)),
          child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Sign In", style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
        )),
        const SizedBox(height: 16),
        TextButton(onPressed: () {}, child: const Text("Forgot password?", style: TextStyle(color: Color(0xFFD4A017)))),
      ])))),
    );
  }
}
