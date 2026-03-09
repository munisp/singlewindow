/**
 * TradeGateway™ NGSWTP — Production Landing Page
 * Design: Sovereign Blueprint — Deep Navy + Gold
 * Typography: Playfair Display (headings) + DM Sans (body)
 */
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getLoginUrl } from "@/const";
import { Link } from "wouter";
import {
  ArrowRight, BarChart3, CheckCircle, Clock, Globe,
  Lock, Network, Shield, ShieldCheck, Truck, Users,
  Zap, FileText, MapPin, CreditCard, BookOpen, Code2,
  ChevronRight, Star, Award
} from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const STATS = [
  { value: "< 4 hrs", label: "Fast-track clearance", sub: "vs 4.2 days pre-platform" },
  { value: "37+", label: "Agencies connected", sub: "Single submission point" },
  { value: "99.99%", label: "Platform uptime", sub: "SLA-backed availability" },
  { value: "5M+", label: "Declarations / year", sub: "At full capacity" },
];

const PORTALS = [
  {
    role: "Trader",
    href: "/app/trader",
    icon: Truck,
    accent: "from-blue-600 to-blue-700",
    border: "border-blue-500/30",
    glow: "hover:shadow-blue-500/20",
    description: "Submit declarations, track cargo, pay duties, and apply for AEO trusted trader status.",
    features: ["Step-by-step declaration wizard", "Real-time cargo tracking map", "Duty payment via Mojaloop", "AEO trusted trader programme"],
  },
  {
    role: "Customs Officer",
    href: "/app/customs",
    icon: ShieldCheck,
    accent: "from-purple-600 to-purple-700",
    border: "border-purple-500/30",
    glow: "hover:shadow-purple-500/20",
    description: "Review declarations, assess risk, conduct examinations, and issue clearance decisions.",
    features: ["AI-scored declaration queue", "Green / Yellow / Red lane assignment", "Examination workflow", "Post-clearance audit"],
  },
  {
    role: "Government Agency",
    href: "/app/oga",
    icon: Globe,
    accent: "from-amber-600 to-amber-700",
    border: "border-amber-500/30",
    glow: "hover:shadow-amber-500/20",
    description: "Review permits, approve licences, and participate in joint inspections with real-time updates.",
    features: ["Permit review queue", "Approve / reject / add conditions", "Joint inspection model", "Full audit trail"],
  },
  {
    role: "Administrator",
    href: "/app/admin",
    icon: Users,
    accent: "from-emerald-600 to-emerald-700",
    border: "border-emerald-500/30",
    glow: "hover:shadow-emerald-500/20",
    description: "Manage users, approve registrations, configure roles, and monitor platform activity.",
    features: ["Stakeholder onboarding approval", "Role & permission management", "System analytics dashboard", "Audit engine"],
  },
  {
    role: "Security Analyst",
    href: "/app/security",
    icon: Shield,
    accent: "from-red-600 to-red-700",
    border: "border-red-500/30",
    glow: "hover:shadow-red-500/20",
    description: "Monitor security alerts, screen entities against sanctions lists, and manage threat intelligence.",
    features: ["Real-time SIEM alert feed", "OFAC / UN / EU / OFSI screening", "Dual-use goods detection", "OpenCTI threat intelligence"],
  },
  {
    role: "Developer",
    href: "/app/developer",
    icon: Code2,
    accent: "from-slate-600 to-slate-700",
    border: "border-slate-500/30",
    glow: "hover:shadow-slate-500/20",
    description: "Access the OpenAPI spec, generate SDKs, manage API keys, and explore the developer sandbox.",
    features: ["Interactive API Explorer (54 endpoints)", "TypeScript & Python SDK generator", "Webhook management", "Sandbox environment"],
  },
];

