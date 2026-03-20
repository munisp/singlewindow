/**
 * TradeGateway™ NGSWTP — React Native Dashboard Screen
 * Mirrors the PWA Dashboard with real-time stats via tRPC.
 */
import React, { useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { trpc } from "../../services/trpc";
import { useAuth } from "../../contexts/AuthContext";

export default function DashboardScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } =
    trpc.declarations.getStats.useQuery(undefined, { refetchInterval: 30_000 });

  const { data: payments, isLoading: paymentsLoading, refetch: refetchPayments } =
    trpc.payments.getStats.useQuery(undefined, { refetchInterval: 30_000 });

  const { data: notifications } =
    trpc.userNotifications.list.useQuery({ limit: 5, unreadOnly: true });

  const { data: systemStatus } =
    trpc.system.systemStatus.useQuery(undefined, { refetchInterval: 60_000 });

  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchPayments()]);
    setRefreshing(false);
  }, [refetchStats, refetchPayments]);

  const isLoading = statsLoading || paymentsLoading;

  const systemHealthy = systemStatus?.components?.every((c: any) => c.status === "healthy");

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.userName}>{user?.name ?? "Trader"}</Text>
        {systemStatus && (
          <View style={[styles.statusBadge, { backgroundColor: systemHealthy ? "#065F46" : "#7F1D1D" }]}>
            <Text style={styles.statusText}>{systemHealthy ? "All Systems Operational" : "Service Degraded"}</Text>
          </View>
        )}
      </View>

      {/* Unread Notifications */}
      {notifications && notifications.items?.length > 0 && (
        <TouchableOpacity style={styles.notifBanner} onPress={() => navigation.navigate("Notifications")}>
          <Text style={styles.notifText}>🔔 {notifications.items.length} unread alert{notifications.items.length > 1 ? "s" : ""}</Text>
        </TouchableOpacity>
      )}

      {/* Stats Cards */}
      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : (
        <View style={styles.statsGrid}>
          <StatCard label="Total Declarations" value={stats?.total ?? 0} color="#1E3A5F" />
          <StatCard label="Pending" value={stats?.pending ?? 0} color="#D97706" />
          <StatCard label="Cleared Today" value={stats?.clearedToday ?? 0} color="#065F46" />
          <StatCard label="Rejected" value={stats?.rejected ?? 0} color="#7F1D1D" />
          <StatCard label="Payments Today" value={`₦${((payments?.todayNaira ?? 0) / 1_000_000).toFixed(1)}M`} color="#1E3A5F" />
          <StatCard label="Green Lane %" value={`${stats?.greenLaneRate ?? 0}%`} color="#065F46" />
        </View>
      )}

      {/* Quick Actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>
      <View style={styles.actionsGrid}>
        <ActionButton label="New Declaration" icon="📋" onPress={() => navigation.navigate("Declarations", { screen: "NewDeclaration" })} />
        <ActionButton label="Track Cargo" icon="🚢" onPress={() => navigation.navigate("CargoTracking")} />
        <ActionButton label="Pay Duties" icon="💳" onPress={() => navigation.navigate("Payments")} />
        <ActionButton label="Scan Document" icon="📷" onPress={() => navigation.navigate("Declarations", { screen: "ScanDocument" })} />
        <ActionButton label="HS Code Lookup" icon="🔍" onPress={() => navigation.navigate("Declarations", { screen: "HSCodeLookup" })} />
        <ActionButton label="Document Vault" icon="🗄️" onPress={() => navigation.navigate("DocumentVault")} />
      </View>
    </ScrollView>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <View style={[styles.statCard, { borderLeftColor: color }]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionButton({ label, icon, onPress }: { label: string; icon: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: { padding: 20, paddingTop: 24 },
  greeting: { color: "#9CA3AF", fontSize: 14 },
  userName: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", marginTop: 2 },
  statusBadge: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: "flex-start" },
  statusText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  notifBanner: { marginHorizontal: 16, backgroundColor: "#1E3A5F", borderRadius: 8, padding: 12, marginBottom: 8 },
  notifText: { color: "#D4A017", fontSize: 14, fontWeight: "600" },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8 },
  statCard: { width: "47%", backgroundColor: "#111827", borderRadius: 8, padding: 14, borderLeftWidth: 3, marginBottom: 4 },
  statValue: { color: "#FFFFFF", fontSize: 22, fontWeight: "700" },
  statLabel: { color: "#9CA3AF", fontSize: 12, marginTop: 4 },
  sectionTitle: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", marginHorizontal: 16, marginTop: 20, marginBottom: 12 },
  actionsGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 12, gap: 8, paddingBottom: 32 },
  actionBtn: { width: "30%", backgroundColor: "#111827", borderRadius: 8, padding: 14, alignItems: "center", marginBottom: 4 },
  actionIcon: { fontSize: 24, marginBottom: 6 },
  actionLabel: { color: "#9CA3AF", fontSize: 11, textAlign: "center" },
});
