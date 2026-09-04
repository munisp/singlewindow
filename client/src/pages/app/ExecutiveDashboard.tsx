import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import QueryErrorState from "@/components/QueryErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import {
  TrendingUp, DollarSign, FileText, Users, Shield, CheckCircle,
  Download, RefreshCw, BarChart2, AlertTriangle, Target, Pencil, Check, X, Loader2,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

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
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const utils = trpc.useUtils();
  const { data: kpiTargetsList } = trpc.kpiTargets.list.useQuery(undefined, { enabled: isAdmin });
  const setKpiTargetMutation = trpc.kpiTargets.setTarget.useMutation({
    onSuccess: () => {
      toast.success("KPI target updated");
      setEditingKey(null);
      utils.kpiTargets.list.invalidate();
    },
    onError: (err) => toast.error("Failed to update target", { description: err.message }),
  });

  const { data: revenue, isLoading, isError, error: revenueQueryError, refetch: refetchRevenue } = trpc.executiveDashboard.getRevenueCounter.useQuery();
  const { data: kpi, refetch: refetchKpi } = trpc.executiveDashboard.getKpiSummary.useQuery();
  const { data: ratingStats } = trpc.traderRatings.getStats.useQuery(undefined, { enabled: isAdmin });
  const { data: ratingTrend } = trpc.traderRatings.getTrend.useQuery({ days: 30 }, { enabled: isAdmin });
  const { data: daily } = trpc.executiveDashboard.getDailyCollectionVsTarget.useQuery({ dailyTargetNaira: 500_000_000 });
  const [breachBannerDismissed, setBreachBannerDismissed] = useState(false);
  const { data: patternsInBreach } = trpc.cep.getPatternsInBreach.useQuery(undefined, { enabled: isAdmin });
  const { data: topChapters } = trpc.executiveDashboard.getTopHsChapters.useQuery({ limit: 10 });
  const [anomalyLastUpdated, setAnomalyLastUpdated] = useState<Date | null>(null);
  const { data: anomalyMetrics, refetch: refetchAnomaly } = trpc.insiderThreat.getAnomalyMetrics.useQuery(undefined, {
    enabled: isAdmin,
    refetchInterval: 30_000,
    onSuccess: () => setAnomalyLastUpdated(new Date()),
  } as any);
  const { data: topScanned } = trpc.rulesOfOrigin.topScanned.useQuery({ limit: 10, days: 30 });
  const exportTopScannedMutation = trpc.rulesOfOrigin.exportTopScannedCsv.useMutation({
    onSuccess: (result) => {
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${result.rowCount} certificates to CSV`);
    },
    onError: (e) => toast.error(e.message),
  });


  const [drilldownKpi, setDrilldownKpi] = useState<"declarations" | "clearance_time" | "revenue" | "compliance" | "oga_approvals" | null>(null);
  const { data: drilldownData, isLoading: drilldownLoading } = trpc.executiveDashboard.getKpiDrillDown.useQuery(
    { metric: drilldownKpi! },
    { enabled: !!drilldownKpi }
  );

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

      {/* v103: KPI Drill-Down Sheet */}
      <Sheet open={!!drilldownKpi} onOpenChange={(open) => !open && setDrilldownKpi(null)}>
        <SheetContent className="w-[480px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>{drilldownKpi} — Detail</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {drilldownLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
                ))}
              </div>
            ) : drilldownData ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(drilldownData.summary ?? {}).map(([k, v]) => (
                    <div key={k} className="p-3 rounded-lg border bg-muted/20">
                      <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</p>
                      <p className="text-lg font-bold">{String(v)}</p>
                    </div>
                  ))}
                </div>
                {drilldownData.data && drilldownData.data.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Breakdown</p>
                    <div className="divide-y rounded-lg border overflow-hidden">
                      {drilldownData.data.map((row: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/20">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className="font-semibold">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No drill-down data available.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {isError && (
          <QueryErrorState
            title="Executive dashboard unavailable"
            error={revenueQueryError}
            onRetry={() => {
              refetchRevenue();
              refetchKpi();
            }}
          />
        )}
        {/* Patterns in Breach Banner — admin only */}
        {isAdmin && patternsInBreach && patternsInBreach.length > 0 && !breachBannerDismissed && (
          <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">
                {patternsInBreach.length} CEP Pattern{patternsInBreach.length !== 1 ? "s" : ""} in Breach Today
              </p>
              <p className="text-xs mt-1 text-amber-800">
                The following patterns have exceeded their daily alert threshold:{" "}
                {patternsInBreach.map((p, i) => (
                  <span key={p.patternId}>
                    <strong>{p.name}</strong> ({p.todayCount}/{p.threshold})
                    {i < patternsInBreach.length - 1 ? ", " : ""}
                  </span>
                ))}
              </p>
              <a
                href="/app/flink-cep-alerts"
                className="text-xs underline text-amber-700 hover:text-amber-900 mt-1 inline-block"
              >
                View CEP Alerts →
              </a>
            </div>
            <button
              onClick={() => setBreachBannerDismissed(true)}
              className="text-amber-600 hover:text-amber-900 shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
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
              { label: "Total Declarations", value: kpi.totalDeclarations.toLocaleString(), icon: <FileText className="h-4 w-4 text-blue-500" />, drilldownKey: "declarations" as const },
              { label: "Cleared", value: kpi.clearedDeclarations.toLocaleString(), icon: <CheckCircle className="h-4 w-4 text-green-500" />, drilldownKey: "declarations" as const },
              { label: "Clearance Rate", value: `${kpi.clearanceRate}%`, icon: <TrendingUp className="h-4 w-4 text-emerald-500" />, drilldownKey: "clearance_time" as const },
              { label: "Registered Traders", value: kpi.registeredTraders.toLocaleString(), icon: <Users className="h-4 w-4 text-purple-500" />, drilldownKey: "compliance" as const },
              { label: "AEO Operators", value: kpi.aeoOperators.toLocaleString(), icon: <Shield className="h-4 w-4 text-teal-500" />, drilldownKey: "compliance" as const },
              { label: "Sanctions Hits", value: kpi.sanctionsHitsThisMonth.toLocaleString(), icon: <AlertTriangle className="h-4 w-4 text-red-500" />, drilldownKey: "compliance" as const },
            ].map(item => (
              <Card key={item.label} className="cursor-pointer hover:ring-2 hover:ring-primary/40 transition-all" onClick={() => setDrilldownKpi(item.drilldownKey)}>
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

        {/* Most-Verified Certificates (QR scan counter) */}
        {topScanned && topScanned.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="h-4 w-4 text-emerald-600" />
                  Most-Verified Certificates (Last 30 Days)
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exportTopScannedMutation.isPending}
                  onClick={() => exportTopScannedMutation.mutate({ limit: 100, days: 30 })}
                >
                  {exportTopScannedMutation.isPending
                    ? <><span className="mr-1 h-3 w-3 animate-spin inline-block border-2 border-current border-t-transparent rounded-full" />Exporting…</>
                    : <><Download className="h-4 w-4 mr-1" />Export CSV</>}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {topScanned.map((cert, i) => {
                  const maxScans = topScanned[0]?.scanCount ?? 1;
                  const pct = Math.round(((cert.scanCount ?? 0) / maxScans) * 100);
                  return (
                    <div key={cert.id} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                      <span className="font-mono text-xs bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded border border-emerald-200 w-40 truncate" title={cert.certNumber ?? ""}>
                        {cert.certNumber}
                      </span>
                      <span className="text-xs text-muted-foreground w-28 truncate" title={cert.exporterName ?? ""}>
                        {cert.exporterName ?? "—"}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-foreground w-16 text-right">
                        {(cert.scanCount ?? 0).toLocaleString()}× scanned
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Targets (admin only) */}
        {isAdmin && kpiTargetsList && kpiTargetsList.length > 0 && (() => {
          // Map metricKey → actual current value from kpi query
          const actualMap: Record<string, number | undefined> = kpi ? {
            clearance_time_hours: kpi.avgClearanceHours,
            daily_revenue_ngn: kpi.monthRevenueNaira / 30,
            green_lane_pct: kpi.clearanceRate,
            sla_compliance_pct: kpi.clearanceRate,
            trader_satisfaction: ratingStats?.avgRating,
            aeo_operator_count: kpi.aeoOperators,
          } : {};
          const lowerIsBetter = new Set(["clearance_time_hours"]);
          const getRag = (key: string, actual: number | undefined, target: number) => {
            if (actual === undefined) return { cls: "text-muted-foreground", label: "N/A" };
            const ratio = actual / target;
            if (lowerIsBetter.has(key)) {
              if (ratio <= 1) return { cls: "text-emerald-600 font-semibold", label: "✓" };
              if (ratio <= 1.5) return { cls: "text-amber-600 font-semibold", label: "~" };
              return { cls: "text-red-600 font-semibold", label: "↑" };
            }
            if (ratio >= 1) return { cls: "text-emerald-600 font-semibold", label: "✓" };
            if (ratio >= 0.85) return { cls: "text-amber-600 font-semibold", label: "~" };
            return { cls: "text-red-600 font-semibold", label: "↓" };
          };
          return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                KPI Targets
                <span className="ml-1 text-xs font-normal text-muted-foreground">Actual vs. target — ✓ on track, ~ near miss, ↓/↑ off target</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border/40">
                {kpiTargetsList.map((kpiT: any) => {
                  const actual = actualMap[kpiT.metricKey];
                  const target = parseFloat(kpiT.targetValue);
                  const rag = getRag(kpiT.metricKey, actual, target);
                  return (
                  <div key={kpiT.metricKey} className="flex items-center justify-between py-2.5 gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{kpiT.label}</p>
                      <p className="text-xs text-muted-foreground font-mono">{kpiT.metricKey}</p>
                    </div>
                    {/* Actual value */}
                    <div className="text-right min-w-[90px]">
                      {actual !== undefined ? (
                        <span className={`text-sm tabular-nums ${rag.cls}`}>
                          {rag.label} {actual.toLocaleString(undefined, { maximumFractionDigits: 1 })} {kpiT.unit}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      <p className="text-[10px] text-muted-foreground">actual</p>
                    </div>
                    {editingKey === kpiT.metricKey ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number" step="any" value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs"
                          autoFocus
                        />
                        <span className="text-xs text-muted-foreground">{kpiT.unit}</span>
                        <Button size="sm" className="h-7 w-7 p-0"
                          disabled={setKpiTargetMutation.isPending}
                          onClick={() => setKpiTargetMutation.mutate({
                            metricKey: kpiT.metricKey, label: kpiT.label,
                            targetValue: parseFloat(editValue), unit: kpiT.unit ?? undefined,
                          })}
                        >
                          {setKpiTargetMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingKey(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="text-sm font-semibold tabular-nums">
                            {target.toLocaleString()} {kpiT.unit}
                          </span>
                          <p className="text-[10px] text-muted-foreground">target</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => { setEditingKey(kpiT.metricKey); setEditValue(kpiT.targetValue); }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
          );
        })()}
        {/* Trader Satisfaction Distribution (admin only) */}
        {isAdmin && ratingStats && ratingStats.totalRatings > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <span>⭐</span> Trader Satisfaction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <div className="text-4xl font-bold text-amber-500">{ratingStats.avgRating.toFixed(1)}</div>
                <div>
                  <p className="text-sm font-medium">Average Rating</p>
                  <p className="text-xs text-muted-foreground">{ratingStats.totalRatings.toLocaleString()} total ratings</p>
                </div>
              </div>
              <div className="space-y-1.5">
                {([5, 4, 3, 2, 1] as const).map((star) => {
                  const count = ratingStats.distribution[star] ?? 0;
                  const pct = ratingStats.totalRatings > 0 ? (count / ratingStats.totalRatings) * 100 : 0;
                  return (
                    <div key={star} className="flex items-center gap-2 text-xs">
                      <span className="w-4 text-right font-medium">{star}</span>
                      <span className="text-amber-400">★</span>
                      <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            star >= 4 ? "bg-emerald-500" : star === 3 ? "bg-amber-400" : "bg-red-400"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
        {/* Trader Satisfaction 30-Day Trend (admin only) */}
        {isAdmin && ratingTrend && ratingTrend.length > 1 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp size={16} className="text-amber-500" />
                Trader Satisfaction — 30-Day Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="w-full overflow-x-auto">
                <svg
                  viewBox={`0 0 ${Math.max(ratingTrend.length * 24, 300)} 80`}
                  className="w-full h-20"
                  preserveAspectRatio="none"
                >
                  {/* Grid lines at 1,2,3,4,5 */}
                  {[1, 2, 3, 4, 5].map((v) => (
                    <line
                      key={v}
                      x1="0" y1={80 - ((v - 1) / 4) * 80}
                      x2={Math.max(ratingTrend.length * 24, 300)} y2={80 - ((v - 1) / 4) * 80}
                      stroke="#e5e7eb" strokeWidth="0.5"
                    />
                  ))}
                  {/* Trend line */}
                  <polyline
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeLinejoin="round"
                    points={ratingTrend.map((d, i) => {
                      const x = (i / (ratingTrend.length - 1)) * Math.max(ratingTrend.length * 24, 300);
                      const y = 80 - ((d.avgRating - 1) / 4) * 72;
                      return `${x},${y}`;
                    }).join(" ")}
                  />
                  {/* Data points */}
                  {ratingTrend.map((d, i) => {
                    const x = (i / (ratingTrend.length - 1)) * Math.max(ratingTrend.length * 24, 300);
                    const y = 80 - ((d.avgRating - 1) / 4) * 72;
                    return (
                      <circle key={i} cx={x} cy={y} r="3" fill="#f59e0b" />
                    );
                  })}
                </svg>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>{ratingTrend[0]?.day}</span>
                  <span className="text-amber-600 font-medium">
                    Latest: {ratingTrend[ratingTrend.length - 1]?.avgRating.toFixed(2)} ★
                  </span>
                  <span>{ratingTrend[ratingTrend.length - 1]?.day}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Anomaly Detection Health */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                Anomaly Detection Health
                <button
                  onClick={() => refetchAnomaly()}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  title="Refresh anomaly metrics"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!anomalyMetrics ? (
                <p className="text-sm text-muted-foreground">Loading anomaly metrics…</p>
              ) : (
                <div className="space-y-4">
                  {/* KPI row */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: "Total Analysed", value: (anomalyMetrics as any).total_analysed?.toLocaleString() ?? "—", icon: BarChart2, color: "text-blue-500" },
                      { label: "Blocked", value: (anomalyMetrics as any).blocked_count?.toLocaleString() ?? "—", icon: AlertTriangle, color: "text-red-500" },
                      { label: "Block Rate", value: (anomalyMetrics as any).total_analysed > 0 ? `${((anomalyMetrics as any).blocked_count / (anomalyMetrics as any).total_analysed * 100).toFixed(1)}%` : "—", icon: Shield, color: "text-amber-500" },
                    ].map(item => (
                      <div key={item.label} className="text-center">
                        <item.icon className={`h-5 w-5 mx-auto mb-1 ${item.color}`} />
                        <div className="text-xl font-bold">{item.value}</div>
                        <div className="text-xs text-muted-foreground">{item.label}</div>
                      </div>
                    ))}
                  </div>
                  {/* Top-3 alert rules */}
                  {(anomalyMetrics as any).alerts_by_rule && Object.keys((anomalyMetrics as any).alerts_by_rule).length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-2 text-muted-foreground">Top Alert Rules</p>
                      <div className="space-y-1.5">
                        {Object.entries((anomalyMetrics as any).alerts_by_rule as Record<string, number>)
                          .sort(([, a], [, b]) => b - a)
                          .slice(0, 3)
                          .map(([rule, count]) => {
                            const maxCount = Math.max(...Object.values((anomalyMetrics as any).alerts_by_rule as Record<string, number>));
                            const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
                            return (
                              <div key={rule} className="flex items-center gap-2 text-xs">
                                <span className="w-20 shrink-0 font-mono text-muted-foreground">{rule}</span>
                                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                                  <div className="h-full bg-amber-500 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="w-8 text-right font-semibold">{count}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                  {anomalyLastUpdated && (
                    <p className="text-xs text-muted-foreground text-right">
                      Last updated: {anomalyLastUpdated.toLocaleTimeString()} · auto-refreshes every 30s
                    </p>
                  )}
                </div>
              )}
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

      {/* v103: KPI Drill-Down Sheet */}
      <Sheet open={!!drilldownKpi} onOpenChange={(open) => !open && setDrilldownKpi(null)}>
        <SheetContent className="w-[480px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>{drilldownKpi} — Detail</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-3">
            {drilldownLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 bg-muted/30 rounded animate-pulse" />
                ))}
              </div>
            ) : drilldownData ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(drilldownData.summary ?? {}).map(([k, v]) => (
                    <div key={k} className="p-3 rounded-lg border bg-muted/20">
                      <p className="text-xs text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</p>
                      <p className="text-lg font-bold">{String(v)}</p>
                    </div>
                  ))}
                </div>
                {drilldownData.data && drilldownData.data.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium mb-2">Breakdown</p>
                    <div className="divide-y rounded-lg border overflow-hidden">
                      {drilldownData.data.map((row: any, i: number) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/20">
                          <span className="text-muted-foreground">{row.label}</span>
                          <span className="font-semibold">{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No drill-down data available.</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
