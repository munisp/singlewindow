import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { BarChart, Bar, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldAlert,
  Activity,
  TrendingDown,
  Route,
  Package,
  Zap,
  Download,
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
};

const PATTERN_ICONS: Record<string, React.ReactNode> = {
  CAROUSEL_FRAUD: <RefreshCw className="h-4 w-4" />,
  SPLIT_CONSIGNMENT: <Package className="h-4 w-4" />,
  VALUATION_ANOMALY: <TrendingDown className="h-4 w-4" />,
  SUSPICIOUS_ROUTING: <Route className="h-4 w-4" />,
};

/** PatternSparkline — fetches real 7-day daily alert counts for a single pattern */
function PatternSparkline({ patternId, threshold }: { patternId: string; threshold?: number | null }) {
  const { data, isLoading } = trpc.cep.getPatternAlertHistory.useQuery(
    { patternId, days: 7 },
    { staleTime: 60_000 }
  );
  if (isLoading) {
    return <div className="mt-2 h-8 w-24 rounded bg-muted/30 animate-pulse" />;
  }
  const chartData = data?.days ?? [];
  const maxCount = Math.max(...chartData.map((d) => d.count), 1);
  const totalCount = chartData.reduce((s, d) => s + d.count, 0);
  // If threshold set, highlight red when any day exceeds threshold; otherwise use volume heuristic
  const thresholdExceeded = threshold != null && chartData.some((d) => d.count > threshold);
  const barColor = thresholdExceeded ? "#EF4444" : totalCount > 5 ? "#EF4444" : totalCount > 2 ? "#F59E0B" : "#10B981";
  // Per-bar colour: red if that day exceeds threshold
  const getBarColor = (count: number) => {
    if (threshold != null && count > threshold) return "#EF4444";
    return barColor;
  };
  return (
    <div className="mt-2 flex items-center gap-3">
      <div style={{ height: 36, width: 100 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Bar dataKey="count" radius={[2, 2, 0, 0]} maxBarSize={12}>
              {chartData.map((entry, index) => (
                <rect key={index} fill={getBarColor(entry.count)} />
              ))}
            </Bar>
            <RechartsTooltip
              contentStyle={{ backgroundColor: "#1F2937", border: "none", borderRadius: "6px", fontSize: "11px" }}
              formatter={(v: number) => [v, "Alerts"]}
              labelFormatter={(label: string) => label.slice(5)}
              cursor={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <span className="text-xs text-muted-foreground">
        <span style={{ color: barColor }} className="font-semibold">{totalCount}</span>{" "}
        alert{totalCount !== 1 ? "s" : ""} / 7d
        {maxCount > 0 && <span className="ml-1 text-muted-foreground/60">(peak {maxCount})</span>}
        {threshold != null && thresholdExceeded && (
          <span className="ml-1 text-red-400 font-semibold">⚠ threshold exceeded</span>
        )}
      </span>
    </div>
  );
}

export default function FlinkCepAlerts() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"open" | "resolved">("open");
  const [ackDialog, setAckDialog] = useState<{ alertId: string; patternName: string; mode: "investigate" | "resolve" } | null>(null);
  const [ackNotes, setAckNotes] = useState("");
  const [ackStatus, setAckStatus] = useState<"investigating" | "resolved" | "false_positive">("investigating");

  const statsQuery = trpc.cep.getStats.useQuery();
  const statusQuery = trpc.cep.getServiceStatus.useQuery();
  const patternsQuery = trpc.cep.getPatterns.useQuery();
  const alertsQuery = trpc.cep.getAlerts.useQuery({ status: activeTab as any, limit: 100 });

  const ackMutation = trpc.cep.acknowledgeAlert.useMutation({
    onSuccess: (_, vars) => {
      const isResolve = vars.status === "resolved" || vars.status === "false_positive";
      toast.success(isResolve ? "Alert resolved" : "Alert marked as investigating");
      alertsQuery.refetch();
      statsQuery.refetch();
      setAckDialog(null);
      setAckNotes("");
      setAckStatus("investigating");
    },
    onError: (err) => toast.error(err.message),
  });

  const [severityFilter, setSeverityFilter] = useState("all");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDialog, setBulkDialog] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<"resolved" | "false_positive">("resolved");
  const [bulkNotes, setBulkNotes] = useState("");

  const bulkAckMutation = trpc.cep.bulkAcknowledge.useMutation({
    onSuccess: (data) => {
      toast.success(`Resolved ${data.succeeded} alert${data.succeeded !== 1 ? "s" : ""}${data.failed > 0 ? ` (${data.failed} failed)` : ""}`);
      setSelectedIds(new Set());
      setBulkDialog(false);
      setBulkNotes("");
      alertsQuery.refetch();
      statsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const togglePatternMutation = trpc.cep.togglePattern.useMutation({
    onSuccess: (data) => {
      toast.success(`Pattern "${data.name}" ${data.status === "enabled" ? "enabled" : "disabled"}`);
      patternsQuery.refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  // Suppress alert state
  const [suppressDialog, setSuppressDialog] = useState<{ alertId: string; patternName: string } | null>(null);
  const [suppressHours, setSuppressHours] = useState<string>("24");
  const suppressMutation = trpc.cep.suppressAlert.useMutation({
    onSuccess: (data) => {
      toast.success(`Alert suppressed until ${new Date(data.suppressedUntil).toLocaleString()}`);
      alertsQuery.refetch();
      setSuppressDialog(null);
      setSuppressHours("24");
    },
    onError: (err) => toast.error(err.message),
  });

  // Pattern threshold state
  const [thresholdDialog, setThresholdDialog] = useState<{ patternId: string; patternName: string; current: number | null } | null>(null);
  const [thresholdInput, setThresholdInput] = useState<string>("");
  const updateThresholdMutation = trpc.cep.updatePatternThreshold.useMutation({
    onSuccess: (data) => {
      toast.success(data.threshold ? `Threshold set to ${data.threshold}/day` : "Threshold cleared");
      patternsQuery.refetch();
      setThresholdDialog(null);
      setThresholdInput("");
    },
    onError: (err) => toast.error(err.message),
  });

  // Suppression History state
  const [showSuppressionHistory, setShowSuppressionHistory] = useState(false);
  const [suppLogPage, setSuppLogPage] = useState(1);
  const suppressionLogQuery = trpc.cep.getSuppressionLog.useQuery(
    { page: suppLogPage, pageSize: 20 },
    { enabled: showSuppressionHistory && user?.role === "admin" }
  );

  const [createPatternDialog, setCreatePatternDialog] = useState(false);
  const [newPatternName, setNewPatternName] = useState("");
  const [newPatternDesc, setNewPatternDesc] = useState("");
  const createPatternMutation = trpc.cep.createPattern.useMutation({
    onSuccess: (data) => {
      toast.success(`Pattern created: ${data.patternId}`);
      patternsQuery.refetch();
      statsQuery.refetch();
      setCreatePatternDialog(false);
      setNewPatternName("");
      setNewPatternDesc("");
    },
    onError: (err) => toast.error(err.message),
  });

  const stats = statsQuery.data;
  const allAlerts = (alertsQuery.data?.alerts ?? []) as any[];
  const alerts = severityFilter === "all"
    ? allAlerts
    : allAlerts.filter((a: any) => a.severity === severityFilter);
  const openAlerts = alerts.filter((a: any) => a.status === "open" || a.status === "investigating");
  const allOpenSelected = openAlerts.length > 0 && openAlerts.every((a: any) => selectedIds.has(a.alert_id));
  const someSelected = selectedIds.size > 0;

  // Detail drawer state
  const [drawerAlert, setDrawerAlert] = useState<any | null>(null);

  // Test-fire state
  const [testFireDialog, setTestFireDialog] = useState<{ patternId: string; patternName: string } | null>(null);
  const [testFirePayload, setTestFirePayload] = useState('{"declarationId": 99999, "traderId": 1, "value": 50000}');
  const [testFireResult, setTestFireResult] = useState<{ alertId?: string; message?: string; error?: boolean } | null>(null);
  const [testFireLoading, setTestFireLoading] = useState(false);

  const handleTestFire = async () => {
    if (!testFireDialog) return;
    setTestFireLoading(true);
    setTestFireResult(null);
    try {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(testFirePayload); } catch {
        toast.error("Invalid JSON payload"); setTestFireLoading(false); return;
      }
      const res = await fetch("/api/webhooks/cep-event", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-cep-source": "test-fire" },
        body: JSON.stringify({ patternId: testFireDialog.patternId, severity: "medium", message: `Test fire for ${testFireDialog.patternName}`, payload }),
        credentials: "include",
      });
      const json = await res.json();
      if (res.ok) {
        setTestFireResult({ alertId: json.alertId, message: `Alert ${json.alertId} created successfully` });
        alertsQuery.refetch(); statsQuery.refetch();
        toast.success(`Test alert created: ${json.alertId}`);
      } else {
        setTestFireResult({ message: json.error ?? "Test fire failed", error: true });
        toast.error(json.error ?? "Test fire failed");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setTestFireResult({ message: msg, error: true });
      toast.error(msg);
    } finally {
      setTestFireLoading(false);
    }
  };

  return (
    <DashboardLayout title="Trade Pattern Alerts (Flink CEP)">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Trade Pattern Alerts</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Apache Flink Complex Event Processing — real-time fraud and anomaly detection
            </p>
          </div>
          <div className="flex items-center gap-2">
              {statusQuery.data && (
              <Badge variant="outline" className={statusQuery.data.service === 'online' ? "border-green-500 text-green-400" : "border-yellow-500 text-yellow-400"}>
                <Zap className="h-3 w-3 mr-1" />
                {statusQuery.data.service === 'online' ? "CEP Engine Online" : "DB Fallback Mode"}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => alertsQuery.refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-500/10">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.open_alerts ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Open Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-orange-500/10">
                  <ShieldAlert className="h-5 w-5 text-orange-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.total_alerts ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Total Alerts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Activity className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.declarations_processed?.toLocaleString() ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Declarations Scanned</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <CheckCircle2 className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{stats?.patterns_registered ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Active Patterns</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Pattern Breakdown */}
        {stats?.by_pattern && (
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Alert Distribution by Pattern</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {Object.entries(stats.by_pattern).map(([patternId, count]) => {
                  const pattern = (patternsQuery.data as any[])?.find((p: any) => p.pattern_id === patternId) as any;
                  return (
                    <div key={patternId} className="flex items-center gap-2 p-3 rounded-lg bg-muted/30">
                      <div className="text-muted-foreground">{PATTERN_ICONS[patternId] ?? <AlertTriangle className="h-4 w-4" />}</div>
                      <div>
                        <p className="text-sm font-medium text-foreground">{count}</p>
                        <p className="text-xs text-muted-foreground">{(pattern as any)?.name ?? patternId}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Alerts Table */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "open" | "resolved")}>
              <TabsList>
                <TabsTrigger value="open">
                  Open Alerts
                  {(stats?.open_alerts ?? 0) > 0 && (
                    <Badge className="ml-2 bg-red-500 text-white text-xs">{stats?.open_alerts}</Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="resolved">Resolved</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {/* Severity filter + CSV export */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <span className="text-xs text-muted-foreground font-medium">Severity:</span>
              <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              {severityFilter !== "all" && (
                <span className="text-xs text-muted-foreground">
                  {alerts.length} of {allAlerts.length} alert{allAlerts.length !== 1 ? "s" : ""}
                </span>
              )}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-8 text-xs gap-1.5"
                disabled={alerts.length === 0}
                onClick={() => {
                  const headers = ["Alert ID", "Pattern", "Severity", "Risk Score", "Trader ID", "Declarations", "Status", "Fired At", "Resolved By", "Resolution Note"];
                  const rows = alerts.map((a: any) => [
                    a.alert_id,
                    a.pattern_name,
                    a.severity,
                    a.risk_score ?? "",
                    a.trader_id,
                    (a.declaration_ids ?? []).join(";"),
                    a.status,
                    new Date(a.fired_at).toISOString(),
                    a.resolved_by ?? "",
                    (a.resolution_note ?? "").replace(/,/g, " "),
                  ]);
                  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
                  const blob = new Blob([csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `cep-alerts-${activeTab}-${new Date().toISOString().slice(0, 10)}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
            {alertsQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading alerts…</div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-green-400" />
                {severityFilter !== "all" ? `No ${activeTab} ${severityFilter} alerts` : `No ${activeTab} alerts`}
              </div>
            ) : (
              <>
                {/* Bulk action toolbar */}
                {activeTab === "open" && someSelected && (
                  <div className="flex items-center gap-3 mb-3 px-2 py-2 rounded-lg bg-muted/40 border border-border">
                    <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-green-600 hover:bg-green-700"
                      onClick={() => setBulkDialog(true)}
                    >
                      Resolve selected
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      {activeTab === "open" && (
                        <TableHead className="w-8">
                          <Checkbox
                            checked={allOpenSelected}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setSelectedIds(new Set(openAlerts.map((a: any) => a.alert_id)));
                              } else {
                                setSelectedIds(new Set());
                              }
                            }}
                          />
                        </TableHead>
                      )}
                      <TableHead>Pattern</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Risk Score</TableHead>
                      <TableHead>Trader</TableHead>
                      <TableHead>Declarations</TableHead>
                      <TableHead>Fired At</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.alert_id} className={selectedIds.has(alert.alert_id) ? "bg-muted/30" : ""}>
                      {activeTab === "open" && (
                        <TableCell className="w-8">
                          {(alert.status === "open" || alert.status === "investigating") && (
                            <Checkbox
                              checked={selectedIds.has(alert.alert_id)}
                              onCheckedChange={(checked) => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(alert.alert_id);
                                  else next.delete(alert.alert_id);
                                  return next;
                                });
                              }}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {PATTERN_ICONS[alert.pattern_id] ?? <AlertTriangle className="h-4 w-4" />}
                          </span>
                          <span className="text-sm font-medium text-foreground">{alert.pattern_name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={SEVERITY_COLORS[alert.severity] ?? "bg-gray-500 text-white"}>
                          {alert.severity.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const score = alert.risk_score ?? null;
                          if (score === null) return <span className="text-xs text-muted-foreground">—</span>;
                          const cls =
                            score >= 71 ? "bg-red-100 text-red-700" :
                            score >= 41 ? "bg-amber-100 text-amber-700" :
                            "bg-green-100 text-green-700";
                          return (
                            <Badge className={`${cls} font-mono text-xs`}>{score}</Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground font-mono">{alert.trader_id}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {alert.declaration_ids.length} declaration{alert.declaration_ids.length !== 1 ? "s" : ""}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(alert.fired_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 text-blue-400 hover:text-blue-300"
                          onClick={() => setDrawerAlert(alert)}
                        >
                          View
                        </Button>
                        {(alert.status === "open" || alert.status === "investigating") && (
                          <div className="flex items-center gap-1.5">
                            {alert.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-xs h-7"
                                onClick={() => {
                                  setAckStatus("investigating");
                                  setAckDialog({ alertId: alert.alert_id, patternName: alert.pattern_name, mode: "investigate" });
                                }}
                              >
                                Investigate
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="default"
                              className="text-xs h-7 bg-green-600 hover:bg-green-700"
                              onClick={() => {
                                setAckStatus("resolved");
                                setAckDialog({ alertId: alert.alert_id, patternName: alert.pattern_name, mode: "resolve" });
                              }}
                            >
                              Resolve
                            </Button>
                          </div>
                        )}
                        {alert.status === "investigating" && (
                          <span className="text-xs text-yellow-400 font-medium">⚑ Investigating</span>
                        )}
                        {(alert.status === "resolved" || alert.status === "false_positive") && (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-green-400 font-medium">
                              {alert.status === "false_positive" ? "✗ False Positive" : "✓ Resolved"}
                            </span>
                            {alert.resolved_by && (
                              <span className="text-xs text-muted-foreground">{alert.resolved_by}</span>
                            )}
                          </div>
                        )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>

        {/* Active Patterns */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Registered CEP Patterns</CardTitle>
              {user?.role === "admin" && (
                <Button
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setCreatePatternDialog(true)}
                >
                  + Add Pattern
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(patternsQuery.data ?? []).map((pattern) => {
                const p = pattern as any;
                return (
                <div key={p.pattern_id} className="p-3 rounded-lg border border-border bg-muted/20">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{PATTERN_ICONS[p.pattern_id] ?? <AlertTriangle className="h-4 w-4" />}</span>
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={p.status === "enabled" ? "default" : "secondary"} className="text-xs">
                        {p.status === "enabled" ? "Active" : "Disabled"}
                      </Badge>
                      {user?.role === "admin" && (
                        <Switch
                          checked={p.status === "enabled"}
                          disabled={togglePatternMutation.isPending}
                          onCheckedChange={(checked) =>
                            togglePatternMutation.mutate({ patternId: p.pattern_id, status: checked ? "enabled" : "disabled" })
                          }
                          aria-label={`Toggle ${p.name}`}
                        />
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                  {/* Real 7-day alert history sparkline with threshold highlight */}
                  <PatternSparkline patternId={p.pattern_id} threshold={p.daily_alert_threshold ?? null} />
                  {user?.role === "admin" && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
                        onClick={() => { setTestFireDialog({ patternId: p.pattern_id, patternName: p.name }); setTestFireResult(null); }}
                      >
                        <Zap className="h-3 w-3 mr-1" /> Test Pattern
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                        onClick={() => { setThresholdDialog({ patternId: p.pattern_id, patternName: p.name, current: p.daily_alert_threshold ?? null }); setThresholdInput(""); }}
                      >
                        {p.daily_alert_threshold ? `Threshold: ${p.daily_alert_threshold}/day` : "Set Threshold"}
                      </Button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Suppression History — admin-only collapsible section */}
      {user?.role === "admin" && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
                Suppression History
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => { setShowSuppressionHistory(!showSuppressionHistory); setSuppLogPage(1); }}
              >
                {showSuppressionHistory ? "Hide" : "Show Audit Log"}
              </Button>
            </div>
          </CardHeader>
          {showSuppressionHistory && (
            <CardContent>
              {suppressionLogQuery.isLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Loading…</p>
              ) : (suppressionLogQuery.data?.rows ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">No suppression actions recorded yet.</p>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Alert ID</TableHead>
                        <TableHead className="text-xs">Pattern</TableHead>
                        <TableHead className="text-xs">Suppressed By</TableHead>
                        <TableHead className="text-xs">Duration</TableHead>
                        <TableHead className="text-xs">Suppressed Until</TableHead>
                        <TableHead className="text-xs">Logged At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(suppressionLogQuery.data?.rows ?? []).map((row: any) => (
                        <TableRow key={row.id}>
                          <TableCell className="text-xs font-mono">{row.alert_id.slice(0, 12)}…</TableCell>
                          <TableCell className="text-xs">{row.pattern_name}</TableCell>
                          <TableCell className="text-xs">{row.suppressed_by_name ?? "—"}</TableCell>
                          <TableCell className="text-xs">{row.hours}h</TableCell>
                          <TableCell className="text-xs">{new Date(row.suppressed_until).toLocaleString()}</TableCell>
                          <TableCell className="text-xs">{new Date(row.created_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {/* Pagination */}
                  {(suppressionLogQuery.data?.total ?? 0) > 20 && (
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-muted-foreground">
                        {suppressionLogQuery.data?.total} total entries
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs"
                          disabled={suppLogPage <= 1}
                          onClick={() => setSuppLogPage(p => p - 1)}
                        >Prev</Button>
                        <span className="text-xs self-center">Page {suppLogPage}</span>
                        <Button
                          variant="outline" size="sm" className="h-7 text-xs"
                          disabled={(suppLogPage * 20) >= (suppressionLogQuery.data?.total ?? 0)}
                          onClick={() => setSuppLogPage(p => p + 1)}
                        >Next</Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {/* Create Pattern Dialog */}
      <Dialog open={createPatternDialog} onOpenChange={(open) => { if (!open) { setCreatePatternDialog(false); setNewPatternName(""); setNewPatternDesc(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom CEP Pattern</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Custom patterns are evaluated against all incoming declarations. A unique pattern ID will be auto-generated.
            </p>
            <div className="space-y-2">
              <Label>Pattern Name <span className="text-red-500">*</span></Label>
              <Input
                value={newPatternName}
                onChange={(e) => setNewPatternName(e.target.value)}
                placeholder="e.g. High-Value Low-Duty Mismatch"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={newPatternDesc}
                onChange={(e) => setNewPatternDesc(e.target.value)}
                placeholder="Describe what this pattern detects and when it fires…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatePatternDialog(false)}>Cancel</Button>
            <Button
              disabled={newPatternName.trim().length < 3 || createPatternMutation.isPending}
              onClick={() => createPatternMutation.mutate({ name: newPatternName.trim(), description: newPatternDesc.trim() || undefined })}
            >
              {createPatternMutation.isPending ? "Creating…" : "Create Pattern"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Resolve Dialog */}
      <Dialog open={bulkDialog} onOpenChange={(open) => { if (!open) { setBulkDialog(false); setBulkNotes(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Resolve {selectedIds.size} Alert{selectedIds.size !== 1 ? "s" : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This will mark all {selectedIds.size} selected alert{selectedIds.size !== 1 ? "s" : ""} as resolved in parallel.
              Already-resolved alerts are automatically skipped.
            </p>
            <div className="space-y-2">
              <Label>Resolution status</Label>
              <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as "resolved" | "false_positive")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="false_positive">False Positive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Resolution notes (optional)</Label>
              <Textarea
                value={bulkNotes}
                onChange={(e) => setBulkNotes(e.target.value)}
                placeholder="Describe the bulk resolution outcome…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialog(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={bulkAckMutation.isPending}
              onClick={() => bulkAckMutation.mutate({
                alertIds: Array.from(selectedIds),
                status: bulkStatus,
                resolutionNote: bulkNotes || undefined,
              })}
            >
              {bulkAckMutation.isPending ? "Resolving…" : `Resolve ${selectedIds.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Acknowledge / Resolve Dialog */}
      <Dialog open={!!ackDialog} onOpenChange={() => { setAckDialog(null); setAckNotes(""); setAckStatus("investigating"); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ackDialog?.mode === "resolve" ? "Resolve Alert" : "Investigate Alert"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Alert: <strong className="text-foreground">{ackDialog?.patternName}</strong>
            </p>

            {/* Status selector — only shown in resolve mode */}
            {ackDialog?.mode === "resolve" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Resolution Status</Label>
                <Select
                  value={ackStatus}
                  onValueChange={(v) => setAckStatus(v as typeof ackStatus)}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="resolved">✓ Resolved — confirmed fraud / actioned</SelectItem>
                    <SelectItem value="false_positive">✗ False Positive — no further action</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                {ackDialog?.mode === "resolve" ? "Resolution notes (required)" : "Investigation notes (optional)"}
              </Label>
              <Textarea
                placeholder={ackDialog?.mode === "resolve" ? "Describe the outcome and actions taken…" : "Add initial investigation notes…"}
                value={ackNotes}
                onChange={(e) => setAckNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAckDialog(null); setAckNotes(""); setAckStatus("investigating"); }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!ackDialog) return;
                if (ackDialog.mode === "resolve" && !ackNotes.trim()) {
                  toast.error("Resolution notes are required when resolving an alert");
                  return;
                }
                ackMutation.mutate({
                  alertId: ackDialog.alertId,
                  status: ackDialog.mode === "resolve" ? ackStatus : "investigating",
                  resolutionNote: ackNotes.trim() || undefined,
                });
              }}
              disabled={ackMutation.isPending}
              className={ackDialog?.mode === "resolve" ? "bg-green-600 hover:bg-green-700" : ""}
            >
              {ackMutation.isPending
                ? "Saving…"
                : ackDialog?.mode === "resolve"
                  ? "Confirm Resolution"
                  : "Start Investigation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Alert Detail Drawer */}
      <Sheet open={!!drawerAlert} onOpenChange={(open) => { if (!open) setDrawerAlert(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="pb-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <span className="text-muted-foreground">
                {drawerAlert && (PATTERN_ICONS[drawerAlert.pattern_id] ?? <AlertTriangle className="h-4 w-4" />)}
              </span>
              {drawerAlert?.pattern_name}
            </SheetTitle>
          </SheetHeader>
          {drawerAlert && (
            <div className="px-4 pb-6 space-y-5">
              {/* Status + Severity row */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={SEVERITY_COLORS[drawerAlert.severity] ?? "bg-gray-500 text-white"}>
                  {drawerAlert.severity.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">{drawerAlert.status.replace(/_/g, " ")}</Badge>
                {drawerAlert.risk_score !== null && drawerAlert.risk_score !== undefined && (
                  <Badge className={`font-mono text-xs ${
                    drawerAlert.risk_score >= 71 ? "bg-red-100 text-red-700" :
                    drawerAlert.risk_score >= 41 ? "bg-amber-100 text-amber-700" :
                    "bg-green-100 text-green-700"
                  }`}>Risk {drawerAlert.risk_score}</Badge>
                )}
              </div>

              {/* Key metadata */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Alert ID</p>
                  <p className="font-mono text-xs">{drawerAlert.alert_id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Trader ID</p>
                  <p className="font-mono text-xs">{drawerAlert.trader_id}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Fired At</p>
                  <p className="text-xs">{new Date(drawerAlert.fired_at).toLocaleString()}</p>
                </div>
                {drawerAlert.resolved_at && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Resolved At</p>
                    <p className="text-xs">{new Date(drawerAlert.resolved_at).toLocaleString()}</p>
                  </div>
                )}
                {drawerAlert.resolved_by && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Resolved By</p>
                    <p className="text-xs">{drawerAlert.resolved_by}</p>
                  </div>
                )}
              </div>

              {/* Declaration IDs */}
              {drawerAlert.declaration_ids?.length > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Linked Declarations ({drawerAlert.declaration_ids.length})</p>
                  <div className="flex flex-wrap gap-1.5">
                    {drawerAlert.declaration_ids.map((id: string | number) => (
                      <Badge key={id} variant="outline" className="font-mono text-xs">{id}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Details payload */}
              {drawerAlert.details && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Event Payload</p>
                  <pre className="bg-muted/40 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all border border-border">
                    {JSON.stringify(
                      typeof drawerAlert.details === "string"
                        ? JSON.parse(drawerAlert.details)
                        : drawerAlert.details,
                      null, 2
                    )}
                  </pre>
                </div>
              )}

              {/* Resolution note */}
              {drawerAlert.resolution_note && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Resolution Notes</p>
                  <p className="text-sm bg-muted/30 rounded-lg p-3 border border-border">{drawerAlert.resolution_note}</p>
                </div>
              )}

              {/* Quick-action buttons */}
              {(drawerAlert.status === "open" || drawerAlert.status === "investigating") && (
                <div className="flex gap-2 pt-2 border-t border-border flex-wrap">
                  {drawerAlert.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        setAckStatus("investigating");
                        setAckDialog({ alertId: drawerAlert.alert_id, patternName: drawerAlert.pattern_name, mode: "investigate" });
                        setDrawerAlert(null);
                      }}
                    >
                      Investigate
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="text-xs bg-green-600 hover:bg-green-700"
                    onClick={() => {
                      setAckStatus("resolved");
                      setAckDialog({ alertId: drawerAlert.alert_id, patternName: drawerAlert.pattern_name, mode: "resolve" });
                      setDrawerAlert(null);
                    }}
                  >
                    Resolve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => {
                      setSuppressDialog({ alertId: drawerAlert.alert_id, patternName: drawerAlert.pattern_name });
                      setSuppressHours("24");
                      setDrawerAlert(null);
                    }}
                  >
                    Suppress
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Test-Fire Dialog */}
      <Dialog open={!!testFireDialog} onOpenChange={(open) => { if (!open) { setTestFireDialog(null); setTestFireResult(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-400" />
              Test Pattern: {testFireDialog?.patternName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Send a synthetic event to the CEP webhook to validate this pattern fires correctly.
              A real alert will be created in the database.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Event Payload (JSON)</Label>
              <Textarea
                value={testFirePayload}
                onChange={(e) => setTestFirePayload(e.target.value)}
                rows={4}
                className="font-mono text-xs"
                placeholder='{"declarationId": 99999, "traderId": 1}'
              />
            </div>
            {testFireResult && (
              <div className={`rounded-lg p-3 text-sm font-mono ${
                testFireResult.error
                  ? "bg-red-500/10 border border-red-500/30 text-red-400"
                  : "bg-green-500/10 border border-green-500/30 text-green-400"
              }`}>
                {testFireResult.error ? "✗" : "✓"} {testFireResult.message}
                {testFireResult.alertId && (
                  <div className="text-xs mt-1 text-muted-foreground">Alert ID: {testFireResult.alertId}</div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTestFireDialog(null); setTestFireResult(null); }}>Close</Button>
            <Button
              onClick={handleTestFire}
              disabled={testFireLoading}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {testFireLoading ? "Firing…" : "Fire Test Event"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suppress Alert Dialog */}
      <Dialog open={!!suppressDialog} onOpenChange={(open) => { if (!open) { setSuppressDialog(null); setSuppressHours("24"); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Suppress Alert</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Alert: <strong className="text-foreground">{suppressDialog?.patternName}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              This alert will be hidden from the active list until the suppression window expires.
              It remains in the database and can still be audited.
            </p>
            <div className="space-y-2">
              <Label>Suppress for</Label>
              <Select value={suppressHours} onValueChange={setSuppressHours}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="4">4 hours</SelectItem>
                  <SelectItem value="8">8 hours</SelectItem>
                  <SelectItem value="24">24 hours (1 day)</SelectItem>
                  <SelectItem value="72">72 hours (3 days)</SelectItem>
                  <SelectItem value="168">168 hours (1 week)</SelectItem>
                  <SelectItem value="720">720 hours (30 days)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuppressDialog(null)}>Cancel</Button>
            <Button
              className="bg-amber-500 hover:bg-amber-600 text-black"
              disabled={suppressMutation.isPending}
              onClick={() => suppressDialog && suppressMutation.mutate({
                alertId: suppressDialog.alertId,
                hours: parseInt(suppressHours, 10),
              })}
            >
              {suppressMutation.isPending ? "Suppressing…" : `Suppress for ${suppressHours}h`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pattern Alert Threshold Dialog */}
      <Dialog open={!!thresholdDialog} onOpenChange={(open) => { if (!open) { setThresholdDialog(null); setThresholdInput(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Set Alert Threshold</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Pattern: <strong className="text-foreground">{thresholdDialog?.patternName}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              When the daily alert count exceeds this threshold, the sparkline bar will turn red.
              Leave blank to clear the threshold.
            </p>
            <div className="space-y-2">
              <Label>Daily alert threshold</Label>
              <Input
                type="number"
                min="1"
                placeholder={thresholdDialog?.current ? String(thresholdDialog.current) : "e.g. 5"}
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
              />
              {thresholdDialog?.current && (
                <p className="text-xs text-muted-foreground">Current threshold: {thresholdDialog.current}/day</p>
              )}
            </div>
          </div>
          <DialogFooter>
            {thresholdDialog?.current && (
              <Button
                variant="outline"
                className="text-red-400 border-red-400/40 hover:bg-red-500/10 mr-auto"
                disabled={updateThresholdMutation.isPending}
                onClick={() => thresholdDialog && updateThresholdMutation.mutate({ patternId: thresholdDialog.patternId, threshold: null })}
              >
                Clear
              </Button>
            )}
            <Button variant="outline" onClick={() => setThresholdDialog(null)}>Cancel</Button>
            <Button
              disabled={updateThresholdMutation.isPending || !thresholdInput}
              onClick={() => thresholdDialog && updateThresholdMutation.mutate({
                patternId: thresholdDialog.patternId,
                threshold: parseInt(thresholdInput, 10),
              })}
            >
              {updateThresholdMutation.isPending ? "Saving…" : "Save Threshold"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
