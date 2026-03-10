/**
 * TradeAnalytics.tsx — Delta Lake Trade Analytics Dashboard (Sprint 46)
 * Shows trade volume time-series, HS code breakdown, top traders, route flows,
 * and duty revenue charts sourced from the Python deltalake-svc.
 */

import { useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, DollarSign, FileText, Clock, BarChart2,
  RefreshCw, Database, Globe, Package,
} from "lucide-react";

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4", "#EC4899"];

const fmt = (n: number | undefined) =>
  n === undefined ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K` : `$${n.toFixed(0)}`;

export default function TradeAnalytics() {
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly" | "quarterly">("monthly");

  const { data: stats, isLoading: statsLoading, refetch: refetchStats, isError} = trpc.analytics.getTradeStats.useQuery({ period });
  const { data: hsData } = trpc.analytics.getHsCodeVolume.useQuery({ period });
  const { data: traderData } = trpc.analytics.getTraderMetrics.useQuery({ period, limit: 10 });
  const { data: routeData } = trpc.analytics.getRouteFlow.useQuery({ period });
  const { data: dutyData } = trpc.analytics.getDutyRevenue.useQuery({ period });
  const { data: pipelineStats } = trpc.analytics.getPipelineStats.useQuery();
  const { data: svcStatus } = trpc.analytics.getServiceStatus.useQuery();

  const laneData = stats?.summary?.lane_distribution
    ? Object.entries(stats.summary.lane_distribution).map(([name, value]) => ({ name: name.toUpperCase(), value }))
    : [];

  return (
    <DashboardLayout>
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-blue-500" />
              Trade Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Delta Lake — real-time trade statistics pipeline
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={svcStatus?.online ? "default" : "destructive"} className="text-xs">
              <Database className="h-3 w-3 mr-1" />
              {svcStatus?.online ? "Pipeline Online" : "Pipeline Offline"}
            </Badge>
            <Select value={period} onValueChange={(v) => setPeriod(v as typeof period)}>
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => refetchStats()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Pipeline KPIs */}
        {pipelineStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="h-4 w-4 text-blue-500" />
                  <span className="text-xs text-muted-foreground">Total Events</span>
                </div>
                <p className="text-2xl font-bold">{pipelineStats.total_events?.toLocaleString() ?? "—"}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <DollarSign className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Total Trade Value</span>
                </div>
                <p className="text-2xl font-bold">{fmt(pipelineStats.total_trade_value_usd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-amber-500" />
                  <span className="text-xs text-muted-foreground">Duty Revenue</span>
                </div>
                <p className="text-2xl font-bold">{fmt(pipelineStats.total_duty_revenue_usd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Globe className="h-4 w-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">Origin Countries</span>
                </div>
                <p className="text-2xl font-bold">{pipelineStats.origin_countries ?? "—"}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Summary Stats */}
        {stats?.summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Declarations</p>
                <p className="text-xl font-bold">{stats.summary.total_declarations?.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Trade Value</p>
                <p className="text-xl font-bold">{fmt(stats.summary.total_value_usd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Duty Collected</p>
                <p className="text-xl font-bold">{fmt(stats.summary.total_duty_usd)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Avg Clearance</p>
                <p className="text-xl font-bold">{stats.summary.avg_clearance_hours?.toFixed(1)}h</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-xs text-muted-foreground mb-1">Green Lane %</p>
                <p className="text-xl font-bold text-green-600">
                  {stats.summary.lane_distribution?.green
                    ? `${((stats.summary.lane_distribution.green / stats.summary.total_declarations) * 100).toFixed(0)}%`
                    : "—"}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Declaration Volume Time-Series */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                Declaration Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
              ) : stats?.time_series?.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={stats.time_series}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="declaration_count" stroke="#3B82F6" dot={false} name="Declarations" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                  No data — pipeline offline or no events ingested
                </div>
              )}
            </CardContent>
          </Card>

          {/* Duty Revenue Time-Series */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-green-500" />
                Duty Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dutyData?.time_series?.length ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={dutyData.time_series}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, "Duty Revenue"]} />
                    <Bar dataKey="duty_revenue_usd" fill="#10B981" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Lane Distribution Pie */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Lane Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {laneData.length ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={laneData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {laneData.map((_, i) => (
                        <Cell key={i} fill={["#10B981", "#F59E0B", "#EF4444", "#3B82F6"][i] ?? COLORS[i]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>

          {/* HS Code Volume */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Package className="h-4 w-4 text-purple-500" />
                Top HS Code Chapters by Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {hsData?.hs_volumes?.length ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hsData.hs_volumes.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="hs_chapter" type="category" tick={{ fontSize: 10 }} width={40} />
                    <Tooltip formatter={(v: number) => [v.toLocaleString(), "Declarations"]} />
                    <Bar dataKey="declaration_count" fill="#8B5CF6" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-44 flex items-center justify-center text-muted-foreground text-sm">No data</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Top Traders Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              Top Traders by Volume
            </CardTitle>
          </CardHeader>
          <CardContent>
            {traderData?.traders?.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 pr-4">Trader ID</th>
                      <th className="text-right py-2 pr-4">Declarations</th>
                      <th className="text-right py-2 pr-4">Trade Value</th>
                      <th className="text-right py-2 pr-4">Duty Paid</th>
                      <th className="text-right py-2 pr-4">Avg Clearance</th>
                      <th className="text-right py-2">Green Lane %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {traderData.traders.map((t, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono text-xs">{t.trader_id}</td>
                        <td className="text-right py-2 pr-4">{t.declaration_count.toLocaleString()}</td>
                        <td className="text-right py-2 pr-4">{fmt(t.total_value_usd)}</td>
                        <td className="text-right py-2 pr-4">{fmt(t.total_duty_usd)}</td>
                        <td className="text-right py-2 pr-4">{t.avg_clearance_hours.toFixed(1)}h</td>
                        <td className="text-right py-2">
                          <Badge variant={t.green_lane_rate >= 0.8 ? "default" : "secondary"} className="text-xs">
                            {(t.green_lane_rate * 100).toFixed(0)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-20 flex items-center justify-center text-muted-foreground text-sm">No trader data</div>
            )}
          </CardContent>
        </Card>

        {/* Route Flow */}
        {routeData?.routes?.length ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Globe className="h-4 w-4 text-cyan-500" />
                Top Trade Routes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={routeData.routes.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="route" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="declaration_count" fill="#06B6D4" radius={[2, 2, 0, 0]} name="Declarations" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
