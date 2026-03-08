/**
 * DeploymentConfigurator.tsx
 * Design: Sovereign Blueprint — deep navy (#0A1628) + gold (#D4A017)
 * Purpose: Multi-country deployment configurator that generates a tailored
 * Kubernetes topology (namespace layout, replica counts, storage tiers)
 * based on country profile, border posts, OGA count, and declaration volume.
 */

import { useState, useMemo } from "react";
import {
  Globe, Server, Database, Shield, Cpu, HardDrive,
  Network, Download, CheckCircle, AlertCircle, Info,
  ChevronRight, Layers, Zap, BarChart2
} from "lucide-react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell
} from "recharts";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CountryProfile {
  code: string;
  name: string;
  region: string;
  gdpBand: "low" | "mid" | "high";
  existingInfra: "minimal" | "moderate" | "advanced";
  internetReliability: number; // 0-100
  suggestedCloud: string;
}

interface DeploymentConfig {
  country: string;
  borderPosts: number;
  ogaCount: number;
  dailyDeclarations: number;
  cloudProvider: string;
  haMode: "single-zone" | "multi-zone" | "multi-region";
  dataResidency: boolean;
  offlineCapability: boolean;
}

interface ServiceTopology {
  service: string;
  namespace: string;
  replicas: number;
  cpu: string;
  memory: string;
  storage: string;
  hpaMin: number;
  hpaMax: number;
  tier: "core" | "ai-ml" | "engines" | "infra" | "security";
}

interface CostEstimate {
  phase: string;
  capex: number;
  opexMonthly: number;
  description: string;
}

// ─── Country profiles ─────────────────────────────────────────────────────────

const COUNTRY_PROFILES: CountryProfile[] = [
  { code: "GH", name: "Ghana", region: "West Africa", gdpBand: "mid", existingInfra: "moderate", internetReliability: 72, suggestedCloud: "AWS af-south-1" },
  { code: "RW", name: "Rwanda", region: "East Africa", gdpBand: "low", existingInfra: "moderate", internetReliability: 78, suggestedCloud: "AWS af-south-1" },
  { code: "KE", name: "Kenya", region: "East Africa", gdpBand: "mid", existingInfra: "advanced", internetReliability: 82, suggestedCloud: "AWS af-south-1" },
  { code: "NG", name: "Nigeria", region: "West Africa", gdpBand: "mid", existingInfra: "moderate", internetReliability: 65, suggestedCloud: "AWS af-south-1" },
  { code: "TZ", name: "Tanzania", region: "East Africa", gdpBand: "low", existingInfra: "minimal", internetReliability: 60, suggestedCloud: "AWS af-south-1" },
  { code: "UG", name: "Uganda", region: "East Africa", gdpBand: "low", existingInfra: "minimal", internetReliability: 58, suggestedCloud: "AWS af-south-1" },
  { code: "ET", name: "Ethiopia", region: "East Africa", gdpBand: "low", existingInfra: "minimal", internetReliability: 52, suggestedCloud: "AWS af-south-1" },
  { code: "ZA", name: "South Africa", region: "Southern Africa", gdpBand: "high", existingInfra: "advanced", internetReliability: 88, suggestedCloud: "AWS af-south-1" },
  { code: "MA", name: "Morocco", region: "North Africa", gdpBand: "mid", existingInfra: "advanced", internetReliability: 84, suggestedCloud: "Azure francecentral" },
  { code: "SN", name: "Senegal", region: "West Africa", gdpBand: "low", existingInfra: "minimal", internetReliability: 62, suggestedCloud: "AWS af-south-1" },
  { code: "SG", name: "Singapore", region: "Southeast Asia", gdpBand: "high", existingInfra: "advanced", internetReliability: 99, suggestedCloud: "AWS ap-southeast-1" },
  { code: "BD", name: "Bangladesh", region: "South Asia", gdpBand: "mid", existingInfra: "moderate", internetReliability: 70, suggestedCloud: "AWS ap-south-1" },
];

