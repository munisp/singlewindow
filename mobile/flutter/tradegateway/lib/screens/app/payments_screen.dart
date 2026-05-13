/// TradeGateway™ NGSWTP — Flutter Payments Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class PaymentsScreen extends StatefulWidget {
  const PaymentsScreen({super.key});
  @override
  State<PaymentsScreen> createState() => _PaymentsScreenState();
}

class _PaymentsScreenState extends State<PaymentsScreen> {
  bool _loading = true;
  Map<String, dynamic>? _stats;
  List<dynamic> _items = [];
  String? _error;
  int _page = 1;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().getPaymentStats(),
        ApiService().listPayments(page: _page, limit: 20),
      ]);
      setState(() {
        _stats = results[0];
        _items = (results[1]["items"] as List?) ?? [];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Color _statusColor(String? s) {
    switch (s) {
      case "completed": return const Color(0xFF10B981);
      case "pending": return const Color(0xFFD4A017);
      case "failed": return const Color(0xFFEF4444);
      default: return const Color(0xFF6B7280);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Payments", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
                // Stats row
                Row(children: [
                  _statChip("Paid", _stats?["totalPaid"], const Color(0xFF10B981)),
                  const SizedBox(width: 8),
                  _statChip("Pending", _stats?["pending"], const Color(0xFFD4A017)),
                  const SizedBox(width: 8),
                  _statChip("Overdue", _stats?["overdue"], const Color(0xFFEF4444)),
                ]),
                const SizedBox(height: 16),
                const Text("Recent Payments", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ..._items.map((p) {
                  final pay = p as Map<String, dynamic>;
                  final status = pay["status"] as String? ?? "pending";
                  final color = _statusColor(status);
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                    child: Row(children: [
                      Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(pay["declarationRef"] as String? ?? pay["reference"] as String? ?? "—",
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
                        const SizedBox(height: 4),
                        Text("${pay["currency"] ?? "USD"} ${pay["amount"] ?? "—"}",
                            style: const TextStyle(color: Color(0xFFD4A017), fontSize: 14, fontWeight: FontWeight.w700)),
                        const SizedBox(height: 2),
                        Text(pay["createdAt"] as String? ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                      ])),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4), border: Border.all(color: color.withOpacity(0.4))),
                        child: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
                      ),
                    ]),
                  );
                }),
              ]),
            ),
    );
  }

  Widget _statChip(String label, dynamic value, Color color) {
    return Expanded(child: Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: color.withOpacity(0.1), borderRadius: BorderRadius.circular(8), border: Border.all(color: color.withOpacity(0.3))),
      child: Column(children: [
        Text(value?.toString() ?? "—", style: TextStyle(color: color, fontSize: 18, fontWeight: FontWeight.w700)),
        Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 11)),
      ]),
    ));
  }
}
