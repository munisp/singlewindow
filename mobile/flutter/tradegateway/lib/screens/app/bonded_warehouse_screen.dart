/// TradeGateway™ NGSWTP — Flutter Bonded Warehouse Screen
/// Parity with PWA BondedWarehouse page and RN BondedWarehouseScreen.
library;
import "package:flutter/material.dart";
import "dart:convert";
import "../../services/api_service.dart";

class BondedWarehouseScreen extends StatefulWidget {
  const BondedWarehouseScreen({super.key});
  @override
  State<BondedWarehouseScreen> createState() => _BondedWarehouseScreenState();
}

class _BondedWarehouseScreenState extends State<BondedWarehouseScreen> with SingleTickerProviderStateMixin {
  bool _loading = true;
  List<dynamic> _inventory = [];
  List<dynamic> _movements = [];
  List<dynamic> _bonds = [];
  Map<String, dynamic>? _stats;
  late TabController _tabCtrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    _tabCtrl = TabController(length: 3, vsync: this);
    _load();
  }

  @override
  void dispose() { _tabCtrl.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final results = await Future.wait([
        ApiService().get("/api/trpc/bondedWarehouse.getInventory?input=${Uri.encodeComponent(jsonEncode({"limit": 50}))}"),
        ApiService().get("/api/trpc/bondedWarehouse.getMovements?input=${Uri.encodeComponent(jsonEncode({"limit": 30}))}"),
        ApiService().get("/api/trpc/bondedWarehouse.getBonds?input=${Uri.encodeComponent(jsonEncode({"limit": 30}))}"),
        ApiService().get("/api/trpc/bondedWarehouse.getStats"),
      ]);
      setState(() {
        _inventory = (results[0]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
        _movements = (results[1]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
        _bonds = (results[2]?["result"]?["data"]?["items"] as List<dynamic>?) ?? [];
        _stats = results[3]?["result"]?["data"] as Map<String, dynamic>?;
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

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: const Text("Bonded Warehouse", style: TextStyle(color: textPrimary)),
        backgroundColor: bg,
        iconTheme: const IconThemeData(color: textPrimary),
        bottom: TabBar(
          controller: _tabCtrl,
          labelColor: gold,
          unselectedLabelColor: textSecondary,
          indicatorColor: gold,
          tabs: const [Tab(text: "Inventory"), Tab(text: "Movements"), Tab(text: "Bonds")],
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: gold))
          : _error != null
              ? Center(child: Text(_error!, style: const TextStyle(color: Colors.red)))
              : Column(children: [
                  // Stats
                  if (_stats != null)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: Row(children: [
                        _StatCard("Items", _stats!["totalItems"]?.toString() ?? "0", gold),
                        const SizedBox(width: 8),
                        _StatCard("Bonds", _stats!["activeBonds"]?.toString() ?? "0", const Color(0xFFD97706)),
                        const SizedBox(width: 8),
                        _StatCard("Capacity", _stats!["capacityUsed"] != null ? "${_stats!["capacityUsed"]}%" : "—", const Color(0xFF2563EB)),
                      ]),
                    ),
                  const SizedBox(height: 8),
                  Expanded(
                    child: TabBarView(
                      controller: _tabCtrl,
                      children: [
                        _buildList(_inventory, (item) => _InventoryCard(item)),
                        _buildList(_movements, (m) => _MovementCard(m)),
                        _buildList(_bonds, (b) => _BondCard(b)),
                      ],
                    ),
                  ),
                ]),
    );
  }

  Widget _buildList(List<dynamic> items, Widget Function(dynamic) builder) {
    if (items.isEmpty) return const Center(child: Text("No items found", style: TextStyle(color: Color(0xFF9CA3AF))));
    return RefreshIndicator(
      color: const Color(0xFFD4A017),
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (ctx, i) => Padding(padding: const EdgeInsets.only(bottom: 10), child: builder(items[i])),
      ),
    );
  }

  Widget _StatCard(String label, String value, Color valueColor) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 10)),
          const SizedBox(height: 2),
          Text(value, style: TextStyle(color: valueColor, fontSize: 16, fontWeight: FontWeight.bold)),
        ]),
      ),
    );
  }
}

class _InventoryCard extends StatelessWidget {
  final dynamic item;
  const _InventoryCard(this.item);
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(item["description"]?.toString() ?? "Unknown Item", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text("HS: ${item["hsCode"] ?? "—"}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
          Text("Qty: ${item["quantity"] ?? 0} ${item["unit"] ?? ""}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
        ]),
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text("Entry: ${item["entryDate"] != null ? item["entryDate"].toString().substring(0, 10) : "—"}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
          Text("Exp: ${item["expiryDate"] != null ? item["expiryDate"].toString().substring(0, 10) : "—"}", style: const TextStyle(color: Color(0xFFD97706), fontSize: 12)),
        ]),
      ]),
    );
  }
}

class _MovementCard extends StatelessWidget {
  final dynamic m;
  const _MovementCard(this.m);
  @override
  Widget build(BuildContext context) {
    final isEntry = m["movementType"] == "entry";
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
      child: Row(children: [
        Icon(isEntry ? Icons.arrow_downward : Icons.arrow_upward, color: isEntry ? const Color(0xFF059669) : const Color(0xFFDC2626)),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(m["movementType"]?.toString().toUpperCase() ?? "MOVEMENT", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          Text(m["description"]?.toString() ?? "—", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
        ])),
        Text("${m["quantity"] ?? 0} ${m["unit"] ?? ""}", style: TextStyle(color: isEntry ? const Color(0xFF059669) : const Color(0xFFDC2626), fontWeight: FontWeight.bold)),
      ]),
    );
  }
}

class _BondCard extends StatelessWidget {
  final dynamic b;
  const _BondCard(this.b);
  @override
  Widget build(BuildContext context) {
    final isActive = b["status"] == "active";
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFF1E3A5F), borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(b["bondNumber"]?.toString() ?? "BOND-${b["id"]}", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          Text(isActive ? "ACTIVE" : (b["status"]?.toString().toUpperCase() ?? "—"),
            style: TextStyle(color: isActive ? const Color(0xFF059669) : const Color(0xFFD97706), fontWeight: FontWeight.bold, fontSize: 12)),
        ]),
        const SizedBox(height: 4),
        Text("Amount: \$${(b["bondAmount"] as num? ?? 0).toStringAsFixed(0)}", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold)),
        Text("Expires: ${b["expiryDate"] != null ? b["expiryDate"].toString().substring(0, 10) : "—"}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
      ]),
    );
  }
}
