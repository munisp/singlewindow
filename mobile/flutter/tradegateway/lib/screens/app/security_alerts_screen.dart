/// TradeGateway™ NGSWTP — Flutter Security Alerts Screen
/// Parity with PWA SecurityAlerts page and RN SecurityAlertsScreen.
library;
import "package:flutter/material.dart";
import "dart:convert";
import "../../services/api_service.dart";

class SecurityAlertsScreen extends StatefulWidget {
  const SecurityAlertsScreen({super.key});
  @override
  State<SecurityAlertsScreen> createState() => _SecurityAlertsScreenState();
}

class _SecurityAlertsScreenState extends State<SecurityAlertsScreen> {
  bool _loading = true;
  List<dynamic> _alerts = [];
  Map<String, dynamic>? _stats;
  String _severity = "all";
  String? _error;

  static const _severityColors = {
    "critical": Color(0xFFDC2626),
    "high": Color(0xFFEA580C),
    "medium": Color(0xFFD97706),
    "low": Color(0xFF059669),
    "info": Color(0xFF2563EB),
  };

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final input = _severity == "all" ? {"limit": 50} : {"limit": 50, "severity": _severity};
      final results = await Future.wait([
        ApiService().get("/api/trpc/wazuh.getAlerts?input=${Uri.encodeComponent(jsonEncode(input))}"),
        ApiService().get("/api/trpc/wazuh.getStats"),
      ]);
      setState(() {
        _alerts = (results[0]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
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
    const severities = ["all", "critical", "high", "medium", "low"];

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: const Text("Security Alerts", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
      ),
      body: Column(children: [
        // Stats
        if (_stats != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(children: [
              _StatCard("Critical", _stats!["critical"]?.toString() ?? "0", const Color(0xFFDC2626)),
              const SizedBox(width: 6),
              _StatCard("High", _stats!["high"]?.toString() ?? "0", const Color(0xFFEA580C)),
              const SizedBox(width: 6),
              _StatCard("Medium", _stats!["medium"]?.toString() ?? "0", const Color(0xFFD97706)),
              const SizedBox(width: 6),
              _StatCard("Low", _stats!["low"]?.toString() ?? "0", const Color(0xFF059669)),
            ]),
          ),
        // Severity filter
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(children: severities.map((s) => Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () { setState(() => _severity = s); _load(); },
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                decoration: BoxDecoration(
                  color: _severity == s ? gold : card,
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Text(
                  s[0].toUpperCase() + s.substring(1),
                  style: TextStyle(color: _severity == s ? const Color(0xFF0A1628) : textSecondary, fontSize: 12, fontWeight: _severity == s ? FontWeight.bold : FontWeight.normal),
                ),
              ),
            ),
          )).toList()),
        ),
        // Alerts list
        Expanded(
          child: _loading
              ? const Center(child: CircularProgressIndicator(color: gold))
              : _error != null
                  ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
                  : _alerts.isEmpty
                      ? const Center(child: Text("No security alerts", style: TextStyle(color: Color(0xFF9CA3AF))))
                      : RefreshIndicator(
                          color: gold,
                          onRefresh: _load,
                          child: ListView.builder(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            itemCount: _alerts.length,
                            itemBuilder: (ctx, i) {
                              final a = _alerts[i];
                              final sev = a["severity"]?.toString() ?? "info";
                              final sevColor = _severityColors[sev] ?? const Color(0xFF6B7280);
                              return Container(
                                margin: const EdgeInsets.only(bottom: 8),
                                decoration: BoxDecoration(
                                  color: card,
                                  borderRadius: BorderRadius.circular(8),
                                  border: Border(left: BorderSide(color: sevColor, width: 3)),
                                ),
                                padding: const EdgeInsets.all(12),
                                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                    Expanded(child: Text(a["ruleName"]?.toString() ?? "Unknown Rule", style: const TextStyle(color: textPrimary, fontWeight: FontWeight.bold, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis)),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                      decoration: BoxDecoration(color: sevColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                                      child: Text(sev.toUpperCase(), style: TextStyle(color: sevColor, fontSize: 10, fontWeight: FontWeight.bold)),
                                    ),
                                  ]),
                                  const SizedBox(height: 4),
                                  Text(a["description"]?.toString() ?? a["message"]?.toString() ?? "—", style: const TextStyle(color: textSecondary, fontSize: 12), maxLines: 2),
                                  const SizedBox(height: 6),
                                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                                    Text(a["agentName"]?.toString() ?? "—", style: const TextStyle(color: gold, fontSize: 11)),
                                    Text(a["timestamp"] != null ? DateTime.parse(a["timestamp"]).toLocal().toString().substring(11, 19) : "—", style: const TextStyle(color: textSecondary, fontSize: 11)),
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
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 9)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(color: valueColor, fontSize: 14, fontWeight: FontWeight.bold)),
        ]),
      ),
    );
  }
}
