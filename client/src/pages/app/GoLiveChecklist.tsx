import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2, Circle, AlertTriangle, ExternalLink, Rocket,
  Shield, Database, Mail, Key, Globe, Server, Users,
  FileText, Activity, Lock, Zap, ChevronDown, ChevronRight,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface CheckItem {
  id: string;
  label: string;
  description: string;
  required: boolean;
  link?: string;
  linkLabel?: string;
  verifyFn?: () => Promise<boolean>;
}

interface CheckSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  items: CheckItem[];
}

const SECTIONS: CheckSection[] = [
  {
    id: "infra",
    title: "Infrastructure & Database",
    icon: <Database className="h-4 w-4" />,
    color: "text-blue-600",
    items: [
      {
        id: "db-schema",
        label: "Database schema migrated",
        description: "All 50 tables created via pnpm db:push. Verify via Admin → Database panel.",
        required: true,
        link: "/app/admin/audit-engine",
        linkLabel: "Audit Engine",
      },
      {
        id: "db-seed",
        label: "Pilot demo data seeded",
        description: "Run node scripts/seed-pilot-demo.mjs to populate 5 officers, 20 traders, 30 days of KPI data.",
        required: true,
        link: "/app/admin/pilot-dashboard",
        linkLabel: "Pilot Dashboard",
      },
      {
        id: "local-postgres",
        label: "Local PostgreSQL running",
        description: "PostgreSQL 14 installed and running on port 5432. Verify with: pg_isready -h 127.0.0.1",
        required: true,
      },
      {
        id: "db-startup",
        label: "DB startup script configured",
        description: "scripts/db-startup.sh runs migrations on container start. Included in deployment.",
        required: false,
      },
    ],
  },
  {
    id: "security",
    title: "Security & Headers",
    icon: <Shield className="h-4 w-4" />,
    color: "text-red-600",
    items: [
      {
        id: "helmet",
        label: "Helmet security headers active",
        description: "CSP, HSTS (1yr + preload), X-Frame-Options, X-Content-Type-Options, XSS protection all configured.",
        required: true,
      },
      {
        id: "rate-limit",
        label: "Rate limiting enabled",
        description: "200 req/min on tRPC, 20 req/min on auth endpoints. Configured in server/_core/index.ts.",
        required: true,
      },
      {
        id: "jwt-secret",
        label: "JWT_SECRET set in production",
        description: "Must be a 32+ character random string. Set via Settings → Secrets panel.",
        required: true,
        link: "/app/admin/identity-provider",
        linkLabel: "Identity Provider",
      },
      {
        id: "hsts-preload",
        label: "HSTS preload submitted",
        description: "After 30 days of live HTTPS traffic, submit your domain to https://hstspreload.org for browser preloading.",
        required: false,
        link: "https://hstspreload.org",
        linkLabel: "HSTS Preload",
      },
    ],
  },
  {
    id: "auth",
    title: "Authentication & OAuth",
    icon: <Key className="h-4 w-4" />,
    color: "text-purple-600",
    items: [
      {
        id: "oauth-configured",
        label: "Manus OAuth configured",
        description: "VITE_APP_ID, OAUTH_SERVER_URL, VITE_OAUTH_PORTAL_URL all injected by platform.",
        required: true,
      },
      {
        id: "admin-role",
        label: "Owner account promoted to admin",
        description: "Run: UPDATE users SET role = 'admin' WHERE open_id = '<your-open-id>'; via Database panel.",
        required: true,
        link: "/app/admin/kyc-review",
        linkLabel: "KYC Review",
      },
      {
        id: "session-cookie",
        label: "Session cookie secure in production",
        description: "Cookies are httpOnly + sameSite=lax. In production, ensure HTTPS so secure flag activates.",
        required: true,
      },
    ],
  },
  {
    id: "email",
    title: "Email Delivery (SendGrid)",
    icon: <Mail className="h-4 w-4" />,
    color: "text-amber-600",
    items: [
      {
        id: "sendgrid-key",
        label: "SENDGRID_API_KEY configured",
        description: "Add via Settings → Secrets. Required for nightly compliance CSV emails and executive digest.",
        required: false,
        link: "/app/admin/compliance-email-settings",
        linkLabel: "Compliance Email Settings",
      },
      {
        id: "digest-from",
        label: "DIGEST_FROM_EMAIL configured",
        description: "Set the from address for automated emails (e.g. noreply@tradegateway.ng).",
        required: false,
      },
      {
        id: "digest-recipients",
        label: "DIGEST_RECIPIENTS configured",
        description: "Comma-separated list of email addresses to receive the executive daily digest.",
        required: false,
        link: "/app/admin/compliance-email-settings",
        linkLabel: "Compliance Email Settings",
      },
      {
        id: "test-email",
        label: "Test email delivery verified",
        description: "Use the 'Send Test Email' button on Compliance Email Settings to confirm delivery.",
        required: false,
        link: "/app/admin/compliance-email-settings",
        linkLabel: "Send Test Email",
      },
    ],
  },
  {
    id: "domain",
    title: "Domain & SSL",
    icon: <Globe className="h-4 w-4" />,
    color: "text-green-600",
    items: [
      {
        id: "custom-domain",
        label: "Custom domain bound",
        description: "Bind your production domain (e.g. tradegateway.gov.ng) via Settings → Domains in the Management UI.",
        required: false,
      },
      {
        id: "ssl-cert",
        label: "SSL certificate active",
        description: "Manus automatically provisions and renews SSL certificates for bound domains.",
        required: false,
      },
      {
        id: "dns-records",
        label: "DNS records configured",
        description: "Add CNAME record pointing your domain to the Manus-provided hostname.",
        required: false,
      },
    ],
  },
  {
    id: "monitoring",
    title: "Monitoring & Observability",
    icon: <Activity className="h-4 w-4" />,
    color: "text-cyan-600",
    items: [
      {
        id: "audit-log",
        label: "Audit logging active",
        description: "All admin actions, declaration approvals, and security events are logged to audit_events table.",
        required: true,
        link: "/app/admin/audit-engine",
        linkLabel: "Audit Engine",
      },
      {
        id: "notification-digest",
        label: "Notification digest configured",
        description: "Set digest frequency and recipients via Notification Preferences.",
        required: false,
        link: "/app/notification-preferences",
        linkLabel: "Notification Preferences",
      },
      {
        id: "soc-dashboard",
        label: "SOC dashboard reviewed",
        description: "Verify security alerts, threat intel feeds, and SIEM integration are configured.",
        required: false,
        link: "/app/security/soc",
        linkLabel: "SOC Dashboard",
      },
    ],
  },
  {
    id: "data",
    title: "Reference Data & Configuration",
    icon: <FileText className="h-4 w-4" />,
    color: "text-indigo-600",
    items: [
      {
        id: "ports-seeded",
        label: "Port locations seeded",
        description: "Run node scripts/seed-ports.mjs to populate port location data for the cargo tracking map.",
        required: false,
        link: "/app/geo/cargo-tracking",
        linkLabel: "Cargo Tracking Map",
      },
      {
        id: "oga-configured",
        label: "OGA agency list configured",
        description: "Verify all 37+ OGA agencies are configured in the OGA Integration Hub.",
        required: false,
        link: "/app/customs",
        linkLabel: "Clearance Operations",
      },
      {
        id: "hs-codes",
        label: "HS code lookup populated",
        description: "HS code search uses the built-in WCO tariff database. No additional setup required.",
        required: true,
      },
    ],
  },
  {
    id: "performance",
    title: "Performance & Capacity",
    icon: <Zap className="h-4 w-4" />,
    color: "text-orange-600",
    items: [
      {
        id: "load-test",
        label: "Load test completed",
        description: "Target: 200 concurrent users, <500ms p95 response time on declaration submission.",
        required: false,
      },
      {
        id: "db-indexes",
        label: "Database indexes verified",
        description: "Key indexes on declarations(status, created_at), users(open_id), payments(declaration_id) are in schema.",
        required: true,
      },
      {
        id: "file-upload-limit",
        label: "File upload limits configured",
        description: "50MB body parser limit set. S3 storage configured for document vault uploads.",
        required: true,
      },
    ],
  },
];

