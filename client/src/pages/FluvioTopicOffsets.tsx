/**
 * FluvioTopicOffsets — Sprint v88
 * Admin page showing Fluvio topic consumer-group lag as a bar chart + table.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

function lagColor(lag: number | null) {
  if (lag === null) return "#94a3b8";
  if (lag === 0) return "#22c55e";
  if (lag < 1000) return "#f59e0b";
  return "#ef4444";
}

export default function FluvioTopicOffsets() {
  const { data, isLoading, refetch, isFetching } = trpc.fluvio.getTopicOffsets.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const offsets = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fluvio Topic Offsets</h1>
          <p className="text-sm text-muted-foreground mt-1">Consumer-group lag per topic — refreshes every 30 s</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Lag Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4 text-primary" />
            Consumer Lag by Topic
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">Loading…</div>
          ) : offsets.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">No offset reports available</div>
          ) : (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={offsets} margin={{ top: 8, right: 16, left: 0, bottom: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="topic" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: number) => [v.toLocaleString(), "Lag"]}
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Bar dataKey="lagCount" radius={[4, 4, 0, 0]}>
                    {offsets.map((entry, i) => (
                      <Cell key={i} fill={lagColor(entry.displayStatus === "unknown / stale" ? null : Number(entry.lagCount))} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Topic Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">Topic</th>
                  <th className="text-left px-4 py-3 font-medium">Consumer Group</th>
                  <th className="text-right px-4 py-3 font-medium">Latest Offset</th>
                  <th className="text-right px-4 py-3 font-medium">Committed Offset</th>
                  <th className="text-right px-4 py-3 font-medium">Lag</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Recorded At</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : offsets.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No records found</td></tr>
                ) : (
                  offsets.map((row, i) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">{row.topic}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.consumerGroup ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.latestOffset?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs">{row.committedOffset?.toLocaleString() ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-semibold" style={{ color: lagColor(row.displayStatus === "unknown / stale" ? null : Number(row.lagCount)) }}>
                        {row.displayStatus === "unknown / stale" ? "—" : Number(row.lagCount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={row.displayStatus === "healthy" ? "default" : "secondary"} className="text-xs">
                          {row.displayStatus}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.lastUpdatedAt ? new Date(row.lastUpdatedAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
