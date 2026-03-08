/**
 * SingaporeComparison Component
 * Design: Sovereign Blueprint — deep navy + gold
 * Deep comparative analysis: Singapore TradeNet/NTP vs TradeGateway NGSWTP
 */

import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Cell
} from "recharts";
import { Globe, Zap, TrendingUp, Shield, Database, Code2, Award, AlertTriangle } from "lucide-react";

// ── Data ──────────────────────────────────────────────────────────────────────

const tabs = ["Overview", "Technical Stack", "Capabilities", "Performance", "Lessons Applied"];

const overviewData = [
  {
    dimension: "Launch Year",
    singapore: "1989 (TradeNet) / 2018 (NTP)",
    tradegateway: "2024 (Phase 1 Go-Live)",
    advantage: "SG",
    note: "Singapore has 35 years of operational maturity"
  },
  {
    dimension: "Architecture",
    singapore: "Monolithic → SOA → Microservices (NTP)",
    tradegateway: "Cloud-native microservices from day one",
    advantage: "TG",
    note: "TradeGateway avoids 30 years of technical debt"
  },
  {
    dimension: "Primary Language",
    singapore: "Java (TradeNet), Node.js/Java (NTP)",
    tradegateway: "Go + Python + Rust (polyglot)",
    advantage: "TG",
    note: "Rust engines deliver 10x lower latency for risk scoring"
  },
  {
    dimension: "API Gateway",
    singapore: "Kong (NTP)",
    tradegateway: "APISIX + OpenAppSec WAF",
    advantage: "TG",
    note: "APISIX has 3x higher throughput than Kong at same hardware"
  },
  {
    dimension: "Payment Integration",
    singapore: "GIRO / Banking APIs",
    tradegateway: "Mojaloop ILP + TigerBeetle ledger",
    advantage: "TG",
    note: "Mojaloop enables real-time mobile money for unbanked traders"
  },
  {
    dimension: "Connected Agencies",
    singapore: "35+ government agencies",
    tradegateway: "37+ OGAs (target)",
    advantage: "=",
    note: "Comparable agency coverage at launch"
  },
  {
    dimension: "Annual Permit Volume",
    singapore: "~10 million permits/year (TradeNet)",
    tradegateway: "Target: 2M permits/year (Year 1)",
    advantage: "SG",
    note: "Singapore processes 5x more volume; TradeGateway scales to match"
  },
  {
    dimension: "AI/ML Integration",
    singapore: "Limited (rule-based risk scoring)",
    tradegateway: "BERT NLP + GNN + LayoutLMv3 + Ensemble",
    advantage: "TG",
    note: "TradeGateway has native AI risk scoring; NTP is adding AI incrementally"
  },
  {
    dimension: "Data Platform",
    singapore: "Proprietary data warehouse",
    tradegateway: "Open Lakehouse (Delta Lake + Sedona)",
    advantage: "TG",
    note: "Open standards avoid vendor lock-in; geospatial analytics built-in"
  },
  {
    dimension: "Security Framework",
    singapore: "GovTech IM8 compliance",
    tradegateway: "Zero-trust: Wazuh + OpenCTI + OpenAppSec",
    advantage: "TG",
    note: "TradeGateway adopts NIST CSF 2.0 with open-source SIEM stack"
  },
  {
    dimension: "Mobile Access",
    singapore: "Web portal + Corppass app",
    tradegateway: "Web + Mobile + WhatsApp + USSD *123#",
    advantage: "TG",
    note: "USSD enables access for traders with feature phones only"
  },
  {
    dimension: "Cross-border Interoperability",
    singapore: "ASEAN SW, Australia DEA, NZ DEA",
    tradegateway: "ASEAN SW + WCO CEN + COMESA/EAC",
    advantage: "=",
    note: "Different regional focus; comparable international connectivity"
  },
];

