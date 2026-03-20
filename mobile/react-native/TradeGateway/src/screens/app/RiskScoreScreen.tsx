/**
 * TradeGateway™ NGSWTP — React Native Risk Assessment Screen
 * Parity with PWA Risk Assessment page. Uses trpc.riskModel.getScore.useQuery.
 */
import React from "react";
import { View, Text, ScrollView, ActivityIndicator, StyleSheet, RefreshControl } from "react-native";
import { trpc } from "../../services/trpc";

export default function RiskScoreScreen() {
  const { data, isLoading, refetch } = trpc.riskModel.getScore.useQuery(undefined, { retry: 2 });
  const [refreshing, setRefreshing] = React.useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D4A017" />}
    >
      <Text style={styles.title}>Risk Assessment</Text>
      {isLoading ? (
        <ActivityIndicator color="#D4A017" style={{ marginTop: 32 }} />
      ) : (
        <View style={styles.content}>
          <Text style={styles.dataText}>{JSON.stringify(data, null, 2)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628" },
  title: { color: "#FFFFFF", fontSize: 20, fontWeight: "700", padding: 16 },
  content: { padding: 16 },
  dataText: { color: "#9CA3AF", fontSize: 12, fontFamily: "monospace" },
});
