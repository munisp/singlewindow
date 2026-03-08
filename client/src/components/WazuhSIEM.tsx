/**
 * WazuhSIEM.tsx
 * Design: Sovereign Blueprint — deep navy (#0A1628) + gold (#D4A017)
 * Purpose: Live Wazuh SIEM alert feed showing security events, IDS alerts,
 * anomaly detection, and threat intelligence from OpenCTI integration.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  ShieldAlert, Activity, Eye, AlertTriangle, XCircle,
  CheckCircle, Terminal, Lock, Wifi, Database, Server,
  RefreshCw, Pause, Play, Filter, TrendingUp, Globe
} from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

type Severity = "critical" | "high" | "medium" | "low" | "info";
type AlertCategory = "authentication" | "network" | "integrity" | "anomaly" | "malware" | "policy" | "vulnerability";

interface WazuhAlert {
  id: string;
  timestamp: string;
  severity: Severity;
  category: AlertCategory;
  rule: { id: number; description: string; groups: string[] };
  agent: { id: string; name: string; ip: string };
  location: string;
  message: string;
  data?: Record<string, string>;
  mitre?: { technique: string; tactic: string };
}

interface ThreatMetric {
  time: string;
  critical: number;
  high: number;
  medium: number;
  total: number;
}

// ─── Alert Generator ─────────────────────────────────────────────────────────

let alertCounter = 1000;

const AGENTS = [
  { id: "001", name: "declaration-svc-pod-7f8d", ip: "10.0.1.12" },
  { id: "002", name: "payment-svc-pod-3b2c", ip: "10.0.1.15" },
  { id: "003", name: "risk-engine-pod-9a4e", ip: "10.0.2.8" },
  { id: "004", name: "apisix-gateway-pod-1c5f", ip: "10.0.0.5" },
  { id: "005", name: "keycloak-pod-6d7b", ip: "10.0.3.2" },
  { id: "006", name: "postgres-primary-0", ip: "10.0.4.10" },
  { id: "007", name: "tigerbeetle-0", ip: "10.0.4.20" },
  { id: "008", name: "kafka-broker-0", ip: "10.0.5.5" },
];

const ALERT_TEMPLATES: Omit<WazuhAlert, "id" | "timestamp" | "agent">[] = [
  {
    severity: "critical",
    category: "authentication",
    rule: { id: 100001, description: "Multiple failed authentication attempts — possible brute force", groups: ["authentication_failed", "brute_force"] },
    location: "/var/log/keycloak/keycloak.log",
    message: "5 failed login attempts for user trader@meridian.ng within 60 seconds from IP 185.220.101.47",
    data: { "src_ip": "185.220.101.47", "user": "trader@meridian.ng", "attempts": "5", "window": "60s" },
    mitre: { technique: "T1110.001", tactic: "Credential Access" },
  },
  {
    severity: "high",
    category: "network",
    rule: { id: 100002, description: "Port scan detected on API gateway", groups: ["network_scan", "recon"] },
    location: "apisix-gateway",
    message: "Sequential port scan from 203.0.113.42 targeting APISIX gateway — 847 ports probed in 12 seconds",
    data: { "src_ip": "203.0.113.42", "ports_scanned": "847", "duration": "12s" },
    mitre: { technique: "T1046", tactic: "Discovery" },
  },
  {
    severity: "high",
    category: "anomaly",
    rule: { id: 100003, description: "Unusual API call volume — possible data exfiltration", groups: ["anomaly", "data_exfil"] },
    location: "declaration-svc",
    message: "declaration-svc received 4,200 GET /declarations requests in 5 minutes from single token — 12x above baseline",
    data: { "token_id": "eyJhbGci...truncated", "requests": "4200", "window": "5min", "baseline": "350" },
    mitre: { technique: "T1530", tactic: "Collection" },
  },
  {
    severity: "medium",
    category: "integrity",
    rule: { id: 100004, description: "File integrity violation — binary modified", groups: ["syscheck", "integrity"] },
    location: "/usr/local/bin/risk-engine",
    message: "Checksum mismatch detected on risk-engine binary — SHA256 differs from deployment manifest",
    data: { "file": "/usr/local/bin/risk-engine", "expected": "a3f8c2d1...", "actual": "b9e4f7a2..." },
    mitre: { technique: "T1565.001", tactic: "Impact" },
  },
  {
    severity: "medium",
    category: "policy",
    rule: { id: 100005, description: "Privileged container detected in namespace", groups: ["k8s_policy", "container"] },
    location: "kubernetes/core",
    message: "Pod risk-engine-debug running with privileged:true in core namespace — violates PodSecurityPolicy",
    data: { "namespace": "core", "pod": "risk-engine-debug", "violation": "privileged_container" },
    mitre: { technique: "T1611", tactic: "Privilege Escalation" },
  },
  {
    severity: "low",
    category: "authentication",
    rule: { id: 100006, description: "Service account token used from unexpected IP", groups: ["authentication", "lateral_movement"] },
    location: "kubernetes/api",
    message: "Service account declaration-svc-sa accessed K8s API from 10.0.99.5 — not in expected CIDR 10.0.1.0/24",
    data: { "service_account": "declaration-svc-sa", "src_ip": "10.0.99.5", "expected_cidr": "10.0.1.0/24" },
    mitre: { technique: "T1078.001", tactic: "Defense Evasion" },
  },
  {
    severity: "info",
    category: "policy",
    rule: { id: 100007, description: "Network policy updated — new egress rule added", groups: ["k8s_audit", "policy_change"] },
    location: "kubernetes/audit",
    message: "NetworkPolicy default-deny updated by admin@tradegateway.gov — new egress rule for payment-svc → mojaloop-hub",
    data: { "user": "admin@tradegateway.gov", "resource": "NetworkPolicy/default-deny", "action": "update" },
  },
  {
    severity: "high",
    category: "vulnerability",
    rule: { id: 100008, description: "CVE-2024-3094 — XZ Utils backdoor attempt detected", groups: ["vulnerability", "malware"] },
    location: "/usr/lib/x86_64-linux-gnu/liblzma.so.5",
    message: "Suspicious library call pattern matching CVE-2024-3094 XZ backdoor signature detected in sshd process",
    data: { "cve": "CVE-2024-3094", "process": "sshd", "library": "liblzma.so.5.6.0" },
    mitre: { technique: "T1574.006", tactic: "Persistence" },
  },
  {
    severity: "critical",
    category: "malware",
    rule: { id: 100009, description: "Crypto-miner process detected in container", groups: ["malware", "cryptominer"] },
    location: "payment-svc-pod",
    message: "Process xmrig detected in payment-svc container — CPU usage 98%, connecting to pool.minexmr.com:443",
    data: { "process": "xmrig", "cpu": "98%", "c2": "pool.minexmr.com:443" },
    mitre: { technique: "T1496", tactic: "Impact" },
  },
  {
    severity: "medium",
    category: "network",
    rule: { id: 100010, description: "TLS certificate validation failure — possible MITM", groups: ["network", "tls"] },
    location: "oga-hub",
    message: "TLS handshake with customs-api.gov failed certificate validation — issuer mismatch on CN=customs.gov",
    data: { "host": "customs-api.gov", "expected_issuer": "DigiCert Global CA", "actual_issuer": "Unknown CA" },
    mitre: { technique: "T1557", tactic: "Collection" },
  },
];

function generateAlert(): WazuhAlert {
  const template = ALERT_TEMPLATES[Math.floor(Math.random() * ALERT_TEMPLATES.length)];
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  return {
    ...template,
    id: `WZ-${++alertCounter}`,
    timestamp: new Date().toISOString(),
    agent,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_CONFIG: Record<Severity, { color: string; bg: string; border: string; label: string }> = {
  critical: { color: "text-red-400", bg: "bg-red-900/30", border: "border-red-700", label: "CRITICAL" },
  high: { color: "text-orange-400", bg: "bg-orange-900/30", border: "border-orange-700", label: "HIGH" },
  medium: { color: "text-amber-400", bg: "bg-amber-900/30", border: "border-amber-700", label: "MEDIUM" },
  low: { color: "text-blue-400", bg: "bg-blue-900/30", border: "border-blue-700", label: "LOW" },
  info: { color: "text-slate-400", bg: "bg-slate-900/30", border: "border-slate-700", label: "INFO" },
};

const CATEGORY_ICONS: Record<AlertCategory, React.ReactNode> = {
  authentication: <Lock className="w-3.5 h-3.5" />,
  network: <Wifi className="w-3.5 h-3.5" />,
  integrity: <Database className="w-3.5 h-3.5" />,
  anomaly: <TrendingUp className="w-3.5 h-3.5" />,
  malware: <XCircle className="w-3.5 h-3.5" />,
  policy: <ShieldAlert className="w-3.5 h-3.5" />,
  vulnerability: <AlertTriangle className="w-3.5 h-3.5" />,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WazuhSIEM() {
  const [alerts, setAlerts] = useState<WazuhAlert[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [selectedSeverity, setSelectedSeverity] = useState<Severity | "all">("all");
  const [selectedCategory, setSelectedCategory] = useState<AlertCategory | "all">("all");
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ThreatMetric[]>([]);
  const [totalAlerts, setTotalAlerts] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Initialize with some alerts
  useEffect(() => {
    const initial: WazuhAlert[] = [];
    for (let i = 0; i < 8; i++) {
      initial.unshift(generateAlert());
    }
    setAlerts(initial);
    setTotalAlerts(8);

    // Initialize metrics
    const now = Date.now();
    const initMetrics: ThreatMetric[] = Array.from({ length: 20 }, (_, i) => ({
      time: new Date(now - (19 - i) * 3000).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      critical: Math.floor(Math.random() * 3),
      high: Math.floor(Math.random() * 5),
      medium: Math.floor(Math.random() * 8),
      total: 0,
    })).map(m => ({ ...m, total: m.critical + m.high + m.medium }));
    setMetrics(initMetrics);
  }, []);

  const addAlert = useCallback(() => {
    const newAlert = generateAlert();
    setAlerts(prev => [newAlert, ...prev].slice(0, 50));
    setTotalAlerts(prev => prev + 1);
    setMetrics(prev => {
      const last = prev[prev.length - 1];
      const newMetric: ThreatMetric = {
        time: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        critical: (last?.critical || 0) + (newAlert.severity === "critical" ? 1 : 0),
        high: (last?.high || 0) + (newAlert.severity === "high" ? 1 : 0),
        medium: (last?.medium || 0) + (newAlert.severity === "medium" ? 1 : 0),
        total: 0,
      };
      newMetric.total = newMetric.critical + newMetric.high + newMetric.medium;
      return [...prev.slice(-29), newMetric];
    });
  }, []);

  const toggleLive = () => {
    if (isLive) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setIsLive(false);
    } else {
      setIsLive(true);
      intervalRef.current = setInterval(addAlert, 1800 + Math.random() * 1200);
    }
  };

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  const filteredAlerts = alerts.filter(a => {
    if (selectedSeverity !== "all" && a.severity !== selectedSeverity) return false;
    if (selectedCategory !== "all" && a.category !== selectedCategory) return false;
    return true;
  });

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const highCount = alerts.filter(a => a.severity === "high").length;

  return (
    <section id="wazuh-siem" className="py-20 px-6" style={{ background: "linear-gradient(180deg, #0D1F3C 0%, #0A1628 100%)" }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <Activity className="w-5 h-5 text-red-400" />
            </div>
            <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#D4A017" }}>Security Operations</span>
          </div>
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <h2 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                Wazuh SIEM — Live Alert Feed
              </h2>
              <p className="text-white/60 max-w-2xl">
                Real-time security events from Wazuh agents deployed on all 17 services, enriched with MITRE ATT&CK mappings and OpenCTI threat intelligence.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleLive}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${isLive ? "bg-red-600 text-white" : "bg-emerald-700 text-white"}`}
              >
                {isLive ? <><Pause className="w-4 h-4" />Pause Feed</> : <><Play className="w-4 h-4" />Start Live Feed</>}
              </button>
              <button
                onClick={addAlert}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
              >
                <RefreshCw className="w-4 h-4" />Inject Alert
              </button>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Alerts", value: totalAlerts, color: "text-white", icon: <Activity className="w-4 h-4" /> },
            { label: "Critical", value: criticalCount, color: "text-red-400", icon: <XCircle className="w-4 h-4 text-red-400" /> },
            { label: "High", value: highCount, color: "text-orange-400", icon: <AlertTriangle className="w-4 h-4 text-orange-400" /> },
            { label: "Agents Active", value: AGENTS.length, color: "text-emerald-400", icon: <Server className="w-4 h-4 text-emerald-400" /> },
          ].map(stat => (
            <div key={stat.label} className="rounded-xl p-4 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {stat.icon}
              <div>
                <div className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</div>
                <div className="text-xs text-white/40">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Threat trend chart */}
        <div className="rounded-xl p-5 mb-6" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm font-medium text-white">Alert Volume — Last 60 Seconds</p>
            {isLive && <span className="flex items-center gap-1.5 text-xs text-emerald-400"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />LIVE</span>}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={metrics} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="critGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#DC2626" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="highGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EA580C" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#EA580C" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9 }} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.2)", fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: "#0A1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                labelStyle={{ color: "rgba(255,255,255,0.5)" }}
              />
              <Area type="monotone" dataKey="critical" stroke="#DC2626" fill="url(#critGrad)" strokeWidth={1.5} dot={false} name="Critical" />
              <Area type="monotone" dataKey="high" stroke="#EA580C" fill="url(#highGrad)" strokeWidth={1.5} dot={false} name="High" />
              <Line type="monotone" dataKey="medium" stroke="#D97706" strokeWidth={1} dot={false} name="Medium" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3 mb-5">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-white/40" />
            <span className="text-xs text-white/40">Severity:</span>
          </div>
          {(["all", "critical", "high", "medium", "low", "info"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSelectedSeverity(s)}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${selectedSeverity === s ? "text-white" : "text-white/40 hover:text-white/70"}`}
              style={selectedSeverity === s ? { background: "rgba(212,160,23,0.2)", border: "1px solid rgba(212,160,23,0.4)", color: "#D4A017" } : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {s.toUpperCase()}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-4">
            <span className="text-xs text-white/40">Category:</span>
          </div>
          {(["all", "authentication", "network", "anomaly", "malware", "integrity"] as const).map(c => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c as AlertCategory | "all")}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${selectedCategory === c ? "text-white" : "text-white/40 hover:text-white/70"}`}
              style={selectedCategory === c ? { background: "rgba(212,160,23,0.2)", border: "1px solid rgba(212,160,23,0.4)", color: "#D4A017" } : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Alert feed */}
        <div ref={feedRef} className="space-y-2 max-h-[600px] overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
          {filteredAlerts.map(alert => {
            const sev = SEVERITY_CONFIG[alert.severity];
            const isExpanded = expandedAlert === alert.id;
            return (
              <div
                key={alert.id}
                className={`rounded-xl overflow-hidden transition-all ${sev.bg}`}
                style={{ border: `1px solid ${alert.severity === "critical" ? "rgba(220,38,38,0.4)" : alert.severity === "high" ? "rgba(234,88,12,0.3)" : "rgba(255,255,255,0.08)"}` }}
              >
                <button
                  className="w-full px-4 py-3 flex items-start gap-3 hover:bg-white/5 transition-all text-left"
                  onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                >
                  {/* Severity indicator */}
                  <div className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-xs font-bold font-mono ${sev.color}`} style={{ background: "rgba(0,0,0,0.3)", minWidth: 64, textAlign: "center" }}>
                    {sev.label}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-white font-medium text-sm truncate">{alert.rule.description}</span>
                      {alert.mitre && (
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0" style={{ background: "rgba(124,58,237,0.2)", color: "#A78BFA", border: "1px solid rgba(124,58,237,0.3)" }}>
                          {alert.mitre.technique}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-white/40 flex-wrap">
                      <span className="flex items-center gap-1">{CATEGORY_ICONS[alert.category]}{alert.category}</span>
                      <span className="flex items-center gap-1"><Server className="w-3 h-3" />{alert.agent.name}</span>
                      <span className="font-mono">{alert.agent.ip}</span>
                      <span className="font-mono">{new Date(alert.timestamp).toLocaleTimeString()}</span>
                      <span className="font-mono text-white/25">Rule #{alert.rule.id}</span>
                    </div>
                  </div>

                  <span className="text-white/20 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                    <div className="text-sm text-white/70 leading-relaxed">{alert.message}</div>
                    {alert.data && (
                      <div className="rounded-lg p-3 font-mono text-xs" style={{ background: "rgba(0,0,0,0.3)" }}>
                        {Object.entries(alert.data).map(([k, v]) => (
                          <div key={k} className="flex gap-2">
                            <span className="text-white/30 w-28 shrink-0">{k}:</span>
                            <span className="text-emerald-400">{v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {alert.mitre && (
                      <div className="flex items-center gap-4 text-xs">
                        <div><span className="text-white/30">MITRE Technique: </span><span className="text-purple-400 font-mono">{alert.mitre.technique}</span></div>
                        <div><span className="text-white/30">Tactic: </span><span className="text-purple-400">{alert.mitre.tactic}</span></div>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button className="px-3 py-1.5 rounded text-xs font-medium bg-red-900/40 text-red-400 border border-red-800 hover:bg-red-900/60 transition-all">
                        Create Incident
                      </button>
                      <button className="px-3 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 transition-all">
                        Acknowledge
                      </button>
                      <button className="px-3 py-1.5 rounded text-xs font-medium bg-white/5 text-white/50 border border-white/10 hover:bg-white/10 transition-all">
                        <Eye className="w-3 h-3 inline mr-1" />View in OpenCTI
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Implementation note */}
        <div className="mt-8 rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <p className="text-xs font-mono text-white/30 uppercase tracking-widest mb-2">Implementation Reference</p>
          <p className="text-xs text-white/50">
            Wazuh agents run as DaemonSet pods (<code className="text-amber-400/80">k8s/wazuh/wazuh-manager.yaml</code>) on every node, shipping events to the Wazuh Manager which forwards to OpenSearch via Fluvio topics (<code className="text-amber-400/80">kafka/topics.yaml</code> — <code className="text-amber-400/80">security.wazuh.alerts</code>). MITRE ATT&CK enrichment is performed by OpenCTI (<code className="text-amber-400/80">k8s/opencti/opencti-deployment.yaml</code>). Custom TradeGateway rules are in <code className="text-amber-400/80">wazuh/rules/tradegateway_rules.xml</code>.
          </p>
        </div>
      </div>
    </section>
  );
}
