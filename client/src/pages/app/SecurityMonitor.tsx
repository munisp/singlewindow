/**
 * TradeGateway NGSWTP — Security Monitor (PWA)
 * Sprint v67 — Insider Threat Prevention UI
 *
 * Tabbed view:
 *   1. Active Sessions — list all active user sessions with force-logout capability
 *   2. Anomaly Alerts — alerts from the Python anomaly detection service (OpenSearch)
 *   3. 4-Eyes Queue — pending privileged action approvals
 *   4. Audit Log — paginated immutable audit trail
 *   5. Audit Chain — TigerBeetle chain integrity verification
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Shield, Users, AlertTriangle, CheckCircle2, XCircle, Clock,
  RefreshCw, LogOut, Eye, Lock, Activity, Database, ChevronLeft, ChevronRight,
} from "lucide-react";

// ─── Severity badge ───────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, string> = {
    CRITICAL: "bg-red-600 text-white",
    HIGH: "bg-orange-500 text-white",
    MEDIUM: "bg-yellow-500 text-black",
    LOW: "bg-blue-500 text-white",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${variants[severity] ?? "bg-gray-500 text-white"}`}>
      {severity}
    </span>
  );
}

// ─── Active Sessions Tab ──────────────────────────────────────────────────────

function ActiveSessionsTab() {
  const { data, isLoading, refetch } = trpc.insiderThreat.getActiveSessions.useQuery();
  const [logoutReason, setLogoutReason] = useState("");
  const [targetSession, setTargetSession] = useState<{ sessionId: string; userId: number } | null>(null);

  const forceLogout = trpc.insiderThreat.forceLogout.useMutation({
    onSuccess: () => {
      toast.success("Session terminated", { description: `Session ${targetSession?.sessionId} has been invalidated.` });
      setTargetSession(null);
      setLogoutReason("");
      refetch();
    },
    onError: (err) => toast.error("Force logout failed", { description: err.message }),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const sessions = data?.sessions ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.total ?? 0} active session{(data?.total ?? 0) !== 1 ? "s" : ""} · source: {data?.source ?? "—"}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {sessions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No active sessions found</p>
          <p className="text-xs mt-1">Redis may be unavailable in sandbox mode</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessions.map((s: any, i: number) => (
            <Card key={i} className="p-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{s.userId ?? s.sessionId ?? "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">
                    IP: {s.ipAddress ?? "—"} · Last active: {s.lastActivity ? new Date(s.lastActivity).toLocaleString() : "—"}
                  </p>
                </div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setTargetSession({ sessionId: s.sessionId ?? s.id, userId: s.userId ?? 0 })}
                    >
                      <LogOut className="h-3 w-3 mr-1" /> Force Logout
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Force Logout Session</DialogTitle>
                      <DialogDescription>
                        This will immediately invalidate session <code>{targetSession?.sessionId}</code>.
                        The user will be logged out on their next request.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2">
                      <Label>Reason (required)</Label>
                      <Textarea
                        placeholder="Describe why this session is being terminated..."
                        value={logoutReason}
                        onChange={(e) => setLogoutReason(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setTargetSession(null)}>Cancel</Button>
                      <Button
                        variant="destructive"
                        disabled={!logoutReason.trim() || forceLogout.isPending}
                        onClick={() => {
                          if (!targetSession) return;
                          forceLogout.mutate({
                            sessionId: targetSession.sessionId,
                            reason: logoutReason,
                            targetUserId: targetSession.userId,
                          });
                        }}
                      >
                        {forceLogout.isPending ? "Terminating..." : "Terminate Session"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Anomaly Alerts Tab — SSE-powered live feed ───────────────────────────────

interface LiveAlert {
  type: "anomaly_detected" | "threat_blocked";
  userId?: string;
  sessionId?: string;
  ruleId?: string;
  ruleName?: string;
  severity?: string;
  anomalyScore?: number;
  description?: string;
  action?: string;
  endpoint?: string;
  ts?: number;
  id: string;
}

function AnomalyAlertsTab() {
  const [liveAlerts, setLiveAlerts] = useState<LiveAlert[]>([]);
  const [sseStatus, setSseStatus] = useState<"connecting" | "connected" | "error" | "idle">("idle");
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | undefined>();
  const esRef = useState<EventSource | null>(null);

  // Historical alerts from OpenSearch (fallback / initial load)
  const { data, isLoading, refetch } = trpc.insiderThreat.getAnomalyAlerts.useQuery(
    { severity, limit: 50 },
    { refetchInterval: 60_000 }
  );

  // SSE token mutation
  const getToken = trpc.insiderThreat.getSSEToken.useMutation({
    onSuccess: ({ token }) => {
      // Close any existing connection
      if (esRef[0]) { esRef[0].close(); }

      setSseStatus("connecting");
      const es = new EventSource(`/api/events/anomalies?token=${encodeURIComponent(token)}`);
      // @ts-ignore — store ref
      esRef[1](es);

      es.addEventListener("connected", () => setSseStatus("connected"));

      es.addEventListener("anomaly", (e) => {
        try {
          const data = JSON.parse(e.data) as Omit<LiveAlert, "id">;
          setLiveAlerts((prev) => [{ ...data, id: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 200));
        } catch { /* ignore */ }
      });

      es.addEventListener("blocked", (e) => {
        try {
          const data = JSON.parse(e.data) as Omit<LiveAlert, "id">;
          setLiveAlerts((prev) => [{ ...data, type: "threat_blocked" as const, id: `${Date.now()}-${Math.random()}` }, ...prev].slice(0, 200));
        } catch { /* ignore */ }
      });

      es.onerror = () => {
        setSseStatus("error");
        es.close();
      };
    },
    onError: () => setSseStatus("error"),
  });

  const historicalAlerts = data?.alerts ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((s) => (
            <Button
              key={s}
              variant={severity === s ? "default" : "outline"}
              size="sm"
              onClick={() => setSeverity(severity === s ? undefined : s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {sseStatus === "connected" ? (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          ) : sseStatus === "connecting" ? (
            <span className="text-xs text-yellow-600">Connecting…</span>
          ) : sseStatus === "error" ? (
            <span className="text-xs text-red-500">Stream error</span>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => getToken.mutate()}
            disabled={getToken.isPending}
          >
            <Activity className="h-4 w-4 mr-1" />
            {sseStatus === "connected" ? "Reconnect" : "Connect Live"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Historical
          </Button>
        </div>
      </div>

      {/* Live alerts from SSE */}
      {liveAlerts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Live Feed ({liveAlerts.length})</p>
          <div className="space-y-2">
            {liveAlerts
              .filter((a) => !severity || a.severity === severity)
              .map((a) => (
                <Card key={a.id} className="p-3 border-l-4 border-l-orange-500">
                  <div className="flex items-start gap-3">
                    {a.type === "threat_blocked"
                      ? <Lock className="h-4 w-4 mt-0.5 text-red-600 shrink-0" />
                      : <AlertTriangle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">
                          {a.type === "threat_blocked" ? "🚫 Blocked" : a.ruleName ?? "Anomaly Detected"}
                        </span>
                        {a.severity && <SeverityBadge severity={a.severity} />}
                        {a.ruleId && <Badge variant="outline" className="text-xs">{a.ruleId}</Badge>}
                        <Badge variant="secondary" className="text-xs">
                          score: {a.anomalyScore?.toFixed(3) ?? "—"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                      <p className="text-xs text-muted-foreground">
                        User: {a.userId} · {a.action ?? ""} · {a.ts ? new Date(a.ts).toLocaleString() : "—"}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
          </div>
        </div>
      )}

      {/* Historical alerts from OpenSearch */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Historical (OpenSearch)</p>
        {isLoading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : historicalAlerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Activity className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No historical alerts found</p>
            <p className="text-xs mt-1">OpenSearch may be unavailable in sandbox mode</p>
          </div>
        ) : (
          <div className="space-y-2">
            {historicalAlerts.map((a: any, i: number) => (
              <Card key={i} className="p-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-4 w-4 mt-0.5 text-orange-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{a.rule_name ?? a.ruleName}</span>
                      <SeverityBadge severity={a.severity} />
                      <Badge variant="outline" className="text-xs">{a.rule_id ?? a.ruleId}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{a.description}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      User: {a.user_id ?? a.userId} · {a.timestamp ? new Date(a.timestamp * 1000).toLocaleString() : "—"}
                    </p>
                    <p className="text-xs font-medium text-blue-600 mt-0.5">
                      Action: {a.recommended_action ?? a.recommendedAction}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 4-Eyes Queue Tab ─────────────────────────────────────────────────────────

function FourEyesQueueTab() {
  const { user } = useAuth();
  const { data, isLoading, refetch } = trpc.insiderThreat.getPendingFourEyes.useQuery(
    undefined,
    { refetchInterval: 15_000 }
  );
  const [reason, setReason] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const approveMutation = trpc.insiderThreat.approveFourEyes.useMutation({
    onSuccess: (r) => {
      toast.success(`Request ${r.status}`, { description: `Approval ID: ${r.id}` });
      setActiveId(null);
      setReason("");
      refetch();
    },
    onError: (err) => toast.error("Action failed", { description: err.message }),
  });

  const requests = data?.requests ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {data?.total ?? 0} pending approval{(data?.total ?? 0) !== 1 ? "s" : ""}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : requests.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No pending 4-eyes approvals</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((r: any) => (
            <Card key={r.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-amber-500" />
                    <span className="font-medium text-sm">{r.action}</span>
                    <Badge variant="outline">{r.entityType}/{r.entityId}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
                  <p className="text-xs text-muted-foreground">
                    Requested by: <strong>{r.requesterName}</strong> · {new Date(r.createdAt).toLocaleString()}
                  </p>
                  {r.requesterId === user?.id && (
                    <p className="text-xs text-amber-600 mt-1">⚠ You cannot approve your own request</p>
                  )}
                </div>
                {r.requesterId !== user?.id && (
                  <div className="flex gap-2 shrink-0">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="default" onClick={() => setActiveId(r.id)}>
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Approve
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Approve Action</DialogTitle>
                          <DialogDescription>Provide a reason for approving this privileged action.</DialogDescription>
                        </DialogHeader>
                        <Textarea
                          placeholder="Approval reason..."
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={3}
                        />
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setActiveId(null)}>Cancel</Button>
                          <Button
                            disabled={!reason.trim() || approveMutation.isPending}
                            onClick={() => approveMutation.mutate({ approvalId: r.id, decision: "approved", reason })}
                          >
                            Confirm Approval
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="destructive" onClick={() => setActiveId(r.id)}>
                          <XCircle className="h-3 w-3 mr-1" /> Deny
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Deny Action</DialogTitle>
                          <DialogDescription>Provide a reason for denying this privileged action.</DialogDescription>
                        </DialogHeader>
                        <Textarea
                          placeholder="Denial reason..."
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          rows={3}
                        />
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setActiveId(null)}>Cancel</Button>
                          <Button
                            variant="destructive"
                            disabled={!reason.trim() || approveMutation.isPending}
                            onClick={() => approveMutation.mutate({ approvalId: r.id, decision: "denied", reason })}
                          >
                            Confirm Denial
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────

function AuditLogTab() {
  const [page, setPage] = useState(0);
  const limit = 25;
  const { data, isLoading } = trpc.insiderThreat.getAuditLog.useQuery(
    { limit, offset: page * limit },
    { keepPreviousData: true } as any
  );

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {page * limit + 1}–{page * limit + entries.length} · source: {data?.source ?? "—"}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={entries.length < limit} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1">{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Database className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>No audit log entries found</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left py-2 px-2">Time</th>
                <th className="text-left py-2 px-2">Action</th>
                <th className="text-left py-2 px-2">Entity</th>
                <th className="text-left py-2 px-2">Actor</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e: any) => (
                <tr key={e.id} className="border-b hover:bg-muted/30">
                  <td className="py-1.5 px-2 whitespace-nowrap">
                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </td>
                  <td className="py-1.5 px-2">
                    <Badge variant="outline" className="text-xs">{e.action}</Badge>
                  </td>
                  <td className="py-1.5 px-2">{e.entityType}/{e.entityId}</td>
                  <td className="py-1.5 px-2">{e.actorId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Audit Chain Tab ──────────────────────────────────────────────────────────

function AuditChainTab() {
  const { data, isLoading, refetch } = trpc.insiderThreat.verifyAuditChain.useQuery(
    undefined,
    { refetchInterval: 60_000 }
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">TigerBeetle immutable audit chain integrity</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Verify Now
        </Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <Card className="p-6">
          <div className="flex items-center gap-4">
            {data?.is_valid ? (
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            ) : (
              <XCircle className="h-12 w-12 text-red-500" />
            )}
            <div>
              <p className="text-lg font-semibold">
                {data?.is_valid ? "Chain Intact" : "Chain Compromised"}
              </p>
              <p className="text-sm text-muted-foreground">
                {data?.entries_checked ?? 0} entries verified · source: {data?.source ?? "—"}
              </p>
              {data?.first_broken_entry_index != null && (
                <p className="text-sm text-red-600">
                  First broken entry index: {data.first_broken_entry_index}
                </p>
              )}
              {data?.error && (
                <p className="text-xs text-red-500 mt-1">{data.error}</p>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SecurityMonitor() {
  const { user } = useAuth();

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-40" />
            <h2 className="text-xl font-semibold">Access Restricted</h2>
            <p className="text-muted-foreground mt-2">Security Monitor is only available to administrators.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Shield className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Security Monitor</h1>
            <p className="text-sm text-muted-foreground">
              Insider threat detection, session management, 4-eyes approvals, and immutable audit trail
            </p>
          </div>
        </div>

        <Tabs defaultValue="sessions">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="sessions">
              <Users className="h-4 w-4 mr-1" /> Active Sessions
            </TabsTrigger>
            <TabsTrigger value="alerts">
              <AlertTriangle className="h-4 w-4 mr-1" /> Anomaly Alerts
            </TabsTrigger>
            <TabsTrigger value="foureyes">
              <Eye className="h-4 w-4 mr-1" /> 4-Eyes Queue
            </TabsTrigger>
            <TabsTrigger value="auditlog">
              <Clock className="h-4 w-4 mr-1" /> Audit Log
            </TabsTrigger>
            <TabsTrigger value="chain">
              <Database className="h-4 w-4 mr-1" /> Chain Integrity
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sessions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Active Sessions</CardTitle>
                <CardDescription>All active user sessions stored in Redis. Force-logout suspicious sessions.</CardDescription>
              </CardHeader>
              <CardContent>
                <ActiveSessionsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alerts" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Anomaly Alerts</CardTitle>
                <CardDescription>
                  Real-time alerts from the Python anomaly detection service (10 detection rules).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AnomalyAlertsTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="foureyes" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>4-Eyes Approval Queue</CardTitle>
                <CardDescription>
                  Privileged actions requiring a second administrator's approval before execution.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FourEyesQueueTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="auditlog" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Audit Log</CardTitle>
                <CardDescription>Paginated audit trail of all system actions.</CardDescription>
              </CardHeader>
              <CardContent>
                <AuditLogTab />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chain" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>TigerBeetle Chain Integrity</CardTitle>
                <CardDescription>
                  Verify the SHA-256 chain hash of the immutable TigerBeetle audit log.
                  Any tampering will break the chain.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AuditChainTab />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
