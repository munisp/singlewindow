/**
 * LoadingIndicator — Global loading utilities for TradeGateway NGSWTP
 *
 * Provides:
 *   - <TopLoadingBar />       — NProgress-style top bar (shown during route transitions)
 *   - <PageSkeleton />        — Full-page skeleton for lazy-loaded pages
 *   - <TableSkeleton />       — Skeleton for data tables
 *   - <CardSkeleton />        — Skeleton for stat cards
 *   - <FormSkeleton />        — Skeleton for forms
 *   - <InlineLoader />        — Small inline spinner with optional text
 *   - <OverlayLoader />       — Full-screen overlay loader for mutations
 *   - useLoadingState()       — Hook to track multiple loading states
 */
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Skeleton base ─────────────────────────────────────────────────────────────
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded bg-[#1E3A5F]/40",
        className
      )}
    />
  );
}

// ── Top loading bar (NProgress-style) ────────────────────────────────────────
let _setProgress: ((v: number) => void) | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;

export function startTopLoader() {
  if (_timer) clearTimeout(_timer);
  _setProgress?.(20);
  _timer = setTimeout(() => _setProgress?.(60), 300);
}

export function finishTopLoader() {
  if (_timer) clearTimeout(_timer);
  _setProgress?.(100);
  _timer = setTimeout(() => _setProgress?.(0), 400);
}

export function TopLoadingBar() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    _setProgress = setProgress;
    return () => { _setProgress = null; };
  }, []);

  if (progress === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] h-0.5 pointer-events-none">
      <div
        className="h-full bg-[#D4A017] transition-all duration-300 ease-out shadow-[0_0_8px_#D4A017]"
        style={{ width: `${progress}%`, opacity: progress === 100 ? 0 : 1 }}
      />
    </div>
  );
}

// ── Page skeleton ─────────────────────────────────────────────────────────────
export function PageSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#0A1628] border border-[#1E3A5F]/40 rounded-lg p-4 space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="bg-[#0A1628] border border-[#1E3A5F]/40 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[#1E3A5F]/30">
          <div className="flex gap-3">
            <Skeleton className="h-9 flex-1 max-w-xs" />
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="divide-y divide-[#1E3A5F]/20">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-28 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Table skeleton ────────────────────────────────────────────────────────────
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {/* Header */}
      <div className="flex gap-4 px-4 py-2 bg-[#0A1628] rounded-t border-b border-[#1E3A5F]/30">
        {[...Array(cols)].map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex gap-4 px-4 py-3 border-b border-[#1E3A5F]/10">
          {[...Array(cols)].map((_, j) => (
            <Skeleton key={j} className={cn("h-4 flex-1", j === 2 ? "max-w-[80px] rounded-full" : "")} />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Card skeleton ─────────────────────────────────────────────────────────────
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className={`grid grid-cols-2 md:grid-cols-${Math.min(count, 4)} gap-4 animate-pulse`}>
      {[...Array(count)].map((_, i) => (
        <div key={i} className="bg-[#0A1628] border border-[#1E3A5F]/40 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

// ── Form skeleton ─────────────────────────────────────────────────────────────
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <div className="space-y-4 animate-pulse">
      {[...Array(fields)].map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
      <Skeleton className="h-10 w-28 mt-2" />
    </div>
  );
}

// ── Inline loader ─────────────────────────────────────────────────────────────
export function InlineLoader({
  text = "Loading...",
  size = "sm",
  className,
}: {
  text?: string;
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const sizeMap = { xs: "w-3 h-3", sm: "w-4 h-4", md: "w-5 h-5" };
  const textMap = { xs: "text-xs", sm: "text-sm", md: "text-base" };
  return (
    <div className={cn("flex items-center gap-2 text-slate-400", textMap[size], className)}>
      <Loader2 className={cn("animate-spin", sizeMap[size])} />
      {text && <span>{text}</span>}
    </div>
  );
}

// ── Overlay loader ────────────────────────────────────────────────────────────
export function OverlayLoader({
  visible,
  text = "Processing...",
}: {
  visible: boolean;
  text?: string;
}) {
  if (!visible) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 bg-[#0A1628] border border-[#1E3A5F]/50 rounded-xl p-8 shadow-2xl">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-[#1E3A5F]/30" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-2 border-t-[#D4A017] animate-spin" />
        </div>
        <p className="text-sm text-slate-300">{text}</p>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="p-4 bg-[#1E3A5F]/20 rounded-full mb-4">
          <Icon className="w-8 h-8 text-slate-500" />
        </div>
      )}
      <p className="text-slate-300 font-medium">{title}</p>
      {description && <p className="text-slate-500 text-sm mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Loading state hook ────────────────────────────────────────────────────────
export function useLoadingState(initial = false) {
  const [loading, setLoading] = useState(initial);
  const countRef = useRef(0);

  const start = () => {
    countRef.current++;
    setLoading(true);
  };

  const stop = () => {
    countRef.current = Math.max(0, countRef.current - 1);
    if (countRef.current === 0) setLoading(false);
  };

  async function wrap<T>(fn: () => Promise<T>): Promise<T> {
    start();
    try {
      return await fn();
    } finally {
      stop();
    }
  };

  return { loading, start, stop, wrap };
}

// ── Lazy fallback (used in App.tsx Suspense) ──────────────────────────────────
export function LazyFallback() {
  return <PageSkeleton />;
}
