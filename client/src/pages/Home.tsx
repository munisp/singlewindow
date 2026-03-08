import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Globe,
  Lock,
  Network,
  Shield,
  ShieldCheck,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "wouter";

const PORTALS = [
  {
    role: "Trader",
    href: "/app/trader",
    icon: <Truck className="h-6 w-6" />,
    color: "bg-blue-600",
    description: "Submit declarations, track shipments, manage payments, and apply for AEO certification.",
    features: ["Multi-step declaration form", "Document upload (S3)", "Duty payment via Mojaloop", "AEO application workflow"],
  },
  {
    role: "Customs Officer",
    href: "/app/customs",
    icon: <ShieldCheck className="h-6 w-6" />,
    color: "bg-purple-600",
    description: "Review declarations, apply AI risk scoring, conduct examinations, and issue clearances.",
    features: ["AI risk score dashboard", "Green/Yellow/Red lane assignment", "Examination workflow", "Release & hold actions"],
  },
  {
    role: "OGA Officer",
    href: "/app/oga",
    icon: <Globe className="h-6 w-6" />,
    color: "bg-amber-600",
    description: "Review and approve permits for your agency. Joint inspection model with real-time notifications.",
    features: ["Permit review queue", "Approve / reject / conditional", "Agency-specific workflows", "Audit trail"],
  },
  {
    role: "Administrator",
    href: "/app/admin",
    icon: <Users className="h-6 w-6" />,
    color: "bg-emerald-600",
    description: "Manage users, approve stakeholder registrations, configure roles, and monitor platform health.",
    features: ["Stakeholder onboarding approval", "User role management", "Profile verification", "System audit log"],
  },
  {
    role: "Security Analyst",
    href: "/app/security",
    icon: <Shield className="h-6 w-6" />,
    color: "bg-red-600",
    description: "Monitor SIEM alerts from Wazuh, screen entities against sanctions lists, and manage threat intelligence.",
    features: ["Real-time alert feed", "OFAC / UN / EU / OFSI screening", "Dual-use goods detection", "Risk explainability"],
  },
];

const STATS = [
  { value: "< 4 hrs", label: "Green-lane clearance", icon: <Zap className="h-5 w-5" /> },
  { value: "37+", label: "OGAs connected", icon: <Network className="h-5 w-5" /> },
  { value: "99.99%", label: "Uptime SLA", icon: <BarChart3 className="h-5 w-5" /> },
  { value: "5M+", label: "Annual declarations", icon: <Globe className="h-5 w-5" /> },
];

const TECH_STACK = [
  { tier: "Go", role: "Business microservices", items: ["declaration-service", "oga-service", "payment-service", "profile-service"] },
  { tier: "Python", role: "AI/ML engines", items: ["risk-engine (GNN + scikit-learn)", "sanctions-screener (LLM)", "fluvio-consumer (AIS streams)"] },
  { tier: "Rust", role: "Performance engines", items: ["rule-engine (200 customs rules)", "tigerbeetle-bridge (ledger)", "document-parser (HS extraction)"] },
  { tier: "Node.js", role: "API gateway + UI", items: ["tRPC gateway", "React 19 + Tailwind 4", "PostgreSQL via Drizzle ORM"] },
];