// ─── Topology generator ───────────────────────────────────────────────────────

function generateTopology(config: DeploymentConfig, profile: CountryProfile): ServiceTopology[] {
  const vol = config.dailyDeclarations;
  const isHighVol = vol > 10000;
  const isMedVol = vol > 3000;
  const isHA = config.haMode !== "single-zone";

  const base = (min: number, scale: number) => Math.max(min, Math.ceil(min + (vol / 5000) * scale));

  return [
    { service: "declaration-svc", namespace: "core", replicas: base(2, 2), cpu: isHighVol ? "500m" : "250m", memory: isHighVol ? "512Mi" : "256Mi", storage: "20Gi", hpaMin: 2, hpaMax: isHighVol ? 20 : 10, tier: "core" },
    { service: "payment-svc", namespace: "core", replicas: base(2, 1), cpu: "250m", memory: "256Mi", storage: "10Gi", hpaMin: 2, hpaMax: 10, tier: "core" },
    { service: "oga-hub", namespace: "core", replicas: Math.max(2, Math.ceil(config.ogaCount / 10)), cpu: "250m", memory: "256Mi", storage: "5Gi", hpaMin: 2, hpaMax: 8, tier: "core" },
    { service: "permit-svc", namespace: "core", replicas: 2, cpu: "125m", memory: "128Mi", storage: "5Gi", hpaMin: 2, hpaMax: 6, tier: "core" },
    { service: "tariff-svc", namespace: "core", replicas: 2, cpu: "250m", memory: "512Mi", storage: "50Gi", hpaMin: 2, hpaMax: 6, tier: "core" },
    { service: "audit-svc", namespace: "core", replicas: 2, cpu: "125m", memory: "128Mi", storage: "100Gi", hpaMin: 2, hpaMax: 4, tier: "core" },
    { service: "notification-svc", namespace: "core", replicas: 2, cpu: "125m", memory: "128Mi", storage: "5Gi", hpaMin: 2, hpaMax: 8, tier: "core" },
    { service: "trader-svc", namespace: "core", replicas: 2, cpu: "125m", memory: "128Mi", storage: "20Gi", hpaMin: 2, hpaMax: 6, tier: "core" },
    { service: "document-svc", namespace: "core", replicas: 2, cpu: "250m", memory: "256Mi", storage: "500Gi", hpaMin: 2, hpaMax: 8, tier: "core" },
    { service: "cargo-svc", namespace: "core", replicas: Math.max(2, config.borderPosts), cpu: "250m", memory: "256Mi", storage: "20Gi", hpaMin: 2, hpaMax: 10, tier: "core" },
    { service: "ussd-gateway", namespace: "core", replicas: 2, cpu: "125m", memory: "128Mi", storage: "5Gi", hpaMin: 2, hpaMax: 6, tier: "core" },
    { service: "ocr-service (Python)", namespace: "ai-ml", replicas: isMedVol ? 3 : 2, cpu: "1000m", memory: "2Gi", storage: "10Gi", hpaMin: 2, hpaMax: isHighVol ? 10 : 6, tier: "ai-ml" },
    { service: "hs-classifier (Python)", namespace: "ai-ml", replicas: 2, cpu: "500m", memory: "1Gi", storage: "5Gi", hpaMin: 2, hpaMax: 6, tier: "ai-ml" },
    { service: "fraud-gnn (Python)", namespace: "ai-ml", replicas: 2, cpu: "1000m", memory: "2Gi", storage: "5Gi", hpaMin: 2, hpaMax: 6, tier: "ai-ml" },
    { service: "risk-fusion (Python)", namespace: "ai-ml", replicas: 2, cpu: "500m", memory: "1Gi", storage: "5Gi", hpaMin: 2, hpaMax: 6, tier: "ai-ml" },
    { service: "risk-engine (Rust)", namespace: "engines", replicas: isHighVol ? 4 : 2, cpu: "500m", memory: "256Mi", storage: "1Gi", hpaMin: 2, hpaMax: isHighVol ? 16 : 8, tier: "engines" },
    { service: "tb-bridge (Rust)", namespace: "engines", replicas: isHA ? 3 : 2, cpu: "250m", memory: "128Mi", storage: "1Gi", hpaMin: 2, hpaMax: 6, tier: "engines" },
    { service: "edi-translator (Rust)", namespace: "engines", replicas: 2, cpu: "250m", memory: "128Mi", storage: "1Gi", hpaMin: 2, hpaMax: 6, tier: "engines" },
    { service: "stream-processor (Rust)", namespace: "engines", replicas: 2, cpu: "500m", memory: "256Mi", storage: "1Gi", hpaMin: 2, hpaMax: 8, tier: "engines" },
    { service: "TigerBeetle", namespace: "infra", replicas: isHA ? 3 : 1, cpu: "2000m", memory: "4Gi", storage: "500Gi", hpaMin: isHA ? 3 : 1, hpaMax: isHA ? 3 : 1, tier: "infra" },
    { service: "PostgreSQL (primary)", namespace: "infra", replicas: isHA ? 2 : 1, cpu: "1000m", memory: "2Gi", storage: "200Gi", hpaMin: 1, hpaMax: isHA ? 2 : 1, tier: "infra" },
    { service: "Redis Cluster", namespace: "infra", replicas: isHA ? 3 : 1, cpu: "500m", memory: "1Gi", storage: "10Gi", hpaMin: isHA ? 3 : 1, hpaMax: isHA ? 6 : 1, tier: "infra" },
    { service: "Kafka (Strimzi)", namespace: "infra", replicas: isHA ? 3 : 1, cpu: "1000m", memory: "2Gi", storage: "100Gi", hpaMin: isHA ? 3 : 1, hpaMax: isHA ? 3 : 1, tier: "infra" },
    { service: "Temporal", namespace: "infra", replicas: 2, cpu: "500m", memory: "512Mi", storage: "20Gi", hpaMin: 2, hpaMax: 4, tier: "infra" },
    { service: "Keycloak", namespace: "security", replicas: isHA ? 3 : 2, cpu: "500m", memory: "1Gi", storage: "10Gi", hpaMin: 2, hpaMax: 6, tier: "security" },
    { service: "APISIX Gateway", namespace: "security", replicas: isHA ? 3 : 2, cpu: "500m", memory: "512Mi", storage: "5Gi", hpaMin: 2, hpaMax: 10, tier: "security" },
    { service: "Wazuh Manager", namespace: "security", replicas: 1, cpu: "1000m", memory: "2Gi", storage: "100Gi", hpaMin: 1, hpaMax: 1, tier: "security" },
    { service: "OpenSearch", namespace: "security", replicas: isHA ? 3 : 1, cpu: "1000m", memory: "4Gi", storage: "200Gi", hpaMin: isHA ? 3 : 1, hpaMax: isHA ? 3 : 1, tier: "security" },
  ];
}