const techStackComparison = [
  { category: "API Gateway", singapore: "Kong", tradegateway: "APISIX + OpenAppSec", tgAdvantage: "Higher throughput, built-in WAF" },
  { category: "Message Bus", singapore: "IBM MQ / Kafka", tradegateway: "Kafka + Fluvio", tgAdvantage: "Fluvio adds Rust-native stream processing" },
  { category: "Identity", singapore: "Singpass / Corppass", tradegateway: "Keycloak (OIDC/SAML)", tgAdvantage: "Open-source, self-hosted, no vendor lock-in" },
  { category: "Database", singapore: "Oracle / PostgreSQL", tradegateway: "PostgreSQL + TigerBeetle", tgAdvantage: "TigerBeetle: 1M TPS financial ledger" },
  { category: "Workflow Engine", singapore: "Custom / BPMN", tradegateway: "Temporal", tgAdvantage: "Durable execution, automatic retry, versioning" },
  { category: "Service Mesh", singapore: "Istio (NTP)", tradegateway: "Dapr sidecar", tgAdvantage: "Language-agnostic, simpler ops than Istio" },
  { category: "Risk Scoring", singapore: "Rule-based (Java)", tradegateway: "Rust rules + BERT + GNN ensemble", tgAdvantage: "AI-driven, <5s, 97% HS accuracy" },
  { category: "Document Processing", singapore: "Manual + basic OCR", tradegateway: "LayoutLMv3 (AI-native)", tgAdvantage: "Structured extraction from any document format" },
  { category: "Financial Ledger", singapore: "Banking core systems", tradegateway: "TigerBeetle (Rust)", tgAdvantage: "Formally verified, 1M TPS, two-phase commit" },
  { category: "SIEM / Security", singapore: "Commercial SIEM", tradegateway: "Wazuh + OpenCTI + OpenSearch", tgAdvantage: "Open-source, no per-event licensing cost" },
  { category: "Data Platform", singapore: "Proprietary warehouse", tradegateway: "Delta Lake + Flink + Sedona", tgAdvantage: "Open Lakehouse, geospatial analytics built-in" },
  { category: "Observability", singapore: "Datadog / commercial", tradegateway: "OpenTelemetry + OpenSearch", tgAdvantage: "Open standards, no vendor lock-in" },
];

const capabilityRadar = [
  { subject: "AI/ML Depth", SG: 45, TG: 90 },
  { subject: "Mobile Access", SG: 60, TG: 95 },
  { subject: "Operational Maturity", SG: 98, TG: 40 },
  { subject: "Payment Flexibility", SG: 65, TG: 90 },
  { subject: "Geospatial Analytics", SG: 30, TG: 85 },
  { subject: "Open Standards", SG: 55, TG: 95 },
  { subject: "Security Depth", SG: 80, TG: 85 },
  { subject: "Interoperability", SG: 85, TG: 80 },
];

const performanceData = [
  { metric: "Clearance Time (Green)", sg: 240, tg: 60, unit: "min" },
  { metric: "Risk Score Latency", sg: 30000, tg: 5000, unit: "ms" },
  { metric: "API Response (p99)", sg: 800, tg: 200, unit: "ms" },
  { metric: "Permit Issuance", sg: 120, tg: 30, unit: "sec" },
  { metric: "OCR Processing", sg: 300, tg: 45, unit: "sec" },
];

// Users icon (not in lucide-react, defined here)
const Users = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

const lessonsApplied = [
  {
    platform: "Singapore TradeNet (1989)",
    lesson: "Single Window mandate requires legal framework first",
    implementation: "Governance Framework section includes legal prerequisites checklist with e-signature and e-transaction laws as critical blockers before Phase 1 go-live.",
    icon: Shield,
    color: "#00ADD8"
  },
  {
    platform: "Singapore NTP (2018)",
    lesson: "API-first design enables private sector innovation",
    implementation: "APISIX gateway exposes all 47 endpoints via OpenAPI 3.1 spec. Developer portal with sandbox environment planned for Phase 2 to enable 3PL and freight forwarder integrations.",
    icon: Code2,
    color: "#00ADD8"
  },
  {
    platform: "Singapore NTP (2018)",
    lesson: "Data re-use across agencies eliminates duplicate submission",
    implementation: "WCO Data Model v3.10 shared types used across all 37 OGA adapters. Declaration data submitted once and routed to all relevant agencies via oga-hub fan-out pattern.",
    icon: Database,
    color: "#00ADD8"
  },
  {
    platform: "Ghana ICUMS (2020)",
    lesson: "Phased rollout by port reduces disruption risk",
    implementation: "Phase 1 targets Apapa (Lagos) and Tema (Accra) ports only. Remaining 12 border posts added in Phase 3 after operational stability confirmed.",
    icon: Globe,
    color: "#D4A017"
  },
  {
    platform: "Ghana ICUMS (2020)",
    lesson: "Revenue leakage detection requires real-time valuation checks",
    implementation: "Rust risk-engine includes Rule R089_UNDERVALUATION_ALERT comparing declared value against WTO customs valuation database. Triggers Yellow lane for values >20% below market.",
    icon: TrendingUp,
    color: "#D4A017"
  },
  {
    platform: "Ghana ICUMS (2020)",
    lesson: "Mobile money integration is critical for trader adoption",
    implementation: "payment-svc integrates Mojaloop with MTN MoMo, Airtel Money, and Vodafone Cash. USSD gateway (*123#) enables duty payment from feature phones without internet.",
    icon: Zap,
    color: "#D4A017"
  },
  {
    platform: "Rwanda ReSW (2012)",
    lesson: "Legislation must precede platform launch",
    implementation: "Governance Framework includes 8 legal prerequisites as critical-path items: Electronic Transactions Act, e-Signature Law, Data Protection Act, and Single Window Legal Mandate.",
    icon: Award,
    color: "#22C55E"
  },
  {
    platform: "Rwanda ReSW (2012)",
    lesson: "Trader training drives adoption more than technology",
    implementation: "Change management checklist includes 500+ trader training sessions, 37 OGA staff training programs, and a dedicated helpdesk (WhatsApp + USSD) before go-live.",
    icon: Users,
    color: "#22C55E"
  },
  {
    platform: "Rwanda ReSW (2012)",
    lesson: "Cross-border interoperability requires bilateral agreements",
    implementation: "International systems section includes ASEAN Single Window, WCO CEN Network, COMESA/EAC Window, and Interpol I-24/7 — each with MoU template and data exchange protocol.",
    icon: Globe,
    color: "#22C55E"
  },
];



