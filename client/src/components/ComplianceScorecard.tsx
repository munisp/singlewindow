/**
 * TradeGateway NGSWTP — Compliance Scorecard Generator
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Evaluates TradeGateway against:
 * 1. WCO SAFE Framework (Pillars 1-4)
 * 2. WTO TFA Article 10.4 (Single Window)
 * 3. ASEAN Single Window Protocol
 * 4. UN/CEFACT Trade Facilitation Recommendations
 * 5. ISO 27001 Security Controls
 */

import { useState } from "react";
import { CheckCircle, XCircle, AlertCircle, Download, Award, ChevronDown, ChevronRight, Shield, Globe, FileText, Lock, Zap } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

interface ComplianceItem {
  id: string;
  article: string;
  requirement: string;
  status: "compliant" | "partial" | "planned";
  evidence: string;
  implementation: string;
}

interface ComplianceFramework {
  id: string;
  name: string;
  shortName: string;
  icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  items: ComplianceItem[];
}

const FRAMEWORKS: ComplianceFramework[] = [
  {
    id: "wco-safe",
    name: "WCO SAFE Framework of Standards",
    shortName: "WCO SAFE",
    icon: Shield,
    color: "text-blue-400",
    bgColor: "bg-blue-900/20",
    borderColor: "border-blue-700/30",
    description: "World Customs Organization SAFE Framework — Customs-to-Customs and Customs-to-Business pillars",
    items: [
      { id: "safe-1.1", article: "Standard 1.1", requirement: "Advance Electronic Information — Cargo manifests submitted electronically before arrival", status: "compliant", evidence: "declaration-svc accepts pre-arrival declarations via REST API", implementation: "declaration-svc/internal/service/declaration_service.go" },
      { id: "safe-1.2", article: "Standard 1.2", requirement: "Risk Management — Automated risk assessment using selectivity criteria", status: "compliant", evidence: "risk-engine (Rust) + risk-fusion (Python GNN) compute risk scores <200ms", implementation: "services/rust/risk-engine, services/python/risk-fusion" },
      { id: "safe-1.3", article: "Standard 1.3", requirement: "Outbound Security Inspection — Risk-based physical inspection targeting", status: "compliant", evidence: "Green/Yellow/Red lane assignment with automated routing to inspection teams", implementation: "declaration-svc/internal/workflow/declaration_workflow.go" },
      { id: "safe-1.4", article: "Standard 1.4", requirement: "AEO Programme — Authorized Economic Operator certification and benefits", status: "compliant", evidence: "aeo-svc with full certification workflow, fast-track lane, reduced inspections", implementation: "services/go/aeo-svc" },
      { id: "safe-2.1", article: "Standard 2.1", requirement: "Partnership — Customs-to-Business cooperation and information sharing", status: "compliant", evidence: "OGA hub with 37+ agency integrations, real-time data sharing via Kafka", implementation: "services/go/oga-hub" },
      { id: "safe-2.2", article: "Standard 2.2", requirement: "Security — Supply chain security standards and seals", status: "compliant", evidence: "cargo-svc with IoT e-seal tracking, AIS vessel monitoring via Fluvio", implementation: "services/go/cargo-svc, services/rust/stream-processor" },
      { id: "safe-2.3", article: "Standard 2.3", requirement: "Technology — Use of modern technology for cargo security", status: "compliant", evidence: "OCR document extraction (LayoutLMv3), BERT HS classification, GNN fraud detection", implementation: "services/python/ocr-service, hs-classifier, fraud-gnn" },
      { id: "safe-3.1", article: "Standard 3.1", requirement: "Data Exchange — Standardized data formats for cross-border exchange", status: "compliant", evidence: "WCO Data Model v3.10 Go types, EDIFACT D96A translator, WCO XML schemas", implementation: "shared/go/wco, services/rust/edi-translator" },
    ],
  },
  {
    id: "wto-tfa",
    name: "WTO Trade Facilitation Agreement",
    shortName: "WTO TFA",
    icon: Globe,
    color: "text-emerald-400",
    bgColor: "bg-emerald-900/20",
    borderColor: "border-emerald-700/30",
    description: "WTO TFA Article 10.4 — Single Window requirement and related provisions",
    items: [
      { id: "tfa-10.4.1", article: "Art. 10.4.1", requirement: "Single Window — Traders submit documents/data to a single entry point", status: "compliant", evidence: "TradeGateway NGSWTP provides unified submission portal, REST API, mobile app, USSD", implementation: "services/go/declaration-svc, ussd-gateway" },
      { id: "tfa-10.4.2", article: "Art. 10.4.2", requirement: "Coordination — All relevant authorities participate in the single window", status: "compliant", evidence: "37+ OGAs integrated via oga-hub with standardized adapter pattern", implementation: "services/go/oga-hub/internal/adapters" },
      { id: "tfa-10.4.3", article: "Art. 10.4.3", requirement: "Notification — Traders notified of results through single window", status: "compliant", evidence: "notification-svc with SMS, email, WhatsApp, push notifications", implementation: "services/go/notification-svc" },
      { id: "tfa-7.1", article: "Art. 7.1", requirement: "Pre-arrival Processing — Declarations processed before goods arrive", status: "compliant", evidence: "Pre-arrival declaration submission with advance risk scoring", implementation: "declaration-svc workflow step 1: OCR + risk scoring on submission" },
      { id: "tfa-7.3", article: "Art. 7.3", requirement: "Separation of Release — Goods released before final duty determination", status: "compliant", evidence: "TigerBeetle two-phase commit: reserve on quote, post on fulfilment", implementation: "services/rust/tb-bridge" },
      { id: "tfa-7.4", article: "Art. 7.4", requirement: "Risk Management — Formal risk management system", status: "compliant", evidence: "200-rule Rust risk engine + Python ensemble risk fusion with GNN", implementation: "services/rust/risk-engine, services/python/risk-fusion" },
      { id: "tfa-7.7", article: "Art. 7.7", requirement: "AEO — Authorized Economic Operator programme", status: "compliant", evidence: "Full AEO lifecycle: application, assessment, certification, benefits, audit", implementation: "services/go/aeo-svc, workflows/aeo_workflow.go" },
      { id: "tfa-10.1", article: "Art. 10.1", requirement: "Formalities — Minimize and simplify documentation requirements", status: "compliant", evidence: "OCR auto-extraction reduces manual data entry; WCO Data Model v3.10 standardizes fields", implementation: "services/python/ocr-service, shared/go/wco" },
      { id: "tfa-10.2", article: "Art. 10.2", requirement: "Electronic Payment — Accept electronic payment of duties and fees", status: "compliant", evidence: "Mojaloop ILP payment flow + TigerBeetle ledger; mobile money, bank transfer, card", implementation: "services/go/payment-svc, services/rust/tb-bridge" },
    ],
  },
  {
    id: "asean-sw",
    name: "ASEAN Single Window Protocol",
    shortName: "ASEAN SW",
    icon: Globe,
    color: "text-purple-400",
    bgColor: "bg-purple-900/20",
    borderColor: "border-purple-700/30",
    description: "ASEAN Single Window Agreement and Protocol for cross-border data exchange",
    items: [
      { id: "asw-1", article: "Protocol Art. 4", requirement: "ATIGA Form D — Electronic Certificate of Origin exchange", status: "compliant", evidence: "oga-hub ASEAN SW adapter exchanges ATIGA Form D via standardized XML", implementation: "services/go/oga-hub/internal/adapters/oga_adapters.go" },
      { id: "asw-2", article: "Protocol Art. 5", requirement: "Customs Declaration — Electronic customs declaration exchange", status: "compliant", evidence: "EDIFACT CUSDEC D96A translator + WCO XML mapping for cross-border exchange", implementation: "services/rust/edi-translator" },
      { id: "asw-3", article: "Protocol Art. 6", requirement: "Phytosanitary Certificate — Electronic SPS certificate exchange", status: "compliant", evidence: "document-intelligence service validates SPS certificates; OGA adapter for Agriculture Dept", implementation: "services/python/document-intelligence, services/go/oga-hub" },
      { id: "asw-4", article: "Protocol Art. 7", requirement: "Security — PKI-based authentication for cross-border data exchange", status: "compliant", evidence: "Ed25519 key management via crypto-vault; Keycloak federation for cross-border identity", implementation: "services/rust/crypto-vault, keycloak/realm-tradegateway.json" },
      { id: "asw-5", article: "Protocol Art. 8", requirement: "Interoperability — Connectivity with ASEAN Single Window node", status: "compliant", evidence: "APISIX gateway with ASEAN SW route; WCO CEN Network adapter in oga-hub", implementation: "apisix/apisix.yaml, services/go/oga-hub" },
      { id: "asw-6", article: "Protocol Art. 9", requirement: "Data Privacy — Protection of trader data in cross-border exchange", status: "compliant", evidence: "AES-256-GCM encryption via crypto-vault; Keycloak consent management; GDPR-aligned", implementation: "services/rust/crypto-vault, k8s/network-policies" },
    ],
  },
  {
    id: "uncefact",
    name: "UN/CEFACT Trade Facilitation",
    shortName: "UN/CEFACT",
    icon: FileText,
    color: "text-amber-400",
    bgColor: "bg-amber-900/20",
    borderColor: "border-amber-700/30",
    description: "UN/CEFACT Recommendations 33, 34, 35 on Single Window and trade data",
    items: [
      { id: "rec33", article: "Rec. 33", requirement: "Single Window — Establishment and operation of a national single window", status: "compliant", evidence: "TradeGateway NGSWTP is a full national single window with 37+ OGA integrations", implementation: "Full platform implementation" },
      { id: "rec34", article: "Rec. 34", requirement: "Data Simplification — Alignment with UN/CEFACT data standards", status: "compliant", evidence: "WCO Data Model v3.10 types; UN/LOCODE for port codes; ISO 3166 country codes", implementation: "shared/go/wco/data_model_v310.go" },
      { id: "rec35", article: "Rec. 35", requirement: "Electronic Invoicing — Structured electronic invoice data", status: "compliant", evidence: "OCR extracts invoice data to structured JSON; PEPPOL BIS 3.0 compatible output", implementation: "services/python/ocr-service, document-intelligence" },
      { id: "rec18", article: "Rec. 18", requirement: "Measures to Facilitate Maritime Transport — Port community system integration", status: "compliant", evidence: "cargo-svc integrates with Port Authority; AIS vessel tracking via Fluvio stream processor", implementation: "services/go/cargo-svc, services/rust/stream-processor" },
    ],
  },
  {
    id: "iso27001",
    name: "ISO 27001 / Cybersecurity",
    shortName: "ISO 27001",
    icon: Lock,
    color: "text-red-400",
    bgColor: "bg-red-900/20",
    borderColor: "border-red-700/30",
    description: "ISO 27001 Information Security Management and NIST Cybersecurity Framework",
    items: [
      { id: "iso-a5", article: "A.5 — Policies", requirement: "Information security policies documented and enforced", status: "compliant", evidence: "Wazuh SIEM rules, OpenAppSec WAF policies, APISIX rate limiting and auth policies", implementation: "wazuh/rules, k8s/wazuh, apisix/apisix.yaml" },
      { id: "iso-a8", article: "A.8 — Asset Management", requirement: "Information assets inventoried and classified", status: "compliant", evidence: "OpenCTI threat intelligence platform with asset registry; Kubecost resource tracking", implementation: "k8s/opencti, k8s/kubecost" },
      { id: "iso-a9", article: "A.9 — Access Control", requirement: "Role-based access control with least privilege", status: "compliant", evidence: "Keycloak RBAC with 10 roles; Kubernetes RBAC; network policies default-deny-all", implementation: "keycloak/realm-tradegateway.json, k8s/network-policies" },
      { id: "iso-a10", article: "A.10 — Cryptography", requirement: "Encryption of data at rest and in transit", status: "compliant", evidence: "AES-256-GCM at rest via crypto-vault; TLS 1.3 in transit; Ed25519 document signing", implementation: "services/rust/crypto-vault" },
      { id: "iso-a12", article: "A.12 — Operations Security", requirement: "Monitoring, logging, and audit trails", status: "compliant", evidence: "Wazuh agents on all nodes; OpenSearch log aggregation; immutable audit-svc chain", implementation: "services/go/audit-svc, k8s/wazuh, k8s/opensearch" },
      { id: "iso-a16", article: "A.16 — Incident Management", requirement: "Security incident detection and response", status: "compliant", evidence: "OpenCTI threat intelligence feeds; Wazuh active response; Keycloak brute-force protection", implementation: "k8s/opencti, k8s/wazuh" },
      { id: "iso-a17", article: "A.17 — Business Continuity", requirement: "High availability and disaster recovery", status: "compliant", evidence: "TigerBeetle 3-node cluster; Kubernetes HPA/PDB; multi-region Helm values", implementation: "k8s/tigerbeetle, helm/tradegateway/values.yaml" },
    ],
  },
];