function estimateCosts(config: DeploymentConfig, profile: CountryProfile): CostEstimate[] {
  const volFactor = config.dailyDeclarations / 5000;
  const haFactor = config.haMode === "multi-region" ? 2.2 : config.haMode === "multi-zone" ? 1.5 : 1.0;
  const infraFactor = profile.existingInfra === "minimal" ? 1.4 : profile.existingInfra === "moderate" ? 1.15 : 1.0;

  return [
    { phase: "Phase 1 — Foundation", capex: Math.round(280000 * infraFactor), opexMonthly: Math.round(18000 * haFactor), description: "Core Go microservices, Kubernetes cluster, Keycloak, APISIX, PostgreSQL, basic Kafka" },
    { phase: "Phase 2 — AI/ML & Risk", capex: Math.round(320000 * (1 + volFactor * 0.3)), opexMonthly: Math.round(28000 * haFactor * (1 + volFactor * 0.2)), description: "Python AI services, Rust risk engine, TigerBeetle, Mojaloop integration, Temporal workflows" },
    { phase: "Phase 3 — OGA Integration", capex: Math.round(180000 + config.ogaCount * 4000), opexMonthly: Math.round(12000 + config.ogaCount * 200), description: `${config.ogaCount} OGA adapters, EDI translator, AEO program, post-clearance audit, ${config.borderPosts} border post deployments` },
    { phase: "Phase 4 — Lakehouse & Security", capex: Math.round(240000 * infraFactor), opexMonthly: Math.round(22000 * haFactor), description: "Delta Lake, Flink/Spark/Sedona, OpenCTI, Wazuh SIEM, OpenSearch, Kubecost, Fluvio" },
  ];
}

