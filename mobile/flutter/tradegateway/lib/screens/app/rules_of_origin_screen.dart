/// TradeGateway™ NGSWTP — Flutter Rules of Origin Screen
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class RulesOfOriginScreen extends StatefulWidget {
  const RulesOfOriginScreen({super.key});
  @override
  State<RulesOfOriginScreen> createState() => _RulesOfOriginScreenState();
}

class _RulesOfOriginScreenState extends State<RulesOfOriginScreen> {
  bool _loading = false;
  List<dynamic> _results = [];
  String? _error;
  final _hsCodeCtrl = TextEditingController();
  final _countryCtrl = TextEditingController();
  String _selectedAgreement = "ECOWAS";
  bool _searching = false;

  final List<String> _agreements = ["ECOWAS", "AfCFTA", "AGOA", "EU-EPA", "COMESA", "SADC", "EAC"];

  Future<void> _search() async {
    if (_hsCodeCtrl.text.isEmpty) return;
    setState(() { _searching = true; _error = null; _results = []; });
    try {
      final encoded = Uri.encodeComponent('{"json":{"hsCode":"${_hsCodeCtrl.text}","countryOfOrigin":"${_countryCtrl.text}","agreement":"$_selectedAgreement"}}');
      final data = await ApiService().get("/api/trpc/rulesOfOrigin.check?input=$encoded");
      setState(() {
        _results = data["result"]?["data"]?["json"] ?? [];
        _searching = false;
      });
    } catch (e) {
      setState(() { _searching = false; _error = e.toString(); });
    }
  }

  @override
  void dispose() {
    _hsCodeCtrl.dispose();
    _countryCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Rules of Origin", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
      ),
      body: Column(
        children: [
          // Search panel
          Container(
            padding: const EdgeInsets.all(16),
            color: const Color(0xFF1E3A5F),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text("Check Origin Eligibility", style: TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _hsCodeCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: _inputDecoration("HS Code (e.g. 8517.12)"),
                        onSubmitted: (_) => _search(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _countryCtrl,
                        style: const TextStyle(color: Colors.white),
                        decoration: _inputDecoration("Country of Origin"),
                        onSubmitted: (_) => _search(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: DropdownButtonFormField<String>(
                        value: _selectedAgreement,
                        dropdownColor: const Color(0xFF0A1628),
                        style: const TextStyle(color: Colors.white),
                        decoration: _inputDecoration("Trade Agreement"),
                        items: _agreements.map((a) => DropdownMenuItem(value: a, child: Text(a))).toList(),
                        onChanged: (v) => setState(() => _selectedAgreement = v!),
                      ),
                    ),
                    const SizedBox(width: 8),
                    ElevatedButton(
                      onPressed: _searching ? null : _search,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFFD4A017),
                        minimumSize: const Size(80, 48),
                      ),
                      child: _searching
                          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                          : const Icon(Icons.search, color: Colors.black),
                    ),
                  ],
                ),
              ],
            ),
          ),
          // Results
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
                : _error != null
                    ? Center(child: Text(_error!, style: const TextStyle(color: Color(0xFFEF4444))))
                    : _results.isEmpty
                        ? Center(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                const Icon(Icons.public, color: Color(0xFF374151), size: 64),
                                const SizedBox(height: 16),
                                const Text("Enter an HS code to check origin eligibility", style: TextStyle(color: Color(0xFF6B7280))),
                                const SizedBox(height: 8),
                                const Text("Supports ECOWAS, AfCFTA, AGOA, EU-EPA, COMESA, SADC, EAC", style: TextStyle(color: Color(0xFF4B5563), fontSize: 12), textAlign: TextAlign.center),
                              ],
                            ),
                          )
                        : ListView.builder(
                            padding: const EdgeInsets.all(16),
                            itemCount: _results.length,
                            itemBuilder: (context, i) => _OriginResultCard(result: _results[i]),
                          ),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String label) {
    return InputDecoration(
      hintText: label,
      hintStyle: const TextStyle(color: Color(0xFF6B7280), fontSize: 13),
      filled: true,
      fillColor: const Color(0xFF0A1628),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
    );
  }
}

class _OriginResultCard extends StatelessWidget {
  final dynamic result;
  const _OriginResultCard({required this.result});

  @override
  Widget build(BuildContext context) {
    final eligible = result["eligible"] == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A5F),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: eligible ? const Color(0xFF10B981).withOpacity(0.4) : const Color(0xFFEF4444).withOpacity(0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(result["agreement"] ?? "Agreement", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: (eligible ? const Color(0xFF10B981) : const Color(0xFFEF4444)).withOpacity(0.2),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  eligible ? "ELIGIBLE" : "NOT ELIGIBLE",
                  style: TextStyle(color: eligible ? const Color(0xFF10B981) : const Color(0xFFEF4444), fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          if (result["rule"] != null) ...[
            const SizedBox(height: 6),
            Text("Rule: ${result["rule"]}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
          ],
          if (result["criteria"] != null) ...[
            const SizedBox(height: 4),
            Text("Criteria: ${result["criteria"]}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
          ],
          if (result["preferentialRate"] != null) ...[
            const SizedBox(height: 4),
            Text("Preferential Rate: ${result["preferentialRate"]}%", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.w600, fontSize: 13)),
          ],
        ],
      ),
    );
  }
}
