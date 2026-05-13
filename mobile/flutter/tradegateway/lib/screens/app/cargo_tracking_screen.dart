/// TradeGateway™ NGSWTP — Flutter Cargo Tracking Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class CargoTrackingScreen extends StatefulWidget {
  const CargoTrackingScreen({super.key});
  @override
  State<CargoTrackingScreen> createState() => _CargoTrackingScreenState();
}

class _CargoTrackingScreenState extends State<CargoTrackingScreen> {
  bool _loading = true;
  List<dynamic> _vessels = [];
  String? _error;
  final _ucrCtrl = TextEditingController();
  Map<String, dynamic>? _tracked;
  bool _tracking = false;

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _ucrCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().listCargoTracking();
      setState(() { _vessels = (result["vessels"] as List?) ?? []; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _trackUCR() async {
    if (_ucrCtrl.text.trim().isEmpty) return;
    try {
      setState(() { _tracking = true; _tracked = null; });
      final result = await ApiService().trackByUCR(_ucrCtrl.text.trim());
      setState(() { _tracked = result; _tracking = false; });
    } catch (e) {
      setState(() { _tracking = false; });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: const Color(0xFFEF4444)));
    }
  }

  Color _riskColor(String? r) {
    switch (r) {
      case "red": return const Color(0xFFEF4444);
      case "amber": return const Color(0xFFD4A017);
      default: return const Color(0xFF10B981);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Cargo Tracking", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: Row(children: [
            Expanded(child: TextField(
              controller: _ucrCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: InputDecoration(
                hintText: "Track by UCR number...",
                hintStyle: const TextStyle(color: Color(0xFF6B7280)),
                filled: true, fillColor: const Color(0xFF111827),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
              ),
            )),
            const SizedBox(width: 8),
            ElevatedButton(
              onPressed: _tracking ? null : _trackUCR,
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black),
              child: _tracking ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Track"),
            ),
          ]),
        ),
        if (_tracked != null)
          Container(
            margin: const EdgeInsets.symmetric(horizontal: 12),
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.4))),
            child: _tracked!["found"] == true
              ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text("Vessel Found", style: TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Text("Name: ${_tracked!["vessel"]?["vesselName"] ?? "—"}", style: const TextStyle(color: Colors.white)),
                  Text("Status: ${_tracked!["vessel"]?["status"] ?? "—"}", style: const TextStyle(color: Color(0xFF9CA3AF))),
                  Text("Destination: ${_tracked!["vessel"]?["destinationPort"] ?? "—"}", style: const TextStyle(color: Color(0xFF9CA3AF))),
                ])
              : const Text("No vessel found for this UCR", style: TextStyle(color: Color(0xFF9CA3AF))),
          ),
        const SizedBox(height: 8),
        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFFD4A017))))
        else if (_error != null)
          Expanded(child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF))),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)), child: const Text("Retry")),
          ])))
        else
          Expanded(child: RefreshIndicator(
            onRefresh: _load,
            color: const Color(0xFFD4A017),
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              itemCount: _vessels.length,
              itemBuilder: (ctx, i) {
                final v = _vessels[i] as Map<String, dynamic>;
                final risk = v["riskFlag"] as String? ?? "green";
                final rColor = _riskColor(risk);
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                  child: Row(children: [
                    Container(width: 4, height: 48, decoration: BoxDecoration(color: rColor, borderRadius: BorderRadius.circular(2))),
                    const SizedBox(width: 12),
                    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(v["vesselName"] as String? ?? v["name"] as String? ?? "—", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      Text("MMSI: ${v["mmsi"] ?? "—"} | ${v["status"] ?? "—"}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                      Text("→ ${v["destinationPort"] ?? v["destination"] ?? "—"}", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                    ])),
                    Text("${v["speed"] ?? 0} kn", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.w600)),
                  ]),
                );
              },
            ),
          )),
      ]),
    );
  }
}