export default function Home() {
  const { user, isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
                <Globe className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-lg tracking-tight">TradeGateway™ NGSWTP</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/specification">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                  Architecture Spec
                </Button>
              </Link>
              {isAuthenticated ? (
                <Link href="/app/trader">
                  <Button size="sm" className="gap-2">
                    Open Portal <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <Button size="sm" onClick={() => window.location.href = getLoginUrl()} className="gap-2">
                  Sign In <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 text-white">
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: "linear-gradient(rgba(99,102,241,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-300 text-xs font-medium mb-6">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
              Production-Ready · PostgreSQL · Go · Python · Rust · gRPC
            </div>
            <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
              Next Generation<br />
              <span className="text-blue-400">Single Window</span><br />
              Trade Platform
            </h1>
            <p className="text-xl text-slate-300 mb-8 leading-relaxed max-w-2xl">
              A polyglot microservices platform for national customs clearance — synthesized from Singapore NTP, Ghana ICUMS, and Rwanda ReSW, built on Go, Python, Rust, Kafka, Temporal, and Dapr.
            </p>
            <div className="flex flex-wrap gap-4">
              {isAuthenticated ? (
                <Link href="/app/trader">
                  <Button size="lg" className="gap-2 bg-blue-500 hover:bg-blue-400 text-white">
                    Open Your Portal <ArrowRight className="h-5 w-5" />
                  </Button>
                </Link>
              ) : (
                <Button
                  size="lg"
                  className="gap-2 bg-blue-500 hover:bg-blue-400 text-white"
                  onClick={() => window.location.href = getLoginUrl()}
                >
                  Get Started <ArrowRight className="h-5 w-5" />
                </Button>
              )}
              <Link href="/specification">
                <Button size="lg" variant="outline" className="gap-2 border-white/20 text-white hover:bg-white/10 bg-transparent">
                  View Architecture Spec
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="relative border-t border-white/10 bg-white/5">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              {STATS.map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-300 shrink-0">
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{s.value}</p>
                    <p className="text-xs text-slate-400">{s.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Portal cards */}
      <section className="py-20 bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">Five Role-Based Portals</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Each stakeholder group has a dedicated authenticated workspace with real backend data flows, PostgreSQL persistence, and role-based access control.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {PORTALS.map((portal) => (
              <Card key={portal.role} className="group hover:shadow-lg transition-all duration-200 border hover:border-primary/30">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4 mb-4">
                    <div className={`h-12 w-12 rounded-xl ${portal.color} flex items-center justify-center text-white shrink-0`}>
                      {portal.icon}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg">{portal.role} Portal</h3>
                      <p className="text-sm text-muted-foreground leading-snug">{portal.description}</p>
                    </div>
                  </div>
                  <ul className="space-y-1.5 mb-5">
                    {portal.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link href={portal.href}>
                    <Button variant="outline" size="sm" className="w-full gap-2 group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                      Open Portal <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Tech stack */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">Polyglot Microservices Architecture</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Each service tier is implemented in the language best suited to its workload — Go for throughput, Python for AI/ML, Rust for deterministic performance.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {TECH_STACK.map((tier) => (
              <Card key={tier.tier} className="border">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="font-mono font-bold text-primary text-lg">{tier.tier}</span>
                    <span className="text-xs text-muted-foreground">{tier.role}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {tier.items.map((item) => (
                      <li key={item} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <span className="text-primary mt-0.5">›</span>
                        {item}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Middleware section */}
      <section className="py-16 bg-muted/30 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold mb-8 text-center">Integrated Middleware Stack</h2>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              "Apache Kafka", "Redis", "Dapr", "Temporal", "Keycloak",
              "APISIX", "TigerBeetle", "Fluvio", "Permify", "Delta Lake",
              "Wazuh SIEM", "OpenCTI", "Mojaloop", "gRPC", "PostgreSQL",
              "MinIO S3", "Prometheus", "Grafana", "OpenAppSec WAF",
            ].map((tech) => (
              <span
                key={tech}
                className="px-3 py-1.5 rounded-full text-sm font-medium bg-background border border-border text-foreground"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Security section */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">Zero-Trust Security Architecture</h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                A national trade platform is a high-value target. The security architecture implements defence-in-depth with Keycloak IAM, OpenAppSec AI WAF, Wazuh SIEM/XDR, and OpenCTI threat intelligence — all integrated into the real-time Security Operations Center portal.
              </p>
              <ul className="space-y-3">
                {[
                  "Keycloak OIDC/SAML with MFA (TOTP + WebAuthn)",
                  "RBAC + ABAC via Permify authorization engine",
                  "OpenAppSec ML-based WAF — zero-day blocking",
                  "Wazuh real-time SIEM with automated response",
                  "OFAC / UN / EU / OFSI sanctions screening",
                  "mTLS between all microservices via Dapr",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { tool: "Keycloak", role: "Identity & Access", color: "bg-blue-50 border-blue-200" },
                { tool: "OpenAppSec", role: "AI WAF", color: "bg-emerald-50 border-emerald-200" },
                { tool: "Wazuh", role: "SIEM / XDR", color: "bg-red-50 border-red-200" },
                { tool: "OpenCTI", role: "Threat Intel", color: "bg-purple-50 border-purple-200" },
                { tool: "Permify", role: "Authorization", color: "bg-amber-50 border-amber-200" },
                { tool: "TigerBeetle", role: "Financial Ledger", color: "bg-slate-50 border-slate-200" },
              ].map((item) => (
                <div key={item.tool} className={`p-4 rounded-xl border ${item.color}`}>
                  <p className="font-semibold text-sm">{item.tool}</p>
                  <p className="text-xs text-muted-foreground">{item.role}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-r from-blue-600 to-blue-700 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold mb-4">Ready to explore the platform?</h2>
          <p className="text-blue-100 mb-8 max-w-xl mx-auto">
            Sign in to access your role-based portal, or browse the full architecture specification.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            {isAuthenticated ? (
              <Link href="/app/trader">
                <Button size="lg" className="bg-white text-blue-700 hover:bg-blue-50 gap-2">
                  Open Portal <ArrowRight className="h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <Button
                size="lg"
                className="bg-white text-blue-700 hover:bg-blue-50 gap-2"
                onClick={() => window.location.href = getLoginUrl()}
              >
                Sign In <ArrowRight className="h-5 w-5" />
              </Button>
            )}
            <Link href="/specification">
              <Button size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10 bg-transparent gap-2">
                Architecture Spec
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
                <Globe className="h-3 w-3 text-primary-foreground" />
              </div>
              <span className="font-semibold text-sm">TradeGateway™ NGSWTP</span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Next Generation Single Window Trade Platform · v3.0 · March 2026 · Synthesized from Singapore NTP, Ghana ICUMS, Rwanda ReSW
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
