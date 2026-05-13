/// TradeGateway™ NGSWTP — Flutter Finance Screen (TigerBeetle Ledger)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class FinanceScreen extends StatefulWidget {
  const FinanceScreen({super.key});
  @override
  State<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends State<FinanceScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _loading = true;
  Map<String, dynamic>? _summary;
  List<dynamic> _transactions = [];
  List<dynamic> _duties = [];
  Map<String, dynamic>? _clusterSummary;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      // Run all 4 API calls in parallel for faster load
      final results = await Future.wait([
        ApiService().get("/api/trpc/finance.summary?input=%7B%22json%22%3Anull%7D"),
        ApiService().get("/api/trpc/finance.transactions?input=%7B%22json%22%3Anull%7D"),
        ApiService().get("/api/trpc/finance.duties?input=%7B%22json%22%3Anull%7D"),
        ApiService().get("/api/trpc/finance.clusterSummary?input=%7B%22json%22%3Anull%7D"),
      ]);
      setState(() {
        _summary = results[0]["result"]?["data"]?["json"];
        _transactions = results[1]["result"]?["data"]?["json"] ?? [];
        _duties = results[2]["result"]?["data"]?["json"] ?? [];
        _clusterSummary = results[3]["result"]?["data"]?["json"];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Finance & Ledger", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _load)],
        bottom: TabBar(
          controller: _tabController,
          labelColor: const Color(0xFFD4A017),
          unselectedLabelColor: const Color(0xFF9CA3AF),
          indicatorColor: const Color(0xFFD4A017),
          tabs: const [Tab(text: "Summary"), Tab(text: "Transactions"), Tab(text: "Duties"), Tab(text: "FinOps")],
          isScrollable: true,
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
          : _error != null
              ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                  const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
                  const SizedBox(height: 16),
                  Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF))),
                  ElevatedButton(onPressed: _load, child: const Text("Retry")),
                ]))
              : TabBarView(
                  controller: _tabController,
                  children: [_buildSummary(), _buildTransactions(), _buildDuties(), _buildFinOps()],
                ),
    );
  }

  Widget _buildSummary() {
    final s = _summary ?? {};
    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFFD4A017),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Balance cards
            _BalanceCard(label: "Total Duties Collected", amount: s["totalDutiesCollected"] ?? 0, currency: "NGN", icon: Icons.account_balance, color: const Color(0xFF10B981)),
            const SizedBox(height: 12),
            _BalanceCard(label: "Pending Payments", amount: s["pendingPayments"] ?? 0, currency: "NGN", icon: Icons.pending_actions, color: const Color(0xFFF59E0B)),
            const SizedBox(height: 12),
            _BalanceCard(label: "Drawback Claims", amount: s["drawbackClaims"] ?? 0, currency: "NGN", icon: Icons.assignment_return, color: const Color(0xFF3B82F6)),
            const SizedBox(height: 12),
            _BalanceCard(label: "Revenue This Month", amount: s["revenueThisMonth"] ?? 0, currency: "NGN", icon: Icons.trending_up, color: const Color(0xFFD4A017)),
            const SizedBox(height: 20),
            // Quick stats
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(10)),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text("TigerBeetle Ledger Status", style: TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  _LedgerRow(label: "Total Accounts", value: "${s["totalAccounts"] ?? 0}"),
                  _LedgerRow(label: "Total Transfers", value: "${s["totalTransfers"] ?? 0}"),
                  _LedgerRow(label: "Cluster ID", value: "${s["clusterId"] ?? "0"}"),
                  _LedgerRow(label: "Ledger Currency", value: "NGN (₦)"),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTransactions() {
    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFFD4A017),
      child: _transactions.isEmpty
          ? const Center(child: Text("No transactions found", style: TextStyle(color: Color(0xFF9CA3AF))))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _transactions.length,
              itemBuilder: (context, i) => _TransactionCard(tx: _transactions[i]),
            ),
    );
  }

  Widget _buildDuties() {
    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFFD4A017),
      child: _duties.isEmpty
          ? const Center(child: Text("No duty records found", style: TextStyle(color: Color(0xFF9CA3AF))))
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: _duties.length,
              itemBuilder: (context, i) => _DutyCard(duty: _duties[i]),
            ),
    );
  }

  // ─── FinOps Tab — live cost_records breakdown from cost router ────────────
  Widget _buildFinOps() {
    final cs = _clusterSummary;
    if (cs == null) {
      return const Center(child: Text("No FinOps data available", style: TextStyle(color: Color(0xFF9CA3AF))));
    }
    final services = (cs["services"] as List<dynamic>?) ?? [];
    final totalMonthly = cs["totalMonthly"] ?? 0;
    final totalYtd = cs["totalYtd"] ?? 0;
    return RefreshIndicator(
      onRefresh: _load,
      color: const Color(0xFFD4A017),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Monthly + YTD totals
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(12)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("30-Day Spend", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        const SizedBox(height: 4),
                        Text("\$${_fmt(totalMonthly)}", style: const TextStyle(color: Color(0xFFD4A017), fontSize: 22, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(12)),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text("YTD Spend", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        const SizedBox(height: 4),
                        Text("\$${_fmt(totalYtd)}", style: const TextStyle(color: Color(0xFF60A5FA), fontSize: 22, fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            const Text("Service Cost Breakdown (30 days)", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
            const SizedBox(height: 12),
            // Service rows
            ...services.map((svc) {
              final total = svc["totalCostUsd"] ?? 0;
              final compute = svc["computeCostUsd"] ?? 0;
              final storage = svc["storageCostUsd"] ?? 0;
              final network = svc["networkCostUsd"] ?? 0;
              final eff = svc["avgEfficiency"] ?? 0;
              final effColor = eff >= 75 ? const Color(0xFF10B981) : eff >= 50 ? const Color(0xFFF59E0B) : const Color(0xFFEF4444);
              return Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(10)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(child: Text(svc["service"] ?? "", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13), overflow: TextOverflow.ellipsis)),
                        Text("\$${_fmt(total)}", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold, fontSize: 14)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        _CostChip(label: "Compute", value: "\$${_fmt(compute)}", color: const Color(0xFF3B82F6)),
                        const SizedBox(width: 6),
                        _CostChip(label: "Storage", value: "\$${_fmt(storage)}", color: const Color(0xFF8B5CF6)),
                        const SizedBox(width: 6),
                        _CostChip(label: "Network", value: "\$${_fmt(network)}", color: const Color(0xFF06B6D4)),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        const Text("Efficiency: ", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                        Text("$eff%", style: TextStyle(color: effColor, fontWeight: FontWeight.bold, fontSize: 12)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: (eff as num).toDouble() / 100,
                              backgroundColor: const Color(0xFF374151),
                              valueColor: AlwaysStoppedAnimation<Color>(effColor),
                              minHeight: 6,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              );
            }).toList(),
          ],
        ),
      ),
    );
  }

  String _fmt(dynamic v) {
    final n = double.tryParse(v.toString()) ?? 0.0;
    if (n >= 1000000) return "${(n / 1000000).toStringAsFixed(1)}M";
    if (n >= 1000) return "${(n / 1000).toStringAsFixed(1)}K";
    return n.toStringAsFixed(0);
  }
}

class _CostChip extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  const _CostChip({required this.label, required this.value, required this.color});
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(6)),
      child: Text("$label: $value", style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w600)),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  final String label;
  final dynamic amount;
  final String currency;
  final IconData icon;
  final Color color;
  const _BalanceCard({required this.label, required this.amount, required this.currency, required this.icon, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A5F),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Container(width: 44, height: 44, decoration: BoxDecoration(color: color.withOpacity(0.2), shape: BoxShape.circle), child: Icon(icon, color: color, size: 22)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                const SizedBox(height: 2),
                Text("$currency ${_formatAmount(amount)}", style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatAmount(dynamic v) {
    if (v == null) return "0.00";
    final n = double.tryParse(v.toString()) ?? 0.0;
    return n.toStringAsFixed(2).replaceAllMapped(RegExp(r"(\d{1,3})(?=(\d{3})+(?!\d))"), (m) => "${m[1]},");
  }
}

class _LedgerRow extends StatelessWidget {
  final String label;
  final String value;
  const _LedgerRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 13)),
          Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
        ],
      ),
    );
  }
}

