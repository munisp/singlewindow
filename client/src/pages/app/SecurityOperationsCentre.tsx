import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Shield, AlertTriangle, Activity, Server, Eye, CheckCircle, Clock,
  ChevronRight, Cpu, Network,
} from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  investigating: "bg-orange-100 text-orange-800",
  contained: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
};

export default function SecurityOperationsCentre() {
  const [alertSeverity, setAlertSeverity] = useState<string>("all");
  const [incidentStatus, setIncidentStatus] = useState<string>("all");
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);

  const { data: alertsData, isLoading, isError, refetch: refetchAlerts } = trpc.soc.getAlerts.useQuery({
    severity: alertSeverity === "all" ? undefined : (alertSeverity as "low" | "medium" | "high" | "critical"),
    limit: 50,
  });

  const { data: incidentsData, refetch: refetchIncidents } = trpc.soc.getIncidents.useQuery({
    status: incidentStatus === "all" ? undefined : (incidentStatus as "open" | "investigating" | "contained" | "resolved"),
    limit: 50,
  });

  const { data: mitreStats } = trpc.soc.getMitreStats.useQuery();
  const { data: agentsData } = trpc.soc.getAgentStatus.useQuery();

  const acknowledgeAlert = trpc.soc.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast.success("Alert acknowledged");
      refetchAlerts();
    },
  });

  const updateIncident = trpc.soc.updateIncident.useMutation({
    onSuccess: () => {
      toast.success("Incident updated");
      refetchIncidents();
    },
  });

  const alerts = (alertsData as any)?.alerts ?? [];
  const incidents = (incidentsData as any)?.incidents ?? [];
  const agents = (agentsData as any)?.agents ?? [];
  const stats = mitreStats as any;

  const severityOrder = ["critical", "high", "medium", "low"];

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading security data...
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {isError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load security data. Please refresh the page.
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="h-6 w-6 text-red-500" />
            Security Operations Centre
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Wazuh SIEM/XDR — real-time threat detection and incident management
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-red-600 border-red-300">
            {stats?.open_incidents ?? 0} Open Incidents
          </Badge>
          <Badge variant="outline" className="text-orange-600 border-orange-300">
            {stats?.by_severity?.critical ?? 0} Critical Alerts
          </Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {severityOrder.map((sev) => (
          <Card key={sev} className="border-l-4" style={{ borderLeftColor: sev === "critical" ? "#ef4444" : sev === "high" ? "#f97316" : sev === "medium" ? "#eab308" : "#3b82f6" }}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold">{stats?.by_severity?.[sev] ?? 0}</div>
              <div className="text-sm text-muted-foreground capitalize">{sev} alerts</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="alerts">
        <TabsList>
          <TabsTrigger value="alerts">Alert Feed</TabsTrigger>
          <TabsTrigger value="incidents">Incident Queue</TabsTrigger>
          <TabsTrigger value="mitre">MITRE ATT&CK</TabsTrigger>
          <TabsTrigger value="agents">Agent Status</TabsTrigger>
        </TabsList>

        {/* ─── Alerts Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="alerts" className="space-y-4">
          <div className="flex items-center gap-3">
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
            <span className="text-sm text-muted-foreground">{alerts.length} alerts</span>
          </div>

          <div className="space-y-2">
            {alerts.slice(0, 20).map((alert: any) => (
              <Card key={alert.id} className={`border ${alert.acknowledged ? "opacity-60" : ""}`}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={SEVERITY_COLORS[alert.severity] ?? ""}>
                        {alert.severity}
                      </Badge>
                      <span className="font-medium text-sm truncate">{alert.rule?.description}</span>
                      {alert.mitre && (
                        <Badge variant="outline" className="text-xs">
                          {alert.mitre.technique} — {alert.mitre.tactic}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>Agent: {alert.agent?.name}</span>
                      <span>Src: {alert.data?.srcip}</span>
                      {alert.declaration_id && <span className="text-blue-600">Decl: {alert.declaration_id}</span>}
                      <span>{new Date(alert.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.incident_id && (
                      <Badge variant="outline" className="text-xs">Incident</Badge>
                    )}
                    {!alert.acknowledged && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeAlert.mutate({ alertId: alert.id })}
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Ack
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ─── Incidents Tab ──────────────────────────────────────────────── */}
        <TabsContent value="incidents" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={incidentStatus} onValueChange={setIncidentStatus}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="contained">Contained</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{incidents.length} incidents</span>
          </div>

          <div className="space-y-3">
            {incidents.map((inc: any) => (
              <Card key={inc.id} className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedIncident(selectedIncident === inc.id ? null : inc.id)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={STATUS_COLORS[inc.status] ?? ""}>{inc.status}</Badge>
                        <Badge className={SEVERITY_COLORS[inc.severity] ?? ""}>{inc.severity}</Badge>
                        <span className="font-semibold text-sm">{inc.title}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex gap-3 flex-wrap">
                        <span>{inc.alert_ids?.length ?? 0} alerts</span>
                        <span>Assigned: {inc.assigned_to || "Unassigned"}</span>
                        <span>{new Date(inc.created_at).toLocaleString()}</span>
                      </div>
                      {inc.mitre_tactics?.length > 0 && (
                        <div className="mt-1 flex gap-1 flex-wrap">
                          {inc.mitre_tactics.map((t: string) => (
                            <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedIncident === inc.id ? "rotate-90" : ""}`} />
                  </div>

                  {selectedIncident === inc.id && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      <p className="text-sm text-muted-foreground">{inc.description}</p>
                      {inc.resolution_notes && (
                        <p className="text-sm"><span className="font-medium">Notes:</span> {inc.resolution_notes}</p>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        {inc.status === "open" && (
                          <Button size="sm" onClick={(e) => { e.stopPropagation(); updateIncident.mutate({ incidentId: inc.id, status: "investigating" }); }}>
                            Start Investigation
                          </Button>
                        )}
                        {inc.status === "investigating" && (
                          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); updateIncident.mutate({ incidentId: inc.id, status: "contained" }); }}>
                            Mark Contained
                          </Button>
                        )}
                        {inc.status === "contained" && (
                          <Button size="sm" variant="outline" className="text-green-700" onClick={(e) => { e.stopPropagation(); updateIncident.mutate({ incidentId: inc.id, status: "resolved", resolutionNotes: "Resolved by analyst." }); }}>
                            Resolve
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ─── MITRE ATT&CK Tab ───────────────────────────────────────────── */}
        <TabsContent value="mitre" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Tactics Heatmap
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries((stats?.by_tactic ?? {}) as Record<string, number>)
                    .sort(([, a], [, b]) => b - a)
                    .map(([tactic, count]) => (
                      <div key={tactic} className="flex items-center gap-2">
                        <div className="w-36 text-xs text-muted-foreground truncate">{tactic}</div>
                        <div className="flex-1 bg-muted rounded-full h-2">
                          <div
                            className="bg-red-500 h-2 rounded-full"
                            style={{ width: `${Math.min(100, (count / (stats?.total_alerts ?? 1)) * 100 * 3)}%` }}
                          />
                        </div>
                        <div className="text-xs font-medium w-6 text-right">{count}</div>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="h-4 w-4" /> Top Techniques
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {Object.entries((stats?.by_technique ?? {}) as Record<string, number>)
                    .sort(([, a], [, b]) => b - a)
                    .slice(0, 10)
                    .map(([tech, count]) => (
                      <div key={tech} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-blue-600">{tech}</span>
                        <Badge variant="outline">{count}</Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Agents Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="agents">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent: any) => (
              <Card key={agent.id}>
                <CardContent className="p-4 flex items-center gap-3">
                  <div className={`h-3 w-3 rounded-full ${agent.status === "active" ? "bg-green-500" : "bg-gray-400"}`} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{agent.name}</div>
                    <div className="text-xs text-muted-foreground">{agent.ip} — {agent.os}</div>
                    <div className="text-xs text-muted-foreground">
                      Last seen: {new Date(agent.last_keepalive).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={agent.status === "active" ? "default" : "secondary"}>
                    {agent.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
