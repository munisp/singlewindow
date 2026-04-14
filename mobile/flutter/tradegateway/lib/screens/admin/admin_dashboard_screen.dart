import 'package:flutter/material.dart';
import '../../services/api_service.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});
  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  Map<String, dynamic>? _stats;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final stats = await ApiService.instance.getAdminStats();
      setState(() { _stats = stats; _loading = false; });
    } catch (e) {
      setState(() { _loading = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Admin Dashboard')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _stats == null
              ? const Center(child: Text('Failed to load stats'))
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _StatCard(title: 'Total Declarations', value: '${_stats!['totalDeclarations'] ?? 0}'),
                    _StatCard(title: 'Pending Review', value: '${_stats!['pendingReview'] ?? 0}'),
                    _StatCard(title: 'Cleared Today', value: '${_stats!['clearedToday'] ?? 0}'),
                    _StatCard(title: 'Active Traders', value: '${_stats!['activeTraders'] ?? 0}'),
                  ],
                ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  const _StatCard({required this.title, required this.value});
  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        title: Text(title, style: Theme.of(context).textTheme.bodyMedium),
        trailing: Text(value, style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold)),
      ),
    );
  }
}
