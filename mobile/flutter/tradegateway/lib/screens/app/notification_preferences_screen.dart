import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class NotificationPreferencesScreen extends StatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  State<NotificationPreferencesScreen> createState() => _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState extends State<NotificationPreferencesScreen> {
  Map<String, bool> _prefs = {};
  bool _loading = true;
  bool _saving = false;

  final Map<String, Map<String, String>> _prefMeta = {
    'declarationStatusUpdates': {'label': 'Declaration Status Updates', 'desc': 'Notified when your declaration status changes', 'group': 'Declarations'},
    'paymentConfirmations':     {'label': 'Payment Confirmations',     'desc': 'Receive confirmation after successful payments', 'group': 'Payments'},
    'ogaApprovals':             {'label': 'OGA Approvals',             'desc': 'Updates from Other Government Agencies', 'group': 'Declarations'},
    'riskAlerts':               {'label': 'Risk Alerts',               'desc': 'High-risk declarations and compliance issues', 'group': 'Compliance'},
    'aeoStatusChanges':         {'label': 'AEO Status Changes',        'desc': 'Changes to your AEO status', 'group': 'Compliance'},
    'systemMaintenance':        {'label': 'System Maintenance',        'desc': 'Planned downtime and maintenance windows', 'group': 'System'},
    'weeklyReports':            {'label': 'Weekly Reports',            'desc': 'Weekly summary of your trade activity', 'group': 'Reports'},
    'slaBreaches':              {'label': 'SLA Breach Alerts',         'desc': 'Alerts when clearance SLAs are at risk', 'group': 'Compliance'},
    'emailEnabled':             {'label': 'Email Notifications',       'desc': 'Receive notifications via email', 'group': 'Channels'},
    'smsEnabled':               {'label': 'SMS Notifications',         'desc': 'Receive notifications via SMS', 'group': 'Channels'},
    'pushEnabled':              {'label': 'Push Notifications',        'desc': 'Receive push notifications on this device', 'group': 'Channels'},
  };

  @override
  void initState() {
    super.initState();
    _loadPrefs();
  }

  Future<void> _loadPrefs() async {
    setState(() { _loading = true; });
    try {
      final data = await ApiService.get('/api/trpc/notifications.getPreferences');
      if (data != null) {
        setState(() {
          _prefs = Map<String, bool>.from(
            (data as Map<String, dynamic>).map((k, v) => MapEntry(k, v == true)),
          );
        });
      }
    } catch (_) {}
    setState(() { _loading = false; });
  }

  Future<void> _save() async {
    setState(() { _saving = true; });
    try {
      await ApiService.post('/api/trpc/notifications.updatePreferences', _prefs);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Preferences saved'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
    setState(() { _saving = false; });
  }

  @override
  Widget build(BuildContext context) {
    final groups = _prefMeta.values.map((v) => v['group']!).toSet().toList();

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        title: const Text('Notification Preferences', style: TextStyle(color: AppTheme.textPrimary)),
        iconTheme: const IconThemeData(color: AppTheme.primary),
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
        : Column(
            children: [
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    ...groups.map((group) {
                      final groupKeys = _prefMeta.entries
                          .where((e) => e.value['group'] == group)
                          .map((e) => e.key)
                          .toList();
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Text(group.toUpperCase(), style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
                          ),
                          Container(
                            decoration: BoxDecoration(
                              color: AppTheme.surface,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppTheme.border),
                            ),
                            child: Column(
                              children: groupKeys.asMap().entries.map((entry) {
                                final idx = entry.key;
                                final key = entry.value;
                                final meta = _prefMeta[key]!;
                                return Column(
                                  children: [
                                    if (idx > 0) const Divider(height: 1, color: AppTheme.border),
                                    SwitchListTile(
                                      title: Text(meta['label']!, style: const TextStyle(color: AppTheme.textPrimary, fontSize: 14, fontWeight: FontWeight.w600)),
                                      subtitle: Text(meta['desc']!, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                                      value: _prefs[key] ?? false,
                                      onChanged: (v) => setState(() => _prefs[key] = v),
                                      activeColor: AppTheme.primary,
                                    ),
                                  ],
                                );
                              }).toList(),
                            ),
                          ),
                          const SizedBox(height: 16),
                        ],
                      );
                    }),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(16),
                child: SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: _saving ? null : _save,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppTheme.primary,
                      padding: const EdgeInsets.symmetric(vertical: 16),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    child: _saving
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                      : const Text('Save Preferences', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 15)),
                  ),
                ),
              ),
            ],
          ),
    );
  }
}