// ─── Tier colors ──────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  core: "#3B82F6",
  "ai-ml": "#8B5CF6",
  engines: "#EF4444",
  infra: "#10B981",
  security: "#F59E0B",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeploymentConfigurator() {
  const [config, setConfig] = useState<DeploymentConfig>({
    country: "GH",
    borderPosts: 6,
    ogaCount: 12,
    dailyDeclarations: 3000,
    cloudProvider: "AWS af-south-1",
    haMode: "multi-zone",
    dataResidency: true,
    offlineCapability: true,
  });
  const [activeTab, setActiveTab] = useState<"topology" | "costs" | "helm">("topology");
  const [selectedTier, setSelectedTier] = useState<string>("all");

  const profile = useMemo(() => COUNTRY_PROFILES.find(p => p.code === config.country) || COUNTRY_PROFILES[0], [config.country]);
  const topology = useMemo(() => generateTopology(config, profile), [config, profile]);
  const costs = useMemo(() => estimateCosts(config, profile), [config, profile]);

  const totalCapex = costs.reduce((s, c) => s + c.capex, 0);
  const totalOpex = costs.reduce((s, c) => s + c.opexMonthly, 0);
  const totalReplicas = topology.reduce((s, t) => s + t.replicas, 0);

  const filteredTopology = selectedTier === "all" ? topology : topology.filter(t => t.tier === selectedTier);

  const radarData = [
    { metric: "Availability", value: config.haMode === "multi-region" ? 99 : config.haMode === "multi-zone" ? 95 : 85 },
    { metric: "Throughput", value: Math.min(100, Math.round((config.dailyDeclarations / 20000) * 100)) },
    { metric: "OGA Coverage", value: Math.min(100, Math.round((config.ogaCount / 37) * 100)) },
    { metric: "Border Reach", value: Math.min(100, Math.round((config.borderPosts / 20) * 100)) },
    { metric: "Data Residency", value: config.dataResidency ? 100 : 40 },
    { metric: "Offline Mode", value: config.offlineCapability ? 80 : 20 },
  ];

  const helmValues = `# Generated Helm values for ${profile.name}
# TradeGateway NGSWTP — ${config.haMode} deployment
# Cloud: ${config.cloudProvider}
# Generated: ${new Date().toISOString()}

global:
  country: "${config.country}"
  region: "${profile.region}"
  cloudProvider: "${config.cloudProvider}"
  haMode: "${config.haMode}"
  dataResidency: ${config.dataResidency}
  offlineCapability: ${config.offlineCapability}

declarationSvc:
  replicas: ${topology.find(t => t.service === "declaration-svc")?.replicas || 2}
  hpa:
    minReplicas: ${topology.find(t => t.service === "declaration-svc")?.hpaMin || 2}
    maxReplicas: ${topology.find(t => t.service === "declaration-svc")?.hpaMax || 10}
  resources:
    requests:
      cpu: "${topology.find(t => t.service === "declaration-svc")?.cpu || "250m"}"
      memory: "${topology.find(t => t.service === "declaration-svc")?.memory || "256Mi"}"

riskEngine:
  replicas: ${topology.find(t => t.service === "risk-engine (Rust)")?.replicas || 2}
  hpa:
    minReplicas: ${topology.find(t => t.service === "risk-engine (Rust)")?.hpaMin || 2}
    maxReplicas: ${topology.find(t => t.service === "risk-engine (Rust)")?.hpaMax || 8}

tigerbeetle:
  replicas: ${topology.find(t => t.service === "TigerBeetle")?.replicas || 3}
  storage: "${topology.find(t => t.service === "TigerBeetle")?.storage || "500Gi"}"

kafka:
  replicas: ${topology.find(t => t.service === "Kafka (Strimzi)")?.replicas || 3}

keycloak:
  replicas: ${topology.find(t => t.service === "Keycloak")?.replicas || 2}

ogaHub:
  ogaCount: ${config.ogaCount}
  borderPosts: ${config.borderPosts}

opensearch:
  replicas: ${topology.find(t => t.service === "OpenSearch")?.replicas || 3}

lakehouse:
  enabled: true
  deltaLake:
    storageClass: "${config.cloudProvider.startsWith("AWS") ? "gp3" : "premium-ssd"}"
  flink:
    taskManagers: ${Math.max(2, Math.ceil(config.dailyDeclarations / 5000))}
  spark:
    executors: ${Math.max(2, Math.ceil(config.dailyDeclarations / 3000))}`;

  return (
    <section id="deployment-configurator" className="py-20 px-6" style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D1F3C 100%)" }}>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "rgba(212,160,23,0.15)", border: "1px solid rgba(212,160,23,0.3)" }}>
              <Globe className="w-5 h-5" style={{ color: "#D4A017" }} />
            </div>
            <span className="text-xs font-mono tracking-widest uppercase" style={{ color: "#D4A017" }}>Deployment Engineering</span>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
            Multi-Country Deployment Configurator
          </h2>
          <p className="text-white/60 max-w-2xl">
            Generate a tailored Kubernetes topology, Helm values, and cost estimate for any country profile — based on border posts, OGA count, declaration volume, and HA requirements.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Left: Config panel */}
          <div className="xl:col-span-1 space-y-4">
            {/* Country selector */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-xs font-mono text-white/40 uppercase tracking-widest mb-3">Country Profile</p>
              <select
                value={config.country}
                onChange={e => {
                  const p = COUNTRY_PROFILES.find(p => p.code === e.target.value);
                  setConfig(c => ({ ...c, country: e.target.value, cloudProvider: p?.suggestedCloud || c.cloudProvider }));
                }}
                className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none mb-3"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
              >
                {COUNTRY_PROFILES.map(p => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
              </select>
              {profile && (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-white/40">Region</span><span className="text-white/70">{profile.region}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">GDP Band</span><span className={profile.gdpBand === "high" ? "text-emerald-400" : profile.gdpBand === "mid" ? "text-amber-400" : "text-blue-400"}>{profile.gdpBand.toUpperCase()}</span></div>
                  <div className="flex justify-between"><span className="text-white/40">Existing Infra</span><span className="text-white/70">{profile.existingInfra}</span></div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/40">Internet SLA</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${profile.internetReliability}%`, background: profile.internetReliability > 75 ? "#10B981" : profile.internetReliability > 60 ? "#F59E0B" : "#EF4444" }} />
                      </div>
                      <span className="text-white/70">{profile.internetReliability}%</span>
                    </div>
                  </div>
                  <div className="flex justify-between"><span className="text-white/40">Suggested Cloud</span><span className="text-white/70 font-mono text-xs">{profile.suggestedCloud}</span></div>
                </div>
              )}
            </div>

            {/* Parameters */}
            <div className="rounded-xl p-4 space-y-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-xs font-mono text-white/40 uppercase tracking-widest">Parameters</p>

              {[
                { label: "Border Posts", key: "borderPosts", min: 1, max: 50, step: 1 },
                { label: "OGA Count", key: "ogaCount", min: 3, max: 37, step: 1 },
                { label: "Daily Declarations", key: "dailyDeclarations", min: 500, max: 50000, step: 500 },
              ].map(param => (
                <div key={param.key}>
                  <div className="flex justify-between mb-1">
                    <label className="text-xs text-white/50">{param.label}</label>
                    <span className="text-xs font-mono" style={{ color: "#D4A017" }}>
                      {config[param.key as keyof DeploymentConfig]?.toLocaleString()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={config[param.key as keyof DeploymentConfig] as number}
                    onChange={e => setConfig(c => ({ ...c, [param.key]: Number(e.target.value) }))}
                    className="w-full accent-yellow-500"
                  />
                </div>
              ))}

              <div>
                <label className="text-xs text-white/50 mb-1 block">HA Mode</label>
                <select
                  value={config.haMode}
                  onChange={e => setConfig(c => ({ ...c, haMode: e.target.value as DeploymentConfig["haMode"] }))}
                  className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none"
                  style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                >
                  <option value="single-zone">Single Zone</option>
                  <option value="multi-zone">Multi-Zone (Recommended)</option>
                  <option value="multi-region">Multi-Region (DR)</option>
                </select>
              </div>

              <div className="space-y-2">
                {[
                  { key: "dataResidency", label: "Data Residency Enforcement" },
                  { key: "offlineCapability", label: "Offline / Edge Mode" },
                ].map(toggle => (
                  <label key={toggle.key} className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-white/50">{toggle.label}</span>
                    <div
                      onClick={() => setConfig(c => ({ ...c, [toggle.key]: !c[toggle.key as keyof DeploymentConfig] }))}
                      className={`w-10 h-5 rounded-full transition-all relative ${config[toggle.key as keyof DeploymentConfig] ? "bg-yellow-600" : "bg-white/10"}`}
                    >
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${config[toggle.key as keyof DeploymentConfig] ? "left-5" : "left-0.5"}`} />
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Radar */}
            <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <p className="text-xs font-mono text-white/40 uppercase tracking-widest mb-2">Deployment Profile</p>
              <ResponsiveContainer width="100%" height={180}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.4)", fontSize: 9 }} />
                  <Radar dataKey="value" stroke="#D4A017" fill="#D4A017" fillOpacity={0.15} strokeWidth={1.5} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Right: Output */}
          <div className="xl:col-span-3 space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Total Services", value: topology.length, icon: <Server className="w-4 h-4 text-blue-400" />, color: "text-blue-400" },
                { label: "Total Replicas", value: totalReplicas, icon: <Cpu className="w-4 h-4 text-purple-400" />, color: "text-purple-400" },
                { label: "Total CAPEX", value: `$${(totalCapex / 1000).toFixed(0)}K`, icon: <BarChart2 className="w-4 h-4" style={{ color: "#D4A017" }} />, color: "" },
                { label: "Monthly OPEX", value: `$${(totalOpex / 1000).toFixed(0)}K`, icon: <Zap className="w-4 h-4 text-emerald-400" />, color: "text-emerald-400" },
              ].map(stat => (
                <div key={stat.label} className="rounded-xl p-3 flex items-center gap-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {stat.icon}
                  <div>
                    <div className={`text-xl font-bold font-mono ${stat.color}`} style={!stat.color ? { color: "#D4A017" } : {}}>{stat.value}</div>
                    <div className="text-xs text-white/40">{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-lg w-fit" style={{ background: "rgba(255,255,255,0.05)" }}>
              {[
                { id: "topology", label: "Service Topology", icon: <Layers className="w-4 h-4" /> },
                { id: "costs", label: "Cost Breakdown", icon: <BarChart2 className="w-4 h-4" /> },
                { id: "helm", label: "Helm Values", icon: <Download className="w-4 h-4" /> },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
                  style={activeTab === tab.id ? { background: "rgba(212,160,23,0.2)", color: "#D4A017" } : { color: "rgba(255,255,255,0.5)" }}
                >
                  {tab.icon}{tab.label}
                </button>
              ))}
            </div>

            {/* Topology tab */}
            {activeTab === "topology" && (
              <div>
                {/* Tier filter */}
                <div className="flex flex-wrap gap-2 mb-4">
                  {["all", "core", "ai-ml", "engines", "infra", "security"].map(tier => (
                    <button
                      key={tier}
                      onClick={() => setSelectedTier(tier)}
                      className="px-3 py-1 rounded text-xs font-medium transition-all"
                      style={selectedTier === tier
                        ? { background: `${TIER_COLORS[tier] || "#D4A017"}30`, color: TIER_COLORS[tier] || "#D4A017", border: `1px solid ${TIER_COLORS[tier] || "#D4A017"}60` }
                        : { background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.08)" }
                      }
                    >
                      {tier}
                    </button>
                  ))}
                </div>

                <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.05)" }}>
                        {["Service", "Namespace", "Replicas", "CPU Req", "Memory", "Storage", "HPA Min/Max"].map(h => (
                          <th key={h} className="px-3 py-2.5 text-left text-white/40 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTopology.map((svc, i) => (
                        <tr key={svc.service} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                          <td className="px-3 py-2 font-medium text-white">{svc.service}</td>
                          <td className="px-3 py-2">
                            <span className="px-1.5 py-0.5 rounded text-xs font-mono" style={{ background: `${TIER_COLORS[svc.tier]}20`, color: TIER_COLORS[svc.tier] }}>
                              {svc.namespace}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-white/80">{svc.replicas}</td>
                          <td className="px-3 py-2 font-mono text-white/60">{svc.cpu}</td>
                          <td className="px-3 py-2 font-mono text-white/60">{svc.memory}</td>
                          <td className="px-3 py-2 font-mono text-white/60">{svc.storage}</td>
                          <td className="px-3 py-2 font-mono text-white/60">{svc.hpaMin}/{svc.hpaMax}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Costs tab */}
            {activeTab === "costs" && (
              <div className="space-y-4">
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={costs} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <XAxis dataKey="phase" tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 9 }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} />
                    <Tooltip
                      contentStyle={{ background: "#0A1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toLocaleString()}`, ""]}
                    />
                    <Bar dataKey="capex" name="CAPEX" radius={[4, 4, 0, 0]}>
                      {costs.map((_, i) => <Cell key={i} fill={["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B"][i]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>

                <div className="space-y-3">
                  {costs.map((cost, i) => (
                    <div key={cost.phase} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="text-white font-medium text-sm">{cost.phase}</h4>
                        <div className="text-right">
                          <div className="text-sm font-bold font-mono" style={{ color: ["#3B82F6", "#8B5CF6", "#10B981", "#F59E0B"][i] }}>${cost.capex.toLocaleString()}</div>
                          <div className="text-xs text-white/40">${cost.opexMonthly.toLocaleString()}/mo OPEX</div>
                        </div>
                      </div>
                      <p className="text-xs text-white/50">{cost.description}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl p-4 flex items-center justify-between" style={{ background: "rgba(212,160,23,0.1)", border: "1px solid rgba(212,160,23,0.3)" }}>
                  <div>
                    <div className="text-xs text-white/50 mb-1">Total 4-Phase CAPEX</div>
                    <div className="text-2xl font-bold font-mono" style={{ color: "#D4A017" }}>${totalCapex.toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/50 mb-1">Steady-State Monthly OPEX</div>
                    <div className="text-2xl font-bold font-mono" style={{ color: "#D4A017" }}>${totalOpex.toLocaleString()}/mo</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-white/50 mb-1">5-Year TCO</div>
                    <div className="text-2xl font-bold font-mono" style={{ color: "#D4A017" }}>${(totalCapex + totalOpex * 60).toLocaleString()}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Helm values tab */}
            {activeTab === "helm" && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-white/40">Auto-generated <code className="text-amber-400/80">values.yaml</code> for {profile.name} deployment</p>
                  <button
                    onClick={() => navigator.clipboard?.writeText(helmValues)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white/60 hover:text-white transition-all"
                    style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <Download className="w-3 h-3" />Copy to Clipboard
                  </button>
                </div>
                <pre className="rounded-xl p-4 text-xs font-mono text-emerald-300/80 overflow-x-auto leading-relaxed" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.08)", maxHeight: 500 }}>
                  {helmValues}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
