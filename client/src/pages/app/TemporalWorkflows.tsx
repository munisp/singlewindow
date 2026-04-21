/**
 * TemporalWorkflows — full workflow tracker with search, filter by status, history, trigger
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Workflow, RefreshCw, Play, Search, ChevronRight, Clock, CheckCircle, AlertTriangle, Activity } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  TIMED_OUT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  TERMINATED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  CANCELLED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const WORKFLOW_TYPES = [
  "ALL",
  "customs_clearance",
  "permit_approval",
  "payment_processing",
  "risk_assessment",
  "document_verification",
  "post_clearance_audit",
];

export default function TemporalWorkflows() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [triggerForm, setTriggerForm] = useState({ type: "customs_clearance", declarationId: "", payload: "" });

  const { data: status, isLoading: statusLoading } = trpc.temporal.getSystemStatus.useQuery();
  const { data: workflows, isLoading: wfLoading, refetch, isError } = trpc.temporal.listWorkflows.useQuery({
    limit: 100,
    status: (statusFilter !== "ALL" ? statusFilter : "ALL") as "RUNNING" | "COMPLETED" | "FAILED" | "ALL",
  });

  const { data: history, isLoading: historyLoading } = trpc.temporal.getWorkflowHistory.useQuery(
    { workflowId: selectedWorkflowId! },
    { enabled: !!selectedWorkflowId }
  );

  const triggerMutation = trpc.temporal.triggerWorkflow.useMutation({
    onSuccess: (r) => {
      toast.success(`Workflow triggered: ${r.workflowId}`);
      setTriggerOpen(false);
      refetch();
    },
    onError: (e) => toast.error("Failed to trigger workflow", { description: e.message }),
  });

  const wfList = (workflows?.workflows ?? []).filter((w: any) => {
    const s = !search ||
      w.workflowId?.toLowerCase().includes(search.toLowerCase()) ||
      w.declarationNumber?.toLowerCase().includes(search.toLowerCase());
    const t = typeFilter === "ALL" || w.workflowType === typeFilter;
    return s && t;
  });

  return (
    <DashboardLayout title="Workflow Engine">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" />Clearance Workflow Tracker
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track and manage every shipment clearance workflow in real-time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
            <Button size="sm" onClick={() => setTriggerOpen(true)} className="gap-1.5">
              <Play className="h-4 w-4" />Trigger Workflow
            </Button>
          </div>
        </div>

        {/* System Status */}
        {statusLoading ? <Skeleton className="h-24 w-full" /> : status && (
          <Card className={status.connected ? "border-emerald-500/30" : "border-amber-500/30"}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`h-3 w-3 rounded-full ${status.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <div>
                <p className="font-semibold">{status.connected ? "Workflow Engine: Live" : "Workflow Engine: Simulation Mode"}</p>
                <p className="text-xs text-muted-foreground">
                  Namespace: {status.namespace} · Mode: {status.mode} · Queues: {status.taskQueues?.join(", ")}
                </p>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-6 text-center">
                <div>
                  <p className="text-xl font-bold text-blue-400">{status.stats?.activeWorkflows ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Running</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-emerald-400">{status.stats?.completedWorkflows ?? 0}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
                <div>
                  <p className="text-xl font-bold text-red-400">0</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search workflow ID or declaration…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["ALL", "RUNNING", "COMPLETED", "FAILED", "TIMED_OUT", "TERMINATED"].map(s => (
                <SelectItem key={s} value={s}>{s === "ALL" ? "All Statuses" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {WORKFLOW_TYPES.map(t => <SelectItem key={t} value={t}>{t === "ALL" ? "All Types" : t.replace(/_/g, " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground ml-auto">{wfList.length} workflow(s)</span>
        </div>

        <Tabs defaultValue="list">
          <TabsList>
            <TabsTrigger value="list">Workflow List</TabsTrigger>
            <TabsTrigger value="history" disabled={!selectedWorkflowId}>
              {selectedWorkflowId ? `History: ${selectedWorkflowId.slice(0, 12)}…` : "History (select workflow)"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="list">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4" />Clearance Workflows
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {wfLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : wfList.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Workflow className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No workflows found</p>
                    <p className="text-xs mt-1">Try adjusting filters or trigger a new workflow</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium text-muted-foreground">Workflow ID</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Declaration</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Current Step</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Started</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {wfList.map((w: any) => (
                          <tr key={w.workflowId} className="hover:bg-muted/20">
                            <td className="p-3 font-mono text-xs">{w.workflowId}</td>
                            <td className="p-3 text-xs capitalize">{w.workflowType?.replace(/_/g, " ")}</td>
                            <td className="p-3 font-mono text-xs">{w.declarationNumber ?? "—"}</td>
                            <td className="p-3">
                              <Badge variant="outline" className={STATUS_STYLES[w.status] ?? ""}>{w.status}</Badge>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">{w.currentStep ?? "—"}</td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {w.startedAt ? new Date(w.startedAt).toLocaleString() : "—"}
                            </td>
                            <td className="p-3">
                              <Button
                                variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs"
                                onClick={() => setSelectedWorkflowId(w.workflowId)}
                              >
                                <ChevronRight className="h-3 w-3" />History
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4" />Workflow Event History
                  {selectedWorkflowId && <span className="font-mono text-xs text-muted-foreground ml-2">{selectedWorkflowId}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
                ) : !history?.events?.length ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>No history events found</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {history.events.map((e: any, i: number) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border">
                        <div className="shrink-0 mt-0.5">
                          {e.eventType?.includes("COMPLETED") || e.eventType?.includes("SUCCESS") ? (
                            <CheckCircle className="h-4 w-4 text-emerald-400" />
                          ) : e.eventType?.includes("FAILED") || e.eventType?.includes("ERROR") ? (
                            <AlertTriangle className="h-4 w-4 text-red-400" />
                          ) : (
                            <Activity className="h-4 w-4 text-blue-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{e.eventType}</p>
                          {e.details && <p className="text-xs text-muted-foreground mt-0.5">{JSON.stringify(e.details).slice(0, 120)}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {e.timestamp ? new Date(e.timestamp).toLocaleString() : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Trigger Workflow Dialog */}
      <Dialog open={triggerOpen} onOpenChange={setTriggerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trigger New Workflow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Workflow Type</Label>
              <Select value={triggerForm.type} onValueChange={v => setTriggerForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORKFLOW_TYPES.filter(t => t !== "ALL").map(t => (
                    <SelectItem key={t} value={t}>{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Declaration ID (optional)</Label>
              <Input
                value={triggerForm.declarationId}
                onChange={e => setTriggerForm(f => ({ ...f, declarationId: e.target.value }))}
                placeholder="e.g. 12345"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Additional Payload (JSON, optional)</Label>
              <Input
                value={triggerForm.payload}
                onChange={e => setTriggerForm(f => ({ ...f, payload: e.target.value }))}
                placeholder='{"key": "value"}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTriggerOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                let payload: Record<string, unknown> = {};
                if (triggerForm.payload) {
                  try { payload = JSON.parse(triggerForm.payload); } catch { toast.error("Invalid JSON payload"); return; }
                }
                if (triggerForm.declarationId) payload.declarationId = Number(triggerForm.declarationId);
                const wfTypeMap: Record<string, "DeclarationClearanceWorkflow" | "PaymentProcessingWorkflow" | "KYCVerificationWorkflow" | "RiskAssessmentWorkflow"> = {
                  customs_clearance: "DeclarationClearanceWorkflow",
                  payment_processing: "PaymentProcessingWorkflow",
                  risk_assessment: "RiskAssessmentWorkflow",
                  kyc_verification: "KYCVerificationWorkflow",
                  permit_approval: "DeclarationClearanceWorkflow",
                  document_verification: "DeclarationClearanceWorkflow",
                  post_clearance_audit: "DeclarationClearanceWorkflow",
                };
                const wfType = wfTypeMap[triggerForm.type] ?? "DeclarationClearanceWorkflow";
                triggerMutation.mutate({ workflowType: wfType, declarationId: triggerForm.declarationId ? Number(triggerForm.declarationId) : undefined, input: payload });
              }}
              disabled={triggerMutation.isPending}
            >
              {triggerMutation.isPending ? "Triggering…" : "Trigger Workflow"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
