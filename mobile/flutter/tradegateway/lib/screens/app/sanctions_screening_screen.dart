/// TradeGateway™ NGSWTP — Flutter Sanctions Screening Screen
/// Parity with PWA SanctionsScreening page and RN SanctionsScreeningScreen.
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class SanctionsScreeningScreen extends StatefulWidget {
  const SanctionsScreeningScreen({super.key});
  @override
  State<SanctionsScreeningScreen> createState() => _SanctionsScreeningScreenState();
}

class _SanctionsScreeningScreenState extends State<SanctionsScreeningScreen> {
  bool _loading = true;
  bool _screening = false;
  List<dynamic> _recent = [];
  Map<String, dynamic>? _stats;
  Map<String, dynamic>? _result;
  String? _error;
  final _searchCtrl = TextEditingController();

  @override
  void initState() { super.initState(); _load(); }

  @override
  void dispose() { _searchCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().get("/api/trpc/sanctionsScreening.getRecentScreenings?input=%7B%22limit%22%3A20%7D"),
        ApiService().get("/api/trpc/sanctionsScreening.getStats"),
      ]);
      setState(() {
        _recent = (results[0]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
        _stats = results[1]?["result"]?["data"] as Map<String, dynamic>?;
        _loading = false;
      });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _screen() async {
    if (_searchCtrl.text.trim().isEmpty) return;
    setState(() { _screening = true; _result = null; });
    try {
      final res = await ApiService().post("/api/trpc/sanctionsScreening.screenEntity", {
        "entityName": _searchCtrl.text.trim(),
        "entityType": "company",
      });
      setState(() { _result = res?["result"]?["data"] as Map<String, dynamic>?; _screening = false; });
    } catch (e) {
      setState(() { _screening = false; });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
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
        title: const Text("Sanctions Screening", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: gold))
          : RefreshIndicator(
              color: gold,
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Stats
                  if (_stats != null) ...[
                    Row(children: [
                      _StatCard("Screened Today", _stats!["screenedToday"]?.toString() ?? "0", gold),
                      const SizedBox(width: 8),
                      _StatCard("Hits", _stats!["hits"]?.toString() ?? "0", const Color(0xFFDC2626)),
                      const SizedBox(width: 8),
                      _StatCard("Clear", _stats!["clear"]?.toString() ?? "0", const Color(0xFF059669)),
                    ]),
                    const SizedBox(height: 20),
                  ],

                  // Search
                  const Text("Screen an Entity", style: TextStyle(color: textPrimary, fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  Row(children: [
                    Expanded(
                      child: TextField(
                        controller: _searchCtrl,
                        style: const TextStyle(color: textPrimary),
                        decoration: InputDecoration(
                          hintText: "Enter company or individual name...",
                          hintStyle: const TextStyle(color: textSecondary),
                          filled: true,
                          fillColor: card,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
                        ),
                        onSubmitted: (_) => _screen(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: _screening ? null : _screen,
                      style: ElevatedButton.styleFrom(backgroundColor: gold, padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14)),
                      child: _screening
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Color(0xFF0A1628), strokeWidth: 2))
                          : const Text("Screen", style: TextStyle(color: Color(0xFF0A1628), fontWeight: FontWeight.bold)),
                    ),
                  ]),

                  // Result
                  if (_result != null) ...[
                    const SizedBox(height: 12),
                    Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(
                        color: card,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: _result!["isMatch"] == true ? const Color(0xFFDC2626) : const Color(0xFF059669)),
                      ),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(
                          _result!["isMatch"] == true ? "⚠ SANCTIONS MATCH FOUND" : "✓ CLEAR — No Sanctions Match",
                          style: TextStyle(
                            color: _result!["isMatch"] == true ? const Color(0xFFDC2626) : const Color(0xFF059669),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(_result!["entityName"]?.toString() ?? "", style: const TextStyle(color: textPrimary, fontWeight: FontWeight.bold)),
                        if (_result!["matchDetails"] != null)
                          Text(_result!["matchDetails"].toString(), style: const TextStyle(color: textSecondary, fontSize: 12)),
                      ]),
                    ),
                  ],
                  const SizedBox(height: 20),

                  // Recent Screenings
                  const Text("Recent Screenings", style: TextStyle(color: textPrimary, fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  if (_recent.isEmpty)
                    const Text("No recent screenings", style: TextStyle(color: textSecondary))
                  else
                    ..._recent.map((s) => Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(8)),
                      child: Row(children: [
                        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(s["entityName"]?.toString() ?? "—", style: const TextStyle(color: textPrimary, fontSize: 13)),
                          Text(s["createdAt"] != null ? DateTime.parse(s["createdAt"]).toLocal().toString().substring(0, 10) : "—",
                            style: const TextStyle(color: textSecondary, fontSize: 11)),
                        ])),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(
                            color: s["isMatch"] == true ? const Color(0xFFDC262620) : const Color(0xFF05966920),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            s["isMatch"] == true ? "HIT" : "CLEAR",
                            style: TextStyle(color: s["isMatch"] == true ? const Color(0xFFDC2626) : const Color(0xFF059669), fontSize: 11, fontWeight: FontWeight.bold),
                          ),
                        ),
                      ]),
                    )),
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
