/// TradeGateway™ NGSWTP — Flutter Notifications Screen (v42 — type icons + bond expiry tab + 30s polling)
library;
import "dart:async";
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  bool _loading = true;
  List<dynamic> _items = [];
  int _unreadCount = 0;
  String? _error;
  late TabController _tabController;
  Timer? _pollTimer;

  static const _tabs = [
    {"label": "All",          "type": null},
    {"label": "Bond Expiry",  "type": "permit_expiry_warning"},
    {"label": "SLA Breach",   "type": "sla_breach"},
    {"label": "Security",     "type": "security_alert"},
    {"label": "Declaration",  "type": "declaration_update"},
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
    _tabController.addListener(() { if (!_tabController.indexIsChanging) _load(); });
    _load();
    _pollTimer = Timer.periodic(const Duration(seconds: 30), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _tabController.dispose();
    _pollTimer?.cancel();
    super.dispose();
  }

  String? get _activeType => _tabs[_tabController.index]["type"] as String?;

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _error = null; });
    try {
      final result = await ApiService().listNotifications(limit: 100, unreadOnly: false);
      final all = (result["items"] as List?) ?? [];
      final filtered = _activeType == null
          ? all
          : all.where((n) => (n as Map)["type"] == _activeType).toList();
      final unread = all.where((n) =>
          !((n as Map)["read"] as bool? ?? (n as Map)["isRead"] as bool? ?? false)).length;
      if (mounted) {
        setState(() { _items = filtered; _unreadCount = unread; _loading = false; });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _markRead(int id) async {
    try { await ApiService().markNotificationRead(id); _load(silent: true); } catch (_) {}
  }

  Future<void> _markAllRead() async {
    final unread = _items.where((n) =>
        !((n as Map)["read"] as bool? ?? (n as Map)["isRead"] as bool? ?? false)).toList();
    for (final n in unread) {
      try { await ApiService().markNotificationRead((n as Map)["id"] as int); } catch (_) {}
    }
    _load(silent: true);
  }

  IconData _iconFor(String? type) {
    switch (type) {
      case "permit_expiry_warning": return Icons.warehouse_outlined;
      case "sla_breach":            return Icons.timer_off_outlined;
      case "security_alert":        return Icons.security;
      case "declaration_update":    return Icons.description_outlined;
      case "payment_received":      return Icons.payments_outlined;
      case "risk_flag":             return Icons.flag_outlined;
      default:                      return Icons.notifications_outlined;
    }
  }

  Color _colorFor(String? type) {
    switch (type) {
      case "permit_expiry_warning": return const Color(0xFFF59E0B);
      case "sla_breach":            return const Color(0xFFEF4444);
      case "security_alert":        return const Color(0xFFEC4899);
      case "declaration_update":    return const Color(0xFF3B82F6);
      case "payment_received":      return const Color(0xFF10B981);
      case "risk_flag":             return const Color(0xFFEF4444);
      default:                      return const Color(0xFF6B7280);
    }
  }

  String _labelFor(String? type) {
    switch (type) {
      case "permit_expiry_warning": return "BOND EXPIRY";
      case "sla_breach":            return "SLA BREACH";
      case "security_alert":        return "SECURITY";
      case "declaration_update":    return "DECLARATION";
      case "payment_received":      return "PAYMENT";
      case "risk_flag":             return "RISK FLAG";
      default:                      return "SYSTEM";
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: Row(children: [
          const Text("Notifications", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          if (_unreadCount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(color: const Color(0xFFEF4444), borderRadius: BorderRadius.circular(10)),
              child: Text("$_unreadCount", style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w700)),
            ),
          ],
        ]),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [
          if (_unreadCount > 0)
            TextButton(
              onPressed: _markAllRead,
              child: const Text("Mark all read", style: TextStyle(color: Color(0xFFD4A017), fontSize: 12)),
            ),
          IconButton(icon: const Icon(Icons.refresh, color: Color(0xFF9CA3AF)), onPressed: _load),
        ],
        bottom: TabBar(
          controller: _tabController,
          isScrollable: true,
          labelColor: const Color(0xFFD4A017),
          unselectedLabelColor: const Color(0xFF6B7280),
          indicatorColor: const Color(0xFFD4A017),
          indicatorSize: TabBarIndicatorSize.label,
          tabs: _tabs.map((t) => Tab(text: t["label"] as String)).toList(),
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
                  ElevatedButton(onPressed: _load, style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFFD4A017)), child: const Text("Retry")),
                ]))
              : RefreshIndicator(
                  onRefresh: _load,
                  color: const Color(0xFFD4A017),
                  child: _items.isEmpty
                      ? Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Icon(_activeType != null ? _iconFor(_activeType) : Icons.notifications_none,
                              color: const Color(0xFF6B7280), size: 64),
                          const SizedBox(height: 16),
                          Text(
                            _activeType == "permit_expiry_warning"
                                ? "No bond expiry alerts"
                                : "No notifications",
                            style: const TextStyle(color: Color(0xFF9CA3AF)),
                          ),
                        ]))
                      : ListView.builder(
                          itemCount: _items.length,
                          itemBuilder: (ctx, i) {
                            final n = _items[i] as Map<String, dynamic>;
                            final isRead = n["read"] as bool? ?? n["isRead"] as bool? ?? false;
                            final type = n["type"] as String?;
                            final iconColor = _colorFor(type);
                            return Dismissible(
                              key: Key(n["id"].toString()),
                              direction: DismissDirection.endToStart,
                              background: Container(
                                color: const Color(0xFF10B981),
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(right: 16),
                                child: const Icon(Icons.done, color: Colors.white),
                              ),
                              onDismissed: (_) => _markRead(n["id"] as int),
                              child: Container(
                                margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: isRead ? const Color(0xFF111827) : const Color(0xFF1E3A5F),
                                  borderRadius: BorderRadius.circular(8),
                                  border: isRead ? null : Border.all(color: iconColor.withOpacity(0.4)),
                                ),
                                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                  Container(
                                    width: 36, height: 36,
                                    margin: const EdgeInsets.only(right: 10),
                                    decoration: BoxDecoration(
                                      color: iconColor.withOpacity(0.15),
                                      borderRadius: BorderRadius.circular(8),
                                    ),
                                    child: Icon(_iconFor(type), color: iconColor, size: 18),
                                  ),
                                  Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                                    Row(children: [
                                      Expanded(
                                        child: Text(
                                          n["title"] as String? ?? "Notification",
                                          style: TextStyle(
                                            color: isRead ? const Color(0xFF9CA3AF) : Colors.white,
                                            fontWeight: isRead ? FontWeight.normal : FontWeight.w600,
                                            fontSize: 13,
                                          ),
                                        ),
                                      ),
                                      if (!isRead)
                                        Container(
                                          width: 8, height: 8,
                                          decoration: BoxDecoration(color: iconColor, shape: BoxShape.circle),
                                        ),
                                    ]),
                                    const SizedBox(height: 4),
                                    Text(
                                      n["message"] as String? ?? n["content"] as String? ?? "",
                                      style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12),
                                      maxLines: 3,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 6),
                                    Row(children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(
                                          color: iconColor.withOpacity(0.12),
                                          borderRadius: BorderRadius.circular(4),
                                        ),
                                        child: Text(
                                          _labelFor(type),
                                          style: TextStyle(color: iconColor, fontSize: 10, fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                      const Spacer(),
                                      Text(
                                        n["createdAt"] as String? ?? "",
                                        style: const TextStyle(color: Color(0xFF6B7280), fontSize: 10),
                                      ),
                                    ]),
                                  ])),
                                ]),
                              ),
                            );
                          },
                        ),
                ),
    );
  }
}
