/**
 * AEO Renewal Workflow — traders submit renewals, admins review
 * Sprint 136: Item 4
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Award, CheckCircle, XCircle, Clock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:        { label: "Pending",         color: "bg-amber-500/15 text-amber-600 border-amber-500/30",  icon: <Clock size={12} /> },
  docs_submitted: { label: "Docs Submitted",  color: "bg-blue-500/15 text-blue-600 border-blue-500/30",    icon: <Clock size={12} /> },
  under_review:   { label: "Under Review",    color: "bg-purple-500/15 text-purple-600 border-purple-500/30", icon: <Clock size={12} /> },
  approved:       { label: "Approved",        color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: <CheckCircle size={12} /> },
  rejected:       { label: "Rejected",        color: "bg-red-500/15 text-red-600 border-red-500/30",       icon: <XCircle size={12} /> },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

export default function AEORenewalWorkflow() {
  const { user } = useAuth();
  const isAdmin = ["admin", "customs_officer"].includes(user?.role ?? "");
  const utils = trpc.useUtils();

  // Trader view
  const { data: myRenewals } = trpc.aeoRenewals.myRenewals.useQuery(undefined, { enabled: !isAdmin });
  // Admin view
  const { data: pendingRenewals } = trpc.aeoRenewals.listPending.useQuery(undefined, { enabled: isAdmin });

  // Admin review dialog
  const [reviewTarget, setReviewTarget] = useState<{ id: number; appId: number } | null>(null);
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [reviewNotes, setReviewNotes] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const reviewMutation = trpc.aeoRenewals.review.useMutation({
    onSuccess: () => {
      utils.aeoRenewals.listPending.invalidate();
      setReviewTarget(null);
      setReviewNotes("");
      setExpiryDate("");
      toast.success(`Renewal ${decision}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const renewals = isAdmin ? pendingRenewals : myRenewals;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Award size={22} className="text-[#D4A017]" />
        <div>
          <h1 className="text-xl font-bold text-foreground">AEO Renewal Workflow</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Review and process pending AEO certificate renewals" : "Track your AEO certificate renewal status"}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {isAdmin ? "Pending Renewals" : "My Renewals"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!renewals || renewals.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              {isAdmin ? "No pending renewals to review." : "No AEO renewals found."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Application ID</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Due Date</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Submitted</th>
                    {isAdmin && <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Trader ID</th>}
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Notes</th>
                    {isAdmin && <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {renewals.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">#{r.aeoApplicationId}</td>
                      <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.renewalDueDate ? new Date(r.renewalDueDate).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "—"}
                      </td>
                      {isAdmin && <td className="px-4 py-3 font-mono text-xs">{r.traderId}</td>}
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-48 truncate">
                        {r.reviewNotes ?? "—"}
                      </td>
                      {isAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-7"
                            onClick={() => { setReviewTarget({ id: r.id, appId: r.aeoApplicationId }); setDecision("approved"); }}
                          >
                            Review
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Admin review dialog */}
      <Dialog open={!!reviewTarget} onOpenChange={() => setReviewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Review AEO Renewal #{reviewTarget?.appId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={decision === "approved" ? "default" : "outline"}
                className={decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}
                onClick={() => setDecision("approved")}
              >
                <CheckCircle size={14} className="mr-1" /> Approve
              </Button>
              <Button
                size="sm"
                variant={decision === "rejected" ? "default" : "outline"}
                className={decision === "rejected" ? "bg-red-600 hover:bg-red-700 text-white" : ""}
                onClick={() => setDecision("rejected")}
              >
                <XCircle size={14} className="mr-1" /> Reject
              </Button>
            </div>
            {decision === "approved" && (
              <div className="space-y-1.5">
                <Label className="text-xs">New Expiry Date</Label>
                <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Review Notes</Label>
              <Textarea
                placeholder="Optional notes for the trader…"
                value={reviewNotes}
                onChange={e => setReviewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setReviewTarget(null)}>Cancel</Button>
            <Button
              size="sm"
              disabled={reviewMutation.isPending || !reviewTarget}
              className={decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-600 hover:bg-red-700 text-white"}
              onClick={() => reviewTarget && reviewMutation.mutate({
                renewalId: reviewTarget.id,
                decision,
                reviewNotes: reviewNotes || undefined,
                expiryDate: expiryDate || undefined,
              })}
            >
              {reviewMutation.isPending ? "Saving…" : `Confirm ${decision === "approved" ? "Approval" : "Rejection"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
