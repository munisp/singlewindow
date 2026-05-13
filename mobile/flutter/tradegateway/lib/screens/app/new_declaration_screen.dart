/// TradeGateway™ NGSWTP — Flutter New Declaration Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class NewDeclarationScreen extends StatefulWidget {
  const NewDeclarationScreen({super.key});
  @override
  State<NewDeclarationScreen> createState() => _NewDeclarationScreenState();
}

class _NewDeclarationScreenState extends State<NewDeclarationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _hsCodeCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _qtyCtrl = TextEditingController();
  final _valueCtrl = TextEditingController();
  final _originCtrl = TextEditingController();
  final _destCtrl = TextEditingController();
  String _currency = "USD";
  bool _saving = false;

  @override
  void dispose() {
    _hsCodeCtrl.dispose(); _descCtrl.dispose(); _qtyCtrl.dispose();
    _valueCtrl.dispose(); _originCtrl.dispose(); _destCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      setState(() => _saving = true);
      await ApiService().createDeclaration({
        "hsCode": _hsCodeCtrl.text.trim(),
        "description": _descCtrl.text.trim(),
        "quantity": double.tryParse(_qtyCtrl.text) ?? 1,
        "value": double.tryParse(_valueCtrl.text) ?? 0,
        "currency": _currency,
        "origin": _originCtrl.text.trim(),
        "destination": _destCtrl.text.trim(),
      });
      setState(() => _saving = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Declaration created successfully"), backgroundColor: Color(0xFF10B981)));
        Navigator.pop(context, true);
      }
    } catch (e) {
      setState(() => _saving = false);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: const Color(0xFFEF4444)));
    }
  }

  InputDecoration _dec(String label, {String? hint}) => InputDecoration(
    labelText: label, hintText: hint,
    labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
    hintStyle: const TextStyle(color: Color(0xFF4B5563)),
    filled: true, fillColor: const Color(0xFF111827),
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
    enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFF1E3A5F))),
    focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
  );

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("New Declaration", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
      ),
      body: Form(
        key: _formKey,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          TextFormField(controller: _hsCodeCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("HS Code", hint: "e.g. 8471.30"),
            validator: (v) => v == null || v.isEmpty ? "HS Code is required" : null),
          const SizedBox(height: 12),
          TextFormField(controller: _descCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("Description"), maxLines: 2,
            validator: (v) => v == null || v.isEmpty ? "Description is required" : null),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: TextFormField(controller: _qtyCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("Quantity"), keyboardType: TextInputType.number,
              validator: (v) => v == null || v.isEmpty ? "Required" : null)),
            const SizedBox(width: 12),
            Expanded(child: TextFormField(controller: _valueCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("Value"), keyboardType: TextInputType.number,
              validator: (v) => v == null || v.isEmpty ? "Required" : null)),
          ]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            value: _currency,
            dropdownColor: const Color(0xFF111827),
            style: const TextStyle(color: Colors.white),
            decoration: _dec("Currency"),
            items: ["USD", "EUR", "GBP", "KES", "GHS", "NGN"].map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
            onChanged: (v) => setState(() => _currency = v ?? "USD"),
          ),
          const SizedBox(height: 12),
          TextFormField(controller: _originCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("Country of Origin", hint: "e.g. CN"),
            validator: (v) => v == null || v.isEmpty ? "Required" : null),
          const SizedBox(height: 12),
          TextFormField(controller: _destCtrl, style: const TextStyle(color: Colors.white), decoration: _dec("Destination Port", hint: "e.g. KEMBA"),
            validator: (v) => v == null || v.isEmpty ? "Required" : null),
          const SizedBox(height: 24),
          SizedBox(width: double.infinity, child: ElevatedButton(
            onPressed: _saving ? null : _submit,
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 16)),
            child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Create Declaration", style: TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
          )),
        ]),
      ),
    );
  }
}
