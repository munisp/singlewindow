/**
 * SanctionsScreening.tsx
 * Design: Sovereign Blueprint — deep navy (#0A1628) + gold (#D4A017)
 * Purpose: Mock OFAC/UN sanctions list and dual-use goods screening panel
 * showing real-time restricted party checks integrated with the Risk Engine.
 */

import { useState, useEffect, useRef } from "react";
import {
  AlertTriangle, Shield, Search, CheckCircle, XCircle,
  AlertCircle, ChevronDown, ChevronUp, Globe, Package,
  Building2, User, Zap, Clock, FileText, ExternalLink
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ScreeningStatus = "clear" | "match" | "partial" | "pending" | "error";
type ListType = "OFAC_SDN" | "UN_SC" | "EU_CONS" | "INTERPOL" | "DUAL_USE" | "FATF";
type EntityType = "individual" | "company" | "vessel" | "goods";

interface SanctionsList {
  id: ListType;
  name: string;
  authority: string;
  entries: number;
  lastUpdated: string;
  color: string;
}

interface ScreeningResult {
  list: ListType;
  status: ScreeningStatus;
  matchScore?: number;
  matchedEntity?: string;
  reason?: string;
  reference?: string;
  durationMs: number;
}

interface DualUseItem {
  eccn: string;
  description: string;
  category: string;
  controlReason: string;
  licenseRequired: boolean;
  risk: "high" | "medium" | "low";
}

interface ScreeningRequest {
  entityName: string;
  entityType: EntityType;
  country: string;
  hsCode: string;
  goodsDescription: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────

const SANCTIONS_LISTS: SanctionsList[] = [
  { id: "OFAC_SDN", name: "OFAC SDN List", authority: "US Treasury", entries: 14823, lastUpdated: "2026-03-08", color: "#DC2626" },
  { id: "UN_SC", name: "UN Security Council", authority: "United Nations", entries: 892, lastUpdated: "2026-03-07", color: "#7C3AED" },
  { id: "EU_CONS", name: "EU Consolidated List", authority: "European Union", entries: 4127, lastUpdated: "2026-03-08", color: "#2563EB" },
  { id: "INTERPOL", name: "Interpol Red Notices", authority: "Interpol I-24/7", entries: 7341, lastUpdated: "2026-03-08", color: "#EA580C" },
  { id: "DUAL_USE", name: "Dual-Use Goods Registry", authority: "WCO / BIS", entries: 2891, lastUpdated: "2026-03-06", color: "#D97706" },
  { id: "FATF", name: "FATF High-Risk Jurisdictions", authority: "FATF", entries: 47, lastUpdated: "2026-02-23", color: "#BE185D" },
];

const DUAL_USE_ITEMS: DualUseItem[] = [
  { eccn: "3A001", description: "Electronic components — semiconductors", category: "Electronics", controlReason: "NS, MT, NP", licenseRequired: true, risk: "high" },
  { eccn: "7A001", description: "Accelerometers / inertial navigation", category: "Navigation", controlReason: "NS, MT", licenseRequired: true, risk: "high" },
  { eccn: "1C350", description: "Chemical precursors — Schedule 2/3", category: "Chemicals", controlReason: "CW", licenseRequired: true, risk: "high" },
  { eccn: "5A002", description: "Cryptographic equipment / software", category: "IT Security", controlReason: "NS, AT", licenseRequired: false, risk: "medium" },
  { eccn: "2B001", description: "Machine tools — precision lathes", category: "Manufacturing", controlReason: "NS, NP", licenseRequired: false, risk: "medium" },
  { eccn: "9A004", description: "Space launch vehicles / spacecraft", category: "Aerospace", controlReason: "NS, MT", licenseRequired: true, risk: "high" },
  { eccn: "4A001", description: "Computers — high-performance", category: "Computing", controlReason: "NS", licenseRequired: false, risk: "low" },
  { eccn: "6A002", description: "Optical sensors / cameras", category: "Optics", controlReason: "NS, RS", licenseRequired: false, risk: "low" },
];

const SAMPLE_ENTITIES = [
  { name: "Meridian Trading Co. Ltd", country: "NG", type: "company" as EntityType, hsCode: "8471.30", goods: "Laptop computers" },
  { name: "Viktor Sokolov", country: "RU", type: "individual" as EntityType, hsCode: "3824.99", goods: "Chemical mixtures" },
  { name: "MV Pacific Star", country: "KP", type: "vessel" as EntityType, hsCode: "8901.20", goods: "Bulk cargo vessel" },
  { name: "Al-Rashid General Trading", country: "IR", type: "company" as EntityType, hsCode: "7A001.a", goods: "Inertial navigation units" },
  { name: "Nairobi Agro Exports Ltd", country: "KE", type: "company" as EntityType, hsCode: "0901.11", goods: "Green coffee beans" },
];

// ─── Screening Engine (mock) ──────────────────────────────────────────────────

function runScreening(req: ScreeningRequest): Promise<ScreeningResult[]> {
  return new Promise((resolve) => {
    const results: ScreeningResult[] = [];
    const isHighRisk = ["RU", "KP", "IR", "SY", "BY"].includes(req.country);
    const isDualUse = req.hsCode.startsWith("7A") || req.hsCode.startsWith("3824") || req.hsCode.startsWith("1C");
    const isKnownBad = req.entityName.toLowerCase().includes("sokolov") ||
      req.entityName.toLowerCase().includes("al-rashid") ||
      req.entityName.toLowerCase().includes("pacific star");

    SANCTIONS_LISTS.forEach((list, idx) => {
      setTimeout(() => {
        let status: ScreeningStatus = "clear";
        let matchScore: number | undefined;
        let matchedEntity: string | undefined;
        let reason: string | undefined;
        let reference: string | undefined;

        if (list.id === "DUAL_USE" && isDualUse) {
          status = "match";
          matchScore = 98;
          matchedEntity = req.hsCode;
          reason = "Controlled dual-use goods — export licence may be required";
          reference = "EAR Part 774 / EU Reg 2021/821";
        } else if (list.id === "FATF" && isHighRisk) {
          status = "partial";
          matchScore = 72;
          matchedEntity = req.country;
          reason = "Jurisdiction on FATF Enhanced Due Diligence list";
          reference = "FATF Public Statement Feb 2026";
        } else if (isKnownBad && (list.id === "OFAC_SDN" || list.id === "UN_SC" || list.id === "INTERPOL")) {
          status = "match";
          matchScore = Math.floor(88 + Math.random() * 12);
          matchedEntity = req.entityName;
          reason = `Entity matches ${list.name} designation`;
          reference = `${list.id}-${Math.floor(Math.random() * 90000 + 10000)}`;
        } else {
          status = "clear";
        }

        results.push({
          list: list.id,
          status,
          matchScore,
          matchedEntity,
          reason,
          reference,
          durationMs: 80 + Math.floor(Math.random() * 180),
        });

        if (results.length === SANCTIONS_LISTS.length) {
          resolve(results.sort((a, b) => {
            const order = { match: 0, partial: 1, error: 2, pending: 3, clear: 4 };
            return order[a.status] - order[b.status];
          }));
        }
      }, 200 + idx * 150 + Math.floor(Math.random() * 100));
    });
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ScreeningStatus }) {
  const cfg = {
    clear: { bg: "bg-emerald-900/40", text: "text-emerald-400", border: "border-emerald-700", icon: <CheckCircle className="w-3.5 h-3.5" />, label: "CLEAR" },
    match: { bg: "bg-red-900/40", text: "text-red-400", border: "border-red-700", icon: <XCircle className="w-3.5 h-3.5" />, label: "MATCH" },
    partial: { bg: "bg-amber-900/40", text: "text-amber-400", border: "border-amber-700", icon: <AlertCircle className="w-3.5 h-3.5" />, label: "PARTIAL" },
    pending: { bg: "bg-blue-900/40", text: "text-blue-400", border: "border-blue-700", icon: <Clock className="w-3.5 h-3.5 animate-spin" />, label: "CHECKING" },
    error: { bg: "bg-gray-900/40", text: "text-gray-400", border: "border-gray-700", icon: <AlertTriangle className="w-3.5 h-3.5" />, label: "ERROR" },
  }[status];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono font-bold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function RiskMeter({ score }: { score: number }) {
  const color = score >= 80 ? "#DC2626" : score >= 50 ? "#D97706" : "#10B981";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono font-bold" style={{ color }}>{score}%</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SanctionsScreening() {
  const [request, setRequest] = useState<ScreeningRequest>({
    entityName: "",
    entityType: "company",
    country: "NG",
    hsCode: "",
    goodsDescription: "",
  });
  const [results, setResults] = useState<ScreeningResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [expandedResult, setExpandedResult] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"screening" | "dualuse" | "lists">("screening");
  const [overallRisk, setOverallRisk] = useState<"clear" | "review" | "block" | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const COUNTRIES = [
    { code: "NG", name: "Nigeria" }, { code: "GH", name: "Ghana" }, { code: "KE", name: "Kenya" },
    { code: "RW", name: "Rwanda" }, { code: "SG", name: "Singapore" }, { code: "CN", name: "China" },
    { code: "IN", name: "India" }, { code: "US", name: "United States" }, { code: "GB", name: "United Kingdom" },
    { code: "DE", name: "Germany" }, { code: "RU", name: "Russia" }, { code: "IR", name: "Iran" },
    { code: "KP", name: "North Korea" }, { code: "SY", name: "Syria" }, { code: "BY", name: "Belarus" },
    { code: "AE", name: "UAE" }, { code: "ZA", name: "South Africa" }, { code: "ET", name: "Ethiopia" },
  ];

  const loadSample = (sample: typeof SAMPLE_ENTITIES[0]) => {
    setRequest({
      entityName: sample.name,
      entityType: sample.type,
      country: sample.country,
      hsCode: sample.hsCode,
      goodsDescription: sample.goods,
    });
    setResults([]);
    setIsComplete(false);
    setOverallRisk(null);
  };

  const runCheck = async () => {
    if (!request.entityName) return;
    setIsRunning(true);
    setIsComplete(false);
    setResults([]);
    setOverallRisk(null);
    setElapsedMs(0);

    const start = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - start), 50);

    const res = await runScreening(request);
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedMs(Date.now() - start);

    setResults(res);
    setIsRunning(false);
    setIsComplete(true);

    const hasMatch = res.some(r => r.status === "match");
    const hasPartial = res.some(r => r.status === "partial");
    setOverallRisk(hasMatch ? "block" : hasPartial ? "review" : "clear");
  };

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const matchCount = results.filter(r => r.status === "match").length;
  const partialCount = results.filter(r => r.status === "partial").length;

  return (
    <section id="sanctions-screening" className="py-20 px-6" style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D1F3C 100%)" }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(220,38,38,0.15)", border: "1px solid rgba(220,38,38,0.3)" }}>
              <Shield className="w-5 h-5 text-red-400" />
            </div>
            <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#D4A017" }}>Compliance Engine</span>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
            Sanctions & Restricted Party Screening
          </h2>
          <p className="text-white/60 max-w-2xl">
            Real-time screening against OFAC SDN, UN Security Council, EU Consolidated, Interpol I-24/7, and WCO Dual-Use registries — integrated with the Rust Risk Engine at declaration submission.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-8 p-1 rounded-lg w-fit" style={{ background: "rgba(255,255,255,0.05)" }}>
          {[
            { id: "screening", label: "Live Screening", icon: <Search className="w-4 h-4" /> },
            { id: "dualuse", label: "Dual-Use Goods", icon: <Package className="w-4 h-4" /> },
            { id: "lists", label: "Sanctions Lists", icon: <Globe className="w-4 h-4" /> },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === tab.id ? "text-white" : "text-white/50 hover:text-white/80"}`}
              style={activeTab === tab.id ? { background: "rgba(212,160,23,0.2)", color: "#D4A017" } : {}}
            >
              {tab.icon}{tab.label}
            </button>
          ))}
        </div>

        {/* Tab: Live Screening */}
        {activeTab === "screening" && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left: Form */}
            <div className="lg:col-span-2 space-y-5">
              {/* Sample entities */}
              <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-xs font-mono text-white/40 uppercase tracking-widest mb-3">Quick Load Samples</p>
                <div className="space-y-2">
                  {SAMPLE_ENTITIES.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => loadSample(s)}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm transition-all hover:bg-white/5 group"
                      style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-white/80 group-hover:text-white font-medium">{s.name}</span>
                        <span className="text-xs font-mono text-white/30">{s.country}</span>
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">{s.goods} · {s.hsCode}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Form */}
              <div className="rounded-xl p-5 space-y-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="text-xs font-mono text-white/40 uppercase tracking-widest">Screening Parameters</p>

                <div>
                  <label className="text-xs text-white/50 mb-1 block">Entity Name / Vessel Name</label>
                  <input
                    value={request.entityName}
                    onChange={e => setRequest(r => ({ ...r, entityName: e.target.value }))}
                    placeholder="Enter company, individual, or vessel name"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20 outline-none focus:ring-1 focus:ring-yellow-600/50"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Entity Type</label>
                    <select
                      value={request.entityType}
                      onChange={e => setRequest(r => ({ ...r, entityType: e.target.value as EntityType }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                    >
                      <option value="company">Company</option>
                      <option value="individual">Individual</option>
                      <option value="vessel">Vessel</option>
                      <option value="goods">Goods</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-white/50 mb-1 block">Country of Origin</label>
                    <select
                      value={request.country}
                      onChange={e => setRequest(r => ({ ...r, country: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                    >
                      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-white/50 mb-1 block">HS Code</label>
                  <input
                    value={request.hsCode}
                    onChange={e => setRequest(r => ({ ...r, hsCode: e.target.value }))}
                    placeholder="e.g. 8471.30 or 7A001.a"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20 outline-none focus:ring-1 focus:ring-yellow-600/50"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                  />
                </div>

                <div>
                  <label className="text-xs text-white/50 mb-1 block">Goods Description</label>
                  <input
                    value={request.goodsDescription}
                    onChange={e => setRequest(r => ({ ...r, goodsDescription: e.target.value }))}
                    placeholder="Brief description of goods"
                    className="w-full px-3 py-2 rounded-lg text-sm text-white placeholder-white/20 outline-none"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                  />
                </div>

                <button
                  onClick={runCheck}
                  disabled={isRunning || !request.entityName}
                  className="w-full py-3 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: isRunning ? "rgba(212,160,23,0.3)" : "#D4A017", color: "#0A1628" }}
                >
                  {isRunning ? (
                    <><Zap className="w-4 h-4 animate-pulse" />Screening {SANCTIONS_LISTS.length} Lists… {elapsedMs}ms</>
                  ) : (
                    <><Search className="w-4 h-4" />Run Screening Check</>
                  )}
                </button>
              </div>
            </div>

            {/* Right: Results */}
            <div className="lg:col-span-3 space-y-4">
              {/* Overall verdict */}
              {isComplete && overallRisk && (
                <div className={`rounded-xl p-5 ${
                  overallRisk === "block" ? "border-red-700 bg-red-900/20" :
                  overallRisk === "review" ? "border-amber-700 bg-amber-900/20" :
                  "border-emerald-700 bg-emerald-900/20"
                }`} style={{ border: "1px solid" }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {overallRisk === "block" ? <XCircle className="w-6 h-6 text-red-400" /> :
                       overallRisk === "review" ? <AlertTriangle className="w-6 h-6 text-amber-400" /> :
                       <CheckCircle className="w-6 h-6 text-emerald-400" />}
                      <div>
                        <div className={`font-bold text-lg ${
                          overallRisk === "block" ? "text-red-400" :
                          overallRisk === "review" ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {overallRisk === "block" ? "BLOCKED — SANCTIONS MATCH" :
                           overallRisk === "review" ? "HOLD FOR REVIEW" : "CLEARED — NO MATCHES"}
                        </div>
                        <div className="text-xs text-white/50 mt-0.5">
                          Screened {SANCTIONS_LISTS.length} lists in {elapsedMs}ms ·{" "}
                          {matchCount > 0 && <span className="text-red-400">{matchCount} match{matchCount > 1 ? "es" : ""}</span>}
                          {matchCount > 0 && partialCount > 0 && ", "}
                          {partialCount > 0 && <span className="text-amber-400">{partialCount} partial</span>}
                          {matchCount === 0 && partialCount === 0 && <span className="text-emerald-400">all clear</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-white/40 font-mono">Rust Risk Engine</div>
                      <div className="text-xs text-white/40 font-mono">v2.4.1 · {new Date().toISOString().slice(0, 19)}Z</div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 mt-3">
                    {overallRisk === "block" && (
                      <button className="px-3 py-1.5 rounded text-xs font-medium bg-red-800/50 text-red-300 border border-red-700">
                        Escalate to Compliance Officer
                      </button>
                    )}
                    {overallRisk === "review" && (
                      <button className="px-3 py-1.5 rounded text-xs font-medium bg-amber-800/50 text-amber-300 border border-amber-700">
                        Request Enhanced Due Diligence
                      </button>
                    )}
                    <button className="px-3 py-1.5 rounded text-xs font-medium bg-white/10 text-white/60 border border-white/10">
                      <FileText className="w-3 h-3 inline mr-1" />Export Report
                    </button>
                  </div>
                </div>
              )}

              {/* Per-list results */}
              {results.length > 0 && (
                <div className="space-y-2">
                  {results.map((result) => {
                    const list = SANCTIONS_LISTS.find(l => l.id === result.list)!;
                    const isExpanded = expandedResult === result.list;
                    return (
                      <div
                        key={result.list}
                        className="rounded-xl overflow-hidden"
                        style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <button
                          className="w-full px-4 py-3 flex items-center justify-between hover:bg-white/5 transition-all"
                          onClick={() => setExpandedResult(isExpanded ? null : result.list)}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: list.color }} />
                            <div className="text-left">
                              <div className="text-sm font-medium text-white">{list.name}</div>
                              <div className="text-xs text-white/40">{list.authority} · {list.entries.toLocaleString()} entries</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {result.matchScore && (
                              <div className="w-24">
                                <RiskMeter score={result.matchScore} />
                              </div>
                            )}
                            <StatusBadge status={result.status} />
                            <span className="text-xs font-mono text-white/30">{result.durationMs}ms</span>
                            {isExpanded ? <ChevronUp className="w-4 h-4 text-white/40" /> : <ChevronDown className="w-4 h-4 text-white/40" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 border-t border-white/5 pt-3">
                            {result.status !== "clear" ? (
                              <div className="space-y-2">
                                {result.matchedEntity && (
                                  <div className="flex gap-2 text-sm">
                                    <span className="text-white/40 w-28 shrink-0">Matched Entity:</span>
                                    <span className="text-white font-mono">{result.matchedEntity}</span>
                                  </div>
                                )}
                                {result.reason && (
                                  <div className="flex gap-2 text-sm">
                                    <span className="text-white/40 w-28 shrink-0">Reason:</span>
                                    <span className="text-white/80">{result.reason}</span>
                                  </div>
                                )}
                                {result.reference && (
                                  <div className="flex gap-2 text-sm">
                                    <span className="text-white/40 w-28 shrink-0">Reference:</span>
                                    <span className="text-white/80 font-mono">{result.reference}</span>
                                  </div>
                                )}
                                <div className="flex gap-2 text-sm">
                                  <span className="text-white/40 w-28 shrink-0">Action:</span>
                                  <span className={result.status === "match" ? "text-red-400" : "text-amber-400"}>
                                    {result.status === "match" ? "Declaration blocked — manual review required" : "Enhanced due diligence required"}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-emerald-400 text-sm">
                                <CheckCircle className="w-4 h-4" />
                                No matches found in {list.name} ({list.entries.toLocaleString()} entries checked)
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {!isRunning && !isComplete && (
                <div className="rounded-xl p-12 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)" }}>
                  <Shield className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40 text-sm">Load a sample entity or enter details above, then click <strong className="text-white/60">Run Screening Check</strong></p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab: Dual-Use Goods */}
        {activeTab === "dualuse" && (
          <div className="space-y-4">
            <div className="rounded-xl p-4 mb-4" style={{ background: "rgba(217,119,6,0.1)", border: "1px solid rgba(217,119,6,0.3)" }}>
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-amber-400 font-semibold text-sm">Dual-Use Goods Screening</p>
                  <p className="text-white/60 text-sm mt-1">Items that can be used for both civilian and military purposes are subject to export controls under the Wassenaar Arrangement, EAR (US BIS), and EU Regulation 2021/821. The Rust Risk Engine checks HS codes against the WCO Dual-Use registry at declaration time.</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {DUAL_USE_ITEMS.map((item) => (
                <div key={item.eccn} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <span className="text-xs font-mono font-bold" style={{ color: "#D4A017" }}>{item.eccn}</span>
                      <h4 className="text-white font-medium text-sm mt-0.5">{item.description}</h4>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                      item.risk === "high" ? "bg-red-900/40 text-red-400" :
                      item.risk === "medium" ? "bg-amber-900/40 text-amber-400" :
                      "bg-emerald-900/40 text-emerald-400"
                    }`}>{item.risk.toUpperCase()}</span>
                  </div>
                  <div className="space-y-1 text-xs text-white/50">
                    <div>Category: <span className="text-white/70">{item.category}</span></div>
                    <div>Control Reason: <span className="text-white/70 font-mono">{item.controlReason}</span></div>
                    <div>Licence Required: <span className={item.licenseRequired ? "text-red-400" : "text-emerald-400"}>{item.licenseRequired ? "YES" : "NO"}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab: Sanctions Lists */}
        {activeTab === "lists" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {SANCTIONS_LISTS.map((list) => (
              <div key={list.id} className="rounded-xl p-5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: list.color }} />
                  <span className="text-xs font-mono text-white/40">{list.id}</span>
                </div>
                <h3 className="text-white font-semibold mb-1">{list.name}</h3>
                <div className="text-xs text-white/40 mb-3">{list.authority}</div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-white/40 text-xs">Entries</div>
                    <div className="text-white font-mono font-bold">{list.entries.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-white/40 text-xs">Last Updated</div>
                    <div className="text-white font-mono">{list.lastUpdated}</div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/5">
                  <div className="flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle className="w-3 h-3" />
                    Auto-synced daily via Dapr binding
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Implementation note */}
        <div className="mt-8 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-xs font-mono text-white/30 uppercase tracking-widest mb-2">Implementation Reference</p>
          <p className="text-xs text-white/50">
            Screening is executed by the Rust <code className="text-amber-400/80">risk-engine</code> (200-rule parallel evaluator) at declaration submission via the Temporal <code className="text-amber-400/80">SanctionsScreeningActivity</code>. Lists are synchronized daily via Dapr bindings to an OpenSearch index. Results are published to the <code className="text-amber-400/80">declarations.sanctions.results</code> Kafka topic and stored in the TigerBeetle compliance ledger. See <code className="text-amber-400/80">services/rust/risk-engine/src/lib.rs</code> and <code className="text-amber-400/80">workflows/declaration_workflow.go</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
