/**
 * useCsrf.ts — B3 FIX (Client Side)
 *
 * Reads the CSRF token from the 'csrf-token' cookie (set by the server after login)
 * and returns it so the tRPC client can include it in the X-CSRF-Token header.
 *
 * Usage: The token is automatically injected into the tRPC httpBatchLink in main.tsx.
 * Individual components do not need to call this hook directly.
 */

/**
 * Reads the CSRF token from the browser cookie store.
 * Returns null if the cookie is not present (unauthenticated state).
 */
export function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)csrf-token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
