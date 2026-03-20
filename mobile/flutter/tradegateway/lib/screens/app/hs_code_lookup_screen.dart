/// TradeGateway™ NGSWTP — Flutter HS Code Lookup Screen
library;

import "package:flutter/material.dart";
import "../../services/api_service.dart";

class HSCodeLookupScreen extends StatefulWidget {
  const HSCodeLookupScreen({super.key});
  @override
  State<HSCodeLookupScreen> createState() => _HSCodeLookupScreenState();
}

class _HSCodeLookupScreenState extends State<HSCodeLookupScreen> {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      // TODO: Call specific ApiService method for HS Code Lookup
      // final data = await ApiService().getHSCodeLookup();
      setState(() { _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("HS Code Lookup", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
                  const SizedBox(height: 16),
                  Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF))),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, child: const Text("Retry")),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  color: const Color(0xFFD4A017),
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      Text("HS Code Lookup", style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
                      const SizedBox(height: 16),
                      Container(
                        padding: const EdgeInsets.all(16),
                        decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                        child: const Text("Content loaded from TradeGateway™ API", style: TextStyle(color: Color(0xFF9CA3AF))),
                      ),
                    ],
                  ),
                ),
    );
  }
}
