/**
 * QueryErrorState.tsx
 *
 * Shared error state for data-fetching failures (tRPC/react-query).
 * Renders an explicit error panel with an optional retry action instead of
 * an infinite spinner. Used by role guards and role-gated pages so backend
 * 401/403/5xx responses surface as a clean, actionable UI.
 */

import { AlertTriangle, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

interface QueryErrorStateProps {
  /** Optional heading. Defaults to a generic failure message. */
  title?: string;
  /** Error or message to display. */
  error?: unknown;
  /** Called when the user clicks Retry. */
  onRetry?: () => void;
  /** Render the access-denied variant (shield icon, copy for 401/403). */
  accessDenied?: boolean;
}

function messageOf(error: unknown): string {
  if (!error) return "";
  if (error instanceof Error) return error.message;
  return String(error);
}

export default function QueryErrorState({
  title,
  error,
  onRetry,
  accessDenied = false,
}: QueryErrorStateProps) {
  const Icon = accessDenied ? ShieldAlert : AlertTriangle;
  const heading =
    title ?? (accessDenied ? "Access Denied" : "Something went wrong");
  const detail = messageOf(error);

  return (
    <div className="flex items-center justify-center min-h-[40vh] w-full">
      <div className="flex flex-col items-center gap-4 p-8 max-w-md w-full text-center">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
          <Icon className="h-7 w-7 text-destructive" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">{heading}</h2>
        {detail && (
          <p className="text-sm text-muted-foreground break-words">{detail}</p>
        )}
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
