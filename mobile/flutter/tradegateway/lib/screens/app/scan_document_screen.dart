/// TradeGateway™ NGSWTP — Flutter Scan Document Screen (v43 — uploadDocument flow wired)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class ScanDocumentScreen extends StatefulWidget {
  const ScanDocumentScreen({super.key});
  @override
  State<ScanDocumentScreen> createState() => _ScanDocumentScreenState();
}

class _ScanDocumentScreenState extends State<ScanDocumentScreen> {
  bool _loading = true;
  Map<String, dynamic>? _stats;
  String? _error;
  bool _uploading = false;
  Map<String, dynamic>? _uploadResult;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().getDeclarationStats();
      setState(() { _stats = result; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  /// Simulate picking a file and uploading it via uploadDocument().
  /// In production, integrate image_picker or file_picker package.
  Future<void> _simulateUpload(String docType) async {
    setState(() { _uploading = true; _uploadResult = null; });
    try {
      // Simulate upload with a placeholder path (in production use image_picker)
      final result = await ApiService().uploadDocument(
        filePath: "/tmp/placeholder_${docType.toLowerCase()}.pdf",
        fileName: "placeholder_${docType.toLowerCase()}.pdf",
        mimeType: "application/pdf",
        documentType: docType,
        declarationId: null,
      );
      setState(() { _uploadResult = result; _uploading = false; });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("${docType} uploaded successfully"), backgroundColor: const Color(0xFF10B981)),
        );
      }
    } catch (e) {
      setState(() { _uploading = false; });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Upload failed: ${e.toString()}"), backgroundColor: const Color(0xFFEF4444)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Scan Document", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
      ),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        // Camera viewfinder placeholder
        Container(
          height: 240,
          decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(12), border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.3), width: 2)),
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.camera_alt, color: Color(0xFFD4A017), size: 64),
            const SizedBox(height: 16),
            const Text("Point camera at trade document", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            const Text("Supported: Invoice, B/L, Packing List, Certificate", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            ElevatedButton.icon(
              onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Camera access requires device permissions"), backgroundColor: Color(0xFF1E3A5F))),
              icon: const Icon(Icons.camera),
              label: const Text("Open Camera"),
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017), foregroundColor: Colors.black),
            ),
          ]),
        ),
        const SizedBox(height: 24),
        // Document type quick upload buttons
        const Text("Quick Upload", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (_uploading)
          const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator(color: Color(0xFFD4A017))))
        else
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final docType in ["invoice", "bill_of_lading", "packing_list", "certificate_of_origin", "import_permit"])
              OutlinedButton.icon(
                onPressed: () => _simulateUpload(docType),
                icon: const Icon(Icons.upload_file, size: 16),
                label: Text(docType.replaceAll("_", " ").toUpperCase(), style: const TextStyle(fontSize: 11)),
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFD4A017),
                  side: const BorderSide(color: Color(0xFFD4A017), width: 0.5),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                ),
              ),
          ]),
        if (_uploadResult != null) ...[
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: const Color(0xFF10B981).withOpacity(0.1), borderRadius: BorderRadius.circular(8), border: Border.all(color: const Color(0xFF10B981).withOpacity(0.3))),
            child: Row(children: [
              const Icon(Icons.check_circle, color: Color(0xFF10B981), size: 18),
              const SizedBox(width: 8),
              Expanded(child: Text("Uploaded: ${_uploadResult!["fileName"] ?? _uploadResult!["url"] ?? "Document"}", style: const TextStyle(color: Color(0xFF10B981), fontSize: 12))),
            ]),
          ),
        ],
        const SizedBox(height: 24),
        const Text("Recent Activity", style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (_loading)
          const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
        else if (_stats != null) ...[
          _activityRow(Icons.description, "Total Declarations", _stats!["totalDeclarations"]?.toString() ?? "—"),
          _activityRow(Icons.hourglass_empty, "Pending Review", _stats!["pending"]?.toString() ?? "—"),
          _activityRow(Icons.check_circle, "Approved", _stats!["approved"]?.toString() ?? "—"),
        ],
      ]),
    );
  }

  Widget _activityRow(IconData icon, String label, String value) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        Icon(icon, color: const Color(0xFFD4A017), size: 20),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: const TextStyle(color: Color(0xFF9CA3AF)))),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ]),
    );
  }
}
