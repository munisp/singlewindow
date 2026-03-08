/**
 * TradeGateway NGSWTP — Stakeholder Onboarding Portal
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Covers all 8 stakeholder groups with:
 * - Role-based onboarding journeys
 * - Keycloak role assignments
 * - Workflow process maps
 * - SLA commitments
 * - Training and support resources
 */

import { useState } from "react";
import {
  Users, Building2, Ship, Truck, CreditCard, Shield, Globe, BarChart3,
  CheckCircle, Clock, ChevronRight, BookOpen, Key, Workflow, Bell, FileText, Star
} from "lucide-react";

interface StakeholderGroup {
  id: string;
  name: string;
  shortName: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  count: string;
  description: string;
  keycloakRoles: string[];
  onboardingSteps: OnboardingStep[];
  workflowProcesses: WorkflowProcess[];
  slaCommitments: SLACommitment[];
  trainingModules: string[];
  integrationAPIs: string[];
}

interface OnboardingStep {
  step: number;
  title: string;
  description: string;
  duration: string;
  responsible: string;
  artifacts: string[];
}

interface WorkflowProcess {
  name: string;
  trigger: string;
  steps: string[];
  sla: string;
  outcome: string;
}

interface SLACommitment {
  metric: string;
  target: string;
  measurement: string;
}

