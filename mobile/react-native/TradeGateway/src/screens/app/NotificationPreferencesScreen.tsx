import React, { useState } from "react";
import {
  View, Text, StyleSheet, Switch, TouchableOpacity,
  ActivityIndicator, ScrollView, Alert
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { apiClient } from "../../services/apiClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { colors, spacing } from "../../theme";

interface NotifPrefs {
  declarationStatusUpdates: boolean;
  paymentConfirmations: boolean;
  ogaApprovals: boolean;
  riskAlerts: boolean;
  aeoStatusChanges: boolean;
  systemMaintenance: boolean;
  weeklyReports: boolean;
  slaBreaches: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

const PREF_LABELS: Record<keyof NotifPrefs, { label: string; description: string; group: string }> = {
  declarationStatusUpdates: { label: "Declaration Status Updates", description: "Notified when your declaration status changes", group: "Declarations" },
  paymentConfirmations:     { label: "Payment Confirmations",     description: "Receive confirmation after successful payments", group: "Payments" },
  ogaApprovals:             { label: "OGA Approvals",             description: "Updates from Other Government Agencies", group: "Declarations" },
  riskAlerts:               { label: "Risk Alerts",               description: "High-risk declarations and compliance issues", group: "Compliance" },
  aeoStatusChanges:         { label: "AEO Status Changes",        description: "Changes to your Authorised Economic Operator status", group: "Compliance" },
  systemMaintenance:        { label: "System Maintenance",        description: "Planned downtime and maintenance windows", group: "System" },
  weeklyReports:            { label: "Weekly Reports",            description: "Weekly summary of your trade activity", group: "Reports" },
  slaBreaches:              { label: "SLA Breach Alerts",         description: "Alerts when clearance SLAs are at risk", group: "Compliance" },
  emailEnabled:             { label: "Email Notifications",       description: "Receive notifications via email", group: "Channels" },
  smsEnabled:               { label: "SMS Notifications",         description: "Receive notifications via SMS", group: "Channels" },
  pushEnabled:              { label: "Push Notifications",        description: "Receive push notifications on this device", group: "Channels" },
};

export default function NotificationPreferencesScreen() {
  const navigation = useNavigation();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<NotifPrefs>({
    queryKey: ["notifPrefs"],
    queryFn: () => apiClient.get("/api/trpc/notifications.getPreferences"),
  });

  const [prefs, setPrefs] = useState<NotifPrefs | null>(null);
  const currentPrefs = prefs ?? data;

  const saveMutation = useMutation({
    mutationFn: (updated: NotifPrefs) =>
      apiClient.post("/api/trpc/notifications.updatePreferences", updated),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifPrefs"] });
      Alert.alert("Saved", "Notification preferences updated.");
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const toggle = (key: keyof NotifPrefs) => {
    if (!currentPrefs) return;
    const updated = { ...currentPrefs, [key]: !currentPrefs[key] };
    setPrefs(updated);
  };

  const groups = Array.from(new Set(Object.values(PREF_LABELS).map(v => v.group)));

  if (isLoading || !currentPrefs) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Notification Preferences</Text>
        </View>
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Notification Preferences</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {groups.map(group => (
          <View key={group} style={styles.group}>
            <Text style={styles.groupLabel}>{group}</Text>
            {(Object.entries(PREF_LABELS) as [keyof NotifPrefs, typeof PREF_LABELS[keyof NotifPrefs]][])
              .filter(([, v]) => v.group === group)
              .map(([key, meta]) => (
                <View key={key} style={styles.prefRow}>
                  <View style={styles.prefInfo}>
                    <Text style={styles.prefLabel}>{meta.label}</Text>
                    <Text style={styles.prefDesc}>{meta.description}</Text>
                  </View>
                  <Switch
                    value={Boolean(currentPrefs[key])}
                    onValueChange={() => toggle(key)}
                    trackColor={{ false: colors.border, true: colors.primary + "66" }}
                    thumbColor={currentPrefs[key] ? colors.primary : colors.textSecondary}
                  />
                </View>
              ))}
          </View>
        ))}

        <TouchableOpacity
          style={[styles.saveBtn, saveMutation.isPending && styles.saveBtnDisabled]}
          onPress={() => saveMutation.mutate(currentPrefs)}
          disabled={saveMutation.isPending}
        >
          <Text style={styles.saveBtnText}>
            {saveMutation.isPending ? "Saving…" : "Save Preferences"}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container:       { flex: 1, backgroundColor: colors.background },
  header:          { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:         { marginRight: spacing.sm },
  backText:        { color: colors.primary, fontSize: 14 },
  title:           { fontSize: 18, fontWeight: "700", color: colors.text },
  scroll:          { padding: spacing.md, gap: spacing.md },
  group:           { backgroundColor: colors.surface, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  groupLabel:      { fontSize: 11, fontWeight: "700", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 1, padding: spacing.md, paddingBottom: 8, backgroundColor: colors.background },
  prefRow:         { flexDirection: "row", alignItems: "center", padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  prefInfo:        { flex: 1, marginRight: spacing.md },
  prefLabel:       { fontSize: 14, fontWeight: "600", color: colors.text, marginBottom: 2 },
  prefDesc:        { fontSize: 12, color: colors.textSecondary },
  saveBtn:         { backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md, alignItems: "center", marginTop: spacing.md },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText:     { color: "#fff", fontWeight: "700", fontSize: 15 },
  loader:          { marginTop: 60 },
});
