/**
 * Sprint 59 — Real-Time Port Congestion Prediction
 * Forecasts berth congestion 24–72 hours ahead.
 * Shows: network summary, per-port forecast charts, SLA breach alerts.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import {
  Anchor, AlertTriangle, TrendingUp, CheckCircle2, Clock,
  Activity, RefreshCw, Ship,
} from "lucide-react";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type CongestionLevel = "clear" | "moderate" | "congested" | "critical";

const LEVEL_COLOR: Record<CongestionLevel, string> = {
  clear:     "text-green-400",
  moderate:  "text-yellow-400",
  congested: "text-orange-400",
  critical:  "text-red-400",
};
const LEVEL_BG: Record<CongestionLevel, string> = {
  clear:     "bg-green-500/10 border-green-500/30",
  moderate:  "bg-yellow-500/10 border-yellow-500/30",
  congested: "bg-orange-500/10 border-orange-500/30",
  critical:  "bg-red-500/10 border-red-500/30",
};
const LEVEL_LABEL: Record<CongestionLevel, string> = {
  clear: "Clear", moderate: "Moderate", congested: "Congested", critical: "Critical",
};

function CongestionBadge({ level }: { level: CongestionLevel }) {
  return (
    <Badge variant="outline" className={`${LEVEL_COLOR[level]} ${LEVEL_BG[level]} text-xs`}>
      {LEVEL_LABEL[level]}
    </Badge>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function PortCongestionForecast() {
  const [selectedPort, setSelectedPort] = useState<string>("GHTEM");
  const [horizon, setHorizon] = useState<"24" | "48" | "72">("24");

  const portsQ = trpc.portCongestion.listPorts.useQuery();
  const summaryQ = trpc.portCongestion.getNetworkSummary.useQuery(undefined, { refetchInterval: 60_000 });
  const forecastQ = trpc.portCongestion.getPortForecast.useQuery(
    { portCode: selectedPort },
    { refetchInterval: 60_000 }
  );
  const alertsQ = trpc.portCongestion.getSlaBreachAlerts.useQuery(
    { portCode: undefined },
    { refetchInterval: 60_000 }
  );
  const allForecastsQ = trpc.portCongestion.getAllForecasts.useQuery(undefined, { refetchInterval: 60_000 });

  const forecast = forecastQ.data;
  const chartData = (() => {
    if (!forecast) return [];
    const series = horizon === "24" ? forecast.forecast24h : horizon === "48" ? forecast.forecast48h : forecast.forecast72h;
    return series.map((f) => ({
      label: `+${f.hour}h`,
      score: f.predictedScore,
      vessels: f.vesselCount,
      declarations: f.pendingDeclarations,
      sla: f.slaBreachRisk,
    }));
  })();

  const slaThreshold = portsQ.data?.find((p) => p.portCode === selectedPort)?.slaThreshold ?? 70;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Anchor className="w-6 h-6 text-blue-400" />
              Port Congestion Forecast
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Predictive berth congestion 24–72 hours ahead — vessel AIS, dwell time, and cargo volume model
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => { summaryQ.refetch(); forecastQ.refetch(); alertsQ.refetch(); allForecastsQ.refetch(); }}
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </Button>
        </div>

        {/* Network Summary */}
        {summaryQ.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : summaryQ.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Critical Ports", value: summaryQ.data.criticalPorts, icon: <AlertTriangle className="w-5 h-5 text-red-400" />, color: "text-red-400" },
              { label: "Congested Ports", value: summaryQ.data.congestedPorts, icon: <Activity className="w-5 h-5 text-orange-400" />, color: "text-orange-400" },
              { label: "Avg Congestion", value: `${summaryQ.data.avgCongestionScore}%`, icon: <TrendingUp className="w-5 h-5 text-blue-400" />, color: "text-blue-400" },
              { label: "SLA Breach Alerts", value: summaryQ.data.totalSlaBreachAlerts, icon: <Clock className="w-5 h-5 text-yellow-400" />, color: "text-yellow-400" },
            ].map((stat) => (
              <Card key={stat.label} className="bg-card border-border">
                <CardContent className="p-4 flex items-center gap-3">
                  {stat.icon}
                  <div>
                    <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-xs text-muted-foreground">{stat.label}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Port Overview Table */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Ship className="w-4 h-4" /> Port Network Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            {allForecastsQ.isLoading ? (
              <Skeleton className="h-32" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left py-2 pr-4">Port</th>
                      <th className="text-left py-2 pr-4">Country</th>
                      <th className="text-left py-2 pr-4">Current</th>
                      <th className="text-right py-2 pr-4">Score</th>
                      <th className="text-right py-2 pr-4">Peak (72h)</th>
                      <th className="text-right py-2">SLA Alerts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allForecastsQ.data?.map((p) => (
                      <tr
                        key={p.portCode}
                        className={`border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors ${selectedPort === p.portCode ? "bg-muted/30" : ""}`}
                        onClick={() => setSelectedPort(p.portCode)}
                      >
                        <td className="py-2 pr-4 font-medium">{p.portName}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{p.country}</td>
                        <td className="py-2 pr-4"><CongestionBadge level={p.currentLevel as CongestionLevel} /></td>
                        <td className="py-2 pr-4 text-right font-mono">{p.currentScore}%</td>
                        <td className="py-2 pr-4 text-right font-mono">{p.peakScore}% (+{p.peakHour}h)</td>
                        <td className="py-2 text-right">
                          {p.slaBreachCount > 0 ? (
                            <Badge variant="outline" className="text-red-400 border-red-500/30 bg-red-500/10 text-xs">
                              {p.slaBreachCount}
                            </Badge>
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-green-400 ml-auto" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Forecast Chart */}
        <Card className="bg-card border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {forecast?.portName ?? selectedPort} — Congestion Forecast
                </CardTitle>
                <CardDescription>
                  Predicted congestion score over the next {horizon} hours
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select value={selectedPort} onValueChange={setSelectedPort}>
                  <SelectTrigger className="w-44 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {portsQ.data?.map((p) => (
                      <SelectItem key={p.portCode} value={p.portCode}>{p.portName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={horizon} onValueChange={(v) => setHorizon(v as typeof horizon)}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24 hours</SelectItem>
                    <SelectItem value="48">48 hours</SelectItem>
                    <SelectItem value="72">72 hours</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {forecastQ.isLoading ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    interval={Math.floor(chartData.length / 8)}
                  />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#6b7280" }} />
                  <Tooltip
                    contentStyle={{ background: "#1a1a2e", border: "1px solid #374151", borderRadius: 8 }}
                    labelStyle={{ color: "#9ca3af" }}
                    formatter={(value: number, name: string) => [
                      name === "score" ? `${value}%` : value,
                      name === "score" ? "Congestion Score" : name === "vessels" ? "Vessel Count" : "Pending Declarations",
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={slaThreshold} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `SLA (${slaThreshold}%)`, fill: "#ef4444", fontSize: 10 }} />
                  <Line type="monotone" dataKey="score" stroke="#3b82f6" strokeWidth={2} dot={false} name="score" />
                  <Line type="monotone" dataKey="vessels" stroke="#10b981" strokeWidth={1} dot={false} name="vessels" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* SLA Breach Alerts */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              SLA Breach Alerts (72h Horizon)
            </CardTitle>
            <CardDescription>Ports where predicted congestion exceeds SLA threshold</CardDescription>
          </CardHeader>
          <CardContent>
            {alertsQ.isLoading ? (
              <Skeleton className="h-32" />
            ) : alertsQ.data?.length === 0 ? (
              <div className="flex items-center gap-2 text-green-400 text-sm">
                <CheckCircle2 className="w-4 h-4" /> No SLA breach alerts in the next 72 hours
              </div>
            ) : (
              <div className="space-y-2">
                {alertsQ.data?.slice(0, 10).map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border text-sm ${alert.severity === "critical" ? "bg-red-500/10 border-red-500/30" : "bg-yellow-500/10 border-yellow-500/30"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium">{alert.portName}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={alert.severity === "critical" ? "text-red-400 border-red-500/30 text-xs" : "text-yellow-400 border-yellow-500/30 text-xs"}>
                          {alert.severity.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">+{alert.forecastHour}h</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{alert.message}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
