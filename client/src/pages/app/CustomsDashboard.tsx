import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  FileText,
  Search,
  Shield,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";

// SLA thresholds in hours by risk lane
const SLA_HOURS: Record<string, number> = {
  green_lane: 4,
  yellow_lane: 24,
  red_lane: 72,
  submitted: 24,
};

function getSLAStatus(d: any): { label: string; hoursElapsed: number; isBreached: boolean; isWarning: boolean } {
  const submittedAt = d.submittedAt ? new Date(d.submittedAt).getTime() : d.createdAt ? new Date(d.createdAt).getTime() : null;
  if (!submittedAt) return { label: "—", hoursElapsed: 0, isBreached: false, isWarning: false };
  const hoursElapsed = (Date.now() - submittedAt) / 3_600_000;
  const threshold = SLA_HOURS[d.riskLane ?? d.status] ?? 24;
  const isBreached = hoursElapsed > threshold;
  const isWarning = !isBreached && hoursElapsed > threshold * 0.75;
  const h = Math.floor(hoursElapsed);
  const label = h < 1 ? "< 1h" : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d ${h % 24}h`;
  return { label, hoursElapsed, isBreached, isWarning };
}

const LANE_CONFIG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  green_lane: { label: "Green", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle className="h-4 w-4 text-emerald-600" /> },
  yellow_lane: { label: "Yellow", color: "text-amber-700", bg: "bg-amber-50 border-amber-200", icon: <Clock className="h-4 w-4 text-amber-600" /> },
  red_lane: { label: "Red", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: <AlertTriangle className="h-4 w-4 text-red-600" /> },
  submitted: { label: "Pending", color: "text-blue-700", bg: "bg-blue-50 border-blue-200", icon: <FileText className="h-4 w-4 text-blue-600" /> },
  under_review: { label: "In Review", color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: <Eye className="h-4 w-4 text-purple-600" /> },
  cleared: { label: "Cleared", color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200", icon: <CheckCircle className="h-4 w-4 text-emerald-600" /> },
  rejected: { label: "Rejected", color: "text-red-700", bg: "bg-red-50 border-red-200", icon: <XCircle className="h-4 w-4 text-red-600" /> },
  held: { label: "Held", color: "text-orange-700", bg: "bg-orange-50 border-orange-200", icon: <Shield className="h-4 w-4 text-orange-600" /> },
};

export default function CustomsDashboard() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [laneFilter, setLaneFilter] = useState("all");

  const { data: declarations, isLoading } = trpc.declarations.all.useQuery({ limit: 50 });

  const { data: stats } = trpc.declarations.stats.useQuery();

  const filtered = declarations?.filter((d: any) =>
    !search ||
    d.declarationNumber?.toLowerCase().includes(search.toLowerCase()) ||
    d.importerName?.toLowerCase().includes(search.toLowerCase()) ||
    d.hsCode?.includes(search)
  ) ?? [];

  const laneGroups = {
    red: filtered.filter((d: any) => d.status === "red_lane").length,
    yellow: filtered.filter((d: any) => d.status === "yellow_lane").length,
    green: filtered.filter((d: any) => d.status === "green_lane").length,
    pending: filtered.filter((d: any) => d.status === "submitted").length,
  };

  return (
    <DashboardLayout title="Customs Dashboard">
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customs Officer Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Declaration queue with AI risk assessment</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-red-600">{laneGroups.red}</p>
              <p className="text-xs text-muted-foreground mt-1">Red Lane — Physical Inspection</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-amber-600">{laneGroups.yellow}</p>
              <p className="text-xs text-muted-foreground mt-1">Yellow Lane — Doc Review</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-emerald-600">{laneGroups.green}</p>
              <p className="text-xs text-muted-foreground mt-1">Green Lane — Auto-Approve</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-blue-600">{stats?.total ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Declarations</p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by reference, importer, HS code..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="under_review">Under Review</SelectItem>
              <SelectItem value="green_lane">Green Lane</SelectItem>
              <SelectItem value="yellow_lane">Yellow Lane</SelectItem>
              <SelectItem value="red_lane">Red Lane</SelectItem>
              <SelectItem value="held">Held</SelectItem>
              <SelectItem value="cleared">Cleared</SelectItem>
            </SelectContent>
          </Select>
          <Select value={laneFilter} onValueChange={setLaneFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Lane" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Lanes</SelectItem>
              <SelectItem value="green_lane">Green</SelectItem>
              <SelectItem value="yellow_lane">Yellow</SelectItem>
              <SelectItem value="red_lane">Red</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Declaration table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Declaration Queue ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center">
                <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-muted-foreground">No declarations found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Reference</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Importer</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">HS Code</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Value</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Risk Score</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Lane / Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">SLA</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((d: any) => {
                      const lane = LANE_CONFIG[d.status] ?? LANE_CONFIG.submitted;
                      const riskScore = d.riskScore ? Number(d.riskScore) : null;
                      return (
                        <tr key={d.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs font-medium">{d.declarationNumber}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div>
                              <p className="font-medium truncate max-w-32">{d.importerName || "—"}</p>
                              <p className="text-xs text-muted-foreground">{d.declarationType?.toUpperCase()}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-mono text-xs">{d.hsCode}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-xs">{d.invoiceCurrency} {Number(d.invoiceValue || 0).toLocaleString()}</span>
                          </td>
                          <td className="px-4 py-3">
                            {riskScore !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${riskScore >= 70 ? "bg-red-500" : riskScore >= 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                                    style={{ width: `${riskScore}%` }}
                                  />
                                </div>
                                <span className={`text-xs font-medium ${riskScore >= 70 ? "text-red-600" : riskScore >= 40 ? "text-amber-600" : "text-emerald-600"}`}>
                                  {riskScore}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">Pending</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs font-medium ${lane.bg} ${lane.color}`}>
                              {lane.icon}
                              {lane.label}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {(() => {
                              const sla = getSLAStatus(d);
                              if (sla.label === "—") return <span className="text-xs text-muted-foreground">—</span>;
                              const lane = d.riskLane ?? d.status;
                              const threshold = SLA_HOURS[lane] ?? 24;
                              const hoursOver = sla.isBreached ? (sla.hoursElapsed - threshold).toFixed(1) : null;
                              const tooltipText = sla.isBreached
                                ? `${sla.label} elapsed — ${hoursOver}h over SLA (limit: ${threshold}h for ${lane?.replace(/_/g, ' ')})`
                                : sla.isWarning
                                ? `${sla.label} elapsed — approaching SLA limit of ${threshold}h for ${lane?.replace(/_/g, ' ')}`
                                : `${sla.label} elapsed — within SLA limit of ${threshold}h`;
                              return (
                                <span
                                  title={tooltipText}
                                  className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded cursor-help ${
                                    sla.isBreached ? "bg-red-100 text-red-700 ring-1 ring-red-300" :
                                    sla.isWarning ? "bg-amber-100 text-amber-700 ring-1 ring-amber-300" :
                                    "bg-muted text-muted-foreground"
                                  }`}
                                >
                                  {sla.isBreached && <AlertTriangle className="h-3 w-3" />}
                                  {sla.label}
                                  {sla.isBreached && " OVERDUE"}
                                  {sla.isWarning && <Clock className="h-3 w-3" />}
                                </span>
                              );
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setLocation(`/app/customs/declarations/${d.id}`)}
                              className="h-7 text-xs gap-1"
                            >
                              <Eye className="h-3 w-3" /> Review
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
