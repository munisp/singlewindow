import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Linking, ActivityIndicator } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../../contexts/AuthContext";

const API_BASE = process.env.TRADEGATEWAY_API_URL ?? "https://api.tradegateway.gov.ng";

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const { login } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleOAuthLogin = async () => {
    setLoading(true);
    try {
      const loginUrl = `${API_BASE}/api/oauth/login?redirect_uri=${encodeURIComponent("tradegateway://auth/callback")}`;
      await Linking.openURL(loginUrl);
    } catch (e) {
      Alert.alert("Error", "Could not open login page. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.logo}>TradeGateway™</Text>
      <Text style={styles.subtitle}>NGSWTP — Next Generation Single Window</Text>
      <TouchableOpacity style={styles.loginBtn} onPress={handleOAuthLogin} disabled={loading}>
        {loading ? <ActivityIndicator color="#0A1628" /> : <Text style={styles.loginText}>Sign in with Manus ID</Text>}
      </TouchableOpacity>
      <Text style={styles.footer}>Powered by TradeGateway™ NGSWTP v1.0</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628", alignItems: "center", justifyContent: "center", padding: 24 },
  logo: { color: "#D4A017", fontSize: 36, fontWeight: "700", marginBottom: 8 },
  subtitle: { color: "#9CA3AF", fontSize: 14, textAlign: "center", marginBottom: 48 },
  loginBtn: { backgroundColor: "#D4A017", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 32, width: "100%", alignItems: "center" },
  loginText: { color: "#0A1628", fontSize: 16, fontWeight: "700" },
  footer: { color: "#374151", fontSize: 12, marginTop: 48 },
});