/**
 * PlatformHealthScorecard — Sprint v104
 * Admin page showing composite platform health score (0-100) + per-service breakdown.
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Activity, CheckCircle, AlertTriangle, XCircle } from "lucide-react";

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r="54" fill="none" stroke="hsl(var(--muted))" strokeWidth="12" />
        <circle
          cx="70" cy="70" r="54"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text x="70" y="65" textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>{score}</text>
        <text x="70" y="85" textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">/ 100</text>
      </svg>
    </div>
  );
}

export default function PlatformHealthScorecard() {
  const { data, isLoading, refetch, isFetching } = trpc.system.getPlatformHealthScore.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const score = data?.score ?? 0;
  const status = data?.status ?? "unknown";
  const services = data?.services ?? {};
  const serviceEntries = Object.entries(services as Record<string, boolean>);

  const statusBadge = {
    healthy: { variant: "default" as const, label: "Healthy" },
    degraded: { variant: "secondary" as const, label: "Degraded" },
    critical: { variant: "destructive" as const, label: "Critical" },
    unknown: { variant: "outline" as const, label: "Unknown" },
  }[status] ?? { variant: "outline" as const, label: status };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Platform Health Scorecard</h1>
          <p className="text-sm text-muted-foreground mt-1">Composite health score across all microservices</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Score Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Overall Score
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            {isLoading ? (
              <div className="h-36 flex items-center justify-center text-muted-foreground">Loading…</div>
            ) : (
              <>
                <ScoreGauge score={score} />
                <Badge variant={statusBadge.variant} className="text-sm px-3 py-1">{statusBadge.label}</Badge>
                <div className="grid grid-cols-2 gap-3 w-full text-center">
                  <div className="bg-muted/40 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground">Healthy</p>
                    <p className="text-lg font-bold text-green-500">{data?.healthy ?? 0}</p>
                  </div>
                  <div className="bg-muted/40 rounded-lg p-2">
                    <p className="text-xs text-muted-foreground">Down</p>
                    <p className="text-lg font-bold text-red-500">{data?.down ?? 0}</p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Service Breakdown */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Service Status Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-y-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-3 font-medium">Service</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={2} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
                  ) : serviceEntries.length === 0 ? (
                    <tr><td colSpan={2} className="text-center py-8 text-muted-foreground">No service data</td></tr>
                  ) : (
                    serviceEntries
                      .sort(([, a], [, b]) => (a === b ? 0 : a ? 1 : -1))
                      .map(([name, ok]) => (
                        <tr key={name} className="border-b hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs">{name}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {ok ? (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              ) : (
                                <XCircle className="h-4 w-4 text-red-500" />
                              )}
                              <Badge variant={ok ? "default" : "destructive"} className="text-xs">
                                {ok ? "Healthy" : "Down"}
                              </Badge>
                            </div>
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
    </div>
  );
}
