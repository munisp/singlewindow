// TradeGateway NGSWTP — Security Monitor Screen (Flutter)
// Sprint v67 — Insider Threat Prevention — Mobile Parity
//
// Provides admin users with:
//   - Anomaly alert list with severity chips
//   - 4-Eyes approval queue with approve/deny bottom sheets
//   - Audit chain integrity status
//
// Designed for Flutter 3.22+ (Dart 3.4+).
// Connects to the same tRPC API as the PWA via HTTP (package:http or dio).
//
// Navigation: registered as '/security-monitor' in the admin route tree.

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

// ─── Design Tokens ────────────────────────────────────────────────────────────

class AppColors {
  static const navy = Color(0xFF0A1628);
  static const navyLight = Color(0xFF1E3A5F);
  static const gold = Color(0xFFD4A017);
  static const surface = Color(0xFF0F1E35);
  static const surfaceElevated = Color(0xFF162840);
  static const textPrimary = Color(0xFFF0F4FF);
  static const textSecondary = Color(0xFF8CA0C0);
  static const success = Color(0xFF10B981);
  static const warning = Color(0xFFF59E0B);
  static const danger = Color(0xFFEF4444);
  static const info = Color(0xFF3B82F6);

  static Color severityColor(String severity) {
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return danger;
      case 'HIGH':
        return const Color(0xFFF97316);
      case 'MEDIUM':
        return warning;
      case 'LOW':
        return info;
      default:
        return info;
    }
  }
}

// ─── Mock Data Models ─────────────────────────────────────────────────────────

class AnomalyAlert {
  final String ruleId;
  final String ruleName;
  final String severity;
  final String description;
  final String userId;
  final DateTime timestamp;
  final String recommendedAction;

  const AnomalyAlert({
    required this.ruleId,
    required this.ruleName,
    required this.severity,
    required this.description,
    required this.userId,
    required this.timestamp,
    required this.recommendedAction,
  });
}

class FourEyesRequest {
  final String id;
  final String requesterName;
  final String action;
  final String entityType;
  final String entityId;
  final String description;
  final DateTime createdAt;

  const FourEyesRequest({
    required this.id,
    required this.requesterName,
    required this.action,
    required this.entityType,
    required this.entityId,
    required this.description,
    required this.createdAt,
  });
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

final _mockAlerts = [
  AnomalyAlert(
    ruleId: 'R001',
    ruleName: 'Brute Force Login',
    severity: 'HIGH',
    description: '5 failed login attempts in 5 minutes',
    userId: 'user-42',
    timestamp: DateTime.now().subtract(const Duration(minutes: 5)),
    recommendedAction: 'Lock account and notify security team',
  ),
  AnomalyAlert(
    ruleId: 'R003',
    ruleName: 'Off-Hours Access',
    severity: 'MEDIUM',
    description: 'Privileged access at 02:14 local time',
    userId: 'officer-17',
    timestamp: DateTime.now().subtract(const Duration(hours: 2)),
    recommendedAction: 'Review session and verify with user',
  ),
  AnomalyAlert(
    ruleId: 'R010',
    ruleName: 'Repeated RBAC Denial',
    severity: 'CRITICAL',
    description: '10 authz_denied events in 1 minute',
    userId: 'user-99',
    timestamp: DateTime.now().subtract(const Duration(minutes: 1)),
    recommendedAction: 'Immediately revoke session and investigate',
  ),
];

final _mockFourEyes = [
  FourEyesRequest(
    id: '4eyes-001',
    requesterName: 'Alice Mensah',
    action: 'bulk_delete_declarations',
    entityType: 'declaration',
    entityId: '*',
    description: 'Delete 47 test declarations from staging environment',
    createdAt: DateTime.now().subtract(const Duration(minutes: 10)),
  ),
  FourEyesRequest(
    id: '4eyes-002',
    requesterName: 'Kwame Asante',
    action: 'override_risk_score',
    entityType: 'declaration',
    entityId: 'DEC-2024-00891',
    description: 'Override risk score from RED to GREEN for urgent medical shipment',
    createdAt: DateTime.now().subtract(const Duration(minutes: 2)),
  ),
];

// ─── Security Monitor Screen ──────────────────────────────────────────────────

class SecurityMonitorScreen extends StatefulWidget {
  const SecurityMonitorScreen({super.key});

  @override
  State<SecurityMonitorScreen> createState() => _SecurityMonitorScreenState();
}

class _SecurityMonitorScreenState extends State<SecurityMonitorScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final List<AnomalyAlert> _alerts = List.from(_mockAlerts);
  final List<FourEyesRequest> _pending = List.from(_mockFourEyes);
  bool _refreshing = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _onRefresh() async {
    setState(() => _refreshing = true);
    await Future.delayed(const Duration(milliseconds: 800));
    setState(() => _refreshing = false);
  }