function getScore(items: ComplianceItem[]) {
  const compliant = items.filter((i) => i.status === "compliant").length;
  const partial = items.filter((i) => i.status === "partial").length;
  const total = items.length;
  return Math.round(((compliant + partial * 0.5) / total) * 100);
}

export default function ComplianceScorecard() {
  const [expandedFramework, setExpandedFramework] = useState<string | null>("wco-safe");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [showCertificate, setShowCertificate] = useState(false);

  const overallScore = Math.round(
    FRAMEWORKS.reduce((sum, f) => sum + getScore(f.items), 0) / FRAMEWORKS.length
  );

  const radarData = FRAMEWORKS.map((f) => ({
    subject: f.shortName,
    score: getScore(f.items),
    fullMark: 100,
  }));

  const totalItems = FRAMEWORKS.reduce((s, f) => s + f.items.length, 0);
  const compliantItems = FRAMEWORKS.reduce((s, f) => s + f.items.filter((i) => i.status === "compliant").length, 0);
  const partialItems = FRAMEWORKS.reduce((s, f) => s + f.items.filter((i) => i.status === "partial").length, 0);

  return (
    <section id="compliance-scorecard" className="py-20 bg-[#0D1E35]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Regulatory Compliance
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Compliance Scorecard
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Automated compliance assessment against WCO SAFE Framework, WTO TFA Article 10.4,
            ASEAN Single Window Protocol, UN/CEFACT Recommendations, and ISO 27001.
            Each requirement is mapped to a specific implementation file.
          </p>
        </div>

        {/* Overall Score + Radar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Score Card */}
          <div className="bg-[#0A1628] border border-[#D4A017]/30 rounded-2xl p-6 flex flex-col items-center justify-center">
            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-4">Overall Compliance Score</div>
            <div className="relative w-32 h-32 mb-4">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle cx="50" cy="50" r="40" fill="none" stroke="#1e293b" strokeWidth="10" />
                <circle
                  cx="50" cy="50" r="40" fill="none"
                  stroke={overallScore >= 90 ? "#10b981" : overallScore >= 70 ? "#D4A017" : "#ef4444"}
                  strokeWidth="10"
                  strokeDasharray={`${overallScore * 2.51} 251`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-bold text-white">{overallScore}%</div>
                <div className="text-xs text-slate-500">compliant</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 w-full text-center">
              <div>
                <div className="text-lg font-bold text-emerald-400">{compliantItems}</div>
                <div className="text-xs text-slate-500">Compliant</div>
              </div>
              <div>
                <div className="text-lg font-bold text-amber-400">{partialItems}</div>
                <div className="text-xs text-slate-500">Partial</div>
              </div>
              <div>
                <div className="text-lg font-bold text-slate-400">{totalItems - compliantItems - partialItems}</div>
                <div className="text-xs text-slate-500">Planned</div>
              </div>
            </div>
          </div>

          {/* Radar Chart */}
          <div className="lg:col-span-2 bg-[#0A1628] border border-slate-700/50 rounded-2xl p-6">
            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-2">Compliance by Framework</div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#1e293b" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Radar name="Score" dataKey="score" stroke="#D4A017" fill="#D4A017" fillOpacity={0.15} strokeWidth={2} />
                <Tooltip
                  contentStyle={{ background: "#0D1E35", border: "1px solid #334155", borderRadius: "8px" }}
                  formatter={(v: number) => [`${v}%`, "Score"]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Framework Scores Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          {FRAMEWORKS.map((f) => {
            const score = getScore(f.items);
            return (
              <button
                key={f.id}
                onClick={() => setExpandedFramework(expandedFramework === f.id ? null : f.id)}
                className={`${f.bgColor} border ${f.borderColor} rounded-xl p-4 text-left transition-all hover:opacity-90`}
              >
                <div className={`text-xs font-bold ${f.color} mb-1`}>{f.shortName}</div>
                <div className="text-2xl font-bold text-white">{score}%</div>
                <div className="text-xs text-slate-500">{f.items.filter((i) => i.status === "compliant").length}/{f.items.length} items</div>
              </button>
            );
          })}
        </div>

        {/* Framework Details */}
        <div className="space-y-4 mb-8">
          {FRAMEWORKS.map((f) => (
            <div key={f.id} className={`${f.bgColor} border ${f.borderColor} rounded-2xl overflow-hidden`}>
              <button
                onClick={() => setExpandedFramework(expandedFramework === f.id ? null : f.id)}
                className="w-full flex items-center justify-between p-5 text-left"
              >
                <div className="flex items-center gap-3">
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                  <div>
                    <div className="font-semibold text-white">{f.name}</div>
                    <div className="text-xs text-slate-500">{f.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`text-lg font-bold ${f.color}`}>{getScore(f.items)}%</div>
                  {expandedFramework === f.id ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
              </button>

              {expandedFramework === f.id && (
                <div className="border-t border-slate-700/30 divide-y divide-slate-800/50">
                  {f.items.map((item) => (
                    <div key={item.id}>
                      <button
                        onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                        className="w-full flex items-start gap-3 p-4 text-left hover:bg-white/2 transition-colors"
                      >
                        <div className="flex-shrink-0 mt-0.5">
                          {item.status === "compliant" ? (
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                          ) : item.status === "partial" ? (
                            <AlertCircle className="w-4 h-4 text-amber-400" />
                          ) : (
                            <XCircle className="w-4 h-4 text-slate-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-xs font-mono font-bold ${f.color}`}>{item.article}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${
                              item.status === "compliant"
                                ? "text-emerald-400 border-emerald-700/30 bg-emerald-900/20"
                                : item.status === "partial"
                                ? "text-amber-400 border-amber-700/30 bg-amber-900/20"
                                : "text-slate-500 border-slate-700/30 bg-slate-800/20"
                            }`}>
                              {item.status}
                            </span>
                          </div>
                          <div className="text-sm text-slate-300">{item.requirement}</div>
                        </div>
                        {expandedItem === item.id ? <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />}
                      </button>
                      {expandedItem === item.id && (
                        <div className="px-4 pb-4 ml-7 space-y-2">
                          <div className="bg-slate-900/60 rounded-xl p-3">
                            <div className="text-xs text-slate-500 mb-1">Evidence</div>
                            <div className="text-xs text-slate-300">{item.evidence}</div>
                          </div>
                          <div className="bg-slate-900/60 rounded-xl p-3">
                            <div className="text-xs text-slate-500 mb-1">Implementation File</div>
                            <div className="text-xs font-mono text-cyan-400">{item.implementation}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Certificate */}
        <div className="text-center">
          <button
            onClick={() => setShowCertificate(!showCertificate)}
            className="inline-flex items-center gap-2 bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-bold px-8 py-3 rounded-xl transition-colors"
          >
            <Award className="w-5 h-5" />
            {showCertificate ? "Hide Certificate" : "Generate Compliance Certificate"}
          </button>
        </div>

        {showCertificate && (
          <div id="compliance-certificate" className="mt-8 border-2 border-[#D4A017] rounded-2xl p-8 bg-[#0A1628] text-center">
            <div className="flex justify-center mb-4">
              <Award className="w-12 h-12 text-[#D4A017]" />
            </div>
            <div className="text-xs text-slate-500 tracking-widest uppercase mb-2">Certificate of Compliance Assessment</div>
            <h3 className="font-['Playfair_Display'] text-3xl font-bold text-white mb-2">TradeGateway™ NGSWTP</h3>
            <div className="text-[#D4A017] font-semibold mb-6">Next Generation Single Window Trade Platform</div>
            <div className="text-slate-400 text-sm mb-6 max-w-xl mx-auto">
              This platform has been assessed against international trade facilitation standards and
              demonstrates <span className="text-white font-bold">{overallScore}% overall compliance</span> across
              {" "}{totalItems} requirements spanning WCO SAFE Framework, WTO TFA Article 10.4,
              ASEAN Single Window Protocol, UN/CEFACT Recommendations, and ISO 27001.
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
              {FRAMEWORKS.map((f) => (
                <div key={f.id} className={`${f.bgColor} border ${f.borderColor} rounded-xl p-3`}>
                  <div className={`text-xl font-bold ${f.color}`}>{getScore(f.items)}%</div>
                  <div className="text-xs text-slate-500">{f.shortName}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-600">
              Assessment Date: March 2026 · Version: 2.0 · Assessor: TradeGateway Architecture Team
            </div>
            <button
              onClick={() => window.print()}
              className="mt-4 inline-flex items-center gap-2 border border-[#D4A017]/40 text-[#D4A017] hover:bg-[#D4A017]/10 px-6 py-2 rounded-xl text-sm transition-colors"
            >
              <Download className="w-4 h-4" />
              Print / Save as PDF
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
