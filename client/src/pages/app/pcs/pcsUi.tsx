/**
 * pcsUi.tsx — shared PCS UI components (Phase 8; spec §5.3/§5.4).
 *
 * Down-vs-empty taxonomy (ministry-portal api-state.tsx precedent):
 *   - DEGRADED (endpoint down / not configured) → PcsDegradedBanner with retry
 *   - EMPTY (upstream healthy, zero rows)       → PcsEmptyState
 * Cached data is never substituted silently; every rendered figure traces to
 * its provenance (source event / port-call record version / projection lag).
 */
import { AlertTriangle, Info, RefreshCw, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface PcsGap {
  id: string;
  summary: string;
  affected: string;
  neededUpstream: string;
}

export type PcsResultLike<T> =
  | { status: "ok"; data: T; gaps: PcsGap[] }
  | { status: "unavailable"; reason: string; detail: string; gaps: PcsGap[] };

/** DEGRADED state: the upstream endpoint is down — with retry. Never silently swapped for cached/empty data. */
export function PcsDegradedBanner({ reason, detail, onRetry }: { reason: string; detail: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-400" />
        <div className="flex-1">
          <p className="font-medium text-amber-300">
            Port Community System temporarily unavailable
            <span className="ml-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-xs uppercase">{reason.replace(/_/g, " ")}</span>
          </p>
          <p className="mt-1 text-sm text-amber-200/80">{detail}</p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-3 border-amber-500/30 text-amber-200" onClick={onRetry}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** EMPTY state: upstream healthy, zero rows — an honest empty, not an outage. */
export function PcsEmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-600/50 py-12 text-center">
      <Inbox className="h-8 w-8 text-slate-500" />
      <p className="mt-3 font-medium text-slate-300">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500">{hint}</p>
    </div>
  );
}

/** INTEGRATION_GAPS disclosures — rendered verbatim, never dropped. */
export function PcsGapList({ gaps }: { gaps: PcsGap[] }) {
  if (!gaps.length) return null;
  return (
    <div className="space-y-2">
      {gaps.map((gap) => (
        <div key={gap.id} className="flex items-start gap-2.5 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <div className="text-sm">
            <span className="font-mono text-xs text-sky-300">{gap.id}</span>
            <p className="text-slate-300">{gap.summary}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Affected: {gap.affected} · Needed upstream: {gap.neededUpstream}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Provenance line (ministry-portal precedent): every figure traces to its source. */
export function ProvenanceLine({ source, detail }: { source: string; detail?: string }) {
  return (
    <p className="mt-1 font-mono text-[11px] text-slate-500">
      Source: {source}
      {detail ? ` · ${detail}` : ""}
    </p>
  );
}

export function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatLag(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "lag unknown";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}min`;
}

export const MILESTONE_LABELS: Record<string, string> = {
  pre_arrival: "Pre-arrival",
  arrived: "Arrived",
  berthed: "Berthed",
  ops_started: "Operations started",
  discharging: "Discharging",
  customs_hold: "Customs hold",
  customs_released: "Customs released",
  gate_out: "Gate out",
  departed: "Departed",
};
