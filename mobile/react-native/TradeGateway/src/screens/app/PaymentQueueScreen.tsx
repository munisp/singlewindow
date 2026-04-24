/**
 * TradeGateway™ NGSWTP — React Native Payment Queue Screen
 * Parity with PWA PaymentQueue page. Uses trpc.payments procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity, Alert,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function PaymentQueueScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.payments.listAll.useQuery({ status: "pending", limit: 50 });
  const { data: stats } = trpc.payments.getStats.useQuery();
  const processMutation = trpc.payments.processPayment.useMutation({
    onSuccess: () => {
      Alert.alert("Success", "Payment processed successfully.");
      utils.payments.listAll.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const payments = data?.items ?? [];

  const handleProcess = (paymentId: number) => {
    Alert.alert(
      "Process Payment",
      "Confirm processing this payment?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Process", onPress: () => processMutation.mutate({ paymentId }) },
      ]
    );
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Payment Queue</Text>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Pending</Text>
            <Text style={[styles.cardValue, { color: "#D97706" }]}>{stats.pendingCount ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Pending Value</Text>
            <Text style={styles.cardValue}>
              {stats.pendingAmount ? `$${(stats.pendingAmount / 1000).toFixed(0)}K` : "—"}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Processed Today</Text>
            <Text style={[styles.cardValue, { color: "#059669" }]}>{stats.processedToday ?? 0}</Text>
          </View>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : payments.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No pending payments in queue</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {payments.map((p: any) => (
            <View key={p.id} style={styles.paymentCard}>
              <View style={styles.paymentHeader}>
                <Text style={styles.paymentRef}>{p.referenceNumber ?? `PAY-${p.id}`}</Text>
                <Text style={styles.paymentAmount}>${Number(p.amount ?? 0).toLocaleString()}</Text>
              </View>
              <Text style={styles.paymentMeta}>Declaration: {p.declarationRef ?? "—"}</Text>
              <Text style={styles.paymentMeta}>Trader: {p.traderName ?? "—"}</Text>
              <View style={styles.paymentFooter}>
                <Text style={styles.paymentDate}>
                  Due: {p.dueDate ? new Date(p.dueDate).toLocaleDateString() : "—"}
                </Text>
                <TouchableOpacity
                  style={[styles.processBtn, processMutation.isPending && { opacity: 0.6 }]}
                  onPress={() => handleProcess(p.id)}
                  disabled={processMutation.isPending}
                >
                  <Text style={styles.processBtnText}>Process</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", padding: 16 },
  cardRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  card: { flex: 1, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 10 },
  cardLabel: { color: "#9CA3AF", fontSize: 10, marginBottom: 2 },
  cardValue: { color: "#D4A017", fontSize: 18, fontWeight: "700" },
  empty: { alignItems: "center", padding: 40 },
  emptyText: { color: "#9CA3AF", fontSize: 14 },
  list: { paddingHorizontal: 16, gap: 10 },
  paymentCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  paymentHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  paymentRef: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  paymentAmount: { color: "#D4A017", fontSize: 16, fontWeight: "700" },
  paymentMeta: { color: "#9CA3AF", fontSize: 12, marginBottom: 2 },
  paymentFooter: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 },
  paymentDate: { color: "#9CA3AF", fontSize: 12 },
  processBtn: { backgroundColor: "#D4A017", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  processBtnText: { color: "#0A1628", fontSize: 12, fontWeight: "700" },
});
