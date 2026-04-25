/// TradeGateway™ NGSWTP — React Native AEO Self-Assessment Screen
import React, { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, SafeAreaView,
} from "react-native";
import { useApiClient } from "../../hooks/useApiClient";

interface Criterion {
  id: string;
  category: string;
  description: string;
  weight: number;
  status: "compliant" | "partial" | "non_compliant" | "not_assessed";
}

const STATUS_COLORS: Record<string, string> = {
  compliant: "#10B981",
  partial: "#F59E0B",
  non_compliant: "#EF4444",
  not_assessed: "#6B7280",
};

const STATUS_LABELS: Record<string, string> = {
  compliant: "Compliant",
  partial: "Partial",
  non_compliant: "Non-Compliant",
  not_assessed: "Not Assessed",
};

export default function AeoSelfAssessmentScreen() {
  const [loading, setLoading] = useState(true);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [score, setScore] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const { get, post } = useApiClient();

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      setLoading(true);
      const data = await get("/api/trpc/aeo.selfAssessmentCriteria?input=%7B%22json%22%3Anull%7D");
      const items: Criterion[] = data?.result?.data?.json ?? [];
      setCriteria(items);
      calculateScore(items);
    } catch {
      // Use default criteria if API not available
      const defaults: Criterion[] = [
        { id: "1", category: "Customs Compliance", description: "Record of customs compliance for the past 3 years", weight: 20, status: "not_assessed" },
        { id: "2", category: "Accounting Systems", description: "Satisfactory system of managing commercial and transport records", weight: 15, status: "not_assessed" },
        { id: "3", category: "Financial Solvency", description: "Proven financial solvency for the past 3 years", weight: 15, status: "not_assessed" },
        { id: "4", category: "Security Standards", description: "Appropriate security standards including physical access controls", weight: 20, status: "not_assessed" },
        { id: "5", category: "Business Partner Security", description: "Security requirements communicated to business partners", weight: 10, status: "not_assessed" },
        { id: "6", category: "Personnel Security", description: "Background checks for staff with access to cargo", weight: 10, status: "not_assessed" },
        { id: "7", category: "Training & Awareness", description: "Security awareness training programme for relevant staff", weight: 10, status: "not_assessed" },
      ];
      setCriteria(defaults);
      calculateScore(defaults);
    } finally {
      setLoading(false);
    }
  };

  const calculateScore = (items: Criterion[]) => {
    const total = items.reduce((sum, c) => {
      if (c.status === "compliant") return sum + c.weight;
      if (c.status === "partial") return sum + c.weight * 0.5;
      return sum;
    }, 0);
    setScore(Math.round(total));
  };

  const updateStatus = (id: string, status: Criterion["status"]) => {
    const updated = criteria.map(c => c.id === id ? { ...c, status } : c);
    setCriteria(updated);
    calculateScore(updated);
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await post("/api/trpc/aeo.submitSelfAssessment", { json: { criteria, score } });
      Alert.alert("Success", "Self-assessment submitted successfully! Our team will review your application.", [{ text: "OK" }]);
    } catch {
      Alert.alert("Error", "Failed to submit assessment. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const scoreColor = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : "#EF4444";

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#D4A017" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Score Card */}
        <View style={styles.scoreCard}>
          <Text style={styles.scoreLabel}>AEO Readiness Score</Text>
          <Text style={[styles.scoreValue, { color: scoreColor }]}>{score}%</Text>
          <View style={styles.scoreBar}>
            <View style={[styles.scoreBarFill, { width: `${score}%` as any, backgroundColor: scoreColor }]} />
          </View>
          <Text style={styles.scoreHint}>
            {score >= 80 ? "Excellent — ready to apply" : score >= 60 ? "Good — address partial items" : "Needs improvement"}
          </Text>
        </View>

        {/* Criteria */}
        {criteria.map(criterion => (
          <View key={criterion.id} style={styles.criterionCard}>
            <View style={styles.criterionHeader}>
              <View style={styles.criterionMeta}>
                <Text style={styles.criterionCategory}>{criterion.category}</Text>
                <Text style={styles.criterionWeight}>Weight: {criterion.weight}%</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[criterion.status] + "33" }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[criterion.status] }]}>
                  {STATUS_LABELS[criterion.status]}
                </Text>
              </View>
            </View>
            <Text style={styles.criterionDesc}>{criterion.description}</Text>
            <View style={styles.statusButtons}>
              {(["compliant", "partial", "non_compliant"] as const).map(s => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, criterion.status === s && { backgroundColor: STATUS_COLORS[s] }]}
                  onPress={() => updateStatus(criterion.id, s)}
                >
                  <Text style={[styles.statusBtnText, criterion.status === s && { color: "#000" }]}>
                    {STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, saving && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={saving}
        >
          {saving
            ? <ActivityIndicator size="small" color="#000" />
            : <Text style={styles.submitBtnText}>Submit Self-Assessment</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0A1628" },
  scroll: { padding: 16, paddingBottom: 32 },
  scoreCard: { backgroundColor: "#1E3A5F", borderRadius: 12, padding: 20, marginBottom: 16, alignItems: "center" },
  scoreLabel: { color: "#9CA3AF", fontSize: 14, marginBottom: 8 },
  scoreValue: { fontSize: 48, fontWeight: "700", marginBottom: 8 },
  scoreBar: { width: "100%", height: 8, backgroundColor: "#374151", borderRadius: 4, overflow: "hidden", marginBottom: 8 },
  scoreBarFill: { height: "100%", borderRadius: 4 },
  scoreHint: { color: "#9CA3AF", fontSize: 13 },
  criterionCard: { backgroundColor: "#1E3A5F", borderRadius: 10, padding: 14, marginBottom: 10 },
  criterionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },
  criterionMeta: { flex: 1 },
  criterionCategory: { color: "#FFFFFF", fontWeight: "600", fontSize: 14 },
  criterionWeight: { color: "#D4A017", fontSize: 11, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "600" },
  criterionDesc: { color: "#9CA3AF", fontSize: 12, marginBottom: 10, lineHeight: 18 },
  statusButtons: { flexDirection: "row", gap: 6 },
  statusBtn: { flex: 1, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: "#374151", alignItems: "center" },
  statusBtnText: { color: "#9CA3AF", fontSize: 11, fontWeight: "600" },
  submitBtn: { backgroundColor: "#D4A017", borderRadius: 10, padding: 16, alignItems: "center", marginTop: 8 },
  submitBtnDisabled: { backgroundColor: "#4B5563" },
  submitBtnText: { color: "#000000", fontWeight: "700", fontSize: 16 },
});
