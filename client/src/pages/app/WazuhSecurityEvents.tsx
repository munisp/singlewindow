import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, Server, Play, RefreshCw, Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-blue-500 text-white",
  INFO: "bg-gray-500 text-white",
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500 text-white",
  INVESTIGATING: "bg-yellow-500 text-black",
  RESOLVED: "bg-green-500 text-white",
  FALSE_POSITIVE: "bg-gray-400 text-white",
};

const AGENT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500 text-white",
  DISCONNECTED: "bg-red-500 text-white",
  PENDING: "bg-yellow-500 text-black",
};

interface WazuhAlert {
  id: string;
  rule_id: string;
  rule_description: string;
  severity: string;
  category: string;
  agent_id: string;
  agent_name: string;
  source_ip?: string;
  user_id?: string;
  status: string;
  timestamp: string;
  raw_event?: string;
}

interface WazuhAgent {
  id: string;
  name: string;
  ip: string;
  os: string;
  status: string;
  last_seen: string;
  version: string;
}

interface Playbook {
  id: string;
  name: string;
  description: string;
  trigger_conditions: string[];
  actions: string[];
}

export default function WazuhSecurityEvents() {
  const [triggeringPlaybook, setTriggeringPlaybook] = useState<string | null>(null);

  const { data: alertsData, isLoading: loadingAlerts, refetch: refetchAlerts } = trpc.wazuh.getAlerts.useQuery();
  const { data: agentsData, isLoading: loadingAgents } = trpc.wazuh.getAgents.useQuery();
  const { data: playbooksData, isLoading: loadingPlaybooks } = trpc.wazuh.listPlaybooks.useQuery();
  const { data: secScore } = trpc.wazuh.getSecurityScore.useQuery();

  const triggerPlaybook = trpc.wazuh.triggerPlaybook.useMutation({
    onSuccess: (data) => {
      setTriggeringPlaybook(null);
      toast.success(`Playbook executed — ${(data as { actions_taken?: string[] }).actions_taken?.length ?? 0} actions taken`);
    },
    onError: () => {
      setTriggeringPlaybook(null);
      toast.error("Failed to trigger playbook");
    },
  });

  const alerts: WazuhAlert[] = (alertsData as { alerts?: WazuhAlert[] } | undefined)?.alerts ?? [];
  const agents: WazuhAgent[] = (agentsData as { agents?: WazuhAgent[] } | undefined)?.agents ?? [];
  const playbooks: Playbook[] = (playbooksData as { playbooks?: Playbook[] } | undefined)?.playbooks ?? [];

  const score = secScore as { score?: number; grade?: string; unresolved_alerts?: number } | undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="h-6 w-6 text-orange-500" />
              Wazuh SIEM / XDR
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Security events, agent monitoring, and automated response playbooks
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchAlerts()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* Security Score */}
        {score && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <Activity className="h-5 w-5 text-blue-400" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{score.score ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Security Score</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-400" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{score.grade ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">Security Grade</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{score.unresolved_alerts ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Unresolved Alerts</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4 flex items-center gap-3">
                <Server className="h-5 w-5 text-purple-400" />
                <div>
                  <p className="text-2xl font-bold text-foreground">{agents.length}</p>
                  <p className="text-xs text-muted-foreground">Monitored Agents</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="alerts">
          <TabsList>
            <TabsTrigger value="alerts">Security Alerts ({alerts.length})</TabsTrigger>
            <TabsTrigger value="agents">Agents ({agents.length})</TabsTrigger>
            <TabsTrigger value="playbooks">Playbooks ({playbooks.length})</TabsTrigger>
          </TabsList>

          {/* Alerts Tab */}
          <TabsContent value="alerts" className="mt-4 space-y-3">
            {loadingAlerts ? (
              <p className="text-muted-foreground text-sm">Loading alerts…</p>
            ) : alerts.length === 0 ? (
              <p className="text-muted-foreground text-sm">No security alerts.</p>
            ) : (
              alerts.map(alert => (
                <Card key={alert.id} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge className={`text-xs ${SEVERITY_COLORS[alert.severity] ?? "bg-gray-500 text-white"}`}>
                            {alert.severity}
                          </Badge>
                          <Badge className={`text-xs ${STATUS_COLORS[alert.status] ?? "bg-gray-500 text-white"}`}>
                            {alert.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground">{alert.category}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground">{alert.rule_description}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-muted-foreground">
                          <span>Agent: {alert.agent_name}</span>
                          {alert.source_ip && <span>IP: {alert.source_ip}</span>}
                          {alert.user_id && <span>User: {alert.user_id}</span>}
                          <span>{new Date(alert.timestamp).toLocaleString()}</span>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">Rule {alert.rule_id}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Agents Tab */}
          <TabsContent value="agents" className="mt-4 space-y-3">
            {loadingAgents ? (
              <p className="text-muted-foreground text-sm">Loading agents…</p>
            ) : agents.length === 0 ? (
              <p className="text-muted-foreground text-sm">No agents registered.</p>
            ) : (
              agents.map(agent => (
                <Card key={agent.id} className="bg-card border-border">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Server className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{agent.name}</p>
                        <p className="text-xs text-muted-foreground">{agent.ip} · {agent.os} · v{agent.version}</p>
                        <p className="text-xs text-muted-foreground">Last seen: {new Date(agent.last_seen).toLocaleString()}</p>
                      </div>
                    </div>
                    <Badge className={`text-xs ${AGENT_STATUS_COLORS[agent.status] ?? "bg-gray-500 text-white"}`}>
                      {agent.status}
                    </Badge>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Playbooks Tab */}
          <TabsContent value="playbooks" className="mt-4 space-y-3">
            {loadingPlaybooks ? (
              <p className="text-muted-foreground text-sm">Loading playbooks…</p>
            ) : playbooks.length === 0 ? (
              <p className="text-muted-foreground text-sm">No playbooks available.</p>
            ) : (
              playbooks.map(pb => (
                <Card key={pb.id} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground">{pb.name}</p>
                        <p className="text-xs text-muted-foreground mb-2">{pb.description}</p>
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-foreground">Actions:</p>
                          {pb.actions.map((action, i) => (
                            <p key={i} className="text-xs text-muted-foreground">• {action}</p>
                          ))}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={triggeringPlaybook === pb.id || triggerPlaybook.isPending}
                        onClick={() => {
                          const firstAlert = alerts[0];
                          if (!firstAlert) {
                            toast.error("No alerts available to trigger playbook against");
                            return;
                          }
                          setTriggeringPlaybook(pb.id);
                          triggerPlaybook.mutate({ playbookId: pb.id, alertId: firstAlert.id });
                        }}
                      >
                        <Play className="h-3 w-3 mr-1" />
                        {triggeringPlaybook === pb.id ? "Running…" : "Trigger"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
