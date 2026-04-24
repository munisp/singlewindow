/// TradeGateway™ NGSWTP — Flutter Post-Clearance Audit Screen
/// Parity with PWA PostClearanceAudit page and RN PostClearanceAuditScreen.
library;
import "package:flutter/material.dart";
import "dart:convert";
import "../../services/api_service.dart";

class PostClearanceAuditScreen extends StatefulWidget {
  const PostClearanceAuditScreen({super.key});
  @override
  State<PostClearanceAuditScreen> createState() => _PostClearanceAuditScreenState();
}

class _PostClearanceAuditScreenState extends State<PostClearanceAuditScreen> {
  bool _loading = true;
  List<dynamic> _audits = [];
  Map<String, dynamic>? _stats;
  String _filter = "all";
  String? _error;

  static const _riskColors = {
    "low": Color(0xFF059669),
    "medium": Color(0xFFD97706),
    "high": Color(0xFFDC2626),
    "critical": Color(0xFF7C3AED),
  };

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final filterParam = _filter == "all" ? "" : "&status=${Uri.encodeComponent(_filter)}";
      final results = await Future.wait([
        ApiService().get("/api/trpc/postClearanceAudit.list?input=${Uri.encodeComponent(jsonEncode({"limit": 50, if (_filter != "all") "status": _filter}))}"),
        ApiService().get("/api/trpc/postClearanceAudit.getStats"),
      ]);
      setState(() {
        _audits = (results[0]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
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
    const filters = ["all", "scheduled", "in_progress", "completed"];

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: const Text("Post-Clearance Audit", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
      ),
      body: Column(children: [
        // Stats
        if (_stats != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(children: [
              _StatCard("Total", _stats!["total"]?.toString() ?? "0", gold),
              const SizedBox(width: 8),
              _StatCard("In Progress", _stats!["inProgress"]?.toString() ?? "0", const Color(0xFFD97706)),
              const SizedBox(width: 8),
              _StatCard("Completed", _stats!["completed"]?.toString() ?? "0", const Color(0xFF059669)),
            ]),
          ),
        // Filter tabs
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(children: filters.map((f) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () { setState(() => _filter = f); _load(); },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                decoration: BoxDecoration(
                  color: _filter == f ? gold : card,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  f.replaceAll("_", " ").replaceFirstMapped(RegExp(r'^\w'), (m) => m.group(0)!.toUpperCase()),
                  style: TextStyle(color: _filter == f ? const Color(0xFF0A1628) : textSecondary, fontSize: 12, fontWeight: _filter == f ? FontWeight.bold : FontWeight.normal),
                ),
              ),
            ),
          )).toList()),
        ),
        // List
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: gold))
              : _error != null
                  ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                  : _audits.isEmpty
                      ? const Center(child: Text("No audits found", style: TextStyle(color: Color(0xFF9CA3AF))))
                      : RefreshIndicator(
                          color: gold,
                          onRefresh: _load,
                          child: ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: _audits.length,
                            itemBuilder: (ctx, i) {
                              final a = _audits[i];
                              final risk = a["riskLevel"]?.toString() ?? "low";
                              final riskColor = _riskColors[risk] ?? const Color(0xFF6B7280);
                              return Container(
                                margin: const EdgeInsets.only(bottom: 10),
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(color: card, borderRadius: BorderRadius.circular(8)),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                    Text(a["auditNumber"]?.toString() ?? "AUD-${a["id"]}", style: const TextStyle(color: textPrimary, fontWeight: FontWeight.bold)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                      decoration: BoxDecoration(color: riskColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                                      child: Text(risk.toUpperCase(), style: TextStyle(color: riskColor, fontSize: 10, fontWeight: FontWeight.bold)),
                                    ),
                                  ]),
                                  const SizedBox(height: 4),
                                  Text(a["traderName"]?.toString() ?? "Unknown Trader", style: const TextStyle(color: gold, fontSize: 13)),
                                  Text("Declaration: ${a["declarationRef"] ?? "—"}", style: const TextStyle(color: textSecondary, fontSize: 12)),
                                  const SizedBox(height: 6),
                                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                    Text(a["scheduledDate"] != null ? DateTime.parse(a["scheduledDate"]).toLocal().toString().substring(0, 10) : "—",
                                      style: const TextStyle(color: textSecondary, fontSize: 12)),
                                    Text((a["status"]?.toString() ?? "").replaceAll("_", " ").toUpperCase(),
                                      style: TextStyle(color: a["status"] == "completed" ? const Color(0xFF059669) : const Color(0xFFD97706), fontSize: 11, fontWeight: FontWeight.bold)),
                                  ]),
                                ]),
                              );
                            },
                          ),
                        ),
        ),
      ]),
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
