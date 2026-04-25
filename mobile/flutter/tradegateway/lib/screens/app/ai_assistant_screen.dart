/// TradeGateway™ NGSWTP — Flutter AI Assistant Screen
library;
import "package:flutter/material.dart";
import "../../services/api_service.dart";

class AiAssistantScreen extends StatefulWidget {
  const AiAssistantScreen({super.key});
  @override
  State<AiAssistantScreen> createState() => _AiAssistantScreenState();
}

class _AiAssistantScreenState extends State<AiAssistantScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, String>> _messages = [];
  bool _sending = false;

  Future<void> _sendMessage() async {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    setState(() {
      _messages.add({"role": "user", "content": text});
      _sending = true;
    });
    _controller.clear();
    _scrollToBottom();
    try {
      final response = await ApiService().post("/api/trpc/ai.chat", {
        "json": {"message": text, "context": "trade_customs"}
      });
      final reply = response["result"]?["data"]?["json"]?["reply"] ?? "I'm here to help with trade and customs queries.";
      setState(() {
        _messages.add({"role": "assistant", "content": reply.toString()});
        _sending = false;
      });
    } catch (e) {
      setState(() {
        _messages.add({"role": "assistant", "content": "Sorry, I encountered an error. Please try again."});
        _sending = false;
      });
    }
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0A1628),
      appBar: AppBar(
        title: const Text("AI Trade Assistant", style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
        backgroundColor: const Color(0xFF0A1628),
        iconTheme: const IconThemeData(color: Color(0xFFD4A017)),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete_outline),
            onPressed: () => setState(() => _messages.clear()),
            tooltip: "Clear chat",
          ),
        ],
      ),
      body: Column(
        children: [
          // Welcome banner
          if (_messages.isEmpty)
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: const Color(0xFF1E3A5F),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.3)),
              ),
              child: Column(
                children: [
                  const Icon(Icons.smart_toy_outlined, color: Color(0xFFD4A017), size: 40),
                  const SizedBox(height: 8),
                  const Text("TradeGateway AI Assistant", style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                  const SizedBox(height: 4),
                  const Text("Ask about HS codes, customs regulations, duty rates, documentation requirements, and trade compliance.",
                      style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 13), textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      _SuggestionChip(label: "HS Code lookup", onTap: () { _controller.text = "What is the HS code for mobile phones?"; }),
                      _SuggestionChip(label: "Duty rates", onTap: () { _controller.text = "What are the import duty rates for electronics?"; }),
                      _SuggestionChip(label: "Required documents", onTap: () { _controller.text = "What documents are required for food imports?"; }),
                    ],
                  ),
                ],
              ),
            ),
          // Messages
          Expanded(
            child: ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              itemCount: _messages.length + (_sending ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == _messages.length && _sending) {
                  return _TypingIndicator();
                }
                final msg = _messages[index];
                final isUser = msg["role"] == "user";
                return _ChatBubble(message: msg["content"] ?? "", isUser: isUser);
              },
            ),
          ),
          // Input bar
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF1E3A5F),
              border: Border(top: BorderSide(color: const Color(0xFFD4A017).withOpacity(0.2))),
            ),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      hintText: "Ask about HS codes, regulations, duties…",
                      hintStyle: const TextStyle(color: Color(0xFF6B7280)),
                      filled: true,
                      fillColor: const Color(0xFF0A1628),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(24),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    ),
                    onSubmitted: (_) => _sendMessage(),
                    textInputAction: TextInputAction.send,
                  ),
                ),
                const SizedBox(width: 8),
                GestureDetector(
                  onTap: _sending ? null : _sendMessage,
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: _sending ? const Color(0xFF6B7280) : const Color(0xFFD4A017),
                      shape: BoxShape.circle,
                    ),
                    child: _sending
                        ? const Padding(padding: EdgeInsets.all(10), child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.send, color: Colors.white, size: 20),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ChatBubble extends StatelessWidget {
  final String message;
  final bool isUser;
  const _ChatBubble({required this.message, required this.isUser});

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFFD4A017) : const Color(0xFF1E3A5F),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Text(message, style: TextStyle(color: isUser ? Colors.black : Colors.white, fontSize: 14)),
      ),
    );
  }
}

class _TypingIndicator extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: const Color(0xFF1E3A5F),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(width: 4, height: 8, child: DecoratedBox(decoration: BoxDecoration(color: Color(0xFFD4A017), shape: BoxShape.circle))),
            SizedBox(width: 4),
            SizedBox(width: 4, height: 8, child: DecoratedBox(decoration: BoxDecoration(color: Color(0xFFD4A017), shape: BoxShape.circle))),
            SizedBox(width: 4),
            SizedBox(width: 4, height: 8, child: DecoratedBox(decoration: BoxDecoration(color: Color(0xFFD4A017), shape: BoxShape.circle))),
          ],
        ),
      ),
    );
  }
}

class _SuggestionChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _SuggestionChip({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: const Color(0xFF0A1628),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: const Color(0xFFD4A017).withOpacity(0.5)),
        ),
        child: Text(label, style: const TextStyle(color: Color(0xFFD4A017), fontSize: 12)),
      ),
    );
  }
}
