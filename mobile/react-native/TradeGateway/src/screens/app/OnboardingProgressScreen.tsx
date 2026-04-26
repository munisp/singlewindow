import React from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { apiClient } from "../../services/apiClient";
import { useQuery } from "@tanstack/react-query";
import { colors, spacing } from "../../theme";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  status: "completed" | "in_progress" | "pending" | "blocked";
  completedAt?: string;
  requiredDocuments?: string[];
  estimatedDays?: number;
}

interface OnboardingProgress {
  traderId: number;
  traderName: string;
  overallProgress: number;
  currentStep: string;
  steps: OnboardingStep[];
  estimatedCompletionDate?: string;
}

export default function OnboardingProgressScreen() {
  const navigation = useNavigation();

  const { data, isLoading, refetch, isRefetching } = useQuery<OnboardingProgress>({
    queryKey: ["onboardingProgress"],
    queryFn: () => apiClient.get("/api/trpc/traderOnboarding.getProgress"),
  });

  const statusColor = (status: OnboardingStep["status"]) => {
    switch (status) {
      case "completed":   return colors.success;
      case "in_progress": return colors.primary;
      case "blocked":     return colors.error;
      default:            return colors.textSecondary;
    }
  };

  const statusIcon = (status: OnboardingStep["status"]) => {
    switch (status) {
      case "completed":   return "✓";
      case "in_progress": return "◉";
      case "blocked":     return "✗";
      default:            return "○";
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Onboarding Progress</Text>
      </View>

      {isLoading ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.loader} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        >
          {/* Progress Summary */}
          {data && (
            <View style={styles.summaryCard}>
              <Text style={styles.traderName}>{data.traderName}</Text>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${data.overallProgress}%` }]} />
              </View>
              <View style={styles.progressMeta}>
                <Text style={styles.progressPct}>{data.overallProgress}% Complete</Text>
                {data.estimatedCompletionDate && (
                  <Text style={styles.estDate}>
                    Est. completion: {new Date(data.estimatedCompletionDate).toLocaleDateString()}
                  </Text>
                )}
              </View>
              <Text style={styles.currentStep}>Current step: {data.currentStep}</Text>
            </View>
          )}

          {/* Steps */}
          <Text style={styles.sectionLabel}>ONBOARDING STEPS</Text>
          {(data?.steps ?? []).map((step, idx) => (
            <View key={step.id} style={styles.stepCard}>
              <View style={styles.stepLeft}>
                <View style={[styles.stepCircle, { backgroundColor: statusColor(step.status) + "22", borderColor: statusColor(step.status) }]}>
                  <Text style={[styles.stepIcon, { color: statusColor(step.status) }]}>
                    {statusIcon(step.status)}
                  </Text>
                </View>
                {idx < (data?.steps.length ?? 0) - 1 && (
                  <View style={[styles.stepLine, { backgroundColor: statusColor(step.status) }]} />
                )}
              </View>
              <View style={styles.stepContent}>
                <View style={styles.stepTitleRow}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  <View style={[styles.badge, { backgroundColor: statusColor(step.status) + "22" }]}>
                    <Text style={[styles.badgeText, { color: statusColor(step.status) }]}>
                      {step.status.replace("_", " ").toUpperCase()}
                    </Text>
                  </View>
                </View>
                <Text style={styles.stepDesc}>{step.description}</Text>
                {step.completedAt && (
                  <Text style={styles.completedAt}>
                    Completed: {new Date(step.completedAt).toLocaleDateString()}
                  </Text>
                )}
                {step.requiredDocuments && step.requiredDocuments.length > 0 && (
                  <View style={styles.docsSection}>
                    <Text style={styles.docsLabel}>Required documents:</Text>
                    {step.requiredDocuments.map(doc => (
                      <Text key={doc} style={styles.docItem}>• {doc}</Text>
                    ))}
                  </View>
                )}
                {step.estimatedDays && step.status !== "completed" && (
                  <Text style={styles.estDays}>Est. {step.estimatedDays} business days</Text>
                )}
              </View>
            </View>
          ))}

          {!data && !isLoading && (
            <Text style={styles.emptyText}>No onboarding data available.</Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.background },
  header:       { flexDirection: "row", alignItems: "center", padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  backBtn:      { marginRight: spacing.sm },
  backText:     { color: colors.primary, fontSize: 14 },
  title:        { fontSize: 18, fontWeight: "700", color: colors.text },
  scroll:       { padding: spacing.md, gap: spacing.md },
  summaryCard:  { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  traderName:   { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  progressBar:  { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden", marginBottom: 8 },
  progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 4 },
  progressMeta: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  progressPct:  { fontSize: 13, fontWeight: "700", color: colors.primary },
  estDate:      { fontSize: 12, color: colors.textSecondary },
  currentStep:  { fontSize: 12, color: colors.textSecondary },
  sectionLabel: { fontSize: 11, fontWeight: "700", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 1 },
  stepCard:     { flexDirection: "row", gap: spacing.md },
  stepLeft:     { alignItems: "center", width: 36 },
  stepCircle:   { width: 32, height: 32, borderRadius: 16, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  stepIcon:     { fontSize: 14, fontWeight: "700" },
  stepLine:     { width: 2, flex: 1, marginTop: 4, opacity: 0.3 },
  stepContent:  { flex: 1, paddingBottom: spacing.md },
  stepTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  stepTitle:    { fontSize: 14, fontWeight: "600", color: colors.text, flex: 1 },
  badge:        { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginLeft: 8 },
  badgeText:    { fontSize: 10, fontWeight: "700" },
  stepDesc:     { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
  completedAt:  { fontSize: 11, color: colors.success },
  docsSection:  { marginTop: 6 },
  docsLabel:    { fontSize: 11, color: colors.textSecondary, marginBottom: 2 },
  docItem:      { fontSize: 11, color: colors.text },
  estDays:      { fontSize: 11, color: colors.warning, marginTop: 4 },
  loader:       { marginTop: 60 },
  emptyText:    { textAlign: "center", color: colors.textSecondary, marginTop: 40 },
});
