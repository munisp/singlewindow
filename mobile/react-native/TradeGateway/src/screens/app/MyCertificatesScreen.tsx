import React, { useState } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, RefreshControl, Alert
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { apiClient } from "../../services/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { colors, typography, spacing } from "../../theme";

interface Certificate {
  id: number;
  type: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  status: "active" | "expired" | "revoked" | "pending";
  declarationRef?: string;
  downloadUrl?: string;
}

export default function MyCertificatesScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "expired" | "pending">("all");

  const { data, isLoading, refetch, isRefetching } = useQuery<Certificate[]>({
    queryKey: ["myCertificates", filter],
    queryFn: () => apiClient.get(`/api/trpc/certificates.list?input=${encodeURIComponent(JSON.stringify({ filter }))}`),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: number) => apiClient.post("/api/trpc/certificates.revoke", { id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["myCertificates"] });
      Alert.alert("Success", "Certificate revoked successfully.");
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const filtered = (data ?? []).filter(c =>
    c.type.toLowerCase().includes(search.toLowerCase()) ||
    c.issuer.toLowerCase().includes(search.toLowerCase()) ||
    (c.declarationRef ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const statusColor = (status: Certificate["status"]) => {
    switch (status) {
      case "active":  return colors.success;
      case "expired": return colors.error;
      case "revoked": return colors.error;
      case "pending": return colors.warning;
      default:        return colors.textSecondary;
    }
  };

  const renderItem = ({ item }: { item: Certificate }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.certType}>{item.type}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor(item.status) + "22" }]}>
            <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>
              {item.status.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.issuer}>{item.issuer}</Text>
      </View>

      <View style={styles.dateRow}>
        <View style={styles.dateItem}>
          <Text style={styles.dateLabel}>Issued</Text>
          <Text style={styles.dateValue}>{new Date(item.issuedAt).toLocaleDateString()}</Text>
        </View>
        <View style={styles.dateItem}>
          <Text style={styles.dateLabel}>Expires</Text>
          <Text style={[styles.dateValue, item.status === "expired" && { color: colors.error }]}>
            {new Date(item.expiresAt).toLocaleDateString()}
          </Text>
        </View>
        {item.declarationRef && (
          <View style={styles.dateItem}>
            <Text style={styles.dateLabel}>Declaration</Text>
            <Text style={styles.dateValue}>{item.declarationRef}</Text>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        {item.downloadUrl && (
          <TouchableOpacity style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>Download</Text>
          </TouchableOpacity>
        )}
        {item.status === "active" && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.dangerBtn]}
            onPress={() =>
              Alert.alert("Revoke Certificate", "Are you sure you want to revoke this certificate?", [
                { text: "Cancel", style: "cancel" },
                { text: "Revoke", style: "destructive", onPress: () => revokeMutation.mutate(item.id) },
              ])
            }
          >
            <Text style={[styles.actionBtnText, { color: colors.error }]}>Revoke</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Certificates</Text>
      </View>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search certificates..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {(["all", "active", "expired", "pending"] as const).map(f => (
          <TouchableOpacity
            key={f}
            style={[styles.filterTab, filter === f && styles.filterTabActive]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.filterTabText, filter === f && styles.filterTabTextActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* List */}
      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => String(item.id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No certificates found.</Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: colors.background },
  header:           { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:          { marginRight: spacing.sm },
  backText:         { color: colors.primary, fontSize: 14 },
  title:            { fontSize: 18, fontWeight: "700", color: colors.text },
  searchRow:        { padding: spacing.md, paddingBottom: 0 },
  searchInput:      { backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  filterRow:        { flexDirection: "row", paddingHorizontal: spacing.md, paddingTop: spacing.sm, gap: spacing.sm },
  filterTab:        { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterTabActive:  { backgroundColor: colors.primary, borderColor: colors.primary },
  filterTabText:    { fontSize: 12, color: colors.textSecondary },
  filterTabTextActive: { color: "#fff", fontWeight: "600" },
  list:             { padding: spacing.md, gap: spacing.sm },
  card:             { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardHeader:       { marginBottom: spacing.sm },
  cardTitleRow:     { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  certType:         { fontSize: 15, fontWeight: "600", color: colors.text, flex: 1 },
  badge:            { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  badgeText:        { fontSize: 10, fontWeight: "700" },
  issuer:           { fontSize: 12, color: colors.textSecondary },
  dateRow:          { flexDirection: "row", gap: spacing.md, marginBottom: spacing.sm },
  dateItem:         { flex: 1 },
  dateLabel:        { fontSize: 10, color: colors.textSecondary, marginBottom: 2 },
  dateValue:        { fontSize: 12, color: colors.text, fontWeight: "500" },
  actions:          { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn:        { flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.primary + "15", alignItems: "center" },
  dangerBtn:        { backgroundColor: colors.error + "15" },
  actionBtnText:    { fontSize: 13, fontWeight: "600", color: colors.primary },
  loader:           { marginTop: 60 },
  emptyText:        { textAlign: "center", color: colors.textSecondary, marginTop: 40 },
});
