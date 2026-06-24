/**
 * FreeZoneScreen — Free Zone Operations
 *
 * Displays free zone entry/exit tracking, zone-specific permits,
 * and bonded zone inventory status for traders operating in
 * designated free trade zones.
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";

interface FreeZoneEntry {
  id: string;
  zoneName: string;
  permitNumber: string;
  status: "active" | "pending" | "expired" | "suspended";
  entryDate: string;
  expiryDate: string;
  goodsDescription: string;
  declaredValue: number;
  currency: string;
}

const MOCK_ENTRIES: FreeZoneEntry[] = [
  {
    id: "FZ-2026-001",
    zoneName: "National Free Trade Zone — Zone A",
    permitNumber: "FZP-2026-A-00142",
    status: "active",
    entryDate: "2026-05-15",
    expiryDate: "2026-11-15",
    goodsDescription: "Electronic components, semiconductors",
    declaredValue: 450000,
    currency: "USD",
  },
  {
    id: "FZ-2026-002",
    zoneName: "Port Free Zone — Zone B",
    permitNumber: "FZP-2026-B-00089",
    status: "pending",
    entryDate: "2026-06-20",
    expiryDate: "2026-12-20",
    goodsDescription: "Textile raw materials",
    declaredValue: 120000,
    currency: "USD",
  },
  {
    id: "FZ-2025-088",
    zoneName: "National Free Trade Zone — Zone A",
    permitNumber: "FZP-2025-A-00988",
    status: "expired",
    entryDate: "2025-01-10",
    expiryDate: "2025-07-10",
    goodsDescription: "Automotive parts",
    declaredValue: 280000,
    currency: "USD",
  },
];

const STATUS_COLORS: Record<FreeZoneEntry["status"], string> = {
  active: "#10B981",
  pending: "#F59E0B",
  expired: "#6B7280",
  suspended: "#EF4444",
};

const STATUS_LABELS: Record<FreeZoneEntry["status"], string> = {
  active: "Active",
  pending: "Pending Approval",
  expired: "Expired",
  suspended: "Suspended",
};

export default function FreeZoneScreen() {
  const [entries] = useState<FreeZoneEntry[]>(MOCK_ENTRIES);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<FreeZoneEntry | null>(null);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }, []);

  const activeCount = entries.filter((e) => e.status === "active").length;
  const pendingCount = entries.filter((e) => e.status === "pending").length;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Free Zone Operations</Text>
        <Text style={styles.headerSubtitle}>Zone permits and entry tracking</Text>
      </View>

      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={[styles.summaryCard, { borderLeftColor: "#10B981" }]}>
          <Text style={styles.summaryValue}>{activeCount}</Text>
          <Text style={styles.summaryLabel}>Active Permits</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: "#F59E0B" }]}>
          <Text style={styles.summaryValue}>{pendingCount}</Text>
          <Text style={styles.summaryLabel}>Pending</Text>
        </View>
        <View style={[styles.summaryCard, { borderLeftColor: "#3B82F6" }]}>
          <Text style={styles.summaryValue}>{entries.length}</Text>
          <Text style={styles.summaryLabel}>Total</Text>
        </View>
      </View>

      {/* Entry List */}
      <Text style={styles.sectionTitle}>Zone Permits</Text>
      {entries.map((entry) => (
        <TouchableOpacity
          key={entry.id}
          style={styles.entryCard}
          onPress={() => setSelectedEntry(selectedEntry?.id === entry.id ? null : entry)}
          activeOpacity={0.85}
        >
          <View style={styles.entryHeader}>
            <View style={styles.entryTitleRow}>
              <Text style={styles.entryId}>{entry.id}</Text>
              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: STATUS_COLORS[entry.status] + "22" },
                ]}
              >
                <Text style={[styles.statusText, { color: STATUS_COLORS[entry.status] }]}>
                  {STATUS_LABELS[entry.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.zoneName}>{entry.zoneName}</Text>
          </View>

          <View style={styles.entryMeta}>
            <Text style={styles.metaLabel}>Permit No.</Text>
            <Text style={styles.metaValue}>{entry.permitNumber}</Text>
          </View>

          {selectedEntry?.id === entry.id && (
            <View style={styles.expandedDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Goods</Text>
                <Text style={styles.detailValue}>{entry.goodsDescription}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Declared Value</Text>
                <Text style={styles.detailValue}>
                  {entry.currency} {entry.declaredValue.toLocaleString()}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Entry Date</Text>
                <Text style={styles.detailValue}>{entry.entryDate}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Expiry Date</Text>
                <Text style={[styles.detailValue, entry.status === "expired" && styles.expiredText]}>
                  {entry.expiryDate}
                </Text>
              </View>
            </View>
          )}
        </TouchableOpacity>
      ))}

      {/* Apply Button */}
      <TouchableOpacity style={styles.applyButton} activeOpacity={0.85}>
        <Text style={styles.applyButtonText}>Apply for New Zone Permit</Text>
      </TouchableOpacity>

      <View style={styles.bottomSpacer} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  header: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1E3A5F",
  },
  headerTitle: { fontSize: 22, fontWeight: "700", color: "#F0F4F8" },
  headerSubtitle: { fontSize: 13, color: "#8899AA", marginTop: 4 },
  summaryRow: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: "#0E1E35",
    borderRadius: 10,
    padding: 14,
    borderLeftWidth: 3,
  },
  summaryValue: { fontSize: 24, fontWeight: "700", color: "#F0F4F8" },
  summaryLabel: { fontSize: 11, color: "#8899AA", marginTop: 4 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8899AA",
    paddingHorizontal: 20,
    paddingBottom: 10,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  entryCard: {
    backgroundColor: "#0E1E35",
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1E3A5F",
  },
  entryHeader: { marginBottom: 8 },
  entryTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  entryId: { fontSize: 15, fontWeight: "700", color: "#D4A017" },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  statusText: { fontSize: 11, fontWeight: "600" },
  zoneName: { fontSize: 13, color: "#A0B4C8" },
  entryMeta: { flexDirection: "row", justifyContent: "space-between" },
  metaLabel: { fontSize: 12, color: "#8899AA" },
  metaValue: { fontSize: 12, color: "#C0D0E0", fontWeight: "500" },
  expandedDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1E3A5F",
    gap: 8,
  },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { fontSize: 12, color: "#8899AA", flex: 1 },
  detailValue: { fontSize: 12, color: "#C0D0E0", flex: 2, textAlign: "right" },
  expiredText: { color: "#EF4444" },
  applyButton: {
    backgroundColor: "#D4A017",
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  applyButtonText: { fontSize: 15, fontWeight: "700", color: "#0A1628" },
  bottomSpacer: { height: 32 },
});
