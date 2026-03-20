/**
 * TradeGateway™ NGSWTP — React Native Auth Service
 * Handles JWT storage in iOS Keychain / Android Keystore via react-native-keychain.
 * Supports biometric unlock (Face ID / Fingerprint) via react-native-biometrics.
 */
import * as Keychain from "react-native-keychain";
import ReactNativeBiometrics from "react-native-biometrics";

const SERVICE_NAME = "TradeGateway";
const TOKEN_KEY = "auth_token";
const REFRESH_KEY = "refresh_token";

// ─── Token Storage ────────────────────────────────────────────────────────────

export async function storeAuthToken(token: string, refreshToken: string): Promise<void> {
  await Keychain.setGenericPassword(TOKEN_KEY, token, {
    service: SERVICE_NAME,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await Keychain.setGenericPassword(REFRESH_KEY, refreshToken, {
    service: `${SERVICE_NAME}_refresh`,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function getAuthToken(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: SERVICE_NAME });
    if (credentials && credentials.password) {
      return credentials.password;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: `${SERVICE_NAME}_refresh` });
    if (credentials && credentials.password) {
      return credentials.password;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearAuthTokens(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE_NAME });
  await Keychain.resetGenericPassword({ service: `${SERVICE_NAME}_refresh` });
}

// ─── Biometric Authentication ─────────────────────────────────────────────────

export async function isBiometricAvailable(): Promise<boolean> {
  const rnBiometrics = new ReactNativeBiometrics();
  const { available } = await rnBiometrics.isSensorAvailable();
  return available;
}

export async function authenticateWithBiometric(promptMessage: string): Promise<boolean> {
  try {
    const rnBiometrics = new ReactNativeBiometrics();
    const { success } = await rnBiometrics.simplePrompt({ promptMessage });
    return success;
  } catch {
    return false;
  }
}

// ─── OAuth Flow ───────────────────────────────────────────────────────────────

const API_BASE_URL = process.env.TRADEGATEWAY_API_URL ?? "https://api.tradegateway.gov.ng";

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "admin" | "user";
  traderId?: string;
}

export async function fetchCurrentUser(token: string): Promise<AuthUser | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/trpc/auth.me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.result?.data ?? null;
  } catch {
    return null;
  }
}

export async function logout(token: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/trpc/auth.logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
  } finally {
    await clearAuthTokens();
  }
}
