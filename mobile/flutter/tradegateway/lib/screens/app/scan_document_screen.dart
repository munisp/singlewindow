/// TradeGateway™ NGSWTP — Flutter Scan Document Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class ScanDocumentScreen extends StatefulWidget {
  const ScanDocumentScreen({super.key});
  @override
  State<ScanDocumentScreen> createState() => _ScanDocumentScreenState();
}

class _ScanDocumentScreenState extends State<ScanDocumentScreen> {
  bool _loading = true;
  Map<String, dynamic>? _stats;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getDeclarationStats();
      setState(() { _stats = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Scan Document", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Container(
          height: 240,
          decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.3), width: 2)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.camera_alt, color: Color(0xFFD4A017), size: 64),
            const SizedBox(height: 16),
            const Text("Point camera at trade document", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            const Text("Supported: Invoice, B/L, Packing List, Certificate", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Camera access requires device permissions"), backgroundColor: Color(0xFF1E3A5F))),
              icon: const Icon(Icons.camera),
              label: const Text("Open Camera"),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black),
            ),
          ]),
        ),
        const SizedBox(height: 24),
        const Text("Recent Activity", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (_loading)
          const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
        else if (_stats != null) ...[
          _activityRow(Icons.description, "Total Declarations", _stats!["totalDeclarations"]?.toString() ?? "—"),
          _activityRow(Icons.hourglass_empty, "Pending Review", _stats!["pending"]?.toString() ?? "—"),
          _activityRow(Icons.check_circle, "Approved", _stats!["approved"]?.toString() ?? "—"),
        ],
      ]),
    );
  }

  Widget _activityRow(IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFFD4A017), size: 20),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: const TextStyle(color: Color(0xFF9CA3AF)))),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}