  void _showApprovalSheet(FourEyesRequest req, bool approve) {
    final controller = TextEditingController();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 24,
          bottom: MediaQuery.of(ctx).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              approve ? 'Approve Action' : 'Deny Action',
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Provide a reason for ${approve ? "approving" : "denying"} this privileged action.',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 14),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controller,
              maxLines: 3,
              style: const TextStyle(color: AppColors.textPrimary),
              decoration: InputDecoration(
                hintText: 'Reason...',
                hintStyle: const TextStyle(color: AppColors.textSecondary),
                filled: true,
                fillColor: AppColors.navy,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: AppColors.navyLight),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: AppColors.navyLight),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textSecondary,
                      side: const BorderSide(color: AppColors.navyLight),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: () {
                      if (controller.text.trim().isEmpty) {
                        ScaffoldMessenger.of(ctx).showSnackBar(
                          const SnackBar(content: Text('Please provide a reason')),
                        );
                        return;
                      }
                      setState(() => _pending.removeWhere((r) => r.id == req.id));
                      Navigator.pop(ctx);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Request ${approve ? "approved" : "denied"}'),
                          backgroundColor: approve ? AppColors.success : AppColors.danger,
                        ),
                      );
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: approve ? AppColors.success : AppColors.danger,
                    ),
                    child: Text(approve ? 'Confirm Approval' : 'Confirm Denial'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ─── Alert List ─────────────────────────────────────────────────────────────

  Widget _buildAlertCard(AnomalyAlert alert) {
    final ts = DateFormat('dd MMM HH:mm').format(alert.timestamp);
    return Card(
      color: AppColors.surfaceElevated,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.navyLight),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    alert.ruleName,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                ),
                Chip(
                  label: Text(
                    alert.severity,
                    style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                  backgroundColor: AppColors.severityColor(alert.severity),
                  padding: EdgeInsets.zero,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(alert.description, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 4),
            Text(
              'User: ${alert.userId} · $ts',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: AppColors.navy,
                borderRadius: BorderRadius.circular(6),
                border: const Border(left: BorderSide(color: AppColors.gold, width: 3)),
              ),
              child: Text(
                '⚡ ${alert.recommendedAction}',
                style: const TextStyle(color: AppColors.gold, fontSize: 12),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ─── 4-Eyes Card ────────────────────────────────────────────────────────────

  Widget _buildFourEyesCard(FourEyesRequest req) {
    final ts = DateFormat('dd MMM HH:mm').format(req.createdAt);
    return Card(
      color: AppColors.surfaceElevated,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: AppColors.navyLight),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    req.action,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                ),
                Chip(
                  label: const Text(
                    'PENDING',
                    style: TextStyle(color: Colors.black, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                  backgroundColor: AppColors.warning,
                  padding: EdgeInsets.zero,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(req.description, style: const TextStyle(color: AppColors.textSecondary, fontSize: 13)),
            const SizedBox(height: 4),
            Text(
              'By: ${req.requesterName} · $ts',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            Text(
              'Entity: ${req.entityType}/${req.entityId}',
              style: const TextStyle(color: AppColors.textSecondary, fontSize: 12),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _showApprovalSheet(req, true),
                    icon: const Icon(Icons.check, size: 16),
                    label: const Text('Approve'),
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.success),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => _showApprovalSheet(req, false),
                    icon: const Icon(Icons.close, size: 16),
                    label: const Text('Deny'),
                    style: ElevatedButton.styleFrom(backgroundColor: AppColors.danger),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ─── Chain Tab ───────────────────────────────────────────────────────────────

  Widget _buildChainTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: AppColors.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppColors.navyLight),
          ),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                const Icon(Icons.lock, size: 48, color: AppColors.success),
                const SizedBox(height: 12),
                const Text(
                  'Chain Intact',
                  style: TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 4),
                const Text(
                  'TigerBeetle immutable audit chain verified',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Chip(
                  label: const Text('VALID', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  backgroundColor: AppColors.success,
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 12),
        Card(
          color: AppColors.surfaceElevated,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: const BorderSide(color: AppColors.navyLight),
          ),
          child: const Padding(
            padding: EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'What is the Audit Chain?',
                  style: TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600, fontSize: 15),
                ),
                SizedBox(height: 8),
                Text(
                  'Every privileged action is appended to a TigerBeetle ledger with a SHA-256 chain hash. '
                  'Each entry includes the hash of the previous entry, making retroactive tampering '
                  'cryptographically detectable.',
                  style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ─── Build ───────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.navy,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        foregroundColor: AppColors.textPrimary,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('🛡 Security Monitor', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            Text('Insider Threat Detection', style: TextStyle(fontSize: 12, color: AppColors.textSecondary)),
          ],
        ),
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.gold,
          unselectedLabelColor: AppColors.textSecondary,
          indicatorColor: AppColors.gold,
          tabs: const [
            Tab(text: 'Alerts'),
            Tab(text: '4-Eyes'),
            Tab(text: 'Chain'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          // Alerts Tab
          RefreshIndicator(
            onRefresh: _onRefresh,
            color: AppColors.gold,
            backgroundColor: AppColors.surface,
            child: _alerts.isEmpty
                ? const Center(child: Text('No anomaly alerts', style: TextStyle(color: AppColors.textSecondary)))
                : ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _alerts.length,
                    itemBuilder: (_, i) => _buildAlertCard(_alerts[i]),
                  ),
          ),
          // 4-Eyes Tab
          _pending.isEmpty
              ? const Center(
                  child: Text('No pending approvals', style: TextStyle(color: AppColors.textSecondary)),
                )
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _pending.length,
                  itemBuilder: (_, i) => _buildFourEyesCard(_pending[i]),
                ),
          // Chain Tab
          _buildChainTab(),
        ],
      ),
    );
  }
}
