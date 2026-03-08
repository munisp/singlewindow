/**
 * PhaseGantt Component
 * Design: Sovereign Blueprint — deep navy + gold
 * 24-month interactive implementation timeline with dependencies
 */

import { useState } from "react";
import { Calendar, CheckCircle2, Circle, Clock, Users, Server, Brain, Shield } from "lucide-react";

const phases = [
  {
    id: 1,
    name: "Phase 1: Foundation",
    subtitle: "Core Infrastructure & Declaration Engine",
    color: "#00ADD8",
    icon: Server,
    months: [1, 6],
    budget: "$4.2M",
    team: "32 engineers",
    milestones: [
      { name: "Kubernetes cluster provisioned", month: 1 },
      { name: "Keycloak IAM live", month: 2 },
      { name: "declaration-svc v1.0 deployed", month: 3 },
      { name: "APISIX gateway configured", month: 3 },
      { name: "TigerBeetle ledger cluster live", month: 4 },
      { name: "Mojaloop integration complete", month: 5 },
      { name: "Phase 1 UAT & go-live", month: 6 },
    ],
    deliverables: [
      "Kubernetes cluster (3 zones)",
      "Keycloak realm with 10 roles",
      "declaration-svc (Go)",
      "payment-svc + Mojaloop (Go)",
      "TigerBeetle 3-node cluster",
      "APISIX gateway + OpenAppSec",
      "PostgreSQL HA cluster",
      "Basic trader portal",
      "Kafka cluster (20 topics)",
      "Dapr sidecar mesh",
    ]
  },
  {
    id: 2,
    name: "Phase 2: AI & OGA Integration",
    subtitle: "Risk Engine, AI/ML Services, 37 Agency Connections",
    color: "#D4A017",
    icon: Brain,
    months: [5, 12],
    budget: "$6.8M",
    team: "48 engineers",
    milestones: [
      { name: "OCR service (LayoutLMv3) deployed", month: 6 },
      { name: "BERT HS classifier live", month: 7 },
      { name: "Rust risk-engine v1.0", month: 7 },
      { name: "First 10 OGAs connected", month: 8 },
      { name: "GNN fraud detection live", month: 9 },
      { name: "All 37 OGAs integrated", month: 11 },
      { name: "Phase 2 UAT & go-live", month: 12 },
    ],
    deliverables: [
      "ocr-service (Python/LayoutLMv3)",
      "hs-classifier (Python/BERT)",
      "risk-engine (Rust, 200+ rules)",
      "fraud-gnn (Python/PyTorch Geometric)",
      "risk-fusion ensemble (Python)",
      "oga-hub + 37 agency adapters (Go)",
      "document-svc with e-signature (Go)",
      "ASYCUDA World integration",
      "ASEAN Single Window connector",
      "WCO CEN Network adapter",
    ]
  },
  {
    id: 3,
    name: "Phase 3: Advanced Features",
    subtitle: "Cargo Tracking, AEO, Post-Clearance Audit",
    color: "#22C55E",
    icon: CheckCircle2,
    months: [11, 18],
    budget: "$3.9M",
    team: "36 engineers",
    milestones: [
      { name: "cargo-svc + AIS integration", month: 12 },
      { name: "IoT e-seal telemetry live", month: 13 },
      { name: "aeo-svc + AEO workflow", month: 14 },
      { name: "post-clearance-audit-svc", month: 15 },
      { name: "USSD gateway (*123#)", month: 16 },
      { name: "WhatsApp bot integration", month: 17 },
      { name: "Phase 3 UAT & go-live", month: 18 },
    ],
    deliverables: [
      "cargo-svc + AIS stream (Go + Rust)",
      "IoT e-seal telemetry pipeline",
      "aeo-svc + Temporal workflow (Go)",
      "post-clearance-audit-svc (Go)",
      "ussd-gateway (*123#) (Go)",
      "WhatsApp Business API bot",
      "stream-processor (Rust/Fluvio)",
      "crypto-vault (Rust/Ed25519)",
      "notification-svc multi-channel (Go)",
      "Mobile app iOS/Android",
    ]
  },
  {
    id: 4,
    name: "Phase 4: Lakehouse & Security",
    subtitle: "Data Platform, SIEM, Geospatial Analytics",
    color: "#A78BFA",
    icon: Shield,
    months: [17, 24],
    budget: "$5.1M",
    team: "40 engineers",
    milestones: [
      { name: "Delta Lake Bronze layer live", month: 18 },
      { name: "Flink streaming jobs deployed", month: 19 },
      { name: "Wazuh SIEM operational", month: 19 },
      { name: "OpenCTI threat intelligence", month: 20 },
      { name: "Sedona geospatial analytics", month: 21 },
      { name: "OpenSearch dashboards live", month: 22 },
      { name: "Full platform go-live", month: 24 },
    ],
    deliverables: [
      "Delta Lake (Bronze/Silver/Gold)",
      "Apache Flink streaming jobs",
      "Apache Spark batch analytics",
      "Apache Sedona geospatial engine",
      "Apache DataFusion query engine",
      "Ray distributed ML training",
      "Wazuh SIEM + custom rules",
      "OpenCTI threat intelligence",
      "OpenSearch cluster + dashboards",
      "Kubecost FinOps monitoring",
    ]
  }
];

