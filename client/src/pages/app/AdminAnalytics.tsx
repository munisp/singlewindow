import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  BarChart3, TrendingUp, FileText, Clock, CheckCircle,
  DollarSign, Package, AlertTriangle, Download,
} from "lucide-react";

// ─── CSV Export Utility ───────────────────────────────────────────────────────
function exportToCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(","),
    ...rows.map((row) =>
      headers.map((h) => {
        const val = row[h];
        const str = val == null ? "" : String(val);
        return str.includes(",") || str.includes('"') || str.includes("\n")
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      }).join(",")
    ),
  ].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function DownloadCsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={disabled} className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-foreground">
      <Download className="h-3.5 w-3.5" />CSV
    </Button>
  );
}

const LANE_COLORS: Record<string, string> = {
  green: "#22c55e", yellow: "#eab308", red: "#ef4444", blue: "#3b82f6", unknown: "#94a3b8",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8", submitted: "#3b82f6", under_review: "#a855f7", pending_payment: "#f59e0b",
  cleared: "#22c55e", rejected: "#ef4444", cancelled: "#6b7280", on_hold: "#f97316", inspection_required: "#ec4899",
};

function KPICard({ label, value, icon, sub, loading }: {
  label: string; value: string | number | null; icon: React.ReactNode; sub?: string; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">{icon}</div>
        <div>
          {loading ? <Skeleton className="h-7 w-20 mb-1" /> : <p className="text-2xl font-bold tracking-tight">{value ?? "—"}</p>}
          <p className="text-sm text-muted-foreground">{label}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAnalytics() {
  const [throughputDays, setThroughputDays] = useState("30");
  const [revenueDays, setRevenueDays] = useState("30");

  const { data: kpis, isLoading: kpiLoading } = trpc.adminAnalytics.kpiSummary.useQuery();
  const { data: throughput, isLoading: throughputLoading } = trpc.adminAnalytics.declarationThroughput.useQuery({ days: parseInt(throughputDays) });
  const { data: clearanceTimes, isLoading: clearanceLoading } = trpc.adminAnalytics.clearanceTimeByLane.useQuery();
  const { data: revenueTrend, isLoading: revenueLoading } = trpc.adminAnalytics.dutyRevenueTrend.useQuery({ days: parseInt(revenueDays) });
  const { data: topChapters, isLoading: chaptersLoading } = trpc.adminAnalytics.topHSChapters.useQuery({ limit: 10 });
  const { data: statusDist, isLoading: statusLoading } = trpc.adminAnalytics.declarationsByStatus.useQuery();

  const fmt = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K` : `$${n.toFixed(0)}`;

  return (
    <DashboardLayout title="Analytics">
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />Platform Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Real-time metrics across all declarations, payments, and clearance operations</p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Total Declarations" value={kpis?.totalDeclarations?.toLocaleString() ?? null} icon={<FileText className="h-5 w-5 text-blue-500" />} loading={kpiLoading} />
          <KPICard label="Total Duty Revenue" value={kpis ? fmt(kpis.totalRevenue) : null} icon={<DollarSign className="h-5 w-5 text-emerald-500" />} loading={kpiLoading} />
          <KPICard label="Avg Clearance Time" value={kpis?.avgClearanceHours != null ? `${kpis.avgClearanceHours}h` : "N/A"} icon={<Clock className="h-5 w-5 text-amber-500" />} sub="Cleared declarations only" loading={kpiLoading} />
          <KPICard label="Clearance Rate" value={kpis ? `${kpis.clearanceRate}%` : null} icon={<CheckCircle className="h-5 w-5 text-green-500" />} sub="Of all submitted declarations" loading={kpiLoading} />
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Declaration Throughput</CardTitle>
              <CardDescription className="text-xs mt-0.5">Declarations submitted per day</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <DownloadCsvButton
                disabled={!throughput?.length}
                onClick={() => exportToCsv(`throughput_last_${throughputDays}_days.csv`, throughput ?? [])}
              />
            <Select value={throughputDays} onValueChange={setThroughputDays}>
              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select></div>
          </CardHeader>
          <CardContent>
            {throughputLoading ? <Skeleton className="h-52 w-full" /> : !throughput?.length ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No declaration data in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart data={throughput} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5) ?? ""} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v, "Declarations"]} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Avg Clearance Time by Lane</CardTitle>
              <CardDescription className="text-xs">Hours from submission to clearance</CardDescription>
            </CardHeader>
            <CardContent>
              {clearanceLoading ? <Skeleton className="h-48 w-full" /> : !clearanceTimes?.length ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No cleared declarations yet</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={clearanceTimes} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="lane" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 10 }} unit="h" />
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v}h`, "Avg clearance"]} />
                    <Bar dataKey="avgHours" radius={[3, 3, 0, 0]}>
                      {clearanceTimes.map((entry) => <Cell key={entry.lane} fill={LANE_COLORS[entry.lane] ?? "#94a3b8"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />Status Distribution</CardTitle>
              <CardDescription className="text-xs">All declarations by current status</CardDescription>
            </div>
            <DownloadCsvButton
              disabled={!statusDist?.length}
              onClick={() => exportToCsv("declaration_status_distribution.csv", statusDist ?? [])}
            />
          </CardHeader>
            <CardContent>
              {statusLoading ? <Skeleton className="h-48 w-full" /> : !statusDist?.length ? (
                <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No declaration data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusDist} dataKey="count" nameKey="status" cx="50%" cy="50%" outerRadius={75}
                      label={({ status, percent }) => percent > 0.05 ? `${(status ?? "").replace(/_/g, " ")} ${(percent * 100).toFixed(0)}%` : ""}
                      labelLine={false}
                    >
                      {statusDist.map((entry) => <Cell key={entry.status ?? "unknown"} fill={STATUS_COLORS[entry.status ?? ""] ?? "#94a3b8"} />)}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number, name: string) => [v, (name ?? "").replace(/_/g, " ")]} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><DollarSign className="h-4 w-4" />Duty Revenue Trend</CardTitle>
              <CardDescription className="text-xs mt-0.5">Total duty collected per day (completed payments)</CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <DownloadCsvButton
                disabled={!revenueTrend?.length}
                onClick={() => exportToCsv(`duty_revenue_last_${revenueDays}_days.csv`, revenueTrend ?? [])}
              />
            <Select value={revenueDays} onValueChange={setRevenueDays}>
              <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="60">Last 60 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select></div>
          </CardHeader>
          <CardContent>
            {revenueLoading ? <Skeleton className="h-52 w-full" /> : !revenueTrend?.length ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">No payment data in this period</div>
            ) : (
              <ResponsiveContainer width="100%" height={210}>
                <LineChart data={revenueTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(v) => v?.slice(5) ?? ""} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`$${v.toLocaleString()}`, "Revenue"]} />
                  <Line type="monotone" dataKey="totalRevenue" stroke="#22c55e" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Top HS Chapters by Volume</CardTitle>
              <CardDescription className="text-xs">Most frequently declared commodity chapters</CardDescription>
            </div>
            <DownloadCsvButton
              disabled={!topChapters?.length}
              onClick={() => exportToCsv("top_hs_chapters.csv", topChapters ?? [])}
            />
          </CardHeader>
          <CardContent>
            {chaptersLoading ? <Skeleton className="h-48 w-full" /> : !topChapters?.length ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No HS code data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topChapters} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="chapter" tick={{ fontSize: 11 }} width={32} tickFormatter={(v) => `Ch.${v}`} />
                  <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [v, "Declarations"]} labelFormatter={(l) => `HS Chapter ${l}`} />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
