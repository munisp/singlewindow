/**
 * SystemStatus — /app/admin/system-status
 * Real-time system health dashboard that polls /api/health every 15 seconds.
 * Visualises component health, uptime, response latencies, and DEMO_MODE state.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  Server,
  Database,
  Zap,
  Shield,
  Globe,
  Cpu,
  Layers,
  Lock,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "degraded" | "down";

interface ComponentHealth {
  status: HealthStatus;
  latencyMs?: number;
  message?: string;
  optional?: boolean;
}

interface HealthReport {
  status: HealthStatus;
  version: string;
  uptime: number;
  timestamp: string;
  components: {
    database: ComponentHealth;
    redis: ComponentHealth;
    tigerbeetle: ComponentHealth;
    temporal: ComponentHealth;
    kafka: ComponentHealth;
    aseanSw: ComponentHealth;
    cenService: ComponentHealth;
    permify: ComponentHealth;
  };
  demoMode: boolean;
  workerStatus: {
    running: boolean;
    startedAt: Date | null;
    lastCycleAt: Date | null;
    itemsProcessedTotal: number;
  };
}

interface HistoryPoint {
  ts: number;
  status: HealthStatus;
  latencyMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 15_000;
const HISTORY_MAX = 20;

const COMPONENT_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }>; critical: boolean }
> = {
  database: { label: "Database (MySQL/TiDB)", icon: Database, critical: true },
  redis: { label: "Redis Cache", icon: Zap, critical: false },
  tigerbeetle: { label: "TigerBeetle Ledger", icon: Layers, critical: false },
  temporal: { label: "Temporal Workflows", icon: Cpu, critical: false },
  kafka: { label: "Kafka Event Bus", icon: Activity, critical: false },
  aseanSw: { label: "ASEAN Single Window", icon: Globe, critical: false },
  cenService: { label: "WCO CEN Service", icon: Shield, critical: false },
  permify: { label: "Permify AuthZ", icon: Lock, critical: false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function statusColor(status: HealthStatus): string {
  return status === "ok"
    ? "text-green-600"
    : status === "degraded"
    ? "text-amber-600"
    : "text-red-600";
}

function statusBg(status: HealthStatus): string {
  return status === "ok"
    ? "bg-green-100 text-green-800 border-green-200"
    : status === "degraded"
    ? "bg-amber-100 text-amber-800 border-amber-200"
    : "bg-red-100 text-red-800 border-red-200";
}

function StatusIcon({ status, className }: { status: HealthStatus; className?: string }) {
  if (status === "ok")
    return <CheckCircle2 className={`${className} text-green-600`} />;
  if (status === "degraded")
    return <AlertTriangle className={`${className} text-amber-600`} />;
  return <XCircle className={`${className} text-red-600`} />;
}

function LatencyBar({ ms }: { ms?: number }) {
  if (ms === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = Math.min(100, (ms / 2000) * 100);
  const color =
    ms < 100 ? "bg-green-500" : ms < 500 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <Progress value={pct} className={`h-1.5 w-16 [&>div]:${color}`} />
      <span className="text-xs font-mono text-muted-foreground">{ms}ms</span>
    </div>
  );
}

// ─── Mini sparkline (SVG) ─────────────────────────────────────────────────────

function Sparkline({ history }: { history: HistoryPoint[] }) {
  if (history.length < 2) return null;
  const maxMs = Math.max(...history.map((h) => h.latencyMs), 1);
  const W = 80;
  const H = 24;
  const pts = history
    .map((h, i) => {
      const x = (i / (history.length - 1)) * W;
      const y = H - (h.latencyMs / maxMs) * H;
      return `${x},${y}`;
    })
    .join(" ");
  const lastStatus = history[history.length - 1]?.status;
  const stroke =
    lastStatus === "ok" ? "#16a34a" : lastStatus === "degraded" ? "#d97706" : "#dc2626";
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

// ─── Cron Execution Charts ───────────────────────────────────────────────────

const CRON_COLORS = {
  success: "#16a34a",
  error: "#dc2626",
};

const PIE_COLORS = ["#16a34a", "#dc2626"];

function CronExecutionCharts() {
  const [selectedJob, setSelectedJob] = useState<string | undefined>(undefined);

  const { data: runHistory, isLoading } = trpc.heartbeatJobs.listRunHistory.useQuery(
    { jobName: selectedJob, limit: 100 },
    { refetchInterval: 30_000 }
  );

  const { data: jobDefs } = trpc.heartbeatJobs.listJobs.useQuery();

  // Derive unique job names from history
  const jobNames = useMemo(() => {
    const names = new Set<string>();
    runHistory?.forEach((r: any) => names.add(r.jobName));
    return Array.from(names).sort();
  }, [runHistory]);

  // Success rate donut data
  const successRateData = useMemo(() => {
    if (!runHistory || runHistory.length === 0) return [];
    const successCount = runHistory.filter((r: any) => r.status === "success").length;
    const errorCount = runHistory.length - successCount;
    return [
      { name: "Success", value: successCount },
      { name: "Error", value: errorCount },
    ];
  }, [runHistory]);

  // Per-job success rate bar data
  const jobSuccessRates = useMemo(() => {
    if (!runHistory || runHistory.length === 0) return [];
    const byJob: Record<string, { total: number; success: number; avgDurationMs: number }> = {};
    for (const r of runHistory as any[]) {
      if (!byJob[r.jobName]) byJob[r.jobName] = { total: 0, success: 0, avgDurationMs: 0 };
      byJob[r.jobName].total++;
      if (r.status === "success") byJob[r.jobName].success++;
      byJob[r.jobName].avgDurationMs += r.durationMs ?? 0;
    }
    return Object.entries(byJob).map(([jobName, stats]) => ({
      jobName: jobName.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim(),
      rawJobName: jobName,
      successRate: Math.round((stats.success / stats.total) * 100),
      totalRuns: stats.total,
      avgDurationMs: Math.round(stats.avgDurationMs / stats.total),
    }));
  }, [runHistory]);

  // Timeline bar chart: last 20 runs grouped by hour
  const timelineData = useMemo(() => {
    if (!runHistory || runHistory.length === 0) return [];
    const hourMap: Record<string, { success: number; error: number }> = {};
    for (const r of (runHistory as any[]).slice(0, 50)) {
      const hour = new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (!hourMap[hour]) hourMap[hour] = { success: 0, error: 0 };
      if (r.status === "success") hourMap[hour].success++;
      else hourMap[hour].error++;
    }
    return Object.entries(hourMap)
      .slice(-12)
      .map(([time, counts]) => ({ time, ...counts }));
  }, [runHistory]);

  const successRate = successRateData.length > 0
    ? Math.round((successRateData[0]?.value / (successRateData[0]?.value + (successRateData[1]?.value ?? 0))) * 100)
    : 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Cron Job Execution History
            </CardTitle>
            <CardDescription>
              Success rates and execution timeline for scheduled background jobs.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedJob ?? ""}
              onChange={e => setSelectedJob(e.target.value || undefined)}
              className="text-xs border rounded px-2 py-1 bg-background text-foreground"
            >
              <option value="">All Jobs</option>
              {jobNames.map(name => (
                <option key={name} value={name}>{name.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Loading execution history…</span>
          </div>
        ) : !runHistory || runHistory.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No cron execution records found.</p>
            <p className="text-xs mt-1">Records appear after the first scheduled job runs.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary KPIs */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Total Runs</p>
                <p className="text-2xl font-bold">{runHistory.length}</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Success Rate</p>
                <p className="text-2xl font-bold text-green-600">{successRate}%</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Failures</p>
                <p className="text-2xl font-bold text-red-600">{successRateData[1]?.value ?? 0}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Success/Failure donut */}
              <div>
                <p className="text-sm font-medium mb-3">Overall Success Rate</p>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={successRateData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={80}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                        labelLine={false}
                      >
                        {successRateData.map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx]} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Execution timeline */}
              <div>
                <p className="text-sm font-medium mb-3">Execution Timeline (last 50 runs)</p>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={timelineData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <RechartsTooltip />
                      <Bar dataKey="success" stackId="a" fill={CRON_COLORS.success} name="Success" />
                      <Bar dataKey="error" stackId="a" fill={CRON_COLORS.error} name="Error" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Per-job success rates */}
            {jobSuccessRates.length > 1 && (
              <div>
                <p className="text-sm font-medium mb-3">Success Rate by Job</p>
                <div style={{ height: Math.max(160, jobSuccessRates.length * 36) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={jobSuccessRates}
                      layout="vertical"
                      margin={{ top: 0, right: 30, left: 10, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                      <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} unit="%" />
                      <YAxis dataKey="jobName" type="category" tick={{ fontSize: 10 }} width={120} />
                      <RechartsTooltip formatter={(val: any) => `${val}%`} />
                      <Bar dataKey="successRate" fill="#16a34a" name="Success Rate" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Recent runs table */}
            <div>
              <p className="text-sm font-medium mb-2">Recent Executions</p>
              <div className="overflow-x-auto rounded border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Job</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Trigger</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Duration</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">Started At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(runHistory as any[]).slice(0, 15).map((r: any) => (
                      <tr key={r.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono">{r.jobName}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            r.status === "success"
                              ? "bg-green-100 text-green-800"
                              : "bg-red-100 text-red-800"
                          }`}>
                            {r.status === "success" ? (
                              <CheckCircle2 className="h-2.5 w-2.5" />
                            ) : (
                              <XCircle className="h-2.5 w-2.5" />
                            )}
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.triggeredBy ?? "scheduler"}</td>
                        <td className="px-3 py-2 text-right font-mono">
                          {r.durationMs != null ? `${r.durationMs}ms` : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SystemStatus() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(POLL_INTERVAL_MS / 1000);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [componentHistory, setComponentHistory] = useState<
    Record<string, HistoryPoint[]>
  >({});
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: HealthReport = await res.json();
      setReport(data);
      setError(null);
      setLastFetched(new Date());

      // Update global history
      setHistory((prev) => {
        const next = [
          ...prev,
          { ts: Date.now(), status: data.status, latencyMs: 0 },
        ].slice(-HISTORY_MAX);
        return next;
      });

      // Update per-component history
      setComponentHistory((prev) => {
        const updated = { ...prev };
        for (const [key, comp] of Object.entries(data.components)) {
          const c = comp as ComponentHealth;
          const pts = prev[key] ?? [];
          updated[key] = [
            ...pts,
            { ts: Date.now(), status: c.status, latencyMs: c.latencyMs ?? 0 },
          ].slice(-HISTORY_MAX);
        }
        return updated;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch health data");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchHealth();
    intervalRef.current = setInterval(() => {
      fetchHealth();
      setCountdown(POLL_INTERVAL_MS / 1000);
    }, POLL_INTERVAL_MS);

    countdownRef.current = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchHealth]);

  function handleManualRefresh() {
    setCountdown(POLL_INTERVAL_MS / 1000);
    setLoading(true);
    fetchHealth();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold tracking-tight">System Status</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Real-time health of all platform components. Auto-refreshes every 15 seconds.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {lastFetched && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Next refresh in {countdown}s
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800">
            <WifiOff className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-medium text-sm">Health endpoint unreachable</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !report && (
          <div className="flex items-center justify-center py-20 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Fetching health data…</span>
          </div>
        )}

        {report && (
          <>
            {/* Overall status banner */}
            <Card
              className={
                report.status === "ok"
                  ? "border-green-200 bg-green-50/40"
                  : report.status === "degraded"
                  ? "border-amber-200 bg-amber-50/40"
                  : "border-red-200 bg-red-50/40"
              }
            >
              <CardContent className="pt-5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={report.status} className="h-8 w-8" />
                    <div>
                      <p className="text-lg font-bold capitalize">
                        {report.status === "ok"
                          ? "All Systems Operational"
                          : report.status === "degraded"
                          ? "Partial Degradation"
                          : "System Outage Detected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Version {report.version} · Uptime {formatUptime(report.uptime)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {report.demoMode && (
                      <Badge className="bg-blue-100 text-blue-800 border-blue-200">
                        DEMO MODE
                      </Badge>
                    )}
                    <Badge className={statusBg(report.status)}>
                      {report.status.toUpperCase()}
                    </Badge>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wifi className="h-3.5 w-3.5 text-green-600" />
                      Live
                    </div>
                  </div>
                </div>

                {/* History sparkline */}
                {history.length > 1 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-1">
                      Status history (last {history.length} polls)
                    </p>
                    <div className="flex gap-1">
                      {history.map((h, i) => (
                        <Tooltip key={i}>
                          <TooltipTrigger asChild>
                            <div
                              className={`h-4 w-3 rounded-sm cursor-default ${
                                h.status === "ok"
                                  ? "bg-green-400"
                                  : h.status === "degraded"
                                  ? "bg-amber-400"
                                  : "bg-red-400"
                              }`}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">
                              {new Date(h.ts).toLocaleTimeString()} — {h.status}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Uptime</CardDescription>
                  <CardTitle className="text-xl font-mono">
                    {formatUptime(report.uptime)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Healthy Components</CardDescription>
                  <CardTitle className="text-xl text-green-600">
                    {
                      Object.values(report.components).filter(
                        (c) => (c as ComponentHealth).status === "ok"
                      ).length
                    }{" "}
                    / {Object.keys(report.components).length}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Payment Worker</CardDescription>
                  <CardTitle className="text-xl">
                    {report.workerStatus.running ? (
                      <span className="text-green-600">Running</span>
                    ) : (
                      <span className="text-muted-foreground">Stopped</span>
                    )}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Items Processed</CardDescription>
                  <CardTitle className="text-xl font-mono">
                    {report.workerStatus.itemsProcessedTotal.toLocaleString()}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            {/* Component grid */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Component Health</CardTitle>
                <CardDescription>
                  Individual service status, latency, and trend for each platform component.
                  Critical components are marked with a red dot.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(report.components).map(([key, rawComp]) => {
                    const comp = rawComp as ComponentHealth;
                    const meta = COMPONENT_META[key];
                    const Icon = meta?.icon ?? Server;
                    const hist = componentHistory[key] ?? [];
                    return (
                      <div
                        key={key}
                        className={`flex items-start justify-between p-4 rounded-lg border ${
                          comp.status === "ok"
                            ? "border-green-100 bg-green-50/30"
                            : comp.status === "degraded"
                            ? "border-amber-100 bg-amber-50/30"
                            : "border-red-100 bg-red-50/30"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 p-1.5 rounded-md ${
                              comp.status === "ok"
                                ? "bg-green-100"
                                : comp.status === "degraded"
                                ? "bg-amber-100"
                                : "bg-red-100"
                            }`}
                          >
                            <Icon className={`h-4 w-4 ${statusColor(comp.status)}`} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{meta?.label ?? key}</p>
                              {meta?.critical && (
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500 inline-block" />
                              )}
                              {comp.optional && (
                                <Badge variant="outline" className="text-xs py-0 px-1">
                                  optional
                                </Badge>
                              )}
                            </div>
                            <LatencyBar ms={comp.latencyMs} />
                            {comp.message && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {comp.message}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <StatusIcon status={comp.status} className="h-5 w-5" />
                          {hist.length > 1 && <Sparkline history={hist} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Worker details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4" />
                  Payment Worker Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">State</p>
                    <p className={`font-medium ${report.workerStatus.running ? "text-green-600" : "text-muted-foreground"}`}>
                      {report.workerStatus.running ? "Running" : "Stopped"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Started At</p>
                    <p className="font-mono text-xs">
                      {report.workerStatus.startedAt
                        ? new Date(report.workerStatus.startedAt).toLocaleTimeString()
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last Cycle</p>
                    <p className="font-mono text-xs">
                      {report.workerStatus.lastCycleAt
                        ? new Date(report.workerStatus.lastCycleAt).toLocaleTimeString()
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Processed</p>
                    <p className="font-mono font-medium">
                      {report.workerStatus.itemsProcessedTotal.toLocaleString()}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ── Cron Job Execution History ─────────────────────────────── */}
            <CronExecutionCharts />

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Last updated:{" "}
                {lastFetched?.toLocaleTimeString(undefined, { timeStyle: "medium" }) ?? "—"}
              </span>
              <span>Polling interval: {POLL_INTERVAL_MS / 1000}s</span>
            </div>
          </>
        )}
      </div>
    </TooltipProvider>
  );
}