const CAPABILITIES = [
  {
    icon: Clock,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    title: "Faster Clearance",
    desc: "Low-risk shipments are cleared in under 4 hours through the automated green lane, reducing port dwell time and storage costs.",
  },
  {
    icon: Shield,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    title: "Single Submission",
    desc: "Traders submit once. The platform automatically routes permits, licences, and certificates to all relevant agencies simultaneously.",
  },
  {
    icon: Network,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    title: "Full Cargo Visibility",
    desc: "Track every shipment from arrival to release. All parties see the same real-time status via live AIS vessel tracking.",
  },
  {
    icon: Lock,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    title: "Fraud Detection",
    desc: "AI risk scoring flags suspicious shipments before they reach the border, protecting government revenue and national security.",
  },
  {
    icon: CreditCard,
    color: "text-pink-400",
    bg: "bg-pink-400/10",
    title: "Integrated Payments",
    desc: "Duty payments via Mojaloop mobile money and bank transfer, with TigerBeetle financial ledger for tamper-proof accounting.",
  },
  {
    icon: BarChart3,
    color: "text-cyan-400",
    bg: "bg-cyan-400/10",
    title: "Advanced Analytics",
    desc: "Delta Lake + Apache Flink real-time analytics, trade flow visualisation, and compliance scorecards for all stakeholders.",
  },
];

const TECH_HIGHLIGHTS = [
  { name: "Apache APISIX", category: "API Gateway" },
  { name: "Keycloak", category: "Identity & Access" },
  { name: "Temporal", category: "Workflow Engine" },
  { name: "Mojaloop", category: "Payment Network" },
  { name: "TigerBeetle", category: "Financial Ledger" },
  { name: "Apache Kafka", category: "Event Streaming" },
  { name: "OpenCTI", category: "Threat Intelligence" },
  { name: "Wazuh SIEM", category: "Security Monitoring" },
  { name: "Delta Lake", category: "Analytics Engine" },
  { name: "Kubernetes", category: "Infrastructure" },
  { name: "OpenAppSec", category: "AI WAF" },
  { name: "Apache Sedona", category: "Geospatial" },
];

const REFERENCES = [
  { country: "🇸🇬", name: "Singapore NTP", stat: "< 10 min clearance", desc: "Networked Trade Platform — the gold standard for single-window trade facilitation." },
  { country: "🇬🇭", name: "Ghana ICUMS", stat: "1.1 day avg clearance", desc: "Integrated Customs Management System — UCR tracking and AEO programme." },
  { country: "🇷🇼", name: "Rwanda ReSW", stat: "28 agencies connected", desc: "Electronic Single Window — joint inspection model and mobile money payments." },
];

// ─── COMPONENT ───────────────────────────────────────────────────────────────

