/**
 * PermifyAuditLog — Sprint v91
 * Admin page showing Permify authorization audit log with stats.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Lock, Search } from "lucide-react";

export default function PermifyAuditLog() {
  const [operationFilter, setOperationFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.permify.getAuditLog.useQuery(
    { operation: operationFilter || undefined, entity: entityFilter || undefined, limit: 100 },
    { refetchInterval: 60_000 }
  );

  const statsQuery = trpc.permify.getAuditStats.useQuery(undefined, { refetchInterval: 120_000 });

  const rows = data ?? [];
  const statsRaw = statsQuery.data ?? [];
  const stats = {
    total: statsRaw.reduce((s: number, r: any) => s + (r.total ?? 0), 0),
    checkOps: statsRaw.find((r: any) => r.operation === 'check')?.total ?? 0,
    writeOps: statsRaw.find((r: any) => r.operation === 'write')?.total ?? 0,
    deleteOps: statsRaw.find((r: any) => r.operation === 'delete')?.total ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Permify Audit Log</h1>
          <p className="text-sm text-muted-foreground mt-1">Authorization decision history — check, write, and delete operations</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Operations", value: stats.total ?? 0 },
            { label: "Check Ops", value: stats.checkOps ?? 0 },
            { label: "Write Ops", value: stats.writeOps ?? 0 },
            { label: "Delete Ops", value: stats.deleteOps ?? 0 },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-bold mt-1">{s.value.toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by operation…"
            value={operationFilter}
            onChange={(e) => setOperationFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by entity…"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Authorization Events
            <Badge variant="secondary" className="ml-auto">{rows.length} records</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">Operation</th>
                  <th className="text-left px-4 py-3 font-medium">Entity Type</th>
                  <th className="text-left px-4 py-3 font-medium">Entity ID</th>
                  <th className="text-left px-4 py-3 font-medium">Subject</th>
                  <th className="text-left px-4 py-3 font-medium">Relation</th>
                  <th className="text-left px-4 py-3 font-medium">Decision</th>
                  <th className="text-left px-4 py-3 font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-muted-foreground">No audit records found</td></tr>
                ) : (
                  rows.map((row: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs font-mono">{row.operation}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs">{row.entityType ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.entityId ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.subjectId ?? "—"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{row.relation ?? "—"}</td>
                      <td className="px-4 py-3">
                        {row.decision != null ? (
                          <Badge variant={row.decision ? "default" : "destructive"} className="text-xs">
                            {row.decision ? "Allowed" : "Denied"}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
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
