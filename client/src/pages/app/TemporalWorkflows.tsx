/**
 * Temporal Workflow Traces — wired to real tRPC temporal router
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Workflow, RefreshCw, CheckCircle, Clock, XCircle, AlertTriangle } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  RUNNING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  TIMED_OUT: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  CANCELLED: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function TemporalWorkflows() {
  const { data: status, isLoading: statusLoading, refetch } = trpc.temporal.getSystemStatus.useQuery();
  const { data: workflows, isLoading: wfLoading } = trpc.temporal.listWorkflows.useQuery({ limit: 30 });

  return (
    <DashboardLayout title="Workflow Engine">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Workflow className="h-6 w-6 text-primary" />Clearance Workflow Tracker
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track the step-by-step progress of every shipment declaration through the clearance process
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        {/* Status Card */}
        {statusLoading ? <Skeleton className="h-24 w-full" /> : status && (
          <Card className={status.connected ? "border-emerald-500/30" : "border-amber-500/30"}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className={`h-3 w-3 rounded-full ${status.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <div>
                <p className="font-semibold">{status.connected ? "Workflow Engine: Live" : "Workflow Engine: Simulation Mode"}</p>
                <p className="text-xs text-muted-foreground">
                  Environment: {status.namespace} · Mode: {status.mode} · Queues: {status.taskQueues?.join(", ")}
                </p>
              </div>
              <div className="ml-auto grid grid-cols-3 gap-4 text-center">
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

        {/* Workflow List */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Clearance Processes</CardTitle></CardHeader>
          <CardContent className="p-0">
            {wfLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:8}).map((_,i)=><Skeleton key={i} className="h-12 w-full"/>)}</div>
            ) : (workflows?.workflows?.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Workflow className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No workflows yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Workflow ID</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Declaration</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Current Step</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Started</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {workflows?.workflows.map((w: any) => (
                      <tr key={w.workflowId} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs">{w.workflowId}</td>
                        <td className="p-3 text-xs">{w.workflowType}</td>
                        <td className="p-3 font-mono text-xs">{w.declarationNumber ?? "—"}</td>
                        <td className="p-3"><Badge variant="outline" className={STATUS_STYLES[w.status] ?? ""}>{w.status}</Badge></td>
                        <td className="p-3 text-xs text-muted-foreground">{w.currentStep ?? "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{w.startedAt ? new Date(w.startedAt).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
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