const STAKEHOLDERS: StakeholderGroup[] = [
  {
    id: "trader",
    name: "Traders & Importers/Exporters",
    shortName: "Traders",
    icon: <Truck className="w-5 h-5" />,
    color: "#3b82f6",
    bgColor: "#1e3a5f",
    count: "50,000+",
    description: "Licensed importers, exporters, freight forwarders, and customs agents who submit declarations and pay duties.",
    keycloakRoles: ["trader", "aeo-trader", "freight-forwarder", "customs-agent"],
    onboardingSteps: [
      { step: 1, title: "Business Registration Verification", description: "System verifies trader's business registration number against Company Registry API", duration: "Automated (< 2 min)", responsible: "System + Company Registry", artifacts: ["Certificate of Incorporation", "Tax PIN Certificate"] },
      { step: 2, title: "Keycloak Account Provisioning", description: "Trader account created with role assignment. MFA (TOTP) enforced for all traders.", duration: "Automated (< 1 min)", responsible: "Keycloak + trader-svc", artifacts: ["Login credentials", "TOTP QR code"] },
      { step: 3, title: "Trader Profile & AEO Assessment", description: "Trader completes profile, uploads compliance history. System scores AEO eligibility.", duration: "1–3 business days", responsible: "Customs Authority + aeo-svc", artifacts: ["AEO application form", "Compliance history"] },
      { step: 4, title: "Training & Certification", description: "Mandatory e-learning modules on declaration submission, HS code lookup, and payment.", duration: "4 hours (self-paced)", responsible: "TradeGateway Academy", artifacts: ["Training certificate", "User manual"] },
      { step: 5, title: "Sandbox Testing", description: "Trader submits 3 test declarations in sandbox environment to validate integration.", duration: "1 business day", responsible: "Trader + Support Team", artifacts: ["Test URN references", "Sandbox clearance permits"] },
      { step: 6, title: "Go-Live Approval", description: "Customs Authority approves trader for production access. Account activated.", duration: "1 business day", responsible: "Customs Authority", artifacts: ["Go-live approval letter", "Production credentials"] },
    ],
    workflowProcesses: [
      { name: "Import Declaration", trigger: "Trader submits declaration via Web/API/USSD", steps: ["Submit declaration + upload docs", "Receive URN reference", "OCR + HS classification (automated)", "Risk scoring + lane assignment", "OGA approvals (if Yellow/Red)", "Pay duties via Mojaloop", "Receive clearance permit"], sla: "Green: < 4h | Yellow: < 24h | Red: < 72h", outcome: "Ed25519-signed clearance permit" },
      { name: "Export Declaration", trigger: "Trader submits export declaration", steps: ["Submit export declaration", "Receive export URN", "Revenue Authority assessment", "Port Authority gate pass", "Cargo loading authorization", "Export permit issuance"], sla: "< 2 hours", outcome: "Export permit + gate pass" },
      { name: "AEO Application", trigger: "Trader applies for AEO status", steps: ["Submit AEO application", "Compliance history review", "Site inspection scheduling", "Customs Authority assessment", "AEO certificate issuance", "Green-lane privileges activated"], sla: "30 business days", outcome: "AEO certificate + Green-lane priority" },
    ],
    slaCommitments: [
      { metric: "Portal availability", target: "99.9%", measurement: "Monthly uptime" },
      { metric: "URN issuance", target: "< 30 seconds", measurement: "P99 latency" },
      { metric: "Green-lane clearance", target: "< 4 hours", measurement: "Submission to permit" },
      { metric: "Support response", target: "< 4 hours", measurement: "Business hours" },
    ],
    trainingModules: ["Declaration Submission Basics", "HS Code Classification Guide", "Document Upload Requirements", "Payment via Mojaloop/Mobile Money", "AEO Programme Overview", "API Integration Guide"],
    integrationAPIs: ["POST /v1/declarations", "GET /v1/declarations/{urn}", "POST /v1/documents/upload", "GET /v1/tariff/calculate", "GET /v1/permits/{id}/verify"],
  },
  {
    id: "customs",
    name: "Customs Authority",
    shortName: "Customs",
    icon: <Shield className="w-5 h-5" />,
    color: "#D4A017",
    bgColor: "#3d2e00",
    count: "500+ officers",
    description: "Customs officers, risk analysts, and supervisors who review declarations, conduct inspections, and issue clearances.",
    keycloakRoles: ["customs-officer", "customs-supervisor", "customs-risk-analyst", "customs-admin"],
    onboardingSteps: [
      { step: 1, title: "HR System Integration", description: "Officer details synced from HR system. Keycloak account auto-provisioned with role.", duration: "Automated (< 5 min)", responsible: "IT Department", artifacts: ["Staff ID", "Role assignment letter"] },
      { step: 2, title: "Role-Based Access Configuration", description: "Supervisor assigns officer to specific port/border post. Access scoped accordingly.", duration: "30 minutes", responsible: "Customs IT Admin", artifacts: ["Access matrix", "Port assignment"] },
      { step: 3, title: "System Training", description: "Officer completes mandatory training on declaration review, risk scoring, and inspection workflows.", duration: "2 days", responsible: "TradeGateway Training Team", artifacts: ["Training certificate", "Officer handbook"] },
      { step: 4, title: "Supervised Practice", description: "Officer handles 20 declarations under senior officer supervision in production.", duration: "1 week", responsible: "Senior Customs Officer", artifacts: ["Practice log", "Supervisor sign-off"] },
      { step: 5, title: "Full Activation", description: "Officer granted full production access. Audit trail enabled.", duration: "Immediate", responsible: "Customs Supervisor", artifacts: ["Activation confirmation"] },
    ],
    workflowProcesses: [
      { name: "Yellow-Lane Review", trigger: "Declaration assigned to officer queue", steps: ["Receive notification (Dapr binding)", "Review declaration + documents", "Request additional documents (if needed)", "Consult OGA responses", "Approve / reject / escalate", "Issue clearance or hold notice"], sla: "< 4 hours", outcome: "Clearance or hold notice" },
      { name: "Red-Lane Physical Inspection", trigger: "Risk engine assigns Red lane", steps: ["Schedule inspection appointment", "Notify trader of inspection", "Conduct physical examination", "Record inspection findings", "Collect samples (if required)", "Issue clearance or seizure notice"], sla: "< 24 hours", outcome: "Clearance, seizure, or penalty notice" },
      { name: "Post-Clearance Audit", trigger: "PCA schedule or risk trigger", steps: ["Select declarations for audit", "Request trader records", "Conduct compliance review", "Issue audit findings", "Collect underpaid duties", "Update trader risk profile"], sla: "30 days from selection", outcome: "Audit report + duty recovery" },
    ],
    slaCommitments: [
      { metric: "Yellow-lane processing", target: "< 4 hours", measurement: "Assignment to decision" },
      { metric: "Red-lane inspection", target: "< 24 hours", measurement: "Assignment to clearance" },
      { metric: "Document request response", target: "< 2 hours", measurement: "Request to notification" },
      { metric: "System availability", target: "99.99%", measurement: "Monthly uptime" },
    ],
    trainingModules: ["Declaration Review Workflow", "Risk Score Interpretation", "OGA Response Management", "Physical Inspection Procedures", "Post-Clearance Audit Process", "Fraud Detection & GNN Alerts"],
    integrationAPIs: ["GET /v1/declarations/queue", "PUT /v1/declarations/{urn}/decision", "POST /v1/inspections", "GET /v1/risk/scores/{urn}", "POST /v1/audit/cases"],
  },
  {
    id: "oga",
    name: "Other Government Agencies",
    shortName: "OGAs",
    icon: <Building2 className="w-5 h-5" />,
    color: "#10b981",
    bgColor: "#052e16",
    count: "37 agencies",
    description: "Agriculture, Health, Standards, Immigration, and other agencies that receive declaration referrals and issue permits.",
    keycloakRoles: ["oga-officer", "oga-supervisor", "oga-admin"],
    onboardingSteps: [
      { step: 1, title: "Agency MoU Signing", description: "Agency signs MoU with TradeGateway operator covering data sharing, SLAs, and escalation procedures.", duration: "2–4 weeks (legal review)", responsible: "Agency Head + TradeGateway Operator", artifacts: ["Signed MoU", "Data sharing agreement"] },
      { step: 2, title: "API Integration Assessment", description: "Technical team assesses agency's existing systems for API integration vs. portal access.", duration: "1 week", responsible: "TradeGateway Integration Team", artifacts: ["Integration assessment report"] },
      { step: 3, title: "Integration Implementation", description: "Agency integrates via REST API or uses TradeGateway portal. APISIX gateway configured.", duration: "2–8 weeks", responsible: "Agency IT + TradeGateway Team", artifacts: ["Integration test results", "API credentials"] },
      { step: 4, title: "Staff Training", description: "Agency officers trained on receiving referrals, processing requests, and issuing responses.", duration: "1 day", responsible: "TradeGateway Training Team", artifacts: ["Training certificate"] },
      { step: 5, title: "UAT & Go-Live", description: "End-to-end testing with Customs Authority. SLA monitoring activated.", duration: "1 week", responsible: "All parties", artifacts: ["UAT sign-off", "Go-live confirmation"] },
    ],
    workflowProcesses: [
      { name: "Declaration Referral Processing", trigger: "OGA Hub fan-out via Dapr pub/sub", steps: ["Receive referral notification", "Review declaration + documents", "Request additional information (if needed)", "Issue approval / conditional approval / rejection", "Response published to OGA Hub topic"], sla: "Per MoU (1–6 hours)", outcome: "Approval with conditions or rejection" },
      { name: "Permit Issuance", trigger: "Agency approves referral", steps: ["Generate permit reference", "Issue permit via API or portal", "Permit attached to declaration record", "Trader notified via notification-svc"], sla: "< 1 hour post-approval", outcome: "Agency permit linked to declaration" },
    ],
    slaCommitments: [
      { metric: "Referral response time", target: "Per MoU (1–6h)", measurement: "Referral to response" },
      { metric: "Portal availability", target: "99.9%", measurement: "Monthly uptime" },
      { metric: "API response time", target: "< 500ms", measurement: "P99 latency" },
    ],
    trainingModules: ["Referral Management Portal", "API Integration Guide", "SLA Monitoring Dashboard", "Escalation Procedures"],
    integrationAPIs: ["GET /v1/oga/referrals", "PUT /v1/oga/referrals/{id}/response", "POST /v1/oga/permits", "GET /v1/oga/sla/metrics"],
  },
  {
    id: "bank",
    name: "Banks & Payment Providers",
    shortName: "Banks",
    icon: <CreditCard className="w-5 h-5" />,
    color: "#8b5cf6",
    bgColor: "#2e1065",
    count: "25+ institutions",
    description: "Commercial banks, mobile money operators, and payment service providers connected via Mojaloop for duty collection.",
    keycloakRoles: ["dfsp-operator", "dfsp-admin", "payment-reconciler"],
    onboardingSteps: [
      { step: 1, title: "DFSP Registration with Mojaloop Hub", description: "Bank registers as a DFSP (Digital Financial Service Provider) with the Mojaloop Hub operator.", duration: "2–4 weeks", responsible: "Central Bank + Mojaloop Hub Operator", artifacts: ["DFSP registration certificate", "Hub connection credentials"] },
      { step: 2, title: "TigerBeetle Ledger Account Setup", description: "Bank's settlement account created in TigerBeetle ledger. Account IDs assigned.", duration: "1 day", responsible: "TradeGateway Finance Team", artifacts: ["Ledger account IDs", "Settlement agreement"] },
      { step: 3, title: "ILP Integration Testing", description: "Bank tests ILP quote, transfer, and fulfilment flows in sandbox environment.", duration: "1–2 weeks", responsible: "Bank IT + TradeGateway Team", artifacts: ["ILP test results", "Reconciliation report"] },
      { step: 4, title: "Reconciliation Process Setup", description: "Daily reconciliation process configured between bank's core banking system and TigerBeetle.", duration: "1 week", responsible: "Bank Operations + TradeGateway Finance", artifacts: ["Reconciliation SOP", "Automated report schedule"] },
      { step: 5, title: "Go-Live Approval", description: "Central Bank approves DFSP for production duty collection. Live monitoring activated.", duration: "1 week", responsible: "Central Bank", artifacts: ["Go-live approval", "Monitoring dashboard access"] },
    ],
    workflowProcesses: [
      { name: "Duty Payment Processing", trigger: "Trader initiates payment for declaration", steps: ["Trader selects bank/mobile money", "ILP quote generated (payment-svc)", "TigerBeetle PENDING reserve created", "Trader completes payment via DFSP", "Mojaloop fulfilment callback received", "TigerBeetle POST finalization", "Revenue Authority notified", "Clearance workflow continues"], sla: "< 30 seconds end-to-end", outcome: "Payment confirmed + ledger settled" },
      { name: "Daily Reconciliation", trigger: "Automated at 23:00 UTC", steps: ["TigerBeetle export daily settled transfers", "Match against bank's settlement records", "Identify discrepancies", "Generate reconciliation report", "Escalate unresolved items"], sla: "< 2 hours", outcome: "Reconciliation report + exception list" },
    ],
    slaCommitments: [
      { metric: "Payment processing", target: "< 30 seconds", measurement: "Quote to fulfilment" },
      { metric: "Settlement finality", target: "Same day", measurement: "T+0 settlement" },
      { metric: "Reconciliation", target: "< 2 hours", measurement: "Daily automated" },
    ],
    trainingModules: ["Mojaloop ILP Integration", "TigerBeetle Ledger Overview", "Reconciliation Procedures", "Dispute Resolution Process"],
    integrationAPIs: ["POST /v1/payments/quote", "POST /v1/payments/transfer", "GET /v1/payments/{id}/status", "GET /v1/payments/reconciliation/daily"],
  },
  {
    id: "port",
    name: "Port & Logistics Operators",
    shortName: "Port Ops",
    icon: <Ship className="w-5 h-5" />,
    color: "#06b6d4",
    bgColor: "#0c2a3a",
    count: "15+ operators",
    description: "Port terminal operators, shipping lines, airlines, and freight stations that manage cargo movement and gate access.",
    keycloakRoles: ["port-operator", "terminal-operator", "shipping-agent", "airline-agent"],
    onboardingSteps: [
      { step: 1, title: "Operator License Verification", description: "Port Authority verifies operator license and assigns operator code in TradeGateway.", duration: "1–3 days", responsible: "Port Authority", artifacts: ["Operator license", "Operator code"] },
      { step: 2, title: "AIS/IoT Integration", description: "Vessel tracking AIS receiver connected to Fluvio stream. IoT e-seal readers configured.", duration: "1–2 weeks", responsible: "Port IT + TradeGateway Team", artifacts: ["AIS integration test", "E-seal reader config"] },
      { step: 3, title: "Gate System Integration", description: "Port gate access system integrated with cargo-svc API for automated gate pass validation.", duration: "1–2 weeks", responsible: "Port IT + TradeGateway Team", artifacts: ["Gate integration test results"] },
      { step: 4, title: "Staff Training", description: "Port officers trained on cargo tracking dashboard, gate pass management, and exception handling.", duration: "1 day", responsible: "TradeGateway Training Team", artifacts: ["Training certificate"] },
    ],
    workflowProcesses: [
      { name: "Vessel Pre-Arrival", trigger: "AIS position update 24h before arrival", steps: ["Fluvio stream receives AIS position", "Rust stream-processor enriches with declaration data", "Port Authority notified of incoming vessel", "Berth pre-assigned", "Cargo manifest cross-checked", "Pre-arrival risk assessment"], sla: "24h before arrival", outcome: "Berth assignment + pre-arrival clearance" },
      { name: "Gate Pass Issuance", trigger: "Clearance permit issued", steps: ["cargo-svc generates gate pass", "QR code embedded in gate pass", "Truck driver scans QR at gate", "Gate system validates via API", "Cargo released for loading/unloading"], sla: "< 5 minutes", outcome: "Automated gate access" },
    ],
    slaCommitments: [
      { metric: "Gate pass validation", target: "< 5 seconds", measurement: "Scan to gate open" },
      { metric: "AIS stream latency", target: "< 15ms", measurement: "Fluvio P99" },
      { metric: "Berth assignment", target: "< 1 hour pre-arrival", measurement: "From notification" },
    ],
    trainingModules: ["Cargo Tracking Dashboard", "Gate Pass Management", "AIS Stream Overview", "Exception Handling Procedures"],
    integrationAPIs: ["GET /v1/cargo/{id}/status", "GET /v1/cargo/gate-pass/{id}", "POST /v1/cargo/seal-events", "GET /v1/vessels/pre-arrival"],
  },
  {
    id: "regulator",
    name: "Regulatory & Oversight Bodies",
    shortName: "Regulators",
    icon: <BarChart3 className="w-5 h-5" />,
    color: "#f97316",
    bgColor: "#431407",
    count: "5 bodies",
    description: "Central Bank, Revenue Authority leadership, Ministry of Trade, and international bodies (WCO, ASEAN) with oversight access.",
    keycloakRoles: ["regulator-viewer", "regulator-analyst", "ministry-admin"],
    onboardingSteps: [
      { step: 1, title: "Regulatory Access Agreement", description: "Regulatory body signs data access agreement covering scope, retention, and confidentiality.", duration: "2–4 weeks", responsible: "TradeGateway Operator + Legal", artifacts: ["Data access agreement"] },
      { step: 2, title: "Read-Only Dashboard Provisioning", description: "Analytics dashboard provisioned with role-scoped data access. No PII visible to non-authorized roles.", duration: "1 day", responsible: "TradeGateway Admin", artifacts: ["Dashboard access credentials"] },
      { step: 3, title: "OpenSearch Index Access", description: "Regulator granted read-only access to relevant OpenSearch indices for custom analytics.", duration: "1 day", responsible: "TradeGateway Data Team", artifacts: ["OpenSearch credentials", "Index documentation"] },
    ],
    workflowProcesses: [
      { name: "Trade Statistics Reporting", trigger: "Monthly automated report", steps: ["Spark job aggregates Gold layer data", "Report generated in PDF + CSV", "Sent to regulator via secure email", "Available in regulator dashboard"], sla: "5th of each month", outcome: "Monthly trade statistics report" },
      { name: "Compliance Audit Request", trigger: "Regulator requests audit data", steps: ["Regulator submits data request via portal", "TradeGateway admin reviews and approves", "Data extract prepared from Delta Lake", "Secure transfer to regulator"], sla: "5 business days", outcome: "Audit data package" },
    ],
    slaCommitments: [
      { metric: "Dashboard availability", target: "99.9%", measurement: "Monthly uptime" },
      { metric: "Report delivery", target: "5th of month", measurement: "Monthly" },
      { metric: "Audit data request", target: "5 business days", measurement: "Request to delivery" },
    ],
    trainingModules: ["Analytics Dashboard Guide", "OpenSearch Query Interface", "Data Dictionary", "Report Interpretation Guide"],
    integrationAPIs: ["GET /v1/analytics/trade-stats", "GET /v1/analytics/revenue", "GET /v1/analytics/risk-trends", "POST /v1/analytics/custom-report"],
  },
  {
    id: "international",
    name: "International Partners",
    shortName: "International",
    icon: <Globe className="w-5 h-5" />,
    color: "#ec4899",
    bgColor: "#500724",
    count: "ASEAN, WCO, COMESA",
    description: "ASEAN Single Window, WCO CEN Network, COMESA/EAC Window, and partner country customs administrations.",
    keycloakRoles: ["international-partner", "asean-sw-connector", "wco-cen-connector"],
    onboardingSteps: [
      { step: 1, title: "Bilateral Agreement", description: "Government-to-government agreement signed covering data exchange scope, legal framework, and dispute resolution.", duration: "3–6 months", responsible: "Ministry of Trade + Partner Government", artifacts: ["Bilateral agreement", "Data exchange protocol"] },
      { step: 2, title: "WCO Data Model Alignment", description: "Partner system mapped to WCO Data Model v3.10. EDI translator configured for EDIFACT/XML/JSON.", duration: "4–8 weeks", responsible: "TradeGateway Integration Team + Partner IT", artifacts: ["Data mapping document", "EDI test results"] },
      { step: 3, title: "APISIX Gateway Configuration", description: "Dedicated APISIX route configured for partner with mTLS, rate limiting, and audit logging.", duration: "1 week", responsible: "TradeGateway Infrastructure Team", artifacts: ["mTLS certificates", "API endpoint documentation"] },
      { step: 4, title: "End-to-End Testing", description: "Cross-border declaration exchange tested end-to-end. Rollback procedures documented.", duration: "2 weeks", responsible: "Both parties", artifacts: ["E2E test report", "Rollback plan"] },
    ],
    workflowProcesses: [
      { name: "Cross-Border Declaration Exchange", trigger: "Declaration involves partner country", steps: ["OGA Hub identifies cross-border requirement", "EDI translator converts to partner format", "Secure transmission via APISIX mTLS", "Partner system acknowledges receipt", "Partner response received and parsed", "Response incorporated into clearance decision"], sla: "Per bilateral agreement", outcome: "Cross-border clearance" },
    ],
    slaCommitments: [
      { metric: "Message delivery", target: "< 5 seconds", measurement: "Transmission latency" },
      { metric: "System availability", target: "99.5%", measurement: "Monthly uptime" },
    ],
    trainingModules: ["Cross-Border Declaration Guide", "WCO Data Model Overview", "EDI Message Formats", "Dispute Resolution Procedures"],
    integrationAPIs: ["POST /v1/international/exchange", "GET /v1/international/status/{ref}", "GET /v1/international/partners"],
  },
  {
    id: "developer",
    name: "Private Sector & Developers",
    shortName: "Developers",
    icon: <BookOpen className="w-5 h-5" />,
    color: "#84cc16",
    bgColor: "#1a2e05",
    count: "Unlimited",
    description: "Software vendors, ERP integrators, freight tech companies, and developers building on the TradeGateway API.",
    keycloakRoles: ["api-developer", "sandbox-user", "certified-integrator"],
    onboardingSteps: [
      { step: 1, title: "Developer Registration", description: "Developer registers on the developer portal. Sandbox credentials issued immediately.", duration: "< 5 minutes (self-service)", responsible: "Automated", artifacts: ["Sandbox API key", "Client credentials"] },
      { step: 2, title: "API Exploration", description: "Developer explores OpenAPI 3.1 spec, tests endpoints in sandbox, reviews code samples.", duration: "Self-paced", responsible: "Developer", artifacts: ["Integration plan"] },
      { step: 3, title: "Integration Development", description: "Developer builds integration against sandbox. TradeGateway support available via developer forum.", duration: "Varies", responsible: "Developer", artifacts: ["Integration code", "Test results"] },
      { step: 4, title: "Certification Testing", description: "Developer submits integration for certification. Automated test suite validates compliance.", duration: "1–3 days", responsible: "TradeGateway Certification Team", artifacts: ["Certification report"] },
      { step: 5, title: "Production Access", description: "Certified integrator granted production API access with rate limits appropriate to use case.", duration: "1 business day", responsible: "TradeGateway Admin", artifacts: ["Production API key", "Rate limit agreement"] },
    ],
    workflowProcesses: [
      { name: "API Integration", trigger: "Developer completes certification", steps: ["Production credentials issued", "Rate limits configured in APISIX", "Monitoring dashboard provisioned", "Webhook endpoints configured", "Integration goes live"], sla: "1 business day", outcome: "Live production integration" },
    ],
    slaCommitments: [
      { metric: "API availability", target: "99.9%", measurement: "Monthly uptime" },
      { metric: "API response time", target: "< 200ms", measurement: "P99 latency" },
      { metric: "Sandbox availability", target: "99.5%", measurement: "Monthly uptime" },
      { metric: "Support response", target: "< 24 hours", measurement: "Developer forum" },
    ],
    trainingModules: ["API Quick Start Guide", "Authentication & OAuth2/PKCE", "Webhook Integration", "Rate Limiting & Quotas", "Error Handling Best Practices", "SDK Documentation (Go, Python, JS)"],
    integrationAPIs: ["All public API endpoints", "Webhook subscriptions", "Sandbox environment", "Developer portal"],
  },
];

