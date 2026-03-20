/**
 * TradeGateway™ NGSWTP — React Native tRPC Client
 * Connects to the same backend as the PWA using tRPC + React Query.
 * Authentication uses JWT stored in react-native-keychain (biometric-protected).
 */
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../../../../../server/routers";
import { getAuthToken } from "./auth";

export const trpc = createTRPCReact<AppRouter>();

const API_BASE_URL = process.env.TRADEGATEWAY_API_URL ?? "https://api.tradegateway.gov.ng";

export function createTRPCClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${API_BASE_URL}/api/trpc`,
        transformer: superjson,
        async headers() {
          const token = await getAuthToken();
          return token ? { Authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

export function isTRPCError(err: unknown): err is TRPCClientError<AppRouter> {
  return err instanceof TRPCClientError;
}

export function isUnauthorized(err: unknown): boolean {
  if (!isTRPCError(err)) return false;
  return err.data?.code === "UNAUTHORIZED" || err.message.includes("10001");
}
