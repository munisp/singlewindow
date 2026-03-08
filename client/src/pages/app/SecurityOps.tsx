import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SEVERITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  critical: { label: "CRITICAL", color: "text-red-700", bg: "bg-red-100 border-red-300" },
  high: { label: "HIGH", color: "text-orange-700", bg: "bg-orange-100 border-orange-300" },
  medium: { label: "MEDIUM", color: "text-amber-700", bg: "bg-amber-100 border-amber-300" },
  low: { label: "LOW", color: "text-blue-700", bg: "bg-blue-100 border-blue-300" },
  info: { label: "INFO", color: "text-slate-600", bg: "bg-slate-100 border-slate-300" },
};

const RISK_CONFIG: Record<string, { label: string; color: string }> = {
  prohibited: { label: "PROHIBITED", color: "text-red-700" },
  high: { label: "HIGH RISK", color: "text-orange-600" },
  medium: { label: "MEDIUM RISK", color: "text-amber-600" },
  low: { label: "LOW RISK", color: "text-blue-600" },
  clear: { label: "CLEAR", color: "text-emerald-600" },
};

export default function SecurityOps() {
  const [alertSeverity, setAlertSeverity] = useState("all");
  const [alertSearch, setAlertSearch] = useState("");
  const [sanctionQuery, setSanctionQuery] = useState("");
  const [sanctionType, setSanctionType] = useState<"entity" | "vessel" | "goods">("entity");
  const utils = trpc.useUtils();

  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = trpc.security.alerts.useQuery({ limit: 50 });

  const [screeningResult, setScreeningResult] = useState<any>(null);
  const screenMutation = trpc.security.screenEntity.useMutation({
    onSuccess: (data) => setScreeningResult(data),
    onError: (err: any) => toast.error("Screening failed", { description: err.message }),
  });

  const acknowledgeMutation = trpc.security.acknowledgeAlert.useMutation({
    onSuccess: () => {
      utils.security.alerts.invalidate();
      toast.success("Alert acknowledged");
    },
    onError: (err: any) => toast.error("Failed to acknowledge", { description: err.message }),
  });

  const filteredAlerts = alerts?.filter((a: any) =>
    !alertSearch ||
    a.title?.toLowerCase().includes(alertSearch.toLowerCase()) ||
    a.source?.toLowerCase().includes(alertSearch.toLowerCase())
  ) ?? [];

  const criticalCount = alerts?.filter((a: any) => a.severity === "critical" && !a.acknowledgedAt).length ?? 0;
  const highCount = alerts?.filter((a: any) => a.severity === "high" && !a.acknowledgedAt).length ?? 0;
  const unacknowledged = alerts?.filter((a: any) => !a.acknowledgedAt).length ?? 0;

  return (
    <DashboardLayout title="Security Operations">
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trade Security & Compliance Centre</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time security alerts, restricted-party screening, and threat monitoring for all trade activity.
          </p>
        </div>

        {/* Alert summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="border-red-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-red-100 flex items-center justify-center">
                <ShieldAlert className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
                <p className="text-xs text-muted-foreground">Critical Alerts</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-orange-700">{highCount}</p>
                <p className="text-xs text-muted-foreground">High Severity</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Shield className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{unacknowledged}</p>
                <p className="text-xs text-muted-foreground">Unacknowledged</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{alerts?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Alerts (24h)</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">Security Alert Feed</TabsTrigger>
            <TabsTrigger value="sanctions">Sanctions Screening</TabsTrigger>
          </TabsList>

          {/* Security Alerts */}
          <TabsContent value="alerts" className="space-y-4 mt-4">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search alerts..."
                  value={alertSearch}
                  onChange={e => setAlertSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={alertSeverity} onValueChange={setAlertSeverity}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Severity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchAlerts()}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" /> Refresh
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {alertsLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
                  </div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="p-8 text-center">
                    <ShieldCheck className="h-10 w-10 text-emerald-400 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No alerts matching your filters</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredAlerts.map((alert: any) => {
                      const sev = SEVERITY_CONFIG[alert.severity] ?? SEVERITY_CONFIG.info;
                      return (
                        <div
                          key={alert.id}
                          className={`flex items-start gap-4 px-5 py-4 hover:bg-muted/20 ${alert.acknowledgedAt ? "opacity-60" : ""}`}
                        >
                          <div className={`shrink-0 mt-0.5 px-2 py-0.5 rounded text-xs font-bold border ${sev.bg} ${sev.color}`}>
                            {sev.label}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm">{alert.title}</span>
                              <Badge variant="outline" className="text-xs">{alert.source}</Badge>
                              <Badge variant="secondary" className="text-xs">{alert.category}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.description}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {new Date(alert.createdAt).toLocaleString()}
                              {alert.acknowledgedAt && ` · Acknowledged ${new Date(alert.acknowledgedAt).toLocaleString()}`}
                            </p>
                          </div>
                          {!alert.acknowledgedAt && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="shrink-0 h-8 gap-1"
                              disabled={acknowledgeMutation.isPending}
                              onClick={() => acknowledgeMutation.mutate({ alertId: alert.id })}
                            >
                              <CheckCircle className="h-3 w-3" /> Acknowledge
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sanctions Screening */}
          <TabsContent value="sanctions" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Real-Time Sanctions & Restricted Party Screening</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Screens against OFAC SDN, UN Security Council, EU Consolidated, OFSI, and dual-use goods control lists (EAR99/CCL/ITAR).
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Enter entity name, vessel name, or HS code..."
                      value={sanctionQuery}
                      onChange={e => { setSanctionQuery(e.target.value); setScreeningResult(null); }}
                      className="pl-9"
                    />
                  </div>
                  <Select value={sanctionType} onValueChange={v => { setSanctionType(v as any); setScreeningResult(null); }}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="entity">Entity</SelectItem>
                      <SelectItem value="vessel">Vessel</SelectItem>
                      <SelectItem value="goods">Goods (HS)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => screenMutation.mutate({ entityName: sanctionQuery, entityType: sanctionType === "goods" ? "company" : sanctionType as any })}
                    disabled={sanctionQuery.length < 3 || screenMutation.isPending}
                    className="gap-2"
                  >
                    <Shield className="h-4 w-4" /> Screen
                  </Button>
                </div>

                {screenMutation.isPending && (
                  <div className="space-y-2">
                    <Skeleton className="h-16 w-full" />
                    <Skeleton className="h-16 w-full" />
                  </div>
                )}

                {screeningResult && (
                  <div>
                    {screeningResult.checkResult === "clear" ? (
                      <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-50 border border-emerald-200">
                        <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0" />
                        <div>
                          <p className="font-medium text-emerald-800 text-sm">No matches found</p>
                          <p className="text-xs text-emerald-600">
                            "{sanctionQuery}" does not appear on any monitored sanctions or control list.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[screeningResult].map((result: any, i: number) => {
                          const risk = RISK_CONFIG[result.riskLevel] ?? RISK_CONFIG.low;
                          return (
                            <div
                              key={i}
                              className={`p-4 rounded-lg border ${result.riskLevel === "prohibited" || result.riskLevel === "high" ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <XCircle className={`h-5 w-5 shrink-0 ${result.riskLevel === "prohibited" ? "text-red-600" : "text-amber-600"}`} />
                                  <div>
                                    <p className={`font-semibold text-sm ${risk.color}`}>{risk.label}</p>
                                    <p className="text-sm font-medium">{result.matchedName}</p>
                                  </div>
                                </div>
                                <Badge variant="destructive" className="text-xs shrink-0">{result.listName}</Badge>
                              </div>
                              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                                {result.aliases && <span>Aliases: {result.aliases}</span>}
                                {result.country && <span>Country: {result.country}</span>}
                                {result.reason && <span className="col-span-2">Reason: {result.reason}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {sanctionQuery.length <= 2 && (
                  <div className="p-6 text-center rounded-lg bg-muted/30 border border-dashed">
                    <Shield className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Enter at least 3 characters to begin screening</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Checks OFAC SDN · UN SC · EU Consolidated · OFSI · EAR99 · CCL · ITAR
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
