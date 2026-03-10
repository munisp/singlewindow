/**
 * Finance.tsx — Finance Role Dashboard
 * Duty revenue analytics, payment KPIs, HS chapter breakdown,
 * corridor analysis, and pending payment management.
 * Design: Sovereign Blueprint — Deep Navy + Gold accent
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = "USD"): string {
  if (amount >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${currency} ${(amount / 1_000).toFixed(1)}K`;
  return `${currency} ${amount.toFixed(2)}`;
}

const LANE_COLORS: Record<string, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  red: "#ef4444",
  blue: "#3b82f6",
  unknown: "#6b7280",
};

const CHART_COLORS = ["#D4A017", "#1E3A5F", "#10b981", "#6366f1", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

// ─── KPI CARD ─────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = "default",
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  trend?: string;
  color?: "default" | "success" | "warning" | "danger";
}) {
  const colorMap = {
    default: "text-primary",
    success: "text-emerald-500",
    warning: "text-amber-500",
    danger: "text-red-500",
  };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className={`p-2 rounded-lg bg-muted ${colorMap[color]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {trend && (
          <div className="mt-3 flex items-center gap-1 text-xs text-emerald-500">
            <ArrowUpRight className="h-3 w-3" />
            <span>{trend}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── CUSTOM TOOLTIP ──────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-sm text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function Finance() {
  const [trendDays, setTrendDays] = useState(30);
  const [exportLoading, setExportLoading] = useState(false);
  const exportCSVMutation = trpc.finance.exportCSV.useMutation();

  const kpisQuery = trpc.finance.kpis.useQuery();
  const hsChapterQuery = trpc.finance.revenueByHsChapter.useQuery({ limit: 12 });
  const countryQuery = trpc.finance.revenueByCountry.useQuery({ limit: 8 });
  const trendQuery = trpc.finance.paymentTrend.useQuery({ days: trendDays });
  const declTypeQuery = trpc.finance.revenueByDeclarationType.useQuery();
  const portQuery = trpc.finance.revenueByPort.useQuery({ limit: 8 });
  const pendingQuery = trpc.finance.pendingPayments.useQuery({ limit: 25 });
  const riskLaneQuery = trpc.finance.revenueByRiskLane.useQuery();

  const kpis = kpisQuery.data;
  const isLoading = kpisQuery.isLoading;
  const isError = kpisQuery.isError || hsChapterQuery.isError || trendQuery.isError;

  // Derive pie chart data for revenue composition
  const revenueComposition = useMemo(() => {
    if (!kpis) return [];
    return [
      { name: "Import Duty", value: kpis.dutyRevenue, fill: "#D4A017" },
      { name: "VAT", value: kpis.vatRevenue, fill: "#1E3A5F" },
      { name: "Levies", value: kpis.levyRevenue, fill: "#10b981" },
    ].filter(d => d.value > 0);
  }, [kpis]);

  const utils = trpc.useUtils();
  const handleRefresh = () => {
    utils.finance.kpis.invalidate();
    utils.finance.revenueByHsChapter.invalidate();
    utils.finance.paymentTrend.invalidate();
    utils.finance.pendingPayments.invalidate();
  };

  return (
    <DashboardLayout title="Finance Dashboard">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Finance Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Duty revenue analytics, payment flows, and financial reporting
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={exportLoading}
              onClick={async () => {
                setExportLoading(true);
                try {
                  const result = await exportCSVMutation.mutateAsync({
                    startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
                    endDate: new Date().toISOString(),
                    limit: 5000,
                  });
                  const blob = new Blob([result.csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = result.filename;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (e) {
                  console.error("CSV export failed", e);
                } finally {
                  setExportLoading(false);
                }
              }}
              className="gap-2"
            >
              {exportLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="h-16 bg-muted animate-pulse rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Total Revenue Collected"
              value={formatCurrency(kpis?.totalRevenue ?? 0)}
              subtitle="Confirmed payments"
              icon={DollarSign}
              color="success"
            />
            <KpiCard
              title="Duty Revenue"
              value={formatCurrency(kpis?.dutyRevenue ?? 0)}
              subtitle="Import/export duties"
              icon={TrendingUp}
              color="default"
            />
            <KpiCard
              title="VAT Collected"
              value={formatCurrency(kpis?.vatRevenue ?? 0)}
              subtitle="Value-added tax"
              icon={BarChart3}
              color="default"
            />
            <KpiCard
              title="Levies & Fees"
              value={formatCurrency(kpis?.levyRevenue ?? 0)}
              subtitle="Port levies & charges"
              icon={CreditCard}
              color="default"
            />
            <KpiCard
              title="Pending Payments"
              value={formatCurrency(kpis?.pendingAmount ?? 0)}
              subtitle={`${kpis?.pendingCount ?? 0} transactions`}
              icon={AlertCircle}
              color="warning"
            />
            <KpiCard
              title="Confirmed Transactions"
              value={(kpis?.confirmedCount ?? 0).toString()}
              subtitle="Successfully settled"
              icon={CheckCircle2}
              color="success"
            />
            <KpiCard
              title="Failed Transactions"
              value={(kpis?.failedCount ?? 0).toString()}
              subtitle="Require follow-up"
              icon={XCircle}
              color="danger"
            />
            <KpiCard
              title="Overdue Declarations"
              value={(kpis?.overdueCount ?? 0).toString()}
              subtitle="Awaiting payment"
              icon={AlertCircle}
              color="warning"
            />
          </div>
        )}

        {/* Main Analytics Tabs */}
        <Tabs defaultValue="revenue">
          <TabsList className="grid grid-cols-2 sm:grid-cols-4 w-full max-w-xl">
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
            <TabsTrigger value="trend">Trend</TabsTrigger>
            <TabsTrigger value="corridors">Corridors</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
          </TabsList>

          {/* ── REVENUE TAB ── */}
          <TabsContent value="revenue" className="space-y-4 mt-4">
            <div className="grid lg:grid-cols-3 gap-4">
              {/* HS Chapter Chart */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue by HS Chapter</CardTitle>
                </CardHeader>
                <CardContent>
                  {hsChapterQuery.isLoading ? (
                    <div className="h-64 bg-muted animate-pulse rounded" />
                  ) : hsChapterQuery.data && hsChapterQuery.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={hsChapterQuery.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="hsChapter" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} width={80} />
                        <Tooltip content={<CustomTooltip />} />
                        <Legend />
                        <Bar dataKey="totalDuty" name="Duty" fill="#D4A017" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="totalVat" name="VAT" fill="#1E3A5F" radius={[2, 2, 0, 0]} />
                        <Bar dataKey="totalLevy" name="Levy" fill="#10b981" radius={[2, 2, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      No cleared declarations with HS codes yet
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Revenue Composition Pie */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue Composition</CardTitle>
                </CardHeader>
                <CardContent>
                  {revenueComposition.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={revenueComposition}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={85}
                          paddingAngle={3}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {revenueComposition.map((entry) => (
                            <Cell key={entry.name} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v: number) => formatCurrency(v)} />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                      No revenue data yet
                    </div>
                  )}
                  {/* Legend */}
                  <div className="mt-2 space-y-1">
                    {revenueComposition.map(d => (
                      <div key={d.name} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: d.fill }} />
                          <span className="text-muted-foreground">{d.name}</span>
                        </div>
                        <span className="font-medium">{formatCurrency(d.value)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Declaration Type + Risk Lane */}
            <div className="grid lg:grid-cols-2 gap-4">
              {/* By Declaration Type */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue by Declaration Type</CardTitle>
                </CardHeader>
                <CardContent>
                  {declTypeQuery.isLoading ? (
                    <div className="h-48 bg-muted animate-pulse rounded" />
                  ) : declTypeQuery.data && declTypeQuery.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={declTypeQuery.data} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                        <YAxis type="category" dataKey="declarationType" tick={{ fontSize: 11 }} width={80} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="totalRevenue" name="Total Revenue" radius={[0, 2, 2, 0]}>
                          {declTypeQuery.data.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                      No cleared declarations yet
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* By Risk Lane */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue by Risk Lane</CardTitle>
                </CardHeader>
                <CardContent>
                  {riskLaneQuery.isLoading ? (
                    <div className="h-48 bg-muted animate-pulse rounded" />
                  ) : riskLaneQuery.data && riskLaneQuery.data.length > 0 ? (
                    <div className="space-y-3 mt-2">
                      {riskLaneQuery.data.map((d) => {
                        const maxRevenue = Math.max(...riskLaneQuery.data!.map(x => x.totalRevenue));
                        const pct = maxRevenue > 0 ? (d.totalRevenue / maxRevenue) * 100 : 0;
                        return (
                          <div key={d.riskLane} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <div
                                  className="h-3 w-3 rounded-full"
                                  style={{ backgroundColor: LANE_COLORS[d.riskLane] ?? "#6b7280" }}
                                />
                                <span className="capitalize font-medium">{d.riskLane} Lane</span>
                                <Badge variant="outline" className="text-xs">{d.declarationCount} decls</Badge>
                              </div>
                              <span className="font-semibold">{formatCurrency(d.totalRevenue)}</span>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${pct}%`,
                                  backgroundColor: LANE_COLORS[d.riskLane] ?? "#6b7280",
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                      No cleared declarations yet
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── TREND TAB ── */}
          <TabsContent value="trend" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-sm font-semibold">Payment Volume Trend</CardTitle>
                <div className="flex gap-2">
                  {[7, 14, 30, 60].map(d => (
                    <Button
                      key={d}
                      variant={trendDays === d ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setTrendDays(d)}
                    >
                      {d}d
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {trendQuery.isLoading ? (
                  <div className="h-72 bg-muted animate-pulse rounded" />
                ) : trendQuery.data && trendQuery.data.length > 0 ? (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={trendQuery.data} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="totalAmount"
                        name="Total Amount"
                        stroke="#D4A017"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-72 flex items-center justify-center text-muted-foreground text-sm">
                    No payment data in the selected period
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CORRIDORS TAB ── */}
          <TabsContent value="corridors" className="space-y-4 mt-4">
            <div className="grid lg:grid-cols-2 gap-4">
              {/* Revenue by Port of Entry */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue by Port of Entry</CardTitle>
                </CardHeader>
                <CardContent>
                  {portQuery.isLoading ? (
                    <div className="h-64 bg-muted animate-pulse rounded" />
                  ) : portQuery.data && portQuery.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={280}>
                      <BarChart data={portQuery.data} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v)} />
                        <YAxis type="category" dataKey="portOfEntry" tick={{ fontSize: 10 }} width={100} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="totalRevenue" name="Revenue" radius={[0, 2, 2, 0]}>
                          {portQuery.data.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      No port revenue data yet
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Revenue by Country of Origin */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Revenue by Country of Origin</CardTitle>
                </CardHeader>
                <CardContent>
                  {countryQuery.isLoading ? (
                    <div className="h-64 bg-muted animate-pulse rounded" />
                  ) : countryQuery.data && countryQuery.data.length > 0 ? (
                    <div className="space-y-2 mt-1">
                      {countryQuery.data.map((d, i) => {
                        const maxRevenue = Math.max(...countryQuery.data!.map(x => x.totalRevenue));
                        const pct = maxRevenue > 0 ? (d.totalRevenue / maxRevenue) * 100 : 0;
                        return (
                          <div key={d.country} className="space-y-0.5">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs text-muted-foreground w-8">{d.country}</span>
                                <Badge variant="outline" className="text-xs">{d.declarationCount}</Badge>
                              </div>
                              <span className="font-medium text-xs">{formatCurrency(d.totalRevenue)}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                      No country revenue data yet
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── PENDING PAYMENTS TAB ── */}
          <TabsContent value="pending" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                  Pending Payments
                  {pendingQuery.data && (
                    <Badge variant="secondary">{pendingQuery.data.length}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {pendingQuery.isLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : pendingQuery.data && pendingQuery.data.length > 0 ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Reference</TableHead>
                          <TableHead>Declaration</TableHead>
                          <TableHead>HS Code</TableHead>
                          <TableHead>Port</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pendingQuery.data.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-mono text-xs">{p.reference ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{p.declarationNumber}</TableCell>
                            <TableCell className="font-mono text-xs">{p.hsCode ?? "—"}</TableCell>
                            <TableCell className="text-xs">{p.portOfEntry ?? "—"}</TableCell>
                            <TableCell className="text-xs capitalize">{p.paymentMethod.replace("_", " ")}</TableCell>
                            <TableCell className="text-right font-medium text-xs">
                              {p.currency} {parseFloat(p.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-amber-600 border-amber-300 text-xs">
                                Pending
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                    <p className="text-sm">No pending payments — all clear!</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
