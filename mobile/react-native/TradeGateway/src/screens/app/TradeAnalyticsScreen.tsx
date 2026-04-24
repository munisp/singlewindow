/**
 * TradeGateway™ NGSWTP — React Native Trade Analytics Screen
 * Parity with PWA TradeAnalytics page. Uses trpc.tradeAnalytics procedures.
 */
import React, { useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function TradeAnalyticsScreen() {
  const [refreshing, setRefreshing] = React.useState(false);
  const { data: summary, isLoading, refetch } = trpc.tradeAnalytics.getSummary.useQuery(undefined, { retry: 2 });
  const { data: topHs } = trpc.tradeAnalytics.getTopHsCodes.useQuery({ limit: 10 });
  const { data: monthlyTrend } = trpc.tradeAnalytics.getMonthlyTrend.useQuery({ months: 6 });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Trade Analytics</Text>

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : (
        <>
          {/* Summary Cards */}
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Declarations</Text>
              <Text style={styles.cardValue}>{summary?.totalDeclarations?.toLocaleString() ?? "—"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Value (USD)</Text>
              <Text style={styles.cardValue}>
                {summary?.totalValue ? `$${(summary.totalValue / 1_000_000).toFixed(1)}M` : "—"}
              </Text>
            </View>
          </View>
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Avg Clearance (hrs)</Text>
              <Text style={styles.cardValue}>{summary?.avgClearanceHours?.toFixed(1) ?? "—"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Green Lane Rate</Text>
              <Text style={[styles.cardValue, { color: "#10B981" }]}>
                {summary?.greenLaneRate ? `${(summary.greenLaneRate * 100).toFixed(1)}%` : "—"}
              </Text>
            </View>
          </View>

          {/* Monthly Trend */}
          {monthlyTrend && monthlyTrend.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Monthly Trend (Last 6 Months)</Text>
              {monthlyTrend.map((m: any, i: number) => (
                <View key={i} style={styles.trendRow}>
                  <Text style={styles.trendMonth}>{m.month}</Text>
                  <View style={styles.trendBar}>
                    <View
                      style={[
                        styles.trendFill,
                        { width: `${Math.min(100, (m.count / (monthlyTrend[0]?.count || 1)) * 100)}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.trendCount}>{m.count?.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Top HS Codes */}
          {topHs && topHs.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Top HS Codes by Volume</Text>
              {topHs.map((h: any, i: number) => (
                <View key={i} style={styles.hsRow}>
                  <View style={styles.hsRank}>
                    <Text style={styles.hsRankText}>{i + 1}</Text>
                  </View>
                  <View style={styles.hsInfo}>
                    <Text style={styles.hsCode}>{h.hsCode}</Text>
                    <Text style={styles.hsDesc} numberOfLines={1}>{h.description ?? "—"}</Text>
                  </View>
                  <Text style={styles.hsCount}>{h.count?.toLocaleString()}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", padding: 16 },
  cardRow: { flexDirection: "row", paddingHorizontal: 12, gap: 8, marginBottom: 8 },
  card: { flex: 1, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  cardLabel: { color: "#9CA3AF", fontSize: 11, marginBottom: 4 },
  cardValue: { color: "#D4A017", fontSize: 22, fontWeight: "700" },
  section: { margin: 16, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  sectionTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 12 },
  trendRow: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  trendMonth: { color: "#9CA3AF", fontSize: 12, width: 50 },
  trendBar: { flex: 1, height: 8, backgroundColor: "#0A1628", borderRadius: 4, marginHorizontal: 8 },
  trendFill: { height: 8, backgroundColor: "#D4A017", borderRadius: 4 },
  trendCount: { color: "#FFFFFF", fontSize: 12, width: 50, textAlign: "right" },
  hsRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" },
  hsRank: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#0A1628", alignItems: "center", justifyContent: "center", marginRight: 10 },
  hsRankText: { color: "#D4A017", fontSize: 12, fontWeight: "700" },
  hsInfo: { flex: 1 },
  hsCode: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  hsDesc: { color: "#9CA3AF", fontSize: 11 },
  hsCount: { color: "#D4A017", fontSize: 13, fontWeight: "600" },
});
