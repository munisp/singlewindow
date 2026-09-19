/**
 * TradeGateway™ NGSWTP — React Native App Entry Point
 */
import React, { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { trpc, createTRPCClient, API_BASE_URL } from "./src/services/trpc";
import { getAuthToken } from "./src/services/auth";
import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import AppNavigator from "./src/navigation/AppNavigator";
// Phase 20: mount the previously-orphaned push-notification hook so the
// device token is actually registered via pushTokens.registerPushToken.
import { usePushNotifications } from "./src/hooks/usePushNotifications";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30_000 },
    mutations: { retry: 0 },
  },
});

const trpcClient = createTRPCClient();

function AppContent() {
  const { user, isAuthenticated, loading } = useAuth();
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setAuthToken(null);
      return;
    }
    let cancelled = false;
    getAuthToken().then((t) => {
      if (!cancelled) setAuthToken(t);
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  usePushNotifications({
    userId: user?.id != null ? String(user.id) : null,
    authToken,
    apiBaseUrl: API_BASE_URL,
  });

  if (loading) return null;
  return <AppNavigator isAuthenticated={isAuthenticated} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <trpc.Provider client={trpcClient} queryClient={queryClient}>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <AppContent />
            </AuthProvider>
          </QueryClientProvider>
        </trpc.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
