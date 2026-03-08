/**
 * TradeGateway™ NGSWTP — End-to-End Implementation Specification
 * Design: Sovereign Blueprint — Deep Navy (#0A1628) + Gold (#D4A017)
 * Typography: Playfair Display (headings) + DM Sans (body)
 * Layout: Asymmetric full-width sections, diagonal dividers, large typographic anchors
 * Research sources: Singapore NTP, Ghana ICUMS, Rwanda ReSW
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import OGAIntegrationMap from "@/components/OGAIntegrationMap";
import CostCalculator from "@/components/CostCalculator";
import GovernanceFramework from "@/components/GovernanceFramework";
import FullImplementation from "@/components/FullImplementation";
import GapAnalysis from "@/components/GapAnalysis";
import APIPlayground from "@/components/APIPlayground";
import DeclarationSimulator from "@/components/DeclarationSimulator";
import PhaseGantt from "@/components/PhaseGantt";
import SingaporeComparison from "@/components/SingaporeComparison";
import HSCodeLookup from "@/components/HSCodeLookup";
import OGASLADashboard from "@/components/OGASLADashboard";
import PDFExport from "@/components/PDFExport";
import MojaloopDemo from "@/components/MojaloopDemo";
import KubernetesMap from "@/components/KubernetesMap";
import LanguageToggle from "@/components/LanguageToggle";
import MobileDrawer from "@/components/MobileDrawer";
import TemporalWorkflow from "@/components/TemporalWorkflow";
import KeycloakLoginFlow from "@/components/KeycloakLoginFlow";
import ComplianceScorecard from "@/components/ComplianceScorecard";
import KubecostDrilldown from "@/components/KubecostDrilldown";
import FluvioStreamPanel from "@/components/FluvioStreamPanel";
import MultiAgencyWorkflow from "@/components/MultiAgencyWorkflow";
import StakeholderOnboarding from "@/components/StakeholderOnboarding";
import { I18nProvider } from "@/contexts/I18nContext";
import {
  BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, PolarRadiusAxis, Cell
} from "recharts";
import {
  Shield, Zap, Globe, Database, Server, Lock,
  ChevronDown, ChevronRight, ExternalLink, ArrowRight,
  CheckCircle, AlertTriangle, Clock, TrendingUp, Layers,
  Network, Cpu, BarChart2, Map, FileText, DollarSign
} from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const clearanceTimeData = [
  { platform: "Pre-TradeNet SG", days: 5.5, fill: "#6B7280" },
  { platform: "Singapore NTP", days: 0.007, fill: "#10B981" },
  { platform: "Ghana Pre-ICUMS", days: 4.2, fill: "#6B7280" },
  { platform: "Ghana ICUMS", days: 1.1, fill: "#10B981" },
  { platform: "Rwanda Pre-ReSW", days: 6.0, fill: "#6B7280" },
  { platform: "Rwanda ReSW", days: 1.8, fill: "#10B981" },
  { platform: "NGSWTP Target", days: 0.17, fill: "#D4A017" },
];

const techComparisonData = [
  { category: "Throughput", original: 60, revised: 95 },
  { category: "Latency", original: 55, revised: 92 },
  { category: "Security", original: 65, revised: 98 },
  { category: "Scalability", original: 70, revised: 96 },
  { category: "Observability", original: 60, revised: 94 },
  { category: "Cost Efficiency", original: 50, revised: 88 },
  { category: "Open Source", original: 30, revised: 97 },
];

const roadmapData = [
  {
    phase: "Phase 1",
    title: "Foundation",
    months: "Months 1–6",
    color: "#1E3A5F",
    items: [
      "Kubernetes cluster deployment",
      "Keycloak IAM configuration",
      "APISIX API Gateway",
      "PostgreSQL + Redis clusters",
      "Kafka event bus",
      "Declaration Engine (basic)",
      "Legal & governance framework",
    ],
    metric: "100 test declarations processed",
  },
  {
    phase: "Phase 2",
    title: "Core Customs",
    months: "Months 7–12",
    color: "#D4A017",
    items: [
      "Risk AI Engine (ML scoring)",
      "Temporal workflow engine",
      "TigerBeetle financial ledger",
      "Mojaloop payment integration",
      "Cargo tracking service",
      "5 OGA integrations",
      "Green-lane clearance < 4 hours",
    ],
    metric: "Green-lane < 4 hours",
  },
  {
    phase: "Phase 3",
    title: "Full Single Window",
    months: "Months 13–18",
    color: "#0E6655",
    items: [
      "All 37+ OGA integrations",
      "AEO programme",
      "Bonded warehouse management",
      "Free zone operations",
      "Post-clearance audit",
      "ASEAN Single Window connectivity",
      "WCO CEN Network integration",
    ],
    metric: "100% OGA coverage",
  },
  {
    phase: "Phase 4",
    title: "Intelligence & Analytics",
    months: "Months 19–24",
    color: "#6B21A8",
    items: [
      "Delta Lake + Parquet lakehouse",
      "Apache Flink real-time streams",
      "Apache Sedona geospatial",
      "Ray distributed ML",
      "OpenCTI threat intelligence",
      "Wazuh SIEM/XDR",
      "Open API ecosystem launch",
    ],
    metric: "10+ third-party integrations",
  },
];

const techStack = [
  { layer: "Language", original: "Java / Spring Boot", revised: "Go + Python", icon: <Cpu size={16} /> },
  { layer: "API Gateway", original: "Kong API Gateway", revised: "Apache APISIX", icon: <Network size={16} /> },
  { layer: "WAF / Security", original: "Not specified", revised: "OpenAppSec (AI WAF)", icon: <Shield size={16} /> },
  { layer: "Identity & Access", original: "Not specified", revised: "Keycloak (OIDC/SAML)", icon: <Lock size={16} /> },
  { layer: "Event Bus", original: "Apache Kafka", revised: "Kafka + Fluvio", icon: <Zap size={16} /> },
  { layer: "Workflow Engine", original: "Not specified", revised: "Temporal", icon: <Server size={16} /> },
  { layer: "Service Mesh", original: "Not specified", revised: "Dapr", icon: <Layers size={16} /> },
  { layer: "Financial Ledger", original: "Generic Payment GW", revised: "Mojaloop + TigerBeetle", icon: <DollarSign size={16} /> },
  { layer: "Primary DB", original: "PostgreSQL + MongoDB", revised: "PostgreSQL only", icon: <Database size={16} /> },
  { layer: "Cache", original: "Redis", revised: "Redis", icon: <Database size={16} /> },
  { layer: "Search / Logs", original: "Elasticsearch", revised: "OpenSearch", icon: <BarChart2 size={16} /> },
  { layer: "Threat Intel", original: "Not specified", revised: "OpenCTI", icon: <Shield size={16} /> },
  { layer: "SIEM / XDR", original: "Not specified", revised: "Wazuh", icon: <Shield size={16} /> },
  { layer: "Analytics Engine", original: "Snowflake", revised: "Delta Lake + Spark + Flink", icon: <BarChart2 size={16} /> },
  { layer: "Geospatial", original: "Not specified", revised: "Apache Sedona", icon: <Map size={16} /> },
  { layer: "ML Platform", original: "Not specified", revised: "Ray + DataFusion", icon: <Cpu size={16} /> },
  { layer: "FinOps", original: "Not specified", revised: "Kubecost", icon: <DollarSign size={16} /> },
  { layer: "Container Orch.", original: "Kubernetes", revised: "Kubernetes", icon: <Server size={16} /> },
];

const platforms = [
  {
    id: "singapore",
    name: "Singapore NTP",
    subtitle: "Networked Trade Platform",
    year: "1989 / 2018",
    flag: "🇸🇬",
    color: "#DC2626",
    accentColor: "#FCA5A5",
    stats: [
      { label: "Clearance Time", value: "< 10 min", icon: <Clock size={14} /> },
      { label: "Annual Permits", value: "10M+", icon: <FileText size={14} /> },
      { label: "Competent Authorities", value: "35+", icon: <Globe size={14} /> },
      { label: "G2G Connections", value: "7+ countries", icon: <Network size={14} /> },
    ],
    lessons: [
      "International trade involves 25 parties, 30–40 documents, 60–70% manual re-entry — the core problem statement",
      "Open, not-for-profit government platform maximizes ecosystem participation",
      "Pre-population of data fields across services eliminates redundancy and errors",
      "B2G + B2B on a single platform creates network effects that drive adoption",
      "API-first design enables third-party value-added service ecosystem",
      "G2G digital connectivity with trading partners reduces documentary fraud",
    ],
    requirements: [
      "Single submission point for all trade documents",
      "Sub-10-second response time for permit processing",
      "Enterprise SSO (CorpPass) with verified digital identity",
      "Document repository with selective sharing to business partners",
      "Open API ecosystem for third-party developers",
      "Government-to-government digital document exchange",
    ],
  },
  {
    id: "ghana",
    name: "Ghana ICUMS",
    subtitle: "Integrated Customs Management System",
    year: "2020",
    flag: "🇬🇭",
    color: "#D97706",
    accentColor: "#FCD34D",
    stats: [
      { label: "Deployment", value: "Nationwide 2020", icon: <Globe size={14} /> },
      { label: "Technology", value: "UNIPASS (Korea)", icon: <Cpu size={14} /> },
      { label: "Replaced", value: "GCNet + West Blue", icon: <CheckCircle size={14} /> },
      { label: "UCR Tracking", value: "End-to-end", icon: <TrendingUp size={14} /> },
    ],
    lessons: [
      "Fragmented dual-vendor system created revenue leakage — consolidation is essential",
      "Unique Consignment Reference (UCR) must follow cargo through entire lifecycle",
      "Human resource management model (officer assignment tracking) prevents corruption",
      "End-to-end tamper-proof tracking eliminates manipulation of figures",
      "Phase 1 core modules must be solid before Phase 2 advanced features",
      "AEO programme and post-clearance audit are critical for trade facilitation",
    ],
    requirements: [
      "Unique Consignment Reference (UCR) generated at first submission",
      "Import, export, transit, and cargo tracking on single platform",
      "MDA/OGA integration for all LPCOs (Licences, Permits, Certificates)",
      "Tax bill creation, payment, securities/bonds, and penalties",
      "Officer assignment tracking with activity period recording",
      "AEO programme and post-clearance audit with duty drawback",
    ],
  },
  {
    id: "rwanda",
    name: "Rwanda ReSW",
    subtitle: "Rwanda Electronic Single Window",
    year: "2012",
    flag: "🇷🇼",
    color: "#059669",
    accentColor: "#6EE7B7",
    stats: [
      { label: "Agencies Connected", value: "28", icon: <Network size={14} /> },
      { label: "Clearing Firms", value: "520", icon: <Globe size={14} /> },
      { label: "System Users", value: "2,369", icon: <CheckCircle size={14} /> },
      { label: "Transaction Types", value: "12", icon: <FileText size={14} /> },
    ],
    lessons: [
      "Fully public ownership (not PPP) is more sustainable for national infrastructure",
      "Joint inspection model — no release without ALL agencies finalizing — eliminates bottlenecks",
      "Legal framework (e-signatures, e-transactions) must be in place before launch",
      "All stakeholders must be on Steering Committee for buy-in and accountability",
      "Hybrid access model (direct API + web + USSD) ensures no trader is excluded",
      "Internet connectivity challenges require offline/low-bandwidth fallback modes",
    ],
    requirements: [
      "Simultaneous risk selectivity across all agencies (joint inspection model)",
      "e-Payment via multi-bank and mobile money (internet + USSD)",
      "e-Exemption with multi-ministry workflow management",
      "Electronic phytosanitary and agriculture certificates",
      "COMESA transit guarantee and INTERPOL blacklist integration",
      "Hybrid access: direct API for computerized, integrated for legacy systems",
    ],
  },
];

const architectureLayers = [
  {
    id: "presentation",
    label: "PRESENTATION LAYER",
    color: "#1E3A5F",
    components: ["Web Portal", "Mobile App iOS/Android", "REST/GraphQL API", "WhatsApp Bot", "USSD *123#"],
  },
  {
    id: "gateway",
    label: "API GATEWAY LAYER",
    color: "#1A4A3A",
    components: ["Apache APISIX (API Gateway)", "OpenAppSec (AI WAF)", "Keycloak (IAM/OIDC)"],
  },
  {
    id: "microservices",
    label: "MICROSERVICES LAYER (Go)",
    color: "#2D1B69",
    components: [
      "Declaration Engine",
      "Risk AI Engine (Python)",
      "Payment Gateway (Mojaloop)",
      "Document Management",
      "Cargo Tracking",
      "Multi-Agency Workflow",
      "AEO Management",
      "Post-Clearance Audit",
      "OGA Integration Hub",
    ],
  },
  {
    id: "workflow",
    label: "WORKFLOW ORCHESTRATION",
    color: "#1E3A5F",
    components: ["Temporal (Durable Workflows)", "Dapr (Service Mesh + Bindings)"],
  },
  {
    id: "integration",
    label: "INTEGRATION LAYER",
    color: "#1A4A3A",
    components: ["Apache Kafka (Event Bus)", "Fluvio (Real-time Streams)", "EDI Translation Engine", "WCO Data Model v3.10"],
  },
  {
    id: "data",
    label: "DATA LAYER",
    color: "#3B1F2B",
    components: [
      "TigerBeetle (Financial Ledger)",
      "PostgreSQL",
      "Redis",
      "OpenSearch",
      "Delta Lake + Parquet",
      "Apache Flink",
      "Apache Spark",
      "Apache DataFusion",
      "Ray (ML)",
      "Apache Sedona (Geospatial)",
    ],
  },
  {
    id: "security",
    label: "SECURITY LAYER",
    color: "#1A1A2E",
    components: ["OpenCTI (Threat Intel)", "Wazuh (SIEM/XDR)", "OpenSearch (Log Analytics)", "mTLS Everywhere"],
  },
  {
    id: "infra",
    label: "INFRASTRUCTURE LAYER",
    color: "#0A1628",
    components: ["Kubernetes", "Kubecost (FinOps)", "Prometheus + Grafana", "CI/CD Pipelines"],
  },
];

const processLanes = [
  {
    lane: "LANE 1",
    actor: "TRADER",
    color: "#1E3A5F",
    steps: ["Submit Declaration + Upload Invoice/BL/Docs", "Receive URN Reference", "Pay Duties via Mojaloop/Mobile", "Receive Clearance Permit"],
  },
  {
    lane: "LANE 2",
    actor: "AI ENGINE",
    color: "#D4A017",
    steps: ["OCR Extract Document Data (Python)", "Validate HS Code via BERT NLP", "Calculate Risk Score < 5 sec", "Assign Lane: GREEN/YELLOW/RED", "Auto-Route to Agencies via Temporal"],
  },
  {
    lane: "LANE 3",
    actor: "CUSTOMS AUTHORITY",
    color: "#0E6655",
    steps: ["Receive Declaration", "Green: Auto-Approve | Yellow: Doc Review | Red: Physical Inspection", "Issue Clearance"],
  },
  {
    lane: "LANE 4",
    actor: "OTHER GOVT AGENCIES",
    color: "#6B21A8",
    steps: ["Receive Simultaneous Notification (Dapr)", "Review & Approve/Reject (Joint Inspection Model)", "Confirm to Workflow Engine"],
  },
  {
    lane: "LANE 5",
    actor: "PORT OPERATOR",
    color: "#B45309",
    steps: ["Receive Real-time Updates (Fluvio)", "Schedule Inspection / Berth", "Issue Release Authorization"],
  },
];

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="h-px flex-1 bg-gold/30" />
      <span className="text-xs font-mono tracking-[0.25em] text-gold uppercase">{children}</span>
      <div className="h-px flex-1 bg-gold/30" />
    </div>
  );
}

function StatCard({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="bg-navy-800/60 border border-gold/20 rounded-lg p-4 text-center">
      <div className="text-gold mb-1 flex justify-center">{icon}</div>
      <div className="text-2xl font-bold text-white font-display">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function PlatformCard({ platform, isOpen, onToggle }: { platform: typeof platforms[0]; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-navy-900/50 backdrop-blur-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-4">
          <span className="text-3xl">{platform.flag}</span>
          <div>
            <div className="text-lg font-bold text-white font-display">{platform.name}</div>
            <div className="text-sm text-slate-400">{platform.subtitle} · Est. {platform.year}</div>
          </div>
        </div>
        <ChevronDown
          size={20}
          className={`text-gold transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-5">
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {platform.stats.map((s) => (
                  <StatCard key={s.label} value={s.value} label={s.label} icon={s.icon} />
                ))}
              </div>

              {/* Lessons + Requirements */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <div className="text-xs font-mono tracking-widest text-gold uppercase mb-3">Key Lessons Learned</div>
                  <ul className="space-y-2">
                    {platform.lessons.map((l, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-300">
                        <CheckCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                        <span>{l}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-xs font-mono tracking-widest text-gold uppercase mb-3">Derived Requirements</div>
                  <ul className="space-y-2">
                    {platform.requirements.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-300">
                        <ArrowRight size={14} className="text-gold mt-0.5 shrink-0" />
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function Home() {
  const [openPlatform, setOpenPlatform] = useState<string | null>("singapore");
  const [openLayer, setOpenLayer] = useState<string | null>("microservices");
  const [activeTab, setActiveTab] = useState<"layers" | "flow" | "data">("layers");

  const togglePlatform = (id: string) => setOpenPlatform(openPlatform === id ? null : id);
  const toggleLayer = (id: string) => setOpenLayer(openLayer === id ? null : id);

  return (
    <I18nProvider>
    <div className="min-h-screen bg-navy text-white font-body">

      {/* ── STICKY NAV ───────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-navy-950/95 backdrop-blur border-b border-white/10">
        <div className="container max-w-6xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="font-display text-sm font-bold text-gold">TradeGateway™ NGSWTP</div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <MobileDrawer />
            </div>
            <div className="hidden md:flex items-center gap-1 text-xs">
              {[
                { label: "Research", href: "#research" },
                { label: "Architecture", href: "#architecture" },
                { label: "Process Flow", href: "#process" },
                { label: "OGA Map", href: "#oga-map" },
                { label: "Cost Calculator", href: "#cost" },
                { label: "Governance", href: "#governance" },
                { label: "Security", href: "#security" },
                { label: "Implementation", href: "#implementation" },
                { label: "Gap Analysis", href: "#gap-analysis" },
                { label: "SG Comparison", href: "#comparison" },
                { label: "Simulator", href: "#simulator" },
                { label: "API Playground", href: "#api-playground" },
                { label: "Roadmap", href: "#roadmap" },
                { label: "HS Lookup", href: "#hs-lookup" },
                { label: "OGA SLA", href: "#oga-sla" },
                { label: "Payment Flow", href: "#mojaloop-demo" },
                { label: "Workflow", href: "#temporal-workflow" },
                { label: "K8s Map", href: "#k8s-map" },
                { label: "Auth Flow", href: "#keycloak-login" },
                { label: "Compliance", href: "#compliance-scorecard" },
                { label: "Cost Drill-Down", href: "#kubecost-drilldown" },
              ].map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  className="px-3 py-1.5 rounded text-slate-400 hover:text-gold hover:bg-white/5 transition-colors"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-[92vh] flex flex-col justify-end pb-20 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=1800&q=80)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-navy/80 via-navy/70 to-navy" />

        {/* Decorative grid */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "linear-gradient(rgba(212,160,23,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,23,0.3) 1px, transparent 1px)",
            backgroundSize: "80px 80px"
          }}
        />

        <div className="relative container max-w-6xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="text-xs font-mono tracking-[0.3em] text-gold uppercase mb-6">
              Revised Technical Specification · Version 2.0 · March 2026
            </div>
            <h1 className="font-display text-5xl md:text-7xl font-bold leading-tight mb-6">
              TradeGateway™
              <span className="block text-gold">NGSWTP</span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-300 max-w-3xl mb-4 leading-relaxed">
              Next Generation Single Window Trade Platform
            </p>
            <p className="text-slate-400 max-w-2xl mb-10 leading-relaxed">
              End-to-end implementation specification synthesized from Singapore NTP, Ghana ICUMS, and Rwanda ReSW — rebuilt on Go, Python, Mojaloop, TigerBeetle, and a comprehensive open-source cloud-native stack.
            </p>

            <div className="flex flex-wrap gap-4">
              {[
                { label: "< 4 Hours", sub: "Green-lane clearance" },
                { label: "37+ OGAs", sub: "Connected agencies" },
                { label: "99.99%", sub: "Uptime SLA" },
                { label: "5M+", sub: "Annual declarations" },
              ].map((s) => (
                <div key={s.label} className="bg-white/5 border border-gold/30 rounded-lg px-5 py-3 backdrop-blur-sm">
                  <div className="text-2xl font-bold text-gold font-display">{s.label}</div>
                  <div className="text-xs text-slate-400">{s.sub}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── REFERENCE PLATFORMS ──────────────────────────────────────────── */}
      <section id="research" className="py-20 bg-navy-950">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Research Foundation</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Three Platforms, One Specification
          </h2>
          <p className="text-slate-400 max-w-3xl mb-12 leading-relaxed">
            This specification synthesizes proven design patterns, lessons learned, and business requirements from the world's most instructive single window implementations. Each platform contributed distinct insights that are directly reflected in the NGSWTP architecture.
          </p>

          {/* Clearance Time Chart */}
          <div className="bg-navy-800/40 border border-white/10 rounded-xl p-6 mb-10">
            <div className="text-sm font-mono tracking-widest text-gold uppercase mb-6">
              Clearance Time Comparison (Days)
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={clearanceTimeData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="platform"
                  tick={{ fill: "#94A3B8", fontSize: 11 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fill: "#94A3B8", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0A1628", border: "1px solid rgba(212,160,23,0.3)", borderRadius: 8 }}
                  labelStyle={{ color: "#D4A017" }}
                  itemStyle={{ color: "#E2E8F0" }}
                  formatter={(v: number) => [`${v} days`, "Clearance Time"]}
                />
                <Bar dataKey="days" radius={[4, 4, 0, 0]}>
                  {clearanceTimeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Platform Cards */}
          <div className="space-y-4">
            {platforms.map((p) => (
              <PlatformCard
                key={p.id}
                platform={p}
                isOpen={openPlatform === p.id}
                onToggle={() => togglePlatform(p.id)}
              />
            ))}
          </div>
        </div>
      </section>
      {/* ── ARCHITECTURE ──────────────────────────────────────────────────── */}
      <span id="architecture" />
      <section className="py-20 bg-navy">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Technical Architecture</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Seven-Layer Cloud-Native Architecture
          </h2>
          <p className="text-slate-400 max-w-3xl mb-8 leading-relaxed">
            The platform replaces all Java/Spring components with Go (high-performance services) and Python (AI/ML workloads), organized into seven distinct layers deployed on Kubernetes.
          </p>

          {/* Tab selector */}
          <div className="flex gap-2 mb-8 border-b border-white/10 pb-4">
            {(["layers", "flow", "data"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 rounded-lg text-sm font-medium transition-all capitalize ${
                  activeTab === tab
                    ? "bg-gold text-navy font-bold"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                {tab === "layers" ? "Architecture Layers" : tab === "flow" ? "Process Flow" : "Data Platform"}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === "layers" && (
              <motion.div
                key="layers"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-2"
              >
                {architectureLayers.map((layer) => (
                  <div key={layer.id} className="rounded-xl overflow-hidden border border-white/10">
                    <button
                      onClick={() => toggleLayer(layer.id)}
                      className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-white/5 transition-colors"
                      style={{ backgroundColor: layer.color + "40" }}
                    >
                      <span className="text-xs font-mono tracking-widest text-gold uppercase">{layer.label}</span>
                      <ChevronRight
                        size={16}
                        className={`text-gold transition-transform duration-200 ${openLayer === layer.id ? "rotate-90" : ""}`}
                      />
                    </button>
                    <AnimatePresence>
                      {openLayer === layer.id && (
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: "auto" }}
                          exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-5 py-4 flex flex-wrap gap-2" style={{ backgroundColor: layer.color + "20" }}>
                            {layer.components.map((c) => (
                              <span
                                key={c}
                                className="px-3 py-1.5 rounded-md text-sm font-medium text-white border border-white/20"
                                style={{ backgroundColor: layer.color + "60" }}
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === "flow" && (
              <motion.div
                key="flow"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-3"
              >
                <p className="text-slate-400 text-sm mb-4">
                  End-to-end declaration process from submission to clearance, implementing the joint inspection model from Rwanda ReSW and the simultaneous OGA notification pattern.
                </p>
                {processLanes.map((lane) => (
                  <div
                    key={lane.lane}
                    className="rounded-xl border border-white/10 overflow-hidden"
                    style={{ borderLeftColor: lane.color, borderLeftWidth: 4 }}
                  >
                    <div className="px-5 py-3 flex items-center gap-3" style={{ backgroundColor: lane.color + "30" }}>
                      <span className="text-xs font-mono tracking-widest text-white/60">{lane.lane}</span>
                      <span className="text-sm font-bold text-white">{lane.actor}</span>
                    </div>
                    <div className="px-5 py-4 flex flex-wrap gap-2 items-center">
                      {lane.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="px-3 py-1.5 rounded-lg text-xs text-slate-300 bg-white/5 border border-white/10">
                            {step}
                          </span>
                          {i < lane.steps.length - 1 && (
                            <ArrowRight size={12} className="text-slate-600 shrink-0" />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </motion.div>
            )}

            {activeTab === "data" && (
              <motion.div
                key="data"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <div className="grid md:grid-cols-2 gap-6">
                  {[
                    {
                      title: "Bronze Layer",
                      subtitle: "Raw Data Ingestion",
                      color: "#92400E",
                      desc: "All raw events from Kafka, TigerBeetle transactions, cargo tracking events, and OGA records stored as Parquet in Delta Lake. Append-only, immutable system of record.",
                      tools: ["Delta Lake", "Apache Parquet", "Apache Kafka", "Fluvio"],
                    },
                    {
                      title: "Silver Layer",
                      subtitle: "Cleansed & Enriched",
                      color: "#374151",
                      desc: "Apache Flink continuously processes Bronze data: deduplication, schema validation, entity resolution, and enrichment with tariff schedules and country codes.",
                      tools: ["Apache Flink", "Delta Lake", "OpenSearch"],
                    },
                    {
                      title: "Gold Layer",
                      subtitle: "Business-Ready Analytics",
                      color: "#92400E",
                      desc: "Apache Spark batch processes Silver data into revenue analytics, trade flow datasets, risk model training data, compliance reports, and geospatial analytics.",
                      tools: ["Apache Spark", "Apache DataFusion", "Ray", "Apache Sedona"],
                    },
                    {
                      title: "Geospatial Intelligence",
                      subtitle: "Apache Sedona",
                      color: "#1E3A5F",
                      desc: "Port congestion heatmaps, trade flow visualization, border crossing pattern analysis, geofenced monitoring for controlled goods, and supply chain route optimization.",
                      tools: ["Apache Sedona", "Apache Spark", "Ray", "Delta Lake"],
                    },
                  ].map((layer) => (
                    <div
                      key={layer.title}
                      className="rounded-xl border border-white/10 p-5"
                      style={{ backgroundColor: layer.color + "20" }}
                    >
                      <div className="text-xs font-mono tracking-widest text-gold uppercase mb-1">{layer.subtitle}</div>
                      <div className="text-lg font-bold text-white font-display mb-3">{layer.title}</div>
                      <p className="text-sm text-slate-400 leading-relaxed mb-4">{layer.desc}</p>
                      <div className="flex flex-wrap gap-2">
                        {layer.tools.map((t) => (
                          <span key={t} className="px-2 py-1 rounded text-xs text-slate-300 bg-white/10 border border-white/10">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      {/* ── TECH COMPARISON ──────────────────────────────────────────────── */}
      <section className="py-20 bg-navy-950">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Technology Stack</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Original vs. Revised Stack
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            Every Java/Spring, Kong, Snowflake, MongoDB, and proprietary component has been replaced with open-source, cloud-native alternatives optimized for performance, security, and total cost of ownership.
          </p>

          <div className="grid lg:grid-cols-2 gap-8">
            {/* Radar Chart */}
            <div className="bg-navy-800/40 border border-white/10 rounded-xl p-6">
              <div className="text-sm font-mono tracking-widest text-gold uppercase mb-4">Performance Profile</div>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={techComparisonData}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis dataKey="category" tick={{ fill: "#94A3B8", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: "#64748B", fontSize: 9 }} />
                  <Radar name="Original Stack" dataKey="original" stroke="#6B7280" fill="#6B7280" fillOpacity={0.2} />
                  <Radar name="Revised Stack" dataKey="revised" stroke="#D4A017" fill="#D4A017" fillOpacity={0.3} />
                  <Legend wrapperStyle={{ color: "#94A3B8", fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0A1628", border: "1px solid rgba(212,160,23,0.3)", borderRadius: 8 }}
                    labelStyle={{ color: "#D4A017" }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            {/* Stack Table */}
            <div className="bg-navy-800/40 border border-white/10 rounded-xl overflow-hidden">
              <div className="text-sm font-mono tracking-widest text-gold uppercase p-4 border-b border-white/10">
                Component Mapping
              </div>
              <div className="overflow-y-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-navy-900">
                    <tr>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal text-xs">Layer</th>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal text-xs">Original</th>
                      <th className="text-left px-4 py-2 text-gold font-normal text-xs">Revised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {techStack.map((row, i) => (
                      <tr key={row.layer} className={i % 2 === 0 ? "bg-white/2" : ""}>
                        <td className="px-4 py-2 text-slate-400 text-xs flex items-center gap-1.5">
                          <span className="text-gold">{row.icon}</span>
                          {row.layer}
                        </td>
                        <td className="px-4 py-2 text-slate-500 text-xs line-through">{row.original}</td>
                        <td className="px-4 py-2 text-emerald-400 text-xs font-medium">{row.revised}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PAYMENT ARCHITECTURE ─────────────────────────────────────────── */}
      <section className="py-20 bg-navy">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Financial Infrastructure</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Mojaloop + TigerBeetle
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            The payment subsystem replaces a generic payment gateway with purpose-built financial infrastructure: Mojaloop for interoperable payment switching across banks and mobile money operators, and TigerBeetle as the high-performance double-entry financial ledger.
          </p>

          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                title: "Mojaloop",
                subtitle: "Interoperable Payment Switch",
                icon: <Globe size={24} />,
                color: "#1E3A5F",
                points: [
                  "ISO 20022 / Mojaloop API standard",
                  "Connects central bank, commercial banks, mobile money",
                  "Real-time settlement confirmation",
                  "Open-source, Mojaloop Foundation governed",
                  "Used in 10+ African countries",
                ],
                link: "https://mojaloop.io/",
              },
              {
                title: "TigerBeetle",
                subtitle: "Financial Accounting Database",
                icon: <Database size={24} />,
                color: "#3B1F2B",
                points: [
                  "Double-entry bookkeeping with ACID guarantees",
                  "1 million transactions per second",
                  "Linearizable consistency (no race conditions)",
                  "Immutable audit log (tamper-proof)",
                  "Duty, bond, drawback, and penalty accounts",
                ],
                link: "https://tigerbeetle.com/",
              },
              {
                title: "Payment Flow",
                subtitle: "End-to-End Settlement",
                icon: <DollarSign size={24} />,
                color: "#1A4A3A",
                points: [
                  "Assessment → TigerBeetle debit liability account",
                  "Trader pays via Mojaloop (bank/mobile)",
                  "Mojaloop confirms settlement in real-time",
                  "TigerBeetle credits confirmed revenue account",
                  "Kafka event triggers clearance workflow",
                ],
                link: null,
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-white/10 p-6"
                style={{ backgroundColor: card.color + "40" }}
              >
                <div className="text-gold mb-3">{card.icon}</div>
                <div className="text-lg font-bold text-white font-display mb-1">{card.title}</div>
                <div className="text-xs text-slate-400 mb-4">{card.subtitle}</div>
                <ul className="space-y-2 mb-4">
                  {card.points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-300">
                      <CheckCircle size={13} className="text-gold mt-0.5 shrink-0" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                {card.link && (
                  <a
                    href={card.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-gold hover:text-gold/70 transition-colors"
                  >
                    <ExternalLink size={12} /> {card.link}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── IMPLEMENTATION ROADMAP ───────────────────────────────────────── */}
      <section className="py-20 bg-navy-950">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Implementation Roadmap</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            24-Month Delivery Plan
          </h2>
          <p className="text-slate-400 max-w-3xl mb-12 leading-relaxed">
            A phased implementation approach based on Ghana's milestone-driven rollout and Rwanda's hybrid access model, ensuring each phase delivers measurable value before the next begins.
          </p>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5">
            {roadmapData.map((phase, idx) => (
              <motion.div
                key={phase.phase}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: idx * 0.1 }}
                className="rounded-xl border border-white/10 overflow-hidden"
                style={{ borderTopColor: phase.color, borderTopWidth: 3 }}
              >
                <div className="p-5" style={{ backgroundColor: phase.color + "20" }}>
                  <div className="text-xs font-mono tracking-widest text-slate-400 mb-1">{phase.months}</div>
                  <div className="text-lg font-bold text-white font-display">{phase.phase}</div>
                  <div className="text-sm font-medium mb-4" style={{ color: phase.color === "#D4A017" ? "#D4A017" : "#94A3B8" }}>
                    {phase.title}
                  </div>
                  <ul className="space-y-1.5">
                    {phase.items.map((item, i) => (
                      <li key={i} className="flex gap-2 text-xs text-slate-400">
                        <div className="w-1 h-1 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: phase.color }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="px-5 py-3 bg-white/5 border-t border-white/10">
                  <div className="text-xs text-slate-400">Success Metric</div>
                  <div className="text-sm font-medium text-white mt-0.5">{phase.metric}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
      {/* ── SECURITY ARCHITECTURE ──────────────────────────────────────────── */}
      <section id="security" className="py-20 bg-navy">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Zero-Trust Security</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Defence-in-Depth Security Architecture
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            A national trade platform is a high-value target for criminal organizations and state-sponsored actors. The security architecture implements zero-trust principles with AI-powered threat detection.
          </p>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              {
                tool: "Keycloak",
                role: "Identity & Access Management",
                icon: <Lock size={20} />,
                color: "#1E3A5F",
                features: ["OIDC / OAuth 2.0", "SAML 2.0 federation", "MFA (TOTP, WebAuthn)", "RBAC + ABAC", "Enterprise SSO"],
                link: "https://www.keycloak.org/",
              },
              {
                tool: "OpenAppSec",
                role: "AI-Powered WAF",
                icon: <Shield size={20} />,
                color: "#1A4A3A",
                features: ["ML-based threat detection", "Zero-day exploit blocking", "API abuse prevention", "No signature updates needed", "APISIX integration"],
                link: "https://www.openappsec.io/",
              },
              {
                tool: "OpenCTI",
                role: "Cyber Threat Intelligence",
                icon: <AlertTriangle size={20} />,
                color: "#3B1F2B",
                features: ["Threat actor tracking", "Customs fraud patterns", "INTERPOL integration", "Risk score enrichment", "Partner sharing"],
                link: "https://www.opencti.io/",
              },
              {
                tool: "Wazuh",
                role: "SIEM / XDR",
                icon: <Server size={20} />,
                color: "#1A1A2E",
                features: ["Real-time monitoring", "File integrity monitoring", "Vulnerability assessment", "Intrusion detection", "Automated response"],
                link: "https://wazuh.com/",
              },
            ].map((sec) => (
              <div
                key={sec.tool}
                className="rounded-xl border border-white/10 p-5"
                style={{ backgroundColor: sec.color + "40" }}
              >
                <div className="text-gold mb-3">{sec.icon}</div>
                <div className="text-base font-bold text-white font-display mb-1">{sec.tool}</div>
                <div className="text-xs text-slate-400 mb-4">{sec.role}</div>
                <ul className="space-y-1.5 mb-4">
                  {sec.features.map((f, i) => (
                    <li key={i} className="text-xs text-slate-300 flex gap-1.5">
                      <span className="text-gold">›</span> {f}
                    </li>
                  ))}
                </ul>
                <a
                  href={sec.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs text-gold/70 hover:text-gold transition-colors"
                >
                  <ExternalLink size={11} /> Documentation
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OGA INTEGRATION MAP ──────────────────────────────────────── */}
      <section id="oga-map" className="py-20 bg-navy-950">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Ecosystem Integration</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            OGA Integration Map
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            An interactive force-directed graph showing all 37+ government agencies, international systems, and financial institutions connected to the NGSWTP hub. Each node reveals the integration protocol, data exchange scope, and response SLA. Drag nodes to explore, scroll to zoom, and click for details.
          </p>
          <OGAIntegrationMap />
        </div>
      </section>

      {/* ── COST ESTIMATION CALCULATOR ───────────────────────────────── */}
      <section id="cost" className="py-20 bg-navy">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Financial Planning</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Cost Estimation Calculator
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            Adjust the parameters below to generate indicative CAPEX and OPEX estimates for your deployment scenario. Benchmarked against Ghana ICUMS (~$45M), Rwanda ReSW (~$12M), and Singapore NTP (~$250M+) actual implementation costs.
          </p>
          <CostCalculator />
        </div>
      </section>

      {/* ── GOVERNANCE & LEGAL FRAMEWORK ─────────────────────────────── */}
      <section id="governance" className="py-20 bg-navy-950">
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Governance & Legal</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            Governance & Legal Framework
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            Rwanda's critical lesson: legislation on e-signatures and e-transactions must be enacted before launch. Use this interactive checklist to track legal prerequisites, governance structure, agency MoU completion, and change management readiness across all four dimensions.
          </p>
          <GovernanceFramework />
        </div>
      </section>

      {/* ── FULL IMPLEMENTATION ─────────────────────────────────────── */}
      <section id="implementation" className="py-20" style={{ backgroundColor: "#060E1C" }}>
        <div className="container max-w-6xl mx-auto px-6">
          <SectionLabel>Full Implementation</SectionLabel>
          <h2 className="font-display text-4xl font-bold mb-4">
            End-to-End Implementation
          </h2>
          <p className="text-slate-400 max-w-3xl mb-10 leading-relaxed">
            The platform is built across three language tiers: <strong className="text-emerald-400">Go 1.23+</strong> for all 12 business microservices, <strong className="text-blue-400">Python 3.12</strong> for 6 AI/ML/GNN services, and <strong className="text-orange-400">Rust 1.82+</strong> for 5 performance-critical engines. Each service is independently deployable, communicates via gRPC and Kafka, and is orchestrated by Temporal workflows on Kubernetes with Dapr sidecar injection.
          </p>
          <FullImplementation />
        </div>
      </section>

      {/* ── GAP ANALYSIS ─────────────────────────────────────────────────── */}
      <GapAnalysis />

      {/* ── SINGAPORE COMPARISON ─────────────────────────────────────────── */}
      <SingaporeComparison />

      {/* ── DECLARATION SIMULATOR ────────────────────────────────────────── */}
      <DeclarationSimulator />

      {/* ── API PLAYGROUND ───────────────────────────────────────────────── */}
      <APIPlayground />

      {/* ── PHASE GANTT ──────────────────────────────────────────────────── */}
      <PhaseGantt />

      {/* ── HS CODE LOOKUP ───────────────────────────────────────────────── */}
      <HSCodeLookup />
      {/* ── OGA SLA DASHBOARD ────────────────────────────────────────────── */}
      <OGASLADashboard />
      {/* ── MOJALOOP PAYMENT FLOW DEMO ─────────────────────────────────── */}
      <MojaloopDemo />
      {/* ── TEMPORAL WORKFLOW TRACE ───────────────────────────────────── */}
      <TemporalWorkflow />
      {/* ── KUBERNETES RESOURCE MAP ──────────────────────────────────────── */}
      <KubernetesMap />
      {/* ── KEYCLOAK LOGIN FLOW ───────────────────────────────────────── */}
      <KeycloakLoginFlow />
      {/* ── COMPLIANCE SCORECARD ─────────────────────────────────────────── */}
      <ComplianceScorecard />
      {/* ── KUBECOST DRILL-DOWN ──────────────────────────────────────────── */}
      <KubecostDrilldown />
      {/* ── FLUVIO AIS STREAM ─────────────────────────────────────────────── */}
      <FluvioStreamPanel />
      {/* ── MULTI-AGENCY WORKFLOW ────────────────────────────────────────── */}
      <MultiAgencyWorkflow />
      {/* ── STAKEHOLDER ONBOARDING ───────────────────────────────────────── */}
      <StakeholderOnboarding />
      {/* ── PDF EXPORT ───────────────────────────────────────────────────── */}
      <PDFExport />
      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <footer className="py-12 bg-navy-950 border-t border-white/10">
        <div className="container max-w-6xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-start gap-8">
            <div>
              <div className="font-display text-xl font-bold text-gold mb-2">TradeGateway™ NGSWTP</div>
              <div className="text-sm text-slate-400 max-w-md">
                Next Generation Single Window Trade Platform — Revised Technical Specification v2.0.
                Synthesized from Singapore NTP, Ghana ICUMS, and Rwanda ReSW.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm">
              {[
                { label: "Mojaloop", url: "https://mojaloop.io/" },
                { label: "TigerBeetle", url: "https://tigerbeetle.com/" },
                { label: "Temporal", url: "https://temporal.io/" },
                { label: "Apache APISIX", url: "https://apisix.apache.org/" },
                { label: "OpenAppSec", url: "https://www.openappsec.io/" },
                { label: "Keycloak", url: "https://www.keycloak.org/" },
                { label: "OpenCTI", url: "https://www.opencti.io/" },
                { label: "Wazuh", url: "https://wazuh.com/" },
                { label: "Apache Sedona", url: "https://sedona.apache.org/" },
                { label: "Kubecost", url: "https://www.kubecost.com/" },
              ].map((link) => (
                <a
                  key={link.label}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-400 hover:text-gold transition-colors flex items-center gap-1"
                >
                  <ExternalLink size={10} /> {link.label}
                </a>
              ))}
            </div>
          </div>
          <div className="mt-8 pt-6 border-t border-white/5 text-xs text-slate-600 text-center">
            TradeGateway™ NGSWTP Revised Specification · Version 2.0 · March 2026 · Research: Singapore Customs NTP, Ghana GRA ICUMS, Rwanda RRA ReSW
          </div>
        </div>
      </footer>
    </div>
    </I18nProvider>
  );
}