export default function StakeholderOnboarding() {
  const [selectedStakeholder, setSelectedStakeholder] = useState<string>("trader");
  const [activeTab, setActiveTab] = useState<"onboarding" | "workflow" | "sla" | "apis">("onboarding");

  const stakeholder = STAKEHOLDERS.find((s) => s.id === selectedStakeholder)!;

  return (
    <section id="stakeholder-onboarding" className="py-20 bg-[#0D1E35]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Stakeholder Onboarding · Workflow Management
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Stakeholder Onboarding Portal
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Comprehensive onboarding journeys, role-based access control, workflow processes, and SLA commitments
            for all 8 stakeholder groups. Every group has a defined path from registration to production access.
          </p>
        </div>

        {/* Stakeholder Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-8">
          {STAKEHOLDERS.map((s) => (
            <button
              key={s.id}
              onClick={() => { setSelectedStakeholder(s.id); setActiveTab("onboarding"); }}
              className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${
                selectedStakeholder === s.id
                  ? "border-[#D4A017]/50 bg-[#D4A017]/10"
                  : "border-slate-700/30 bg-slate-900/30 hover:border-slate-600/50"
              }`}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: s.bgColor, color: s.color }}>
                {s.icon}
              </div>
              <span className={`text-xs font-semibold leading-tight ${selectedStakeholder === s.id ? "text-[#D4A017]" : "text-slate-400"}`}>
                {s.shortName}
              </span>
            </button>
          ))}
        </div>

        {/* Stakeholder Detail */}
        <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl overflow-hidden">
          {/* Stakeholder Header */}
          <div className="px-6 py-5 border-b border-slate-700/30" style={{ background: `${stakeholder.bgColor}40` }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: stakeholder.bgColor, color: stakeholder.color }}>
                  {stakeholder.icon}
                </div>
                <div>
                  <h3 className="text-xl font-bold text-white">{stakeholder.name}</h3>
                  <p className="text-sm text-slate-400">{stakeholder.description}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full text-xs font-semibold" style={{ background: `${stakeholder.color}20`, color: stakeholder.color }}>
                  {stakeholder.count}
                </span>
                {stakeholder.keycloakRoles.slice(0, 2).map((role) => (
                  <span key={role} className="px-2 py-1 rounded-full text-xs bg-slate-800 text-slate-400 font-mono">
                    {role}
                  </span>
                ))}
                {stakeholder.keycloakRoles.length > 2 && (
                  <span className="px-2 py-1 rounded-full text-xs bg-slate-800 text-slate-500">
                    +{stakeholder.keycloakRoles.length - 2} roles
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-slate-700/30 overflow-x-auto">
            {[
              { id: "onboarding", label: "Onboarding Journey", icon: <Users className="w-3.5 h-3.5" /> },
              { id: "workflow", label: "Workflow Processes", icon: <Workflow className="w-3.5 h-3.5" /> },
              { id: "sla", label: "SLA Commitments", icon: <Clock className="w-3.5 h-3.5" /> },
              { id: "apis", label: "APIs & Training", icon: <Key className="w-3.5 h-3.5" /> },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`flex items-center gap-2 px-5 py-3.5 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-[#D4A017] text-[#D4A017]"
                    : "border-transparent text-slate-500 hover:text-slate-300"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Onboarding Journey */}
            {activeTab === "onboarding" && (
              <div className="space-y-4">
                {stakeholder.onboardingSteps.map((step, idx) => (
                  <div key={step.step} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: stakeholder.bgColor, color: stakeholder.color }}>
                        {step.step}
                      </div>
                      {idx < stakeholder.onboardingSteps.length - 1 && (
                        <div className="w-0.5 flex-1 mt-2 mb-0" style={{ background: `${stakeholder.color}30` }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-bold text-white">{step.title}</h4>
                        <div className="flex gap-2">
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">{step.duration}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${stakeholder.color}15`, color: stakeholder.color }}>{step.responsible}</span>
                        </div>
                      </div>
                      <p className="text-sm text-slate-400 mb-2">{step.description}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {step.artifacts.map((a) => (
                          <span key={a} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-slate-800/50 text-slate-500">
                            <FileText className="w-3 h-3" /> {a}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Workflow Processes */}
            {activeTab === "workflow" && (
              <div className="space-y-6">
                {stakeholder.workflowProcesses.map((wf) => (
                  <div key={wf.name} className="bg-slate-900/40 rounded-xl p-5 border border-slate-700/30">
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                      <h4 className="text-base font-bold text-white">{wf.name}</h4>
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-900/30 text-emerald-400 font-semibold">{wf.sla}</span>
                    </div>
                    <div className="text-xs text-slate-500 mb-3">
                      <span className="text-[#D4A017]">Trigger:</span> {wf.trigger}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {wf.steps.map((step, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">{step}</span>
                          {i < wf.steps.length - 1 && <ChevronRight className="w-3 h-3 text-slate-600 flex-shrink-0" />}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-slate-500">
                      <span className="text-emerald-400">Outcome:</span> {wf.outcome}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* SLA Commitments */}
            {activeTab === "sla" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-3 px-4 text-slate-400 font-semibold">Metric</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-semibold">Target</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-semibold">Measurement</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50">
                    {stakeholder.slaCommitments.map((sla) => (
                      <tr key={sla.metric} className="hover:bg-white/2">
                        <td className="py-3 px-4 text-white font-medium">{sla.metric}</td>
                        <td className="py-3 px-4">
                          <span className="font-bold font-mono" style={{ color: stakeholder.color }}>{sla.target}</span>
                        </td>
                        <td className="py-3 px-4 text-slate-400">{sla.measurement}</td>
                        <td className="py-3 px-4">
                          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                            <CheckCircle className="w-3.5 h-3.5" /> Committed
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* APIs & Training */}
            {activeTab === "apis" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Key className="w-4 h-4" style={{ color: stakeholder.color }} />
                    <h4 className="text-sm font-bold text-white">Key API Endpoints</h4>
                  </div>
                  <div className="space-y-2">
                    {stakeholder.integrationAPIs.map((api) => (
                      <div key={api} className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-lg font-mono text-xs">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${api.startsWith("GET") ? "bg-blue-900/50 text-blue-400" : api.startsWith("POST") ? "bg-green-900/50 text-green-400" : api.startsWith("PUT") ? "bg-amber-900/50 text-amber-400" : "bg-slate-800 text-slate-400"}`}>
                          {api.split(" ")[0]}
                        </span>
                        <span className="text-slate-300">{api.split(" ").slice(1).join(" ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <BookOpen className="w-4 h-4" style={{ color: stakeholder.color }} />
                    <h4 className="text-sm font-bold text-white">Training Modules</h4>
                  </div>
                  <div className="space-y-2">
                    {stakeholder.trainingModules.map((module, i) => (
                      <div key={module} className="flex items-center gap-3 px-3 py-2 bg-slate-900/50 rounded-lg">
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: stakeholder.bgColor, color: stakeholder.color }}>
                          {i + 1}
                        </div>
                        <span className="text-sm text-slate-300">{module}</span>
                        <Star className="w-3 h-3 text-slate-700 ml-auto" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Summary Stats */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Stakeholder Groups", value: "8", desc: "Fully defined onboarding journeys" },
            { label: "Keycloak Roles", value: "28", desc: "Role-based access control" },
            { label: "Workflow Processes", value: "18", desc: "End-to-end process maps" },
            { label: "SLA Commitments", value: "32", desc: "Measurable service targets" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#0A1628] border border-slate-700/30 rounded-xl p-4 text-center">
              <div className="text-3xl font-bold text-[#D4A017] font-['Playfair_Display'] mb-1">{stat.value}</div>
              <div className="text-sm font-semibold text-white mb-0.5">{stat.label}</div>
              <div className="text-xs text-slate-500">{stat.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
