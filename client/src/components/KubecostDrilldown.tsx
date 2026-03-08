/**
 * TradeGateway NGSWTP — Kubecost Live Cost Drill-Down
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Shows per-service resource breakdown:
 * - CPU/RAM/storage requests and limits per replica
 * - Cloud region pricing (AWS, GCP, Azure)
 * - Monthly/annual CAPEX and OPEX estimates
 * - HPA scaling cost impact
 * - Namespace-level cost aggregation
 */

import { useState, useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { Server, Database, Cpu, HardDrive, DollarSign, TrendingUp, ChevronDown, ChevronRight, Filter } from "lucide-react";

type CloudRegion = "aws-us-east-1" | "aws-eu-west-1" | "gcp-us-central1" | "azure-eastus";
type Namespace = "all" | "core" | "ai-ml" | "engines" | "infra" | "security";

interface ServiceCost {
  name: string;
  namespace: Namespace;
  language: "go" | "python" | "rust";
  replicas: { min: number; max: number };
  cpu: { request: string; limit: string; millicores: number };
  memory: { request: string; limit: string; mib: number };
  storage: { pvc: string; gb: number };
  egress: { gbPerMonth: number };
}

const SERVICES: ServiceCost[] = [
  // Core namespace
  { name: "declaration-svc", namespace: "core", language: "go", replicas: { min: 3, max: 10 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "50Gi", gb: 50 }, egress: { gbPerMonth: 50 } },
  { name: "payment-svc", namespace: "core", language: "go", replicas: { min: 3, max: 8 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "20Gi", gb: 20 }, egress: { gbPerMonth: 20 } },
  { name: "oga-hub", namespace: "core", language: "go", replicas: { min: 3, max: 12 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "10Gi", gb: 10 }, egress: { gbPerMonth: 100 } },
  { name: "permit-svc", namespace: "core", language: "go", replicas: { min: 2, max: 6 }, cpu: { request: "250m", limit: "1000m", millicores: 250 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "20Gi", gb: 20 }, egress: { gbPerMonth: 10 } },
  { name: "tariff-svc", namespace: "core", language: "go", replicas: { min: 2, max: 6 }, cpu: { request: "250m", limit: "1000m", millicores: 250 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "100Gi", gb: 100 }, egress: { gbPerMonth: 5 } },
  { name: "audit-svc", namespace: "core", language: "go", replicas: { min: 2, max: 4 }, cpu: { request: "250m", limit: "1000m", millicores: 250 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "500Gi", gb: 500 }, egress: { gbPerMonth: 5 } },
  { name: "notification-svc", namespace: "core", language: "go", replicas: { min: 2, max: 8 }, cpu: { request: "250m", limit: "1000m", millicores: 250 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "10Gi", gb: 10 }, egress: { gbPerMonth: 30 } },
  { name: "cargo-svc", namespace: "core", language: "go", replicas: { min: 2, max: 6 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "50Gi", gb: 50 }, egress: { gbPerMonth: 20 } },
  { name: "aeo-svc", namespace: "core", language: "go", replicas: { min: 2, max: 4 }, cpu: { request: "250m", limit: "1000m", millicores: 250 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "20Gi", gb: 20 }, egress: { gbPerMonth: 5 } },
  { name: "document-svc", namespace: "core", language: "go", replicas: { min: 2, max: 6 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "1Gi", limit: "4Gi", mib: 1024 }, storage: { pvc: "1000Gi", gb: 1000 }, egress: { gbPerMonth: 50 } },
  // AI/ML namespace
  { name: "ocr-service", namespace: "ai-ml", language: "python", replicas: { min: 2, max: 8 }, cpu: { request: "2000m", limit: "8000m", millicores: 2000 }, memory: { request: "4Gi", limit: "16Gi", mib: 4096 }, storage: { pvc: "100Gi", gb: 100 }, egress: { gbPerMonth: 20 } },
  { name: "hs-classifier", namespace: "ai-ml", language: "python", replicas: { min: 2, max: 6 }, cpu: { request: "2000m", limit: "8000m", millicores: 2000 }, memory: { request: "4Gi", limit: "16Gi", mib: 4096 }, storage: { pvc: "50Gi", gb: 50 }, egress: { gbPerMonth: 5 } },
  { name: "fraud-gnn", namespace: "ai-ml", language: "python", replicas: { min: 2, max: 4 }, cpu: { request: "4000m", limit: "16000m", millicores: 4000 }, memory: { request: "8Gi", limit: "32Gi", mib: 8192 }, storage: { pvc: "50Gi", gb: 50 }, egress: { gbPerMonth: 5 } },
  { name: "risk-fusion", namespace: "ai-ml", language: "python", replicas: { min: 2, max: 6 }, cpu: { request: "1000m", limit: "4000m", millicores: 1000 }, memory: { request: "2Gi", limit: "8Gi", mib: 2048 }, storage: { pvc: "20Gi", gb: 20 }, egress: { gbPerMonth: 5 } },
  // Engines namespace
  { name: "risk-engine", namespace: "engines", language: "rust", replicas: { min: 3, max: 10 }, cpu: { request: "1000m", limit: "4000m", millicores: 1000 }, memory: { request: "512Mi", limit: "2Gi", mib: 512 }, storage: { pvc: "10Gi", gb: 10 }, egress: { gbPerMonth: 10 } },
  { name: "tb-bridge", namespace: "engines", language: "rust", replicas: { min: 3, max: 6 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "10Gi", gb: 10 }, egress: { gbPerMonth: 10 } },
  { name: "edi-translator", namespace: "engines", language: "rust", replicas: { min: 2, max: 6 }, cpu: { request: "500m", limit: "2000m", millicores: 500 }, memory: { request: "256Mi", limit: "1Gi", mib: 256 }, storage: { pvc: "10Gi", gb: 10 }, egress: { gbPerMonth: 20 } },
  { name: "stream-processor", namespace: "engines", language: "rust", replicas: { min: 3, max: 8 }, cpu: { request: "1000m", limit: "4000m", millicores: 1000 }, memory: { request: "1Gi", limit: "4Gi", mib: 1024 }, storage: { pvc: "50Gi", gb: 50 }, egress: { gbPerMonth: 50 } },
];

const CLOUD_PRICING: Record<CloudRegion, { name: string; cpuPerCore: number; ramPerGib: number; storagePerGib: number; egressPerGb: number }> = {
  "aws-us-east-1": { name: "AWS us-east-1", cpuPerCore: 0.048, ramPerGib: 0.006, storagePerGib: 0.10, egressPerGb: 0.09 },
  "aws-eu-west-1": { name: "AWS eu-west-1", cpuPerCore: 0.052, ramPerGib: 0.0065, storagePerGib: 0.11, egressPerGb: 0.09 },
  "gcp-us-central1": { name: "GCP us-central1", cpuPerCore: 0.044, ramPerGib: 0.0059, storagePerGib: 0.10, egressPerGb: 0.08 },
  "azure-eastus": { name: "Azure East US", cpuPerCore: 0.050, ramPerGib: 0.0063, storagePerGib: 0.115, egressPerGb: 0.087 },
};

const NAMESPACE_COLORS: Record<string, string> = {
  core: "#3b82f6",
  "ai-ml": "#a855f7",
  engines: "#f97316",
  infra: "#10b981",
  security: "#ef4444",
};

const LANG_COLORS: Record<string, string> = {
  go: "#00ADD8",
  python: "#3776AB",
  rust: "#CE422B",
};

function calcServiceCost(svc: ServiceCost, region: CloudRegion, replicas: number) {
  const pricing = CLOUD_PRICING[region];
  const cpuCost = (svc.cpu.millicores / 1000) * pricing.cpuPerCore * 730 * replicas;
  const ramCost = (svc.memory.mib / 1024) * pricing.ramPerGib * 730 * replicas;
  const storageCost = svc.storage.gb * pricing.storagePerGib;
  const egressCost = svc.egress.gbPerMonth * pricing.egressPerGb;
  return { cpuCost, ramCost, storageCost, egressCost, total: cpuCost + ramCost + storageCost + egressCost };
}

export default function KubecostDrilldown() {
  const [region, setRegion] = useState<CloudRegion>("aws-us-east-1");
  const [namespace, setNamespace] = useState<Namespace>("all");
  const [expandedSvc, setExpandedSvc] = useState<string | null>(null);
  const [replicaOverrides, setReplicaOverrides] = useState<Record<string, number>>({});

  const filteredServices = useMemo(() =>
    namespace === "all" ? SERVICES : SERVICES.filter((s) => s.namespace === namespace),
    [namespace]
  );

  const serviceCosts = useMemo(() =>
    filteredServices.map((svc) => {
      const replicas = replicaOverrides[svc.name] ?? svc.replicas.min;
      const cost = calcServiceCost(svc, region, replicas);
      return { ...svc, replicas, cost };
    }),
    [filteredServices, region, replicaOverrides]
  );

  const totalMonthly = serviceCosts.reduce((s, c) => s + c.cost.total, 0);
  const totalAnnual = totalMonthly * 12;

  const barData = serviceCosts
    .sort((a, b) => b.cost.total - a.cost.total)
    .slice(0, 12)
    .map((s) => ({
      name: s.name.replace("-svc", "").replace("-service", ""),
      cpu: Math.round(s.cost.cpuCost),
      ram: Math.round(s.cost.ramCost),
      storage: Math.round(s.cost.storageCost),
      egress: Math.round(s.cost.egressCost),
      namespace: s.namespace,
    }));

  const nsCostData = (["core", "ai-ml", "engines"] as const).map((ns) => {
    const nsSvcs = serviceCosts.filter((s) => s.namespace === ns);
    return {
      name: ns,
      value: Math.round(nsSvcs.reduce((s, c) => s + c.cost.total, 0)),
      color: NAMESPACE_COLORS[ns],
    };
  });

  return (
    <section id="kubecost-drilldown" className="py-20 bg-[#0A1628]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Kubecost Resource Analysis
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Live Cost Drill-Down
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Per-service CPU, memory, storage, and egress cost breakdown across all 18 services.
            Adjust cloud region and replica counts to model different deployment scenarios.
            Powered by Kubecost allocation data from the Kubernetes cluster.
          </p>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 mb-8">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Cloud Region</label>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as CloudRegion)}
              className="bg-[#0D1E35] border border-slate-700/50 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#D4A017]"
            >
              {Object.entries(CLOUD_PRICING).map(([k, v]) => (
                <option key={k} value={k}>{v.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Namespace Filter</label>
            <select
              value={namespace}
              onChange={(e) => setNamespace(e.target.value as Namespace)}
              className="bg-[#0D1E35] border border-slate-700/50 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-[#D4A017]"
            >
              <option value="all">All Namespaces</option>
              <option value="core">core</option>
              <option value="ai-ml">ai-ml</option>
              <option value="engines">engines</option>
            </select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Monthly Total", value: `$${totalMonthly.toLocaleString("en", { maximumFractionDigits: 0 })}`, icon: DollarSign, color: "text-[#D4A017]" },
            { label: "Annual Total", value: `$${totalAnnual.toLocaleString("en", { maximumFractionDigits: 0 })}`, icon: TrendingUp, color: "text-emerald-400" },
            { label: "Services", value: filteredServices.length.toString(), icon: Server, color: "text-blue-400" },
            { label: "Total Replicas", value: serviceCosts.reduce((s, c) => s + c.replicas, 0).toString(), icon: Cpu, color: "text-purple-400" },
          ].map((card) => (
            <div key={card.label} className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-2">
                <card.icon className={`w-4 h-4 ${card.color}`} />
                <span className="text-xs text-slate-500">{card.label}</span>
              </div>
              <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Stacked Bar Chart */}
          <div className="lg:col-span-2 bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
            <div className="text-sm font-semibold text-white mb-4">Monthly Cost by Service (Top 12)</div>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={barData} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 10 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip
                  contentStyle={{ background: "#0D1E35", border: "1px solid #334155", borderRadius: "8px" }}
                  formatter={(v: number, name: string) => [`$${v}`, name]}
                />
                <Bar dataKey="cpu" name="CPU" stackId="a" fill="#3b82f6" />
                <Bar dataKey="ram" name="RAM" stackId="a" fill="#a855f7" />
                <Bar dataKey="storage" name="Storage" stackId="a" fill="#10b981" />
                <Bar dataKey="egress" name="Egress" stackId="a" fill="#f97316" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Pie Chart by Namespace */}
          <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
            <div className="text-sm font-semibold text-white mb-4">Cost by Namespace</div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={nsCostData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" nameKey="name">
                  {nsCostData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "#0D1E35", border: "1px solid #334155", borderRadius: "8px" }}
                  formatter={(v: number) => [`$${v}/mo`, ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {nsCostData.map((d) => (
                <div key={d.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
                    <span className="text-slate-400 font-mono">{d.name}</span>
                  </div>
                  <span className="text-white font-semibold">${d.value.toLocaleString()}/mo</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Per-Service Drill-Down Table */}
        <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="p-5 border-b border-slate-700/30 flex items-center justify-between">
            <div className="text-sm font-semibold text-white">Per-Service Resource & Cost Breakdown</div>
            <div className="text-xs text-slate-500">Click a row to adjust replica count</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700/30 bg-slate-900/30">
                  <th className="text-left text-slate-500 px-4 py-3">Service</th>
                  <th className="text-left text-slate-500 px-3 py-3">Lang</th>
                  <th className="text-right text-slate-500 px-3 py-3">Replicas</th>
                  <th className="text-right text-slate-500 px-3 py-3">CPU req</th>
                  <th className="text-right text-slate-500 px-3 py-3">RAM req</th>
                  <th className="text-right text-slate-500 px-3 py-3">Storage</th>
                  <th className="text-right text-slate-500 px-3 py-3">CPU cost</th>
                  <th className="text-right text-slate-500 px-3 py-3">RAM cost</th>
                  <th className="text-right text-slate-500 px-3 py-3 font-bold text-white">Total/mo</th>
                </tr>
              </thead>
              <tbody>
                {serviceCosts.map((svc) => (
                  <>
                    <tr
                      key={svc.name}
                      onClick={() => setExpandedSvc(expandedSvc === svc.name ? null : svc.name)}
                      className="border-b border-slate-800/50 hover:bg-white/2 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expandedSvc === svc.name ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
                          <span className="font-mono font-semibold text-white">{svc.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-xs" style={{ background: `${NAMESPACE_COLORS[svc.namespace]}20`, color: NAMESPACE_COLORS[svc.namespace] }}>
                            {svc.namespace}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="font-mono font-bold" style={{ color: LANG_COLORS[svc.language] }}>{svc.language}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-white">{svc.replicas}</td>
                      <td className="px-3 py-3 text-right text-slate-400">{svc.cpu.request}</td>
                      <td className="px-3 py-3 text-right text-slate-400">{svc.memory.request}</td>
                      <td className="px-3 py-3 text-right text-slate-400">{svc.storage.pvc}</td>
                      <td className="px-3 py-3 text-right text-blue-400">${Math.round(svc.cost.cpuCost)}</td>
                      <td className="px-3 py-3 text-right text-purple-400">${Math.round(svc.cost.ramCost)}</td>
                      <td className="px-3 py-3 text-right font-bold text-[#D4A017]">${Math.round(svc.cost.total)}</td>
                    </tr>
                    {expandedSvc === svc.name && (
                      <tr key={`${svc.name}-detail`} className="bg-slate-900/40 border-b border-slate-800/50">
                        <td colSpan={9} className="px-6 py-4">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div>
                              <div className="text-slate-500 mb-2">Adjust Replicas</div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={(e) => { e.stopPropagation(); const orig = SERVICES.find((s) => s.name === svc.name)!; setReplicaOverrides((p) => ({ ...p, [svc.name]: Math.max(orig.replicas.min, (replicaOverrides[svc.name] ?? orig.replicas.min) - 1) })); }}
                                  className="w-7 h-7 rounded-lg bg-slate-700 text-white hover:bg-slate-600 flex items-center justify-center"
                                >−</button>
                                <span className="text-white font-bold w-6 text-center">{svc.replicas}</span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); const orig = SERVICES.find((s) => s.name === svc.name)!; setReplicaOverrides((p) => ({ ...p, [svc.name]: Math.min(orig.replicas.max, (replicaOverrides[svc.name] ?? orig.replicas.min) + 1) })); }}
                                  className="w-7 h-7 rounded-lg bg-slate-700 text-white hover:bg-slate-600 flex items-center justify-center"
                                >+</button>
                                <span className="text-slate-500 text-xs">({SERVICES.find((s) => s.name === svc.name)?.replicas.min}–{SERVICES.find((s) => s.name === svc.name)?.replicas.max})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">CPU limit</div>
                              <div className="text-white font-mono">{svc.cpu.limit}</div>
                              <div className="text-slate-500 text-xs mt-1">Storage cost: ${Math.round(svc.cost.storageCost)}/mo</div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">RAM limit</div>
                              <div className="text-white font-mono">{svc.memory.limit}</div>
                              <div className="text-slate-500 text-xs mt-1">Egress cost: ${Math.round(svc.cost.egressCost)}/mo</div>
                            </div>
                            <div>
                              <div className="text-slate-500 mb-1">Annual cost</div>
                              <div className="text-[#D4A017] font-bold text-lg">${Math.round(svc.cost.total * 12).toLocaleString()}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-900/50 border-t border-slate-700/30">
                  <td colSpan={8} className="px-4 py-3 text-right text-slate-400 font-semibold">Total Monthly (services only)</td>
                  <td className="px-3 py-3 text-right font-bold text-[#D4A017] text-sm">${Math.round(totalMonthly).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Pricing Notes */}
        <div className="mt-6 bg-[#0D1E35] border border-slate-700/30 rounded-xl p-4 text-xs text-slate-500">
          <strong className="text-slate-400">Pricing Notes:</strong> Estimates based on on-demand compute pricing for {CLOUD_PRICING[region].name}.
          Actual costs will vary with reserved instance discounts (typically 30–40% savings), spot instance usage for AI/ML workloads,
          and committed use discounts. Infrastructure costs (Kafka, TigerBeetle, OpenSearch, Keycloak, etc.) not included above — add
          approximately $3,000–$6,000/month for managed infrastructure services. GPU nodes for OCR/GNN workloads add ~$2,000–$5,000/month.
        </div>
      </div>
    </section>
  );
}
