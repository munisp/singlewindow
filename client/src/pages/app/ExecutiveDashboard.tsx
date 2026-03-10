import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  TrendingUp, DollarSign, FileText, Users, Shield, CheckCircle,
  Download, RefreshCw, BarChart2, AlertTriangle,
} from "lucide-react";

function fmt(n: number) {
  if (n >= 1_000_000_000) return `₦${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `₦${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `₦${(n / 1_000).toFixed(0)}K`;
  return `₦${n.toLocaleString()}`;
}

export default function ExecutiveDashboard() {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [isExporting, setIsExporting] = useState(false);

  const { data: revenue, isLoading, isError, refetch: refetchRevenue } = trpc.executiveDashboard.getRevenueCounter.useQuery();
  const { data: kpi, refetch: refetchKpi } = trpc.executiveDashboard.getKpiSummary.useQuery();
  const { data: daily } = trpc.executiveDashboard.getDailyCollectionVsTarget.useQuery({ dailyTargetNaira: 500_000_000 });
  const { data: topChapters } = trpc.executiveDashboard.getTopHsChapters.useQuery({ limit: 10 });

  const exportCsvMutation = trpc.executiveDashboard.exportRevenueCsv.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([data.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `executive-revenue-${dateFrom}-to-${dateTo}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Revenue CSV downloaded");
      setIsExporting(false);
    },
    onError: (e) => {
      toast.error(e.message);
      setIsExporting(false);
    },
  });

  const handleExport = () => {
    setIsExporting(true);
    exportCsvMutation.mutate({ startDate: new Date(dateFrom), endDate: new Date(dateTo) });
  };

  const dailyPct = daily ? Math.min(100, Math.round((daily.collectedNaira / daily.targetNaira) * 100)) : 0;

  if (isLoading) return (
    <DashboardLayout>
      <div className="p-6 flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading executive dashboard...
        </div>
      </div>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Failed to load executive data. Please refresh the page.
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <BarChart2 className="h-6 w-6 text-yellow-600" />
              Executive Revenue Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Read-only real-time revenue intelligence for Finance Ministry and senior government officials.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="border rounded px-2 py-1 text-sm bg-background"
            />
            <Button variant="outline" onClick={() => { refetchRevenue(); refetchKpi(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              <Download className="h-4 w-4 mr-2" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
        </div>

        {/* Revenue Counter — 4 big numbers */}
        {revenue && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Today", value: fmt(revenue.todayNaira), color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
              { label: "This Month", value: fmt(revenue.monthNaira), color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
              { label: "This Year", value: fmt(revenue.yearNaira), color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
              { label: "All Time", value: fmt(revenue.allTimeNaira), color: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200" },
            ].map(item => (
              <Card key={item.label} className={`border ${item.bg}`}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign className={`h-4 w-4 ${item.color}`} />
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                  <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Daily Collection vs Target Gauge */}
        {daily && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Daily Collection vs. Target
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Collected: <strong className="text-foreground">{fmt(daily.collectedNaira)}</strong></span>
                <span className="text-sm text-muted-foreground">Target: <strong className="text-foreground">{fmt(daily.targetNaira)}</strong></span>
                <span className={`font-bold text-sm ${dailyPct >= 100 ? "text-green-700" : dailyPct >= 70 ? "text-yellow-700" : "text-red-700"}`}>
                  {dailyPct}% of target
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-4">
                <div
                  className={`h-4 rounded-full transition-all ${dailyPct >= 100 ? "bg-green-500" : dailyPct >= 70 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${Math.min(100, dailyPct)}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <span>₦0</span>
                <span>{fmt(daily.targetNaira / 2)}</span>
                <span>{fmt(daily.targetNaira)}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Summary Row */}
        {kpi && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: "Total Declarations", value: kpi.totalDeclarations.toLocaleString(), icon: <FileText className="h-4 w-4 text-blue-500" /> },
              { label: "Cleared", value: kpi.clearedDeclarations.toLocaleString(), icon: <CheckCircle className="h-4 w-4 text-green-500" /> },
              { label: "Clearance Rate", value: `${kpi.clearanceRate}%`, icon: <TrendingUp className="h-4 w-4 text-emerald-500" /> },
              { label: "Registered Traders", value: kpi.registeredTraders.toLocaleString(), icon: <Users className="h-4 w-4 text-purple-500" /> },
              { label: "AEO Operators", value: kpi.aeoOperators.toLocaleString(), icon: <Shield className="h-4 w-4 text-teal-500" /> },
              { label: "Sanctions Hits", value: kpi.sanctionsHitsThisMonth.toLocaleString(), icon: <AlertTriangle className="h-4 w-4 text-red-500" /> },
            ].map(item => (
              <Card key={item.label}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    {item.icon}
                    <span className="text-xs text-muted-foreground">{item.label}</span>
                  </div>
                  <div className="text-xl font-bold text-foreground">{item.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Top 10 HS Chapters by Revenue */}
        {topChapters && topChapters.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-blue-600" />
                Top 10 HS Chapters by Revenue
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topChapters.map((ch: Record<string, unknown>, i: number) => {
                  const maxRevenue = topChapters[0] ? (topChapters[0] as Record<string, unknown>).totalNaira as number : 1;
                  const pct = Math.round(((ch.totalNaira as number) / maxRevenue) * 100);
                  return (
                    <div key={ch.hsChapter as string} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <span className="text-xs font-mono w-16 text-foreground">{ch.hsChapter as string}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-foreground w-20 text-right">{fmt(ch.totalNaira as number)}</span>
                      <span className="text-xs text-muted-foreground w-12 text-right">{(ch.declarationCount as number).toLocaleString()} decls</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Last updated */}
        {revenue && (
          <p className="text-xs text-muted-foreground text-right">
            Data as of {new Date(revenue.asOf).toLocaleString()}. Refresh to update.
          </p>
        )}
      </div>
    </DashboardLayout>
  );
}
