import { useState } from "react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, CheckCircle, Search, RefreshCw, Brain,
  TrendingUp, Shield, Activity, ChevronRight, Clock,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";

const LANE_CFG = {
  red: { badge: "bg-red-500/10 text-red-400 border-red-500/20", dot: "bg-red-400" },
  yellow: { badge: "bg-amber-500/10 text-amber-400 border-amber-500/20", dot: "bg-amber-400" },
  green: { badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", dot: "bg-emerald-400" },
};

function DeclarationRow({ d }: { d: any }) {
  const lane = (d.riskLane as "red" | "yellow" | "green") ?? "green";
  const cfg = LANE_CFG[lane] ?? LANE_CFG.green;
  return (
    <div className="p-3 flex items-center justify-between hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-3">
        <div className={`h-2 w-2 rounded-full ${cfg.dot}`} />
        <div>
          <p className="font-mono text-xs font-semibold">{d.declarationNumber}</p>
          <p className="text-xs text-muted-foreground">{d.hsCode} · {d.countryOfOrigin}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <p className="text-xs font-medium">{d.traderName ?? "Unknown"}</p>
          <p className="text-xs text-muted-foreground">{d.declaredValue ? `$${Number(d.declaredValue).toLocaleString()}` : "—"}</p>
        </div>
        <Badge variant="outline" className={cfg.badge}>{d.riskScore ?? "—"}</Badge>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0"><ChevronRight className="h-3.5 w-3.5" /></Button>
      </div>
    </div>
  );
}

export default function CustomsRisk() {
  const [search, setSearch] = useState("");
  const [laneFilter, setLaneFilter] = useState<"all" | "red" | "yellow" | "green">("all");
  const { data: all, isLoading, refetch, isFetching, isError} = trpc.declarations.all.useQuery({ limit: 100, offset: 0 });
  const { data: modelStats } = trpc.riskModel.getModelStats.useQuery();
  const { data: featureImportance } = trpc.riskModel.getFeatureImportance.useQuery();
  const { data: modelMetrics } = trpc.riskModel.getModelMetrics.useQuery();
  const declarations = (all ?? []).filter((d: any) => {
    const s = !search || d.declarationNumber?.toLowerCase().includes(search.toLowerCase()) || d.hsCode?.toLowerCase().includes(search.toLowerCase());
    return s && (laneFilter === "all" || d.riskLane === laneFilter);
  });
  const red = (all ?? []).filter((d: any) => d.riskLane === "red");
  const yellow = (all ?? []).filter((d: any) => d.riskLane === "yellow");
  const green = (all ?? []).filter((d: any) => d.riskLane === "green");
  const total = (all ?? []).length;
  const laneDist = [
    { name: "Red", value: red.length, fill: "#EF4444" },
    { name: "Yellow", value: yellow.length, fill: "#F59E0B" },
    { name: "Green", value: green.length, fill: "#10B981" },
  ];
  const featureList = (featureImportance as any)?.feature_importance ?? [];
  const radarData = (featureList as Array<{ feature: string; importance: number; weight: number }>).slice(0, 6).map(f => ({
    feature: f.feature.replace(/_/g, " "),
    importance: Math.round(f.importance * 100),
  }));
  return (
    <DashboardLayout title="Risk Screening">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 text-primary" />Risk Assessment Queue
            </h1>
            <p className="text-muted-foreground text-sm mt-1">AI-powered risk scoring and lane assignment for all incoming declarations</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />Refresh
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total", value: total, icon: Activity, color: "text-primary", bg: "bg-primary/10", pct: null as string | null },
            { label: "Red Lane", value: red.length, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/10", pct: total > 0 ? (red.length / total * 100).toFixed(1) : "0" },
            { label: "Yellow Lane", value: yellow.length, icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10", pct: total > 0 ? (yellow.length / total * 100).toFixed(1) : "0" },
            { label: "Green Lane", value: green.length, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10", pct: total > 0 ? (green.length / total * 100).toFixed(1) : "0" },
          ].map(({ label, value, icon: Icon, color, bg, pct }) => (
            <Card key={label}><CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}><Icon className={`h-5 w-5 ${color}`} /></div>
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
                {pct != null && <p className={`text-xs ${color} mt-0.5`}>{pct}%</p>}
              </div>
            </CardContent></Card>
          ))}
        </div>
        <Tabs defaultValue="queue">
          <TabsList><TabsTrigger value="queue">Declaration Queue</TabsTrigger><TabsTrigger value="model">Model Performance</TabsTrigger></TabsList>
          <TabsContent value="queue" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search declaration, HS code..." className="pl-8 h-8 text-xs" />
              </div>
              <div className="flex gap-1">
                {(["all", "red", "yellow", "green"] as const).map(lane => (
                  <Button key={lane} variant={laneFilter === lane ? "default" : "outline"} size="sm" className="h-8 text-xs px-3" onClick={() => setLaneFilter(lane)}>
                    {lane === "all" ? "All" : lane.charAt(0).toUpperCase() + lane.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <Card><CardContent className="p-0">
                  {isLoading ? (
                    <div className="p-4 space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                  ) : declarations.length === 0 ? (
                    <div className="p-12 text-center text-muted-foreground">
                      <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No declarations match your filter</p>
                    </div>
                  ) : (
                    <div className="divide-y max-h-[500px] overflow-y-auto">
                      {declarations.map((d: any) => <DeclarationRow key={d.id} d={d} />)}
                    </div>
                  )}
                </CardContent></Card>
              </div>
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Lane Distribution</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={160}>
                      <BarChart data={laneDist} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} />
                        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="#3B82F6" />
                      </BarChart>
                    </ResponsiveContainer>
                    <div className="space-y-2 mt-2">
                      {laneDist.map(d => (
                        <div key={d.name} className="flex items-center justify-between text-xs">
                          <div className="flex items-center gap-1.5"><div className="h-2 w-2 rounded-full" style={{ background: d.fill }} /><span>{d.name} Lane</span></div>
                          <span className="font-medium">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
                {modelStats && (
                  <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Brain className="h-4 w-4 text-primary" />Model Status</CardTitle></CardHeader>
                    <CardContent className="space-y-2 text-xs">
                      <div className="flex justify-between"><span className="text-muted-foreground">Active Model</span><span className="font-mono font-medium">{(modelStats as any).activeModel ?? "v2.1"}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Accuracy</span><span className="font-medium text-emerald-400">{(modelStats as any).accuracy ?? "94.2"}%</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Avg Latency</span><span className="font-medium">{(modelStats as any).avgLatencyMs ?? "180"}ms</span></div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="model" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><Brain className="h-4 w-4 text-primary" />Feature Importance</CardTitle></CardHeader>
                <CardContent>
                  {radarData.length === 0 ? (
                    <div className="h-48 flex items-center justify-center text-muted-foreground"><p className="text-sm">No feature data</p></div>
                  ) : (
                    <ResponsiveContainer width="100%" height={220}>
                      <RadarChart data={radarData}>
                        <PolarGrid stroke="rgba(255,255,255,0.1)" />
                        <PolarAngleAxis dataKey="feature" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                        <PolarRadiusAxis tick={{ fontSize: 9, fill: "#94a3b8" }} domain={[0, 100]} />
                        <Radar name="Importance" dataKey="importance" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.3} />
                        <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }} />
                      </RadarChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-1.5"><TrendingUp className="h-4 w-4 text-primary" />Model Metrics</CardTitle></CardHeader>
                <CardContent>
                  {!modelMetrics ? (
                    <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
                  ) : (
                    <div className="space-y-3">
                      {Object.entries(modelMetrics as Record<string, any>).slice(0, 8).map(([key, val]) => (
                        <div key={key} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground capitalize">{key.replace(/_/g, " ")}</span>
                            <span className="font-medium">{typeof val === "number" ? (val > 1 ? val.toFixed(0) : (val * 100).toFixed(1) + "%") : String(val)}</span>
                          </div>
                          {typeof val === "number" && val <= 1 && <Progress value={val * 100} className="h-1.5" />}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
