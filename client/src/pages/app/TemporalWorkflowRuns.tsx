/**
 * Temporal Workflow Runs Admin Page — Sprint v81
 * Monitor, filter, and re-trigger Temporal workflow runs.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, RefreshCw, Play, CheckCircle2, XCircle, Clock, AlertTriangle, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/10 text-green-400 border-green-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  timed_out: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <Activity className="w-3 h-3" />,
  completed: <CheckCircle2 className="w-3 h-3" />,
  failed: <XCircle className="w-3 h-3" />,
  cancelled: <XCircle className="w-3 h-3" />,
  timed_out: <Clock className="w-3 h-3" />,
};

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export default function TemporalWorkflowRuns() {
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [retriggerTarget, setRetriggerTarget] = useState<{ runId: string; workflowType: string } | null>(null);
  const PAGE_SIZE = 20;

  const statsQuery = trpc.temporalRuns.getWorkflowStats.useQuery();
  const typesQuery = trpc.temporalRuns.getWorkflowTypes.useQuery();
  const runsQuery = trpc.temporalRuns.getWorkflowRuns.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
    workflowType: typeFilter !== "ALL" ? typeFilter : undefined,
  });

  const retriggerMutation = trpc.temporalRuns.retriggerWorkflow.useMutation({
    onSuccess: (data) => {
      toast({ title: "Workflow re-triggered", description: data.message });
      setRetriggerTarget(null);
      runsQuery.refetch();
    },
    onError: (err) => {
      toast({ title: "Re-trigger failed", description: err.message, variant: "destructive" });
    },
  });

  const stats = statsQuery.data;
  const runs = runsQuery.data?.runs ?? [];
  const total = runsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Temporal Workflow Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor durable workflow executions across all queues</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => runsQuery.refetch()} disabled={runsQuery.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${runsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Running", value: stats?.running, color: "text-blue-400", icon: <Activity className="w-4 h-4" /> },
          { label: "Completed", value: stats?.completed, color: "text-green-400", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Failed", value: stats?.failed, color: "text-red-400", icon: <XCircle className="w-4 h-4" /> },
          { label: "Timed Out", value: stats?.timedOut, color: "text-amber-400", icon: <Clock className="w-4 h-4" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className={s.color}>{s.icon}</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>
                {statsQuery.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (s.value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {["running", "completed", "failed", "cancelled", "timed_out"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ").toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Workflow Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {(typesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground self-center ml-auto">
          {total} run{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Workflow Type</TableHead>
                <TableHead>Run ID</TableHead>
                <TableHead>Task Queue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No workflow runs found
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id} className="border-border hover:bg-muted/30">
                    <TableCell className="font-medium text-sm">{run.workflowType}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[140px]" title={run.runId}>
                      {run.runId.slice(0, 16)}…
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{run.taskQueue}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs gap-1 ${STATUS_COLORS[run.status] ?? ""}`}>
                        {STATUS_ICONS[run.status]}
                        {run.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDuration(run.durationMs)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {(run.status === "failed" || run.status === "timed_out") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setRetriggerTarget({ runId: run.runId, workflowType: run.workflowType })}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Re-trigger
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

      {/* Re-trigger Confirmation Dialog */}
      <Dialog open={!!retriggerTarget} onOpenChange={(open) => !open && setRetriggerTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-trigger Workflow</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to re-trigger <strong>{retriggerTarget?.workflowType}</strong>?
            A new workflow run will be submitted to the task queue.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetriggerTarget(null)}>Cancel</Button>
            <Button
              onClick={() => retriggerTarget && retriggerMutation.mutate({
                runId: retriggerTarget.runId,
                workflowType: retriggerTarget.workflowType,
              })}
              disabled={retriggerMutation.isPending}
            >
              {retriggerMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
              Re-trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
