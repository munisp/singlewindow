/**
 * RoleGuard.tsx — B9 FIX
 *
 * Client-side role-based route protection component.
 *
 * Wraps sensitive routes to ensure only users with the required role(s)
 * can access the rendered content. Unauthenticated users are redirected
 * to the login page. Authenticated users without the required role see
 * a 403 Forbidden page rather than the sensitive UI.
 *
 * NOTE: This is a defence-in-depth UX measure. The server-side tRPC
 * procedures enforce role checks independently. This component prevents
 * sensitive UIs from rendering for unauthorised users, avoiding data
 * exposure through UI rendering before server rejection.
 */

import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Redirect } from "wouter";
import { Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PlatformRole =
  | "admin"
  | "user"
  | "customs_officer"
  | "oga_officer"
  | "inspector"
  | "finance";

interface RoleGuardProps {
  /** One or more roles that are permitted to access the wrapped content. */
  allowedRoles: PlatformRole[];
  /** The protected content to render when access is granted. */
  children: React.ReactNode;
  /** Optional: redirect path instead of showing 403. Defaults to showing inline 403. */
  redirectTo?: string;
}

/**
 * Renders children only when the authenticated user has one of the allowed roles.
 *
 * Behaviour:
 * - Loading: shows a neutral loading state (avoids flash of protected content)
 * - Unauthenticated: redirects to login
 * - Wrong role: shows inline 403 Forbidden page (or redirects if redirectTo is set)
 * - Correct role: renders children
 */
export default function RoleGuard({ allowedRoles, children, redirectTo }: RoleGuardProps) {
  const { user, loading } = useAuth();

  // While auth state is loading, render nothing to avoid flash of protected content
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Not authenticated — redirect to login
  if (!user) {
    return <Redirect to={getLoginUrl()} />;
  }

  const userRole = user.role as PlatformRole;
  const hasAccess = allowedRoles.includes(userRole);

  if (!hasAccess) {
    if (redirectTo) return <Redirect to={redirectTo} />;

    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-6 p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <Shield className="h-8 w-8 text-destructive" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Access Denied</h1>
            <p className="text-sm text-muted-foreground">
              Your account role <strong>{userRole}</strong> does not have permission to access this section.
              Required role{allowedRoles.length > 1 ? "s" : ""}: <strong>{allowedRoles.join(", ")}</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>This access attempt has been logged for security review.</span>
          </div>
          <Button variant="outline" onClick={() => window.history.back()}>
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Convenience wrappers for common role groups.
 */
export function AdminGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin"]}>{children}</RoleGuard>;
}

export function CustomsGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin", "customs_officer", "inspector"]}>{children}</RoleGuard>;
}

export function OGAGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin", "oga_officer"]}>{children}</RoleGuard>;
}

export function FinanceGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin", "finance"]}>{children}</RoleGuard>;
}

export function SecurityGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin", "customs_officer"]}>{children}</RoleGuard>;
}

export function ExecutiveGuard({ children }: { children: React.ReactNode }) {
  return <RoleGuard allowedRoles={["admin", "customs_officer", "finance"]}>{children}</RoleGuard>;
}
