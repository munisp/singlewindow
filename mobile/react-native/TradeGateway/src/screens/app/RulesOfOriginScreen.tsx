/**
 * TradeGateway™ NGSWTP — React Native Rules of Origin Screen
 * Parity with PWA RulesOfOrigin page. Uses trpc.rulesOfOrigin procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TextInput, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function RulesOfOriginScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [hsCode, setHsCode] = useState("");
  const [country, setCountry] = useState("");
  const [searchResult, setSearchResult] = useState<any>(null);
  const { data: recentLookups, isLoading, refetch } = trpc.rulesOfOrigin.getRecentLookups.useQuery({ limit: 10 });
  const lookupMutation = trpc.rulesOfOrigin.lookup.useMutation({
    onSuccess: (result) => setSearchResult(result),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handleLookup = () => {
    if (!hsCode.trim()) return;
    lookupMutation.mutate({ hsCode: hsCode.trim(), countryOfOrigin: country.trim() || undefined });
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Rules of Origin</Text>

      {/* Lookup Form */}
      <View style={styles.formCard}>
        <Text style={styles.formTitle}>HS Code Lookup</Text>
        <TextInput
          style={styles.input}
          placeholder="HS Code (e.g. 8471.30)"
          placeholderTextColor="#6B7280"
          value={hsCode}
          onChangeText={setHsCode}
          keyboardType="numeric"
        />
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          placeholder="Country of Origin (optional)"
          placeholderTextColor="#6B7280"
          value={country}
          onChangeText={setCountry}
        />
        <TouchableOpacity
          style={[styles.lookupBtn, lookupMutation.isPending && { opacity: 0.6 }]}
          onPress={handleLookup}
          disabled={lookupMutation.isPending}
        >
          {lookupMutation.isPending ? (
            <ActivityIndicator color="#0A1628" size="small" />
          ) : (
            <Text style={styles.lookupBtnText}>Look Up Rules</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Result */}
      {searchResult && (
        <View style={styles.resultCard}>
          <Text style={styles.resultTitle}>{searchResult.hsCode} — {searchResult.description ?? "—"}</Text>
          {searchResult.rules && searchResult.rules.map((rule: any, i: number) => (
            <View key={i} style={styles.ruleRow}>
              <Text style={styles.ruleAgreement}>{rule.agreement ?? "—"}</Text>
              <Text style={styles.ruleText}>{rule.rule ?? "—"}</Text>
              <View style={[styles.qualifyBadge, { backgroundColor: rule.qualifies ? "#05966920" : "#DC262620" }]}>
                <Text style={[styles.qualifyText, { color: rule.qualifies ? "#059669" : "#DC2626" }]}>
                  {rule.qualifies ? "Qualifies" : "Does Not Qualify"}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Recent Lookups */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Lookups</Text>
        {isLoading ? (
          <ActivityIndicator color="#D4A017" />
        ) : (recentLookups?.items ?? []).length === 0 ? (
          <Text style={styles.emptyText}>No recent lookups</Text>
        ) : (
          (recentLookups?.items ?? []).map((l: any, i: number) => (
            <TouchableOpacity
              key={i}
              style={styles.lookupRow}
              onPress={() => { setHsCode(l.hsCode); setCountry(l.countryOfOrigin ?? ""); }}
            >
              <Text style={styles.lookupHs}>{l.hsCode}</Text>
              <Text style={styles.lookupCountry}>{l.countryOfOrigin ?? "Any"}</Text>
              <Text style={styles.lookupDate}>{l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "—"}</Text>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", padding: 16 },
  formCard: { margin: 16, backgroundColor: "#1E3A5F", borderRadius: 10, padding: 16 },
  formTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 10 },
  input: { backgroundColor: "#0A1628", color: "#FFFFFF", borderRadius: 8, padding: 10, fontSize: 13 },
  lookupBtn: { backgroundColor: "#D4A017", padding: 12, borderRadius: 8, alignItems: "center", marginTop: 12 },
  lookupBtnText: { color: "#0A1628", fontWeight: "700", fontSize: 14 },
  resultCard: { marginHorizontal: 16, marginBottom: 16, backgroundColor: "#1E3A5F", borderRadius: 10, padding: 16 },
  resultTitle: { color: "#D4A017", fontSize: 14, fontWeight: "700", marginBottom: 10 },
  ruleRow: { marginBottom: 10, borderBottomWidth: 1, borderBottomColor: "#0A1628", paddingBottom: 10 },
  ruleAgreement: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  ruleText: { color: "#9CA3AF", fontSize: 12, marginVertical: 4 },
  qualifyBadge: { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  qualifyText: { fontSize: 11, fontWeight: "700" },
  section: { marginHorizontal: 16 },
  sectionTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 10 },
  emptyText: { color: "#9CA3AF", fontSize: 13 },
  lookupRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#1E3A5F" },
  lookupHs: { color: "#D4A017", fontSize: 13, fontWeight: "600" },
  lookupCountry: { color: "#FFFFFF", fontSize: 13 },
  lookupDate: { color: "#9CA3AF", fontSize: 12 },
});
