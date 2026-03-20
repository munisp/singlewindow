/// TradeGateway™ NGSWTP — Flutter Scaffold with Navigation Drawer
library;

import "package:flutter/material.dart";
import "package:go_router/go_router.dart";

class ScaffoldWithNav extends StatelessWidget {
  final Widget child;
  const ScaffoldWithNav({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      drawer: _AppDrawer(),
      body: child,
    );
  }
}

class _AppDrawer extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    return Drawer(
      backgroundColor: const Color(0xFF0A1628),
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          DrawerHeader(
            decoration: const BoxDecoration(color: Color(0xFF1E3A5F)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Text("TradeGateway™", style: TextStyle(color: Color(0xFFD4A017), fontSize: 20, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              const Text("NGSWTP", style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
            ]),
          ),
          _NavItem(icon: Icons.dashboard, label: "Dashboard", path: "/", location: location),
          _NavItem(icon: Icons.description, label: "Declarations", path: "/declarations", location: location),
          _NavItem(icon: Icons.payment, label: "Payments", path: "/payments", location: location),
          _NavItem(icon: Icons.local_shipping, label: "Cargo Tracking", path: "/cargo", location: location),
          _NavItem(icon: Icons.folder, label: "Document Vault", path: "/documents", location: location),
          _NavItem(icon: Icons.account_balance, label: "OGA Status", path: "/oga", location: location),
          _NavItem(icon: Icons.verified_user, label: "KYC", path: "/kyc", location: location),
          _NavItem(icon: Icons.star, label: "AEO Programme", path: "/aeo", location: location),
          _NavItem(icon: Icons.bar_chart, label: "Trader Scorecard", path: "/scorecard", location: location),
          _NavItem(icon: Icons.monitor_heart, label: "System Status", path: "/status", location: location),
          _NavItem(icon: Icons.notifications, label: "Notifications", path: "/notifications", location: location),
          _NavItem(icon: Icons.person, label: "Profile", path: "/profile", location: location),
          const Divider(color: Color(0xFF1E3A5F)),
          _NavItem(icon: Icons.search, label: "HS Code Lookup", path: "/hs-lookup", location: location),
          _NavItem(icon: Icons.camera_alt, label: "Scan Document", path: "/scan", location: location),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final String path;
  final String location;

  const _NavItem({required this.icon, required this.label, required this.path, required this.location});

  @override
  Widget build(BuildContext context) {
    final isActive = location == path;
    return ListTile(
      leading: Icon(icon, color: isActive ? const Color(0xFFD4A017) : const Color(0xFF9CA3AF), size: 20),
      title: Text(label, style: TextStyle(color: isActive ? const Color(0xFFD4A017) : const Color(0xFF9CA3AF), fontSize: 14)),
      tileColor: isActive ? const Color(0xFF1E3A5F) : null,
      onTap: () { context.go(path); Navigator.pop(context); },
    );
  }
}
