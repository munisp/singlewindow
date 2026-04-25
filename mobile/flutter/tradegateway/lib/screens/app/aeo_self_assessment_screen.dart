/// TradeGateway™ NGSWTP — Flutter AEO Self-Assessment Screen
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class AeoSelfAssessmentScreen extends StatefulWidget {
  const AeoSelfAssessmentScreen({super.key});
  @override
  State<AeoSelfAssessmentScreen> createState() => _AeoSelfAssessmentScreenState();
}

class _AeoSelfAssessmentScreenState extends State<AeoSelfAssessmentScreen> {
  bool _loading = true;
  Map<String, dynamic>? _assessment;
  String? _error;
  bool _submitting = false;

  // Form fields
  final _formKey = GlobalKey<FormState>();
  final _companyNameCtrl = TextEditingController();
  final _registrationNoCtrl = TextEditingController();
  final _applicantNameCtrl = TextEditingController();
  int _currentSection = 0;
  final Map<String, bool> _answers = {};

  final List<Map<String, dynamic>> _sections = [
    {
      "title": "Customs Compliance",
      "icon": Icons.verified_user,
      "questions": [
        {"id": "q1", "text": "Has your company maintained a satisfactory customs compliance record for the past 3 years?"},
        {"id": "q2", "text": "Does your company have documented customs compliance procedures?"},
        {"id": "q3", "text": "Has your company undergone a customs audit in the past 3 years?"},
      ]
    },
    {
      "title": "Financial Solvency",
      "icon": Icons.account_balance,
      "questions": [
        {"id": "q4", "text": "Is your company financially solvent with no outstanding customs debts?"},
        {"id": "q5", "text": "Does your company maintain audited financial statements?"},
        {"id": "q6", "text": "Does your company have adequate insurance coverage for trade activities?"},
      ]
    },
    {
      "title": "Security Standards",
      "icon": Icons.security,
      "questions": [
        {"id": "q7", "text": "Does your company have documented security procedures for cargo handling?"},
        {"id": "q8", "text": "Are your premises secured with access control systems?"},
        {"id": "q9", "text": "Does your company conduct background checks on employees with access to cargo?"},
        {"id": "q10", "text": "Does your company have a documented business continuity plan?"},
      ]
    },
    {
      "title": "Record Keeping",
      "icon": Icons.folder_open,
      "questions": [
        {"id": "q11", "text": "Does your company maintain accurate and accessible customs records for at least 5 years?"},
        {"id": "q12", "text": "Are your records available for customs inspection at any time?"},
        {"id": "q13", "text": "Does your company use a certified customs software system?"},
      ]
    },
  ];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      setState(() { _loading = true; _error = null; });
      final data = await ApiService().get("/api/trpc/aeo.getSelfAssessment?input=%7B%22json%22%3Anull%7D");
      setState(() {
        _assessment = data["result"]?["data"]?["json"];
        _loading = false;
      });
    } catch (e) {
      setState(() { _loading = false; _error = null; }); // Not an error — just no existing assessment
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() => _submitting = true);
    try {
      await ApiService().post("/api/trpc/aeo.submitSelfAssessment", {
        "json": {
          "companyName": _companyNameCtrl.text,
          "registrationNo": _registrationNoCtrl.text,
          "applicantName": _applicantNameCtrl.text,
          "answers": _answers,
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("AEO self-assessment submitted successfully!"), backgroundColor: Color(0xFF10B981)),
        );
        _load();
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Error: ${e.toString()}"), backgroundColor: const Color(0xFFEF4444)),
        );
      }
    } finally {
      setState(() => _submitting = false);
    }
  }

  int get _score {
    final yesCount = _answers.values.where((v) => v).length;
    final total = _sections.fold<int>(0, (sum, s) => sum + (s["questions"] as List).length);
    return total == 0 ? 0 : ((yesCount / total) * 100).round();
  }

  @override
  void dispose() {
    _companyNameCtrl.dispose();
    _registrationNoCtrl.dispose();
    _applicantNameCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("AEO Self-Assessment", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Color(0xFFD4A017)))
          : _assessment != null
              ? _buildExistingAssessment()
              : _buildForm(),
    );
  }

  Widget _buildExistingAssessment() {
    final status = _assessment!["status"] ?? "pending";
    final score = _assessment!["score"] ?? 0;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: const Color(0xFF1E3A5F),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              children: [
                const Icon(Icons.assignment_turned_in, color: Color(0xFFD4A017), size: 48),
                const SizedBox(height: 12),
                const Text("Assessment Submitted", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                const SizedBox(height: 8),
                _StatusBadge(status: status),
                const SizedBox(height: 16),
                Text("Score: $score%", style: const TextStyle(color: Color(0xFFD4A017), fontSize: 24, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: score / 100,
                  backgroundColor: const Color(0xFF374151),
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFD4A017)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => setState(() { _assessment = null; }),
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF1E3A5F), minimumSize: const Size.fromHeight(48)),
            child: const Text("Start New Assessment", style: TextStyle(color: Color(0xFFD4A017))),
          ),
        ],
      ),
    );
  }

  Widget _buildForm() {
    final section = _sections[_currentSection];
    final questions = section["questions"] as List<Map<String, dynamic>>;
    return Form(
      key: _formKey,
      child: Column(
        children: [
          // Progress indicator
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            color: const Color(0xFF1E3A5F),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text("Section ${_currentSection + 1} of ${_sections.length}", style: const TextStyle(color: Color(0xFF9CA3AF), fontSize: 12)),
                    Text("Score: $_score%", style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 8),
                LinearProgressIndicator(
                  value: (_currentSection + 1) / _sections.length,
                  backgroundColor: const Color(0xFF374151),
                  valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFFD4A017)),
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Company info (only on first section)
                  if (_currentSection == 0) ...[
                    const Text("Company Information", style: TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 12),
                    _buildTextField(_companyNameCtrl, "Company Name", required: true),
                    const SizedBox(height: 8),
                    _buildTextField(_registrationNoCtrl, "Registration Number", required: true),
                    const SizedBox(height: 8),
                    _buildTextField(_applicantNameCtrl, "Applicant Name", required: true),
                    const SizedBox(height: 20),
                  ],
                  // Section header
                  Row(
                    children: [
                      Icon(section["icon"] as IconData, color: const Color(0xFFD4A017), size: 20),
                      const SizedBox(width: 8),
                      Text(section["title"] as String, style: const TextStyle(color: Color(0xFFD4A017), fontWeight: FontWeight.bold, fontSize: 16)),
                    ],
                  ),
                  const SizedBox(height: 12),
                  // Questions
                  ...questions.map((q) => _buildQuestion(q["id"] as String, q["text"] as String)),
                ],
              ),
            ),
          ),
          // Navigation buttons
          Container(
            padding: const EdgeInsets.all(16),
            color: const Color(0xFF1E3A5F),
            child: Row(
              children: [
                if (_currentSection > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => setState(() => _currentSection--),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFD4A017)),
                        minimumSize: const Size.fromHeight(48),
                      ),
                      child: const Text("Previous", style: TextStyle(color: Color(0xFFD4A017))),
                    ),
                  ),
                if (_currentSection > 0) const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _submitting ? null : () {
                      if (_currentSection < _sections.length - 1) {
                        setState(() => _currentSection++);
                      } else {
                        _submit();
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: const Color(0xFFD4A017),
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: _submitting
                        ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                        : Text(
                            _currentSection < _sections.length - 1 ? "Next" : "Submit Assessment",
                            style: const TextStyle(color: Colors.black, fontWeight: FontWeight.bold),
                          ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(TextEditingController ctrl, String label, {bool required = false}) {
    return TextFormField(
      controller: ctrl,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(color: Color(0xFF9CA3AF)),
        filled: true,
        fillColor: const Color(0xFF1E3A5F),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: const BorderSide(color: Color(0xFFD4A017))),
      ),
      validator: required ? (v) => (v == null || v.isEmpty) ? "$label is required" : null : null,
    );
  }

  Widget _buildQuestion(String id, String text) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF1E3A5F),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: (_answers[id] == true ? const Color(0xFF10B981) : const Color(0xFF374151))),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(text, style: const TextStyle(color: Colors.white, fontSize: 14)),
          const SizedBox(height: 8),
          Row(
            children: [
              _AnswerButton(label: "Yes", selected: _answers[id] == true, color: const Color(0xFF10B981), onTap: () => setState(() => _answers[id] = true)),
              const SizedBox(width: 8),
              _AnswerButton(label: "No", selected: _answers[id] == false, color: const Color(0xFFEF4444), onTap: () => setState(() => _answers[id] = false)),
            ],
          ),
        ],
      ),
    );
  }
}

class _AnswerButton extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _AnswerButton({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? color : Colors.transparent,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: selected ? color : const Color(0xFF4B5563)),
        ),
        child: Text(label, style: TextStyle(color: selected ? Colors.white : const Color(0xFF9CA3AF), fontWeight: FontWeight.w600)),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final colors = {
      "approved": const Color(0xFF10B981),
      "pending": const Color(0xFFF59E0B),
      "rejected": const Color(0xFFEF4444),
      "under_review": const Color(0xFF3B82F6),
    };
    final color = colors[status] ?? const Color(0xFF6B7280);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(color: color.withOpacity(0.2), borderRadius: BorderRadius.circular(20), border: Border.all(color: color)),
      child: Text(status.toUpperCase().replaceAll("_", " "), style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 12)),
    );
  }
}
