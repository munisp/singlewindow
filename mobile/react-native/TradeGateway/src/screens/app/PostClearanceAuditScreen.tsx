/**
 * TradeGateway™ NGSWTP — React Native Post-Clearance Audit Screen
 * Parity with PWA PostClearanceAudit page. Uses trpc.postClearanceAudit procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

const RISK_COLORS: Record<string, string> = {
  low: "#059669",
  medium: "#D97706",
  high: "#DC2626",
  critical: "#7C3AED",
};

export default function PostClearanceAuditScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "scheduled" | "in_progress" | "completed">("all");
  const { data, isLoading, refetch } = trpc.postClearanceAudit.list.useQuery({ status: filter === "all" ? undefined : filter, limit: 50 });
  const { data: stats } = trpc.postClearanceAudit.getStats.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const audits = data?.items ?? [];
  const FILTERS: Array<typeof filter> = ["all", "scheduled", "in_progress", "completed"];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Post-Clearance Audit</Text>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Total Audits</Text>
            <Text style={styles.cardValue}>{stats.total ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>In Progress</Text>
            <Text style={[styles.cardValue, { color: "#D97706" }]}>{stats.inProgress ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Completed</Text>
            <Text style={[styles.cardValue, { color: "#059669" }]}>{stats.completed ?? 0}</Text>
          </View>
        </View>
      )}

      {/* Filter Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : audits.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No audits found</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {audits.map((a: any) => (
            <View key={a.id} style={styles.auditCard}>
              <View style={styles.auditHeader}>
                <Text style={styles.auditRef}>{a.auditNumber ?? `AUD-${a.id}`}</Text>
                <View style={[styles.riskBadge, { backgroundColor: (RISK_COLORS[a.riskLevel] ?? "#6B7280") + "20" }]}>
                  <Text style={[styles.riskText, { color: RISK_COLORS[a.riskLevel] ?? "#9CA3AF" }]}>
                    {a.riskLevel?.toUpperCase() ?? "—"}
                  </Text>
                </View>
              </View>
              <Text style={styles.auditTrader}>{a.traderName ?? "Unknown Trader"}</Text>
              <Text style={styles.auditMeta}>Declaration: {a.declarationRef ?? "—"}</Text>
              <View style={styles.auditFooter}>
                <Text style={styles.auditDate}>
                  {a.scheduledDate ? new Date(a.scheduledDate).toLocaleDateString() : "—"}
                </Text>
                <Text style={[styles.auditStatus, { color: a.status === "completed" ? "#059669" : "#D97706" }]}>
                  {a.status?.replace(/_/g, " ").toUpperCase()}
                </Text>
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
  cardRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 12 },
  card: { flex: 1, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 10 },
  cardLabel: { color: "#9CA3AF", fontSize: 10, marginBottom: 2 },
  cardValue: { color: "#D4A017", fontSize: 18, fontWeight: "700" },
  filterBar: { marginBottom: 12 },
  filterTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#1E3A5F" },
  filterTabActive: { backgroundColor: "#D4A017" },
  filterTabText: { color: "#9CA3AF", fontSize: 12 },
  filterTabTextActive: { color: "#0A1628", fontWeight: "700" },
  empty: { alignItems: "center", padding: 40 },
  emptyText: { color: "#9CA3AF", fontSize: 14 },
  list: { paddingHorizontal: 16, gap: 10 },
  auditCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  auditHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  auditRef: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" },
  riskBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  riskText: { fontSize: 10, fontWeight: "700" },
  auditTrader: { color: "#D4A017", fontSize: 13, marginBottom: 2 },
  auditMeta: { color: "#9CA3AF", fontSize: 12, marginBottom: 6 },
  auditFooter: { flexDirection: "row", justifyContent: "space-between" },
  auditDate: { color: "#9CA3AF", fontSize: 12 },
  auditStatus: { fontSize: 11, fontWeight: "700" },
});
