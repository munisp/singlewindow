import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import {
  renewSessionOnce,
  scheduleSessionRefresh,
  syncEdgeSessionRenewal,
  teardownSessionRefresh,
} from "@/lib/sessionRefresh";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
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
      // Best-effort: also terminate the edge (oauth2-proxy) session so the
      // portal cookie is really gone, not just the backend session cookie.
      // Same-origin; redirect handled manually so we don't navigate away here.
      try {
        await fetch("/oauth2/sign_out", {
          credentials: "include",
          redirect: "manual",
        });
      } catch {
        /* oauth2-proxy not in the path (dev) — backend logout already done */
      }
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
  // refreshed (expiresAt − 60s). Additionally, for the edge (cookie-based)
  // flow, fetch the credential's expiry from the server and schedule a
  // proactive silent SSO renewal so the portal never bounces on a hard 401.
  useEffect(() => {
    if (!state.user) return;
    scheduleSessionRefresh();
    void syncEdgeSessionRenewal();
  }, [state.user]);

  // Session drop: attempt an imperative silent renewal (refresh grant when
  // tokens exist, otherwise silent edge round-trip) before falling back to
  // the SSO redirect.
  useEffect(() => {
    const err = meQuery.error;
    if (
      err instanceof TRPCClientError &&
      err.data?.code === "UNAUTHORIZED"
    ) {
      void renewSessionOnce().then((renewed) => {
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
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
