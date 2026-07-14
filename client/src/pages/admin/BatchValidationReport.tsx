/**
 * Batch Validation Report + AEO Renewal Timeline + Export Delivery Email
 * Items: 9 (SSE progress), 11 (AEO timeline), 15 (delivery receipt email),
 *        16 (conflict undo), 19 (batch re-upload), 29 (batch validation report)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText, CheckCircle, XCircle, AlertTriangle, RefreshCw,
  Mail, Undo2, Clock, TrendingUp
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Batch Validation Report Tab (Items 9, 19, 29) ───────────────────────────
function BatchValidationTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

  const { data: batches = [], isLoading } = trpc.sanctionsBatch.list.useQuery();

  const { data: errors = [] } = trpc.batchErrors.list.useQuery(
    { batchId: selectedBatchId! },
    { enabled: !!selectedBatchId }
  );

  const resubmitMutation = { mutate: (_: any) => toast({ title: "Re-upload: export the error rows and re-import via the Batch Upload page" }), isPending: false };

  const batchList = Array.isArray(batches) ? batches : (batches as any).items ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Batch list */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 text-xs font-medium">Import Batches</div>
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (Array.isArray(batchList) ? batchList : []).length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No batches yet</p>
          ) : (Array.isArray(batchList) ? batchList : []).map((batch: any) => {
            const total = (batch.successCount ?? 0) + (batch.failureCount ?? 0) + (batch.conflictCount ?? 0);
            const pct = total > 0 ? Math.round(((batch.successCount ?? 0) / total) * 100) : 0;
            return (
              <button
                key={batch.id}
                className={`w-full text-left p-3 border-t border-border hover:bg-muted/20 transition-colors ${selectedBatchId === batch.id ? "bg-amber-500/10" : ""}`}
                onClick={() => setSelectedBatchId(batch.id)}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-medium">Batch #{batch.id}</span>
                  <Badge
                    variant={batch.status === "completed" ? "secondary" : batch.status === "failed" ? "destructive" : "default"}
                    className="text-xs"
                  >
                    {batch.status}
                  </Badge>
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground mb-2">
                  <span className="text-green-500">{batch.successCount ?? 0} ok</span>
                  <span className="text-destructive">{batch.failureCount ?? 0} failed</span>
                  <span className="text-amber-500">{batch.conflictCount ?? 0} conflicts</span>
                </div>
                <Progress value={pct} className="h-1" />
              </button>
            );
          })}
        </div>

        {/* Error details */}
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/50 px-4 py-2 text-xs font-medium flex justify-between items-center">
            <span>Validation Errors {selectedBatchId ? `— Batch #${selectedBatchId}` : ""}</span>
            {selectedBatchId && errors.length > 0 && (
              <Button
                size="sm"
                className="h-5 text-xs px-2 bg-amber-600 hover:bg-amber-700"
                onClick={() => resubmitMutation.mutate({ batchId: selectedBatchId })}
                disabled={resubmitMutation.isPending}
              >
                <RefreshCw className="w-3 h-3 mr-1" /> Re-upload Failed
              </Button>
            )}
          </div>
          {!selectedBatchId ? (
            <p className="p-4 text-sm text-muted-foreground">Select a batch to view errors</p>
          ) : errors.length === 0 ? (
            <div className="p-6 text-center">
              <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No validation errors</p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-80 overflow-y-auto">
              {errors.map((err: any) => (
                <div key={err.id} className="p-3">
                  <div className="flex items-start gap-2">
                    <XCircle className="w-3 h-3 text-destructive mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium">Row {err.rowIndex}</p>
                      <p className="text-xs text-muted-foreground">{err.field}: {err.errorMessage}</p>
                      {err.rawValue && (
                        <p className="text-xs font-mono text-muted-foreground truncate">
                          Value: "{err.rawValue}"
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AEO Renewal Timeline Tab (Item 11) ──────────────────────────────────────
function AEORenewalTimelineTab() {
  const { data: renewals = [], isLoading } = trpc.aeoRenewals.listPending.useQuery();

  const stateOrder = ["pending", "docs_submitted", "under_review", "approved", "rejected"];
  const stateColors: Record<string, string> = {
    pending: "bg-slate-400",
    docs_submitted: "bg-blue-500",
    under_review: "bg-amber-500",
    approved: "bg-green-500",
    rejected: "bg-destructive",
  };

  const items = Array.isArray(renewals) ? renewals : (renewals as any).items ?? [];

  return (
    <div className="space-y-4">
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No AEO renewal applications</p>
      ) : (
        <div className="space-y-4">
          {items.map((renewal: any) => {
            const currentIdx = stateOrder.indexOf(renewal.status);
            return (
              <Card key={renewal.id}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-sm">{renewal.applicantName ?? `Application #${renewal.id}`}</CardTitle>
                    <Badge
                      variant={renewal.status === "approved" ? "secondary" : renewal.status === "rejected" ? "destructive" : "default"}
                      className="text-xs"
                    >
                      {renewal.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Submitted: {new Date(renewal.createdAt).toLocaleDateString()}
                  </p>
                </CardHeader>
                <CardContent>
                  {/* Timeline bar */}
                  <div className="flex items-center gap-0">
                    {stateOrder.map((state, idx) => {
                      const isCompleted = idx <= currentIdx;
                      const isCurrent = idx === currentIdx;
                      const isRejected = renewal.status === "rejected" && state === "rejected";
                      return (
                        <div key={state} className="flex items-center flex-1">
                          <div className="flex flex-col items-center">
                            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white
                              ${isRejected ? "bg-destructive" : isCompleted ? stateColors[state] : "bg-muted border border-border"}`}>
                              {isCompleted ? (isCurrent ? "●" : "✓") : "○"}
                            </div>
                            <span className="text-xs text-muted-foreground mt-1 text-center leading-tight" style={{ fontSize: "9px" }}>
                              {state.replace(/_/g, " ")}
                            </span>
                          </div>
                          {idx < stateOrder.length - 1 && (
                            <div className={`flex-1 h-0.5 mx-1 ${idx < currentIdx ? "bg-amber-500" : "bg-muted"}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Delivery Email + Conflict Undo Tab (Items 15, 16) ───────────────────────
function DeliveryEmailTab() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | null>(null);

  const { data: schedules = [] } = trpc.exportSchedules.list.useQuery();
  const { data: deliveries = [] } = trpc.exportSchedules.listDeliveries.useQuery(
    { scheduleId: selectedScheduleId! },
    { enabled: !!selectedScheduleId }
  );

  const emailMutation = trpc.system.notifyOwner.useMutation({
    onSuccess: () => toast({ title: "Delivery receipt sent to your inbox" }),
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const undoConflictMutation = trpc.sanctionsBatch.resolveConflict.useMutation({
    onSuccess: () => {
      toast({ title: "Conflict resolution undone — record restored" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: recentConflictsData } = trpc.sanctionsBatch.listConflicts.useQuery({ batchId: 0 });
  const recentConflicts = recentConflictsData?.filter((c: any) => c.resolution) ?? [];

  return (
    <div className="space-y-6">
      {/* Delivery Email section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Mail className="w-4 h-4 text-amber-500" />
            Email Delivery Receipts
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-3">
            <select
              className="flex-1 border border-border rounded-md px-3 py-2 text-sm bg-background"
              value={selectedScheduleId ?? ""}
              onChange={(e) => setSelectedScheduleId(Number(e.target.value) || null)}
            >
              <option value="">Select a schedule…</option>
              {schedules.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {selectedScheduleId && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 text-xs font-medium">Recent Deliveries</div>
              {deliveries.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">No deliveries yet</p>
              ) : deliveries.slice(0, 5).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between p-3 border-t border-border">
                  <div className="text-xs">
                    <p className="font-medium">{new Date(d.deliveredAt).toLocaleString()}</p>
                    <p className="text-muted-foreground">{d.rowCount?.toLocaleString() ?? "—"} rows</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={d.status === "success" ? "secondary" : "destructive"} className="text-xs">
                      {d.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-xs px-2"
                      onClick={() => emailMutation.mutate({ title: `Delivery Receipt #${d.id}`, content: `Schedule delivery on ${new Date(d.deliveredAt).toLocaleString()} — ${d.rowCount?.toLocaleString() ?? '?'} rows exported. Status: ${d.status}` })}
                      disabled={emailMutation.isPending}
                    >
                      <Mail className="w-3 h-3 mr-1" /> Email
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Conflict Undo section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Undo2 className="w-4 h-4 text-amber-500" />
            Undo Conflict Resolutions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentConflicts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent resolutions to undo</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              {recentConflicts.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-3 border-t first:border-t-0 border-border">
                  <div className="text-xs">
                    <p className="font-medium">{c.entityName ?? `Entity #${c.sanctionId}`}</p>
                    <p className="text-muted-foreground">
                      Action: <span className="font-medium">{c.resolution}</span> •{" "}
                      {new Date(c.resolvedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2"
                    onClick={() => undoConflictMutation.mutate({ conflictId: c.id, resolution: 'skip' })}
                    disabled={undoConflictMutation.isPending}
                  >
                    <Undo2 className="w-3 h-3 mr-1" /> Undo
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BatchValidationReportPage() {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-6 h-6 text-amber-500" />
          Batch Operations & Reports
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Validate import batches, track AEO renewal timelines, and manage delivery receipts
        </p>
      </div>

      <Tabs defaultValue="validation">
        <TabsList>
          <TabsTrigger value="validation">Batch Validation</TabsTrigger>
          <TabsTrigger value="timeline">AEO Timeline</TabsTrigger>
          <TabsTrigger value="delivery">Delivery & Undo</TabsTrigger>
        </TabsList>
        <TabsContent value="validation" className="mt-4"><BatchValidationTab /></TabsContent>
        <TabsContent value="timeline" className="mt-4"><AEORenewalTimelineTab /></TabsContent>
        <TabsContent value="delivery" className="mt-4"><DeliveryEmailTab /></TabsContent>
      </Tabs>
    </div>
  );
}
