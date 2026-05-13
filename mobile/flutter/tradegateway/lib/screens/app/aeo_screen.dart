/// TradeGateway™ NGSWTP — Flutter AEO Programme Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class AeoScreen extends StatefulWidget {
  const AeoScreen({super.key});
  @override
  State<AeoScreen> createState() => _AeoScreenState();
}

class _AeoScreenState extends State<AeoScreen> {
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

  @override
  Widget build(BuildContext context) {
    final score = _data?["score"] as num? ?? 0;
    final tier = _data?["tier"] as String? ?? "Standard";
    final isAeo = tier.toLowerCase() == "aeo" || tier.toLowerCase() == "gold";
    final tierColor = isAeo ? const Color(0xFFD4A017) : score > 70 ? const Color(0xFF10B981) : const Color(0xFF6B7280);

    final benefits = isAeo
      ? ["Priority customs clearance", "Reduced physical inspections", "Dedicated AEO liaison officer", "Expedited OGA approvals", "Green lane access", "Mutual recognition with partner countries"]
      : score > 70
        ? ["Reduced documentary checks", "Expedited processing queue", "AEO application eligible"]
        : ["Complete KYC verification", "Achieve 70+ compliance score", "Maintain clean declaration history"];

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("AEO Programme", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
                    gradient: LinearGradient(colors: [const Color(0xFF111827), tierColor.withOpacity(0.15)], begin: Alignment.topLeft, end: Alignment.bottomRight),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: tierColor.withOpacity(0.4)),
                  ),
                  child: Column(children: [
                    Icon(isAeo ? Icons.verified : Icons.shield, color: tierColor, size: 48),
                    const SizedBox(height: 12),
                    Text(isAeo ? "Authorised Economic Operator" : "AEO Status: ${tier}", style: TextStyle(color: tierColor, fontSize: 18, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    Text("Compliance Score: $score/100", style: const TextStyle(color: Color(0xFF9CA3AF))),
                  ]),
                ),
                const SizedBox(height: 24),
                Text(isAeo ? "Your AEO Benefits" : "Steps to AEO Status", style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ...benefits.map((b) => Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                  child: Row(children: [
                    Icon(isAeo ? Icons.check_circle : Icons.arrow_forward, color: tierColor, size: 18),
                    const SizedBox(width: 12),
                    Expanded(child: Text(b, style: const TextStyle(color: Color(0xFF9CA3AF)))),
                  ]),
                )),
                if (!isAeo) ...[
                  const SizedBox(height: 16),
                  SizedBox(width: double.infinity, child: ElevatedButton(
                    onPressed: () {},
                    style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 14)),
                    child: const Text("Apply for AEO Status"),
                  )),
                ],
              ]),
            ),
    );
  }
}
