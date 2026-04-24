/**
 * TradeGateway™ NGSWTP — React Native Security Alerts Screen
 * Parity with PWA SecurityAlerts page. Uses trpc.wazuh procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#DC2626",
  high: "#EA580C",
  medium: "#D97706",
  low: "#059669",
  info: "#2563EB",
};

export default function SecurityAlertsScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [severity, setSeverity] = useState<"all" | "critical" | "high" | "medium" | "low">("all");
  const { data, isLoading, refetch } = trpc.wazuh.getAlerts.useQuery({
    severity: severity === "all" ? undefined : severity,
    limit: 50,
  });
  const { data: stats } = trpc.wazuh.getStats.useQuery(undefined, { refetchInterval: 30_000 });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const alerts = data?.items ?? [];
  const SEVERITIES: Array<typeof severity> = ["all", "critical", "high", "medium", "low"];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Security Alerts</Text>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Critical</Text>
            <Text style={[styles.cardValue, { color: "#DC2626" }]}>{stats.critical ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>High</Text>
            <Text style={[styles.cardValue, { color: "#EA580C" }]}>{stats.high ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Medium</Text>
            <Text style={[styles.cardValue, { color: "#D97706" }]}>{stats.medium ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Low</Text>
            <Text style={[styles.cardValue, { color: "#059669" }]}>{stats.low ?? 0}</Text>
          </View>
        </View>
      )}

      {/* Severity Filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {SEVERITIES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.filterTab, severity === s && styles.filterTabActive]}
            onPress={() => setSeverity(s)}
          >
            <Text style={[styles.filterTabText, severity === s && styles.filterTabTextActive]}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : alerts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No security alerts</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {alerts.map((a: any) => (
            <View key={a.id} style={[styles.alertCard, { borderLeftColor: SEVERITY_COLORS[a.severity] ?? "#6B7280", borderLeftWidth: 3 }]}>
              <View style={styles.alertHeader}>
                <Text style={styles.alertRule}>{a.ruleName ?? a.ruleId ?? "Unknown Rule"}</Text>
                <View style={[styles.severityBadge, { backgroundColor: (SEVERITY_COLORS[a.severity] ?? "#6B7280") + "20" }]}>
                  <Text style={[styles.severityText, { color: SEVERITY_COLORS[a.severity] ?? "#9CA3AF" }]}>
                    {a.severity?.toUpperCase()}
                  </Text>
                </View>
              </View>
              <Text style={styles.alertDesc} numberOfLines={2}>{a.description ?? a.message ?? "—"}</Text>
              <View style={styles.alertFooter}>
                <Text style={styles.alertAgent}>{a.agentName ?? "—"}</Text>
                <Text style={styles.alertTime}>
                  {a.timestamp ? new Date(a.timestamp).toLocaleTimeString() : "—"}
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
  cardRow: { flexDirection: "row", paddingHorizontal: 12, gap: 6, marginBottom: 12 },
  card: { flex: 1, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 8 },
  cardLabel: { color: "#9CA3AF", fontSize: 9, marginBottom: 2 },
  cardValue: { color: "#D4A017", fontSize: 16, fontWeight: "700" },
  filterBar: { marginBottom: 12 },
  filterTab: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: "#1E3A5F" },
  filterTabActive: { backgroundColor: "#D4A017" },
  filterTabText: { color: "#9CA3AF", fontSize: 12 },
  filterTabTextActive: { color: "#0A1628", fontWeight: "700" },
  empty: { alignItems: "center", padding: 40 },
  emptyText: { color: "#9CA3AF", fontSize: 14 },
  list: { paddingHorizontal: 16, gap: 8 },
  alertCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  alertHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  alertRule: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  severityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  severityText: { fontSize: 10, fontWeight: "700" },
  alertDesc: { color: "#9CA3AF", fontSize: 12, marginBottom: 6 },
  alertFooter: { flexDirection: "row", justifyContent: "space-between" },
  alertAgent: { color: "#D4A017", fontSize: 11 },
  alertTime: { color: "#9CA3AF", fontSize: 11 },
});
