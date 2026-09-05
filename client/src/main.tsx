import { trpc } from "@/lib/trpc";
import "./i18n"; // initialise i18next before render
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { getCsrfToken } from "@/hooks/useCsrf";
import { createRenewingFetch } from "@/lib/renewingFetch";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry failed queries up to 3 times with exponential backoff
      retry: (failureCount, error) => {
        // Don't retry auth errors or client errors
        if (error instanceof TRPCClientError) {
          const code = (error.data as any)?.code;
          if (code === 'UNAUTHORIZED' || code === 'FORBIDDEN' || code === 'NOT_FOUND') return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Cache data for 30 seconds before considering it stale
      staleTime: 30_000,
      // Keep unused data in cache for 5 minutes
      gcTime: 5 * 60_000,
      // Refetch when window regains focus (user returns to tab)
      refetchOnWindowFocus: true,
      // Refetch when network reconnects after going offline
      refetchOnReconnect: true,
    },
    mutations: {
      // Retry mutations once on network error
      retry: (failureCount, error) => {
        if (error instanceof TRPCClientError) return false; // Don't retry server errors
        return failureCount < 1;
      },
    },
  },
});

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      // B3 FIX: Inject CSRF token from cookie into every request header.
      // The server validates X-CSRF-Token matches the csrf-token cookie on mutations.
      headers() {
        const csrfToken = getCsrfToken();
        return csrfToken ? { 'x-csrf-token': csrfToken } : {};
      },
      fetch: (() => {
        const baseFetch: typeof globalThis.fetch = (input, init) =>
          globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
          });
        // Wave 3: on a 401, attempt ONE silent session renewal and retry the
        // original request once before surfacing UNAUTHORIZED to the UI.
        return createRenewingFetch(baseFetch);
      })(),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
