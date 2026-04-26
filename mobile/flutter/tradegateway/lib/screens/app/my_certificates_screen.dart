import 'package:flutter/material.dart';
import '../../services/api_service.dart';
import '../../theme/app_theme.dart';

class MyCertificatesScreen extends StatefulWidget {
  const MyCertificatesScreen({super.key});

  @override
  State<MyCertificatesScreen> createState() => _MyCertificatesScreenState();
}

class _MyCertificatesScreenState extends State<MyCertificatesScreen> {
  List<Map<String, dynamic>> _certificates = [];
  bool _loading = true;
  String _error = '';
  String _search = '';
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _loadCertificates();
  }

  Future<void> _loadCertificates() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final data = await ApiService.get('/api/trpc/certificates.list?input=${Uri.encodeComponent('{"filter":"$_filter"}')}');
      setState(() { _certificates = List<Map<String, dynamic>>.from(data ?? []); _loading = false; });
    } catch (e) {
      setState(() { _error = e.toString(); _loading = false; });
    }
  }

  Future<void> _revoke(int id) async {
    try {
      await ApiService.post('/api/trpc/certificates.revoke', {'id': id});
      _loadCertificates();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Certificate revoked successfully'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'active':    return Colors.green;
      case 'expired':   return Colors.red;
      case 'revoked':   return Colors.red;
      case 'pending':   return Colors.orange;
      default:          return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    final filtered = _certificates.where((c) {
      final q = _search.toLowerCase();
      return (c['type'] as String? ?? '').toLowerCase().contains(q) ||
             (c['issuer'] as String? ?? '').toLowerCase().contains(q) ||
             (c['declarationRef'] as String? ?? '').toLowerCase().contains(q);
    }).toList();

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        backgroundColor: AppTheme.surface,
        title: const Text('My Certificates', style: TextStyle(color: AppTheme.textPrimary)),
        iconTheme: const IconThemeData(color: AppTheme.primary),
      ),
      body: Column(
        children: [
          // Search
          Padding(
            padding: const EdgeInsets.all(16),
            child: TextField(
              style: const TextStyle(color: AppTheme.textPrimary),
              decoration: InputDecoration(
                hintText: 'Search certificates...',
                hintStyle: const TextStyle(color: AppTheme.textSecondary),
                prefixIcon: const Icon(Icons.search, color: AppTheme.textSecondary),
                filled: true,
                fillColor: AppTheme.surface,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
              ),
              onChanged: (v) => setState(() => _search = v),
            ),
          ),

          // Filter chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: ['all', 'active', 'expired', 'pending'].map((f) => Padding(
                padding: const EdgeInsets.only(right: 8),
                child: FilterChip(
                  label: Text(f[0].toUpperCase() + f.substring(1)),
                  selected: _filter == f,
                  onSelected: (_) { setState(() => _filter = f); _loadCertificates(); },
                  selectedColor: AppTheme.primary.withOpacity(0.2),
                  labelStyle: TextStyle(color: _filter == f ? AppTheme.primary : AppTheme.textSecondary),
                ),
              )).toList(),
            ),
          ),

          const SizedBox(height: 8),

          // List
          Expanded(
            child: _loading
              ? const Center(child: CircularProgressIndicator(color: AppTheme.primary))
              : _error.isNotEmpty
                ? Center(child: Text(_error, style: const TextStyle(color: Colors.red)))
                : filtered.isEmpty
                  ? const Center(child: Text('No certificates found.', style: TextStyle(color: AppTheme.textSecondary)))
                  : RefreshIndicator(
                      onRefresh: _loadCertificates,
                      child: ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: filtered.length,
                        itemBuilder: (_, i) {
                          final cert = filtered[i];
                          final status = cert['status'] as String? ?? 'pending';
                          final statusColor = _statusColor(status);
                          return Container(
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppTheme.surface,
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(color: AppTheme.border),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Expanded(
                                      child: Text(cert['type'] as String? ?? '', style: const TextStyle(color: AppTheme.textPrimary, fontWeight: FontWeight.w600, fontSize: 15)),
                                    ),
                                    Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                                      decoration: BoxDecoration(color: statusColor.withOpacity(0.15), borderRadius: BorderRadius.circular(12)),
                                      child: Text(status.toUpperCase(), style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 4),
                                Text(cert['issuer'] as String? ?? '', style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
                                const SizedBox(height: 8),
                                Row(
                                  children: [
                                    _dateChip('Issued', cert['issuedAt'] as String?),
                                    const SizedBox(width: 16),
                                    _dateChip('Expires', cert['expiresAt'] as String?, isExpired: status == 'expired'),
                                  ],
                                ),
                                if (status == 'active') ...[
                                  const SizedBox(height: 8),
                                  Row(
                                    children: [
                                      if (cert['downloadUrl'] != null)
                                        OutlinedButton.icon(
                                          onPressed: () {},
                                          icon: const Icon(Icons.download, size: 14),
                                          label: const Text('Download'),
                                          style: OutlinedButton.styleFrom(foregroundColor: AppTheme.primary, side: const BorderSide(color: AppTheme.primary)),
                                        ),
                                      const SizedBox(width: 8),
                                      OutlinedButton.icon(
                                        onPressed: () => showDialog(
                                          context: context,
                                          builder: (_) => AlertDialog(
                                            backgroundColor: AppTheme.surface,
                                            title: const Text('Revoke Certificate', style: TextStyle(color: AppTheme.textPrimary)),
                                            content: const Text('Are you sure you want to revoke this certificate?', style: TextStyle(color: AppTheme.textSecondary)),
                                            actions: [
                                              TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
                                              TextButton(
                                                onPressed: () { Navigator.pop(context); _revoke(cert['id'] as int); },
                                                child: const Text('Revoke', style: TextStyle(color: Colors.red)),
                                              ),
                                            ],
                                          ),
                                        ),
                                        icon: const Icon(Icons.cancel, size: 14),
                                        label: const Text('Revoke'),
                                        style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Colors.red)),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                          );
                        },
                      ),
                    ),
          ),
        ],
      ),
    );
  }

  Widget _dateChip(String label, String? dateStr, {bool isExpired = false}) {
    final date = dateStr != null ? DateTime.tryParse(dateStr) : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 10)),
        Text(
          date != null ? '${date.day}/${date.month}/${date.year}' : '—',
          style: TextStyle(color: isExpired ? Colors.red : AppTheme.textPrimary, fontSize: 12, fontWeight: FontWeight.w500),
        ),
      ],
    );
  }
}
