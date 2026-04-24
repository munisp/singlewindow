/**
 * TradeGateway™ NGSWTP — React Native Sanctions Screening Screen
 * Parity with PWA SanctionsScreening page. Uses trpc.sanctionsScreening procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TextInput, TouchableOpacity, Alert,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function SanctionsScreeningScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const { data, isLoading, refetch } = trpc.sanctionsScreening.getRecentScreenings.useQuery({ limit: 20 });
  const { data: stats } = trpc.sanctionsScreening.getStats.useQuery();
  const screenMutation = trpc.sanctionsScreening.screenEntity.useMutation({
    onSuccess: (result) => setSearchResult(result),
    onError: (e) => Alert.alert("Screening Error", e.message),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleSearch = () => {
    if (!searchQuery.trim()) return;
    screenMutation.mutate({ entityName: searchQuery.trim(), entityType: "company" });
  };

  const screenings = data?.items ?? [];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Sanctions Screening</Text>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Screened Today</Text>
            <Text style={styles.cardValue}>{stats.screenedToday ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Hits</Text>
            <Text style={[styles.cardValue, { color: "#DC2626" }]}>{stats.hits ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Clear</Text>
            <Text style={[styles.cardValue, { color: "#059669" }]}>{stats.clear ?? 0}</Text>
          </View>
        </View>
      )}

      {/* Search */}
      <View style={styles.searchSection}>
        <Text style={styles.sectionTitle}>Screen an Entity</Text>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            placeholder="Enter company or individual name..."
            placeholderTextColor="#6B7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
          />
          <TouchableOpacity
            style={[styles.searchBtn, screenMutation.isPending && { opacity: 0.6 }]}
            onPress={handleSearch}
            disabled={screenMutation.isPending}
          >
            {screenMutation.isPending ? (
              <ActivityIndicator color="#0A1628" size="small" />
            ) : (
              <Text style={styles.searchBtnText}>Screen</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Search Result */}
        {searchResult && (
          <View style={[styles.resultCard, { borderColor: searchResult.isMatch ? "#DC2626" : "#059669" }]}>
            <Text style={[styles.resultStatus, { color: searchResult.isMatch ? "#DC2626" : "#059669" }]}>
              {searchResult.isMatch ? "⚠ SANCTIONS MATCH FOUND" : "✓ CLEAR — No Sanctions Match"}
            </Text>
            <Text style={styles.resultName}>{searchResult.entityName}</Text>
            {searchResult.matchDetails && (
              <Text style={styles.resultDetails}>{searchResult.matchDetails}</Text>
            )}
            <Text style={styles.resultScore}>
              Confidence: {searchResult.confidenceScore ? `${(searchResult.confidenceScore * 100).toFixed(0)}%` : "—"}
            </Text>
          </View>
        )}
      </View>

      {/* Recent Screenings */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Screenings</Text>
        {isLoading ? (
          <ActivityIndicator color="#D4A017" style={{ marginTop: 16 }} />
        ) : screenings.length === 0 ? (
          <Text style={styles.emptyText}>No recent screenings</Text>
        ) : (
          screenings.map((s: any) => (
            <View key={s.id} style={styles.screeningRow}>
              <View style={styles.screeningInfo}>
                <Text style={styles.screeningName}>{s.entityName}</Text>
                <Text style={styles.screeningDate}>{s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "—"}</Text>
              </View>
              <View style={[styles.hitBadge, { backgroundColor: s.isMatch ? "#DC262620" : "#05966920" }]}>
                <Text style={[styles.hitText, { color: s.isMatch ? "#DC2626" : "#059669" }]}>
                  {s.isMatch ? "HIT" : "CLEAR"}
                </Text>
              </View>
            </View>
          ))
        )}
      </View>
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
  searchSection: { marginHorizontal: 16, marginBottom: 16 },
  section: { marginHorizontal: 16, marginBottom: 16 },
  sectionTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 10 },
  searchRow: { flexDirection: "row", gap: 8 },
  searchInput: { flex: 1, backgroundColor: "#1E3A5F", color: "#FFFFFF", borderRadius: 8, padding: 10, fontSize: 13 },
  searchBtn: { backgroundColor: "#D4A017", paddingHorizontal: 14, borderRadius: 8, justifyContent: "center" },
  searchBtnText: { color: "#0A1628", fontWeight: "700", fontSize: 13 },
  resultCard: { marginTop: 10, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12, borderWidth: 1 },
  resultStatus: { fontSize: 13, fontWeight: "700", marginBottom: 4 },
  resultName: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 2 },
  resultDetails: { color: "#9CA3AF", fontSize: 12, marginBottom: 4 },
  resultScore: { color: "#9CA3AF", fontSize: 12 },
  screeningRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" },
  screeningInfo: { flex: 1 },
  screeningName: { color: "#FFFFFF", fontSize: 13 },
  screeningDate: { color: "#9CA3AF", fontSize: 11 },
  hitBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  hitText: { fontSize: 11, fontWeight: "700" },
  emptyText: { color: "#9CA3AF", fontSize: 13 },
});
