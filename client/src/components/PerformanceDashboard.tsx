/**
 * TradeGateway NGSWTP — Performance Benchmark Dashboard
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Live-updating p50/p95/p99 latency charts per service, SLA breach alerts,
 * throughput gauges, error rates, and Rust risk-engine rule trace drill-down.
 */

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell
} from "recharts";
import { Activity, AlertTriangle, CheckCircle2, Zap, TrendingUp, TrendingDown, Clock, Cpu } from "lucide-react";

interface ServiceMetric {
  name: string;
  language: "Go" | "Python" | "Rust";
  p50: number;
  p95: number;
  p99: number;
  rps: number;
  errorRate: number;
  slaTarget: number;
  slaBreached: boolean;
}

interface TimePoint {
  t: string;
  [key: string]: number | string;
}

const INITIAL_METRICS: ServiceMetric[] = [
  { name: "declaration-svc", language: "Go", p50: 18, p95: 42, p99: 87, rps: 340, errorRate: 0.02, slaTarget: 200, slaBreached: false },
  { name: "risk-engine", language: "Rust", p50: 12, p95: 28, p99: 61, rps: 890, errorRate: 0.00, slaTarget: 200, slaBreached: false },
  { name: "payment-svc", language: "Go", p50: 145, p95: 380, p99: 720, rps: 120, errorRate: 0.01, slaTarget: 1000, slaBreached: false },
  { name: "oga-hub", language: "Go", p50: 210, p95: 1240, p99: 4800, rps: 85, errorRate: 0.08, slaTarget: 5000, slaBreached: false },
  { name: "ocr-service", language: "Python", p50: 380, p95: 820, p99: 1450, rps: 45, errorRate: 0.03, slaTarget: 2000, slaBreached: false },
  { name: "hs-classifier", language: "Python", p50: 95, p95: 210, p99: 480, rps: 220, errorRate: 0.01, slaTarget: 500, slaBreached: false },
  { name: "fraud-gnn", language: "Python", p50: 280, p95: 640, p99: 1200, rps: 60, errorRate: 0.02, slaTarget: 2000, slaBreached: false },
  { name: "permit-svc", language: "Go", p50: 8, p95: 19, p99: 38, rps: 180, errorRate: 0.00, slaTarget: 100, slaBreached: false },
  { name: "audit-svc", language: "Go", p50: 5, p95: 12, p99: 24, rps: 1200, errorRate: 0.00, slaTarget: 50, slaBreached: false },
  { name: "tb-bridge", language: "Rust", p50: 3, p95: 8, p99: 15, rps: 2400, errorRate: 0.00, slaTarget: 50, slaBreached: false },
  { name: "stream-processor", language: "Rust", p50: 1, p95: 4, p99: 9, rps: 8500, errorRate: 0.00, slaTarget: 20, slaBreached: false },
  { name: "notification-svc", language: "Go", p50: 55, p95: 140, p99: 310, rps: 95, errorRate: 0.04, slaTarget: 500, slaBreached: false },
];

const LANG_COLORS: Record<string, string> = {
  Go: "#00ADD8",
  Python: "#3776AB",
  Rust: "#CE422B",
};

const RUST_RULES = [
  { id: "R001", name: "Country Risk Score", category: "Geographic", weight: 15, triggered: true, ms: 0.8 },
  { id: "R002", name: "HS Code Prohibited List", category: "Compliance", weight: 20, triggered: false, ms: 0.3 },
  { id: "R003", name: "Trader History Score", category: "Behavioral", weight: 18, triggered: true, ms: 1.2 },
  { id: "R004", name: "Invoice Value Threshold", category: "Financial", weight: 12, triggered: true, ms: 0.4 },
  { id: "R005", name: "Dual-Use Goods Check", category: "Security", weight: 25, triggered: false, ms: 0.6 },
  { id: "R006", name: "Sanctions List Match", category: "Security", weight: 30, triggered: false, ms: 2.1 },
  { id: "R007", name: "Routing Anomaly Detection", category: "Geographic", weight: 10, triggered: false, ms: 0.9 },
  { id: "R008", name: "Document Consistency", category: "Compliance", weight: 8, triggered: true, ms: 0.5 },
];

function jitter(base: number, pct = 0.15): number {
  return Math.max(1, Math.round(base * (1 + (Math.random() - 0.5) * pct)));
}

