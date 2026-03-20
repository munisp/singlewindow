/**
 * TradeGateway™ NGSWTP — React Native Auth Context
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getAuthToken, fetchCurrentUser, clearAuthTokens, authenticateWithBiometric, type AuthUser } from "../services/auth";

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (token: string, refreshToken: string) => Promise<void>;
  loginWithBiometric: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const token = await getAuthToken();
      if (token) {
        const u = await fetchCurrentUser(token);
        setUser(u);
      }
      setLoading(false);
    })();
  }, []);

  const login = async (token: string, refreshToken: string) => {
    const { storeAuthToken } = await import("../services/auth");
    await storeAuthToken(token, refreshToken);
    const u = await fetchCurrentUser(token);
    setUser(u);
  };

  const loginWithBiometric = async () => {
    const token = await getAuthToken();
    if (token) {
      const u = await fetchCurrentUser(token);
      setUser(u);
    }
  };

  const logoutFn = async () => {
    await clearAuthTokens();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, loading, login, loginWithBiometric, logout: logoutFn }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
