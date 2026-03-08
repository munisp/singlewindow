/**
 * TradeGateway NGSWTP — Kubernetes Resource Map
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Interactive diagram showing all 17 services deployed across namespaces:
 * - core (Go microservices)
 * - ai-ml (Python services)
 * - engines (Rust engines)
 * - infra (Kafka, Redis, TigerBeetle, Postgres, Temporal)
 * - security (Keycloak, Wazuh, OpenCTI, OpenSearch)
 *
 * Each service shows: HPA min/max, CPU/memory requests, replica count
 */

import { useState } from "react";
import { Server, Cpu, MemoryStick, ArrowUpDown, ChevronDown, ChevronUp, Activity, Shield, Database, Zap } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface K8sService {
  name: string;
  image: string;
  language: "Go" | "Python" | "Rust" | "Node" | "Java" | "Infra";
  replicas: number;
  hpaMin: number;
  hpaMax: number;
  cpuRequest: string;
  cpuLimit: string;
  memRequest: string;
  memLimit: string;
  port: number;
  protocol: "HTTP" | "gRPC" | "TCP";
  livenessPath?: string;
  dependencies: string[];
  pdb: boolean;
  topologySpread: boolean;
}

interface K8sNamespace {
  name: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  icon: React.ReactNode;
  services: K8sService[];
}

// ─── Data ─────────────────────────────────────────────────────────────────────

