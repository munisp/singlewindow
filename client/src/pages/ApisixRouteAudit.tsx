/**
 * ApisixRouteAudit — Sprint v89
 * Admin page showing APISIX route audit log with filtering by route/action/actor.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Shield, Search } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  create: "default",
  update: "secondary",
  delete: "destructive",
  enable: "default",
  disable: "secondary",
};

export default function ApisixRouteAudit() {
  const [routeFilter, setRouteFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.apisixAudit.getRouteAudit.useQuery(
    { routeId: routeFilter || undefined, limit: 100 },
    { refetchInterval: 60_000 }
  );

  const rows = data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">APISIX Route Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">Configuration change history for all API Gateway routes</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by route…"
            value={routeFilter}
            onChange={(e) => setRouteFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="relative flex-1 min-w-[160px]">
          <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter by action…"
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Audit Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Route Change Log
            <Badge variant="secondary" className="ml-auto">{rows.length} records</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">Route ID</th>
                  <th className="text-left px-4 py-3 font-medium">Route Name</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                  <th className="text-left px-4 py-3 font-medium">Actor</th>
                  <th className="text-left px-4 py-3 font-medium">Plugin</th>
                  <th className="text-left px-4 py-3 font-medium">Changed At</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No audit records found</td></tr>
                ) : (
                  rows.map((row: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">{row.routeId}</td>
                      <td className="px-4 py-3 text-xs">{row.routeName ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Badge variant={(ACTION_COLORS[row.action] ?? "secondary") as any} className="text-xs capitalize">
                          {row.action}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{row.actorEmail ?? row.actorId ?? "system"}</td>
                      <td className="px-4 py-3 text-xs font-mono">{row.pluginName ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {row.changedAt ? new Date(row.changedAt).toLocaleString() : "—"}
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
