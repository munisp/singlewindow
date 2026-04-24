/**
 * TradeGateway™ NGSWTP — React Native Trader Onboarding Screen
 * Parity with PWA TraderOnboarding page. Uses trpc.traderOnboarding procedures.
 */
import React, { useCallback } from "react";
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator, TouchableOpacity,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { trpc } from "../../services/trpc";

const STEP_ICONS: Record<string, string> = {
  registration: "📋",
  kyc: "🪪",
  document_upload: "📄",
  compliance_check: "✅",
  approval: "🏆",
};

export default function TraderOnboardingScreen() {
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = React.useState(false);
  const { data, isLoading, refetch } = trpc.traderOnboarding.getProgress.useQuery(undefined, { retry: 2 });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const steps = data?.steps ?? [];
  const completedSteps = steps.filter((s: any) => s.status === "completed").length;
  const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Trader Onboarding</Text>

      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : (
        <>
          {/* Progress Overview */}
          <View style={styles.progressCard}>
            <View style={styles.progressHeader}>
              <Text style={styles.progressLabel}>Overall Progress</Text>
              <Text style={styles.progressPct}>{progressPct}%</Text>
            </View>
            <View style={styles.progressBarBg}>
              <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressSub}>
              {completedSteps} of {steps.length} steps completed
            </Text>
          </View>

          {/* Steps */}
          <View style={styles.stepsContainer}>
            {steps.map((step: any, i: number) => {
              const isCompleted = step.status === "completed";
              const isActive = step.status === "in_progress";
              const isPending = step.status === "pending";
              return (
                <View key={step.id ?? i} style={styles.stepRow}>
                  {/* Connector line */}
                  {i < steps.length - 1 && (
                    <View style={[styles.connector, isCompleted && styles.connectorDone]} />
                  )}
                  {/* Step circle */}
                  <View style={[
                    styles.stepCircle,
                    isCompleted && styles.stepCircleDone,
                    isActive && styles.stepCircleActive,
                  ]}>
                    <Text style={styles.stepIcon}>{STEP_ICONS[step.type] ?? "•"}</Text>
                  </View>
                  {/* Step content */}
                  <View style={styles.stepContent}>
                    <Text style={[styles.stepTitle, isCompleted && { color: "#059669" }]}>
                      {step.title ?? step.type?.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
                    </Text>
                    <Text style={styles.stepDesc}>{step.description ?? ""}</Text>
                    {isActive && (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => {
                          if (step.type === "kyc") navigation.navigate("KYC");
                          else if (step.type === "document_upload") navigation.navigate("DocumentVault");
                        }}
                      >
                        <Text style={styles.actionBtnText}>Continue →</Text>
                      </TouchableOpacity>
                    )}
                    {isCompleted && (
                      <Text style={styles.completedText}>
                        ✓ Completed {step.completedAt ? new Date(step.completedAt).toLocaleDateString() : ""}
                      </Text>
                    )}
                    {isPending && (
                      <Text style={styles.pendingText}>Pending previous step</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Completion Banner */}
          {progressPct === 100 && (
            <View style={styles.completionBanner}>
              <Text style={styles.completionTitle}>🎉 Onboarding Complete!</Text>
              <Text style={styles.completionSub}>Your trader account is fully activated.</Text>
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
  progressCard: { margin: 16, backgroundColor: "#1E3A5F", borderRadius: 10, padding: 16 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  progressLabel: { color: "#9CA3AF", fontSize: 13 },
  progressPct: { color: "#D4A017", fontSize: 20, fontWeight: "700" },
  progressBarBg: { height: 8, backgroundColor: "#0A1628", borderRadius: 4, marginBottom: 6 },
  progressBarFill: { height: 8, backgroundColor: "#D4A017", borderRadius: 4 },
  progressSub: { color: "#9CA3AF", fontSize: 12 },
  stepsContainer: { paddingHorizontal: 16, paddingBottom: 16 },
  stepRow: { flexDirection: "row", marginBottom: 20, position: "relative" },
  connector: { position: "absolute", left: 19, top: 40, width: 2, height: 30, backgroundColor: "#1E3A5F" },
  connectorDone: { backgroundColor: "#059669" },
  stepCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#1E3A5F", alignItems: "center", justifyContent: "center", marginRight: 12 },
  stepCircleDone: { backgroundColor: "#05966920", borderWidth: 2, borderColor: "#059669" },
  stepCircleActive: { backgroundColor: "#D4A01720", borderWidth: 2, borderColor: "#D4A017" },
  stepIcon: { fontSize: 18 },
  stepContent: { flex: 1, paddingTop: 8 },
  stepTitle: { color: "#FFFFFF", fontSize: 14, fontWeight: "600", marginBottom: 2 },
  stepDesc: { color: "#9CA3AF", fontSize: 12, marginBottom: 6 },
  actionBtn: { backgroundColor: "#D4A017", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, alignSelf: "flex-start" },
  actionBtnText: { color: "#0A1628", fontSize: 12, fontWeight: "700" },
  completedText: { color: "#059669", fontSize: 12 },
  pendingText: { color: "#6B7280", fontSize: 12 },
  completionBanner: { margin: 16, backgroundColor: "#05966920", borderRadius: 10, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#059669" },
  completionTitle: { color: "#059669", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  completionSub: { color: "#9CA3AF", fontSize: 13 },
});
