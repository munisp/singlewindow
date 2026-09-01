import { useState } from "react";
import { useParams } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AlertCircle } from "lucide-react";

/**
 * CRM case detail + workflow actions (Phase 12).
 * All mutations surface server refusals (illegal transition, maker-checker
 * violation) as error toasts — nothing fails silently.
 */
export default function CaseDetail() {
  const params = useParams<{ id: string }>();
  const caseId = Number(params.id);
  const [assignee, setAssignee] = useState("");
  const [resolution, setResolution] = useState("");
  const [note, setNote] = useState("");

  const detail = trpc.cases.byId.useQuery({ id: caseId }, { enabled: Number.isInteger(caseId) && caseId > 0 });

  const invalidate = () => detail.refetch();
  const onError = (err: any) => toast.error(err.message);
  const onSuccess = (label: string) => (r: any) => {
    toast.success(label + (r?.eventPublished === false ? " (event publication degraded — recorded honestly)" : ""));
    invalidate();
  };

  const assign = trpc.cases.assign.useMutation({ onSuccess: onSuccess("Case assigned"), onError });
  const transition = trpc.cases.transition.useMutation({ onSuccess: onSuccess("Transition applied"), onError });
  const approve = trpc.cases.approveResolution.useMutation({ onSuccess: onSuccess("Resolution approved"), onError });

  if (detail.error) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Case unavailable</AlertTitle>
            <AlertDescription>{detail.error.message}</AlertDescription>
          </Alert>
        </div>
      </DashboardLayout>
    );
  }

  const c = detail.data?.case;
  const timeline = detail.data?.timeline ?? [];

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {!c && <p className="text-muted-foreground">Loading…</p>}
        {c && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-3">
                  {c.caseNumber} — {c.subject}
                  <Badge>{c.status.replace("_", " ")}</Badge>
                  <Badge variant="outline">{c.caseType}</Badge>
                  <Badge variant={c.priority === "critical" || c.priority === "high" ? "destructive" : "secondary"}>{c.priority}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid md:grid-cols-3 gap-4 text-sm">
                <div><span className="text-muted-foreground">Opened</span><div>{new Date(c.createdAt).toLocaleString()}</div></div>
                <div><span className="text-muted-foreground">Triage SLA</span><div>{c.slaTriageDue ? new Date(c.slaTriageDue).toLocaleString() : "—"}</div></div>
                <div><span className="text-muted-foreground">Resolution SLA</span><div>{c.slaResolutionDue ? new Date(c.slaResolutionDue).toLocaleString() : "—"}</div></div>
                <div><span className="text-muted-foreground">Assignee</span><div>{c.assignedTo ?? "unassigned"}</div></div>
                <div><span className="text-muted-foreground">Resolved by</span><div>{c.resolvedBy ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Resolution approved by</span><div>{c.resolutionApprovedBy ?? (c.caseType === "dispute" ? "required before close" : "—")}</div></div>
                {c.description && <div className="md:col-span-3"><span className="text-muted-foreground">Description</span><div>{c.description}</div></div>}
                {c.resolutionSummary && <div className="md:col-span-3"><span className="text-muted-foreground">Resolution</span><div>{c.resolutionSummary}</div></div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Workflow actions</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Assign to user id</label>
                    <Input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="user id" />
                  </div>
                  <Button
                    disabled={!assignee || assign.isPending}
                    onClick={() => assign.mutate({ caseId: c.id, assigneeId: Number(assignee) })}
                  >
                    Assign
                  </Button>
                </div>

                <div className="flex gap-2 flex-wrap">
                  {c.status === "open" && (
                    <Button onClick={() => transition.mutate({ caseId: c.id, toStatus: "triaged" })}>Mark triaged</Button>
                  )}
                  {c.status === "triaged" && (
                    <Button onClick={() => transition.mutate({ caseId: c.id, toStatus: "in_progress" })}>Start work</Button>
                  )}
                  {c.status === "resolved" && c.caseType === "dispute" && c.resolutionApprovedBy == null && (
                    <Button onClick={() => approve.mutate({ caseId: c.id })}>Approve resolution (checker)</Button>
                  )}
                  {c.status === "resolved" && (
                    <Button onClick={() => transition.mutate({ caseId: c.id, toStatus: "closed" })}>Close case</Button>
                  )}
                </div>

                {c.status === "in_progress" && (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Resolution summary (min 10 chars)</label>
                    <Textarea value={resolution} onChange={(e) => setResolution(e.target.value)} />
                    <Button
                      disabled={resolution.trim().length < 10 || transition.isPending}
                      onClick={() => transition.mutate({ caseId: c.id, toStatus: "resolved", resolutionSummary: resolution })}
                    >
                      Resolve
                    </Button>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">Transition note (optional)</label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
              <CardContent>
                {timeline.length === 0 && <p className="text-sm text-muted-foreground">No events yet.</p>}
                <ol className="relative border-l space-y-3 ml-2">
                  {timeline.map((e: any) => (
                    <li key={e.id} className="ml-4">
                      <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] mt-1.5" />
                      <div className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleString()} · actor {e.actorId}</div>
                      <div className="text-sm font-medium">
                        {e.eventType}
                        {e.fromStatus && e.toStatus ? ` (${e.fromStatus} → ${e.toStatus})` : ""}
                      </div>
                      {e.note && <div className="text-sm text-muted-foreground">{e.note}</div>}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
