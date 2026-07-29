/**
 * UCRScreen.tsx — Unique Consignment Reference Management (Mobile)
 *
 * TradeGateway NGSWTP — React Native screen for UCR management.
 * Allows traders to generate, view, and validate UCRs on mobile.
 */
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { trpc } from "../../services/trpc";

type UCRStatus = "CREATED" | "LINKED" | "ACTIVE" | "CLEARED" | "CLOSED" | "CANCELLED";

const STATUS_COLORS: Record<UCRStatus, { bg: string; text: string }> = {
  CREATED: { bg: "#DBEAFE", text: "#1D4ED8" },
  LINKED: { bg: "#EDE9FE", text: "#6D28D9" },
  ACTIVE: { bg: "#D1FAE5", text: "#065F46" },
  CLEARED: { bg: "#ECFDF5", text: "#047857" },
  CLOSED: { bg: "#F3F4F6", text: "#374151" },
  CANCELLED: { bg: "#FEE2E2", text: "#991B1B" },
};

const PORTS = [
  { code: "NGAPP", name: "Apapa Port, Lagos" },
  { code: "NGTIN", name: "Tin Can Island, Lagos" },
  { code: "NGKSI", name: "Onne Port, Rivers" },
  { code: "NGWAR", name: "Warri Port" },
  { code: "NGCAL", name: "Calabar Port" },
  { code: "NGLOS", name: "Lagos Airport" },
  { code: "NGABV", name: "Abuja Airport" },
  { code: "NGKNO", name: "Kano Airport" },
  { code: "NGPHC", name: "Port Harcourt Airport" },
];

