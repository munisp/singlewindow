/**
 * HeartbeatAdmin.tsx
 * Admin page for managing the tenant DNS propagation poller Heartbeat job.
 * Provides full lifecycle control: create, pause, resume, update cron, delete.
 * Accessible at /app/admin/heartbeat-admin (keycloakAdminProcedure gated).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Plus,
  Settings,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Globe,
} from "lucide-react";

const DEFAULT_CRON = "0 0 */15 * * *";

export default function HeartbeatAdmin() {
  const { toast } = useToast();
  const [newCron, setNewCron] = useState(DEFAULT_CRON);
  const [createCron, setCreateCron] = useState(DEFAULT_CRON);
  const [createDesc, setCreateDesc] = useState(
    "Auto-verify pending tenant custom domains via DNS TXT lookup"
  );

  const utils = trpc.useUtils();

  const { data: status, isLoading, refetch } = trpc.heartbeatAdmin.getPollerStatus.useQuery(
    undefined,
    { refetchInterval: 30_000 }
  );

  const { data: allJobs, isLoading: allJobsLoading } =
    trpc.heartbeatAdmin.listAllJobs.useQuery(undefined, { refetchInterval: 60_000 });

  const createPoller = trpc.heartbeatAdmin.createPoller.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Poller created",
        description: `Task UID: ${data.taskUid}. Next run: ${data.nextExecutionAt ?? "pending"}`,
      });
      utils.heartbeatAdmin.getPollerStatus.invalidate();
      utils.heartbeatAdmin.listAllJobs.invalidate();
    },
    onError: (err) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const pausePoller = trpc.heartbeatAdmin.pausePoller.useMutation({
    onSuccess: () => {
      toast({ title: "Poller paused" });
      utils.heartbeatAdmin.getPollerStatus.invalidate();
    },
    onError: (err) => toast({ title: "Pause failed", description: err.message, variant: "destructive" }),
  });

  const resumePoller = trpc.heartbeatAdmin.resumePoller.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Poller resumed",
        description: `Next run: ${data.nextExecutionAt ?? "pending"}`,
      });
      utils.heartbeatAdmin.getPollerStatus.invalidate();
    },
    onError: (err) => toast({ title: "Resume failed", description: err.message, variant: "destructive" }),
  });

  const updateCron = trpc.heartbeatAdmin.updatePollerCron.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Cron updated",
        description: `Next run: ${data.nextExecutionAt ?? "pending"}`,
      });
      utils.heartbeatAdmin.getPollerStatus.invalidate();
    },
    onError: (err) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deletePoller = trpc.heartbeatAdmin.deletePoller.useMutation({
    onSuccess: () => {
      toast({ title: "Poller deleted" });
      utils.heartbeatAdmin.getPollerStatus.invalidate();
      utils.heartbeatAdmin.listAllJobs.invalidate();
    },
    onError: (err) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const isActive = status?.isEnabled === true;
  const hasJob = !!status?.taskUid;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Clock className="w-6 h-6 text-primary" />
            Heartbeat Job Manager
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage the tenant DNS propagation polling Heartbeat job.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* DNS Poller Status Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="w-5 h-5" />
            Tenant Domain DNS Poller
            {hasJob ? (
              isActive ? (
                <Badge className="bg-green-500 text-white ml-2">Active</Badge>
              ) : (
                <Badge variant="secondary" className="ml-2">Paused</Badge>
              )
            ) : (
              <Badge variant="outline" className="ml-2">Not Created</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Polls all tenants with unverified custom domains every 15 minutes, performing DNS TXT
            lookups and auto-marking them verified when the token is found.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading job status…</div>
          ) : hasJob ? (
            <>
              {/* Job details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Task UID</span>
                  <p className="font-mono text-xs mt-0.5 truncate">{status.taskUid}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Cron Expression</span>
                  <p className="font-mono text-xs mt-0.5">{status.cronExpression}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Callback Path</span>
                  <p className="font-mono text-xs mt-0.5">{status.callbackPath}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Next Execution</span>
                  <p className="text-xs mt-0.5">
                    {status.nextExecutionAt
                      ? new Date(status.nextExecutionAt).toLocaleString()
                      : "—"}
                  </p>
                </div>
                {status.lastExecutedAt && (
                  <div>
                    <span className="text-muted-foreground">Last Executed</span>
                    <p className="text-xs mt-0.5">
                      {new Date(status.lastExecutedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                {isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => pausePoller.mutate()}
                    disabled={pausePoller.isPending}
                  >
                    <Pause className="w-4 h-4 mr-2" />
                    {pausePoller.isPending ? "Pausing…" : "Pause"}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => resumePoller.mutate()}
                    disabled={resumePoller.isPending}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    {resumePoller.isPending ? "Resuming…" : "Resume"}
                  </Button>
                )}

                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={deletePoller.isPending}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      {deletePoller.isPending ? "Deleting…" : "Delete"}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete DNS Poller Job?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently remove the Heartbeat job from the platform. Tenant
                        domains will no longer be auto-verified. You can re-create it at any time.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => deletePoller.mutate()}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              {/* Update cron */}
              <div className="border-t pt-4 space-y-2">
                <Label className="flex items-center gap-1">
                  <Settings className="w-3.5 h-3.5" />
                  Update Cron Expression
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={newCron}
                    onChange={(e) => setNewCron(e.target.value)}
                    placeholder="0 0 */15 * * *"
                    className="font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={() => updateCron.mutate({ cronExpression: newCron })}
                    disabled={updateCron.isPending || !newCron.trim()}
                  >
                    {updateCron.isPending ? "Updating…" : "Update"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  6-field cron: sec min hour day-of-month month day-of-week. Default:{" "}
                  <code className="font-mono">0 0 */15 * * *</code> (every 15 min)
                </p>
              </div>
            </>
          ) : (
            /* Create form */
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-amber-600 text-sm">
                <AlertTriangle className="w-4 h-4" />
                The DNS poller has not been created yet. Create it to enable automatic tenant domain
                verification.
              </div>
              <div className="space-y-2">
                <Label>Cron Expression</Label>
                <Input
                  value={createCron}
                  onChange={(e) => setCreateCron(e.target.value)}
                  placeholder="0 0 */15 * * *"
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input
                  value={createDesc}
                  onChange={(e) => setCreateDesc(e.target.value)}
                  placeholder="Description…"
                />
              </div>
              <Button
                onClick={() =>
                  createPoller.mutate({ cronExpression: createCron, description: createDesc })
                }
                disabled={createPoller.isPending}
              >
                <Plus className="w-4 h-4 mr-2" />
                {createPoller.isPending ? "Creating…" : "Create DNS Poller Job"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Note: The site must be deployed (published) before the Heartbeat platform can reach
                the callback endpoint.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Platform Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Platform Heartbeat Jobs</CardTitle>
          <CardDescription>
            Live view of all Heartbeat jobs registered for this project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {allJobsLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : !allJobs || (Array.isArray(allJobs) && allJobs.length === 0) ? (
            <div className="text-muted-foreground text-sm">No jobs found.</div>
          ) : (
            <div className="space-y-2">
              {(Array.isArray(allJobs) ? allJobs : []).map((job: any) => (
                <div
                  key={job.taskUid ?? job.name}
                  className="flex items-center justify-between p-3 rounded-md border text-sm"
                >
                  <div className="flex items-center gap-3">
                    {job.enable !== false ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground" />
                    )}
                    <div>
                      <p className="font-medium">{job.name ?? job.taskUid}</p>
                      <p className="text-muted-foreground text-xs font-mono">{job.cron}</p>
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {job.nextExecutionAt
                      ? new Date(job.nextExecutionAt).toLocaleString()
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
