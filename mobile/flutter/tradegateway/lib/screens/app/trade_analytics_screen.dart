/// TradeGateway™ NGSWTP — Flutter Trade Analytics Screen
/// Parity with PWA TradeAnalytics page and RN TradeAnalyticsScreen.
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class TradeAnalyticsScreen extends StatefulWidget {
  const TradeAnalyticsScreen({super.key});
  @override
  State<TradeAnalyticsScreen> createState() => _TradeAnalyticsScreenState();
}

class _TradeAnalyticsScreenState extends State<TradeAnalyticsScreen> {
  bool _loading = true;
  Map<String, dynamic>? _summary;
  List<dynamic> _topHs = [];
  List<dynamic> _monthlyTrend = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().get("/api/trpc/tradeAnalytics.getSummary"),
        ApiService().get("/api/trpc/tradeAnalytics.getTopHsCodes?input=%7B%22limit%22%3A10%7D"),
        ApiService().get("/api/trpc/tradeAnalytics.getMonthlyTrend?input=%7B%22months%22%3A6%7D"),
      ]);
      setState(() {
        _summary = results[0]?["result"]?["data"] as Map<String, dynamic>?;
        _topHs = (results[1]?["result"]?["data"] as List<dynamic>?) ?? [];
        _monthlyTrend = (results[2]?["result"]?["data"] as List<dynamic>?) ?? [];
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
        title: const Text("Trade Analytics", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
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
                      // Summary Cards
                      Row(children: [
                        _StatCard("Total Declarations", _summary?["totalDeclarations"]?.toString() ?? "—", gold),
                        const SizedBox(width: 8),
                        _StatCard("Green Lane Rate",
                          _summary?["greenLaneRate"] != null
                              ? "${((_summary!["greenLaneRate"] as num) * 100).toStringAsFixed(1)}%"
                              : "—",
                          const Color(0xFF10B981)),
                      ]),
                      const SizedBox(height: 8),
                      Row(children: [
                        _StatCard("Avg Clearance (hrs)",
                          _summary?["avgClearanceHours"] != null
                              ? (_summary!["avgClearanceHours"] as num).toStringAsFixed(1)
                              : "—",
                          gold),
                        const SizedBox(width: 8),
                        _StatCard("Total Value",
                          _summary?["totalValue"] != null
                              ? "\$${((_summary!["totalValue"] as num) / 1_000_000).toStringAsFixed(1)}M"
                              : "—",
                          gold),
                      ]),
                      const SizedBox(height: 20),

                      // Monthly Trend
                      if (_monthlyTrend.isNotEmpty) ...[
                        const Text("Monthly Trend", style: TextStyle(color: textPrimary, fontSize: 16, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 10),
                        ..._monthlyTrend.map((m) {
                          final count = (m["count"] as num?)?.toInt() ?? 0;
                          final maxCount = (_monthlyTrend.first["count"] as num?)?.toInt() ?? 1;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Row(children: [
                              SizedBox(width: 50, child: Text(m["month"]?.toString() ?? "", style: const TextStyle(color: textSecondary, fontSize: 12))),
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(4),
                                  child: LinearProgressIndicator(
                                    value: maxCount > 0 ? count / maxCount : 0,
                                    backgroundColor: bg,
                                    valueColor: const AlwaysStoppedAnimation<Color>(gold),
                                    minHeight: 8,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(count.toString(), style: const TextStyle(color: textPrimary, fontSize: 12)),
                            ]),
                          );
                        }),
                        const SizedBox(height: 20),
                      ],

                      // Top HS Codes
                      if (_topHs.isNotEmpty) ...[
                        const Text("Top HS Codes", style: TextStyle(color: textPrimary, fontSize: 16, fontWeight: FontWeight.bold)),
                        const SizedBox(height: 10),
                        ..._topHs.asMap().entries.map((entry) {
                          final i = entry.key;
                          final h = entry.value;
                          return Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(8)),
                            child: Row(children: [
                              Container(
                                width: 28, height: 28,
                                decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
                                alignment: Alignment.center,
                                child: Text("${i + 1}", style: const TextStyle(color: gold, fontSize: 12, fontWeight: FontWeight.bold)),
                              ),
                              const SizedBox(width: 10),
                              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                Text(h["hsCode"]?.toString() ?? "—", style: const TextStyle(color: textPrimary, fontWeight: FontWeight.bold)),
                                Text(h["description"]?.toString() ?? "—", style: const TextStyle(color: textSecondary, fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                              ])),
                              Text(h["count"]?.toString() ?? "—", style: const TextStyle(color: gold, fontWeight: FontWeight.bold)),
                            ]),
                          );
                        }),
                      ],
                    ],
                  ),
                ),
    );
  }

  Widget _StatCard(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 11)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(color: valueColor, fontSize: 20, fontWeight: FontWeight.bold)),
        ]),
      ),
    );
  }
}
