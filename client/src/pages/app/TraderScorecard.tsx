/**
 * Sprint 61 / v49 — Trader Performance Scorecard
 * Clearance time percentile, rejection rate trend, AEO tier status,
 * 12-month compliance history, compliance score trend, admin AEO tier adjustment.
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useEffect as useQrEffect, useRef as useQrRef } from "react";
import QRCode from "qrcode";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Award, TrendingDown, TrendingUp, Clock, FileText, CheckCircle, AlertTriangle, Target, Settings, X, Link } from "lucide-react";

const TIER_COLORS: Record<string, string> = {
  gold: "#D4A017",
  silver: "#9CA3AF",
  standard: "#3B82F6",
  none: "#6B7280",
};

const TIER_LABELS: Record<string, string> = {
  gold: "Gold AEO",
  silver: "Silver AEO",
  standard: "Standard AEO",
  none: "Not Eligible",
};

function StatCard({ title, value, sub, icon: Icon, color }: {
  title: string; value: string | number; sub?: string;
  icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}20` }}>
            <span style={{ color }}><Icon className="w-5 h-5" /></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function TraderScorecard() {
  const { user } = useAuth();
  const { data: scorecard, isLoading: loadingScorecard, isError } = trpc.traderScorecard.getScorecard.useQuery();
  const { data: percentile } = trpc.traderScorecard.getClearancePercentile.useQuery({});
  const { data: trendData } = trpc.traderScorecard.getRejectionTrend.useQuery();
  const { data: benchmark } = trpc.traderScorecard.getBenchmark.useQuery();
  const { data: complianceTrend } = trpc.traderScorecard.getComplianceTrend.useQuery({});

  // AEO tier adjustment dialog state (admin / customs_officer only)
  const [aeoDialogOpen, setAeoDialogOpen] = useState(false);
  const [aeoTierInput, setAeoTierInput] = useState<"standard" | "silver" | "gold">("standard");

  const updateScorecardMutation = trpc.traderScorecard.updateScorecard.useMutation({
    onSuccess: () => {
      toast.success("AEO tier updated successfully");
      setAeoDialogOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const summary = scorecard?.summary;
  const tier = summary?.aeoTier ?? "none";
  const tierColor = TIER_COLORS[tier] ?? TIER_COLORS.none;

  const historyChartData = scorecard?.complianceHistory?.map((h) => ({
    month: h.month.slice(5), // "MM"
    cleared: h.cleared,
    rejected: h.rejected,
    underReview: (h as any).underReview ?? 0,
  })) ?? [];

  const trendChartData = trendData?.trend?.map((t) => ({
    month: t.month.slice(5),
    rate: t.rate,
    delta: t.delta,
  })) ?? [];

  const complianceTrendData = complianceTrend?.trend?.map((t) => ({
    month: t.month.slice(5),
    score: t.score,
    cleared: t.cleared,
    total: t.total,
  })) ?? [];

  const isAdminOrOfficer = user?.role === "admin" || user?.role === "customs_officer";

  // Drill-down state: clicking a month on the compliance trend opens a declarations list
  // Initialise from URL query string so officers can bookmark/share a specific month view
  const [, setLocation] = useLocation();
  const initFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    const y = parseInt(params.get("dy") ?? "", 10);
    const m = parseInt(params.get("dm") ?? "", 10);
    if (y > 0 && m >= 1 && m <= 12) {
      return { year: y, month: m, label: `${String(m).padStart(2, "0")}` };
    }
    return null;
  };
  const [drillMonth, setDrillMonth] = useState<{ year: number; month: number; label: string } | null>(() => initFromUrl());
  const [drillStatus, setDrillStatus] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("ds") ?? "all";
  });
  const [copyPopoverOpen, setCopyPopoverOpen] = useState(false);
  const qrCanvasRef = useQrRef<HTMLCanvasElement>(null);
  useQrEffect(() => {
    if (copyPopoverOpen && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, window.location.href, { width: 120, margin: 1 }).catch(() => {});
    }
  }, [copyPopoverOpen]);

  // Sync drill state to URL whenever it changes
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (drillMonth) {
      params.set("dy", String(drillMonth.year));
      params.set("dm", String(drillMonth.month));
    } else {
      params.delete("dy");
      params.delete("dm");
    }
    if (drillStatus && drillStatus !== "all") {
      params.set("ds", drillStatus);
    } else {
      params.delete("ds");
    }
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : "");
    window.history.replaceState(null, "", newUrl);
  }, [drillMonth, drillStatus]);
  const { data: drillData, isLoading: drillLoading } = trpc.traderScorecard.getDeclarationsForMonth.useQuery(
    { year: drillMonth?.year ?? 2024, month: drillMonth?.month ?? 1, status: drillStatus as "all" | "draft" | "submitted" | "under_assessment" | "docs_required" | "payment_pending" | "payment_confirmed" | "under_examination" | "examination_complete" | "cleared" | "rejected" | "cancelled" },
    { enabled: drillMonth !== null }
  );

  const STATUS_COLORS: Record<string, string> = {
    cleared: "bg-green-500/20 text-green-400",
    rejected: "bg-red-500/20 text-red-400",
    submitted: "bg-blue-500/20 text-blue-400",
    under_examination: "bg-yellow-500/20 text-yellow-400",
    payment_pending: "bg-orange-500/20 text-orange-400",
    under_assessment: "bg-purple-500/20 text-purple-400",
  };

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
            <h1 className="text-2xl font-bold">Performance Scorecard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Your trade compliance metrics for the last 12 months
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge
              className="px-4 py-2 text-base font-semibold"
              style={{ backgroundColor: tierColor, color: "#fff" }}
            >
              <Award className="w-4 h-4 mr-2 inline" />
              {TIER_LABELS[tier] ?? "Unknown"}
            </Badge>
            {isAdminOrOfficer && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setAeoTierInput((tier === "none" ? "standard" : tier) as "standard" | "silver" | "gold");
                  setAeoDialogOpen(true);
                }}
              >
                <Settings className="w-3.5 h-3.5 mr-1" />
                Adjust AEO Tier
              </Button>
            )}
          </div>
        </div>

        {/* AEO Tier Adjust Dialog */}
        <Dialog open={aeoDialogOpen} onOpenChange={setAeoDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Adjust AEO Tier</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                Select a new AEO tier for this trader. Changes take effect immediately and are recorded in the audit log.
              </p>
              <Select value={aeoTierInput} onValueChange={(v) => setAeoTierInput(v as "standard" | "silver" | "gold")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select tier" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard AEO</SelectItem>
                  <SelectItem value="silver">Silver AEO</SelectItem>
                  <SelectItem value="gold">Gold AEO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAeoDialogOpen(false)}>Cancel</Button>
              <Button
                onClick={() => {
                  if (!user?.id) return;
                  updateScorecardMutation.mutate({ traderId: user.id, aeoTier: aeoTierInput });
                }}
                disabled={updateScorecardMutation.isPending}
              >
                {updateScorecardMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Compliance Score */}
        {summary && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">Overall Compliance Score</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="text-5xl font-bold" style={{ color: tierColor }}>
                  {summary.complianceScore}
                </div>
                <div className="flex-1 space-y-2">
                  <Progress value={summary.complianceScore} className="h-3" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>0 — Not Eligible</span>
                    <span>60 — Standard</span>
                    <span>75 — Silver</span>
                    <span>90 — Gold</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI Cards */}
        {loadingScorecard ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Card key={i}><CardContent className="pt-6 h-24 animate-pulse bg-muted rounded" /></Card>
            ))}
          </div>
        ) : summary ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Total Declarations"
              value={summary.total}
              sub="Last 12 months"
              icon={FileText}
              color="#3B82F6"
            />
            <StatCard
              title="Clearance Rate"
              value={`${summary.total > 0 ? Math.round((summary.cleared / summary.total) * 100) : 0}%`}
              sub={`${summary.cleared} cleared`}
              icon={CheckCircle}
              color="#10B981"
            />
            <StatCard
              title="Rejection Rate"
              value={`${summary.rejectionRate ?? 0}%`}
              sub={`${summary.rejected} rejected`}
              icon={AlertTriangle}
              color={(summary.rejectionRate ?? 0) > 10 ? "#EF4444" : (summary.rejectionRate ?? 0) > 5 ? "#F59E0B" : "#10B981"}
            />
            <StatCard
              title="Avg Clearance Time"
              value={`${summary.avgClearanceHours}h`}
              sub="Per declaration"
              icon={Clock}
              color="#8B5CF6"
            />
          </div>
        ) : null}

        {/* Clearance Percentile */}
        {percentile && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-primary" />
                Clearance Speed Percentile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <div className="text-4xl font-bold text-primary">{percentile.percentile}th</div>
                  <div className="text-sm text-muted-foreground mt-1">percentile</div>
                </div>
                <div className="flex-1 space-y-1">
                  <Progress value={percentile.percentile} className="h-4" />
                  <p className="text-sm text-muted-foreground">
                    Your average clearance time of <strong>{percentile.avgHours}h</strong> is faster than{" "}
                    <strong>{percentile.percentile}%</strong> of {percentile.populationSize} traders on the platform.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="history">
          <TabsList>
            <TabsTrigger value="history">12-Month History</TabsTrigger>
            <TabsTrigger value="compliance">Compliance Score Trend</TabsTrigger>
            <TabsTrigger value="rejection">Rejection Trend</TabsTrigger>
            <TabsTrigger value="benchmark">Platform Benchmark</TabsTrigger>
          </TabsList>

          {/* 12-Month Compliance History */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle>Declaration Outcomes by Month</CardTitle>
              </CardHeader>
              <CardContent>
                {historyChartData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    No declaration data available for the last 12 months.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={historyChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="month" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1F2937", border: "none", borderRadius: "8px" }}
                        labelStyle={{ color: "#F9FAFB" }}
                      />
                      <Bar dataKey="cleared" name="Cleared" stackId="a" fill="#10B981" />
                      <Bar dataKey="underReview" name="Under Review" stackId="a" fill="#F59E0B" />
                      <Bar dataKey="rejected" name="Rejected" stackId="a" fill="#EF4444" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Compliance Score Trend */}
          <TabsContent value="compliance">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Compliance Score (% Cleared)</CardTitle>
              </CardHeader>
              <CardContent>
                {complianceTrendData.length === 0 || complianceTrendData.every((d) => d.score === null) ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    No compliance data available for the last 12 months.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={complianceTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="month" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 12 }} unit="%" domain={[0, 100]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1F2937", border: "none", borderRadius: "8px" }}
                        formatter={(v: unknown) => [typeof v === "number" ? `${v}%` : "No data", "Compliance Score"]}
                      />
                      <ReferenceLine y={90} stroke="#D4A017" strokeDasharray="4 4"
                        label={{ value: "Gold (90%)", fill: "#D4A017", fontSize: 10 }} />
                      <ReferenceLine y={75} stroke="#9CA3AF" strokeDasharray="4 4"
                        label={{ value: "Silver (75%)", fill: "#9CA3AF", fontSize: 10 }} />
                      <ReferenceLine y={60} stroke="#3B82F6" strokeDasharray="4 4"
                        label={{ value: "Standard (60%)", fill: "#3B82F6", fontSize: 10 }} />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#10B981"
                        strokeWidth={2.5}
                        dot={{ fill: "#10B981", r: 5, cursor: "pointer" }}
                        activeDot={{
                          r: 7,
                          cursor: "pointer",
                          onClick: (_: unknown, payload: unknown) => {
                            const p = payload as { payload?: { month?: string; fullMonth?: string } };
                            const raw = p?.payload?.fullMonth ?? p?.payload?.month ?? "";
                            const parts = raw.split("-");
                            if (parts.length === 2) {
                              setDrillMonth({ year: parseInt(parts[0]), month: parseInt(parts[1]), label: raw });
                            } else if (parts.length === 1 && complianceTrendData) {
                              // month is "MM" — find full month from complianceTrendData
                              const found = complianceTrend?.trend?.find((t) => t.month.slice(5) === raw);
                              if (found) {
                                const fp = found.month.split("-");
                                setDrillMonth({ year: parseInt(fp[0]), month: parseInt(fp[1]), label: found.month });
                              }
                            }
                          },
                        }}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Rejection Rate Trend */}
          <TabsContent value="rejection">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Rejection Rate (%)</CardTitle>
              </CardHeader>
              <CardContent>
                {trendChartData.length === 0 ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">
                    No rejection data available.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                      <XAxis dataKey="month" tick={{ fill: "#9CA3AF", fontSize: 12 }} />
                      <YAxis tick={{ fill: "#9CA3AF", fontSize: 12 }} unit="%" />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1F2937", border: "none", borderRadius: "8px" }}
                        formatter={(v: number) => [`${v}%`, "Rejection Rate"]}
                      />
                      <ReferenceLine y={10} stroke="#EF4444" strokeDasharray="4 4"
                        label={{ value: "10% threshold", fill: "#EF4444", fontSize: 11 }} />
                      <Line type="monotone" dataKey="rate" stroke="#F59E0B" strokeWidth={2} dot={{ fill: "#F59E0B", r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Platform Benchmark */}
          <TabsContent value="benchmark">
            <Card>
              <CardHeader>
                <CardTitle>You vs Platform Average (Last 3 Months)</CardTitle>
              </CardHeader>
              <CardContent>
                {!benchmark ? (
                  <div className="h-48 flex items-center justify-center text-muted-foreground">Loading benchmark…</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Clearance Rate */}
                    <div className="space-y-3">
                      <h4 className="font-medium">Clearance Rate</h4>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>You</span>
                            <span className="font-semibold text-green-400">{benchmark.trader?.clearanceRate ?? 0}%</span>
                          </div>
                          <Progress value={benchmark.trader?.clearanceRate ?? 0} className="h-3" />
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Platform Avg</span>
                            <span className="font-semibold text-muted-foreground">{benchmark.platform?.clearanceRate ?? 0}%</span>
                          </div>
                          <Progress value={benchmark.platform?.clearanceRate ?? 0} className="h-3 opacity-50" />
                        </div>
                      </div>
                    </div>
                    {/* Rejection Rate */}
                    <div className="space-y-3">
                      <h4 className="font-medium">Rejection Rate</h4>
                      <div className="space-y-2">
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>You</span>
                            <span className={`font-semibold ${(benchmark.trader?.rejectionRate ?? 0) > (benchmark.platform?.rejectionRate ?? 0) ? "text-red-400" : "text-green-400"}`}>
                              {benchmark.trader?.rejectionRate ?? 0}%
                            </span>
                          </div>
                          <Progress value={benchmark.trader?.rejectionRate ?? 0} className="h-3" />
                        </div>
                        <div>
                          <div className="flex justify-between text-sm mb-1">
                            <span>Platform Avg</span>
                            <span className="font-semibold text-muted-foreground">{benchmark.platform?.rejectionRate ?? 0}%</span>
                          </div>
                          <Progress value={benchmark.platform?.rejectionRate ?? 0} className="h-3 opacity-50" />
                        </div>
                      </div>
                    </div>
                    {/* Summary */}
                    <div className="md:col-span-2 p-4 rounded-lg bg-muted/30 border">
                      <div className="flex items-start gap-3">
                        {(benchmark.trader?.clearanceRate ?? 0) >= (benchmark.platform?.clearanceRate ?? 0) ? (
                          <TrendingUp className="w-5 h-5 text-green-400 mt-0.5 shrink-0" />
                        ) : (
                          <TrendingDown className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                        )}
                        <p className="text-sm text-muted-foreground">
                          Your clearance rate of <strong>{benchmark.trader?.clearanceRate ?? 0}%</strong> is{" "}
                          {(benchmark.trader?.clearanceRate ?? 0) >= (benchmark.platform?.clearanceRate ?? 0) ? (
                            <span className="text-green-400">above</span>
                          ) : (
                            <span className="text-red-400">below</span>
                          )}{" "}
                          the platform average of <strong>{benchmark.platform?.clearanceRate ?? 0}%</strong>.{" "}
                          {(benchmark.trader?.rejectionRate ?? 0) <= (benchmark.platform?.rejectionRate ?? 0)
                            ? "Your rejection rate is also better than average — keep it up!"
                            : "Consider reviewing your declaration accuracy to reduce rejections."}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Month Drill-Down Sheet */}
      <Sheet open={drillMonth !== null} onOpenChange={(open) => { if (!open) { setDrillMonth(null); setDrillStatus("all"); } }}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center justify-between">
              <span>Declarations — {drillMonth?.label ?? ""}</span>
              <div className="flex items-center gap-1">
                <Popover open={copyPopoverOpen} onOpenChange={setCopyPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" title="Share this view">
                      <Link className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-3" align="end">
                    <p className="text-xs font-semibold mb-1">Share this view</p>
                    <p className="text-xs text-muted-foreground mb-2 break-all">{window.location.href}</p>
                    <div className="flex justify-center mb-2">
                      <canvas ref={qrCanvasRef} className="rounded" />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(window.location.href).then(() => {
                            toast.success("Link copied to clipboard");
                            setCopyPopoverOpen(false);
                          }).catch(() => toast.error("Failed to copy link"));
                        }}
                      >
                        Copy Link
                      </Button>
                      {typeof navigator.share === "function" && (
                        <Button
                          size="sm"
                          className="flex-1 h-7 text-xs"
                          onClick={() => {
                            navigator.share({
                              title: `Trader Scorecard — ${drillMonth?.label ?? ""}`,
                              url: window.location.href,
                            }).then(() => setCopyPopoverOpen(false)).catch(() => {});
                          }}
                        >
                          Share
                        </Button>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                <Button variant="ghost" size="icon" onClick={() => { setDrillMonth(null); setDrillStatus("all"); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </SheetTitle>
          </SheetHeader>
          {/* Status filter */}
          <div className="mb-4">
            <Select value={drillStatus} onValueChange={setDrillStatus}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="under_assessment">Under Assessment</SelectItem>
                <SelectItem value="docs_required">Docs Required</SelectItem>
                <SelectItem value="payment_pending">Payment Pending</SelectItem>
                <SelectItem value="payment_confirmed">Payment Confirmed</SelectItem>
                <SelectItem value="under_examination">Under Examination</SelectItem>
                <SelectItem value="examination_complete">Examination Complete</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {drillLoading ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">Loading…</div>
          ) : !drillData || drillData.declarations.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-muted-foreground">
              No declarations found{drillStatus !== "all" ? ` with status "${drillStatus.replace(/_/g, " ")}"` : ""} for this month.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {drillData.total} declaration{drillData.total !== 1 ? "s" : ""} submitted in {drillMonth?.label}
                {drillStatus !== "all" && <span className="ml-1">(filtered: <strong>{drillStatus.replace(/_/g, " ")}</strong>)</span>}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>UCR</TableHead>
                    <TableHead>HS Code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead>Submitted</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drillData.declarations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.ucr ?? `#${d.id}`}</TableCell>
                      <TableCell className="text-xs">{d.hsCode ?? "—"}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${STATUS_COLORS[d.status ?? ""] ?? "bg-muted text-muted-foreground"}`}>
                          {(d.status ?? "unknown").replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {d.declaredValue ? `${d.currency ?? "USD"} ${Number(d.declaredValue).toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {d.submittedAt ? new Date(d.submittedAt).toLocaleDateString() : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  );
}
