/*
 * DESIGN PHILOSOPHY: Sovereign Blueprint
 * Deep navy authority (#0A1628) with gold accents (#D4A017)
 * Playfair Display headings, DM Sans body
 * Asymmetric layouts, diagonal dividers, large typographic numbers
 */

import { useState, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  Legend,
} from "recharts";
import {
  Shield,
  Database,
  Cpu,
  Globe,
  Layers,
  GitBranch,
  Lock,
  Zap,
  BarChart2,
  Map,
  ChevronDown,
  ExternalLink,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

// ─── Data ────────────────────────────────────────────────────────────────────

const HERO_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/hero_bg-GREBXbsHFNEh7iC9jMfapA.webp";
const ARCH_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/architecture_bg-nPK7UTPPBuxoJKx4H7HM6Z.webp";
const LAKE_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/lakehouse_bg-h3xiPrFSwHxL8XDAC9Zh3w.webp";
const SEC_BG = "https://d2xsxph8kpxj0f.cloudfront.net/310519663412555753/jXBmDbCKSCugxa7Gwg2VnA/security_bg-5cNnNsjL9WwvpXwSEt9Mxm.webp";

const kpiData = [
  { name: "Clearance Time", original: 72, revised: 4, unit: "hrs" },
  { name: "Physical Inspections", original: 50, revised: 5, unit: "%" },
  { name: "Paperless Rate", original: 60, revised: 100, unit: "%" },
  { name: "Revenue Uplift", original: 0, revised: 25, unit: "%" },
];

const radarData = [
  { subject: "Performance", original: 55, revised: 95 },
  { subject: "Security", original: 60, revised: 98 },
  { subject: "Scalability", original: 50, revised: 95 },
  { subject: "Interoperability", original: 45, revised: 92 },
  { subject: "Observability", original: 40, revised: 90 },
  { subject: "Cost Efficiency", original: 50, revised: 88 },
];

const techLayers = [
  {
    id: "presentation",
    label: "01 — Presentation Layer",
    color: "oklch(0.55 0.15 200)",
    colorClass: "bg-teal-600",
    icon: <Globe size={18} />,
    description: "Multi-channel access for every trader, officer, and system integrator.",
    techs: [
      { name: "Web Portal", detail: "React.js — responsive, WCAG 2.1 AA compliant" },
      { name: "Mobile Apps", detail: "React Native — iOS & Android" },
      { name: "REST/GraphQL API", detail: "OpenAPI 3.1 documented endpoints" },
      { name: "WhatsApp Bot", detail: "Status queries & simple declarations" },
      { name: "USSD *123#", detail: "Feature-phone access for rural traders" },
    ],
  },
  {
    id: "microservices",
    label: "02 — Microservices Layer",
    color: "oklch(0.65 0.12 150)",
    colorClass: "bg-emerald-600",
    icon: <Cpu size={18} />,
    description: "18 core services written in Go (high-performance) and Python (AI/ML), orchestrated via Dapr sidecars.",
    techs: [
      { name: "Go (Golang)", detail: "Core services: Declaration Engine, Payment Gateway, Cargo Tracking" },
      { name: "Python", detail: "AI/ML services: Risk Engine, OCR, HS Code NLP, Valuation Analytics" },
      { name: "Dapr", detail: "Sidecar runtime for state, pub/sub, service invocation & bindings" },
      { name: "Temporal", detail: "Durable execution engine for long-running workflows (approvals, audits)" },
    ],
  },
  {
    id: "integration",
    label: "03 — Integration Layer",
    color: "oklch(0.72 0.14 75)",
    colorClass: "bg-amber-500",
    icon: <GitBranch size={18} />,
    description: "Event-driven backbone connecting 37+ agencies, banks, and international systems.",
    techs: [
      { name: "Apache Kafka", detail: "High-throughput event bus for inter-service messaging" },
      { name: "Fluvio", detail: "Rust-powered real-time streaming for IoT cargo & AIS vessel feeds" },
      { name: "Apache APISIX", detail: "Cloud-native API gateway — routing, rate limiting, auth" },
      { name: "Mojaloop", detail: "Open-source payment interoperability hub connecting DFSPs & banks" },
      { name: "WCO Data Model v3.10", detail: "Canonical data model for all trade messages" },
      { name: "EDI Translation Engine", detail: "EDIFACT / X12 adapter for legacy OGA systems" },
    ],
  },
  {
    id: "data",
    label: "04 — Data Persistence Layer",
    color: "oklch(0.6 0.18 280)",
    colorClass: "bg-violet-600",
    icon: <Database size={18} />,
    description: "Purpose-built data stores for every workload type — transactional, financial, search, and cache.",
    techs: [
      { name: "PostgreSQL", detail: "Primary OLTP database for declarations, permits, and audit trails" },
      { name: "TigerBeetle", detail: "Mission-critical double-entry financial ledger — 10,000+ TPS" },
      { name: "Redis", detail: "High-speed caching, session management, and rate-limit counters" },
      { name: "OpenSearch", detail: "Full-text search across declarations, documents, and system logs" },
    ],
  },
  {
    id: "intelligence",
    label: "05 — Intelligence Layer",
    color: "oklch(0.7 0.16 30)",
    colorClass: "bg-orange-500",
    icon: <BarChart2 size={18} />,
    description: "AI-first risk management and advanced geospatial analytics powered by the Lakehouse architecture.",
    techs: [
      { name: "Delta Lake + Parquet", detail: "ACID-compliant lakehouse storage layer" },
      { name: "Apache Flink", detail: "Real-time stream processing for IoT & AIS geospatial data" },
      { name: "Apache Spark", detail: "Large-scale batch processing and ML model training" },
      { name: "Apache DataFusion", detail: "High-performance analytical query engine" },
      { name: "Ray", detail: "Distributed ML training and hyperparameter tuning" },
      { name: "Apache Sedona", detail: "Geospatial engine — geofencing, route deviation, spatial clustering" },
    ],
  },
  {
    id: "security",
    label: "06 — Security Layer",
    color: "oklch(0.55 0.2 15)",
    colorClass: "bg-rose-600",
    icon: <Shield size={18} />,
    description: "Zero-trust, defense-in-depth security architecture with ML-based threat detection.",
    techs: [
      { name: "Keycloak", detail: "Centralized IAM — SSO, OIDC/OAuth2, MFA, Identity Brokering" },
      { name: "OpenAppSec", detail: "ML-based WAF — OWASP Top 10 & zero-day API protection" },
      { name: "Wazuh", detail: "SIEM — security monitoring, threat detection, compliance" },
      { name: "OpenCTI", detail: "Cyber threat intelligence platform integrated with Wazuh" },
    ],
  },
  {
    id: "infrastructure",
    label: "07 — Infrastructure Layer",
    color: "oklch(0.5 0.02 240)",
    colorClass: "bg-slate-600",
    icon: <Layers size={18} />,
    description: "Cloud-native Kubernetes infrastructure with full cost visibility and GitOps delivery.",
    techs: [
      { name: "Kubernetes", detail: "Container orchestration — multi-region, active-active" },
      { name: "Kubecost", detail: "Real-time K8s cost allocation, visibility, and optimization" },
      { name: "Terraform IaC", detail: "Reproducible infrastructure provisioning" },
      { name: "GitOps CI/CD", detail: "ArgoCD / Flux for automated, auditable deployments" },
    ],
  },
];

const paymentStack = [
  { name: "Mojaloop", role: "Interoperability Hub", detail: "Connects all DFSPs, mobile money operators, and commercial banks via FSPIOP API. Enables inclusive real-time payments for SMEs and informal traders.", url: "https://mojaloop.io" },
  { name: "TigerBeetle", role: "Financial Ledger", detail: "Double-entry accounting database for mission-critical safety. Records every duty payment, drawback, and reconciliation with 10,000+ TPS throughput.", url: "https://tigerbeetle.com" },
];

const lakehouseComponents = [
  { name: "Delta Lake", role: "Storage Layer", color: "bg-blue-100 text-blue-800 border-blue-200", detail: "ACID transactions, schema evolution, time travel on Parquet files." },
  { name: "Apache Flink", role: "Stream Processing", color: "bg-orange-100 text-orange-800 border-orange-200", detail: "Real-time processing of IoT e-seal events and AIS vessel position streams." },
  { name: "Apache Spark", role: "Batch & ML", color: "bg-yellow-100 text-yellow-800 border-yellow-200", detail: "Large-scale data transformations and distributed ML model training." },
  { name: "Apache DataFusion", role: "Query Engine", color: "bg-green-100 text-green-800 border-green-200", detail: "High-performance Rust-based analytical query engine for ad-hoc analytics." },
  { name: "Ray", role: "Distributed ML", color: "bg-purple-100 text-purple-800 border-purple-200", detail: "Distributed hyperparameter tuning and model serving for risk scoring." },
  { name: "Apache Sedona", role: "Geospatial Engine", color: "bg-teal-100 text-teal-800 border-teal-200", detail: "Geofencing, route deviation detection, and spatial clustering of risk entities." },
];

const securityStack = [
  { name: "Keycloak", icon: <Lock size={20} />, role: "Identity & Access Management", detail: "Centralized SSO, OIDC/OAuth2, MFA, and Identity Brokering for all 37+ agencies and external partners." },
  { name: "OpenAppSec", icon: <Shield size={20} />, role: "ML-Based WAF & API Security", detail: "Machine learning engine providing preemptive protection against OWASP Top 10 and zero-day attacks on all APIs." },
  { name: "Wazuh", icon: <Zap size={20} />, role: "SIEM & Threat Detection", detail: "Comprehensive security monitoring, log analysis, intrusion detection, and compliance management (ISO 27001)." },
  { name: "OpenCTI", icon: <Globe size={20} />, role: "Cyber Threat Intelligence", detail: "Structured threat intelligence platform integrated with Wazuh to enable proactive defense against emerging threats." },
];

const processFlow = [
  { lane: "Trader", color: "bg-sky-600", steps: ["Submit Declaration + Upload Docs", "Receive URN Reference", "Pay Duties via Mojaloop", "Receive Clearance Permit"] },
  { lane: "AI Engine (Go/Python)", color: "bg-emerald-700", steps: ["OCR Extract Document Data", "Validate HS Code via BERT NLP", "Calculate Risk Score < 5 sec", "Assign Lane: GREEN / YELLOW / RED", "Auto-Route to Agencies via Temporal"] },
  { lane: "Customs Authority", color: "bg-navy", steps: ["Receive Declaration", "Green: Auto-Approve", "Yellow: Doc Review", "Red: Physical Inspection", "Issue Clearance"] },
  { lane: "37+ OGAs (via APISIX)", color: "bg-violet-700", steps: ["Parallel permit processing", "SLA-tracked approvals", "Digital certificate issuance"] },
  { lane: "Port Operator (via Kafka/Fluvio)", color: "bg-amber-600", steps: ["Real-time cargo tracking", "Gate pass generation", "AIS vessel feed integration"] },
];

const comparisonData = [
  { dimension: "Backend Language", original: "Java / Spring Boot", revised: "Go + Python" },
  { dimension: "API Gateway", original: "Kong", revised: "Apache APISIX" },
  { dimension: "Workflow Engine", original: "None specified", revised: "Temporal (Durable Execution)" },
  { dimension: "Service Mesh / Runtime", original: "None specified", revised: "Dapr (Sidecar Runtime)" },
  { dimension: "Payment Hub", original: "Custom integration", revised: "Mojaloop (Open-Source IIPS)" },
  { dimension: "Financial Ledger", original: "PostgreSQL only", revised: "TigerBeetle (10,000+ TPS)" },
  { dimension: "Event Streaming", original: "Apache Kafka / RabbitMQ", revised: "Kafka + Fluvio (IoT/real-time)" },
  { dimension: "Search", original: "Elasticsearch", revised: "OpenSearch" },
  { dimension: "Identity & Access", original: "Keycloak / Okta", revised: "Keycloak (open-source)" },
  { dimension: "WAF / API Security", original: "None specified", revised: "OpenAppSec (ML-based)" },
  { dimension: "SIEM", original: "Splunk / ELK Stack", revised: "Wazuh + OpenCTI" },
  { dimension: "Data Warehouse", original: "Snowflake / BigQuery", revised: "Lakehouse (Delta Lake + Parquet)" },
  { dimension: "Geospatial Analytics", original: "None specified", revised: "Apache Sedona + Flink + Spark" },
  { dimension: "Cost Management", original: "None specified", revised: "Kubecost (K8s cost visibility)" },
  { dimension: "Document Store", original: "MongoDB", revised: "PostgreSQL JSONB (unified)" },
];

// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedNumber({ target, suffix = "" }: { target: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const duration = 1500;
          const steps = 60;
          const increment = target / steps;
          let current = 0;
          const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
              setCount(target);
              clearInterval(timer);
            } else {
              setCount(Math.floor(current));
            }
          }, duration / steps);
        }
      },
      { threshold: 0.3 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);

  return <span ref={ref}>{count}{suffix}</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Home() {
  const [activeLayer, setActiveLayer] = useState<string | null>(null);
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setNavScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="min-h-screen" style={{ fontFamily: "var(--font-body)" }}>

      {/* ── Navigation ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${navScrolled ? "bg-[oklch(0.18_0.04_240)] shadow-lg" : "bg-transparent"}`}>
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[oklch(0.72_0.14_75)] flex items-center justify-center">
              <span className="text-[oklch(0.18_0.04_240)] font-bold text-sm" style={{ fontFamily: "var(--font-display)" }}>TG</span>
            </div>
            <span className="text-white font-semibold text-sm tracking-wide">TradeGateway™ NGSWTP</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            {["overview", "architecture", "payment", "lakehouse", "security", "comparison"].map(id => (
              <button key={id} onClick={() => scrollTo(id)} className="text-white/70 hover:text-[oklch(0.72_0.14_75)] text-sm capitalize transition-colors">
                {id === "lakehouse" ? "Lakehouse" : id.charAt(0).toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
          <a href="https://github.com/mojaloop" target="_blank" rel="noopener noreferrer"
            className="hidden md:flex items-center gap-2 text-[oklch(0.72_0.14_75)] border border-[oklch(0.72_0.14_75)] px-4 py-1.5 rounded text-sm hover:bg-[oklch(0.72_0.14_75)] hover:text-[oklch(0.18_0.04_240)] transition-all">
            <ExternalLink size={14} /> GitHub
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center overflow-hidden" style={{ background: "oklch(0.18 0.04 240)" }}>
        <div className="absolute inset-0">
          <img src={HERO_BG} alt="" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, oklch(0.18 0.04 240 / 0.95) 40%, oklch(0.18 0.04 240 / 0.6) 100%)" }} />
        </div>
        <div className="relative container py-32">
          <div className="max-w-3xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>
                Revised Specification v2.0 — March 2026
              </span>
            </div>
            <h1 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight" style={{ fontFamily: "var(--font-display)" }}>
              TradeGateway™
              <span className="block text-[oklch(0.72_0.14_75)]">NGSWTP</span>
            </h1>
            <p className="text-xl text-white/80 mb-4 leading-relaxed max-w-2xl" style={{ fontFamily: "var(--font-body)" }}>
              Next Generation Single Window Trade Platform — Revised Technical Specification replacing Java/Spring with a modern open-source stack built on Go, Python, Mojaloop, TigerBeetle, Temporal, Dapr, and a comprehensive Lakehouse architecture.
            </p>
            <div className="flex flex-wrap gap-3 mb-10">
              {["Go", "Python", "Mojaloop", "TigerBeetle", "Temporal", "Dapr", "APISIX", "Kubernetes"].map(t => (
                <span key={t} className="tech-badge text-[oklch(0.72_0.14_75)] border-[oklch(0.72_0.14_75)/40] bg-[oklch(0.72_0.14_75)/10]">
                  {t}
                </span>
              ))}
            </div>
            <div className="flex gap-4">
              <button onClick={() => scrollTo("architecture")}
                className="flex items-center gap-2 bg-[oklch(0.72_0.14_75)] text-[oklch(0.18_0.04_240)] px-6 py-3 rounded font-semibold hover:bg-[oklch(0.82_0.12_75)] transition-all">
                Explore Architecture <ArrowRight size={16} />
              </button>
              <button onClick={() => scrollTo("comparison")}
                className="flex items-center gap-2 border border-white/30 text-white px-6 py-3 rounded font-semibold hover:border-white/60 transition-all">
                View Stack Comparison
              </button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/40 animate-bounce">
          <ChevronDown size={24} />
        </div>
      </section>

      {/* ── KPI Stats ── */}
      <section id="overview" className="py-20 bg-white">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
            {[
              { value: 4, suffix: " hrs", label: "Target Clearance Time", sub: "Down from 72 hours" },
              { value: 5, suffix: "%", label: "Physical Inspections", sub: "Down from 50%+ manual" },
              { value: 100, suffix: "%", label: "Paperless Operations", sub: "Full digital ecosystem" },
              { value: 25, suffix: "%", label: "Revenue Uplift Target", sub: "Via automated controls" },
            ].map((stat, i) => (
              <div key={i} className="text-center">
                <div className="stat-number text-5xl md:text-6xl mb-2">
                  <AnimatedNumber target={stat.value} suffix={stat.suffix} />
                </div>
                <div className="font-semibold text-[oklch(0.18_0.04_240)] mb-1">{stat.label}</div>
                <div className="text-sm text-[oklch(0.5_0.02_240)]">{stat.sub}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="layer-card p-6 rounded-lg">
              <h3 className="font-display text-xl font-bold text-[oklch(0.18_0.04_240)] mb-4" style={{ fontFamily: "var(--font-display)" }}>
                Performance Comparison: Original vs. Revised Stack
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={kpiData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.88 0.01 240)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: "var(--font-body)" }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => [`${v}`, n === "original" ? "Original Stack" : "Revised Stack"]} />
                  <Legend formatter={(v) => v === "original" ? "Original Stack" : "Revised Stack"} />
                  <Bar dataKey="original" fill="oklch(0.7 0.05 240)" radius={[4, 4, 0, 0]} name="original" />
                  <Bar dataKey="revised" fill="oklch(0.72 0.14 75)" radius={[4, 4, 0, 0]} name="revised" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="layer-card p-6 rounded-lg">
              <h3 className="font-display text-xl font-bold text-[oklch(0.18_0.04_240)] mb-4" style={{ fontFamily: "var(--font-display)" }}>
                Architecture Quality Dimensions
              </h3>
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="oklch(0.88 0.01 240)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11, fontFamily: "var(--font-body)" }} />
                  <Radar name="Original" dataKey="original" stroke="oklch(0.7 0.05 240)" fill="oklch(0.7 0.05 240)" fillOpacity={0.3} />
                  <Radar name="Revised" dataKey="revised" stroke="oklch(0.72 0.14 75)" fill="oklch(0.72 0.14 75)" fillOpacity={0.35} />
                  <Legend />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* ── Architecture Layers ── */}
      <section id="architecture" className="py-20 relative overflow-hidden" style={{ background: "oklch(0.18 0.04 240)" }}>
        <div className="absolute inset-0">
          <img src={ARCH_BG} alt="" className="w-full h-full object-cover opacity-15" />
        </div>
        <div className="relative container">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Technical Architecture</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              7-Layer Cloud-Native Architecture
            </h2>
            <p className="text-white/60 mt-3 max-w-2xl">Click any layer to explore the technology choices and their rationale.</p>
          </div>

          <div className="space-y-3">
            {techLayers.map((layer, idx) => (
              <div key={layer.id}
                className={`rounded-lg border transition-all duration-300 cursor-pointer overflow-hidden ${activeLayer === layer.id ? "border-[oklch(0.72_0.14_75)]" : "border-white/10 hover:border-white/30"}`}
                style={{ background: activeLayer === layer.id ? "oklch(0.24 0.04 240)" : "oklch(0.22 0.04 240 / 0.6)" }}
                onClick={() => setActiveLayer(activeLayer === layer.id ? null : layer.id)}>
                <div className="flex items-center gap-4 p-4">
                  <div className="w-8 h-8 rounded flex items-center justify-center text-white flex-shrink-0"
                    style={{ background: layer.color }}>
                    {layer.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-white font-semibold">{layer.label}</span>
                      <div className="flex flex-wrap gap-1.5 hidden md:flex">
                        {layer.techs.slice(0, 3).map(t => (
                          <span key={t.name} className="tech-badge text-white/60 border-white/20 text-xs">{t.name}</span>
                        ))}
                        {layer.techs.length > 3 && (
                          <span className="tech-badge text-white/40 border-white/10 text-xs">+{layer.techs.length - 3} more</span>
                        )}
                      </div>
                    </div>
                    <p className="text-white/50 text-sm mt-0.5 truncate">{layer.description}</p>
                  </div>
                  <ChevronDown size={16} className={`text-white/40 transition-transform flex-shrink-0 ${activeLayer === layer.id ? "rotate-180" : ""}`} />
                </div>
                {activeLayer === layer.id && (
                  <div className="px-4 pb-4 border-t border-white/10 pt-4">
                    <div className="grid md:grid-cols-2 gap-3">
                      {layer.techs.map(tech => (
                        <div key={tech.name} className="flex gap-3 p-3 rounded" style={{ background: "oklch(0.18 0.04 240 / 0.6)" }}>
                          <CheckCircle2 size={16} className="text-[oklch(0.72_0.14_75)] mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="text-white font-medium text-sm">{tech.name}</div>
                            <div className="text-white/50 text-xs mt-0.5">{tech.detail}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Process Flow ── */}
      <section className="py-20 bg-white">
        <div className="container">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Declaration Process</span>
            </div>
            <h2 className="text-4xl font-black text-[oklch(0.18_0.04_240)]" style={{ fontFamily: "var(--font-display)" }}>
              End-to-End Flow: Submission to Clearance in Under 4 Hours
            </h2>
          </div>
          <div className="space-y-4">
            {processFlow.map((lane, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className={`${lane.color} text-white text-xs font-bold px-3 py-2 rounded flex-shrink-0 w-44 text-center leading-tight`}>
                  {lane.lane}
                </div>
                <div className="flex-1 flex flex-wrap gap-2 items-center">
                  {lane.steps.map((step, j) => (
                    <div key={j} className="flex items-center gap-2">
                      <div className="layer-card px-3 py-2 rounded text-sm text-[oklch(0.18_0.04_240)] font-medium bg-white border border-[oklch(0.88_0.01_240)]">
                        {step}
                      </div>
                      {j < lane.steps.length - 1 && <ArrowRight size={14} className="text-[oklch(0.72_0.14_75)] flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Payment & Financial ── */}
      <section id="payment" className="py-20" style={{ background: "oklch(0.96 0.005 240)" }}>
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
                <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Financial Stack</span>
              </div>
              <h2 className="text-4xl font-black text-[oklch(0.18_0.04_240)] mb-6" style={{ fontFamily: "var(--font-display)" }}>
                Inclusive Payments via Mojaloop & TigerBeetle
              </h2>
              <p className="text-[oklch(0.4_0.02_240)] leading-relaxed mb-8">
                The original specification relied on custom payment integrations with no standardized interoperability layer. The revised architecture introduces <strong>Mojaloop</strong> — the open-source Inclusive Instant Payment System (IIPS) used by central banks across Africa — as the payment hub, with <strong>TigerBeetle</strong> as the ultra-high-performance double-entry financial ledger recording every transaction with mission-critical safety guarantees.
              </p>
              <div className="space-y-4">
                {paymentStack.map(item => (
                  <div key={item.name} className="layer-card p-5 rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-bold text-[oklch(0.18_0.04_240)]" style={{ fontFamily: "var(--font-display)" }}>{item.name}</span>
                        <span className="ml-2 text-xs text-[oklch(0.72_0.14_75)] font-medium uppercase tracking-wide" style={{ fontFamily: "var(--font-mono)" }}>{item.role}</span>
                      </div>
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[oklch(0.72_0.14_75)] hover:opacity-70">
                        <ExternalLink size={14} />
                      </a>
                    </div>
                    <p className="text-sm text-[oklch(0.5_0.02_240)]">{item.detail}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <div className="rounded-xl overflow-hidden shadow-xl">
                <div className="p-6" style={{ background: "oklch(0.18 0.04 240)" }}>
                  <h3 className="text-white font-bold mb-4" style={{ fontFamily: "var(--font-display)" }}>Payment Flow Architecture</h3>
                  <div className="space-y-3">
                    {[
                      { label: "Trader / Mobile Money", arrow: "→", target: "Mojaloop FSPIOP API" },
                      { label: "Mojaloop Hub", arrow: "→", target: "24+ Commercial Banks" },
                      { label: "Payment Confirmed", arrow: "→", target: "TigerBeetle Ledger" },
                      { label: "Duty Reconciled", arrow: "→", target: "Clearance Issued" },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <span className="text-white/70 flex-1">{row.label}</span>
                        <span className="text-[oklch(0.72_0.14_75)]">{row.arrow}</span>
                        <span className="text-white flex-1">{row.target}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="p-4 bg-[oklch(0.72_0.14_75)]">
                  <div className="flex items-center justify-between text-[oklch(0.18_0.04_240)]">
                    <span className="font-bold">TigerBeetle Throughput</span>
                    <span className="font-mono font-bold text-lg">10,000+ TPS</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[
                  { v: "24+", l: "Banks Connected" },
                  { v: "0", l: "Data Loss (RPO)" },
                  { v: "30s", l: "Failover RTO" },
                ].map((s, i) => (
                  <div key={i} className="layer-card p-4 rounded-lg">
                    <div className="stat-number text-2xl">{s.v}</div>
                    <div className="text-xs text-[oklch(0.5_0.02_240)] mt-1">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Lakehouse Architecture ── */}
      <section id="lakehouse" className="py-20 relative overflow-hidden" style={{ background: "oklch(0.18 0.04 240)" }}>
        <div className="absolute inset-0">
          <img src={LAKE_BG} alt="" className="w-full h-full object-cover opacity-20" />
          <div className="absolute inset-0" style={{ background: "oklch(0.18 0.04 240 / 0.85)" }} />
        </div>
        <div className="relative container">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Data Platform</span>
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4" style={{ fontFamily: "var(--font-display)" }}>
              Lakehouse Architecture for Geospatial Analytics
            </h2>
            <p className="text-white/60 max-w-3xl leading-relaxed">
              The original specification relied on Snowflake or BigQuery as a data warehouse with no geospatial capabilities. The revised architecture introduces a comprehensive open-source Lakehouse that integrates Delta Lake, Parquet, Apache Flink, Apache Spark, Apache DataFusion, Ray, and Apache Sedona to create a unified data platform for advanced geospatial analytics — enabling real-time cargo tracking, route deviation detection, and spatial risk clustering.
            </p>
          </div>

          {/* Lakehouse diagram */}
          <div className="mb-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg p-5 border border-white/10" style={{ background: "oklch(0.22 0.04 240 / 0.8)" }}>
                <div className="text-[oklch(0.72_0.14_75)] text-xs font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)" }}>Ingestion</div>
                <div className="space-y-2">
                  {["Kafka (batch events)", "Fluvio (IoT streams)", "AIS vessel feeds", "OGA API webhooks"].map(s => (
                    <div key={s} className="flex items-center gap-2 text-white/70 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.14_75)]" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg p-5 border border-[oklch(0.72_0.14_75)/50]" style={{ background: "oklch(0.22 0.04 240 / 0.8)" }}>
                <div className="text-[oklch(0.72_0.14_75)] text-xs font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)" }}>Storage (Delta Lake)</div>
                <div className="space-y-2">
                  {["Bronze: Raw Parquet", "Silver: Cleaned & enriched", "Gold: Aggregated analytics", "ACID transactions + time travel"].map(s => (
                    <div key={s} className="flex items-center gap-2 text-white/70 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.14_75)]" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg p-5 border border-white/10" style={{ background: "oklch(0.22 0.04 240 / 0.8)" }}>
                <div className="text-[oklch(0.72_0.14_75)] text-xs font-bold uppercase tracking-widest mb-3" style={{ fontFamily: "var(--font-mono)" }}>Serving</div>
                <div className="space-y-2">
                  {["DataFusion SQL queries", "Spark ML model serving", "Ray distributed inference", "Sedona geospatial APIs"].map(s => (
                    <div key={s} className="flex items-center gap-2 text-white/70 text-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-[oklch(0.72_0.14_75)]" />
                      {s}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {lakehouseComponents.map(comp => (
              <div key={comp.name} className="layer-card p-5 rounded-lg bg-white">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold text-[oklch(0.18_0.04_240)]" style={{ fontFamily: "var(--font-display)" }}>{comp.name}</span>
                  <span className={`tech-badge text-xs ${comp.color}`}>{comp.role}</span>
                </div>
                <p className="text-sm text-[oklch(0.5_0.02_240)]">{comp.detail}</p>
              </div>
            ))}
          </div>

          {/* Geospatial use cases */}
          <div className="mt-10 rounded-xl p-6 border border-[oklch(0.72_0.14_75)/30]" style={{ background: "oklch(0.22 0.04 240 / 0.6)" }}>
            <div className="flex items-center gap-3 mb-4">
              <Map size={20} className="text-[oklch(0.72_0.14_75)]" />
              <h3 className="text-white font-bold" style={{ fontFamily: "var(--font-display)" }}>Geospatial Analytics Use Cases (Apache Sedona)</h3>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { title: "Geofencing", desc: "Real-time alerts when transit cargo deviates from approved geo-corridors." },
                { title: "Route Deviation", desc: "Flink + Sedona detect unauthorized route changes from GPS e-seal streams." },
                { title: "Spatial Risk Clustering", desc: "Identify geographic clusters of high-risk importers and suppliers." },
                { title: "Port Congestion Analytics", desc: "Spatial analysis of cargo dwell times and terminal throughput." },
              ].map(uc => (
                <div key={uc.title} className="p-4 rounded-lg" style={{ background: "oklch(0.18 0.04 240 / 0.5)" }}>
                  <div className="text-[oklch(0.72_0.14_75)] font-semibold text-sm mb-2">{uc.title}</div>
                  <div className="text-white/60 text-xs">{uc.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Security Architecture ── */}
      <section id="security" className="py-20 relative overflow-hidden bg-white">
        <div className="container">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
                <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Security Architecture</span>
              </div>
              <h2 className="text-4xl font-black text-[oklch(0.18_0.04_240)] mb-6" style={{ fontFamily: "var(--font-display)" }}>
                Zero-Trust Defense-in-Depth
              </h2>
              <p className="text-[oklch(0.4_0.02_240)] leading-relaxed mb-8">
                The revised specification replaces Splunk/ELK with a fully open-source security stack. Keycloak provides centralized identity management, OpenAppSec delivers ML-based WAF protection, Wazuh handles SIEM and compliance, and OpenCTI provides structured threat intelligence — all integrated into a cohesive zero-trust architecture.
              </p>
              <div className="space-y-4">
                {securityStack.map(item => (
                  <div key={item.name} className="layer-card p-4 rounded-lg flex gap-4">
                    <div className="w-10 h-10 rounded bg-[oklch(0.18_0.04_240)] flex items-center justify-center text-[oklch(0.72_0.14_75)] flex-shrink-0">
                      {item.icon}
                    </div>
                    <div>
                      <div className="font-bold text-[oklch(0.18_0.04_240)]">{item.name}
                        <span className="ml-2 text-xs text-[oklch(0.5_0.02_240)] font-normal">{item.role}</span>
                      </div>
                      <p className="text-sm text-[oklch(0.5_0.02_240)] mt-1">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="relative">
              <img src={SEC_BG} alt="Security Architecture" className="rounded-xl shadow-2xl w-full" />
              <div className="absolute inset-0 rounded-xl" style={{ background: "linear-gradient(to top, oklch(0.18 0.04 240 / 0.6), transparent)" }} />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "AES-256", sub: "Data at rest" },
                    { label: "TLS 1.3", sub: "Data in transit" },
                    { label: "MFA + OIDC", sub: "All user access" },
                    { label: "ISO 27001", sub: "Compliance target" },
                  ].map(s => (
                    <div key={s.label} className="bg-white/10 backdrop-blur rounded-lg p-3 text-center">
                      <div className="text-white font-bold text-sm">{s.label}</div>
                      <div className="text-white/60 text-xs">{s.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stack Comparison ── */}
      <section id="comparison" className="py-20" style={{ background: "oklch(0.96 0.005 240)" }}>
        <div className="container">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Technology Comparison</span>
            </div>
            <h2 className="text-4xl font-black text-[oklch(0.18_0.04_240)]" style={{ fontFamily: "var(--font-display)" }}>
              Original vs. Revised Technology Stack
            </h2>
            <p className="text-[oklch(0.5_0.02_240)] mt-3">A complete mapping of every replaced technology and the rationale for each change.</p>
          </div>

          <div className="overflow-x-auto rounded-xl shadow-sm border border-[oklch(0.88_0.01_240)]">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "oklch(0.18 0.04 240)" }}>
                  <th className="text-left px-5 py-4 text-white/60 font-medium" style={{ fontFamily: "var(--font-mono)" }}>Dimension</th>
                  <th className="text-left px-5 py-4 text-white/60 font-medium" style={{ fontFamily: "var(--font-mono)" }}>Original Specification</th>
                  <th className="text-left px-5 py-4 text-[oklch(0.72_0.14_75)] font-medium" style={{ fontFamily: "var(--font-mono)" }}>Revised Specification</th>
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-[oklch(0.97_0.003_240)]"}>
                    <td className="px-5 py-3 font-medium text-[oklch(0.18_0.04_240)]">{row.dimension}</td>
                    <td className="px-5 py-3 text-[oklch(0.5_0.02_240)]">
                      <span className="line-through opacity-60">{row.original}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="font-semibold text-[oklch(0.18_0.04_240)]">{row.revised}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Implementation Roadmap ── */}
      <section className="py-20" style={{ background: "oklch(0.18 0.04 240)" }}>
        <div className="container">
          <div className="mb-12">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-px w-12 bg-[oklch(0.72_0.14_75)]" />
              <span className="text-[oklch(0.72_0.14_75)] text-sm font-medium tracking-widest uppercase" style={{ fontFamily: "var(--font-mono)" }}>Implementation</span>
            </div>
            <h2 className="text-4xl font-black text-white" style={{ fontFamily: "var(--font-display)" }}>
              24-Month Implementation Roadmap
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                phase: "Phase 1", period: "Months 1–8", title: "Foundation",
                items: ["Kubernetes cluster setup + Kubecost", "Go microservices: Declaration Engine", "APISIX API Gateway + Keycloak IAM", "PostgreSQL + Redis + OpenSearch", "Basic Kafka event bus", "Web Portal MVP launch"],
                color: "oklch(0.55 0.15 200)"
              },
              {
                phase: "Phase 2", period: "Months 9–16", title: "Intelligence",
                items: ["Python AI Risk Engine (< 5s scoring)", "Mojaloop + TigerBeetle financial stack", "Temporal workflow engine for approvals", "Wazuh SIEM + OpenCTI integration", "Mobile Apps (iOS/Android)", "37+ OGA integrations via Dapr"],
                color: "oklch(0.72 0.14 75)"
              },
              {
                phase: "Phase 3", period: "Months 17–24", title: "Ecosystem",
                items: ["Lakehouse: Delta Lake + Flink + Spark", "Apache Sedona geospatial analytics", "Ray distributed ML training", "Fluvio IoT streaming for e-seals", "Cross-border interoperability", "Open API Marketplace"],
                color: "oklch(0.65 0.12 150)"
              },
            ].map(ph => (
              <div key={ph.phase} className="rounded-xl p-6 border border-white/10" style={{ background: "oklch(0.22 0.04 240 / 0.6)" }}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: ph.color, fontFamily: "var(--font-mono)" }}>{ph.phase}</div>
                    <div className="text-white font-black text-xl" style={{ fontFamily: "var(--font-display)" }}>{ph.title}</div>
                    <div className="text-white/40 text-xs mt-0.5">{ph.period}</div>
                  </div>
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-[oklch(0.18_0.04_240)] font-black text-lg" style={{ background: ph.color, fontFamily: "var(--font-display)" }}>
                    {ph.phase.replace("Phase ", "")}
                  </div>
                </div>
                <div className="space-y-2">
                  {ph.items.map(item => (
                    <div key={item} className="flex items-start gap-2 text-white/70 text-sm">
                      <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" style={{ color: ph.color }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="py-10 border-t border-white/10" style={{ background: "oklch(0.14 0.04 240)" }}>
        <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded bg-[oklch(0.72_0.14_75)] flex items-center justify-center">
              <span className="text-[oklch(0.18_0.04_240)] font-bold text-xs" style={{ fontFamily: "var(--font-display)" }}>TG</span>
            </div>
            <span className="text-white/60 text-sm">TradeGateway™ NGSWTP — Revised Specification v2.0</span>
          </div>
          <div className="flex items-center gap-6 text-white/40 text-xs">
            <a href="https://mojaloop.io" target="_blank" rel="noopener noreferrer" className="hover:text-[oklch(0.72_0.14_75)] transition-colors">Mojaloop</a>
            <a href="https://tigerbeetle.com" target="_blank" rel="noopener noreferrer" className="hover:text-[oklch(0.72_0.14_75)] transition-colors">TigerBeetle</a>
            <a href="https://github.com/mojaloop" target="_blank" rel="noopener noreferrer" className="hover:text-[oklch(0.72_0.14_75)] transition-colors">GitHub</a>
            <span>Document ID: NGSW-SPEC-2026-V2.0</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
