/**
 * TradeGateway™ NGSWTP — React Native Bonded Warehouse Screen
 * Parity with PWA BondedWarehouse page. Uses trpc.bondedWarehouse procedures.
 */
import React, { useCallback, useState } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { trpc } from "../../services/trpc";

export default function BondedWarehouseScreen() {
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"inventory" | "movements" | "bonds">("inventory");
  const { data: inventory, isLoading: invLoading, refetch: refetchInv } = trpc.bondedWarehouse.getInventory.useQuery({ limit: 50 });
  const { data: movements, isLoading: movLoading, refetch: refetchMov } = trpc.bondedWarehouse.getMovements.useQuery({ limit: 30 });
  const { data: bonds, isLoading: bondsLoading, refetch: refetchBonds } = trpc.bondedWarehouse.getBonds.useQuery({ limit: 30 });
  const { data: stats } = trpc.bondedWarehouse.getStats.useQuery();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchInv(), refetchMov(), refetchBonds()]);
    setRefreshing(false);
  }, [refetchInv, refetchMov, refetchBonds]);

  const isLoading = invLoading || movLoading || bondsLoading;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Bonded Warehouse</Text>

      {/* Stats */}
      {stats && (
        <View style={styles.cardRow}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Total Items</Text>
            <Text style={styles.cardValue}>{stats.totalItems ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Active Bonds</Text>
            <Text style={[styles.cardValue, { color: "#D97706" }]}>{stats.activeBonds ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Capacity</Text>
            <Text style={[styles.cardValue, { color: "#2563EB" }]}>
              {stats.capacityUsed ? `${stats.capacityUsed}%` : "—"}
            </Text>
          </View>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabBar}>
        {(["inventory", "movements", "bonds"] as const).map((tab) => (
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
          {activeTab === "inventory" && (inventory?.items ?? []).map((item: any) => (
            <View key={item.id} style={styles.itemCard}>
              <Text style={styles.itemName}>{item.description ?? "Unknown Item"}</Text>
              <View style={styles.itemRow}>
                <Text style={styles.itemMeta}>HS: {item.hsCode ?? "—"}</Text>
                <Text style={styles.itemMeta}>Qty: {item.quantity ?? 0} {item.unit ?? ""}</Text>
              </View>
              <View style={styles.itemRow}>
                <Text style={styles.itemMeta}>Entry: {item.entryDate ? new Date(item.entryDate).toLocaleDateString() : "—"}</Text>
                <Text style={[styles.itemMeta, { color: "#D97706" }]}>
                  Expires: {item.expiryDate ? new Date(item.expiryDate).toLocaleDateString() : "—"}
                </Text>
              </View>
            </View>
          ))}
          {activeTab === "movements" && (movements?.items ?? []).map((m: any) => (
            <View key={m.id} style={styles.itemCard}>
              <View style={styles.itemRow}>
                <Text style={styles.itemName}>{m.movementType?.toUpperCase() ?? "MOVEMENT"}</Text>
                <Text style={[styles.itemMeta, { color: m.movementType === "entry" ? "#059669" : "#DC2626" }]}>
                  {m.quantity ?? 0} {m.unit ?? "units"}
                </Text>
              </View>
              <Text style={styles.itemMeta}>{m.description ?? "—"}</Text>
              <Text style={styles.itemMeta}>{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}</Text>
            </View>
          ))}
          {activeTab === "bonds" && (bonds?.items ?? []).map((b: any) => (
            <View key={b.id} style={styles.itemCard}>
              <Text style={styles.itemName}>{b.bondNumber ?? `BOND-${b.id}`}</Text>
              <View style={styles.itemRow}>
                <Text style={styles.itemMeta}>Amount: ${Number(b.bondAmount ?? 0).toLocaleString()}</Text>
                <Text style={[styles.itemMeta, { color: b.status === "active" ? "#059669" : "#D97706" }]}>
                  {b.status?.toUpperCase()}
                </Text>
              </View>
              <Text style={styles.itemMeta}>Expires: {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString() : "—"}</Text>
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
  tabBar: { flexDirection: "row", marginHorizontal: 16, marginBottom: 12, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 6 },
  tabActive: { backgroundColor: "#D4A017" },
  tabText: { color: "#9CA3AF", fontSize: 13 },
  tabTextActive: { color: "#0A1628", fontWeight: "700" },
  content: { paddingHorizontal: 16, gap: 10 },
  itemCard: { backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12 },
  itemName: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 6 },
  itemRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  itemMeta: { color: "#9CA3AF", fontSize: 12 },
});
