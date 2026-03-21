/**
 * DemoLogin — Full-screen role-picker shown at /demo
 *
 * Lets any visitor choose one of the 6 demo personas, calls
 * POST /api/demo/session, then redirects to the appropriate portal.
 * Only rendered when DEMO_MODE=true.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, ArrowRight, ShieldCheck, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type DemoRole = "trader" | "customs" | "oga" | "admin" | "security" | "developer";

interface Persona {
  role: DemoRole;
  name: string;
  title: string;
  portal: string;
  portalPath: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
  emoji: string;
  features: string[];
}

const PERSONAS: Persona[] = [
  {
    role: "trader",
    name: "Amara Diallo",
    title: "Licensed Import/Export Trader",
    portal: "Trader Portal",
    portalPath: "/app/trader",
    description: "Submit customs declarations, pay duties via mobile money, track shipments, and apply for AEO trusted trader status.",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30 hover:border-blue-400",
    emoji: "📦",
    features: ["New Declaration Wizard", "Shipment Tracker", "Duty Payments", "AEO Application", "Document Vault"],
  },
  {
    role: "customs",
    name: "Kwame Asante",
    title: "Senior Customs Officer",
    portal: "Customs Officer Portal",
    portalPath: "/app/customs",
    description: "Process the declaration queue with AI risk scoring, conduct examinations, issue clearance decisions, and monitor live cargo events.",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30 hover:border-amber-400",
    emoji: "🛃",
    features: ["Declaration Queue", "AI Risk Lanes", "Live Cargo Stream", "Vision Analysis", "Post-Clearance Audit"],
  },
  {
    role: "oga",
    name: "Fatima Al-Hassan",
    title: "OGA Permit Officer",
    portal: "Government Agency Portal",
    portalPath: "/app/oga",
    description: "Review and approve permits, licences, and certificates for your agency. All decisions are recorded in the immutable audit trail.",
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30 hover:border-green-400",
    emoji: "🏛️",
    features: ["Permit Review Queue", "Decision History", "SLA Tracking", "Expiry Calendar", "Joint Inspections"],
  },
  {
    role: "admin",
    name: "Chidi Okonkwo",
    title: "Platform Administrator",
    portal: "Administration Console",
    portalPath: "/app/admin",
    description: "Manage all users and stakeholder registrations, configure platform settings, monitor service health, and view the full audit log.",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30 hover:border-purple-400",
    emoji: "⚙️",
    features: ["User Management", "Service Health", "Audit Log", "Trade Analytics", "Executive Dashboard"],
  },
  {
    role: "security",
    name: "Ngozi Eze",
    title: "Security Analyst",
    portal: "Security Operations Centre",
    portalPath: "/app/security",
    description: "Monitor real-time security alerts, screen entities against OFAC/UN/EU sanctions lists, and manage threat intelligence feeds.",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30 hover:border-red-400",
    emoji: "🔐",
    features: ["Security Alert Feed", "Sanctions Screening", "Wazuh SIEM/XDR", "OpenCTI Threat Intel", "SOC Dashboard"],
  },
  {
    role: "developer",
    name: "Tunde Adeyemi",
    title: "API Developer",
    portal: "Developer Portal",
    portalPath: "/app/developer",
    description: "Manage API keys, explore the interactive OpenAPI playground, generate SDKs, and monitor API usage analytics.",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30 hover:border-cyan-400",
    emoji: "👨‍💻",
    features: ["API Key Management", "Interactive Playground", "SDK Generator", "API Changelog", "Webhook Management"],
  },
];

export default function DemoLogin() {
  const [, navigate] = useLocation();
  const [loading, setLoading] = useState<DemoRole | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loginAs(persona: Persona) {
    setLoading(persona.role);
    setError(null);
    try {
      const res = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ role: persona.role }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      // Hard navigate so the session cookie is picked up by the auth context
      window.location.href = persona.portalPath;
    } catch (e: any) {
      setError(e.message ?? "Failed to start demo session");
      setLoading(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0A1628] text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D4A017] flex items-center justify-center text-[#0A1628] font-bold text-sm">TG</div>
          <div>
            <div className="font-semibold text-sm leading-none">TradeGateway™ NGSWTP</div>
            <div className="text-xs text-white/50 mt-0.5">Next Generation Single Window Trade Platform</div>
          </div>
        </div>
        <Badge variant="outline" className="border-amber-500/50 text-amber-400 bg-amber-500/10 gap-1.5 text-xs">
          <FlaskConical className="w-3 h-3" />
          Demo Mode Active
        </Badge>
      </header>

      {/* Hero */}
      <div className="text-center pt-12 pb-8 px-4">
        <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/60 mb-6">
          <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
          No credentials required — select a role to enter the live platform
        </div>
        <h1 className="text-4xl font-bold mb-3 tracking-tight">
          Choose Your <span className="text-[#D4A017]">Demo Role</span>
        </h1>
        <p className="text-white/50 text-base max-w-xl mx-auto">
          Each portal is fully functional with live data. Switch between roles at any time using the floating banner inside the platform.
        </p>
      </div>

      {/* Role grid */}
      <div className="flex-1 px-4 pb-12 max-w-6xl mx-auto w-full">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {PERSONAS.map((persona) => {
            const isLoading = loading === persona.role;
            return (
              <button
                key={persona.role}
                onClick={() => loginAs(persona)}
                disabled={loading !== null}
                className={`
                  group relative text-left rounded-xl border p-5 transition-all duration-200
                  ${persona.bgColor} ${persona.borderColor}
                  disabled:opacity-60 disabled:cursor-not-allowed
                  focus:outline-none focus:ring-2 focus:ring-white/20
                `}
              >
                {/* Emoji + portal badge */}
                <div className="flex items-start justify-between mb-3">
                  <span className="text-3xl">{persona.emoji}</span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${persona.bgColor} ${persona.color} border-current/30`}>
                    {persona.portal}
                  </span>
                </div>

                {/* Name + title */}
                <div className="mb-2">
                  <div className={`font-semibold text-base ${persona.color}`}>{persona.name}</div>
                  <div className="text-xs text-white/50 mt-0.5">{persona.title}</div>
                </div>

                {/* Description */}
                <p className="text-xs text-white/60 leading-relaxed mb-4">{persona.description}</p>

                {/* Feature pills */}
                <div className="flex flex-wrap gap-1 mb-4">
                  {persona.features.map((f) => (
                    <span key={f} className="text-[10px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-white/50">
                      {f}
                    </span>
                  ))}
                </div>

                {/* CTA */}
                <div className={`flex items-center gap-1.5 text-xs font-medium ${persona.color}`}>
                  {isLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Signing in…
                    </>
                  ) : (
                    <>
                      Enter {persona.portal}
                      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mt-6 text-center text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 max-w-md mx-auto">
            {error} — please try again or refresh the page.
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-xs text-white/30 mt-8">
          Demo data is pre-seeded. All actions are recorded in the audit log but do not affect production systems.
          <br />
          Platform built on Go · Python · Kafka · Temporal · Mojaloop · TigerBeetle · Keycloak · Kubernetes.
        </p>
      </div>
    </div>
  );
}
