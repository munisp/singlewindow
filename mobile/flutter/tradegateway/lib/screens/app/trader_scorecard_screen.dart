/// TradeGateway™ NGSWTP — Flutter Trader Scorecard Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class TraderScorecardScreen extends StatefulWidget {
  const TraderScorecardScreen({super.key});
  @override
  State<TraderScorecardScreen> createState() => _TraderScorecardScreenState();
}

class _TraderScorecardScreenState extends State<TraderScorecardScreen> {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getTraderScorecard();
      setState(() { _data = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Color _tierColor(String? tier) {
    switch (tier?.toLowerCase()) {
      case "aeo": case "gold": return const Color(0xFFD4A017);
      case "silver": return const Color(0xFF9CA3AF);
      case "probation": return const Color(0xFFEF4444);
      default: return const Color(0xFF3B82F6);
    }
  }

  @override
  Widget build(BuildContext context) {
    final score = _data?["score"] as num? ?? 0;
    final tier = _data?["tier"] as String? ?? "Standard";
    final metrics = (_data?["metrics"] as List?) ?? [];
    final tierColor = _tierColor(tier);

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Trader Scorecard", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(colors: [const Color(0xFF111827), tierColor.withOpacity(0.2)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: tierColor.withOpacity(0.3)),
                  ),
                  child: Column(children: [
                    Text("$score", style: TextStyle(color: tierColor, fontSize: 72, fontWeight: FontWeight.w900)),
                    Text("Compliance Score", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 14)),
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                      decoration: BoxDecoration(color: tierColor.withOpacity(0.15), borderRadius: BorderRadius.circular(20), border: Border.all(color: tierColor)),
                      child: Text(tier.toUpperCase(), style: TextStyle(color: tierColor, fontWeight: FontWeight.w700, fontSize: 14, letterSpacing: 2)),
                    ),
                  ]),
                ),
                const SizedBox(height: 24),
                const Text("Performance Metrics", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ...metrics.map((m) {
                  final metric = m as Map<String, dynamic>;
                  final trend = metric["trend"] as String? ?? "stable";
                  final trendColor = trend == "up" ? const Color(0xFF10B981) : trend == "down" ? const Color(0xFFEF4444) : const Color(0xFF6B7280);
                  final trendIcon = trend == "up" ? Icons.trending_up : trend == "down" ? Icons.trending_down : Icons.trending_flat;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                    child: Row(children: [
                      Expanded(child: Text(metric["label"] as String? ?? "—", style: const TextStyle(color: Color(0xFF9CA3AF)))),
                      Text(metric["value"]?.toString() ?? "—", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                      const SizedBox(width: 8),
                      Icon(trendIcon, color: trendColor, size: 18),
                    ]),
                  );
                }),
              ]),
            ),
    );
  }
}
