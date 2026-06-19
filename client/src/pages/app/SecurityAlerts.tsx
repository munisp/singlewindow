/**
 * Security Alerts — TradeGateway™ NGSWTP
 * Wazuh SIEM dashboard: alerts, agents, security score, and playbooks.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/DashboardLayout";

import {
  Shield, AlertTriangle, CheckCircle, RefreshCw, Play,
  Server, Cpu, Activity, Lock, Eye,
} from "lucide-react";

function formatDate(ts: Date | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-yellow-100 text-yellow-800 border-yellow-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
  info: "bg-gray-100 text-gray-700 border-gray-200",
};

const AGENT_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 border-green-200",
  disconnected: "bg-red-100 text-red-800 border-red-200",
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  never_connected: "bg-gray-100 text-gray-700 border-gray-200",
};

export default function SecurityAlerts() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = user?.role === "admin";

  const [selectedAlert, setSelectedAlert] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<"alerts" | "agents" | "playbooks" | "score">("alerts");

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: alerts, isLoading: alertsLoading, refetch: refetchAlerts } = trpc.wazuh.getAlerts.useQuery(undefined, { enabled: isAdmin });
  const { data: agents, isLoading: agentsLoading } = trpc.wazuh.getAgents.useQuery(undefined, { enabled: isAdmin && activeTab === "agents" });
  const { data: playbooks, isLoading: playbooksLoading } = trpc.wazuh.listPlaybooks.useQuery(undefined, { enabled: isAdmin && activeTab === "playbooks" });
  const { data: securityScore } = trpc.wazuh.getSecurityScore.useQuery();

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const triggerPlaybookMutation = trpc.wazuh.triggerPlaybook.useMutation({
    onSuccess: (data) => {
      toast({ title: "Playbook triggered", description: `Status: ${data.status}` });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const acknowledgeMutation = trpc.wazuh.acknowledgeAlert.useMutation({
    onSuccess: () => {
      toast({ title: "Alert acknowledged" });
      refetchAlerts();
      setSelectedAlert(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const alertList: any[] = Array.isArray(alerts) ? alerts : (alerts as any)?.alerts ?? [];
  const agentList: any[] = Array.isArray(agents) ? agents : (agents as any)?.agents ?? [];
  const playbookList: any[] = Array.isArray(playbooks) ? playbooks : (playbooks as any)?.playbooks ?? [];

  const criticalCount = alertList.filter((a) => a.severity === "critical" || a.level >= 12).length;
  const highCount = alertList.filter((a) => a.severity === "high" || (a.level >= 8 && a.level < 12)).length;
  const unacknowledgedCount = alertList.filter((a) => !a.acknowledged).length;

  if (!isAdmin) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-7 h-7 text-accent" />
          <div>
            <h1 className="text-2xl font-bold">Security Center</h1>
            <p className="text-muted-foreground text-sm">Your platform security score</p>
          </div>
        </div>
        {securityScore && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-green-600">{(securityScore as any).score ?? "—"}</div>
              <div className="text-sm text-muted-foreground mt-1">Security Score</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-2xl font-bold">{(securityScore as any).grade ?? "—"}</div>
              <div className="text-sm text-muted-foreground mt-1">Grade</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{(securityScore as any).passedChecks ?? "—"}</div>
              <div className="text-sm text-muted-foreground mt-1">Passed Checks</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{(securityScore as any).failedChecks ?? "—"}</div>
              <div className="text-sm text-muted-foreground mt-1">Failed Checks</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-7 h-7 text-accent" />
            Security Alerts (Wazuh SIEM)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Real-time threat detection, agent health, and incident response
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchAlerts()}>
          <RefreshCw className="w-4 h-4 mr-2" /> Refresh
        </Button>
      </div>

      {/* Score + Alert Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{(securityScore as any)?.score ?? "—"}</div>
          <div className="text-xs text-muted-foreground mt-1">Security Score</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{criticalCount}</div>
          <div className="text-xs text-muted-foreground mt-1">Critical Alerts</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-orange-600">{highCount}</div>
          <div className="text-xs text-muted-foreground mt-1">High Alerts</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-yellow-600">{unacknowledgedCount}</div>
          <div className="text-xs text-muted-foreground mt-1">Unacknowledged</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-3xl font-bold">{alertList.length}</div>
          <div className="text-xs text-muted-foreground mt-1">Total Alerts</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        {(["alerts", "agents", "playbooks", "score"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Alerts Tab */}
      {activeTab === "alerts" && (
        alertsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading alerts...
          </div>
        ) : alertList.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500 opacity-60" />
            <p className="font-medium">No active security alerts</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Severity</th>
                  <th className="text-left px-4 py-3 font-medium">Rule</th>
                  <th className="text-left px-4 py-3 font-medium">Agent</th>
                  <th className="text-left px-4 py-3 font-medium">Time</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {alertList.map((alert: any) => (
                  <tr key={alert.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <Badge className={`text-xs border ${SEVERITY_COLORS[alert.severity ?? "info"] ?? SEVERITY_COLORS.info}`}>
                        {alert.severity ?? `L${alert.level}`}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-xs">{alert.rule?.description ?? alert.description ?? "Unknown rule"}</div>
                      <div className="text-xs text-muted-foreground">ID: {alert.rule?.id ?? alert.ruleId ?? "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">{alert.agent?.name ?? alert.agentName ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(alert.timestamp ?? alert.createdAt)}</td>
                    <td className="px-4 py-3">
                      {alert.acknowledged ? (
                        <Badge className="bg-gray-100 text-gray-600 border-gray-200 text-xs">Acknowledged</Badge>
                      ) : (
                        <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">Open</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedAlert(alert)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Agents Tab */}
      {activeTab === "agents" && (
        agentsLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading agents...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agentList.map((agent: any) => (
              <div key={agent.id} className="bg-card border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium text-sm">{agent.name}</span>
                  </div>
                  <Badge className={`text-xs border ${AGENT_STATUS_COLORS[agent.status] ?? AGENT_STATUS_COLORS.never_connected}`}>
                    {agent.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex justify-between"><span>IP</span><span className="font-mono">{agent.ip ?? "—"}</span></div>
                  <div className="flex justify-between"><span>OS</span><span>{agent.os?.name ?? agent.os ?? "—"}</span></div>
                  <div className="flex justify-between"><span>Version</span><span>{agent.version ?? "—"}</span></div>
                  <div className="flex justify-between"><span>Last Seen</span><span>{formatDate(agent.lastKeepAlive ?? agent.lastSeen)}</span></div>
                </div>
              </div>
            ))}
            {agentList.length === 0 && (
              <div className="col-span-3 text-center py-8 text-muted-foreground">
                <Server className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No agents registered</p>
              </div>
            )}
          </div>
        )
      )}

      {/* Playbooks Tab */}
      {activeTab === "playbooks" && (
        playbooksLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading playbooks...
          </div>
        ) : (
          <div className="space-y-3">
            {playbookList.map((pb: any) => (
              <div key={pb.id} className="bg-card border rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{pb.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{pb.description}</div>
                  <div className="flex gap-2 mt-2">
                    {(pb.tags ?? []).map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                    ))}
                  </div>
                </div>
                <Button
                  size="sm"
                  className="bg-accent hover:bg-[#b8891a] text-white"
                  disabled={triggerPlaybookMutation.isPending}
                  onClick={() => triggerPlaybookMutation.mutate({ playbookId: pb.id, alertId: selectedAlert?.id ?? "manual" })}
                >
                  <Play className="w-3 h-3 mr-1" /> Run
                </Button>
              </div>
            ))}
            {playbookList.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">No playbooks configured</div>
            )}
          </div>
        )
      )}

      {/* Security Score Tab */}
      {activeTab === "score" && securityScore && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-4xl font-bold text-green-600">{(securityScore as any).score}</div>
              <div className="text-sm text-muted-foreground mt-1">Overall Score</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-3xl font-bold">{(securityScore as any).grade}</div>
              <div className="text-sm text-muted-foreground mt-1">Grade</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-green-600">{(securityScore as any).passedChecks}</div>
              <div className="text-sm text-muted-foreground mt-1">Passed</div>
            </div>
            <div className="bg-card border rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-red-600">{(securityScore as any).failedChecks}</div>
              <div className="text-sm text-muted-foreground mt-1">Failed</div>
            </div>
          </div>
          {(securityScore as any).categories && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-4 py-2 text-sm font-medium">Category Breakdown</div>
              <div className="divide-y">
                {Object.entries((securityScore as any).categories).map(([cat, score]: [string, any]) => (
                  <div key={cat} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="capitalize">{cat.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 bg-muted rounded-full h-2">
                        <div
                          className="bg-accent h-2 rounded-full"
                          style={{ width: `${Math.min(100, typeof score === "number" ? score : 0)}%` }}
                        />
                      </div>
                      <span className="font-medium w-8 text-right">{typeof score === "number" ? score : "—"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alert Detail Dialog */}
      <Dialog open={selectedAlert !== null} onOpenChange={() => setSelectedAlert(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Alert Details
            </DialogTitle>
          </DialogHeader>
          {selectedAlert && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-muted-foreground">Severity</div>
                  <Badge className={`text-xs border mt-1 ${SEVERITY_COLORS[selectedAlert.severity ?? "info"]}`}>
                    {selectedAlert.severity ?? `Level ${selectedAlert.level}`}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Agent</div>
                  <div className="font-medium">{selectedAlert.agent?.name ?? selectedAlert.agentName ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Rule ID</div>
                  <div className="font-mono">{selectedAlert.rule?.id ?? selectedAlert.ruleId ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Time</div>
                  <div className="text-xs">{formatDate(selectedAlert.timestamp ?? selectedAlert.createdAt)}</div>
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Description</div>
                <div className="mt-1 bg-muted/50 rounded p-2 text-xs">
                  {selectedAlert.rule?.description ?? selectedAlert.description ?? "No description"}
                </div>
              </div>
              {selectedAlert.data && (
                <div>
                  <div className="text-muted-foreground">Raw Data</div>
                  <pre className="mt-1 bg-muted/50 rounded p-2 text-xs overflow-x-auto">
                    {JSON.stringify(selectedAlert.data, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {selectedAlert && !selectedAlert.acknowledged && (
              <Button
                className="bg-accent hover:bg-[#b8891a] text-white"
                disabled={acknowledgeMutation.isPending}
                onClick={() => acknowledgeMutation.mutate({ alertId: selectedAlert.id })}
              >
                <CheckCircle className="w-4 h-4 mr-2" /> Acknowledge
              </Button>
            )}
            <Button variant="outline" onClick={() => setSelectedAlert(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