export default function UCRScreen() {
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [ucrType, setUcrType] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [consigneeRef, setConsigneeRef] = useState("");
  const [portOfEntry, setPortOfEntry] = useState("NGAPP");
  const [validateInput, setValidateInput] = useState("");
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | null>(null);

  const { data: ucrList, refetch, isLoading } = trpc.ucr.listByTrader.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const generateMutation = trpc.ucr.generate.useMutation({
    onSuccess: (data) => {
      Alert.alert("UCR Generated", `UCR Number: ${(data as { ucrNumber?: string }).ucrNumber}`);
      setIsGenerateOpen(false);
      setConsigneeRef("");
      refetch();
    },
    onError: (err) => {
      Alert.alert("Error", err.message);
    },
  });

  const validateQuery = trpc.ucr.validate.useQuery(
    { ucrNumber: validateInput },
    { enabled: false }
  );

  const handleGenerate = () => {
    if (!consigneeRef || !portOfEntry) {
      Alert.alert("Validation Error", "Please fill all required fields");
      return;
    }
    generateMutation.mutate({ ucrType, consigneeRef, portOfEntry });
  };

  const handleValidate = async () => {
    if (!validateInput) return;
    const result = await validateQuery.refetch();
    setValidationResult(result.data as Record<string, unknown> ?? null);
  };

  const ucrs = (ucrList as { ucrs?: Record<string, unknown>[] } | undefined)?.ucrs ?? [];

  const renderUCR = ({ item }: { item: Record<string, unknown> }) => {
    const status = String(item.status) as UCRStatus;
    const colors = STATUS_COLORS[status] ?? STATUS_COLORS.CREATED;

    return (
      <View style={styles.ucrCard}>
        <View style={styles.ucrHeader}>
          <Text style={styles.ucrNumber}>{String(item.ucrNumber)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: colors.bg }]}>
            <Text style={[styles.statusText, { color: colors.text }]}>{status}</Text>
          </View>
        </View>
        <View style={styles.ucrDetails}>
          <Text style={styles.ucrDetail}>Type: {String(item.ucrType)}</Text>
          <Text style={styles.ucrDetail}>Port: {String(item.portOfEntry)}</Text>
          <Text style={styles.ucrDetail}>Ref: {String(item.consigneeRef)}</Text>
          <Text style={styles.ucrDate}>
            {new Date(String(item.createdAt)).toLocaleDateString()}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>UCR Management</Text>
        <Text style={styles.subtitle}>Unique Consignment References</Text>
      </View>

      {/* Validate UCR */}
      <View style={styles.validateSection}>
        <Text style={styles.sectionTitle}>Validate UCR</Text>
        <View style={styles.validateRow}>
          <TextInput
            style={styles.validateInput}
            placeholder="Enter UCR number..."
            value={validateInput}
            onChangeText={setValidateInput}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.validateBtn} onPress={handleValidate}>
            <Text style={styles.validateBtnText}>Check</Text>
          </TouchableOpacity>
        </View>
        {validationResult && (
          <View style={[styles.validationResult, {
            backgroundColor: (validationResult as { valid?: boolean }).valid ? "#D1FAE5" : "#FEE2E2"
          }]}>
            <Text style={{ color: (validationResult as { valid?: boolean }).valid ? "#065F46" : "#991B1B", fontSize: 13 }}>
              {(validationResult as { valid?: boolean }).valid
                ? `✓ Valid — Status: ${String((validationResult as { status?: unknown }).status)}`
                : `✗ Invalid — ${String((validationResult as { reason?: unknown }).reason)}`}
            </Text>
          </View>
        )}
      </View>

      {/* UCR List */}
      <View style={styles.listHeader}>
        <Text style={styles.sectionTitle}>My UCRs ({ucrs.length})</Text>
        <TouchableOpacity
          style={styles.generateBtn}
          onPress={() => setIsGenerateOpen(true)}
        >
          <Text style={styles.generateBtnText}>+ Generate UCR</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={ucrs}
        renderItem={renderUCR}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No UCRs generated yet</Text>
            <Text style={styles.emptySubtext}>Generate your first UCR to start tracking a consignment</Text>
          </View>
        }
      />

      {/* Generate UCR Modal */}
      <Modal visible={isGenerateOpen} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Generate New UCR</Text>
            <TouchableOpacity onPress={() => setIsGenerateOpen(false)}>
              <Text style={styles.closeBtn}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalContent}>
            <Text style={styles.fieldLabel}>UCR Type</Text>
            <View style={styles.typeSelector}>
              {(["SINGLE", "MULTIPLE"] as const).map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[styles.typeOption, ucrType === type && styles.typeOptionActive]}
                  onPress={() => setUcrType(type)}
                >
                  <Text style={[styles.typeOptionText, ucrType === type && styles.typeOptionTextActive]}>
                    {type}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Consignee Reference *</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. PO-2026-001234"
              value={consigneeRef}
              onChangeText={setConsigneeRef}
            />

            <Text style={styles.fieldLabel}>Port of Entry *</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.portScroll}>
              {PORTS.map((port) => (
                <TouchableOpacity
                  key={port.code}
                  style={[styles.portOption, portOfEntry === port.code && styles.portOptionActive]}
                  onPress={() => setPortOfEntry(port.code)}
                >
                  <Text style={[styles.portCode, portOfEntry === port.code && styles.portCodeActive]}>
                    {port.code}
                  </Text>
                  <Text style={[styles.portName, portOfEntry === port.code && styles.portNameActive]}>
                    {port.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              style={[styles.submitBtn, generateMutation.isPending && styles.submitBtnDisabled]}
              onPress={handleGenerate}
              disabled={generateMutation.isPending}
            >
              {generateMutation.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Generate UCR</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  header: { padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  title: { fontSize: 20, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  validateSection: { margin: 16, padding: 14, backgroundColor: "#fff", borderRadius: 12, elevation: 1 },
  sectionTitle: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 10 },
  validateRow: { flexDirection: "row", gap: 8 },
  validateInput: { flex: 1, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  validateBtn: { backgroundColor: "#1D4ED8", borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, justifyContent: "center" },
  validateBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  validationResult: { marginTop: 8, padding: 10, borderRadius: 8 },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
  generateBtn: { backgroundColor: "#166534", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  generateBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  listContent: { paddingHorizontal: 16, paddingBottom: 20 },
  ucrCard: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 10, elevation: 1 },
  ucrHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  ucrNumber: { fontSize: 14, fontWeight: "700", color: "#111827", fontFamily: "monospace" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: "600" },
  ucrDetails: { gap: 3 },
  ucrDetail: { fontSize: 13, color: "#6B7280" },
  ucrDate: { fontSize: 12, color: "#9CA3AF", marginTop: 4 },
  emptyState: { alignItems: "center", paddingVertical: 40 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#6B7280" },
  emptySubtext: { fontSize: 13, color: "#9CA3AF", textAlign: "center", marginTop: 6 },
  // Modal
  modalContainer: { flex: 1, backgroundColor: "#fff" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  modalTitle: { fontSize: 18, fontWeight: "700", color: "#111827" },
  closeBtn: { fontSize: 20, color: "#6B7280" },
  modalContent: { padding: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 14 },
  typeSelector: { flexDirection: "row", gap: 10 },
  typeOption: { flex: 1, padding: 12, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, alignItems: "center" },
  typeOptionActive: { borderColor: "#166534", backgroundColor: "#F0FDF4" },
  typeOptionText: { fontSize: 14, color: "#6B7280" },
  typeOptionTextActive: { color: "#166534", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  portScroll: { marginBottom: 8 },
  portOption: { marginRight: 8, padding: 10, borderWidth: 1, borderColor: "#D1D5DB", borderRadius: 8, minWidth: 120 },
  portOptionActive: { borderColor: "#166534", backgroundColor: "#F0FDF4" },
  portCode: { fontSize: 13, fontWeight: "700", color: "#374151" },
  portCodeActive: { color: "#166534" },
  portName: { fontSize: 11, color: "#6B7280", marginTop: 2 },
  portNameActive: { color: "#166534" },
  submitBtn: { backgroundColor: "#166534", borderRadius: 10, padding: 14, alignItems: "center", marginTop: 24, marginBottom: 20 },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
