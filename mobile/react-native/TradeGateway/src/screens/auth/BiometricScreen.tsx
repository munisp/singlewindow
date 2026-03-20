import React, { useEffect } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { authenticateWithBiometric } from "../../services/auth";
import { useAuth } from "../../contexts/AuthContext";

export default function BiometricScreen() {
  const navigation = useNavigation<any>();
  const { loginWithBiometric } = useAuth();

  useEffect(() => { promptBiometric(); }, []);

  const promptBiometric = async () => {
    const success = await authenticateWithBiometric("Authenticate to access TradeGateway");
    if (success) {
      await loginWithBiometric();
    } else {
      Alert.alert("Authentication Failed", "Please try again or use your password.", [
        { text: "Try Again", onPress: promptBiometric },
        { text: "Use Password", onPress: () => navigation.navigate("Login") },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔐</Text>
      <Text style={styles.title}>Biometric Authentication</Text>
      <Text style={styles.subtitle}>Use Face ID or fingerprint to unlock TradeGateway</Text>
      <TouchableOpacity style={styles.btn} onPress={promptBiometric}>
        <Text style={styles.btnText}>Authenticate</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0A1628", alignItems: "center", justifyContent: "center", padding: 24 },
  icon: { fontSize: 64, marginBottom: 16 },
  title: { color: "#FFFFFF", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  subtitle: { color: "#9CA3AF", fontSize: 14, textAlign: "center", marginBottom: 32 },
  btn: { backgroundColor: "#D4A017", borderRadius: 8, paddingVertical: 14, paddingHorizontal: 32 },
  btnText: { color: "#0A1628", fontSize: 16, fontWeight: "700" },
});