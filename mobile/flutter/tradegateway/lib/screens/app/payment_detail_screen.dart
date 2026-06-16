/// TradeGateway™ NGSWTP — Flutter Payment Detail Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class PaymentDetailScreen extends StatefulWidget {
  final String paymentId;
  const PaymentDetailScreen({super.key, required this.paymentId});

  @override
  State<PaymentDetailScreen> createState() => _PaymentDetailScreenState();
}

class _PaymentDetailScreenState extends State<PaymentDetailScreen> {
  bool _loading = true;
  Map<String, dynamic>? _payment;
  String? _error;

  static const _statusColors = {
    "pending": Color(0xFFD4A017),
    "processing": Color(0xFF3B82F6),
    "completed": Color(0xFF10B981),
    "failed": Color(0xFFEF4444),
    "refunded": Color(0xFF8B5CF6),
  };

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await ApiService().getPaymentById(widget.paymentId);
      setState(() { _payment = data; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0A1628),
        foregroundColor: Colors.white,
        title: Text(
          "Payment #${widget.paymentId}",
          style: const TextStyle(
            fontFamily: "Playfair Display",
            fontSize: 18,
            color: Colors.white,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: Color(0xFFD4A017)),
            onPressed: _load,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
          : _error != null
              ? _ErrorView(error: _error!, onRetry: _load)
              : _payment == null
                  ? const Center(child: Text("Payment not found", style: TextStyle(color: Colors.white70)))
                  : _PaymentDetailView(payment: _payment!, statusColors: _statusColors),
    );
  }
}

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
          const SizedBox(height: 12),
          Text(error, style: const TextStyle(color: Colors.white70), textAlign: TextAlign.center),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: onRetry,
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)),
            child: const Text("Retry"),
          ),
        ],
      ),
    );
  }
}

class _PaymentDetailView extends StatelessWidget {
  final Map<String, dynamic> payment;
  final Map<String, Color> statusColors;
  const _PaymentDetailView({required this.payment, required this.statusColors});

  String _formatAmount(dynamic amount) {
    if (amount == null) return "₦0.00";
    final num = double.tryParse(amount.toString()) ?? 0.0;
    return "₦${(num / 100).toStringAsFixed(2).replaceAllMapped(RegExp(r"(\d)(?=(\d{3})+(?!\d))"), (m) => "${m[1]},")}";
  }

  String _formatDate(dynamic ts) {
    if (ts == null) return "—";
    try {
      return DateTime.fromMillisecondsSinceEpoch(
        ts is int ? ts : int.parse(ts.toString()),
      ).toLocal().toString().substring(0, 16);
    } catch (_) {
      return ts.toString();
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = (payment["status"] as String? ?? "pending").toLowerCase();
    final statusColor = statusColors[status] ?? const Color(0xFF6B7280);
    final timeline = List<Map<String, dynamic>>.from(payment["timeline"] ?? []);
    final ledgerEntries = List<Map<String, dynamic>>.from(payment["ledgerEntries"] ?? []);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Status Card ──────────────────────────────────────────────────
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFF0E2240),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: statusColor.withOpacity(0.4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      _formatAmount(payment["amount"]),
                      style: const TextStyle(
                        color: Color(0xFFD4A017),
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        fontFamily: "Playfair Display",
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: statusColor.withOpacity(0.15),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: statusColor),
                      ),
                      child: Text(
                        status.toUpperCase(),
                        style: TextStyle(color: statusColor, fontSize: 12, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                _InfoRow(label: "Reference", value: payment["reference"]?.toString() ?? "—"),
                _InfoRow(label: "Declaration", value: payment["declarationRef"]?.toString() ?? "—"),
                _InfoRow(label: "Payment Method", value: payment["paymentMethod"]?.toString() ?? "—"),
                _InfoRow(label: "Initiated", value: _formatDate(payment["createdAt"])),
                _InfoRow(label: "Completed", value: _formatDate(payment["completedAt"])),
                if (payment["mojaloopTransferId"] != null)
                  _InfoRow(label: "Mojaloop Transfer ID", value: payment["mojaloopTransferId"].toString()),
              ],
            ),
          ),
          const SizedBox(height: 20),

          // ── Timeline ─────────────────────────────────────────────────────
          if (timeline.isNotEmpty) ...[
            const Text(
              "Payment Timeline",
              style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            ...timeline.asMap().entries.map((entry) {
              final i = entry.key;
              final event = entry.value;
              final isLast = i == timeline.length - 1;
              return Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Column(
                    children: [
                      Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: isLast ? const Color(0xFF10B981) : const Color(0xFFD4A017),
                        ),
                      ),
                      if (!isLast)
                        Container(width: 2, height: 40, color: const Color(0xFF1E3A5F)),
                    ],
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            event["event"]?.toString() ?? "",
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
                          ),
                          Text(
                            _formatDate(event["timestamp"]),
                            style: const TextStyle(color: Colors.white54, fontSize: 12),
                          ),
                          if (event["note"] != null)
                            Text(
                              event["note"].toString(),
                              style: const TextStyle(color: Colors.white70, fontSize: 12),
                            ),
                        ],
                      ),
                    ),
                  ),
                ],
              );
            }),
            const SizedBox(height: 8),
          ],

          // ── TigerBeetle Ledger Entries ────────────────────────────────────
          if (ledgerEntries.isNotEmpty) ...[
            const Text(
              "Ledger Entries (TigerBeetle)",
              style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 12),
            Container(
              decoration: BoxDecoration(
                color: const Color(0xFF0E2240),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                children: ledgerEntries.map((entry) {
                  final isDebit = entry["type"] == "debit";
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              entry["description"]?.toString() ?? "Transfer",
                              style: const TextStyle(color: Colors.white, fontSize: 13),
                            ),
                            Text(
                              "Account: ${entry["accountId"]?.toString() ?? "—"}",
                              style: const TextStyle(color: Colors.white54, fontSize: 11),
                            ),
                          ],
                        ),
                        Text(
                          "${isDebit ? "-" : "+"}${_formatAmount(entry["amount"])}",
                          style: TextStyle(
                            color: isDebit ? const Color(0xFFEF4444) : const Color(0xFF10B981),
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              ),
            ),
            const SizedBox(height: 20),
          ],

          // ── Retry Button (for failed payments) ───────────────────────────
          if (status == "failed")
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text("Retry payment — navigate to payments screen to re-initiate")),
                  );
                },
                icon: const Icon(Icons.refresh),
                label: const Text("Retry Payment"),
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFFD4A017),
                  foregroundColor: Colors.black,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 140,
            child: Text(label, style: const TextStyle(color: Colors.white54, fontSize: 13)),
          ),
          Expanded(
            child: Text(value, style: const TextStyle(color: Colors.white, fontSize: 13)),
          ),
        ],
      ),
    );
  }
}
