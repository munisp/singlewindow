/// TradeGateway™ NGSWTP — Flutter Document Vault Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class DocumentVaultScreen extends StatefulWidget {
  const DocumentVaultScreen({super.key});
  @override
  State<DocumentVaultScreen> createState() => _DocumentVaultScreenState();
}

class _DocumentVaultScreenState extends State<DocumentVaultScreen> {
  bool _loading = true;
  List<dynamic> _items = [];
  int _total = 0;
  String? _error;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().listDocuments();
      setState(() { _items = (result["items"] as List?) ?? []; _total = result["total"] as int? ?? 0; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  IconData _docIcon(String? type) {
    switch (type?.toLowerCase()) {
      case "invoice": return Icons.receipt;
      case "bill_of_lading": case "bl": return Icons.directions_boat;
      case "certificate": return Icons.verified;
      case "permit": return Icons.approval;
      case "packing_list": return Icons.list_alt;
      default: return Icons.insert_drive_file;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: Text("Document Vault ($_total)", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
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
              child: _items.isEmpty
                ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.folder_open, color: Color(0xFF6B7280), size: 64),
                    SizedBox(height: 16),
                    Text("No documents uploaded yet", style: TextStyle(color: Color(0xFF9CA3AF))),
                  ]))
                : ListView.builder(
                    padding: const EdgeInsets.all(12),
                    itemCount: _items.length,
                    itemBuilder: (ctx, i) {
                      final doc = _items[i] as Map<String, dynamic>;
                      final status = doc["status"] as String? ?? "pending";
                      final statusColor = status == "verified" ? const Color(0xFF10B981) : status == "rejected" ? const Color(0xFFEF4444) : const Color(0xFFD4A017);
                      return Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                        child: Row(children: [
                          Container(
                            width: 40, height: 40,
                            decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
                            child: Icon(_docIcon(doc["type"] as String?), color: const Color(0xFFD4A017), size: 20),
                          ),
                          const SizedBox(width: 12),
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(doc["name"] as String? ?? "—", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis),
                            Text(doc["type"] as String? ?? "Document", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                            Text(doc["uploadedAt"] as String? ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                          ])),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
                            decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(4)),
                            child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                      );
                    },
                  ),
            ),
    );
  }
}
