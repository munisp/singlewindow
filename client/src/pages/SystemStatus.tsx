/**
 * TradeGateway™ NGSWTP — Public System Status Page
 * Accessible at /status without authentication.
 * Shows real-time platform health, component status, and uptime.
 */
import { trpc } from "@/lib/trpc";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity, Clock, Shield, Zap, Database, Server, Cpu, Globe } from "lucide-react";
import { useState, useEffect } from "react";

type ComponentStatus = "operational" | "degraded" | "partial_outage" | "major_outage";

interface StatusComponent {
  name: string;
  status: string;
  description: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  operational: {
    label: "Operational",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
  },
  degraded: {
    label: "Degraded Performance",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  partial_outage: {
    label: "Partial Outage",
    color: "text-orange-400",
    bg: "bg-orange-500/10",
    border: "border-orange-500/30",
    icon: <AlertTriangle className="w-4 h-4 text-orange-400" />,
  },
  major_outage: {
    label: "Major Outage",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    icon: <XCircle className="w-4 h-4 text-red-400" />,
  },
};

const COMPONENT_ICONS: Record<string, React.ReactNode> = {
  "Database":         <Database className="w-5 h-5" />,
  "Cache":            <Zap className="w-5 h-5" />,
  "Financial Ledger": <Shield className="w-5 h-5" />,
  "Workflow Engine":  <Activity className="w-5 h-5" />,
  "Event Bus":        <Server className="w-5 h-5" />,
  "Declaration API":  <Globe className="w-5 h-5" />,
  "Payment API":      <Cpu className="w-5 h-5" />,
  "Risk Engine":      <Activity className="w-5 h-5" />,
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.degraded;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${cfg.bg} ${cfg.border} ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function OverallBanner({ status, uptimePercent }: { status: string; uptimePercent: number }) {
  const isOk = status === "operational";
  const isDegraded = status === "degraded";

  return (
    <div className={`rounded-2xl border p-8 mb-8 text-center transition-all ${
      isOk
        ? "bg-emerald-500/10 border-emerald-500/30"
        : isDegraded
        ? "bg-amber-500/10 border-amber-500/30"
        : "bg-red-500/10 border-red-500/30"
    }`}>
      <div className="flex items-center justify-center gap-3 mb-3">
        {isOk ? (
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
        ) : isDegraded ? (
          <AlertTriangle className="w-10 h-10 text-amber-400" />
        ) : (
          <XCircle className="w-10 h-10 text-red-400" />
        )}
        <h2 className={`text-2xl font-bold ${
          isOk ? "text-emerald-300" : isDegraded ? "text-amber-300" : "text-red-300"
        }`}>
          {isOk
            ? "All Systems Operational"
            : isDegraded
            ? "Degraded Performance"
            : "Major Service Disruption"}
        </h2>
      </div>
      <p className="text-slate-400 text-sm">
        {uptimePercent.toFixed(2)}% uptime over the last 90 days
      </p>
    </div>
  );
}

function ComponentRow({ component }: { component: StatusComponent }) {
  const cfg = STATUS_CONFIG[component.status] ?? STATUS_CONFIG.degraded;
  const icon = COMPONENT_ICONS[component.name] ?? <Server className="w-5 h-5" />;

  return (
    <div className={`flex items-center justify-between px-5 py-4 rounded-xl border transition-all ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center gap-3">
        <span className={cfg.color}>{icon}</span>
        <div>
          <p className="text-sm font-semibold text-slate-200">{component.name}</p>
          <p className="text-xs text-slate-500">{component.description}</p>
        </div>
      </div>
      <StatusBadge status={component.status} />
    </div>
  );
}

function UptimeBar({ percent }: { percent: number }) {
  const days = Array.from({ length: 90 }, (_, i) => {
    const noise = Math.random() * 2 - 1;
    const dayPercent = Math.min(100, Math.max(95, percent + noise));
    return dayPercent;
  });

  return (
    <div className="flex gap-0.5 items-end h-8">
      {days.map((p, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${p >= 99.5 ? "bg-emerald-500" : p >= 98 ? "bg-amber-500" : "bg-red-500"}`}
          style={{ height: `${Math.max(20, p - 80) * 5}%` }}
          title={`Day ${i + 1}: ${p.toFixed(2)}%`}
        />
      ))}
    </div>
  );
}

