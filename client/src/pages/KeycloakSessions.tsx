/**
 * KeycloakSessions — Sprint v90
 * Admin page showing active Keycloak SSO sessions with revoke capability.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Users, Search, XCircle } from "lucide-react";
import { toast } from "sonner";

export default function KeycloakSessions() {
  const [userFilter, setUserFilter] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.keycloak.getSessions.useQuery(
    { isActive: true },
    { refetchInterval: 30_000 }
  );

  const revokeMutation = trpc.keycloak.revokeSession.useMutation({
    onSuccess: () => {
      toast.success("Session revoked successfully");
      refetch();
    },
    onError: (err: any) => toast.error(`Revoke failed: ${err.message}`),
  });

  const sessions = (data ?? []).filter((s: any) =>
    !userFilter || s.userId?.toString().includes(userFilter) || s.ipAddress?.includes(userFilter)
  );

  const allSessions = data ?? [];
  const stats = {
    activeSessions: allSessions.filter((s: any) => s.isActive).length,
    uniqueUsers: new Set(allSessions.map((s: any) => s.userId)).size,
    revokedLast24h: allSessions.filter((s: any) => !s.isActive).length,
    totalSessions: allSessions.length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Keycloak Sessions</h1>
          <p className="text-sm text-muted-foreground mt-1">Active SSO sessions — revoke suspicious sessions instantly</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Sessions", value: stats.activeSessions ?? 0, color: "text-green-500" },
            { label: "Unique Users", value: stats.uniqueUsers ?? 0, color: "text-blue-500" },
            { label: "Revoked (24h)", value: stats.revokedLast24h ?? 0, color: "text-orange-500" },
            { label: "Total Sessions", value: stats.totalSessions ?? 0, color: "text-foreground" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="pt-4 pb-3">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value.toLocaleString()}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter by user ID or IP…"
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Sessions Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Active Sessions
            <Badge variant="secondary" className="ml-auto">{sessions.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-3 font-medium">User ID</th>
                  <th className="text-left px-4 py-3 font-medium">Realm</th>
                  <th className="text-left px-4 py-3 font-medium">Client</th>
                  <th className="text-left px-4 py-3 font-medium">IP Address</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                  <th className="text-left px-4 py-3 font-medium">Expires</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                ) : sessions.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No active sessions</td></tr>
                ) : (
                  sessions.map((s: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-3 font-mono text-xs">{s.userId}</td>
                      <td className="px-4 py-3 text-xs">{s.realm ?? "master"}</td>
                      <td className="px-4 py-3 text-xs">{s.clientId ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{s.ipAddress ?? "—"}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {s.startedAt ? new Date(s.startedAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {s.expiresAt ? new Date(s.expiresAt).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={s.isActive ? "default" : "secondary"} className="text-xs">
                          {s.isActive ? "Active" : "Expired"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {s.isActive && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-destructive hover:text-destructive"
                            onClick={() => revokeMutation.mutate({ sessionId: s.sessionId ?? s.id })}
                            disabled={revokeMutation.isPending}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Revoke
                          </Button>
                        )}
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
