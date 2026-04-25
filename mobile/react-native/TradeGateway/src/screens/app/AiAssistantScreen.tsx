/// TradeGateway™ NGSWTP — React Native AI Assistant Screen
import React, { useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { useApiClient } from "../../hooks/useApiClient";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What is the HS code for mobile phones?",
  "What are import duty rates for electronics?",
  "What documents are required for food imports?",
  "How do I apply for AEO status?",
];

export default function AiAssistantScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const { post } = useApiClient();

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;
    const userMsg: Message = { id: Date.now().toString(), role: "user", content };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setSending(true);
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    try {
      const res = await post("/api/trpc/ai.chat", { json: { message: content, context: "trade_customs" } });
      const reply = res?.result?.data?.json?.reply ?? "I can help with trade and customs queries.";
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: reply }]);
    } catch {
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setSending(false);
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [input, post]);

  const renderMessage = ({ item }: { item: Message }) => (
    <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.aiBubble]}>
      <Text style={[styles.bubbleText, item.role === "user" ? styles.userText : styles.aiText]}>
        {item.content}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>AI Trade Assistant</Text>
        <TouchableOpacity onPress={() => setMessages([])}>
          <Text style={styles.clearBtn}>Clear</Text>
        </TouchableOpacity>
      </View>

      {messages.length === 0 && (
        <View style={styles.welcome}>
          <Text style={styles.welcomeTitle}>TradeGateway AI</Text>
          <Text style={styles.welcomeSubtitle}>
            Ask about HS codes, customs regulations, duty rates, and trade compliance.
          </Text>
          <View style={styles.suggestions}>
            {SUGGESTIONS.map((s, i) => (
              <TouchableOpacity key={i} style={styles.chip} onPress={() => sendMessage(s)}>
                <Text style={styles.chipText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
      />

      {sending && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color="#D4A017" />
          <Text style={styles.typingText}>  Thinking…</Text>
        </View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="Ask about HS codes, regulations…"
            placeholderTextColor="#6B7280"
            onSubmitEditing={() => sendMessage()}
            returnKeyType="send"
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, (sending || !input.trim()) && styles.sendBtnDisabled]}
            onPress={() => sendMessage()}
            disabled={sending || !input.trim()}
          >
            <Text style={styles.sendBtnText}>↑</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" },
  headerTitle: { color: "#FFFFFF", fontWeight: "700", fontSize: 18 },
  clearBtn: { color: "#D4A017", fontSize: 14 },
  welcome: { padding: 20, alignItems: "center" },
  welcomeTitle: { color: "#D4A017", fontWeight: "700", fontSize: 20, marginBottom: 8 },
  welcomeSubtitle: { color: "#9CA3AF", textAlign: "center", fontSize: 14, marginBottom: 16 },
  suggestions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  chip: { backgroundColor: "#1E3A5F", borderWidth: 1, borderColor: "#D4A01780", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, margin: 4 },
  chipText: { color: "#D4A017", fontSize: 12 },
  messageList: { padding: 16, flexGrow: 1 },
  bubble: { maxWidth: "80%", borderRadius: 16, padding: 12, marginBottom: 8 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#D4A017" },
  aiBubble: { alignSelf: "flex-start", backgroundColor: "#1E3A5F" },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  userText: { color: "#000000" },
  aiText: { color: "#FFFFFF" },
  typingRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  typingText: { color: "#9CA3AF", fontSize: 13 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", padding: 12, backgroundColor: "#1E3A5F", borderTopWidth: 1, borderTopColor: "#D4A01730" },
  input: { flex: 1, color: "#FFFFFF", backgroundColor: "#0A1628", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, maxHeight: 100, fontSize: 14 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#D4A017", justifyContent: "center", alignItems: "center", marginLeft: 8 },
  sendBtnDisabled: { backgroundColor: "#4B5563" },
  sendBtnText: { color: "#000000", fontWeight: "700", fontSize: 18 },
});
