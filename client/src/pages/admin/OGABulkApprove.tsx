/**
 * OGA Bulk Approve — admin bulk permit approval/rejection
 * Sprint 136: Item 7
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle, XCircle, List, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLOR: Record<string, string> = {
  pending:     "bg-amber-500/15 text-amber-600 border-amber-500/30",
  approved:    "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  rejected:    "bg-red-500/15 text-red-600 border-red-500/30",
  conditional: "bg-blue-500/15 text-blue-600 border-blue-500/30",
};

export default function OGABulkApprove() {
  const utils = trpc.useUtils();
  const { data: allPermits, isLoading, refetch } = trpc.oga.myPermits.useQuery();
  const permits = allPermits?.filter((p: any) => p.status === "pending");
  const { data: bulkActions } = trpc.ogaBulkApprove.listBulkActions.useQuery();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmAction, setConfirmAction] = useState<"approve" | "reject" | null>(null);
  const [notes, setNotes] = useState("");

  const bulkApproveMutation = trpc.ogaBulkApprove.bulkApprove.useMutation({
    onSuccess: (data) => {
      utils.oga.myPermits.invalidate();
      utils.ogaBulkApprove.listBulkActions.invalidate();
      setSelected(new Set());
      setConfirmAction(null);
      setNotes("");
      toast.success(`${data.updated} permit(s) approved`);
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkRejectMutation = trpc.ogaBulkApprove.bulkReject.useMutation({
    onSuccess: (data) => {
      utils.oga.myPermits.invalidate();
      utils.ogaBulkApprove.listBulkActions.invalidate();
      setSelected(new Set());
      setConfirmAction(null);
      setNotes("");
      toast.success(`${data.updated} permit(s) rejected`);
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const toggleAll = () => {
    if (!permits) return;
    if (selected.size === permits.length) setSelected(new Set());
    else setSelected(new Set(permits.map((p: any) => p.id)));
  };

  const handleConfirm = () => {
    const ids = Array.from(selected);
    if (confirmAction === "approve") bulkApproveMutation.mutate({ permitIds: ids, notes: notes || undefined });
    else if (confirmAction === "reject") bulkRejectMutation.mutate({ permitIds: ids, notes });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <List size={22} className="text-[#D4A017]" />
          <div>
            <h1 className="text-xl font-bold text-foreground">OGA Permit Bulk Actions</h1>
            <p className="text-sm text-muted-foreground">Select multiple pending permits to approve or reject in bulk</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
          <RefreshCw size={14} />
          Refresh
        </Button>
      </div>

      {/* Action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[#D4A017]/10 border border-[#D4A017]/30">
          <span className="text-sm font-medium text-foreground">{selected.size} permit(s) selected</span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              onClick={() => setConfirmAction("approve")}
            >
              <CheckCircle size={14} /> Bulk Approve
            </Button>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
              onClick={() => setConfirmAction("reject")}
            >
              <XCircle size={14} /> Bulk Reject
            </Button>
          </div>
        </div>
      )}

      {/* Permits table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Pending Permits ({permits?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading permits…</div>
          ) : !permits || permits.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No pending permits.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 w-8">
                      <Checkbox
                        checked={selected.size === permits.length && permits.length > 0}
                        onCheckedChange={toggleAll}
                      />
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Permit ID</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Declaration</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Agency</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {permits.map((p: any) => (
                    <tr key={p.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${selected.has(p.id) ? "bg-[#D4A017]/5" : ""}`}>
                      <td className="px-4 py-3">
                        <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">#{p.id}</td>
                      <td className="px-4 py-3 font-mono text-xs">#{p.declarationId}</td>
                      <td className="px-4 py-3 text-xs">{p.agencyCode ?? "—"}</td>
                      <td className="px-4 py-3 text-xs">{p.permitType ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[p.status] ?? ""}`}>
                          {p.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent bulk actions */}
      {bulkActions && bulkActions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent Bulk Actions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {bulkActions.slice(0, 10).map(a => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <span className={`font-medium ${a.action === "bulk_approve" ? "text-emerald-500" : "text-red-500"}`}>
                    {a.action === "bulk_approve" ? "Approved" : "Rejected"} {(a.permitIds as number[]).length} permits
                  </span>
                  <span className="text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confirm dialog */}
      <Dialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "approve" ? "Bulk Approve" : "Bulk Reject"} {selected.size} Permit(s)
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              This will {confirmAction} all {selected.size} selected permits. This action cannot be undone.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes {confirmAction === "reject" ? "(required)" : "(optional)"}</Label>
              <Textarea
                placeholder={confirmAction === "reject" ? "Reason for rejection…" : "Optional notes…"}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setConfirmAction(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={(bulkApproveMutation.isPending || bulkRejectMutation.isPending) || (confirmAction === "reject" && !notes.trim())}
              className={confirmAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
              onClick={handleConfirm}
            >
              {bulkApproveMutation.isPending || bulkRejectMutation.isPending ? "Processing…" : `Confirm ${confirmAction === "approve" ? "Approval" : "Rejection"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
