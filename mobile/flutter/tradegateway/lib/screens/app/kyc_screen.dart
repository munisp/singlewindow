/// TradeGateway™ NGSWTP — Flutter KYC Verification Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class KycScreen extends StatefulWidget {
  const KycScreen({super.key});
  @override
  State<KycScreen> createState() => _KycScreenState();
}

class _KycScreenState extends State<KycScreen> {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getKYCStatus();
      setState(() { _data = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final completed = _data?["completedSteps"] as int? ?? 0;
    final total = _data?["totalSteps"] as int? ?? 5;
    final status = _data?["status"] as String? ?? "pending";
    final nextStep = _data?["nextStep"] as String? ?? "";
    final steps = (_data?["steps"] as List?) ?? [];
    final progress = total > 0 ? completed / total : 0.0;
    final statusColor = status == "verified" ? const Color(0xFF10B981) : status == "rejected" ? const Color(0xFFEF4444) : const Color(0xFFD4A017);

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("KYC Verification", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
                  decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(12)),
                  child: Column(children: [
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      const Text("Verification Status", style: TextStyle(color: Color(0xFF9CA3AF))),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(20), border: Border.all(color: statusColor.withOpacity(0.4))),
                        child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontWeight: FontWeight.w700, fontSize: 12)),
                      ),
                    ]),
                    const SizedBox(height: 16),
                    LinearProgressIndicator(value: progress, backgroundColor: const Color(0xFF1E3A5F), valueColor: AlwaysStoppedAnimation<Color>(statusColor), minHeight: 8),
                    const SizedBox(height: 8),
                    Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                      Text("$completed of $total steps completed", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                      Text("${(progress * 100).toInt()}%", style: TextStyle(color: statusColor, fontWeight: FontWeight.w700)),
                    ]),
                  ]),
                ),
                if (nextStep.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFFD4A017).withOpacity(0.1), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.3))),
                    child: Row(children: [
                      const Icon(Icons.arrow_forward, color: Color(0xFFD4A017), size: 16),
                      const SizedBox(width: 8),
                      Expanded(child: Text("Next: $nextStep", style: const TextStyle(color: Color(0xFFD4A017), fontSize: 13))),
                    ]),
                  ),
                ],
                const SizedBox(height: 16),
                const Text("Verification Steps", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
                const SizedBox(height: 12),
                ...steps.asMap().entries.map((e) {
                  final step = e.value as Map<String, dynamic>;
                  final done = step["completed"] as bool? ?? e.key < completed;
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                    child: Row(children: [
                      Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, color: done ? const Color(0xFF10B981) : const Color(0xFF6B7280), size: 20),
                      const SizedBox(width: 12),
                      Expanded(child: Text(step["label"] as String? ?? step["name"] as String? ?? "Step ${e.key + 1}", style: TextStyle(color: done ? Colors.white : const Color(0xFF9CA3AF)))),
                    ]),
                  );
                }),
              ]),
            ),
    );
  }
}