const NAMESPACES: K8sNamespace[] = [
  {
    name: "core",
    label: "Core Microservices",
    color: "#D4A017",
    bgColor: "bg-[#1A1400]/60",
    borderColor: "border-[#D4A017]/30",
    icon: <Server className="w-4 h-4" />,
    services: [
      { name: "declaration-svc", image: "tradegateway/declaration-svc:2.0", language: "Go", replicas: 3, hpaMin: 3, hpaMax: 20, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "256Mi", memLimit: "1Gi", port: 8080, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "kafka", "redis", "temporal"], pdb: true, topologySpread: true },
      { name: "payment-svc", image: "tradegateway/payment-svc:2.0", language: "Go", replicas: 3, hpaMin: 3, hpaMax: 15, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "256Mi", memLimit: "1Gi", port: 8081, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "kafka", "redis", "mojaloop-hub"], pdb: true, topologySpread: true },
      { name: "oga-hub", image: "tradegateway/oga-hub:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 10, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8082, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis", "postgres"], pdb: true, topologySpread: false },
      { name: "permit-svc", image: "tradegateway/permit-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 10, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8083, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "kafka", "crypto-vault"], pdb: true, topologySpread: false },
      { name: "tariff-svc", image: "tradegateway/tariff-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8084, protocol: "gRPC", livenessPath: "/health", dependencies: ["postgres", "redis"], pdb: false, topologySpread: false },
      { name: "audit-svc", image: "tradegateway/audit-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8085, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "kafka"], pdb: false, topologySpread: false },
      { name: "notification-svc", image: "tradegateway/notification-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "100m", cpuLimit: "500m", memRequest: "64Mi", memLimit: "256Mi", port: 8086, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis"], pdb: false, topologySpread: false },
      { name: "trader-svc", image: "tradegateway/trader-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8087, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "keycloak"], pdb: false, topologySpread: false },
      { name: "document-svc", image: "tradegateway/document-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 10, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "256Mi", memLimit: "1Gi", port: 8088, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "minio", "kafka"], pdb: false, topologySpread: false },
      { name: "cargo-svc", image: "tradegateway/cargo-svc:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "128Mi", memLimit: "512Mi", port: 8089, protocol: "HTTP", livenessPath: "/health", dependencies: ["postgres", "kafka", "redis"], pdb: false, topologySpread: false },
      { name: "ussd-gateway", image: "tradegateway/ussd-gateway:2.0", language: "Go", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "100m", cpuLimit: "500m", memRequest: "64Mi", memLimit: "256Mi", port: 8090, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis"], pdb: false, topologySpread: false },
    ]
  },
  {
    name: "ai-ml",
    label: "AI/ML Services",
    color: "#3B82F6",
    bgColor: "bg-[#0A1628]/60",
    borderColor: "border-blue-700/30",
    icon: <Cpu className="w-4 h-4" />,
    services: [
      { name: "ocr-service", image: "tradegateway/ocr-service:2.0", language: "Python", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "2Gi", memLimit: "8Gi", port: 8100, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "minio"], pdb: true, topologySpread: false },
      { name: "hs-classifier", image: "tradegateway/hs-classifier:2.0", language: "Python", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "4Gi", memLimit: "8Gi", port: 8101, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis"], pdb: false, topologySpread: false },
      { name: "fraud-gnn", image: "tradegateway/fraud-gnn:2.0", language: "Python", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "2000m", cpuLimit: "8000m", memRequest: "4Gi", memLimit: "16Gi", port: 8102, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis", "postgres"], pdb: true, topologySpread: false },
      { name: "risk-fusion", image: "tradegateway/risk-fusion:2.0", language: "Python", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "512Mi", memLimit: "2Gi", port: 8103, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "redis"], pdb: false, topologySpread: false },
      { name: "document-intelligence", image: "tradegateway/doc-intelligence:2.0", language: "Python", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "2Gi", memLimit: "8Gi", port: 8104, protocol: "HTTP", livenessPath: "/health", dependencies: ["kafka", "minio"], pdb: false, topologySpread: false },
    ]
  },
  {
    name: "engines",
    label: "Rust Engines",
    color: "#EF4444",
    bgColor: "bg-[#1A0A0A]/60",
    borderColor: "border-red-700/30",
    icon: <Zap className="w-4 h-4" />,
    services: [
      { name: "risk-engine", image: "tradegateway/risk-engine:2.0", language: "Rust", replicas: 3, hpaMin: 3, hpaMax: 12, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "128Mi", memLimit: "512Mi", port: 8200, protocol: "gRPC", livenessPath: undefined, dependencies: ["kafka", "redis"], pdb: true, topologySpread: true },
      { name: "tb-bridge", image: "tradegateway/tb-bridge:2.0", language: "Rust", replicas: 3, hpaMin: 3, hpaMax: 9, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "64Mi", memLimit: "256Mi", port: 8201, protocol: "gRPC", livenessPath: undefined, dependencies: ["tigerbeetle", "kafka"], pdb: true, topologySpread: true },
      { name: "stream-processor", image: "tradegateway/stream-processor:2.0", language: "Rust", replicas: 2, hpaMin: 2, hpaMax: 8, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "256Mi", memLimit: "1Gi", port: 8202, protocol: "TCP", livenessPath: undefined, dependencies: ["fluvio", "kafka"], pdb: false, topologySpread: false },
      { name: "crypto-vault", image: "tradegateway/crypto-vault:2.0", language: "Rust", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "64Mi", memLimit: "256Mi", port: 8203, protocol: "gRPC", livenessPath: undefined, dependencies: ["redis"], pdb: true, topologySpread: false },
      { name: "edi-translator", image: "tradegateway/edi-translator:2.0", language: "Rust", replicas: 2, hpaMin: 2, hpaMax: 6, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "64Mi", memLimit: "256Mi", port: 8204, protocol: "HTTP", livenessPath: undefined, dependencies: ["kafka"], pdb: false, topologySpread: false },
    ]
  },
  {
    name: "infra",
    label: "Infrastructure",
    color: "#10B981",
    bgColor: "bg-[#0A1A14]/60",
    borderColor: "border-emerald-700/30",
    icon: <Database className="w-4 h-4" />,
    services: [
      { name: "postgresql", image: "postgres:16-alpine", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 3, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "2Gi", memLimit: "8Gi", port: 5432, protocol: "TCP", dependencies: [], pdb: true, topologySpread: true },
      { name: "redis-cluster", image: "redis:7.2-alpine", language: "Infra", replicas: 6, hpaMin: 6, hpaMax: 6, cpuRequest: "250m", cpuLimit: "1000m", memRequest: "512Mi", memLimit: "2Gi", port: 6379, protocol: "TCP", dependencies: [], pdb: true, topologySpread: true },
      { name: "kafka-cluster", image: "strimzi/kafka:3.7", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 3, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "4Gi", memLimit: "8Gi", port: 9092, protocol: "TCP", dependencies: [], pdb: true, topologySpread: true },
      { name: "tigerbeetle", image: "ghcr.io/tigerbeetle/tigerbeetle:0.15", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 3, cpuRequest: "2000m", cpuLimit: "8000m", memRequest: "8Gi", memLimit: "32Gi", port: 3000, protocol: "TCP", dependencies: [], pdb: true, topologySpread: true },
      { name: "temporal-server", image: "temporalio/server:1.24", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 6, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "512Mi", memLimit: "2Gi", port: 7233, protocol: "gRPC", dependencies: ["postgresql"], pdb: true, topologySpread: false },
      { name: "fluvio", image: "infinyon/fluvio:0.11", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 3, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "1Gi", memLimit: "4Gi", port: 9003, protocol: "TCP", dependencies: [], pdb: true, topologySpread: false },
    ]
  },
  {
    name: "security",
    label: "Security & Identity",
    color: "#8B5CF6",
    bgColor: "bg-[#0F0A1A]/60",
    borderColor: "border-purple-700/30",
    icon: <Shield className="w-4 h-4" />,
    services: [
      { name: "keycloak", image: "quay.io/keycloak/keycloak:24", language: "Java", replicas: 3, hpaMin: 3, hpaMax: 6, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "1Gi", memLimit: "4Gi", port: 8443, protocol: "HTTP", livenessPath: "/health/live", dependencies: ["postgresql"], pdb: true, topologySpread: true },
      { name: "wazuh-manager", image: "wazuh/wazuh-manager:4.8", language: "Infra", replicas: 1, hpaMin: 1, hpaMax: 1, cpuRequest: "1000m", cpuLimit: "4000m", memRequest: "2Gi", memLimit: "8Gi", port: 1514, protocol: "TCP", dependencies: ["opensearch"], pdb: false, topologySpread: false },
      { name: "opensearch", image: "opensearchproject/opensearch:2.13", language: "Infra", replicas: 3, hpaMin: 3, hpaMax: 3, cpuRequest: "2000m", cpuLimit: "8000m", memRequest: "4Gi", memLimit: "16Gi", port: 9200, protocol: "HTTP", livenessPath: "/_cluster/health", dependencies: [], pdb: true, topologySpread: true },
      { name: "opencti", image: "opencti/platform:6.1", language: "Node", replicas: 2, hpaMin: 2, hpaMax: 4, cpuRequest: "500m", cpuLimit: "2000m", memRequest: "1Gi", memLimit: "4Gi", port: 4000, protocol: "HTTP", livenessPath: "/health", dependencies: ["opensearch", "redis"], pdb: false, topologySpread: false },
    ]
  }
];

const LANG_COLORS: Record<string, string> = {
  Go: "#00ADD8",
  Python: "#3776AB",
  Rust: "#CE422B",
  Node: "#68A063",
  Java: "#ED8B00",
  Infra: "#6B7280",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function KubernetesMap() {
  const [selectedService, setSelectedService] = useState<K8sService | null>(null);
  const [expandedNs, setExpandedNs] = useState<string[]>(["core", "ai-ml", "engines", "infra", "security"]);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const totalServices = NAMESPACES.reduce((s, ns) => s + ns.services.length, 0);
  const totalReplicas = NAMESPACES.reduce((s, ns) => s + ns.services.reduce((r, svc) => r + svc.replicas, 0), 0);
  const totalHpaMax = NAMESPACES.reduce((s, ns) => s + ns.services.reduce((r, svc) => r + svc.hpaMax, 0), 0);

  const toggleNs = (name: string) => {
    setExpandedNs(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  };

  return (
    <section id="k8s-map" className="py-20 bg-[#081422]">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Infrastructure
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Kubernetes Resource Map
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            All {totalServices} services deployed across 5 namespaces with HPA autoscaling,
            PodDisruptionBudgets, and topology spread constraints. Current replicas: {totalReplicas}.
            Maximum autoscale capacity: {totalHpaMax} pods.
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          {NAMESPACES.map(ns => (
            <div
              key={ns.name}
              className={`${ns.bgColor} border ${ns.borderColor} rounded-xl p-4 text-center cursor-pointer hover:opacity-80 transition-opacity`}
              onClick={() => toggleNs(ns.name)}
            >
              <div className="flex justify-center mb-2" style={{ color: ns.color }}>{ns.icon}</div>
              <div className="text-white font-bold text-xl">{ns.services.length}</div>
              <div className="text-slate-400 text-xs">{ns.label}</div>
            </div>
          ))}
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-3 mb-6">
          <div className="flex gap-1 bg-[#0D1E35] border border-slate-700/50 rounded-lg p-1">
            {(["grid", "table"] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-all capitalize ${
                  viewMode === mode
                    ? "bg-[#D4A017] text-[#0A1628]"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {mode === "grid" ? "Card View" : "Table View"}
              </button>
            ))}
          </div>
          <div className="flex gap-4 ml-auto text-sm">
            {Object.entries(LANG_COLORS).map(([lang, color]) => (
              <div key={lang} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color }} />
                <span className="text-slate-400">{lang}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Namespace Cards / Table */}
          <div className="xl:col-span-2 space-y-4">
            {NAMESPACES.map(ns => {
              const isExpanded = expandedNs.includes(ns.name);
              return (
                <div key={ns.name} className={`${ns.bgColor} border ${ns.borderColor} rounded-2xl overflow-hidden`}>
                  <button
                    className="w-full flex items-center justify-between p-5"
                    onClick={() => toggleNs(ns.name)}
                  >
                    <div className="flex items-center gap-3">
                      <div style={{ color: ns.color }}>{ns.icon}</div>
                      <div>
                        <span className="text-white font-bold">{ns.label}</span>
                        <span className="text-slate-500 text-sm ml-2">namespace: {ns.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span style={{ color: ns.color }} className="font-bold">{ns.services.length}</span>
                        <span className="text-slate-500 text-sm ml-1">services</span>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-700/30 p-4">
                      {viewMode === "grid" ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {ns.services.map(svc => (
                            <button
                              key={svc.name}
                              onClick={() => setSelectedService(selectedService?.name === svc.name ? null : svc)}
                              className={`text-left bg-[#0A1628]/60 border rounded-xl p-4 transition-all hover:border-opacity-80 ${
                                selectedService?.name === svc.name
                                  ? `border-[${ns.color}] shadow-lg`
                                  : "border-slate-700/40"
                              }`}
                              style={selectedService?.name === svc.name ? { borderColor: ns.color } : {}}
                            >
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <div className="text-white font-mono text-sm font-semibold">{svc.name}</div>
                                  <div className="text-slate-500 text-xs">{svc.protocol}</div>
                                </div>
                                <span
                                  className="text-xs px-2 py-0.5 rounded font-mono font-bold"
                                  style={{ backgroundColor: `${LANG_COLORS[svc.language]}20`, color: LANG_COLORS[svc.language] }}
                                >
                                  {svc.language}
                                </span>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-slate-800/50 rounded p-2 text-center">
                                  <div className="text-white font-bold">{svc.replicas}</div>
                                  <div className="text-slate-500">replicas</div>
                                </div>
                                <div className="bg-slate-800/50 rounded p-2 text-center">
                                  <div className="text-emerald-400 font-bold">{svc.hpaMin}–{svc.hpaMax}</div>
                                  <div className="text-slate-500">HPA</div>
                                </div>
                                <div className="bg-slate-800/50 rounded p-2 text-center">
                                  <div className="text-blue-400 font-bold">{svc.port}</div>
                                  <div className="text-slate-500">port</div>
                                </div>
                              </div>
                              <div className="flex gap-2 mt-2">
                                {svc.pdb && (
                                  <span className="text-xs bg-purple-900/30 text-purple-400 border border-purple-700/30 px-1.5 py-0.5 rounded">PDB</span>
                                )}
                                {svc.topologySpread && (
                                  <span className="text-xs bg-blue-900/30 text-blue-400 border border-blue-700/30 px-1.5 py-0.5 rounded">TopologySpread</span>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-500 uppercase tracking-wider">
                                <th className="text-left py-2 pr-4">Service</th>
                                <th className="text-center py-2 px-2">Lang</th>
                                <th className="text-center py-2 px-2">Replicas</th>
                                <th className="text-center py-2 px-2">HPA</th>
                                <th className="text-center py-2 px-2">CPU Req/Lim</th>
                                <th className="text-center py-2 px-2">Mem Req/Lim</th>
                                <th className="text-center py-2 px-2">Port</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ns.services.map(svc => (
                                <tr
                                  key={svc.name}
                                  className="border-t border-slate-700/30 hover:bg-slate-800/30 cursor-pointer"
                                  onClick={() => setSelectedService(selectedService?.name === svc.name ? null : svc)}
                                >
                                  <td className="py-2 pr-4 font-mono text-white">{svc.name}</td>
                                  <td className="py-2 px-2 text-center">
                                    <span style={{ color: LANG_COLORS[svc.language] }} className="font-bold">{svc.language}</span>
                                  </td>
                                  <td className="py-2 px-2 text-center text-white">{svc.replicas}</td>
                                  <td className="py-2 px-2 text-center text-emerald-400">{svc.hpaMin}–{svc.hpaMax}</td>
                                  <td className="py-2 px-2 text-center text-slate-300 font-mono">{svc.cpuRequest}/{svc.cpuLimit}</td>
                                  <td className="py-2 px-2 text-center text-slate-300 font-mono">{svc.memRequest}/{svc.memLimit}</td>
                                  <td className="py-2 px-2 text-center text-blue-400 font-mono">{svc.port}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Detail Panel */}
          <div className="space-y-4">
            {selectedService ? (
              <div className="bg-[#0D1E35] border border-[#D4A017]/30 rounded-2xl p-6 sticky top-24">
                <div className="flex items-start justify-between mb-5">
                  <div>
                    <div className="font-mono text-[#D4A017] font-bold text-lg">{selectedService.name}</div>
                    <div className="text-slate-400 text-sm mt-0.5">{selectedService.image}</div>
                  </div>
                  <span
                    className="text-sm px-3 py-1 rounded-full font-bold"
                    style={{ backgroundColor: `${LANG_COLORS[selectedService.language]}20`, color: LANG_COLORS[selectedService.language] }}
                  >
                    {selectedService.language}
                  </span>
                </div>

                {/* Replica / HPA */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  <div className="bg-slate-800/50 rounded-xl p-3 text-center">
                    <div className="text-white font-bold text-xl">{selectedService.replicas}</div>
                    <div className="text-slate-400 text-xs">Current</div>
                  </div>
                  <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-xl p-3 text-center">
                    <div className="text-emerald-400 font-bold text-xl">{selectedService.hpaMin}</div>
                    <div className="text-slate-400 text-xs">HPA Min</div>
                  </div>
                  <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-3 text-center">
                    <div className="text-blue-400 font-bold text-xl">{selectedService.hpaMax}</div>
                    <div className="text-slate-400 text-xs">HPA Max</div>
                  </div>
                </div>

                {/* Resources */}
                <div className="mb-5">
                  <h4 className="text-slate-400 text-xs uppercase tracking-wider mb-3">Resource Requests / Limits</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-4 py-2.5">
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <Cpu className="w-3.5 h-3.5 text-yellow-400" />
                        CPU
                      </div>
                      <span className="font-mono text-white text-sm">{selectedService.cpuRequest} / {selectedService.cpuLimit}</span>
                    </div>
                    <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-4 py-2.5">
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <MemoryStick className="w-3.5 h-3.5 text-blue-400" />
                        Memory
                      </div>
                      <span className="font-mono text-white text-sm">{selectedService.memRequest} / {selectedService.memLimit}</span>
                    </div>
                    <div className="flex items-center justify-between bg-slate-800/50 rounded-lg px-4 py-2.5">
                      <div className="flex items-center gap-2 text-slate-300 text-sm">
                        <Activity className="w-3.5 h-3.5 text-emerald-400" />
                        Port / Protocol
                      </div>
                      <span className="font-mono text-white text-sm">{selectedService.port} / {selectedService.protocol}</span>
                    </div>
                  </div>
                </div>

                {/* Features */}
                <div className="mb-5">
                  <h4 className="text-slate-400 text-xs uppercase tracking-wider mb-3">Reliability Features</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedService.pdb && (
                      <span className="bg-purple-900/30 text-purple-400 border border-purple-700/30 px-3 py-1 rounded-full text-xs">
                        PodDisruptionBudget
                      </span>
                    )}
                    {selectedService.topologySpread && (
                      <span className="bg-blue-900/30 text-blue-400 border border-blue-700/30 px-3 py-1 rounded-full text-xs">
                        TopologySpreadConstraints
                      </span>
                    )}
                    {selectedService.livenessPath && (
                      <span className="bg-emerald-900/30 text-emerald-400 border border-emerald-700/30 px-3 py-1 rounded-full text-xs">
                        LivenessProbe: {selectedService.livenessPath}
                      </span>
                    )}
                    <span className="bg-[#D4A017]/10 text-[#D4A017] border border-[#D4A017]/20 px-3 py-1 rounded-full text-xs">
                      HPA: {selectedService.hpaMin}–{selectedService.hpaMax} pods
                    </span>
                  </div>
                </div>

                {/* Dependencies */}
                {selectedService.dependencies.length > 0 && (
                  <div>
                    <h4 className="text-slate-400 text-xs uppercase tracking-wider mb-3">Dependencies</h4>
                    <div className="flex flex-wrap gap-2">
                      {selectedService.dependencies.map(dep => (
                        <span key={dep} className="bg-slate-800 text-slate-300 border border-slate-600 px-3 py-1 rounded-full text-xs font-mono">
                          {dep}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-8 text-center sticky top-24">
                <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Server className="w-8 h-8 text-slate-500" />
                </div>
                <h3 className="text-white font-semibold mb-2">Select a Service</h3>
                <p className="text-slate-400 text-sm">
                  Click any service card to view detailed resource requests, HPA configuration,
                  reliability features, and dependencies.
                </p>
              </div>
            )}

            {/* Cluster Summary */}
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">Cluster Totals</h3>
              <div className="space-y-2 text-sm">
                {[
                  { label: "Total Services", value: totalServices, color: "text-[#D4A017]" },
                  { label: "Current Replicas", value: totalReplicas, color: "text-emerald-400" },
                  { label: "Max HPA Capacity", value: `${totalHpaMax} pods`, color: "text-blue-400" },
                  { label: "Namespaces", value: NAMESPACES.length, color: "text-purple-400" },
                  { label: "With PDB", value: NAMESPACES.flatMap(n => n.services).filter(s => s.pdb).length, color: "text-amber-400" },
                ].map(item => (
                  <div key={item.label} className="flex justify-between">
                    <span className="text-slate-400">{item.label}</span>
                    <span className={`font-bold ${item.color}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
