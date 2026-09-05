import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  attemptSessionRefresh,
  scheduleSessionRefresh,
  teardownSessionRefresh,
} from "@/lib/sessionRefresh";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  // Compute the SSO login URL lazily: getLoginUrl() throws when
  // VITE_KEYCLOAK_LOGIN_URL is unset (e.g. local DEMO_MODE without Keycloak),
  // and a default-parameter evaluation would crash every useAuth caller even
  // when no redirect is ever requested.
  const resolvedRedirectPath = useMemo(() => {
    if (redirectPath) return redirectPath;
    if (!redirectOnUnauthenticated) return undefined;
    return getLoginUrl();
  }, [redirectPath, redirectOnUnauthenticated]);
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      teardownSessionRefresh();
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // Silent session renewal: when a Keycloak token set is stored, keep it
  // refreshed (expiresAt − 60s). No-op when the cookie-based flow is active.
  useEffect(() => {
    if (state.user) scheduleSessionRefresh();
  }, [state.user]);

  // Session drop: attempt an imperative silent refresh before falling back
  // to the SSO redirect.
  useEffect(() => {
    const err = meQuery.error;
    if (
      err instanceof TRPCClientError &&
      err.data?.code === "UNAUTHORIZED"
    ) {
      void attemptSessionRefresh().then((renewed) => {
        if (renewed) void meQuery.refetch();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQuery.error]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (!resolvedRedirectPath) return;
    if (window.location.pathname === resolvedRedirectPath) return;

    window.location.href = resolvedRedirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
    resolvedRedirectPath,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
