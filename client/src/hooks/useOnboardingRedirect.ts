/**
 * Sprint 69 — First-Login Redirect to Onboarding Wizard
 *
 * useOnboardingRedirect: automatically redirects trader-role users who have
 * not yet completed the onboarding wizard to /app/onboarding.
 *
 * Rules:
 * - Only triggers for authenticated users with role "user" (traders)
 * - Only triggers when hasCompletedOnboarding === false
 * - Does NOT trigger on the onboarding page itself (prevents redirect loop)
 * - Does NOT trigger on public pages (/, /specification, /share/*)
 * - Admins, customs officers, OGA officers, inspectors, and finance users
 *   are never redirected (they don't need onboarding)
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

// Pages that should never trigger the onboarding redirect
const EXEMPT_PATHS = [
  "/app/onboarding",
  "/",
  "/specification",
];

const EXEMPT_PREFIXES = [
  "/share/",
];

// Roles that are exempt from onboarding (non-trader roles)
const EXEMPT_ROLES = [
  "admin",
  "customs_officer",
  "oga_officer",
  "inspector",
  "finance",
];

export function useOnboardingRedirect() {
  const [location, navigate] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery();

  useEffect(() => {
    if (isLoading) return;
    if (!user) return;

    // Exempt roles never need onboarding
    if (EXEMPT_ROLES.includes(user.role)) return;

    // Check if current path is exempt
    if (EXEMPT_PATHS.includes(location)) return;
    if (EXEMPT_PREFIXES.some(prefix => location.startsWith(prefix))) return;

    // Only redirect if onboarding is not complete
    // hasCompletedOnboarding comes from the extended auth.me response (Sprint 69)
    const hasCompleted = (user as typeof user & { hasCompletedOnboarding?: boolean }).hasCompletedOnboarding;

    if (hasCompleted === false) {
      navigate("/app/onboarding");
    }
  }, [user, isLoading, location, navigate]);

  return {
    isCheckingOnboarding: isLoading,
    hasCompletedOnboarding: (user as (typeof user & { hasCompletedOnboarding?: boolean }) | null)?.hasCompletedOnboarding ?? true,
  };
}
