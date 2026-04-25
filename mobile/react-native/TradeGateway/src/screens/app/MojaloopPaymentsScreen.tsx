/// TradeGateway™ NGSWTP — React Native Mojaloop Payments Screen
import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, RefreshControl,
  SafeAreaView, Modal,
} from "react-native";
import { useApiClient } from "../../hooks/useApiClient";

interface Payment {
  id: number;
  reference: string;
  amount: number;
  currency: string;
  status: "pending" | "processing" | "completed" | "failed";
  payerFsp: string;
  payeeFsp: string;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "#10B981",
  pending: "#F59E0B",
  processing: "#3B82F6",
  failed: "#EF4444",
};

export default function MojaloopPaymentsScreen() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payerFsp, setPayerFsp] = useState("");
  const [payeeFsp, setPayeeFsp] = useState("CUSTOMS-AUTHORITY-NG");
  const [currency, setCurrency] = useState("NGN");
  const [submitting, setSubmitting] = useState(false);
  const { get, post } = useApiClient();

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const data = await get("/api/trpc/payments.listAll?input=%7B%22json%22%3Anull%7D");
      setPayments(data?.result?.data?.json ?? []);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const initiatePayment = async () => {
    if (!amount || !reference || !payerFsp) {
      Alert.alert("Validation", "Please fill in all required fields.");
      return;
    }
    setSubmitting(true);
    try {
      await post("/api/trpc/payments.initiate", {
        json: { amount: parseFloat(amount), currency, reference, payerFsp, payeeFsp },
      });
      setShowModal(false);
      setAmount(""); setReference(""); setPayerFsp("");
      load();
      Alert.alert("Success", "Payment transfer initiated via Mojaloop!");
    } catch {
      Alert.alert("Error", "Failed to initiate payment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderItem = ({ item }: { item: Payment }) => (
    <View style={[styles.card, { borderLeftColor: STATUS_COLORS[item.status] ?? "#6B7280" }]}>
      <View style={styles.cardRow}>
        <Text style={styles.ref}>{item.reference}</Text>
        <View style={[styles.badge, { backgroundColor: (STATUS_COLORS[item.status] ?? "#6B7280") + "33" }]}>
          <Text style={[styles.badgeText, { color: STATUS_COLORS[item.status] ?? "#6B7280" }]}>
            {item.status.toUpperCase()}
          </Text>
        </View>
      </View>
      <Text style={styles.amount}>{item.currency} {item.amount.toLocaleString()}</Text>
      <Text style={styles.meta}>{item.payerFsp} → {item.payeeFsp}</Text>
    </View>
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#D4A017" /></View>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mojaloop Payments</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowModal(true)}>
          <Text style={styles.addBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={payments}
        keyExtractor={item => item.id.toString()}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor="#D4A017" />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No payment transactions yet</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowModal(true)}>
              <Text style={styles.emptyBtnText}>Initiate First Transfer</Text>
            </TouchableOpacity>
          </View>
        }
      />

      {/* New Payment Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Mojaloop Transfer</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Amount" placeholderTextColor="#6B7280" keyboardType="numeric" />
            <TextInput style={styles.input} value={reference} onChangeText={setReference} placeholder="Declaration Reference" placeholderTextColor="#6B7280" />
            <TextInput style={styles.input} value={payerFsp} onChangeText={setPayerFsp} placeholder="Payer FSP ID" placeholderTextColor="#6B7280" />
            <TextInput style={styles.input} value={payeeFsp} onChangeText={setPayeeFsp} placeholder="Payee FSP ID" placeholderTextColor="#6B7280" />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, submitting && styles.disabledBtn]} onPress={initiatePayment} disabled={submitting}>
                {submitting ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.confirmBtnText}>Initiate</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A1628" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" },
  headerTitle: { color: "#FFFFFF", fontWeight: "700", fontSize: 18 },
  addBtn: { backgroundColor: "#D4A017", borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: "#000000", fontWeight: "700", fontSize: 14 },
  list: { padding: 16 },
  card: { backgroundColor: "#1E3A5F", borderRadius: 10, padding: 14, marginBottom: 10, borderLeftWidth: 3 },
  cardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  ref: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  amount: { color: "#D4A017", fontWeight: "700", fontSize: 16, marginBottom: 4 },
  meta: { color: "#9CA3AF", fontSize: 12 },
  empty: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#6B7280", marginBottom: 16 },
  emptyBtn: { backgroundColor: "#D4A017", borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  emptyBtnText: { color: "#000000", fontWeight: "700" },
  modalOverlay: { flex: 1, backgroundColor: "#00000080", justifyContent: "flex-end" },
  modal: { backgroundColor: "#1E3A5F", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { color: "#D4A017", fontWeight: "700", fontSize: 18, marginBottom: 16 },
  input: { backgroundColor: "#0A1628", color: "#FFFFFF", borderRadius: 8, padding: 12, marginBottom: 10, fontSize: 14 },
  modalBtns: { flexDirection: "row", gap: 10, marginTop: 8 },
  cancelBtn: { flex: 1, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  cancelBtnText: { color: "#9CA3AF", fontWeight: "600" },
  confirmBtn: { flex: 1, borderRadius: 8, padding: 14, backgroundColor: "#D4A017", alignItems: "center" },
  disabledBtn: { backgroundColor: "#4B5563" },
  confirmBtnText: { color: "#000000", fontWeight: "700" },
});
