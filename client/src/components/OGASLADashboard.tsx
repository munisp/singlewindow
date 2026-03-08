/**
 * TradeGateway NGSWTP — OGA SLA Dashboard
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 *
 * Live-updating table showing all 37 OGAs:
 * - Response time targets vs actuals
 * - SLA compliance percentage
 * - Status indicators (green/amber/red)
 * - Escalation paths
 * - Integration protocol details
 */

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/contexts/I18nContext";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Clock, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

// ─── OGA Data ─────────────────────────────────────────────────────────────────

type SLAStatus = "GREEN" | "AMBER" | "RED";
type Trend = "UP" | "DOWN" | "STABLE";

interface OGA {
  code: string;
  name: string;
  category: "CUSTOMS" | "REVENUE" | "HEALTH" | "AGRICULTURE" | "STANDARDS" | "IMMIGRATION" | "PORT" | "FINANCIAL" | "SECURITY" | "TRADE";
  slaTargetHours: number;
  protocol: string;
  dataFormat: string;
  avgResponseHours: number;
  slaCompliancePct: number;
  pendingRequests: number;
  slaBreached: number;
  status: SLAStatus;
  trend: Trend;
  escalationPath: string;
  lastUpdated: string;
}

const generateOGAs = (): OGA[] => [
  { code: "CA", name: "Customs Authority", category: "CUSTOMS", slaTargetHours: 0.5, protocol: "REST/gRPC", dataFormat: "WCO XML", avgResponseHours: 0.3, slaCompliancePct: 99.2, pendingRequests: 12, slaBreached: 0, status: "GREEN", trend: "STABLE", escalationPath: "Commissioner of Customs", lastUpdated: "2 min ago" },
  { code: "RA", name: "Revenue Authority", category: "REVENUE", slaTargetHours: 1.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 0.8, slaCompliancePct: 97.5, pendingRequests: 8, slaBreached: 1, status: "GREEN", trend: "UP", escalationPath: "Commissioner General", lastUpdated: "1 min ago" },
  { code: "MT", name: "Ministry of Trade", category: "TRADE", slaTargetHours: 4.0, protocol: "REST", dataFormat: "JSON/XML", avgResponseHours: 3.2, slaCompliancePct: 94.1, pendingRequests: 23, slaBreached: 3, status: "GREEN", trend: "STABLE", escalationPath: "Director of Trade", lastUpdated: "5 min ago" },
  { code: "FDA", name: "Food & Drug Authority", category: "HEALTH", slaTargetHours: 8.0, protocol: "SOAP/REST", dataFormat: "XML", avgResponseHours: 6.4, slaCompliancePct: 91.8, pendingRequests: 41, slaBreached: 5, status: "GREEN", trend: "DOWN", escalationPath: "Director General FDA", lastUpdated: "8 min ago" },
  { code: "AD", name: "Agriculture Department", category: "AGRICULTURE", slaTargetHours: 6.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 7.8, slaCompliancePct: 78.3, pendingRequests: 67, slaBreached: 18, status: "AMBER", trend: "DOWN", escalationPath: "Director of Agriculture", lastUpdated: "3 min ago" },
  { code: "SA", name: "Standards Authority", category: "STANDARDS", slaTargetHours: 4.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 4.9, slaCompliancePct: 82.6, pendingRequests: 34, slaBreached: 8, status: "AMBER", trend: "STABLE", escalationPath: "CEO Standards Authority", lastUpdated: "12 min ago" },
  { code: "IS", name: "Immigration System", category: "IMMIGRATION", slaTargetHours: 0.5, protocol: "gRPC", dataFormat: "Protobuf", avgResponseHours: 0.4, slaCompliancePct: 98.9, pendingRequests: 5, slaBreached: 0, status: "GREEN", trend: "UP", escalationPath: "Director of Immigration", lastUpdated: "1 min ago" },
  { code: "PA", name: "Port Authority", category: "PORT", slaTargetHours: 1.0, protocol: "REST/EDI", dataFormat: "EDIFACT", avgResponseHours: 1.2, slaCompliancePct: 88.4, pendingRequests: 19, slaBreached: 4, status: "AMBER", trend: "STABLE", escalationPath: "Port Director", lastUpdated: "4 min ago" },
  { code: "CR", name: "Company Registry", category: "TRADE", slaTargetHours: 2.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 1.6, slaCompliancePct: 96.2, pendingRequests: 7, slaBreached: 0, status: "GREEN", trend: "UP", escalationPath: "Registrar General", lastUpdated: "6 min ago" },
  { code: "CB", name: "Central Bank", category: "FINANCIAL", slaTargetHours: 0.25, protocol: "ISO 20022/REST", dataFormat: "JSON/XML", avgResponseHours: 0.18, slaCompliancePct: 99.8, pendingRequests: 3, slaBreached: 0, status: "GREEN", trend: "STABLE", escalationPath: "Governor's Office", lastUpdated: "30 sec ago" },
  { code: "INTERPOL", name: "INTERPOL I-24/7", category: "SECURITY", slaTargetHours: 24.0, protocol: "I-24/7 Secure", dataFormat: "XML/Encrypted", avgResponseHours: 18.4, slaCompliancePct: 93.7, pendingRequests: 2, slaBreached: 0, status: "GREEN", trend: "STABLE", escalationPath: "National Central Bureau", lastUpdated: "1 hr ago" },
  { code: "ASEAN", name: "ASEAN Single Window", category: "TRADE", slaTargetHours: 2.0, protocol: "ASEAN SW Protocol", dataFormat: "XML", avgResponseHours: 2.8, slaCompliancePct: 74.1, pendingRequests: 28, slaBreached: 9, status: "AMBER", trend: "DOWN", escalationPath: "ASEAN Secretariat", lastUpdated: "15 min ago" },
  { code: "WCO", name: "WCO CEN Network", category: "CUSTOMS", slaTargetHours: 4.0, protocol: "WCO CEN", dataFormat: "WCO XML", avgResponseHours: 3.1, slaCompliancePct: 95.4, pendingRequests: 11, slaBreached: 1, status: "GREEN", trend: "STABLE", escalationPath: "WCO Liaison Officer", lastUpdated: "20 min ago" },
  { code: "COMESA", name: "COMESA/EAC Window", category: "TRADE", slaTargetHours: 6.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 8.9, slaCompliancePct: 61.2, pendingRequests: 45, slaBreached: 22, status: "RED", trend: "DOWN", escalationPath: "COMESA Secretariat", lastUpdated: "25 min ago" },
  { code: "PHYTO", name: "Phytosanitary Authority", category: "AGRICULTURE", slaTargetHours: 12.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 9.8, slaCompliancePct: 89.3, pendingRequests: 31, slaBreached: 4, status: "GREEN", trend: "UP", escalationPath: "Chief Phytosanitary Officer", lastUpdated: "10 min ago" },
  { code: "NEMA", name: "Environmental Agency", category: "STANDARDS", slaTargetHours: 8.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 11.2, slaCompliancePct: 72.8, pendingRequests: 18, slaBreached: 7, status: "AMBER", trend: "DOWN", escalationPath: "Director General NEMA", lastUpdated: "18 min ago" },
  { code: "KEBS", name: "Bureau of Standards", category: "STANDARDS", slaTargetHours: 6.0, protocol: "REST", dataFormat: "JSON", avgResponseHours: 5.4, slaCompliancePct: 91.6, pendingRequests: 22, slaBreached: 2, status: "GREEN", trend: "STABLE", escalationPath: "Director Standards", lastUpdated: "7 min ago" },
  { code: "NACC", name: "Anti-Corruption Comm.", category: "SECURITY", slaTargetHours: 48.0, protocol: "Secure REST", dataFormat: "Encrypted JSON", avgResponseHours: 36.2, slaCompliancePct: 87.4, pendingRequests: 4, slaBreached: 0, status: "GREEN", trend: "STABLE", escalationPath: "Director NACC", lastUpdated: "2 hr ago" },
  { code: "NIS", name: "National Intelligence", category: "SECURITY", slaTargetHours: 24.0, protocol: "Classified", dataFormat: "Encrypted", avgResponseHours: 16.8, slaCompliancePct: 94.2, pendingRequests: 1, slaBreached: 0, status: "GREEN", trend: "UP", escalationPath: "Director General NIS", lastUpdated: "45 min ago" },
];

