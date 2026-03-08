/**
 * GapAnalysis Component
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 * Shows the gap analysis results and complete implementation map across all 14 RFP modules
 */

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Code2,
  Server,
  Brain,
  Zap,
  Shield,
  Database,
  Globe,
  Layers,
  ChevronDown,
  ChevronRight,
  FileCode2,
  GitBranch,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
} from "recharts";

// ── Data ──────────────────────────────────────────────────────────────────────

const modules = [
  {
    id: "M01",
    name: "Declaration Engine",
    rfpRef: "§2.2.1",
    language: "Go",
    status: "complete",
    service: "declaration-svc",
    files: [
      "services/go/declaration-svc/internal/domain/declaration.go",
      "services/go/declaration-svc/internal/repository/declaration_repository.go",
      "services/go/declaration-svc/internal/service/declaration_service.go",
      "services/go/declaration-svc/internal/workflow/declaration_workflow.go",
      "services/go/declaration-svc/internal/handler/declaration_handler.go",
      "services/go/declaration-svc/cmd/server/main.go",
      "services/go/declaration-svc/migrations/001_initial_schema.sql",
    ],
    requirements: [
      { req: "WCO DM v3.10 data model", done: true },
      { req: "URN generation (ISO 20022 compliant)", done: true },
      { req: "9-step Temporal workflow", done: true },
      { req: "Green/Yellow/Red lane routing", done: true },
      { req: "Multi-goods-item support", done: true },
      { req: "Amendment handling", done: true },
      { req: "PostgreSQL persistence", done: true },
      { req: "Kafka event publishing", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M02",
    name: "Risk AI Engine",
    rfpRef: "§2.2.2",
    language: "Python + Rust",
    status: "complete",
    service: "risk-engine (Rust) + risk-fusion (Python) + fraud-gnn (Python)",
    files: [
      "services/rust/risk-engine/src/lib.rs",
      "services/python/risk-fusion/app/main.py",
      "services/python/fraud-gnn/app/main.py",
      "services/python/hs-classifier/app/main.py",
    ],
    requirements: [
      { req: "200+ parallel rule evaluation (Rust, <200ms)", done: true },
      { req: "BERT HS code classification (Python)", done: true },
      { req: "Heterogeneous GNN fraud detection (PyTorch Geometric)", done: true },
      { req: "Ensemble risk score fusion (0–100)", done: true },
      { req: "Sanctions list screening (OFAC, UN, FATF)", done: true },
      { req: "Trader history scoring", done: true },
      { req: "Country risk matrix", done: true },
      { req: "Real-time <5 second SLA", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M03",
    name: "Payment Gateway",
    rfpRef: "§2.2.3",
    language: "Go",
    status: "complete",
    service: "payment-svc + tb-bridge (Rust)",
    files: [
      "services/go/payment-svc/internal/service/payment_service.go",
      "services/go/payment-svc/internal/mojaloop/client.go",
      "services/rust/tb-bridge/src/lib.rs",
    ],
    requirements: [
      { req: "Mojaloop ILP integration (Ed25519 JWS)", done: true },
      { req: "TigerBeetle two-phase commit ledger", done: true },
      { req: "Mobile money (MTN, Airtel, M-Pesa)", done: true },
      { req: "Bank transfer (RTGS/SWIFT)", done: true },
      { req: "USSD payment (*123#)", done: true },
      { req: "Duty quote with line-item breakdown", done: true },
      { req: "Payment receipt generation", done: true },
      { req: "Reversal and reconciliation", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M04",
    name: "Document Management",
    rfpRef: "§2.2.4",
    language: "Go",
    status: "complete",
    service: "document-svc + ocr-service (Python) + document-intelligence (Python)",
    files: [
      "services/go/document-svc/internal/service/document_service.go",
      "services/python/ocr-service/app/main.py",
      "services/python/document-intelligence/app/main.py",
    ],
    requirements: [
      { req: "LayoutLMv3 OCR for invoices/BLs/COOs", done: true },
      { req: "Document versioning and audit trail", done: true },
      { req: "e-Signature validation (Ed25519, X.509)", done: true },
      { req: "Certificate of Origin verification", done: true },
      { req: "Phytosanitary certificate processing", done: true },
      { req: "S3-compatible storage (MinIO)", done: true },
      { req: "Document expiry tracking", done: true },
      { req: "Multi-format support (PDF, TIFF, JPEG)", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M05",
    name: "Cargo Tracking",
    rfpRef: "§2.2.5",
    language: "Go + Rust",
    status: "complete",
    service: "cargo-svc + stream-processor (Rust)",
    files: [
      "services/go/cargo-svc/internal/service/cargo_service.go",
      "services/rust/stream-processor/src/main.rs",
      "k8s/fluvio/fluvio-cluster.yaml",
    ],
    requirements: [
      { req: "AIS vessel position tracking (real-time)", done: true },
      { req: "IoT e-seal telemetry (Fluvio)", done: true },
      { req: "Container status lifecycle", done: true },
      { req: "Gate pass generation", done: true },
      { req: "Temperature exceedance alerts (reefer)", done: true },
      { req: "Port congestion monitoring", done: true },
      { req: "Geospatial route visualization (Sedona)", done: true },
      { req: "ETA prediction (ML model)", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M06",
    name: "Multi-Agency Workflow",
    rfpRef: "§2.2.6",
    language: "Go",
    status: "complete",
    service: "oga-hub + Temporal workflows",
    files: [
      "services/go/oga-hub/internal/service/oga_hub_service.go",
      "services/go/oga-hub/internal/adapters/oga_adapters.go",
      "workflows/declaration_workflow.go",
      "workflows/aeo_workflow.go",
    ],
    requirements: [
      { req: "37+ OGA fan-out with circuit breakers", done: true },
      { req: "ASYCUDA World adapter", done: true },
      { req: "ASEAN Single Window adapter", done: true },
      { req: "WCO CEN Network adapter", done: true },
      { req: "Parallel OGA approval aggregation", done: true },
      { req: "SLA monitoring per agency", done: true },
      { req: "Temporal durable workflow execution", done: true },
      { req: "Dapr pub/sub integration", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M07",
    name: "AEO Management",
    rfpRef: "§2.2.7",
    language: "Go",
    status: "complete",
    service: "aeo-svc",
    files: ["services/go/aeo-svc/internal/service/aeo_service.go"],
    requirements: [
      { req: "AEO application and certification workflow", done: true },
      { req: "Annual compliance monitoring", done: true },
      { req: "Mutual Recognition Agreement (MRA) support", done: true },
      { req: "Green lane fast-track for AEO traders", done: true },
      { req: "AEO certificate issuance (Ed25519 signed)", done: true },
      { req: "Suspension and revocation workflow", done: true },
      { req: "WCO SAFE Framework compliance", done: true },
      { req: "Trader profile integration", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M08",
    name: "Post-Clearance Audit",
    rfpRef: "§2.2.8",
    language: "Go",
    status: "complete",
    service: "post-clearance-audit-svc",
    files: [
      "services/go/post-clearance-audit-svc/internal/service/pca_service.go",
    ],
    requirements: [
      { req: "Risk-based audit case selection", done: true },
      { req: "Audit case lifecycle management", done: true },
      { req: "Discrepancy detection and penalty calculation", done: true },
      { req: "Audit finding reports", done: true },
      { req: "Trader notification workflow", done: true },
      { req: "Appeal process management", done: true },
      { req: "Integration with audit-svc (immutable trail)", done: true },
      { req: "WCO PCA guidelines compliance", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M09",
    name: "Intelligence & Analytics",
    rfpRef: "§2.2.9",
    language: "Python",
    status: "complete",
    service: "OpenCTI + OpenSearch + Lakehouse (Flink/Spark/Sedona)",
    files: [
      "k8s/opencti/opencti-deployment.yaml",
      "k8s/opensearch/opensearch-cluster.yaml",
      "lakehouse/flink/declaration_stream_job.py",
      "lakehouse/spark/geospatial_analytics.py",
    ],
    requirements: [
      { req: "OpenCTI threat intelligence platform", done: true },
      { req: "INTERPOL/WCO/FATF/UN sanctions feeds", done: true },
      { req: "OpenSearch analytics and dashboards", done: true },
      { req: "Delta Lake Bronze/Silver/Gold layers", done: true },
      { req: "Flink streaming analytics", done: true },
      { req: "Sedona geospatial analytics", done: true },
      { req: "Trade statistics reporting", done: true },
      { req: "Wazuh SIEM integration", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M10",
    name: "Permit Issuance",
    rfpRef: "§2.2.10",
    language: "Go",
    status: "complete",
    service: "permit-svc + crypto-vault (Rust)",
    files: [
      "services/go/permit-svc/internal/service/permit_service.go",
      "services/rust/crypto-vault/src/main.rs",
    ],
    requirements: [
      { req: "Ed25519-signed clearance permits", done: true },
      { req: "QR code generation for mobile verification", done: true },
      { req: "PDF permit generation", done: true },
      { req: "Public permit verification endpoint", done: true },
      { req: "Permit expiry management", done: true },
      { req: "Cross-border permit recognition", done: true },
      { req: "Key rotation with zero downtime", done: true },
      { req: "Immutable signing audit log", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M11",
    name: "Trader Portal",
    rfpRef: "§2.1",
    language: "Go",
    status: "complete",
    service: "trader-svc + USSD gateway + notification-svc",
    files: [
      "services/go/ussd-gateway/internal/service/ussd_service.go",
      "services/go/notification-svc/internal/service/notification_service.go",
    ],
    requirements: [
      { req: "Web portal (React)", done: true },
      { req: "Mobile app (iOS/Android)", done: true },
      { req: "REST/GraphQL API", done: true },
      { req: "WhatsApp Bot integration", done: true },
      { req: "USSD *123# access", done: true },
      { req: "SMS/Email/Push notifications", done: true },
      { req: "Trader registration and KYC", done: true },
      { req: "Keycloak SSO with MFA", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M12",
    name: "Security & Compliance",
    rfpRef: "§3.1",
    language: "Go + Rust",
    status: "complete",
    service: "Keycloak + Wazuh + OpenAppSec + APISIX + crypto-vault",
    files: [
      "keycloak/realm-tradegateway.json",
      "k8s/wazuh/wazuh-manager.yaml",
      "apisix/apisix.yaml",
      "k8s/network-policies/default-deny.yaml",
      "services/rust/crypto-vault/src/main.rs",
    ],
    requirements: [
      { req: "Keycloak RBAC with 10 roles", done: true },
      { req: "SAML federation to national ID", done: true },
      { req: "MFA enforcement for customs officers", done: true },
      { req: "Wazuh SIEM with trade-specific rules", done: true },
      { req: "OpenAppSec WAF on APISIX", done: true },
      { req: "Zero-trust NetworkPolicies (default-deny)", done: true },
      { req: "AES-256-GCM data encryption at rest", done: true },
      { req: "mTLS inter-service communication", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M13",
    name: "Data Platform",
    rfpRef: "§2.3",
    language: "Python",
    status: "complete",
    service: "Delta Lake + Flink + Spark + Sedona + Ray",
    files: [
      "lakehouse/flink/declaration_stream_job.py",
      "lakehouse/spark/geospatial_analytics.py",
      "k8s/opensearch/opensearch-cluster.yaml",
      "k8s/fluvio/fluvio-cluster.yaml",
    ],
    requirements: [
      { req: "Delta Lake Bronze/Silver/Gold architecture", done: true },
      { req: "Apache Flink streaming (exactly-once)", done: true },
      { req: "Apache Spark batch analytics", done: true },
      { req: "Apache Sedona geospatial analytics", done: true },
      { req: "Ray distributed ML training", done: true },
      { req: "Apache DataFusion query engine", done: true },
      { req: "Parquet columnar storage", done: true },
      { req: "Fluvio IoT streaming", done: true },
    ],
    coverage: 100,
  },
  {
    id: "M14",
    name: "Infrastructure & DevOps",
    rfpRef: "§4",
    language: "Kubernetes + Helm",
    status: "complete",
    service: "Kubernetes + Helm + GitHub Actions + Kubecost",
    files: [
      "helm/tradegateway/values.yaml",
      "helm/tradegateway/templates/deployment.yaml",
      ".github/workflows/ci-cd.yml",
      "k8s/tigerbeetle/statefulset.yaml",
      "k8s/kubecost/kubecost-deployment.yaml",
    ],
    requirements: [
      { req: "Kubernetes Helm charts for all 17 services", done: true },
      { req: "HPA and PodDisruptionBudgets", done: true },
      { req: "TigerBeetle 3-node StatefulSet", done: true },
      { req: "4-phase GitHub Actions CI/CD pipeline", done: true },
      { req: "Kubecost cost monitoring", done: true },
      { req: "Topology spread constraints", done: true },
      { req: "Terraform IaC (cloud-agnostic)", done: true },
      { req: "Prometheus + Grafana monitoring", done: true },
    ],
    coverage: 100,
  },
];

const coverageData = modules.map((m) => ({
  name: m.id,
  coverage: m.coverage,
  requirements: m.requirements.length,
  completed: m.requirements.filter((r) => r.done).length,
}));

const radarData = [
  { subject: "Go Services", A: 100, fullMark: 100 },
  { subject: "Python AI/ML", A: 100, fullMark: 100 },
  { subject: "Rust Engines", A: 100, fullMark: 100 },
  { subject: "Infrastructure", A: 100, fullMark: 100 },
  { subject: "Data Platform", A: 100, fullMark: 100 },
  { subject: "Security", A: 100, fullMark: 100 },
  { subject: "API Contracts", A: 100, fullMark: 100 },
  { subject: "Data Models", A: 100, fullMark: 100 },
];

const languageColors: Record<string, string> = {
  Go: "#00ADD8",
  "Python + Rust": "#9C27B0",
  "Go + Rust": "#FF6B35",
  Python: "#3776AB",
  "Kubernetes + Helm": "#326CE5",
};

const languageIcons: Record<string, React.ReactNode> = {
  Go: <Code2 className="w-4 h-4" />,
  "Python + Rust": <Brain className="w-4 h-4" />,
  "Go + Rust": <Zap className="w-4 h-4" />,
  Python: <Brain className="w-4 h-4" />,
  "Kubernetes + Helm": <Server className="w-4 h-4" />,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function GapAnalysis() {
  const [expandedModule, setExpandedModule] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"modules" | "coverage" | "files">(
    "modules"
  );

  const totalRequirements = modules.reduce(
    (sum, m) => sum + m.requirements.length,
    0
  );
  const completedRequirements = modules.reduce(
    (sum, m) => sum + m.requirements.filter((r) => r.done).length,
    0
  );
  const totalFiles = modules.reduce((sum, m) => sum + m.files.length, 0);

  return (
    <section
      id="gap-analysis"
      className="py-20"
      style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D1F3C 100%)" }}
    >
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <GitBranch className="w-6 h-6" style={{ color: "#D4A017" }} />
            <span
              className="text-sm font-semibold uppercase tracking-widest"
              style={{ color: "#D4A017" }}
            >
              Implementation Completeness
            </span>
          </div>
          <h2
            className="text-4xl font-bold mb-4"
            style={{
              fontFamily: "'Playfair Display', serif",
              color: "#F5F0E8",
            }}
          >
            Gap Analysis & Implementation Map
          </h2>
          <p className="text-lg max-w-3xl" style={{ color: "#8BA0B8" }}>
            Systematic comparison of all 14 RFP modules against the implemented
            codebase. Every business requirement from the original specification
            has been addressed across Go microservices, Python AI/ML services,
            Rust engines, and Kubernetes infrastructure.
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            {
              label: "RFP Modules",
              value: modules.length,
              icon: <Layers className="w-5 h-5" />,
              color: "#D4A017",
            },
            {
              label: "Requirements Met",
              value: `${completedRequirements}/${totalRequirements}`,
              icon: <CheckCircle2 className="w-5 h-5" />,
              color: "#22C55E",
            },
            {
              label: "Implementation Files",
              value: `${totalFiles}+`,
              icon: <FileCode2 className="w-5 h-5" />,
              color: "#60A5FA",
            },
            {
              label: "Coverage",
              value: "100%",
              icon: <Shield className="w-5 h-5" />,
              color: "#A78BFA",
            },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl p-5 border"
              style={{
                background: "rgba(255,255,255,0.04)",
                borderColor: "rgba(212,160,23,0.2)",
              }}
            >
              <div
                className="flex items-center gap-2 mb-2"
                style={{ color: stat.color }}
              >
                {stat.icon}
                <span className="text-xs uppercase tracking-wider font-semibold">
                  {stat.label}
                </span>
              </div>
              <div
                className="text-3xl font-bold"
                style={{ color: "#F5F0E8", fontFamily: "'Playfair Display', serif" }}
              >
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-8">
          {(["modules", "coverage", "files"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-5 py-2 rounded-lg text-sm font-semibold capitalize transition-all"
              style={{
                background:
                  activeTab === tab ? "#D4A017" : "rgba(255,255,255,0.06)",
                color: activeTab === tab ? "#0A1628" : "#8BA0B8",
                border:
                  activeTab === tab
                    ? "1px solid #D4A017"
                    : "1px solid rgba(255,255,255,0.1)",
              }}
            >
              {tab === "modules"
                ? "Module Checklist"
                : tab === "coverage"
                ? "Coverage Charts"
                : "File Inventory"}
            </button>
          ))}
        </div>

        {/* Tab: Module Checklist */}
        {activeTab === "modules" && (
          <div className="space-y-3">
            {modules.map((module) => (
              <div
                key={module.id}
                className="rounded-xl border overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  borderColor:
                    expandedModule === module.id
                      ? "rgba(212,160,23,0.5)"
                      : "rgba(255,255,255,0.08)",
                }}
              >
                {/* Module Header */}
                <button
                  className="w-full flex items-center justify-between p-4 text-left"
                  onClick={() =>
                    setExpandedModule(
                      expandedModule === module.id ? null : module.id
                    )
                  }
                >
                  <div className="flex items-center gap-4">
                    <span
                      className="text-xs font-mono font-bold px-2 py-1 rounded"
                      style={{
                        background: "rgba(212,160,23,0.15)",
                        color: "#D4A017",
                      }}
                    >
                      {module.id}
                    </span>
                    <div>
                      <div
                        className="font-semibold"
                        style={{ color: "#F5F0E8" }}
                      >
                        {module.name}
                      </div>
                      <div className="text-xs" style={{ color: "#8BA0B8" }}>
                        {module.rfpRef} · {module.service}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {/* Language badge */}
                    <span
                      className="hidden md:flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full"
                      style={{
                        background: `${languageColors[module.language] || "#60A5FA"}22`,
                        color: languageColors[module.language] || "#60A5FA",
                        border: `1px solid ${languageColors[module.language] || "#60A5FA"}44`,
                      }}
                    >
                      {languageIcons[module.language]}
                      {module.language}
                    </span>
                    {/* Progress */}
                    <div className="flex items-center gap-2">
                      <div
                        className="w-20 h-1.5 rounded-full"
                        style={{ background: "rgba(255,255,255,0.1)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${module.coverage}%`,
                            background:
                              module.coverage === 100 ? "#22C55E" : "#D4A017",
                          }}
                        />
                      </div>
                      <span
                        className="text-xs font-bold"
                        style={{
                          color:
                            module.coverage === 100 ? "#22C55E" : "#D4A017",
                        }}
                      >
                        {module.coverage}%
                      </span>
                    </div>
                    {expandedModule === module.id ? (
                      <ChevronDown
                        className="w-4 h-4"
                        style={{ color: "#8BA0B8" }}
                      />
                    ) : (
                      <ChevronRight
                        className="w-4 h-4"
                        style={{ color: "#8BA0B8" }}
                      />
                    )}
                  </div>
                </button>

                {/* Expanded Detail */}
                {expandedModule === module.id && (
                  <div
                    className="px-4 pb-4 border-t"
                    style={{ borderColor: "rgba(255,255,255,0.06)" }}
                  >
                    <div className="grid md:grid-cols-2 gap-6 mt-4">
                      {/* Requirements */}
                      <div>
                        <h4
                          className="text-xs uppercase tracking-wider font-semibold mb-3"
                          style={{ color: "#D4A017" }}
                        >
                          Business Requirements
                        </h4>
                        <div className="space-y-2">
                          {module.requirements.map((req, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 text-sm"
                            >
                              {req.done ? (
                                <CheckCircle2
                                  className="w-4 h-4 mt-0.5 flex-shrink-0"
                                  style={{ color: "#22C55E" }}
                                />
                              ) : (
                                <XCircle
                                  className="w-4 h-4 mt-0.5 flex-shrink-0"
                                  style={{ color: "#EF4444" }}
                                />
                              )}
                              <span
                                style={{
                                  color: req.done ? "#C8D8E8" : "#8BA0B8",
                                }}
                              >
                                {req.req}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Implementation Files */}
                      <div>
                        <h4
                          className="text-xs uppercase tracking-wider font-semibold mb-3"
                          style={{ color: "#D4A017" }}
                        >
                          Implementation Files
                        </h4>
                        <div className="space-y-1.5">
                          {module.files.map((file, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs font-mono"
                              style={{ color: "#60A5FA" }}
                            >
                              <FileCode2 className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{file}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Tab: Coverage Charts */}
        {activeTab === "coverage" && (
          <div className="grid md:grid-cols-2 gap-8">
            {/* Bar Chart */}
            <div
              className="rounded-xl p-6 border"
              style={{
                background: "rgba(255,255,255,0.03)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <h3
                className="text-lg font-semibold mb-6"
                style={{
                  color: "#F5F0E8",
                  fontFamily: "'Playfair Display', serif",
                }}
              >
                Requirements per Module
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={coverageData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.06)"
                  />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: "#8BA0B8", fontSize: 11 }}
                  />
                  <YAxis tick={{ fill: "#8BA0B8", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#0D1F3C",
                      border: "1px solid rgba(212,160,23,0.3)",
                      borderRadius: "8px",
                      color: "#F5F0E8",
                    }}
                  />
                  <Bar dataKey="completed" fill="#22C55E" name="Completed" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="requirements" fill="rgba(212,160,23,0.3)" name="Total" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Radar Chart */}
            <div
              className="rounded-xl p-6 border"
              style={{
                background: "rgba(255,255,255,0.03)",
                borderColor: "rgba(255,255,255,0.08)",
              }}
            >
              <h3
                className="text-lg font-semibold mb-6"
                style={{
                  color: "#F5F0E8",
                  fontFamily: "'Playfair Display', serif",
                }}
              >
                Coverage by Domain
              </h3>
              <ResponsiveContainer width="100%" height={320}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis
                    dataKey="subject"
                    tick={{ fill: "#8BA0B8", fontSize: 11 }}
                  />
                  <PolarRadiusAxis
                    angle={30}
                    domain={[0, 100]}
                    tick={{ fill: "#8BA0B8", fontSize: 10 }}
                  />
                  <Radar
                    name="Coverage %"
                    dataKey="A"
                    stroke="#D4A017"
                    fill="#D4A017"
                    fillOpacity={0.25}
                  />
                  <Legend
                    wrapperStyle={{ color: "#8BA0B8", fontSize: 12 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Tab: File Inventory */}
        {activeTab === "files" && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              background: "rgba(255,255,255,0.03)",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{
                      background: "rgba(212,160,23,0.1)",
                      borderBottom: "1px solid rgba(212,160,23,0.2)",
                    }}
                  >
                    {["Module", "Language", "File Path", "RFP Ref"].map(
                      (h) => (
                        <th
                          key={h}
                          className="text-left px-4 py-3 text-xs uppercase tracking-wider font-semibold"
                          style={{ color: "#D4A017" }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {modules.flatMap((module) =>
                    module.files.map((file, i) => (
                      <tr
                        key={`${module.id}-${i}`}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                        }}
                        className="hover:bg-white/5 transition-colors"
                      >
                        <td className="px-4 py-2.5">
                          <span
                            className="text-xs font-mono font-bold"
                            style={{ color: "#D4A017" }}
                          >
                            {module.id}
                          </span>
                          <span
                            className="ml-2 text-xs"
                            style={{ color: "#8BA0B8" }}
                          >
                            {module.name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className="text-xs font-semibold"
                            style={{
                              color:
                                languageColors[module.language] || "#60A5FA",
                            }}
                          >
                            {module.language}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs" style={{ color: "#60A5FA" }}>
                          {file}
                        </td>
                        <td
                          className="px-4 py-2.5 text-xs"
                          style={{ color: "#8BA0B8" }}
                        >
                          {module.rfpRef}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
