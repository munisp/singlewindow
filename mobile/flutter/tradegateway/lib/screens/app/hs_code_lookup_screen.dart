/// TradeGateway™ NGSWTP — Flutter HS Code Lookup Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class HsCodeLookupScreen extends StatefulWidget {
  const HsCodeLookupScreen({super.key});
  @override
  State<HsCodeLookupScreen> createState() => _HsCodeLookupScreenState();
}

class _HsCodeLookupScreenState extends State<HsCodeLookupScreen> {
  final _ctrl = TextEditingController();
  bool _loading = false;
  List<Map<String, dynamic>> _results = [];
  String? _error;

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  Future<void> _search() async {
    if (_ctrl.text.trim().length < 2) return;
    try {
      setState(() { _loading = true; _error = null; _results = []; });
      final res = await ApiService().searchHsCode(_ctrl.text.trim());
      setState(() { _results = res.cast<Map<String, dynamic>>(); _loading = false; });
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
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(child: TextField(
              controller: _ctrl,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: "Search HS codes or descriptions...",
                hintStyle: const TextStyle(color: Color(0xFF6B7280)),
                filled: true, fillColor: const Color(0xFF111827),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
              ),
              onSubmitted: (_) => _search(),
            )),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: _loading ? null : _search,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black),
              child: _loading ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Search"),
            ),
          ]),
        ),
        if (_error != null)
          Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Text(_error!, style: const TextStyle(color: Color(0xFFEF4444)))),
        Expanded(child: _results.isEmpty && !_loading
          ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(Icons.search, color: Color(0xFF6B7280), size: 64),
              SizedBox(height: 16),
              Text("Enter a keyword or HS code to search", style: TextStyle(color: Color(0xFF9CA3AF))),
            ]))
          : ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _results.length,
              itemBuilder: (ctx, i) {
                final r = _results[i];
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(color: const Color(0xFFD4A017).withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                        child: Text(r["code"] as String? ?? "—", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.w700, fontSize: 13)),
                      ),
                      const SizedBox(width: 8),
                      Expanded(child: Text("Chapter ${r["chapter"] ?? "—"}", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12))),
                      Text("Duty: ${r["dutyRate"] ?? "—"}%", style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.w600)),
                    ]),
                    const SizedBox(height: 8),
                    Text(r["description"] as String? ?? "—", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
                  ]),
                );
              },
            )),
      ]),
    );
  }
}
