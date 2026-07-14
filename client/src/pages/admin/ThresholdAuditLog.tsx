/**
 * Threshold Audit Log — Admin view of all health threshold changes
 * Sprint 136: Item 2
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, History, RefreshCw } from "lucide-react";

const COMPONENTS = ["all", "database", "redis", "tigerbeetle", "temporal", "kafka", "asean_sw", "wco_cen", "permify"];

function DeltaBadge({ from, to }: { from: number; to: number }) {
  const delta = to - from;
  if (delta === 0) return <span className="text-muted-foreground text-xs">±0 ms</span>;
  const isIncrease = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${isIncrease ? "text-amber-500" : "text-emerald-500"}`}>
      {isIncrease ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
      {isIncrease ? "+" : ""}{delta} ms
    </span>
  );
}

export default function ThresholdAuditLog() {
  const [componentFilter, setComponentFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const { data, isLoading, refetch } = trpc.healthThresholds.listAuditLog.useQuery({
    componentName: componentFilter === "all" ? undefined : componentFilter,
    limit,
    offset,
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History size={22} className="text-[#D4A017]" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Threshold Change History</h1>
            <p className="text-sm text-muted-foreground">Audit trail of all health threshold adjustments</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={componentFilter} onValueChange={v => { setComponentFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All components" />
          </SelectTrigger>
          <SelectContent>
            {COMPONENTS.map(c => (
              <SelectItem key={c} value={c}>{c === "all" ? "All components" : c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Audit Entries
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading audit log…</div>
          ) : !data || data.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No threshold changes recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Component</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Changed By</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Degraded (from → to)</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Δ Degraded</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Unhealthy (from → to)</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Reason</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="font-mono text-xs">{row.componentName}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{row.changedBy}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {row.fromDegradedMs} → <span className="text-foreground font-semibold">{row.toDegradedMs}</span> ms
                      </td>
                      <td className="px-4 py-3 text-right">
                        <DeltaBadge from={row.fromDegradedMs} to={row.toDegradedMs} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {row.fromUnhealthyMs ?? "—"} → <span className="text-foreground font-semibold">{row.toUnhealthyMs ?? "—"}</span> ms
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-48 truncate">
                        {row.changeReason ?? <span className="italic">No reason given</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground text-xs whitespace-nowrap">
                        {new Date(row.changedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Showing {offset + 1}–{offset + (data?.length ?? 0)}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={!data || data.length < limit} onClick={() => setOffset(offset + limit)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