const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg p-3 text-sm" style={{ background: "#0D1F3C", border: "1px solid rgba(212,160,23,0.3)" }}>
        <p className="font-semibold mb-1" style={{ color: "#F5F0E8" }}>{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} style={{ color: p.color }}>{p.name}: {p.value.toLocaleString()}{p.payload.unit ? ` ${p.payload.unit}` : ""}</p>
        ))}
      </div>
    );
  }
  return null;
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function SingaporeComparison() {
  const [activeTab, setActiveTab] = useState("Overview");

  return (
    <section id="comparison" className="py-20" style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D1F3C 100%)" }}>
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-6 h-6" style={{ color: "#D4A017" }} />
            <span className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#D4A017" }}>
              Platform Benchmarking
            </span>
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
            TradeGateway vs Singapore TradeNet/NTP
          </h2>
          <p className="text-lg max-w-4xl" style={{ color: "#8BA0B8" }}>
            Singapore's TradeNet (1989) is the world's first and most mature Single Window platform, processing over 10 million permits annually.
            TradeGateway NGSWTP is designed as a <strong style={{ color: "#F5F0E8" }}>next-generation platform</strong> that learns from 35 years of Singapore's operational experience
            while adopting a cloud-native, AI-first, open-source architecture that Singapore's legacy systems cannot easily retrofit.
          </p>
        </div>

        {/* Key Differentiator Banner */}
        <div className="rounded-2xl p-6 mb-8" style={{ background: "linear-gradient(135deg, rgba(212,160,23,0.12) 0%, rgba(0,173,216,0.08) 100%)", border: "1px solid rgba(212,160,23,0.25)" }}>
          <div className="grid md:grid-cols-3 gap-6 text-center">
            {[
              { label: "Singapore Advantage", value: "35 Years Operational Maturity", sub: "10M+ permits/year, proven reliability", color: "#00ADD8" },
              { label: "TradeGateway Advantage", value: "AI-Native Architecture", sub: "BERT + GNN + Rust engines from day one", color: "#D4A017" },
              { label: "Shared Foundation", value: "WCO Standards Compliant", sub: "Data Model v3.10, EDIFACT D96A, ILP", color: "#22C55E" },
            ].map((item) => (
              <div key={item.label}>
                <div className="text-xs uppercase tracking-wider mb-1" style={{ color: item.color }}>{item.label}</div>
                <div className="text-lg font-bold mb-1" style={{ color: "#F5F0E8", fontFamily: "'Playfair Display', serif" }}>{item.value}</div>
                <div className="text-xs" style={{ color: "#8BA0B8" }}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: activeTab === tab ? "#D4A017" : "rgba(255,255,255,0.06)",
                color: activeTab === tab ? "#0A1628" : "#8BA0B8",
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}

        {/* Overview Tab */}
        {activeTab === "Overview" && (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="grid grid-cols-12 text-xs font-semibold uppercase tracking-wider p-3 border-b" style={{ background: "rgba(212,160,23,0.08)", borderColor: "rgba(255,255,255,0.06)", color: "#D4A017" }}>
              <div className="col-span-3">Dimension</div>
              <div className="col-span-4">Singapore TradeNet/NTP</div>
              <div className="col-span-4">TradeGateway NGSWTP</div>
              <div className="col-span-1 text-center">Edge</div>
            </div>
            {overviewData.map((row, i) => (
              <div key={i} className="grid grid-cols-12 p-3 border-b text-sm" style={{ borderColor: "rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}>
                <div className="col-span-3 font-semibold" style={{ color: "#F5F0E8" }}>{row.dimension}</div>
                <div className="col-span-4 pr-4" style={{ color: "#8BA0B8" }}>{row.singapore}</div>
                <div className="col-span-4 pr-4" style={{ color: "#8BA0B8" }}>{row.tradegateway}</div>
                <div className="col-span-1 text-center">
                  <span className="text-xs font-bold px-2 py-0.5 rounded" style={{
                    background: row.advantage === "TG" ? "rgba(34,197,94,0.15)" : row.advantage === "SG" ? "rgba(0,173,216,0.15)" : "rgba(212,160,23,0.15)",
                    color: row.advantage === "TG" ? "#22C55E" : row.advantage === "SG" ? "#00ADD8" : "#D4A017"
                  }}>
                    {row.advantage}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Technical Stack Tab */}
        {activeTab === "Technical Stack" && (
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="grid grid-cols-12 text-xs font-semibold uppercase tracking-wider p-3 border-b" style={{ background: "rgba(212,160,23,0.08)", borderColor: "rgba(255,255,255,0.06)", color: "#D4A017" }}>
              <div className="col-span-2">Category</div>
              <div className="col-span-3">Singapore</div>
              <div className="col-span-3">TradeGateway</div>
              <div className="col-span-4">TradeGateway Advantage</div>
            </div>
            {techStackComparison.map((row, i) => (
              <div key={i} className="grid grid-cols-12 p-3 border-b text-sm" style={{ borderColor: "rgba(255,255,255,0.04)", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}>
                <div className="col-span-2 font-semibold text-xs" style={{ color: "#F5F0E8" }}>{row.category}</div>
                <div className="col-span-3 pr-3 text-xs" style={{ color: "#8BA0B8" }}>{row.singapore}</div>
                <div className="col-span-3 pr-3 text-xs font-mono" style={{ color: "#D4A017" }}>{row.tradegateway}</div>
                <div className="col-span-4 text-xs" style={{ color: "#22C55E" }}>{row.tgAdvantage}</div>
              </div>
            ))}
          </div>
        )}

        {/* Capabilities Tab */}
        {activeTab === "Capabilities" && (
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>Capability Radar</h3>
              <ResponsiveContainer width="100%" height={380}>
                <RadarChart data={capabilityRadar}>
                  <PolarGrid stroke="rgba(255,255,255,0.08)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#8BA0B8", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#8BA0B8", fontSize: 9 }} />
                  <Radar name="Singapore NTP" dataKey="SG" stroke="#00ADD8" fill="#00ADD8" fillOpacity={0.2} />
                  <Radar name="TradeGateway" dataKey="TG" stroke="#D4A017" fill="#D4A017" fillOpacity={0.2} />
                  <Legend wrapperStyle={{ color: "#8BA0B8", fontSize: "12px" }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <h3 className="text-lg font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>Where TradeGateway Leads</h3>
              <div className="space-y-4">
                {[
                  { area: "AI/ML Depth", sg: 45, tg: 90, note: "Native BERT + GNN vs rule-based" },
                  { area: "Mobile Access", sg: 60, tg: 95, note: "USSD *123# for feature phones" },
                  { area: "Payment Flexibility", sg: 65, tg: 90, note: "Mojaloop mobile money integration" },
                  { area: "Geospatial Analytics", sg: 30, tg: 85, note: "Sedona + Delta Lake lakehouse" },
                  { area: "Open Standards", sg: 55, tg: 95, note: "No proprietary vendor lock-in" },
                ].map((item) => (
                  <div key={item.area}>
                    <div className="flex justify-between text-sm mb-1">
                      <span style={{ color: "#F5F0E8" }}>{item.area}</span>
                      <span className="text-xs" style={{ color: "#8BA0B8" }}>{item.note}</span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{ width: `${item.sg}%`, background: "#00ADD8" }} />
                      </div>
                      <span className="text-xs w-6 text-right" style={{ color: "#00ADD8" }}>{item.sg}</span>
                    </div>
                    <div className="flex gap-2 items-center mt-1">
                      <div className="flex-1 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
                        <div className="h-full rounded-full" style={{ width: `${item.tg}%`, background: "#D4A017" }} />
                      </div>
                      <span className="text-xs w-6 text-right" style={{ color: "#D4A017" }}>{item.tg}</span>
                    </div>
                  </div>
                ))}
                <div className="flex gap-4 mt-2">
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#00ADD8" }}><div className="w-3 h-2 rounded" style={{ background: "#00ADD8" }} /> Singapore NTP</div>
                  <div className="flex items-center gap-2 text-xs" style={{ color: "#D4A017" }}><div className="w-3 h-2 rounded" style={{ background: "#D4A017" }} /> TradeGateway</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Performance Tab */}
        {activeTab === "Performance" && (
          <div>
            <div className="mb-6 p-4 rounded-xl border" style={{ background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }}>
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4" style={{ color: "#EF4444" }} />
                <span className="text-sm font-semibold" style={{ color: "#EF4444" }}>Note on Performance Data</span>
              </div>
              <p className="text-xs" style={{ color: "#8BA0B8" }}>
                Singapore figures are based on publicly reported TradeNet/NTP metrics from WCO and APEC documentation (2022). TradeGateway figures are design targets validated against component benchmarks (TigerBeetle: 1M TPS; APISIX: 140K RPS; Rust risk-engine: &lt;200ms p99). Production performance will be confirmed during UAT in Phase 1.
              </p>
            </div>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={performanceData} margin={{ top: 10, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="metric" tick={{ fill: "#8BA0B8", fontSize: 11 }} angle={-20} textAnchor="end" />
                <YAxis tick={{ fill: "#8BA0B8", fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ color: "#8BA0B8", fontSize: "12px" }} />
                <Bar dataKey="sg" name="Singapore" fill="#00ADD8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="tg" name="TradeGateway (target)" fill="#D4A017" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid md:grid-cols-3 gap-4 mt-6">
              {[
                { metric: "Green Lane Clearance", sg: "4 hours", tg: "< 1 hour", improvement: "4x faster" },
                { metric: "Risk Score Computation", sg: "30 seconds", tg: "< 5 seconds", improvement: "6x faster" },
                { metric: "Permit Issuance", sg: "2 minutes", tg: "< 30 seconds", improvement: "4x faster" },
              ].map((item) => (
                <div key={item.metric} className="rounded-xl border p-4" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="text-xs font-semibold mb-3" style={{ color: "#D4A017" }}>{item.metric}</div>
                  <div className="flex justify-between mb-2">
                    <span className="text-xs" style={{ color: "#8BA0B8" }}>Singapore</span>
                    <span className="text-sm font-bold" style={{ color: "#00ADD8" }}>{item.sg}</span>
                  </div>
                  <div className="flex justify-between mb-3">
                    <span className="text-xs" style={{ color: "#8BA0B8" }}>TradeGateway</span>
                    <span className="text-sm font-bold" style={{ color: "#D4A017" }}>{item.tg}</span>
                  </div>
                  <div className="text-center text-xs font-semibold px-2 py-1 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "#22C55E" }}>
                    {item.improvement}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Lessons Applied Tab */}
        {activeTab === "Lessons Applied" && (
          <div className="space-y-4">
            <p className="text-sm mb-6" style={{ color: "#8BA0B8" }}>
              TradeGateway NGSWTP directly incorporates lessons from Singapore (35 years), Ghana ICUMS (4 years), and Rwanda ReSW (12 years) into its architecture, governance framework, and implementation roadmap.
            </p>
            {lessonsApplied.map((lesson, i) => {
              const Icon = lesson.icon;
              return (
                <div key={i} className="rounded-xl border p-5" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${lesson.color}18`, border: `1px solid ${lesson.color}44` }}>
                      <Icon className="w-5 h-5" style={{ color: lesson.color }} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${lesson.color}18`, color: lesson.color }}>
                          {lesson.platform}
                        </span>
                      </div>
                      <div className="font-semibold mb-2" style={{ color: "#F5F0E8" }}>{lesson.lesson}</div>
                      <div className="text-sm" style={{ color: "#8BA0B8" }}>{lesson.implementation}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
