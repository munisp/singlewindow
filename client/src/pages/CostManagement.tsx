import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from "recharts";
import {
  DollarSign,
  Server,
  TrendingDown,
  AlertCircle,
  Zap,
  Cpu,
} from "lucide-react";

export default function CostManagement() {
  const [period] = useState<"day" | "week" | "month">("month");

  const summaryQuery = trpc.cost.getClusterSummary.useQuery();
  const tenantCostsQuery = trpc.cost.getTenantCosts.useQuery({ period });
  const idleQuery = trpc.cost.getIdleResources.useQuery();
  const trendQuery = trpc.cost.getCostTrend.useQuery({ days: 30 });
  const statusQuery = trpc.cost.getServiceStatus.useQuery();

  const summary = summaryQuery.data as any;
  const tenantCostsRaw = tenantCostsQuery.data as any;
  const tenantCosts: any[] = Array.isArray(tenantCostsRaw)
    ? tenantCostsRaw
    : (tenantCostsRaw?.tenants ?? []);
  const idleResources = (idleQuery.data ?? []) as any[];
  const trendData = ((trendQuery.data ?? []) as any[]).map((d: any) => ({
    date: String(d.period_date ?? d.date ?? "").slice(5),
    total: Math.round(Number(d.total_cost_usd ?? 0)),
    compute: Math.round(Number(d.compute_cost_usd ?? 0)),
    storage: Math.round(Number(d.storage_cost_usd ?? 0)),
    network: Math.round(Number(d.network_cost_usd ?? 0)),
  }));

  const currentMonth = summary?.current_month as any;

  return (
    <DashboardLayout title="Cost Management (Kubecost)">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Cost Management</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Kubecost per-tenant cost allocation and chargeback reporting
            </p>
          </div>
          {statusQuery.data && (
            <Badge variant="outline" className="border-yellow-500 text-yellow-400">
              <Zap className="h-3 w-3 mr-1" />
              DB Mode — {(statusQuery.data as any).records?.toLocaleString()} records
            </Badge>
          )}
        </div>

        {/* Cluster Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-green-500/10">
                  <DollarSign className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    ${Number(currentMonth?.total ?? 0).toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Total Monthly Cost</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10">
                  <Cpu className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    ${Number(currentMonth?.compute ?? 0).toFixed(0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Compute Cost</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-yellow-500/10">
                  <TrendingDown className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {summary?.mom_change_pct ?? 0}%
                  </p>
                  <p className="text-xs text-muted-foreground">MoM Change</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-card border-border">
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10">
                  <Server className="h-5 w-5 text-purple-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">
                    {Number(currentMonth?.avg_efficiency ?? 0).toFixed(0)}%
                  </p>
                  <p className="text-xs text-muted-foreground">Avg Efficiency</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cost Trend Chart */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">30-Day Cost Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#9ca3af" }} interval={4} />
                  <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(v) => `$${v}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#f1f5f9" }}
                    formatter={(v: number) => [`$${v}`, ""]}
                  />
                  <Legend />
                  <Line type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} dot={false} name="Total" />
                  <Line type="monotone" dataKey="compute" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="Compute" />
                  <Line type="monotone" dataKey="storage" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Storage" />
                  <Line type="monotone" dataKey="network" stroke="#10b981" strokeWidth={1.5} dot={false} name="Network" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-40 flex items-center justify-center text-muted-foreground">Loading trend data…</div>
            )}
          </CardContent>
        </Card>

        {/* Per-Tenant Chargeback */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Per-Tenant Cost Allocation</CardTitle>
          </CardHeader>
          <CardContent>
            {tenantCosts.length > 0 ? (
              <>
                <div className="mb-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={tenantCosts.map((t: any) => ({
                      name: String(t.tenant_name ?? "").split("-").slice(0, 2).join("-"),
                      Compute: Math.round(Number(t.compute_cost_usd ?? 0)),
                      Storage: Math.round(Number(t.storage_cost_usd ?? 0)),
                      Network: Math.round(Number(t.network_cost_usd ?? 0)),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                        formatter={(v: number) => [`$${v}`, ""]}
                      />
                      <Legend />
                      <Bar dataKey="Compute" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="Storage" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Network" stackId="a" fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Namespace</TableHead>
                      <TableHead>Compute</TableHead>
                      <TableHead>Storage</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Efficiency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantCosts.map((t: any, i: number) => (
                      <TableRow key={i}>
                        <TableCell>
                          <p className="text-sm font-medium text-foreground">{t.tenant_name}</p>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{t.namespace}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${Number(t.compute_cost_usd ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${Number(t.storage_cost_usd ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${Number(t.network_cost_usd ?? 0).toFixed(0)}</TableCell>
                        <TableCell className="text-sm font-semibold text-foreground">${Number(t.total_cost_usd ?? 0).toFixed(0)}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-medium ${Number(t.avg_efficiency ?? 0) >= 75 ? "text-green-400" : "text-yellow-400"}`}>
                            {Number(t.avg_efficiency ?? 0).toFixed(0)}%
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground">Loading tenant costs…</div>
            )}
          </CardContent>
        </Card>

        {/* Idle Resources */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-yellow-400" />
              Low-Efficiency Services (Idle Resource Candidates)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {idleResources.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">No idle resources detected</div>
            ) : (
              <div className="space-y-3">
                {idleResources.map((r: any, i: number) => (
                  <div key={i} className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {r.service} <span className="text-muted-foreground font-normal">in</span> {r.namespace}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Tenant: {r.tenant_name} · Category: {r.category}
                        </p>
                        <p className="text-xs text-yellow-300 mt-1">
                          Avg efficiency {Number(r.avg_efficiency ?? 0).toFixed(0)}% — consider right-sizing
                        </p>
                      </div>
                      <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-xs whitespace-nowrap ml-3">
                        ${Number(r.wasted_cost_usd ?? 0).toFixed(0)} wasted
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
