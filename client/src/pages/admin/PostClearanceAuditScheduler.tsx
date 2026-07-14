/**
 * Post-Clearance Audit Scheduler — admin schedule and track post-clearance audits
 * Sprint 136: Item 8
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLOR: Record<string, string> = {
  scheduled:   "bg-amber-500/15 text-amber-600 border-amber-500/30",
  in_progress: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  completed:   "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  cancelled:   "bg-gray-500/15 text-gray-500 border-gray-500/30",
};

export default function PostClearanceAuditScheduler() {
  const utils = trpc.useUtils();
  const { data: audits, isLoading, refetch } = trpc.postClearanceAuditSched.list.useQuery();
  const [showSchedule, setShowSchedule] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<number | null>(null);

  // Schedule form state
  const [declId, setDeclId] = useState("");
  const [traderId, setTraderId] = useState("");
  const [auditType, setAuditType] = useState<"random" | "risk_based" | "targeted">("random");
  const [scheduledDate, setScheduledDate] = useState("");
  const [riskScore, setRiskScore] = useState("");

  // Update form state
  const [updateStatus, setUpdateStatus] = useState<"in_progress" | "completed" | "cancelled">("completed");
  const [findings, setFindings] = useState("");

  const scheduleMutation = trpc.postClearanceAuditSched.schedule.useMutation({
    onSuccess: () => {
      utils.postClearanceAuditSched.list.invalidate();
      setShowSchedule(false);
      toast.success("Audit scheduled and trader notified");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.postClearanceAuditSched.updateStatus.useMutation({
    onSuccess: () => {
      utils.postClearanceAuditSched.list.invalidate();
      setUpdateTarget(null);
      setFindings("");
      toast.success("Audit status updated");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-[#D4A017]" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Post-Clearance Audit Scheduler</h1>
            <p className="text-sm text-muted-foreground">Schedule and manage post-clearance audits for cleared declarations</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button size="sm" className="gap-1.5 bg-[#D4A017] hover:bg-[#B8860B] text-black" onClick={() => setShowSchedule(true)}>
            <Plus size={14} />
            Schedule Audit
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Scheduled Audits ({audits?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading audits…</div>
          ) : !audits || audits.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No audits scheduled yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Declaration</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Risk Score</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Scheduled Date</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {audits.map((a) => (
                    <tr key={a.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">#{a.declarationId}</td>
                      <td className="px-4 py-3 text-xs capitalize">{a.auditType.replace("_", " ")}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[a.status] ?? ""}`}>
                          {a.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {a.riskScore !== null ? (
                          <span className={a.riskScore >= 70 ? "text-red-500 font-bold" : a.riskScore >= 40 ? "text-amber-500 font-bold" : "text-emerald-500"}>
                            {a.riskScore}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {a.scheduledDate ? new Date(a.scheduledDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {a.status !== "completed" && a.status !== "cancelled" && (
                          <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setUpdateTarget(a.id)}>
                            Update
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule dialog */}
      <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Schedule Post-Clearance Audit</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Declaration ID</Label>
                <Input placeholder="e.g. 1234" value={declId} onChange={e => setDeclId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Trader ID</Label>
                <Input placeholder="e.g. 56" value={traderId} onChange={e => setTraderId(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Audit Type</Label>
                <Select value={auditType} onValueChange={v => setAuditType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="risk_based">Risk-Based</SelectItem>
                    <SelectItem value="targeted">Targeted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Risk Score (0–100)</Label>
                <Input type="number" min={0} max={100} placeholder="Optional" value={riskScore} onChange={e => setRiskScore(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Scheduled Date</Label>
              <Input type="date" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowSchedule(false)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
              disabled={scheduleMutation.isPending || !declId || !traderId || !scheduledDate}
              onClick={() => scheduleMutation.mutate({
                declarationId: parseInt(declId),
                traderId: parseInt(traderId),
                auditType,
                scheduledDate,
                riskScore: riskScore ? parseInt(riskScore) : undefined,
              })}
            >
              {scheduleMutation.isPending ? "Scheduling…" : "Schedule Audit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Update status dialog */}
      <Dialog open={updateTarget !== null} onOpenChange={() => setUpdateTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Update Audit Status</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">New Status</Label>
              <Select value={updateStatus} onValueChange={v => setUpdateStatus(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Findings</Label>
              <Textarea placeholder="Audit findings…" value={findings} onChange={e => setFindings(e.target.value)} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setUpdateTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
              disabled={updateMutation.isPending || updateTarget === null}
              onClick={() => updateTarget !== null && updateMutation.mutate({ id: updateTarget, status: updateStatus, findings: findings || undefined })}
            >
              {updateMutation.isPending ? "Saving…" : "Update Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
