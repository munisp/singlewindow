import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class OnboardingProgressScreen extends StatefulWidget {
  const OnboardingProgressScreen({super.key});

  @override
  State<OnboardingProgressScreen> createState() => _OnboardingProgressScreenState();
}

class _OnboardingProgressScreenState extends State<OnboardingProgressScreen> {
  Map<String, dynamic>? _data;
  bool _loading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.get('/api/trpc/traderOnboarding.getProgress');
      setState(() { _data = data as Map<String, dynamic>?; _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'completed':   return Colors.green;
      case 'in_progress': return AppTheme.primary;
      case 'blocked':     return Colors.red;
      default:            return Colors.grey;
    }
  }

  IconData _statusIcon(String status) {
    switch (status) {
      case 'completed':   return Icons.check_circle;
      case 'in_progress': return Icons.radio_button_checked;
      case 'blocked':     return Icons.cancel;
      default:            return Icons.radio_button_unchecked;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        title: const Text('Onboarding Progress', style: TextStyle(color: AppTheme.textPrimary)),
        iconTheme: const IconThemeData(color: AppTheme.primary),
      ),
      body: _loading
        ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
        : _error.isNotEmpty
          ? Center(child: Text(_error, style: const TextStyle(color: Colors.red)))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  // Summary card
                  if (_data != null) ...[
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: AppTheme.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: AppTheme.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(_data!['traderName'] as String? ?? '', style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w700, fontSize: 16)),
                          const SizedBox(height: 12),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: ((_data!['overallProgress'] as num?) ?? 0) / 100,
                              backgroundColor: AppTheme.border,
                              valueColor: const AlwaysStoppedAnimation<Color>(AppTheme.primary),
                              minHeight: 8,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text('${_data!['overallProgress']}% Complete', style: const TextStyle(color: AppTheme.primary, fontWeight: FontWeight.w700, fontSize: 13)),
                              if (_data!['estimatedCompletionDate'] != null)
                                Text(
                                  'Est: ${DateTime.tryParse(_data!['estimatedCompletionDate'] as String)?.toLocal().toString().split(' ')[0] ?? ''}',
                                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
                                ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text('Current step: ${_data!['currentStep'] ?? ''}', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                  ],

                  // Steps
                  const Text('ONBOARDING STEPS', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 1)),
                  const SizedBox(height: 12),
                  ...(_data?['steps'] as List? ?? []).asMap().entries.map((entry) {
                    final step = entry.value as Map<String, dynamic>;
                    final status = step['status'] as String? ?? 'pending';
                    final statusColor = _statusColor(status);
                    final isLast = entry.key == ((_data?['steps'] as List?)?.length ?? 0) - 1;

                    return IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Timeline
                          SizedBox(
                            width: 36,
                            child: Column(
                              children: [
                                Icon(_statusIcon(status), color: statusColor, size: 28),
                                if (!isLast)
                                  Expanded(child: Container(width: 2, color: statusColor.withOpacity(0.3))),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          // Content
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.only(bottom: 20),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Row(
                                    children: [
                                      Expanded(
                                        child: Text(step['title'] as String? ?? '', style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600, fontSize: 14)),
                                      ),
                                      Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                        decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(12)),
                                        child: Text(status.replaceAll('_', ' ').toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
                                      ),
                                    ],
                                  ),
                                  const SizedBox(height: 4),
                                  Text(step['description'] as String? ?? '', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                                  if (step['completedAt'] != null) ...[
                                    const SizedBox(height: 4),
                                    Text(
                                      'Completed: ${DateTime.tryParse(step['completedAt'] as String)?.toLocal().toString().split(' ')[0] ?? ''}',
                                      style: const TextStyle(color: Colors.green, fontSize: 11),
                                    ),
                                  ],
                                  if ((step['requiredDocuments'] as List?)?.isNotEmpty == true) ...[
                                    const SizedBox(height: 6),
                                    const Text('Required documents:', style: TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
                                    ...(step['requiredDocuments'] as List).map((doc) =>
                                      Text('• $doc', style: const TextStyle(color: AppTheme.textPrimary, fontSize: 11)),
                                    ),
                                  ],
                                  if (step['estimatedDays'] != null && status != 'completed') ...[
                                    const SizedBox(height: 4),
                                    Text('Est. ${step['estimatedDays']} business days', style: const TextStyle(color: Colors.orange, fontSize: 11)),
                                  ],
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    );
                  }),

                  if (_data == null && !_loading)
                    const Center(child: Text('No onboarding data available.', style: TextStyle(color: AppTheme.textSecondary))),
                ],
              ),
            ),
    );
  }
}
