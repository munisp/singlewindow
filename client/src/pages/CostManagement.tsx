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
  HardDrive,
  Cpu,
  Network,
  TrendingDown,
  AlertCircle,
  Zap,
} from "lucide-react";

const PLAN_COLORS: Record<string, string> = {
  enterprise: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  standard: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  starter: "bg-green-500/20 text-green-400 border-green-500/30",
};

export default function CostManagement() {
  const [period] = useState("2025-02");

  const summaryQuery = trpc.cost.getClusterSummary.useQuery();
  const tenantCostsQuery = trpc.cost.getTenantCosts.useQuery({ period });
  const chargebackQuery = trpc.cost.getChargebackReport.useQuery({ period });
  const idleQuery = trpc.cost.getIdleResources.useQuery();
  const trendQuery = trpc.cost.getCostTrend.useQuery({ days: 30 });
  const statusQuery = trpc.cost.getServiceStatus.useQuery();

  const summary = summaryQuery.data;
  const tenantCosts = tenantCostsQuery.data ?? [];
  const idleResources = idleQuery.data ?? [];
  const trendData = (trendQuery.data ?? []).map((d) => ({
    ...d,
    date: d.date.slice(5), // MM-DD
    total: Math.round(d.total_cost_usd),
    cpu: Math.round(d.cpu_cost_usd),
    memory: Math.round(d.memory_cost_usd),
    storage: Math.round(d.storage_cost_usd),
  }));

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
            <Badge variant="outline" className={statusQuery.data.online ? "border-green-500 text-green-400" : "border-yellow-500 text-yellow-400"}>
              <Zap className="h-3 w-3 mr-1" />
              {statusQuery.data.online ? "Kubecost Online" : "Mock Mode"}
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
                    ${summary?.total_cost_usd.toFixed(0) ?? "—"}
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
                    ${summary?.cpu_cost_usd.toFixed(0) ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">CPU Cost</p>
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
                    ${summary?.idle_cost_usd.toFixed(0) ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">Idle Waste</p>
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
                    {summary?.efficiency_pct.toFixed(1) ?? "—"}%
                  </p>
                  <p className="text-xs text-muted-foreground">Efficiency</p>
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
                  <Line type="monotone" dataKey="cpu" stroke="#3b82f6" strokeWidth={1.5} dot={false} name="CPU" />
                  <Line type="monotone" dataKey="memory" stroke="#10b981" strokeWidth={1.5} dot={false} name="Memory" />
                  <Line type="monotone" dataKey="storage" stroke="#f59e0b" strokeWidth={1.5} dot={false} name="Storage" />
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
            <CardTitle className="text-base">Per-Tenant Chargeback — {period}</CardTitle>
          </CardHeader>
          <CardContent>
            {tenantCosts.length > 0 ? (
              <>
                <div className="mb-4">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={tenantCosts.map((t) => ({
                      name: t.tenant_name.split(" ").slice(0, 2).join(" "),
                      CPU: Math.round(t.cpu_cost_usd),
                      Memory: Math.round(t.memory_cost_usd),
                      Storage: Math.round(t.storage_cost_usd),
                      Network: Math.round(t.network_cost_usd),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#9ca3af" }} />
                      <YAxis tick={{ fontSize: 11, fill: "#9ca3af" }} tickFormatter={(v) => `$${v}`} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: 8 }}
                        formatter={(v: number) => [`$${v}`, ""]}
                      />
                      <Legend />
                      <Bar dataKey="CPU" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="Memory" stackId="a" fill="#10b981" />
                      <Bar dataKey="Storage" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Network" stackId="a" fill="#8b5cf6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>Memory</TableHead>
                      <TableHead>Storage</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Efficiency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tenantCosts.map((t) => (
                      <TableRow key={t.tenant_id}>
                        <TableCell>
                          <div>
                            <p className="text-sm font-medium text-foreground">{t.tenant_name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{t.tenant_id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={PLAN_COLORS[t.plan] ?? ""}>
                            {t.plan}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">${t.cpu_cost_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${t.memory_cost_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${t.storage_cost_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">${t.network_cost_usd.toFixed(2)}</TableCell>
                        <TableCell className="text-sm font-semibold text-foreground">${t.total_cost_usd.toFixed(2)}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-medium ${t.efficiency_pct >= 90 ? "text-green-400" : t.efficiency_pct >= 75 ? "text-yellow-400" : "text-red-400"}`}>
                            {t.efficiency_pct.toFixed(1)}%
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
              Idle Resource Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            {idleResources.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">No idle resources detected</div>
            ) : (
              <div className="space-y-3">
                {idleResources.map((r, i) => (
                  <div key={i} className="p-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {r.resource_type}: <span className="font-mono">{r.resource_name}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">Namespace: {r.namespace}</p>
                        <p className="text-xs text-yellow-300 mt-1">{r.recommendation}</p>
                      </div>
                      <Badge variant="outline" className="border-yellow-500/30 text-yellow-400 text-xs whitespace-nowrap ml-3">
                        ${r.idle_cost_usd_per_day.toFixed(2)}/day waste
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
