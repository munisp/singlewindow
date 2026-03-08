import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getLoginUrl } from "@/const";
import {
  ArrowRight,
  BarChart3,
  CheckCircle,
  Clock,
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
    description: "Submit shipment declarations, track cargo status, pay duties, and apply for trusted trader status.",
    features: ["Step-by-step declaration form", "Document upload & management", "Duty payment & receipts", "Trusted Trader (AEO) application"],
  },
  {
    role: "Customs Officer",
    href: "/app/customs",
    icon: <ShieldCheck className="h-6 w-6" />,
    color: "bg-purple-600",
    description: "Review incoming declarations, assess risk, conduct examinations, and issue clearance decisions.",
    features: ["Risk-scored declaration queue", "Fast-track / Review / Inspect lane assignment", "Examination & inspection workflow", "Clearance and hold actions"],
  },
  {
    role: "Government Agency Officer",
    href: "/app/oga",
    icon: <Globe className="h-6 w-6" />,
    color: "bg-amber-600",
    description: "Review and approve permits for your agency. Participate in joint inspections with real-time updates.",
    features: ["Permit review queue", "Approve, reject, or add conditions", "Agency-specific workflows", "Full audit trail"],
  },
  {
    role: "Administrator",
    href: "/app/admin",
    icon: <Users className="h-6 w-6" />,
    color: "bg-emerald-600",
    description: "Manage users, approve stakeholder registrations, configure access roles, and monitor platform activity.",
    features: ["Stakeholder onboarding approval", "User role management", "Profile & identity verification", "System activity log"],
  },
  {
    role: "Security Analyst",
    href: "/app/security",
    icon: <Shield className="h-6 w-6" />,
    color: "bg-red-600",
    description: "Monitor security alerts, screen traders and entities against international sanctions lists, and manage threat intelligence.",
    features: ["Real-time security alert feed", "OFAC / UN / EU / OFSI sanctions screening", "Dual-use goods detection", "Risk explanation reports"],
  },
];

const STATS = [
  { value: "< 4 hrs", label: "Fast-track clearance time", icon: <Zap className="h-5 w-5" /> },
  { value: "37+", label: "Government agencies connected", icon: <Network className="h-5 w-5" /> },
  { value: "99.99%", label: "Platform availability", icon: <BarChart3 className="h-5 w-5" /> },
  { value: "5M+", label: "Declarations processed annually", icon: <Globe className="h-5 w-5" /> },
];

const CAPABILITIES = [
  {
    icon: <Clock className="h-6 w-6 text-blue-400" />,
    title: "Faster Clearance",
    desc: "Low-risk shipments are cleared in under 4 hours through the automated fast-track lane, reducing port dwell time and storage costs.",
  },
  {
    icon: <Shield className="h-6 w-6 text-emerald-400" />,
    title: "Single Submission",
    desc: "Traders submit once. The platform automatically routes permits, licences, and certificates to all relevant government agencies simultaneously.",
  },
  {
    icon: <Network className="h-6 w-6 text-purple-400" />,
    title: "Full Cargo Visibility",
    desc: "Track every shipment from arrival to release. All parties — traders, customs, port operators, and agencies — see the same real-time status.",
  },
  {
    icon: <Lock className="h-6 w-6 text-amber-400" />,
    title: "Fraud & Risk Detection",
    desc: "Automated risk scoring flags suspicious shipments before they reach the border, protecting government revenue and national security.",
  },
];

const SECURITY_FEATURES = [
  "Multi-factor authentication for all users",
  "Role-based access — each user sees only what they need",
  "AI-powered web application firewall blocks attacks in real time",
  "Continuous security monitoring and automated incident response",
  "International sanctions and restricted-party screening",
  "Encrypted communications between all system components",
];

export default function Home() {
  const { isAuthenticated } = useAuth();

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
              <span className="font-bold text-lg tracking-tight">TradeGateway™</span>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/specification">
                <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
                  Technical Specification
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
              National Customs Single Window · Inspired by Singapore, Ghana & Rwanda
            </div>
            <h1 className="text-5xl md:text-6xl font-bold leading-tight mb-6">
              National<br />
              <span className="text-blue-400">Trade Gateway</span><br />
              Single Window
            </h1>
            <p className="text-xl text-slate-300 mb-8 leading-relaxed max-w-2xl">
              A unified platform where traders, customs officers, government agencies, and port operators collaborate to clear goods faster, reduce costs, and strengthen border security.
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
                  View Technical Specification
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
            <h2 className="text-3xl font-bold mb-3">A Portal for Every Stakeholder</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Each user group has a dedicated, secure workspace tailored to their role — with only the tools and information they need to do their job.
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

      {/* Key capabilities */}
      <section className="py-20 bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-3">What TradeGateway Delivers</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Designed around the needs of traders, government agencies, and border management authorities.
            </p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {CAPABILITIES.map((cap) => (
              <Card key={cap.title} className="border">
                <CardContent className="p-6">
                  <div className="mb-4">{cap.icon}</div>
                  <h3 className="font-bold text-base mb-2">{cap.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{cap.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Security section */}
      <section className="py-20 bg-muted/30 border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">Built for National-Level Security</h2>
              <p className="text-muted-foreground mb-6 leading-relaxed">
                A national trade platform is a high-value target for fraud and cyberattacks. TradeGateway is designed with multiple layers of protection — from the moment a user logs in to every data exchange between agencies.
              </p>
              <ul className="space-y-3">
                {SECURITY_FEATURES.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm">
                    <Lock className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { tool: "Identity Management", role: "Secure login with multi-factor authentication", color: "bg-blue-50 border-blue-200" },
                { tool: "Web Application Firewall", role: "Blocks malicious traffic before it reaches the platform", color: "bg-emerald-50 border-emerald-200" },
                { tool: "Security Monitoring", role: "24/7 automated threat detection and response", color: "bg-red-50 border-red-200" },
                { tool: "Threat Intelligence", role: "Global threat feeds integrated into risk decisions", color: "bg-purple-50 border-purple-200" },
                { tool: "Access Control", role: "Fine-grained permissions — users see only what they need", color: "bg-amber-50 border-amber-200" },
                { tool: "Financial Integrity", role: "Tamper-proof audit ledger for all duty transactions", color: "bg-slate-50 border-slate-200" },
              ].map((item) => (
                <div key={item.tool} className={`p-4 rounded-xl border ${item.color}`}>
                  <p className="font-semibold text-sm">{item.tool}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.role}</p>
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
            Sign in to access your role-based portal, or review the full technical specification.
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
                Technical Specification
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
              <span className="font-semibold text-sm">TradeGateway™ National Single Window Trade Platform</span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              v3.0 · March 2026 · Benchmarked against Singapore NTP, Ghana ICUMS, and Rwanda ReSW
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
