/**
 * ServiceHealth.tsx — Admin Service Health Dashboard
 * Sprint 96: Live status grid for all 18 Go microservices + Redis
 * Polls trpc.system.serviceHealth every 30 seconds.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  Database,
  Zap,
  Shield,
  Package,
  Cpu,
  BarChart3,
  Globe,
  Anchor,
  FileText,
  Users,
  CreditCard,
  Warehouse,
  Radio,
  Activity,
  AlertTriangle,
} from "lucide-react";

// ─── SERVICE REGISTRY ─────────────────────────────────────────────────────────

interface ServiceMeta {
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: string;
  port?: number;
}

const SERVICE_REGISTRY: Record<string, ServiceMeta> = {
  "declaration-service": {
    label: "Declaration Engine",
    description: "Customs declaration processing & HS code validation",
    icon: FileText,
    category: "Core Customs",
    port: 9081,
  },
  "payment-service": {
    label: "Payment Gateway",
    description: "Mojaloop & TigerBeetle financial ledger bridge",
    icon: CreditCard,
    category: "Core Customs",
    port: 9082,
  },
  "oga-service": {
    label: "OGA Integration Hub",
    description: "37+ Other Government Agency permit workflows",
    icon: Globe,
    category: "Core Customs",
    port: 9083,
  },
  "profile-service": {
    label: "Trader Profile",
    description: "Trader registration, KYC & AEO management",
    icon: Users,
    category: "Core Customs",
    port: 9084,
  },
  "risk-engine": {
    label: "Risk AI Engine",
    description: "ML-based risk scoring & lane assignment",
    icon: Shield,
    category: "Intelligence",
    port: 9085,
  },
  "cargo-tracking": {
    label: "Cargo Tracking",
    description: "AIS vessel positions & container tracking",
    icon: Anchor,
    category: "Logistics",
    port: 9086,
  },
  "document-vault": {
    label: "Document Vault (RustFS)",
    description: "Encrypted document storage & presigned URLs",
    icon: Package,
    category: "Storage",
    port: 9087,
  },
  "workflow-engine": {
    label: "Temporal Workflow Engine",
    description: "Durable clearance workflow orchestration",
    icon: Activity,
    category: "Orchestration",
    port: 9088,
  },
  "notification-service": {
    label: "Notification Service",
    description: "Push, email & SMS notification dispatch",
    icon: Radio,
    category: "Messaging",
    port: 9089,
  },
  "audit-service": {
    label: "Audit Engine",
    description: "Post-clearance audit & compliance trails",
    icon: BarChart3,
    category: "Compliance",
    port: 9090,
  },
  "bonded-warehouse": {
    label: "Bonded Warehouse",
    description: "Bonded warehouse & free zone operations",
    icon: Warehouse,
    category: "Logistics",
    port: 9091,
  },
  "asean-gateway": {
    label: "ASEAN G2G Gateway",
    description: "ASEAN Single Window G2G document exchange",
    icon: Globe,
    category: "Integration",
    port: 9092,
  },
  "sedona-geo": {
    label: "Geospatial Analytics (Sedona)",
    description: "Apache Sedona geofence & heatmap analytics",
    icon: Globe,
    category: "Analytics",
    port: 9093,
  },
  "flink-stream": {
    label: "Flink Stream Processor",
    description: "Apache Flink real-time event stream processing",
    icon: Zap,
    category: "Analytics",
    port: 9094,
  },
  "kubecost-proxy": {
    label: "Kubecost FinOps",
    description: "Kubernetes cost allocation & budget alerts",
    icon: Cpu,
    category: "Infrastructure",
    port: 9095,
  },
  "wazuh-proxy": {
    label: "Wazuh SIEM/XDR",
    description: "Security event correlation & threat detection",
    icon: Shield,
    category: "Security",
    port: 9096,
  },
  "opencti-proxy": {
    label: "OpenCTI Threat Intel",
    description: "Threat intelligence feeds & IOC enrichment",
    icon: AlertTriangle,
    category: "Security",
    port: 9097,
  },
  "keycloak-proxy": {
    label: "Keycloak IAM",
    description: "Identity & access management (OIDC/SAML)",
    icon: Shield,
    category: "Security",
    port: 8080,
  },
  redis: {
    label: "Redis Cache",
    description: "Distributed rate limiting & session cache",
    icon: Database,
    category: "Infrastructure",
  },
};

// ─── CATEGORY COLORS ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  "Core Customs": "bg-blue-500/10 text-blue-400 border-blue-500/20",
  Intelligence: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  Logistics: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  Storage: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  Orchestration: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  Messaging: "bg-pink-500/10 text-pink-400 border-pink-500/20",
  Compliance: "bg-green-500/10 text-green-400 border-green-500/20",
  Integration: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  Analytics: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  Infrastructure: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  Security: "bg-red-500/10 text-red-400 border-red-500/20",
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export default function ServiceHealth() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: tbModes } = trpc.system.tigerbeetleModes.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const { data, isLoading, error } = trpc.system.serviceHealth.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });

  const services = data?.services ?? {};
  const allHealthy = data?.allHealthy ?? false;
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt) : null;

  const healthyCount = Object.values(services).filter(Boolean).length;
  const totalCount = Object.keys(services).length;
  const degradedCount = totalCount - healthyCount;

  // Group services by category
  const grouped: Record<string, Array<{ key: string; healthy: boolean; meta: ServiceMeta }>> = {};
  for (const [key, healthy] of Object.entries(services)) {
    const meta = SERVICE_REGISTRY[key] ?? {
      label: key,
      description: `Service: ${key}`,
      icon: Server,
      category: "Unknown",
    };
    const cat = meta.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ key, healthy: Boolean(healthy), meta });
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Server className="h-6 w-6 text-primary" />
            Service Health Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live status for all microservices, middleware, and infrastructure components.
            Auto-refreshes every 30 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* ── Summary Banner ──────────────────────────────────────────────── */}
      <div
        className={`rounded-lg border px-5 py-4 flex items-center gap-4 ${
          isLoading
            ? "border-border bg-muted/30"
            : allHealthy
            ? "border-green-500/30 bg-green-500/5"
            : "border-amber-500/30 bg-amber-500/5"
        }`}
      >
        {isLoading ? (
          <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        ) : allHealthy ? (
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
        )}
        <div className="flex-1">
          <p className="font-semibold text-foreground">
            {isLoading
              ? "Checking service health…"
              : allHealthy
              ? "All systems operational"
              : `${degradedCount} service${degradedCount !== 1 ? "s" : ""} degraded or offline`}
          </p>
          {checkedAt && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last checked: {checkedAt.toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="flex items-center gap-1.5 text-green-500 font-medium">
            <CheckCircle2 className="h-4 w-4" />
            {healthyCount} healthy
          </span>
          {degradedCount > 0 && (
            <span className="flex items-center gap-1.5 text-amber-500 font-medium">
              <XCircle className="h-4 w-4" />
              {degradedCount} degraded
            </span>
          )}
          <span className="text-muted-foreground">/ {totalCount} total</span>
        </div>
      </div>

      {/* ── Error State ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
          Failed to fetch service health: {error.message}
        </div>
      )}

      {/* ── Service Grid by Category ────────────────────────────────────── */}
      {Object.keys(grouped).length === 0 && !isLoading && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground text-sm">
            No service data available. Go microservices may not be running in this environment.
            <br />
            In production, all 18 Go services report health via gRPC.
          </CardContent>
        </Card>
      )}

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
            {category}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(({ key, healthy, meta }) => {
              const Icon = meta.icon;
              const catColor = CATEGORY_COLORS[meta.category] ?? CATEGORY_COLORS["Infrastructure"];
              return (
                <div
                  key={key}
                  className={`rounded-lg border p-4 flex items-start gap-3 transition-colors ${
                    healthy
                      ? "border-border bg-card"
                      : "border-destructive/30 bg-destructive/5"
                  }`}
                >
                  <div className={`rounded-md p-2 border ${catColor} shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm text-foreground truncate">{meta.label}</p>
                      {healthy ? (
                        <Badge
                          variant="outline"
                          className="text-green-500 border-green-500/30 bg-green-500/5 shrink-0 text-xs"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Healthy
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-destructive border-destructive/30 bg-destructive/5 shrink-0 text-xs"
                        >
                          <XCircle className="h-3 w-3 mr-1" />
                          Offline
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {meta.description}
                    </p>
                    {meta.port && (
                      <p className="text-xs text-muted-foreground/60 mt-1">
                        :{meta.port}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}      {/* ── TigerBeetle Bridge Mode ────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
          Financial Ledger
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {([
            { label: "TigerBeetle Go Bridge",   bd: tbModes?.go,   port: 8086 },
            { label: "TigerBeetle Rust Bridge", bd: tbModes?.rust, port: 8093 },
          ] as const).map(({ label, bd, port }) => {
            const mode = (bd as { mode?: string } | undefined)?.mode ?? "checking...";
            const isLive = mode === "live";
            const isSim  = mode === "simulation";
            const isHealthy = (bd as { healthy?: boolean } | undefined)?.healthy ?? false;
            return (
              <div
                key={label}
                className={`rounded-lg border p-4 flex items-start gap-3 ${
                  isHealthy ? "border-border bg-card" : "border-destructive/30 bg-destructive/5"
                }`}
              >
                <div className={`rounded-md p-2 border shrink-0 ${
                  isLive ? "border-green-500/30 bg-green-500/5 text-green-500" :
                  isSim  ? "border-amber-500/30 bg-amber-500/5 text-amber-500" :
                           "border-muted text-muted-foreground"
                }`}>
                  <Database className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-sm text-foreground truncate">{label}</p>
                    <Badge
                      variant="outline"
                      className={`shrink-0 text-xs ${
                        isLive ? "text-green-500 border-green-500/30 bg-green-500/5" :
                        isSim  ? "text-amber-500 border-amber-500/30 bg-amber-500/5" :
                                 "text-muted-foreground"
                      }`}
                    >
                      {isLive ? "Live" : isSim ? "Simulation" : isHealthy ? mode : "Offline"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {isLive
                      ? "Connected to TigerBeetle cluster — production ledger active"
                      : isSim
                      ? "In-memory simulation — see PRODUCTION-GUIDE.md to enable live mode"
                      : "Bridge unreachable"}
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">:{port}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Production Note ───────────────────────────────────────────────── */}
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Production Deployment Note
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>
            In production, this dashboard polls all 18 Go microservices via gRPC health checks.
            Services not responding within 2 seconds are marked as offline.
          </p>
          <p>
            For Kubernetes deployments, configure <code className="font-mono bg-muted px-1 rounded">DECLARATION_GRPC_ADDR</code>,{" "}
            <code className="font-mono bg-muted px-1 rounded">PAYMENT_GRPC_ADDR</code>,{" "}
            <code className="font-mono bg-muted px-1 rounded">OGA_GRPC_ADDR</code>, and{" "}
            <code className="font-mono bg-muted px-1 rounded">PROFILE_GRPC_ADDR</code> environment variables
            to point to the respective Kubernetes service ClusterIP addresses.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