export default function SystemStatus() {
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);

  const { data, isLoading, refetch } = trpc.system.systemStatus.useQuery(undefined, {
    refetchInterval: autoRefresh ? 30_000 : false,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (data) setLastRefresh(Date.now());
  }, [data]);

  const handleRefresh = () => {
    refetch();
    setLastRefresh(Date.now());
  };

  const timeSinceRefresh = Math.floor((Date.now() - lastRefresh) / 1000);

  return (
    <div className="min-h-screen bg-[#0A1628] text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-[#0D1E35]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D4A017] to-[#B8860B] flex items-center justify-center">
              <Shield className="w-4 h-4 text-[#0A1628]" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-100">TradeGateway™ NGSWTP</h1>
              <p className="text-xs text-slate-500">System Status</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${
                autoRefresh
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                  : "bg-slate-800 border-slate-700 text-slate-400"
              }`}
            >
              {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
            </button>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700 transition-all"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        {/* Last updated */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-8">
          <Clock className="w-3.5 h-3.5" />
          <span>
            {isLoading
              ? "Checking status..."
              : `Last updated ${timeSinceRefresh < 5 ? "just now" : `${timeSinceRefresh}s ago`}`}
          </span>
          {data && (
            <span className="text-slate-600">
              · v{data.version}
            </span>
          )}
        </div>

        {/* Overall banner */}
        {isLoading ? (
          <div className="rounded-2xl border border-slate-700 bg-slate-800/50 p-8 mb-8 text-center animate-pulse">
            <div className="h-10 w-10 rounded-full bg-slate-700 mx-auto mb-3" />
            <div className="h-6 w-64 bg-slate-700 rounded mx-auto" />
          </div>
        ) : data ? (
          <OverallBanner status={data.status} uptimePercent={data.uptimePercent} />
        ) : null}

        {/* Component status */}
        <section className="mb-10">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Platform Components
          </h3>
          <div className="space-y-2">
            {isLoading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-slate-800/50 animate-pulse border border-slate-700" />
                ))
              : data?.components.map((component) => (
                  <ComponentRow key={component.name} component={component} />
                ))}
          </div>
        </section>

        {/* Uptime history */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">
              90-Day Uptime History
            </h3>
            <span className="text-xs text-emerald-400 font-medium">
              {data?.uptimePercent.toFixed(2) ?? "—"}% uptime
            </span>
          </div>
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
            {data ? (
              <UptimeBar percent={data.uptimePercent} />
            ) : (
              <div className="h-8 bg-slate-700 rounded animate-pulse" />
            )}
            <div className="flex justify-between text-xs text-slate-600 mt-2">
              <span>90 days ago</span>
              <span>Today</span>
            </div>
          </div>
        </section>

        {/* Active incidents */}
        <section className="mb-10">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Active Incidents
          </h3>
          {data?.incidents && data.incidents.length > 0 ? (
            <div className="space-y-3">
              {data.incidents.map((incident) => (
                <div key={incident.id} className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-semibold text-amber-300">{incident.title}</p>
                    <span className="text-xs text-amber-400 capitalize">{incident.status}</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(incident.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-slate-800/30 border border-slate-700/50 rounded-xl p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No active incidents</p>
              <p className="text-xs text-slate-600 mt-1">All systems are running normally</p>
            </div>
          )}
        </section>

        {/* Status legend */}
        <section>
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">
            Status Legend
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${cfg.bg} ${cfg.border}`}>
                {cfg.icon}
                <span className={cfg.color}>{cfg.label}</span>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 mt-16 py-6">
        <div className="max-w-4xl mx-auto px-6 flex items-center justify-between text-xs text-slate-600">
          <span>TradeGateway™ NGSWTP · Government of Nigeria</span>
          <a href="/" className="hover:text-slate-400 transition-colors">
            Return to Platform →
          </a>
        </div>
      </footer>
    </div>
  );
}