function generateTimePoint(metrics: ServiceMetric[]): TimePoint {
  const pt: TimePoint = { t: new Date().toLocaleTimeString() };
  metrics.forEach((m) => { pt[m.name] = jitter(m.p95); });
  return pt;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0A1628] border border-white/10 rounded-xl p-3 shadow-xl">
      <div className="text-xs text-slate-400 mb-2">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-white font-mono font-bold">{p.value}ms</span>
        </div>
      ))}
    </div>
  );
};

export default function PerformanceDashboard() {
  const [metrics, setMetrics] = useState<ServiceMetric[]>(INITIAL_METRICS);
  const [history, setHistory] = useState<TimePoint[]>(() =>
    Array.from({ length: 20 }, () => generateTimePoint(INITIAL_METRICS))
  );
  const [isLive, setIsLive] = useState(false);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"latency" | "throughput" | "rust-trace">("latency");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isLive) {
      intervalRef.current = setInterval(() => {
        setMetrics((prev) => prev.map((m) => ({
          ...m,
          p50: jitter(m.p50),
          p95: jitter(m.p95),
          p99: jitter(m.p99),
          rps: jitter(m.rps, 0.1),
          errorRate: Math.max(0, m.errorRate + (Math.random() - 0.5) * 0.005),
          slaBreached: jitter(m.p99) > m.slaTarget,
        })));
        setHistory((prev) => {
          const next = [...prev.slice(-29), generateTimePoint(metrics)];
          return next;
        });
      }, 1500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isLive, metrics]);

  const breachedCount = metrics.filter((m) => m.slaBreached).length;
  const avgP95 = Math.round(metrics.reduce((s, m) => s + m.p95, 0) / metrics.length);
  const totalRps = metrics.reduce((s, m) => s + m.rps, 0);

  const selectedMetric = metrics.find((m) => m.name === selectedService) || metrics[0];

  // History lines for the 3 fastest services
  const lineKeys = ["risk-engine", "tb-bridge", "stream-processor"];

  return (
    <section id="performance" className="py-20 bg-[#060F1E]">
      <div className="container max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#D4A017]/10 border border-[#D4A017]/20 text-[#D4A017] text-xs font-medium mb-4">
            <Activity className="w-3.5 h-3.5" />
            Performance Benchmarks
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Live Service <span className="text-[#D4A017]">Metrics</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Real-time p50/p95/p99 latency, throughput, and SLA compliance across all 12 services.
          </p>
        </div>

        {/* Top KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "SLA Breaches", value: breachedCount, icon: AlertTriangle, color: breachedCount > 0 ? "text-red-400" : "text-emerald-400", bg: breachedCount > 0 ? "bg-red-500/10 border-red-500/20" : "bg-emerald-500/10 border-emerald-500/20" },
            { label: "Avg p95 Latency", value: `${avgP95}ms`, icon: Clock, color: "text-[#D4A017]", bg: "bg-[#D4A017]/10 border-[#D4A017]/20" },
            { label: "Total Throughput", value: `${totalRps.toLocaleString()} rps`, icon: Zap, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
            { label: "Services Healthy", value: `${metrics.length - breachedCount}/${metrics.length}`, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className={`rounded-xl border p-4 ${bg}`}>
              <div className="flex items-center gap-2 mb-2">
                <Icon className={`w-4 h-4 ${color}`} />
                <span className="text-xs text-slate-500">{label}</span>
              </div>
              <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Live toggle + tabs */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex gap-1 bg-slate-800/40 rounded-xl p-1">
            {(["latency", "throughput", "rust-trace"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === tab ? "bg-[#D4A017] text-[#0A1628]" : "text-slate-400 hover:text-white"
                }`}
              >
                {tab === "rust-trace" ? "Rust Rule Trace" : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setIsLive((l) => !l)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border transition-colors ${
              isLive ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-300" : "bg-slate-800/60 border-white/10 text-slate-400 hover:text-white"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            {isLive ? "Live" : "Paused"}
          </button>
        </div>

        {/* LATENCY TAB */}
        {activeTab === "latency" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* p50/p95/p99 bar chart */}
            <div className="lg:col-span-2 bg-[#0A1628] border border-white/10 rounded-2xl p-5">
              <div className="text-sm font-semibold text-white mb-4">Latency by Service (ms) — click to drill down</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={metrics} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#64748b", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 10 }} width={110} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="p50" name="p50" radius={[0, 3, 3, 0]} onClick={(d: ServiceMetric) => setSelectedService(d.name)}>
                    {metrics.map((m) => <Cell key={m.name} fill={LANG_COLORS[m.language]} fillOpacity={0.5} />)}
                  </Bar>
                  <Bar dataKey="p95" name="p95" radius={[0, 3, 3, 0]} onClick={(d: ServiceMetric) => setSelectedService(d.name)}>
                    {metrics.map((m) => <Cell key={m.name} fill={LANG_COLORS[m.language]} fillOpacity={0.8} />)}
                  </Bar>
                  <Bar dataKey="p99" name="p99" radius={[0, 3, 3, 0]} onClick={(d: ServiceMetric) => setSelectedService(d.name)}>
                    {metrics.map((m) => <Cell key={m.name} fill={LANG_COLORS[m.language]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {Object.entries(LANG_COLORS).map(([lang, color]) => (
                  <div key={lang} className="flex items-center gap-1.5 text-xs text-slate-400">
                    <div className="w-3 h-3 rounded-sm" style={{ background: color }} />
                    {lang}
                  </div>
                ))}
                <div className="flex items-center gap-3 ml-auto text-xs text-slate-500">
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-white/20 rounded inline-block" />p50</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-white/40 rounded inline-block" />p95</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-1.5 bg-white/70 rounded inline-block" />p99</span>
                </div>
              </div>
            </div>

            {/* Service detail card */}
            <div className="bg-[#0A1628] border border-white/10 rounded-2xl p-5">
              <div className="text-sm font-semibold text-white mb-4">
                {selectedMetric.name}
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full" style={{ background: LANG_COLORS[selectedMetric.language] + "33", color: LANG_COLORS[selectedMetric.language] }}>
                  {selectedMetric.language}
                </span>
              </div>
              <div className="space-y-4">
                {[
                  { label: "p50 Latency", value: `${selectedMetric.p50}ms`, good: selectedMetric.p50 < selectedMetric.slaTarget * 0.3 },
                  { label: "p95 Latency", value: `${selectedMetric.p95}ms`, good: selectedMetric.p95 < selectedMetric.slaTarget * 0.7 },
                  { label: "p99 Latency", value: `${selectedMetric.p99}ms`, good: !selectedMetric.slaBreached },
                  { label: "SLA Target", value: `${selectedMetric.slaTarget}ms`, good: true },
                  { label: "Throughput", value: `${selectedMetric.rps.toLocaleString()} rps`, good: true },
                  { label: "Error Rate", value: `${(selectedMetric.errorRate * 100).toFixed(2)}%`, good: selectedMetric.errorRate < 0.05 },
                ].map(({ label, value, good }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-sm font-bold ${good ? "text-emerald-400" : "text-red-400"}`}>{value}</span>
                      {good ? <TrendingDown className="w-3.5 h-3.5 text-emerald-500" /> : <TrendingUp className="w-3.5 h-3.5 text-red-500" />}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-white/5">
                <div className="text-xs text-slate-500 mb-2">SLA Compliance</div>
                <div className="w-full bg-slate-700/50 rounded-full h-2">
                  <div
                    className="h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, (1 - selectedMetric.p99 / selectedMetric.slaTarget) * 100 + 60)}%`,
                      background: selectedMetric.slaBreached ? "#ef4444" : "#10b981"
                    }}
                  />
                </div>
                <div className={`text-xs mt-1.5 font-medium ${selectedMetric.slaBreached ? "text-red-400" : "text-emerald-400"}`}>
                  {selectedMetric.slaBreached ? "⚠ SLA Breached" : "✓ Within SLA"}
                </div>
              </div>
            </div>

            {/* p95 trend line chart */}
            <div className="lg:col-span-3 bg-[#0A1628] border border-white/10 rounded-2xl p-5">
              <div className="text-sm font-semibold text-white mb-4">p95 Latency Trend — Rust Engines (30s window)</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="t" tick={{ fill: "#64748b", fontSize: 9 }} interval={4} />
                  <YAxis tick={{ fill: "#64748b", fontSize: 9 }} />
                  <Tooltip content={<CustomTooltip />} />
                  {lineKeys.map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={["#CE422B", "#D4A017", "#00ADD8"][i]}
                      strokeWidth={1.5}
                      dot={false}
                      name={key}
                    />
                  ))}
                  <ReferenceLine y={50} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" label={{ value: "SLA", fill: "#64748b", fontSize: 9 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* THROUGHPUT TAB */}
        {activeTab === "throughput" && (
          <div className="bg-[#0A1628] border border-white/10 rounded-2xl p-6">
            <div className="text-sm font-semibold text-white mb-6">Requests Per Second by Service</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {metrics.sort((a, b) => b.rps - a.rps).map((m) => (
                <motion.div
                  key={m.name}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-slate-800/30 border border-white/5 rounded-xl p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-xs font-mono text-white">{m.name}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: LANG_COLORS[m.language] }}>{m.language}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold font-mono text-[#D4A017]">{m.rps.toLocaleString()}</div>
                      <div className="text-[10px] text-slate-500">req/s</div>
                    </div>
                  </div>
                  <div className="w-full bg-slate-700/50 rounded-full h-1.5">
                    <div
                      className="h-1.5 rounded-full transition-all duration-700"
                      style={{ width: `${(m.rps / 8500) * 100}%`, background: LANG_COLORS[m.language] }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-2 text-[10px] text-slate-500">
                    <span>Error: {(m.errorRate * 100).toFixed(2)}%</span>
                    <span className={m.errorRate > 0.05 ? "text-red-400" : "text-emerald-400"}>
                      {m.errorRate > 0.05 ? "⚠ High" : "✓ OK"}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* RUST RULE TRACE TAB */}
        {activeTab === "rust-trace" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#0A1628] border border-white/10 rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-5">
                <Cpu className="w-5 h-5 text-[#CE422B]" />
                <div>
                  <div className="text-sm font-semibold text-white">Rust Risk Engine — Rule Trace</div>
                  <div className="text-xs text-slate-500">200 rules evaluated in parallel via Rayon thread pool</div>
                </div>
              </div>
              <div className="space-y-2">
                {RUST_RULES.map((rule, idx) => (
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                      rule.triggered ? "border-amber-500/30 bg-amber-500/5" : "border-white/5 bg-slate-800/20"
                    }`}
                  >
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.triggered ? "bg-amber-400" : "bg-slate-600"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-slate-400">{rule.id}</span>
                        <span className="text-xs text-white truncate">{rule.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-600 mt-0.5">{rule.category} · weight: {rule.weight}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-xs font-mono font-bold ${rule.triggered ? "text-amber-400" : "text-slate-500"}`}>
                        {rule.triggered ? "TRIGGERED" : "PASS"}
                      </div>
                      <div className="text-[10px] text-slate-600">{rule.ms}ms</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
            <div className="bg-[#0A1628] border border-white/10 rounded-2xl p-6">
              <div className="text-sm font-semibold text-white mb-5">Rule Evaluation Summary</div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total Rules", value: "200", color: "text-white" },
                    { label: "Triggered", value: RUST_RULES.filter((r) => r.triggered).length.toString(), color: "text-amber-400" },
                    { label: "Total Weight", value: RUST_RULES.filter((r) => r.triggered).reduce((s, r) => s + r.weight, 0).toString(), color: "text-red-400" },
                    { label: "Eval Time", value: `${RUST_RULES.reduce((s, r) => s + r.ms, 0).toFixed(1)}ms`, color: "text-emerald-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-slate-800/40 rounded-xl p-3 text-center">
                      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
                      <div className="text-xs text-slate-500 mt-1">{label}</div>
                    </div>
                  ))}
                </div>
                <div className="bg-slate-800/30 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-3">Risk Score Composition</div>
                  <ResponsiveContainer width="100%" height={120}>
                    <BarChart data={RUST_RULES.filter((r) => r.triggered)} margin={{ left: -10 }}>
                      <XAxis dataKey="id" tick={{ fill: "#64748b", fontSize: 9 }} />
                      <YAxis tick={{ fill: "#64748b", fontSize: 9 }} />
                      <Tooltip />
                      <Bar dataKey="weight" fill="#D4A017" radius={[3, 3, 0, 0]} name="Weight" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold text-amber-300">Risk Assessment Result</span>
                  </div>
                  <div className="text-xs text-amber-200/70">
                    Combined weight score: <strong className="text-amber-300">{RUST_RULES.filter((r) => r.triggered).reduce((s, r) => s + r.weight, 0)}/100</strong> → Lane assigned: <strong className="text-amber-300">YELLOW</strong> (Document Review Required)
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
