/// TradeGateway™ NGSWTP — Flutter Duty Drawback Screen
/// Parity with PWA DutyDrawback page and RN DutyDrawbackScreen.
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class DutyDrawbackScreen extends StatefulWidget {
  const DutyDrawbackScreen({super.key});
  @override
  State<DutyDrawbackScreen> createState() => _DutyDrawbackScreenState();
}

class _DutyDrawbackScreenState extends State<DutyDrawbackScreen> {
  bool _loading = true;
  List<dynamic> _claims = [];
  Map<String, dynamic>? _stats;
  String? _error;

  static const _statusColors = {
    "pending": Color(0xFFD97706),
    "approved": Color(0xFF059669),
    "rejected": Color(0xFFDC2626),
    "paid": Color(0xFF2563EB),
    "under_review": Color(0xFF7C3AED),
  };

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().get("/api/trpc/dutyDrawback.list?input=%7B%22limit%22%3A50%7D"),
        ApiService().get("/api/trpc/dutyDrawback.getStats"),
      ]);
      setState(() {
        _claims = (results[0]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
        _stats = results[1]?["result"]?["data"] as Map<String, dynamic>?;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF0A1628);
    const card = Color(0xFF1E3A5F);
    const gold = Color(0xFFD4A017);
    const textPrimary = Colors.white;
    const textSecondary = Color(0xFF9CA3AF);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: const Text("Duty Drawback", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
        actions: [
          TextButton(
            onPressed: () => ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text("Use the web portal to submit new drawback claims with supporting documents.")),
            ),
            child: const Text("+ New", style: TextStyle(color: gold, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: gold))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : RefreshIndicator(
                  color: gold,
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Stats
                      if (_stats != null) ...[
                        Row(children: [
                          _StatCard("Total Claims", _stats!["totalClaims"]?.toString() ?? "0", gold),
                          const SizedBox(width: 8),
                          _StatCard("Pending", _stats!["pendingClaims"]?.toString() ?? "0", const Color(0xFFD97706)),
                          const SizedBox(width: 8),
                          _StatCard("Recovered",
                            _stats!["totalRecovered"] != null
                                ? "\$${((_stats!["totalRecovered"] as num) / 1000).toStringAsFixed(0)}K"
                                : "—",
                            const Color(0xFF059669)),
                        ]),
                        const SizedBox(height: 20),
                      ],

                      // Claims list
                      if (_claims.isEmpty)
                        const Center(child: Padding(
                          padding: EdgeInsets.all(40),
                          child: Text("No drawback claims found", style: TextStyle(color: Color(0xFF9CA3AF))),
                        ))
                      else
                        ..._claims.map((c) {
                          final status = c["status"]?.toString() ?? "pending";
                          final statusColor = _statusColors[status] ?? const Color(0xFF6B7280);
                          return Container(
                            margin: const EdgeInsets.only(bottom: 10),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(8)),
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                Text(c["referenceNumber"]?.toString() ?? "CLM-${c["id"]}", style: const TextStyle(color: textPrimary, fontWeight: FontWeight.bold)),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                                  child: Text(status.replaceAll("_", " ").toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.bold)),
                                ),
                              ]),
                              const SizedBox(height: 4),
                              Text("Declaration: ${c["declarationRef"] ?? "—"}", style: const TextStyle(color: textSecondary, fontSize: 12)),
                              const SizedBox(height: 6),
                              Row(children: [
                                Text("Claimed: \$${(c["claimedAmount"] as num? ?? 0).toStringAsFixed(0)}", style: const TextStyle(color: gold, fontWeight: FontWeight.bold)),
                                if (c["approvedAmount"] != null) ...[
                                  const SizedBox(width: 12),
                                  Text("Approved: \$${(c["approvedAmount"] as num).toStringAsFixed(0)}", style: const TextStyle(color: Color(0xFF059669), fontWeight: FontWeight.bold)),
                                ],
                              ]),
                            ]),
                          );
                        }),
                    ],
                  ),
                ),
    );
  }

  Widget _StatCard(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 10)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(color: valueColor, fontSize: 16, fontWeight: FontWeight.bold)),
        ]),
      ),
    );
  }
}
