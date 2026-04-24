/**
 * TradeGateway™ NGSWTP — React Native Duty Drawback Screen
 * Parity with PWA DutyDrawback page. Uses trpc.dutyDrawback procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity, Alert,
} from "react-native";
import { trpc } from "../../services/trpc";

const STATUS_COLORS: Record<string, string> = {
  pending: "#D97706",
  approved: "#059669",
  rejected: "#DC2626",
  paid: "#2563EB",
  under_review: "#7C3AED",
};

export default function DutyDrawbackScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, refetch } = trpc.dutyDrawback.list.useQuery({ limit: 50 });
  const { data: stats } = trpc.dutyDrawback.getStats.useQuery();
  const submitMutation = trpc.dutyDrawback.submitClaim.useMutation({
    onSuccess: () => { Alert.alert("Success", "Drawback claim submitted successfully."); refetch(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const claims = data?.items ?? [];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Duty Drawback</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => Alert.alert("New Claim", "Use the web portal to submit a new drawback claim with supporting documents.")}
        >
          <Text style={styles.newBtnText}>+ New Claim</Text>
        </TouchableOpacity>
      </View>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Total Claims</Text>
            <Text style={styles.cardValue}>{stats.totalClaims ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Pending</Text>
            <Text style={[styles.cardValue, { color: "#D97706" }]}>{stats.pendingClaims ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Recovered (USD)</Text>
            <Text style={[styles.cardValue, { color: "#059669" }]}>
              {stats.totalRecovered ? `$${(stats.totalRecovered / 1000).toFixed(0)}K` : "—"}
            </Text>
          </View>
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : claims.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No drawback claims found</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {claims.map((c: any) => (
            <View key={c.id} style={styles.claimCard}>
              <View style={styles.claimHeader}>
                <Text style={styles.claimRef}>{c.referenceNumber ?? `CLM-${c.id}`}</Text>
                <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[c.status] ?? "#6B7280") + "20" }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[c.status] ?? "#9CA3AF" }]}>
                    {c.status?.replace(/_/g, " ").toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.claimMeta}>Declaration: {c.declarationRef ?? "—"}</Text>
              <View style={styles.claimFooter}>
                <Text style={styles.claimAmount}>
                  Claimed: ${Number(c.claimedAmount ?? 0).toLocaleString()}
                </Text>
                {c.approvedAmount && (
                  <Text style={[styles.claimAmount, { color: "#059669" }]}>
                    Approved: ${Number(c.approvedAmount).toLocaleString()}
                  </Text>
                )}
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
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700" },
  newBtn: { backgroundColor: "#D4A017", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  newBtnText: { color: "#0A1628", fontSize: 13, fontWeight: "700" },
  cardRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 16 },
  card: { flex: 1, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 10 },
  cardLabel: { color: "#9CA3AF", fontSize: 10, marginBottom: 2 },
  cardValue: { color: "#D4A017", fontSize: 18, fontWeight: "700" },
  empty: { alignItems: "center", padding: 40 },
  emptyText: { color: "#9CA3AF", fontSize: 14 },
  list: { paddingHorizontal: 16, gap: 10 },
  claimCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  claimHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  claimRef: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusText: { fontSize: 10, fontWeight: "700" },
  claimMeta: { color: "#9CA3AF", fontSize: 12, marginBottom: 6 },
  claimFooter: { flexDirection: "row", gap: 12 },
  claimAmount: { color: "#D4A017", fontSize: 13, fontWeight: "600" },
});
