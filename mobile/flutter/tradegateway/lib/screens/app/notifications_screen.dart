/// TradeGateway™ NGSWTP — Flutter Notifications Screen (v37 — DB-backed)
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  bool _loading = true;
  List<dynamic> _items = [];
  int _unreadCount = 0;
  String? _error;
  bool _unreadOnly = false;

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final result = await ApiService().listNotifications(limit: 50, unreadOnly: _unreadOnly);
      setState(() {
        _items = (result["items"] as List?) ?? [];
        _unreadCount = result["unreadCount"] as int? ?? 0;
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = e.toString(); });
    }
  }

  Future<void> _markRead(int id) async {
    try {
      await ApiService().markNotificationRead(id);
      _load();
    } catch (_) {}
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
          IconButton(
            icon: Icon(_unreadOnly ? Icons.mark_email_read : Icons.mark_email_unread, color: _unreadOnly ? const Color(0xFFD4A017) : const Color(0xFF6B7280)),
            onPressed: () { setState(() => _unreadOnly = !_unreadOnly); _load(); },
            tooltip: "Toggle unread only",
          ),
          IconButton(icon: const Icon(Icons.refresh), onPressed: _load),
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
          : RefreshIndicator(
              onRefresh: _load,
              color: const Color(0xFFD4A017),
              child: _items.isEmpty
                ? const Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                    Icon(Icons.notifications_none, color: Color(0xFF6B7280), size: 64),
                    SizedBox(height: 16),
                    Text("No notifications", style: TextStyle(color: Color(0xFF9CA3AF))),
                  ]))
                : ListView.builder(
                    itemCount: _items.length,
                    itemBuilder: (ctx, i) {
                      final n = _items[i] as Map<String, dynamic>;
                      final isRead = n["read"] as bool? ?? n["isRead"] as bool? ?? false;
                      return Dismissible(
                        key: Key(n["id"].toString()),
                        direction: DismissDirection.endToStart,
                        background: Container(color: const Color(0xFF10B981), alignment: Alignment.centerRight, padding: const EdgeInsets.only(right: 16), child: const Icon(Icons.done, color: Colors.white)),
                        onDismissed: (_) => _markRead(n["id"] as int),
                        child: Container(
                          margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: isRead ? const Color(0xFF111827) : const Color(0xFF1E3A5F),
                            borderRadius: BorderRadius.circular(8),
                            border: isRead ? null : Border.all(color: const Color(0xFFD4A017).withOpacity(0.3)),
                          ),
                          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            if (!isRead) Container(width: 8, height: 8, margin: const EdgeInsets.only(top: 4, right: 8), decoration: const BoxDecoration(color: Color(0xFFD4A017), shape: BoxShape.circle)),
                            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text(n["title"] as String? ?? "Notification", style: TextStyle(color: isRead ? const Color(0xFF9CA3AF) : Colors.white, fontWeight: isRead ? FontWeight.normal : FontWeight.w600)),
                              const SizedBox(height: 4),
                              Text(n["message"] as String? ?? n["content"] as String? ?? "", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12), maxLines: 2, overflow: TextOverflow.ellipsis),
                              const SizedBox(height: 4),
                              Text(n["createdAt"] as String? ?? "", style: const TextStyle(color: Color(0xFF6B7280), fontSize: 11)),
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
