/// TradeGateway™ NGSWTP — Flutter Declarations Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class DeclarationsScreen extends StatefulWidget {
  const DeclarationsScreen({super.key});
  @override
  State<DeclarationsScreen> createState() => _DeclarationsScreenState();
}

class _DeclarationsScreenState extends State<DeclarationsScreen> with SingleTickerProviderStateMixin {
  bool _loading = true;
  Map<String, dynamic>? _data;
  String? _error;
  String _statusFilter = "all";
  String _search = "";
  int _page = 1;
  late TabController _tabs;

  static const _statuses = ["all", "draft", "submitted", "approved", "rejected"];
  static const _statusColors = {
    "draft": Color(0xFF6B7280),
    "submitted": Color(0xFF3B82F6),
    "approved": Color(0xFF10B981),
    "rejected": Color(0xFFEF4444),
    "pending": Color(0xFFD4A017),
  };

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: _statuses.length, vsync: this);
    _tabs.addListener(() {
      if (!_tabs.indexIsChanging) {
        setState(() { _statusFilter = _statuses[_tabs.index]; _page = 1; });
        _load();
      }
    });
    _load();
  }

  @override
  void dispose() { _tabs.dispose(); super.dispose(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().listDeclarations(
        page: _page,
        limit: 20,
        status: _statusFilter == "all" ? null : _statusFilter,
        search: _search.isEmpty ? null : _search,
      );
      setState(() { _loading = false; _data = result.toJson(); });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = (_data?["items"] as List?) ?? [];
    final total = _data?["total"] ?? 0;

    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("Declarations", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => Navigator.pushNamed(context, "/app/new-declaration").then((_) => _load()),
          ),
        ],
        bottom: TabBar(
          controller: _tabs,
          isScrollable: true,
          labelColor: const Color(0xFFD4A017),
          unselectedLabelColor: const Color(0xFF6B7280),
          indicatorColor: const Color(0xFFD4A017),
          tabs: _statuses.map((s) => Tab(text: s[0].toUpperCase() + s.substring(1))).toList(),
        ),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: "Search by UCR, HS code...",
              hintStyle: const TextStyle(color: Color(0xFF6B7280)),
              prefixIcon: const Icon(Icons.search, color: Color(0xFF6B7280)),
              filled: true,
              fillColor: const Color(0xFF111827),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
            ),
            onSubmitted: (v) { setState(() { _search = v; _page = 1; }); _load(); },
          ),
        ),
        if (_loading)
          const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFFD4A017))))
        else if (_error != null)
          Expanded(child: Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
            const Icon(Icons.error_outline, color: Color(0xFFEF4444), size: 48),
            const SizedBox(height: 16),
            Text(_error!, style: const TextStyle(color: Color(0xFF9CA3AF)), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)), child: const Text("Retry")),
          ])))
        else
          Expanded(child: RefreshIndicator(
            onRefresh: _load,
            color: const Color(0xFFD4A017),
            child: items.isEmpty
              ? const Center(child: Text("No declarations found", style: TextStyle(color: Color(0xFF9CA3AF))))
              : ListView.builder(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  itemCount: items.length,
                  itemBuilder: (ctx, i) {
                    final d = items[i] as Map<String, dynamic>;
                    final status = d["status"] as String? ?? "draft";
                    final color = _statusColors[status] ?? const Color(0xFF6B7280);
                    return GestureDetector(
                      onTap: () => Navigator.pushNamed(ctx, "/app/declaration-detail", arguments: d["id"]).then((_) => _load()),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: const Color(0xFF111827), borderRadius: BorderRadius.circular(8)),
                        child: Row(children: [
                          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(d["ucr"] as String? ?? "—", style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600, fontSize: 14)),
                            const SizedBox(height: 4),
                            Text(d["description"] as String? ?? d["hsCode"] as String? ?? "—", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
                            const SizedBox(height: 4),
                            Text(d["createdAt"] as String? ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
                          ])),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: color.withOpacity(0.15), borderRadius: BorderRadius.circular(4), border: Border.all(color: color.withOpacity(0.4))),
                            child: Text(status.toUpperCase(), style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.w700)),
                          ),
                        ]),
                      ),
                    );
                  },
                ),
          )),
        if (!_loading && total > 20)
          Padding(
            padding: const EdgeInsets.all(8),
            child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              if (_page > 1) TextButton(onPressed: () { setState(() => _page--); _load(); }, child: const Text("← Prev", style: TextStyle(color: Color(0xFFD4A017)))),
              Text("Page $_page", style: const TextStyle(color: Color(0xFF9CA3AF))),
              TextButton(onPressed: () { setState(() => _page++); _load(); }, child: const Text("Next →", style: TextStyle(color: Color(0xFFD4A017)))),
            ]),
          ),
      ]),
    );
  }
}
