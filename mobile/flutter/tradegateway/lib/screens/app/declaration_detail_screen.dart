/// TradeGateway™ NGSWTP — Flutter Declaration Detail Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";
import "../../models/declarations.dart";

class DeclarationDetailScreen extends StatefulWidget {
  const DeclarationDetailScreen({super.key});
  @override
  State<DeclarationDetailScreen> createState() => _DeclarationDetailScreenState();
}

class _DeclarationDetailScreenState extends State<DeclarationDetailScreen> {
  bool _loading = true;
  Declaration? _data;
  String? _error;
  bool _submitting = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _load();
  }

  Future<void> _load() async {
    final id = ModalRoute.of(context)?.settings.arguments as int?;
    if (id == null) { setState(() { _loading = false; _error = "No declaration ID provided"; }); return; }
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getDeclaration(id);
      setState(() { _data = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _submit() async {
    if (_data == null) return;
    try {
      setState(() => _submitting = true);
      await ApiService().submitDeclaration(_data!.id);
      setState(() => _submitting = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Declaration submitted successfully"), backgroundColor: Color(0xFF10B981)));
        _load();
      }
    } catch (e) {
      setState(() => _submitting = false);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: const Color(0xFFEF4444)));
    }
  }

  Color _statusColor(String? s) {
    switch (s) {
      case "approved": return const Color(0xFF10B981);
      case "rejected": return const Color(0xFFEF4444);
      case "submitted": return const Color(0xFF3B82F6);
      default: return const Color(0xFFD4A017);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: Text(_data?.ucr ?? "Declaration Detail", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
          : ListView(padding: const EdgeInsets.all(16), children: [
              Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                Text(_data!.ucr, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: _statusColor(_data!.status).withOpacity(0.15), borderRadius: BorderRadius.circular(20), border: Border.all(color: _statusColor(_data!.status).withOpacity(0.4))),
                  child: Text(_data!.status.toUpperCase(), style: TextStyle(color: _statusColor(_data!.status), fontWeight: FontWeight.w700, fontSize: 12)),
                ),
              ]),
              const SizedBox(height: 16),
              _field("HS Code", _data!.hsCode),
              _field("Description", _data!.description),
              _field("Quantity", _data!.quantity?.toString() ?? "—"),
              _field("Value", "${_data!.currency ?? "USD"} ${_data!.value ?? "—"}"),
              _field("Country of Origin", _data!.origin ?? "—"),
              _field("Destination", _data!.destination ?? "—"),
              _field("Declarant", _data!.declarantName ?? "—"),
              _field("Created", _data!.createdAt?.toIso8601String() ?? "—"),
              _field("Updated", _data!.updatedAt?.toIso8601String() ?? "—"),
              const SizedBox(height: 24),
              if (_data!.status == "draft")
                SizedBox(width: double.infinity, child: ElevatedButton(
                  onPressed: _submitting ? null : _submit,
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: _submitting ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Submit Declaration", style: TextStyle(fontWeight: FontWeight.w700)),
                )),
            ]),
    );
  }

  Widget _field(String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        SizedBox(width: 120, child: Text(label, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 12))),
        Expanded(child: Text(value, style: const TextStyle(color: Colors.white, fontSize: 13))),
      ]),
    );
  }
}
