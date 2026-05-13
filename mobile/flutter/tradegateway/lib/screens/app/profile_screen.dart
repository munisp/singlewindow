/// TradeGateway™ NGSWTP — Flutter Profile Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;
  bool _editing = false;
  final _nameCtrl = TextEditingController();
  final _phoneCtrl = TextEditingController();
  bool _saving = false;

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _nameCtrl.dispose(); _phoneCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getMyProfile();
      setState(() {
        _data = result;
        _nameCtrl.text = result["name"] as String? ?? "";
        _phoneCtrl.text = result["phone"] as String? ?? "";
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _save() async {
    try {
      setState(() { _saving = true; });
      await ApiService().updateProfile({"name": _nameCtrl.text, "phone": _phoneCtrl.text});
      setState(() { _saving = false; _editing = false; });
      _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Profile updated"), backgroundColor: Color(0xFF10B981)));
    } catch (e) {
      setState(() { _saving = false; });
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString()), backgroundColor: const Color(0xFFEF4444)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final initials = (_data?["name"] as String? ?? "?").split(" ").map((w) => w.isNotEmpty ? w[0] : "").take(2).join().toUpperCase();

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("My Profile", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [
          if (!_editing)
            IconButton(icon: const Icon(Icons.edit), onPressed: () => setState(() => _editing = true))
          else ...[
            IconButton(icon: const Icon(Icons.close), onPressed: () => setState(() => _editing = false)),
            IconButton(icon: const Icon(Icons.save), onPressed: _saving ? null : _save),
          ],
        ],
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
          : SingleChildScrollView(padding: const EdgeInsets.all(16), child: Column(children: [
              CircleAvatar(radius: 40, backgroundColor: const Color(0xFFD4A017), child: Text(initials, style: const TextStyle(color: Colors.black, fontSize: 24, fontWeight: FontWeight.w700))),
              const SizedBox(height: 8),
              Text(_data?["name"] as String? ?? "—", style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w700)),
              Text(_data?["traderId"] as String? ?? "", style: const TextStyle(color: Color(0xFFD4A017), fontSize: 13)),
              const SizedBox(height: 24),
              if (_editing) ...[
                _field("Full Name", _nameCtrl),
                const SizedBox(height: 12),
                _field("Phone", _phoneCtrl),
                const SizedBox(height: 16),
                SizedBox(width: double.infinity, child: ElevatedButton(
                  onPressed: _saving ? null : _save,
                  style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black, padding: const EdgeInsets.symmetric(vertical: 14)),
                  child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black)) : const Text("Save Changes"),
                )),
              ] else ...[
                _infoRow(Icons.email, "Email", _data?["email"] as String? ?? "—"),
                _infoRow(Icons.business, "Company", _data?["company"] as String? ?? "—"),
                _infoRow(Icons.phone, "Phone", _data?["phone"] as String? ?? "—"),
                _infoRow(Icons.badge, "Trader ID", _data?["traderId"] as String? ?? "—"),
              ],
            ])),
    );
  }

  Widget _field(String label, TextEditingController ctrl) {
    return TextField(
      controller: ctrl,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label, labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
        filled: true, fillColor: const Color(0xFF111827),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
      ),
    );
  }

  Widget _infoRow(IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFFD4A017), size: 20),
        const SizedBox(width: 12),
        Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
          Text(value, style: const TextStyle(color: Colors.white, fontSize: 14)),
        ]),
      ]),
    );
  }
}
