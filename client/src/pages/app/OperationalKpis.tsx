/**
 * WP-8 — Executive operational KPI dashboard.
 * Consumes the PUBLIC KPI endpoint (/api/kpis/public). Every figure is
 * computed from real platform data with provenance; KPIs below their minimum
 * sample size render an honest INSUFFICIENT_DATA state — never zeros-as-real.
 */
import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity, Download, AlertTriangle, Info } from "lucide-react";

interface KpiDto {
  id: string;
  kind: "scalar" | "percentiles" | "breakdown";
  label: string;
  unit: string;
  status: "OK" | "INSUFFICIENT_DATA";
  minSampleSize: number;
  value: any;
  methodology?: string;
  window: { from: string; to: string };
  provenance: { sources: string[]; n: number; computedAt: string };
}
interface KpiReport {
  classification: string;
  window: { from: string; to: string };
  generatedAt: string;
  kpis: KpiDto[];
}

function KpiValue({ kpi }: { kpi: KpiDto }) {
  if (kpi.status === "INSUFFICIENT_DATA") {
    return (
      <div className="flex items-center gap-2 text-amber-500">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-sm font-medium">
          INSUFFICIENT_DATA (n={kpi.provenance.n}, need ≥{kpi.minSampleSize})
        </span>
      </div>
    );
  }
  if (kpi.kind === "percentiles") {
    const v = kpi.value as { p50: number; p90: number; p95: number; mean: number };
    return (
      <div className="grid grid-cols-4 gap-2 text-center">
        {(["p50", "p90", "p95", "mean"] as const).map((k) => (
          <div key={k} className="rounded-lg bg-muted/50 py-2">
            <p className="text-[10px] uppercase text-muted-foreground">{k}</p>
            <p className="text-lg font-bold">{v[k].toFixed(1)}</p>
          </div>
        ))}
      </div>
    );
  }
  if (kpi.kind === "scalar") {
    return <p className="text-3xl font-bold">{Number(kpi.value).toLocaleString()}</p>;
  }
  const entries = Object.entries(kpi.value as Record<string, number>);
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      {entries.map(([k, v]) => (
        <div key={k} className="rounded-lg bg-muted/50 py-2">
          <p className="text-[10px] uppercase text-muted-foreground truncate" title={k}>{k}</p>
          <p className="text-lg font-bold">{v.toLocaleString()}</p>
        </div>
      ))}
    </div>
  );
}

export default function OperationalKpis() {
  const [report, setReport] = useState<KpiReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch("/api/kpis/public?windowHours=24")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setReport(j);
        setError(null);
      })
      .catch((e) => { setReport(null); setError(e.message); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="w-6 h-6" /> Operational KPIs
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Computed from real platform data with full provenance.{" "}
              {report && (
                <>
                  Window: {new Date(report.window.from).toLocaleString()} →{" "}
                  {new Date(report.window.to).toLocaleString()}
                </>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/kpis/snapshot" download>
              <Download className="w-4 h-4 mr-1" /> Signed snapshot (JSON + JWS)
            </a>
          </Button>
        </div>

        {loading && (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-44 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {!loading && error && (
          <Card>
            <CardContent className="py-10 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-medium">KPIs unavailable</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
              <p className="text-xs text-muted-foreground mt-1">
                The platform reports an honest down state rather than fabricated figures.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && report && report.kpis.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No KPIs are published for this window.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {report?.kpis.map((kpi) => (
            <Card key={kpi.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">{kpi.label}</CardTitle>
                  <Badge variant="outline" className={
                    kpi.status === "OK"
                      ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                      : "bg-amber-500/10 text-amber-500 border-amber-500/30"
                  }>
                    {kpi.status}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{kpi.unit}</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <KpiValue kpi={kpi} />
                {kpi.methodology && (
                  <p className="text-[11px] text-muted-foreground flex gap-1">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {kpi.methodology}
                  </p>
                )}
                <p className="text-[10px] font-mono text-muted-foreground">
                  n={kpi.provenance.n} · sources: {kpi.provenance.sources.join(", ")} · computed{" "}
                  {new Date(kpi.provenance.computedAt).toLocaleTimeString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
