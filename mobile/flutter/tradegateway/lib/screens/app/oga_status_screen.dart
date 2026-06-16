/// TradeGateway™ NGSWTP — Flutter OGA Status Screen (v43 — getOgaStatus wired)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

// Alias for backward compat with app_router.dart which uses OGAStatusScreen
typedef OGAStatusScreen = OgaStatusScreen;

class OgaStatusScreen extends StatefulWidget {
  const OgaStatusScreen({super.key});
  @override
  State<OgaStatusScreen> createState() => _OgaStatusScreenState();
}

class _OgaStatusScreenState extends State<OgaStatusScreen> {
  bool _loading = true;
  Map<String, dynamic>? _ogaData;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getOgaStatus();
      setState(() {
        _ogaData = result;
        _items = (result["agencies"] as List<dynamic>?) ?? [];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final pendingCount = _ogaData?["pendingCount"] as int? ?? 0;
    final approvedCount = _ogaData?["approvedCount"] as int? ?? 0;

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("OGA Status", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
        : _error != null
          ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
              const SizedBox(height: 16),
              Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF))),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)), child: const Text("Retry")),
            ]))
          : RefreshIndicator(
              onRefresh: _load,
              color: const Color(0xFFD4A017),
              child: ListView(padding: const EdgeInsets.all(16), children: [
                // Summary row
                Row(children: [
                  Expanded(child: _StatCard(label: "Pending", value: "$pendingCount", color: const Color(0xFFD4A017))),
                  const SizedBox(width: 12),
                  Expanded(child: _StatCard(label: "Approved", value: "$approvedCount", color: const Color(0xFF10B981))),
                ]),
                const SizedBox(height: 20),
                const Text("Agency Status", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                if (_items.isEmpty)
                  const Center(child: Padding(
                    padding: EdgeInsets.all(32),
                    child: Column(children: [
                      Icon(Icons.check_circle, color: Color(0xFF10B981), size: 64),
                      SizedBox(height: 16),
                      Text("No declarations awaiting OGA approval", style: TextStyle(color: Color(0xFF9CA3AF))),
                    ]),
                  ))
                else
                  ..._items.map((agency) {
                    final name = agency["name"] as String? ?? "Unknown Agency";
                    final status = agency["status"] as String? ?? "pending";
                    final pendingDecls = agency["pendingDeclarations"] as int? ?? 0;
                    final avgDays = agency["avgProcessingDays"] as num? ?? 0;
                    final statusColor = status == "operational" ? const Color(0xFF10B981)
                      : status == "degraded" ? const Color(0xFFD4A017)
                      : const Color(0xFFEF4444);
                    return Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: const Color(0xFF111827),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: statusColor.withOpacity(0.25)),
                      ),
                      child: Row(children: [
                        Container(
                          width: 10, height: 10,
                          decoration: BoxDecoration(color: statusColor, shape: BoxShape.circle),
                        ),
                        const SizedBox(width: 12),
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                          Text("$pendingDecls pending · avg ${avgDays.toStringAsFixed(1)} days", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        ])),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                          child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
                        ),
                      ]),
                    );
                  }),
              ]),
            ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _StatCard({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Column(children: [
        Text(value, style: TextStyle(color: color, fontSize: 28, fontWeight: FontWeight.w700)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
      ]),
    );
  }
}
