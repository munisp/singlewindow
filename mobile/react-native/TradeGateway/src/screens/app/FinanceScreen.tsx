/**
 * TradeGateway™ NGSWTP — React Native Finance Screen
 * Parity with PWA Finance page. Uses trpc.finance and trpc.tigerBeetle procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function FinanceScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"accounts" | "transactions" | "ledger">("accounts");
  const { data: accounts, isLoading: accLoading, refetch: refetchAcc } = trpc.finance.getAccounts.useQuery({ limit: 20 });
  const { data: transactions, isLoading: txLoading, refetch: refetchTx } = trpc.finance.getTransactions.useQuery({ limit: 50 });
  const { data: ledger, isLoading: ledLoading, refetch: refetchLed } = trpc.tigerBeetle.getLedgerStats.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchAcc(), refetchTx(), refetchLed()]);
    setRefreshing(false);
  }, [refetchAcc, refetchTx, refetchLed]);

  const isLoading = accLoading || txLoading || ledLoading;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Finance & Ledger</Text>

      {/* TigerBeetle Ledger Stats */}
      {ledger && (
        <View style={styles.ledgerCard}>
          <Text style={styles.ledgerTitle}>TigerBeetle Ledger</Text>
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Accounts</Text>
              <Text style={styles.cardValue}>{ledger.totalAccounts?.toLocaleString() ?? "—"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Transfers</Text>
              <Text style={styles.cardValue}>{ledger.totalTransfers?.toLocaleString() ?? "—"}</Text>
            </View>
          </View>
          <View style={styles.cardRow}>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Debits</Text>
              <Text style={[styles.cardValue, { color: "#DC2626" }]}>
                {ledger.totalDebits ? `$${(ledger.totalDebits / 1_000_000).toFixed(2)}M` : "—"}
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardLabel}>Total Credits</Text>
              <Text style={[styles.cardValue, { color: "#059669" }]}>
                {ledger.totalCredits ? `$${(ledger.totalCredits / 1_000_000).toFixed(2)}M` : "—"}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(["accounts", "transactions", "ledger"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : (
        <View style={styles.content}>
          {activeTab === "accounts" && (accounts?.items ?? []).map((a: any) => (
            <View key={a.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{a.accountName ?? `Account ${a.id}`}</Text>
                <Text style={[styles.itemAmount, { color: Number(a.balance) >= 0 ? "#059669" : "#DC2626" }]}>
                  ${Number(a.balance ?? 0).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.itemMeta}>{a.accountType ?? "—"} · {a.currency ?? "NGN"}</Text>
            </View>
          ))}
          {activeTab === "transactions" && (transactions?.items ?? []).map((t: any) => (
            <View key={t.id} style={styles.itemCard}>
              <View style={styles.itemHeader}>
                <Text style={styles.itemTitle}>{t.description ?? `TXN-${t.id}`}</Text>
                <Text style={[styles.itemAmount, { color: t.type === "credit" ? "#059669" : "#DC2626" }]}>
                  {t.type === "credit" ? "+" : "-"}${Number(t.amount ?? 0).toLocaleString()}
                </Text>
              </View>
              <Text style={styles.itemMeta}>{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : "—"}</Text>
            </View>
          ))}
          {activeTab === "ledger" && (
            <View style={styles.itemCard}>
              <Text style={styles.itemTitle}>Ledger data available in TigerBeetle stats above</Text>
              <Text style={styles.itemMeta}>All financial transactions are immutably recorded in the TigerBeetle distributed ledger for audit compliance.</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", padding: 16 },
  ledgerCard: { margin: 16, backgroundColor: "#1E3A5F", borderRadius: 10, padding: 16 },
  ledgerTitle: { color: "#D4A017", fontSize: 14, fontWeight: "700", marginBottom: 12 },
  cardRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  card: { flex: 1, backgroundColor: "#0A1628", borderRadius: 8, padding: 10 },
  cardLabel: { color: "#9CA3AF", fontSize: 10, marginBottom: 2 },
  cardValue: { color: "#D4A017", fontSize: 16, fontWeight: "700" },
  tabBar: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  tabActive: { backgroundColor: "#D4A017" },
  tabText: { color: "#9CA3AF", fontSize: 13 },
  tabTextActive: { color: "#0A1628", fontWeight: "700" },
  content: { paddingHorizontal: 16, gap: 10 },
  itemCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  itemHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  itemTitle: { color: "#FFFFFF", fontSize: 13, fontWeight: "600", flex: 1, marginRight: 8 },
  itemAmount: { fontSize: 14, fontWeight: "700" },
  itemMeta: { color: "#9CA3AF", fontSize: 12 },
});
