/// TradeGateway™ NGSWTP — Flutter OGA Status Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class OgaStatusScreen extends StatefulWidget {
  const OgaStatusScreen({super.key});
  @override
  State<OgaStatusScreen> createState() => _OgaStatusScreenState();
}

class _OgaStatusScreenState extends State<OgaStatusScreen> {
  bool _loading = true;
  List<dynamic> _items = [];
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().listDeclarations(status: "submitted", limit: 50);
      setState(() { _items = (result.toJson()["items"] as List?) ?? []; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
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
              child: _items.isEmpty
                ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.check_circle, color: Color(0xFF10B981), size: 64),
                    SizedBox(height: 16),
                    Text("No declarations awaiting OGA approval", style: TextStyle(color: Color(0xFF9CA3AF))),
                  ]))
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _items.length,
                    itemBuilder: (ctx, i) {
                      final d = _items[i] as Map<String, dynamic>;
                      final agency = d["ogaAgency"] as String? ?? "Customs Authority";
                      final days = d["daysWaiting"] as int? ?? 0;
                      final daysColor = days > 5 ? const Color(0xFFEF4444) : days > 2 ? const Color(0xFFD4A017) : const Color(0xFF10B981);
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                            Text(d["ucr"] as String? ?? "—", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                              decoration: BoxDecoration(color: daysColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                              child: Text("$days days", style: TextStyle(color: daysColor, fontSize: 11, fontWeight: FontWeight.w700)),
                            ),
                          ]),
                          const SizedBox(height: 4),
                          Text("Agency: $agency", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                          Text(d["description"] as String? ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
                        ]),
                      );
                    },
                  ),
            ),
    );
  }
}