export default function Home() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── Navigation ── */}
      <nav className="border-b border-border/50 bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-[var(--color-gold)] to-amber-600 flex items-center justify-center shadow-lg">
                <Globe className="h-5 w-5 text-white" />
              </div>
              <div>
                <span className="font-bold text-base tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                  TradeGateway™
                </span>
                <span className="text-xs text-muted-foreground ml-1.5 hidden sm:inline">NGSWTP</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/specification">
                <Button variant="ghost" size="sm" className="text-muted-foreground hidden sm:flex gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" />
                  Specification
                </Button>
              </Link>
              {isAuthenticated ? (
                <Link href="/app/trader">
                  <Button size="sm" className="gap-1.5 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-semibold">
                    Dashboard <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="sm" className="gap-1.5 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-semibold">
                    Sign In <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </a>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden bg-[var(--color-navy)] text-white">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "linear-gradient(rgba(212,160,23,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(212,160,23,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-navy)] via-[var(--color-navy)] to-[oklch(0.22_0.06_250)]" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 lg:py-36">
          <div className="max-w-4xl">
            <Badge className="mb-6 bg-[var(--color-gold)]/20 text-[var(--color-gold)] border-[var(--color-gold)]/30 text-xs font-medium tracking-wider uppercase">
              Next-Generation Single Window Trade Platform
            </Badge>
            <h1
              className="text-5xl sm:text-6xl lg:text-7xl font-black leading-[1.05] tracking-tight mb-8"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Trade Clearance.{" "}
              <span className="text-[var(--color-gold)]">Reimagined.</span>
            </h1>
            <p className="text-xl text-white/70 leading-relaxed mb-10 max-w-2xl" style={{ fontFamily: "var(--font-body)" }}>
              TradeGateway™ NGSWTP is a sovereign, open-source national trade facilitation platform connecting traders, customs authorities, 37+ government agencies, and port operators on a single digital infrastructure.
            </p>
            <div className="flex flex-wrap gap-4">
              {isAuthenticated ? (
                <Link href="/app/trader">
                  <Button size="lg" className="gap-2 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-bold text-base px-8">
                    Go to Dashboard <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <a href={getLoginUrl()}>
                  <Button size="lg" className="gap-2 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-bold text-base px-8">
                    Get Started <ArrowRight className="h-4 w-4" />
                  </Button>
                </a>
              )}
              <Link href="/specification">
                <Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/10 text-base px-8">
                  <FileText className="h-4 w-4" />
                  Read Specification
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Diagonal divider */}
        <div className="relative h-20 overflow-hidden">
          <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="absolute bottom-0 w-full h-full">
            <path d="M0,80 L1440,0 L1440,80 Z" fill="hsl(var(--background))" />
          </svg>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="py-16 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <div key={s.label} className="text-center p-6 rounded-2xl border border-border/50 bg-card hover:border-[var(--color-gold)]/40 transition-colors">
                <div
                  className="text-4xl lg:text-5xl font-black text-[var(--color-gold)] mb-2"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {s.value}
                </div>
                <div className="font-semibold text-foreground text-sm mb-1">{s.label}</div>
                <div className="text-xs text-muted-foreground">{s.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Portal Access ── */}
      <section className="py-20 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Badge className="mb-4 text-xs tracking-wider uppercase" variant="outline">Access Portals</Badge>
            <h2
              className="text-4xl lg:text-5xl font-black text-foreground mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Built for Every Stakeholder
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              Six role-specific portals, each purpose-built for its users' workflows.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PORTALS.map((p) => {
              const Icon = p.icon;
              return (
                <Link key={p.role} href={p.href}>
                  <div className={`group relative p-6 rounded-2xl border ${p.border} bg-card hover:shadow-xl ${p.glow} transition-all duration-300 cursor-pointer h-full`}>
                    <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${p.accent} mb-4 shadow-lg`}>
                      <Icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="font-bold text-lg text-foreground mb-2 group-hover:text-[var(--color-gold)] transition-colors">
                      {p.role}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{p.description}</p>
                    <ul className="space-y-1.5">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <div className="absolute bottom-5 right-5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ChevronRight className="h-4 w-4 text-[var(--color-gold)]" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Core Capabilities ── */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <Badge className="mb-4 text-xs tracking-wider uppercase" variant="outline">Platform Capabilities</Badge>
              <h2
                className="text-4xl lg:text-5xl font-black text-foreground mb-6"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Everything a National Trade Platform Needs
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                From AI-powered risk scoring to real-time vessel tracking and mobile money payments — TradeGateway™ delivers the full stack of trade facilitation capabilities in a single, sovereign deployment.
              </p>
              <div className="flex flex-wrap gap-3">
                {["WCO Data Model v3.10", "ASEAN Single Window ready", "ISO 20022 payments", "OpenAPI 3.1 spec"].map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <div key={c.title} className="p-5 rounded-xl border border-border/50 bg-card hover:border-[var(--color-gold)]/30 transition-colors">
                    <div className={`inline-flex p-2.5 rounded-lg ${c.bg} mb-3`}>
                      <Icon className={`h-5 w-5 ${c.color}`} />
                    </div>
                    <h3 className="font-semibold text-sm text-foreground mb-1.5">{c.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Technology Stack ── */}
      <section className="py-20 bg-[var(--color-navy)] text-white relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage: "radial-gradient(circle at 2px 2px, rgba(212,160,23,0.8) 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Badge className="mb-4 text-xs tracking-wider uppercase bg-[var(--color-gold)]/20 text-[var(--color-gold)] border-[var(--color-gold)]/30">
              Open-Source Technology Stack
            </Badge>
            <h2
              className="text-4xl lg:text-5xl font-black mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Built on Proven Open Standards
            </h2>
            <p className="text-white/60 text-lg max-w-2xl mx-auto">
              No vendor lock-in. Every component is open-source, battle-tested, and deployable on sovereign infrastructure.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {TECH_HIGHLIGHTS.map((t) => (
              <div key={t.name} className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-[var(--color-gold)]/40 hover:bg-white/10 transition-all text-center">
                <div className="font-semibold text-sm text-white mb-1">{t.name}</div>
                <div className="text-xs text-white/40">{t.category}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Reference Implementations ── */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-14">
            <Badge className="mb-4 text-xs tracking-wider uppercase" variant="outline">
              <Star className="h-3 w-3 mr-1" />
              Reference Implementations
            </Badge>
            <h2
              className="text-4xl lg:text-5xl font-black text-foreground mb-4"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Lessons from Global Leaders
            </h2>
            <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
              TradeGateway™ synthesises best practices from three proven national single-window implementations.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {REFERENCES.map((r) => (
              <div key={r.name} className="p-6 rounded-2xl border border-border/50 bg-card hover:border-[var(--color-gold)]/40 transition-colors">
                <div className="text-4xl mb-4">{r.country}</div>
                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-bold text-foreground">{r.name}</h3>
                  <Badge className="text-xs bg-[var(--color-gold)]/10 text-[var(--color-gold)] border-[var(--color-gold)]/20">
                    {r.stat}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/specification">
              <Button variant="outline" className="gap-2">
                <BookOpen className="h-4 w-4" />
                Read the Full Technical Specification
                <ChevronRight className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Security & Compliance ── */}
      <section className="py-20 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-4">
              {[
                "Multi-factor authentication for all user roles",
                "Role-based access control — each user sees only what they need",
                "AI-powered web application firewall (OpenAppSec) blocks attacks in real time",
                "Continuous security monitoring via Wazuh SIEM/XDR",
                "OFAC, UN, EU, and OFSI sanctions screening on every entity",
                "mTLS encrypted communications between all system components",
                "WCO CEN Network integration for international intelligence sharing",
                "Full audit trail — every action logged with actor, timestamp, and IP",
              ].map((item) => (
                <div key={item} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border/50">
                  <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="text-sm text-foreground">{item}</span>
                </div>
              ))}
            </div>
            <div>
              <Badge className="mb-4 text-xs tracking-wider uppercase" variant="outline">
                <Award className="h-3 w-3 mr-1" />
                Security & Compliance
              </Badge>
              <h2
                className="text-4xl lg:text-5xl font-black text-foreground mb-6"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Sovereign Security by Design
              </h2>
              <p className="text-muted-foreground text-lg leading-relaxed mb-8">
                Built for national critical infrastructure. Every layer — from the API gateway to the financial ledger — is hardened against fraud, tampering, and external threats.
              </p>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { icon: Shield, label: "Zero-trust architecture" },
                  { icon: Lock, label: "End-to-end encryption" },
                  { icon: MapPin, label: "Sovereign data residency" },
                  { icon: Zap, label: "Real-time threat response" },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.label} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Icon className="h-4 w-4 text-[var(--color-gold)]" />
                      {item.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 bg-[var(--color-navy)] text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-navy)] via-[oklch(0.22_0.06_250)] to-[var(--color-navy)]" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2
            className="text-4xl lg:text-6xl font-black mb-6"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Ready to Transform{" "}
            <span className="text-[var(--color-gold)]">Trade Facilitation?</span>
          </h2>
          <p className="text-white/60 text-xl mb-10 max-w-2xl mx-auto">
            Join the platform connecting traders, customs authorities, and government agencies on a single, sovereign digital infrastructure.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            {isAuthenticated ? (
              <Link href="/app/trader">
                <Button size="lg" className="gap-2 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-bold text-base px-10">
                  Go to Dashboard <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <a href={getLoginUrl()}>
                <Button size="lg" className="gap-2 bg-[var(--color-gold)] hover:bg-[var(--color-gold-light)] text-[var(--color-navy)] font-bold text-base px-10">
                  Get Started Free <ArrowRight className="h-4 w-4" />
                </Button>
              </a>
            )}
            <Link href="/specification">
              <Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/10 text-base px-10">
                <FileText className="h-4 w-4" />
                Technical Specification
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/50 bg-background py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[var(--color-gold)] to-amber-600 flex items-center justify-center">
                <Globe className="h-4 w-4 text-white" />
              </div>
              <span className="font-bold text-sm" style={{ fontFamily: "var(--font-display)" }}>TradeGateway™ NGSWTP</span>
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <Link href="/specification"><span className="hover:text-foreground transition-colors cursor-pointer">Specification</span></Link>
              <Link href="/app/developer"><span className="hover:text-foreground transition-colors cursor-pointer">Developer Portal</span></Link>
              <span>Open Source · Sovereign Infrastructure</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