export default function GoLiveChecklist() {
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("golive-checklist") || "{}");
    } catch {
      return {};
    }
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (id: string) => {
    const next = { ...checked, [id]: !checked[id] };
    setChecked(next);
    localStorage.setItem("golive-checklist", JSON.stringify(next));
  };

  const toggleSection = (id: string) => {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));
  };

  const totalRequired = SECTIONS.flatMap((s) => s.items).filter((i) => i.required).length;
  const checkedRequired = SECTIONS.flatMap((s) => s.items).filter((i) => i.required && checked[i.id]).length;
  const totalAll = SECTIONS.flatMap((s) => s.items).length;
  const checkedAll = SECTIONS.flatMap((s) => s.items).filter((i) => checked[i.id]).length;
  const readyForLaunch = checkedRequired === totalRequired;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-4xl">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Rocket className="h-6 w-6 text-primary" />
              Production Go-Live Checklist
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Complete all required items before going live. Optional items improve reliability and operations.
            </p>
          </div>
          <div className="text-right">
            <div className={`text-lg font-bold ${readyForLaunch ? "text-emerald-600" : "text-amber-600"}`}>
              {checkedRequired}/{totalRequired} required
            </div>
            <div className="text-xs text-muted-foreground">{checkedAll}/{totalAll} total</div>
          </div>
        </div>

        {/* Status banner */}
        {readyForLaunch ? (
          <Card className="border-emerald-300 bg-emerald-50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-800">All required items complete — ready to publish!</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Click the <strong>Publish</strong> button in the Management UI header to deploy to production.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-6 w-6 text-amber-600 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-800">
                    {totalRequired - checkedRequired} required item{totalRequired - checkedRequired !== 1 ? "s" : ""} remaining
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    Complete all required items before publishing to production.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Overall progress</span>
            <span>{Math.round((checkedAll / totalAll) * 100)}%</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${(checkedAll / totalAll) * 100}%` }}
            />
          </div>
        </div>

        {/* Sections */}
        {SECTIONS.map((section) => {
          const sectionItems = section.items;
          const sectionChecked = sectionItems.filter((i) => checked[i.id]).length;
          const isCollapsed = collapsed[section.id];

          return (
            <Card key={section.id}>
              <CardHeader
                className="cursor-pointer select-none pb-3"
                onClick={() => toggleSection(section.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={section.color}>{section.icon}</span>
                    <CardTitle className="text-base">{section.title}</CardTitle>
                    <Badge variant="outline" className="text-xs">
                      {sectionChecked}/{sectionItems.length}
                    </Badge>
                  </div>
                  {isCollapsed ? (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>
              {!isCollapsed && (
                <CardContent className="pt-0 space-y-3">
                  {sectionItems.map((item, idx) => (
                    <div key={item.id}>
                      {idx > 0 && <Separator className="my-3" />}
                      <div className="flex items-start gap-3">
                        <button
                          onClick={() => toggle(item.id)}
                          className="mt-0.5 shrink-0 focus:outline-none"
                          aria-label={checked[item.id] ? "Mark incomplete" : "Mark complete"}
                        >
                          {checked[item.id] ? (
                            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                          ) : (
                            <Circle className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-medium ${checked[item.id] ? "line-through text-muted-foreground" : ""}`}>
                              {item.label}
                            </span>
                            {item.required ? (
                              <Badge className="bg-red-100 text-red-700 text-xs px-1.5 py-0">Required</Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs px-1.5 py-0">Optional</Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                          {item.link && (
                            <a
                              href={item.link}
                              target={item.link.startsWith("http") ? "_blank" : undefined}
                              rel={item.link.startsWith("http") ? "noopener noreferrer" : undefined}
                              className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                            >
                              {item.linkLabel ?? item.link}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </CardContent>
              )}
            </Card>
          );
        })}

        {/* Go-live runbook */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Server className="h-4 w-4" /> Production Go-Live Runbook
            </CardTitle>
            <CardDescription className="text-xs">Step-by-step deployment procedure for the TradeGateway™ NGSWTP platform.</CardDescription>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-4">
            <div>
              <p className="font-semibold text-foreground mb-1">Step 1 — Pre-flight (T-24h)</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Complete all Required items in this checklist</li>
                <li>Run <code className="bg-muted px-1 rounded">pnpm test</code> — all 1,316 tests must pass</li>
                <li>Run <code className="bg-muted px-1 rounded">node scripts/seed-pilot-demo.mjs</code> on the production DB</li>
                <li>Run <code className="bg-muted px-1 rounded">node scripts/seed-ports.mjs</code> for port location data</li>
                <li>Verify SENDGRID_API_KEY via "Send Test Email" on Compliance Email Settings</li>
                <li>Promote the owner account to admin via Database panel</li>
              </ul>
            </div>
            <Separator />
            <div>
              <p className="font-semibold text-foreground mb-1">Step 2 — Publish (T-0)</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Save a checkpoint via <code className="bg-muted px-1 rounded">webdev_save_checkpoint</code></li>
                <li>Click the <strong>Publish</strong> button in the Management UI header</li>
                <li>Bind your custom domain via Settings → Domains</li>
                <li>Verify SSL certificate is active (green padlock in browser)</li>
              </ul>
            </div>
            <Separator />
            <div>
              <p className="font-semibold text-foreground mb-1">Step 3 — Post-launch (T+1h)</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Verify Pilot Dashboard shows 30 days of KPI data at <code className="bg-muted px-1 rounded">/app/admin/pilot-dashboard</code></li>
                <li>Submit a test declaration end-to-end (trader → customs → clearance)</li>
                <li>Verify audit log entries appear in Audit Engine</li>
                <li>Check SOC Dashboard for any security alerts</li>
                <li>Confirm nightly cron jobs are scheduled (AEO reminders at 03:10 UTC, CSV email at 04:00 UTC)</li>
              </ul>
            </div>
            <Separator />
            <div>
              <p className="font-semibold text-foreground mb-1">Step 4 — Rollback procedure (if needed)</p>
              <ul className="space-y-1 list-disc list-inside">
                <li>Use the Management UI → Dashboard → Rollback button to revert to the previous checkpoint</li>
                <li>All database migrations are forward-only; schema rollback requires manual SQL</li>
                <li>Contact support at <a href="https://help.manus.im" className="text-primary hover:underline">help.manus.im</a> for platform-level issues</li>
              </ul>
            </div>
            <Separator />
            <div>
              <p className="font-semibold text-foreground mb-1">External Infrastructure (Phase 2 — post-launch)</p>
              <p className="mb-1">The following services are gracefully degraded (DB fallback active) and can be integrated after go-live:</p>
              <ul className="space-y-1 list-disc list-inside">
                <li><strong>Apache Kafka + Fluvio</strong> — real-time event streaming (currently: synchronous DB writes)</li>
                <li><strong>Temporal</strong> — durable workflow orchestration (currently: direct procedure calls)</li>
                <li><strong>Keycloak</strong> — enterprise SSO/SAML (currently: Manus OAuth)</li>
                <li><strong>TigerBeetle</strong> — financial ledger (currently: PostgreSQL payments table)</li>
                <li><strong>Go microservices</strong> — gRPC service mesh (currently: direct DB queries)</li>
                <li><strong>Delta Lake + Apache Spark</strong> — analytics lakehouse (currently: PostgreSQL aggregations)</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