class _TransactionCard extends StatelessWidget {
  final dynamic tx;
  const _TransactionCard({required this.tx});

  @override
  Widget build(BuildContext context) {
    final type = tx["type"] ?? "transfer";
    final isCredit = type == "credit" || type == "payment";
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          Container(
            width: 36, height: 36,
            decoration: BoxDecoration(
              color: (isCredit ? const Color(0xFF10B981) : const Color(0xFFEF4444)).withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(isCredit ? Icons.arrow_downward : Icons.arrow_upward, color: isCredit ? const Color(0xFF10B981) : const Color(0xFFEF4444), size: 18),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(tx["description"] ?? "Transaction", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 13)),
                Text(tx["reference"] ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
              ],
            ),
          ),
          Text(
            "${isCredit ? "+" : "-"}NGN ${tx["amount"] ?? 0}",
            style: TextStyle(color: isCredit ? const Color(0xFF10B981) : const Color(0xFFEF4444), fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}

class _DutyCard extends StatelessWidget {
  final dynamic duty;
  const _DutyCard({required this.duty});

  @override
  Widget build(BuildContext context) {
    final paid = duty["paid"] == true;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A5F),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: (paid ? const Color(0xFF10B981) : const Color(0xFFF59E0B)).withOpacity(0.3)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(duty["declarationRef"] ?? "Declaration", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                Text("HS: ${duty["hsCode"] ?? ""} | ${duty["description"] ?? ""}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text("NGN ${duty["amount"] ?? 0}", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold)),
              Container(
                margin: const EdgeInsets.only(top: 4),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: (paid ? const Color(0xFF10B981) : const Color(0xFFF59E0B)).withOpacity(0.2),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(paid ? "PAID" : "PENDING", style: TextStyle(color: paid ? const Color(0xFF10B981) : const Color(0xFFF59E0B), fontSize: 10, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