// ─── Component ────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  GREEN: { color: "text-emerald-400", bg: "bg-emerald-900/30 border-emerald-700/40", icon: CheckCircle, label: "On Target" },
  AMBER: { color: "text-amber-400", bg: "bg-amber-900/30 border-amber-700/40", icon: AlertTriangle, label: "At Risk" },
  RED: { color: "text-red-400", bg: "bg-red-900/30 border-red-700/40", icon: XCircle, label: "Breached" },
};

const CATEGORY_COLORS: Record<string, string> = {
  CUSTOMS: "#D4A017", REVENUE: "#3B82F6", HEALTH: "#10B981",
  AGRICULTURE: "#84CC16", STANDARDS: "#8B5CF6", IMMIGRATION: "#06B6D4",
  PORT: "#F97316", FINANCIAL: "#EF4444", SECURITY: "#6B7280", TRADE: "#EC4899",
};

export default function OGASLADashboard() {
  const { t } = useI18n();
  const [ogas, setOgas] = useState<OGA[]>(generateOGAs());
  const [filter, setFilter] = useState<"ALL" | SLAStatus>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "sla" | "response">("sla");

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    setTimeout(() => {
      // Simulate live updates with small random fluctuations
      setOgas(prev => prev.map(oga => ({
        ...oga,
        avgResponseHours: Math.max(0.1, oga.avgResponseHours + (Math.random() - 0.5) * 0.2),
        pendingRequests: Math.max(0, oga.pendingRequests + Math.floor((Math.random() - 0.5) * 4)),
        slaCompliancePct: Math.min(100, Math.max(50, oga.slaCompliancePct + (Math.random() - 0.5) * 1.5)),
        lastUpdated: "just now",
      })));
      setLastRefresh(new Date());
      setIsRefreshing(false);
    }, 800);
  }, []);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const filtered = ogas
    .filter(o => filter === "ALL" || o.status === filter)
    .filter(o => categoryFilter === "ALL" || o.category === categoryFilter)
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "sla") return b.slaCompliancePct - a.slaCompliancePct;
      return a.avgResponseHours - b.avgResponseHours;
    });

  const summary = {
    green: ogas.filter(o => o.status === "GREEN").length,
    amber: ogas.filter(o => o.status === "AMBER").length,
    red: ogas.filter(o => o.status === "RED").length,
    avgCompliance: (ogas.reduce((s, o) => s + o.slaCompliancePct, 0) / ogas.length).toFixed(1),
    totalPending: ogas.reduce((s, o) => s + o.pendingRequests, 0),
    totalBreached: ogas.reduce((s, o) => s + o.slaBreached, 0),
  };

  const chartData = ogas
    .sort((a, b) => a.slaCompliancePct - b.slaCompliancePct)
    .slice(0, 10)
    .map(o => ({ name: o.code, compliance: parseFloat(o.slaCompliancePct.toFixed(1)), status: o.status }));

  const categories = ["ALL", ...Array.from(new Set(ogas.map(o => o.category)))];

  return (
    <section id="oga-sla" className="py-20 bg-[#081422]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-12">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
              <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
                {t.oga_badge}
              </span>
            </div>
            <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
              {t.oga_title}
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl">
              {t.oga_subtitle}
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 bg-[#0D1E35] border border-slate-600 hover:border-[#D4A017] text-slate-300 hover:text-white px-4 py-2.5 rounded-xl transition-all text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin" : ""}`} />
            {t.oga_refresh}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[
            { label: t.oga_on_target, value: summary.green, color: "text-emerald-400", bg: "bg-emerald-900/20 border-emerald-700/30" },
            { label: t.oga_at_risk, value: summary.amber, color: "text-amber-400", bg: "bg-amber-900/20 border-amber-700/30" },
            { label: t.oga_breached, value: summary.red, color: "text-red-400", bg: "bg-red-900/20 border-red-700/30" },
            { label: t.oga_avg_compliance, value: `${summary.avgCompliance}%`, color: "text-[#D4A017]", bg: "bg-[#D4A017]/10 border-[#D4A017]/20" },
            { label: t.oga_pending, value: summary.totalPending, color: "text-blue-400", bg: "bg-blue-900/20 border-blue-700/30" },
            { label: "SLA Breaches", value: summary.totalBreached, color: "text-red-400", bg: "bg-red-900/20 border-red-700/30" },
          ].map((card) => (
            <div key={card.label} className={`${card.bg} border rounded-xl p-4 text-center`}>
              <div className={`text-2xl font-bold ${card.color} mb-1`}>{card.value}</div>
              <div className="text-slate-400 text-xs">{card.label}</div>
            </div>
          ))}
        </div>

        {/* Bottom 10 Chart */}
        <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-6 mb-8">
          <h3 className="text-white font-semibold mb-4">Lowest SLA Compliance — Top 10 Agencies</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 60, right: 20 }}>
              <XAxis type="number" domain={[50, 100]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#0A1628", border: "1px solid #334155", borderRadius: 8 }}
                labelStyle={{ color: "#fff" }}
                formatter={(v: number) => [`${v}%`, "SLA Compliance"]}
              />
              <Bar dataKey="compliance" radius={[0, 4, 4, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.status === "GREEN" ? "#10B981" : entry.status === "AMBER" ? "#F59E0B" : "#EF4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className="flex gap-2">
            {(["ALL", "GREEN", "AMBER", "RED"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  filter === s
                    ? s === "ALL" ? "bg-[#D4A017] text-[#0A1628]"
                      : s === "GREEN" ? "bg-emerald-600 text-white"
                      : s === "AMBER" ? "bg-amber-600 text-white"
                      : "bg-red-600 text-white"
                    : "bg-[#0D1E35] border border-slate-600 text-slate-300 hover:border-slate-400"
                }`}
              >
                {s === "ALL" ? "All Agencies" : s === "GREEN" ? "On Target" : s === "AMBER" ? "At Risk" : "Breached"}
              </button>
            ))}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-[#0D1E35] border border-slate-600 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#D4A017]"
          >
            {categories.map(c => <option key={c} value={c}>{c === "ALL" ? "All Categories" : c}</option>)}
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "name" | "sla" | "response")}
            className="bg-[#0D1E35] border border-slate-600 text-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#D4A017]"
          >
            <option value="sla">Sort: SLA Compliance</option>
            <option value="response">Sort: Response Time</option>
            <option value="name">Sort: Name</option>
          </select>
          <span className="ml-auto text-slate-500 text-sm self-center">
            Last refresh: {lastRefresh.toLocaleTimeString()}
          </span>
        </div>

        {/* OGA Table */}
        <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700/50">
                  <th className="text-left text-slate-400 text-xs uppercase tracking-wider px-6 py-4">Agency</th>
                  <th className="text-left text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Category</th>
                  <th className="text-left text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Protocol</th>
                  <th className="text-right text-slate-400 text-xs uppercase tracking-wider px-4 py-4">SLA Target</th>
                  <th className="text-right text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Avg Response</th>
                  <th className="text-right text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Compliance</th>
                  <th className="text-right text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Pending</th>
                  <th className="text-center text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Status</th>
                  <th className="text-left text-slate-400 text-xs uppercase tracking-wider px-4 py-4">Updated</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((oga, i) => {
                  const sc = STATUS_CONFIG[oga.status];
                  const StatusIcon = sc.icon;
                  const TrendIcon = oga.trend === "UP" ? TrendingUp : oga.trend === "DOWN" ? TrendingDown : Minus;
                  const trendColor = oga.trend === "UP" ? "text-emerald-400" : oga.trend === "DOWN" ? "text-red-400" : "text-slate-400";

                  return (
                    <tr key={oga.code} className={`border-b border-slate-700/30 hover:bg-slate-800/30 transition-colors ${i % 2 === 0 ? "" : "bg-slate-900/20"}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: CATEGORY_COLORS[oga.category] || "#94a3b8" }}
                          />
                          <div>
                            <div className="text-white font-medium text-sm">{oga.name}</div>
                            <div className="text-slate-500 text-xs">{oga.code}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className="text-xs px-2 py-1 rounded-full font-medium"
                          style={{
                            backgroundColor: `${CATEGORY_COLORS[oga.category]}20`,
                            color: CATEGORY_COLORS[oga.category] || "#94a3b8",
                            border: `1px solid ${CATEGORY_COLORS[oga.category]}40`,
                          }}
                        >
                          {oga.category}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="text-slate-300 text-xs font-mono">{oga.protocol}</div>
                        <div className="text-slate-500 text-xs">{oga.dataFormat}</div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-1 text-slate-300 text-sm">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {oga.slaTargetHours < 1
                            ? `${oga.slaTargetHours * 60}min`
                            : `${oga.slaTargetHours}h`}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className={`text-sm font-medium ${
                          oga.avgResponseHours <= oga.slaTargetHours ? "text-emerald-400" : "text-red-400"
                        }`}>
                          {oga.avgResponseHours < 1
                            ? `${(oga.avgResponseHours * 60).toFixed(0)}min`
                            : `${oga.avgResponseHours.toFixed(1)}h`}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <TrendIcon className={`w-3.5 h-3.5 ${trendColor}`} />
                          <div>
                            <div className={`text-sm font-bold ${sc.color}`}>
                              {oga.slaCompliancePct.toFixed(1)}%
                            </div>
                            <div className="w-16 h-1 bg-slate-700 rounded-full overflow-hidden mt-1">
                              <div
                                className={`h-full rounded-full ${
                                  oga.status === "GREEN" ? "bg-emerald-500" :
                                  oga.status === "AMBER" ? "bg-amber-500" : "bg-red-500"
                                }`}
                                style={{ width: `${oga.slaCompliancePct}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-white font-medium text-sm">{oga.pendingRequests}</span>
                        {oga.slaBreached > 0 && (
                          <div className="text-red-400 text-xs">{oga.slaBreached} breached</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${sc.bg} ${sc.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {sc.label}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span className="text-slate-500 text-xs">{oga.lastUpdated}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-slate-700/30 flex items-center justify-between">
            <span className="text-slate-500 text-sm">
              Showing {filtered.length} of {ogas.length} agencies
            </span>
            <span className="text-slate-500 text-xs">
              Auto-refreshes every 30 seconds
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
