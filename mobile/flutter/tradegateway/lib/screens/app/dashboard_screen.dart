/// TradeGateway™ NGSWTP — Flutter Dashboard Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});
  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  bool _loading = true;
  Map<String, dynamic>? _declStats;
  Map<String, dynamic>? _payStats;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().getDeclarationStats(),
        ApiService().getPaymentStats(),
      ]);
      setState(() {
        _declStats = results[0];
        _payStats = results[1];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Widget _statCard(String label, dynamic value, IconData icon, Color color) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(width: 8),
          Expanded(child: Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), overflow: TextOverflow.ellipsis)),
        ]),
        const SizedBox(height: 12),
        Text(value?.toString() ?? "—", style: TextStyle(color: color, fontSize: 24, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Dashboard", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
              Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF)), textAlign: TextAlign.center),
              const SizedBox(height: 16),
              ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)), child: const Text("Retry")),
            ]))
          : RefreshIndicator(
              onRefresh: _load,
              color: const Color(0xFFD4A017),
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text("Declarations", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 1.4,
                    children: [
                      _statCard("Total", _declStats?["totalDeclarations"], Icons.description, const Color(0xFF3B82F6)),
                      _statCard("Pending", _declStats?["pending"], Icons.hourglass_empty, const Color(0xFFD4A017)),
                      _statCard("Approved", _declStats?["approved"], Icons.check_circle, const Color(0xFF10B981)),
                      _statCard("Rejected", _declStats?["rejected"], Icons.cancel, const Color(0xFFEF4444)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  const Text("Payments", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 12),
                  GridView.count(
                    crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(),
                    crossAxisSpacing: 12, mainAxisSpacing: 12, childAspectRatio: 1.4,
                    children: [
                      _statCard("Total Paid", _payStats?["totalPaid"], Icons.payments, const Color(0xFF10B981)),
                      _statCard("Pending", _payStats?["pending"], Icons.pending, const Color(0xFFD4A017)),
                      _statCard("Overdue", _payStats?["overdue"], Icons.warning, const Color(0xFFEF4444)),
                      _statCard("Transactions", _payStats?["totalTransactions"], Icons.receipt_long, const Color(0xFF3B82F6)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Row(children: [
                    Expanded(child: ElevatedButton.icon(
                      onPressed: () => Navigator.pushNamed(context, "/app/declarations"),
                      icon: const Icon(Icons.description),
                      label: const Text("Declarations"),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E3A5F), foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 14)),
                    )),
                    const SizedBox(width: 12),
                    Expanded(child: ElevatedButton.icon(
                      onPressed: () => Navigator.pushNamed(context, "/app/new-declaration"),
                      icon: const Icon(Icons.add),
                      label: const Text("New Declaration"),
                      style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 14)),
                    )),
                  ]),
                ]),
              ),
            ),
    );
  }
}
