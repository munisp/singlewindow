/// TradeGateway™ NGSWTP — Flutter System Status Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class SystemStatusScreen extends StatefulWidget {
  const SystemStatusScreen({super.key});
  @override
  State<SystemStatusScreen> createState() => _SystemStatusScreenState();
}

class _SystemStatusScreenState extends State<SystemStatusScreen> {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getSystemStatus();
      setState(() { _data = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Color _statusColor(String? s) {
    switch (s?.toLowerCase()) {
      case "operational": case "healthy": case "ok": return const Color(0xFF10B981);
      case "degraded": case "warning": return const Color(0xFFD4A017);
      case "down": case "error": case "critical": return const Color(0xFFEF4444);
      default: return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    final overall = _data?["overall"] as String? ?? _data?["status"] as String? ?? "unknown";
    final services = (_data?["services"] as List?) ?? [];
    final overallColor = _statusColor(overall);

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("System Status", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
                Container(
                  padding: const EdgeInsets.all(20),
                  decoration: BoxDecoration(color: overallColor.withOpacity(0.1), borderRadius: BorderRadius.circular(12), border: Border.all(color: overallColor.withOpacity(0.3))),
                  child: Row(children: [
                    Icon(overall == "operational" || overall == "healthy" ? Icons.check_circle : Icons.warning, color: overallColor, size: 32),
                    const SizedBox(width: 16),
                    Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text("Overall Status", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                      Text(overall.toUpperCase(), style: TextStyle(color: overallColor, fontSize: 18, fontWeight: FontWeight.w700)),
                    ]),
                  ]),
                ),
                const SizedBox(height: 20),
                const Text("Services", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ...services.map((s) {
                  final svc = s as Map<String, dynamic>;
                  final status = svc["status"] as String? ?? "unknown";
                  final color = _statusColor(status);
                  final latency = svc["latency"] as num?;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                    child: Row(children: [
                      Container(width: 10, height: 10, decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
                      const SizedBox(width: 12),
                      Expanded(child: Text(svc["name"] as String? ?? "—", style: const TextStyle(color: Colors.white))),
                      if (latency != null) Text("${latency}ms", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12)),
                      const SizedBox(width: 8),
                      Text(status, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
                    ]),
                  );
                }),
              ]),
            ),
    );
  }
}
