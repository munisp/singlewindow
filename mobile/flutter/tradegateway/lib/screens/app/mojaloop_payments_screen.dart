/// TradeGateway™ NGSWTP — Flutter Mojaloop Payments Screen
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class MojaloopPaymentsScreen extends StatefulWidget {
  const MojaloopPaymentsScreen({super.key});
  @override
  State<MojaloopPaymentsScreen> createState() => _MojaloopPaymentsScreenState();
}

class _MojaloopPaymentsScreenState extends State<MojaloopPaymentsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  List<dynamic> _payments = [];
  Map<String, dynamic>? _stats;
  String? _error;

  // New payment form
  final _formKey = GlobalKey<FormState>();
  final _amountCtrl = TextEditingController();
  final _referenceCtrl = TextEditingController();
  final _payerFspCtrl = TextEditingController();
  final _payeeFspCtrl = TextEditingController();
  String _currency = "NGN";
  bool _submitting = false;

  final List<String> _currencies = ["NGN", "USD", "EUR", "GBP", "GHS", "KES", "ZAR"];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final data = await ApiService().get("/api/trpc/payments.listAll?input=%7B%22json%22%3Anull%7D");
      final statsData = await ApiService().get("/api/trpc/payments.ledgerStats?input=%7B%22json%22%3Anull%7D");
      setState(() {
        _payments = data["result"]?["data"]?["json"] ?? [];
        _stats = statsData["result"]?["data"]?["json"];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _initiatePayment() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      await ApiService().post("/api/trpc/payments.initiate", {
        "json": {
          "amount": double.parse(_amountCtrl.text),
          "currency": _currency,
          "reference": _referenceCtrl.text,
          "payerFsp": _payerFspCtrl.text,
          "payeeFsp": _payeeFspCtrl.text,
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Payment initiated successfully!"), backgroundColor: Color(0xFF10B981)),
        );
        _amountCtrl.clear();
        _referenceCtrl.clear();
        _tabController.animateTo(0);
        _load();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: ${e.toString()}"), backgroundColor: const Color(0xFFEF4444)),
        );
      }
    } finally {
      setState(() => _submitting = false);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    _amountCtrl.dispose();
    _referenceCtrl.dispose();
    _payerFspCtrl.dispose();
    _payeeFspCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Mojaloop Payments", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFFD4A017),
          unselectedLabelColor: const Color(0xFF9CA3AF),
          indicatorColor: const Color(0xFFD4A017),
          tabs: const [Tab(text: "Transactions"), Tab(text: "New Payment")],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
                  const SizedBox(height: 16),
                  Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF))),
                  const SizedBox(height: 16),
                  ElevatedButton(onPressed: _load, child: const Text("Retry")),
                ]))
              : TabBarView(
                  controller: _tabController,
                  children: [_buildTransactions(), _buildNewPayment()],
                ),
    );
  }

  Widget _buildTransactions() {
    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFFD4A017),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Stats row
            if (_stats != null) ...[
              Row(
                children: [
                  _StatCard(label: "Total Volume", value: "${_stats!["totalVolume"] ?? 0}", icon: Icons.account_balance_wallet),
                  const SizedBox(width: 12),
                  _StatCard(label: "Pending", value: "${_stats!["pendingCount"] ?? 0}", icon: Icons.pending_actions),
                ],
              ),
              const SizedBox(height: 16),
            ],
            // Payments list
            if (_payments.isEmpty)
              const Center(child: Padding(
                padding: EdgeInsets.all(32),
                child: Text("No payment transactions found", style: TextStyle(color: Color(0xFF9CA3AF))),
              ))
            else
              ..._payments.map((p) => _PaymentCard(payment: p)),
          ],
        ),
      ),
    );
  }

  Widget _buildNewPayment() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("Initiate Mojaloop Transfer", style: TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 16),
            // Amount + Currency
            Row(
              children: [
                Expanded(
                  flex: 2,
                  child: TextFormField(
                    controller: _amountCtrl,
                    keyboardType: TextInputType.number,
                    style: const TextStyle(color: Colors.white),
                    decoration: _inputDecoration("Amount"),
                    validator: (v) => (v == null || v.isEmpty) ? "Required" : null,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    value: _currency,
                    dropdownColor: const Color(0xFF1E3A5F),
                    style: const TextStyle(color: Colors.white),
                    decoration: _inputDecoration("Currency"),
                    items: _currencies.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                    onChanged: (v) => setState(() => _currency = v!),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _referenceCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration("Declaration Reference"),
              validator: (v) => (v == null || v.isEmpty) ? "Required" : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _payerFspCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration("Payer FSP ID"),
              validator: (v) => (v == null || v.isEmpty) ? "Required" : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _payeeFspCtrl,
              style: const TextStyle(color: Colors.white),
              decoration: _inputDecoration("Payee FSP ID (Customs Authority)"),
              validator: (v) => (v == null || v.isEmpty) ? "Required" : null,
            ),
            const SizedBox(height: 24),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: const Color(0xFF1E3A5F),
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.3)),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline, color: Color(0xFFD4A017), size: 16),
                  SizedBox(width: 8),
                  Expanded(child: Text("Payments are processed via Mojaloop open-source payment switch with ISO 20022 compliance.", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12))),
                ],
              ),
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton(
                onPressed: _submitting ? null : _initiatePayment,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)),
                child: _submitting
                    ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                    : const Text("Initiate Transfer", style: TextStyle(color: Colors.black, fontWeight: FontWeight.bold)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _inputDecoration(String label) {
    return InputDecoration(
      labelText: label,
      labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
      filled: true,
      fillColor: const Color(0xFF1E3A5F),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
    );
  }
}

class _PaymentCard extends StatelessWidget {
  final dynamic payment;
  const _PaymentCard({required this.payment});

  @override
  Widget build(BuildContext context) {
    final status = payment["status"] ?? "pending";
    final statusColors = {
      "completed": const Color(0xFF10B981),
      "pending": const Color(0xFFF59E0B),
      "failed": const Color(0xFFEF4444),
      "processing": const Color(0xFF3B82F6),
    };
    final color = statusColors[status] ?? const Color(0xFF6B7280);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A5F),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(
            width: 40, height: 40,
            decoration: BoxDecoration(color: color.withOpacity(0.2), shape: BoxShape.circle),
            child: Icon(Icons.payment, color: color, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(payment["reference"] ?? "REF-${payment["id"] ?? ""}",
                    style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 2),
                Text("${payment["currency"] ?? "NGN"} ${payment["amount"] ?? 0}",
                    style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold)),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(color: color.withOpacity(0.2), borderRadius: BorderRadius.circular(12)),
            child: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  const _StatCard({required this.label, required this.value, required this.icon});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(10)),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFFD4A017), size: 24),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 11)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
