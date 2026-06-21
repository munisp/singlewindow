/**
 * JsonDiffViewer.tsx — Side-by-side JSON diff viewer with line-level highlighting.
 *
 * Renders a before/after comparison of two JSON objects.
 * Lines are colour-coded:
 *   - Red background  → removed (only in before)
 *   - Green background → added (only in after)
 *   - Yellow background → changed (key exists in both but value differs)
 *   - Neutral          → unchanged
 *
 * Usage:
 *   <JsonDiffViewer before={oldObj} after={newObj} />
 */

import React, { useMemo } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type DiffLineKind = "unchanged" | "added" | "removed" | "changed";

interface DiffLine {
  key: string;
  beforeValue: string | undefined;
  afterValue: string | undefined;
  kind: DiffLineKind;
}

// ─── Diff computation ─────────────────────────────────────────────────────────

function flattenObject(obj: unknown, prefix = ""): Record<string, string> {
  if (obj === null || obj === undefined) return {};
  if (typeof obj !== "object" || Array.isArray(obj)) {
    return { [prefix || "value"]: JSON.stringify(obj) };
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenObject(v, path));
    } else {
      result[path] = JSON.stringify(v);
    }
  }
  return result;
}

function computeDiff(before: unknown, after: unknown): DiffLine[] {
  const flatBefore = flattenObject(before);
  const flatAfter = flattenObject(after);
  const allKeys = Array.from(new Set([...Object.keys(flatBefore), ...Object.keys(flatAfter)])).sort();

  return allKeys.map((key): DiffLine => {
    const bv = flatBefore[key];
    const av = flatAfter[key];

    if (bv === undefined) {
      return { key, beforeValue: undefined, afterValue: av, kind: "added" };
    }
    if (av === undefined) {
      return { key, beforeValue: bv, afterValue: undefined, kind: "removed" };
    }
    if (bv !== av) {
      return { key, beforeValue: bv, afterValue: av, kind: "changed" };
    }
    return { key, beforeValue: bv, afterValue: av, kind: "unchanged" };
  });
}

// ─── Styling ──────────────────────────────────────────────────────────────────

const KIND_STYLES: Record<DiffLineKind, { row: string; badge: string; label: string }> = {
  unchanged: {
    row: "bg-transparent",
    badge: "bg-muted text-muted-foreground",
    label: "=",
  },
  added: {
    row: "bg-green-500/10 border-l-2 border-green-500",
    badge: "bg-green-500/20 text-green-700 dark:text-green-400",
    label: "+",
  },
  removed: {
    row: "bg-red-500/10 border-l-2 border-red-500",
    badge: "bg-red-500/20 text-red-700 dark:text-red-400",
    label: "−",
  },
  changed: {
    row: "bg-yellow-500/10 border-l-2 border-yellow-500",
    badge: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
    label: "~",
  },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function DiffRow({ line, showUnchanged }: { line: DiffLine; showUnchanged: boolean }) {
  if (line.kind === "unchanged" && !showUnchanged) return null;
  const s = KIND_STYLES[line.kind];

  return (
    <div className={`flex items-start gap-2 px-3 py-1 text-xs font-mono rounded-sm ${s.row}`}>
      {/* Kind badge */}
      <span className={`shrink-0 w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${s.badge}`}>
        {s.label}
      </span>

      {/* Key */}
      <span className="shrink-0 text-muted-foreground min-w-[140px] max-w-[200px] truncate">
        {line.key}
      </span>

      {/* Before → After */}
      <div className="flex items-center gap-1 flex-1 min-w-0">
        {line.beforeValue !== undefined && (
          <span className={`truncate ${line.kind === "removed" || line.kind === "changed" ? "line-through text-red-600 dark:text-red-400" : "text-foreground"}`}>
            {line.beforeValue}
          </span>
        )}
        {line.kind === "changed" && (
          <span className="text-muted-foreground shrink-0">→</span>
        )}
        {line.afterValue !== undefined && line.kind !== "unchanged" && (
          <span className={`truncate ${line.kind === "added" || line.kind === "changed" ? "text-green-700 dark:text-green-400" : "text-foreground"}`}>
            {line.afterValue}
          </span>
        )}
        {line.kind === "unchanged" && (
          <span className="text-foreground truncate">{line.afterValue}</span>
        )}
      </div>
    </div>
  );
}

// ─── Summary bar ──────────────────────────────────────────────────────────────

function DiffSummary({ lines }: { lines: DiffLine[] }) {
  const counts = {
    added: lines.filter((l) => l.kind === "added").length,
    removed: lines.filter((l) => l.kind === "removed").length,
    changed: lines.filter((l) => l.kind === "changed").length,
    unchanged: lines.filter((l) => l.kind === "unchanged").length,
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b text-xs text-muted-foreground">
      {counts.added > 0 && (
        <span className="text-green-600 dark:text-green-400 font-medium">+{counts.added} added</span>
      )}
      {counts.removed > 0 && (
        <span className="text-red-600 dark:text-red-400 font-medium">−{counts.removed} removed</span>
      )}
      {counts.changed > 0 && (
        <span className="text-yellow-600 dark:text-yellow-400 font-medium">~{counts.changed} changed</span>
      )}
      {counts.unchanged > 0 && (
        <span>{counts.unchanged} unchanged</span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface JsonDiffViewerProps {
  before: unknown;
  after: unknown;
  /** Show unchanged lines (default: false — only show diffs) */
  showUnchanged?: boolean;
  /** Max height with scroll (default: 400px) */
  maxHeight?: string;
  className?: string;
}

export function JsonDiffViewer({
  before,
  after,
  showUnchanged = false,
  maxHeight = "400px",
  className = "",
}: JsonDiffViewerProps) {
  const lines = useMemo(() => computeDiff(before, after), [before, after]);
  const hasChanges = lines.some((l) => l.kind !== "unchanged");

  if (!hasChanges && !showUnchanged) {
    return (
      <div className={`rounded border p-4 text-sm text-muted-foreground text-center ${className}`}>
        No changes detected between before and after snapshots.
      </div>
    );
  }

  return (
    <div className={`rounded border overflow-hidden ${className}`}>
      <DiffSummary lines={lines} />
      <div
        className="overflow-y-auto space-y-0.5 p-2"
        style={{ maxHeight }}
      >
        {lines.map((line) => (
          <DiffRow key={line.key} line={line} showUnchanged={showUnchanged} />
        ))}
      </div>
    </div>
  );
}

export default JsonDiffViewer;