const totalMonths = 24;
const monthLabels = Array.from({ length: totalMonths }, (_, i) => {
  const date = new Date(2024, 2 + i, 1); // Start March 2024
  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
});

export default function PhaseGantt() {
  const [hoveredPhase, setHoveredPhase] = useState<number | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<number | null>(1);
  const [hoveredMilestone, setHoveredMilestone] = useState<string | null>(null);

  const selected = phases.find(p => p.id === selectedPhase);

  return (
    <section id="roadmap" className="py-20" style={{ background: "#0A1628" }}>
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="w-6 h-6" style={{ color: "#D4A017" }} />
            <span className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#D4A017" }}>
              Implementation Roadmap
            </span>
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
            24-Month Phased Rollout
          </h2>
          <p className="text-lg max-w-3xl" style={{ color: "#8BA0B8" }}>
            Four overlapping phases with clear dependencies, milestones, and go-live gates. Total budget: <strong style={{ color: "#D4A017" }}>$20M</strong> over 24 months.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {phases.map(p => {
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => setSelectedPhase(p.id === selectedPhase ? null : p.id)}
                className="text-left p-4 rounded-xl border transition-all"
                style={{
                  background: selectedPhase === p.id ? `${p.color}18` : "rgba(255,255,255,0.03)",
                  borderColor: selectedPhase === p.id ? p.color : "rgba(255,255,255,0.08)",
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4" style={{ color: p.color }} />
                  <span className="text-xs font-semibold" style={{ color: p.color }}>Phase {p.id}</span>
                </div>
                <div className="text-sm font-semibold mb-1" style={{ color: "#F5F0E8" }}>M{p.months[0]}–M{p.months[1]}</div>
                <div className="text-xs mb-1" style={{ color: "#8BA0B8" }}>{p.budget}</div>
                <div className="flex items-center gap-1 text-xs" style={{ color: "#8BA0B8" }}>
                  <Users className="w-3 h-3" /> {p.team}
                </div>
              </button>
            );
          })}
        </div>

        {/* Gantt Chart */}
        <div className="rounded-2xl border overflow-hidden mb-8" style={{ background: "rgba(255,255,255,0.02)", borderColor: "rgba(255,255,255,0.08)" }}>
          {/* Month header */}
          <div className="border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
            <div className="flex">
              <div className="w-48 flex-shrink-0 p-3 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                <span className="text-xs font-semibold" style={{ color: "#8BA0B8" }}>PHASE</span>
              </div>
              <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: `repeat(${totalMonths}, 1fr)` }}>
                {monthLabels.map((m, i) => (
                  <div key={i} className="text-center py-2 border-r" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
                    <span className="text-xs" style={{ color: "rgba(139,160,184,0.7)", fontSize: "9px" }}>{m}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Phase rows */}
          {phases.map(p => {
            const startPct = ((p.months[0] - 1) / totalMonths) * 100;
            const widthPct = ((p.months[1] - p.months[0] + 1) / totalMonths) * 100;
            return (
              <div
                key={p.id}
                className="flex border-b transition-all"
                style={{ borderColor: "rgba(255,255,255,0.04)", background: hoveredPhase === p.id ? "rgba(255,255,255,0.03)" : "transparent" }}
                onMouseEnter={() => setHoveredPhase(p.id)}
                onMouseLeave={() => setHoveredPhase(null)}
              >
                <div className="w-48 flex-shrink-0 p-3 border-r" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <div className="text-xs font-semibold mb-0.5" style={{ color: p.color }}>Phase {p.id}</div>
                  <div className="text-xs leading-tight" style={{ color: "#8BA0B8" }}>{p.subtitle.split(",")[0]}</div>
                </div>
                <div className="flex-1 relative py-3 px-1">
                  {/* Bar */}
                  <div
                    className="absolute top-3 bottom-3 rounded-lg flex items-center px-3"
                    style={{
                      left: `${startPct}%`,
                      width: `${widthPct}%`,
                      background: `${p.color}28`,
                      border: `1px solid ${p.color}55`,
                    }}
                  >
                    <span className="text-xs font-semibold truncate" style={{ color: p.color }}>
                      M{p.months[0]}–M{p.months[1]}
                    </span>
                  </div>
                  {/* Milestones */}
                  {p.milestones.map((ms, mi) => {
                    const leftPct = ((ms.month - 1) / totalMonths) * 100;
                    return (
                      <div
                        key={mi}
                        className="absolute top-1/2 -translate-y-1/2 cursor-pointer z-10"
                        style={{ left: `${leftPct}%` }}
                        onMouseEnter={() => setHoveredMilestone(`${p.id}-${mi}`)}
                        onMouseLeave={() => setHoveredMilestone(null)}
                      >
                        <div
                          className="w-3 h-3 rounded-full border-2 transition-transform"
                          style={{
                            background: "#0A1628",
                            borderColor: p.color,
                            transform: hoveredMilestone === `${p.id}-${mi}` ? "scale(1.5)" : "scale(1)"
                          }}
                        />
                        {hoveredMilestone === `${p.id}-${mi}` && (
                          <div
                            className="absolute bottom-5 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-xs whitespace-nowrap z-20"
                            style={{ background: "#0D1F3C", border: `1px solid ${p.color}`, color: "#F5F0E8" }}
                          >
                            M{ms.month}: {ms.name}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Today marker */}
          <div className="flex">
            <div className="w-48 flex-shrink-0" />
            <div className="flex-1 relative h-6">
              <div
                className="absolute top-0 bottom-0 w-0.5 flex flex-col items-center"
                style={{ left: `${(1 / totalMonths) * 100}%`, background: "#EF4444" }}
              >
                <div className="text-xs px-1 rounded" style={{ background: "#EF4444", color: "white", fontSize: "9px", marginTop: "2px" }}>TODAY</div>
              </div>
            </div>
          </div>
        </div>

        {/* Selected Phase Detail */}
        {selected && (
          <div className="rounded-2xl border p-6" style={{ background: `${selected.color}0A`, borderColor: `${selected.color}33` }}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold mb-1" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>{selected.name}</h3>
                <p className="text-sm" style={{ color: "#8BA0B8" }}>{selected.subtitle}</p>
              </div>
              <div className="flex gap-4 text-right">
                <div>
                  <div className="text-lg font-bold" style={{ color: selected.color, fontFamily: "'Playfair Display', serif" }}>{selected.budget}</div>
                  <div className="text-xs" style={{ color: "#8BA0B8" }}>Budget</div>
                </div>
                <div>
                  <div className="text-lg font-bold" style={{ color: selected.color, fontFamily: "'Playfair Display', serif" }}>{selected.team}</div>
                  <div className="text-xs" style={{ color: "#8BA0B8" }}>Team</div>
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: selected.color }}>Key Milestones</div>
                <div className="space-y-2">
                  {selected.milestones.map((ms, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Clock className="w-3 h-3" style={{ color: selected.color }} />
                        <span className="text-xs font-mono" style={{ color: selected.color }}>M{ms.month}</span>
                      </div>
                      <span className="text-sm" style={{ color: "#C8D8E8" }}>{ms.name}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider font-semibold mb-3" style={{ color: selected.color }}>Deliverables</div>
                <div className="grid grid-cols-1 gap-1.5">
                  {selected.deliverables.map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Circle className="w-2 h-2 flex-shrink-0" style={{ color: selected.color }} />
                      <span className="text-sm" style={{ color: "#C8D8E8" }}>{d}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
