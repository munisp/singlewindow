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
import { Award, CheckCircle, XCircle, Clock, AlertTriangle, FileText, Upload, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { Progress } from "@/components/ui/progress";
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

// ─── Document Checklist Panel ───────────────────────────────────────────────
function DocumentChecklist({ renewalId, isAdmin }: { renewalId: number; isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const { data: docs, isLoading } = trpc.aeoRenewals.listDocuments.useQuery({ renewalId });
  const { data: summary } = trpc.aeoRenewals.checklistSummary.useQuery({ renewalId });
  const [uploading, setUploading] = useState<string | null>(null);

  const uploadMutation = trpc.aeoRenewals.uploadDocument.useMutation({
    onSuccess: () => {
      utils.aeoRenewals.listDocuments.invalidate({ renewalId });
      utils.aeoRenewals.checklistSummary.invalidate({ renewalId });
      setUploading(null);
      toast.success("Document uploaded");
    },
    onError: (e) => { toast.error(e.message); setUploading(null); },
  });

  const reviewDocMutation = trpc.aeoRenewals.reviewDocument.useMutation({
    onSuccess: () => {
      utils.aeoRenewals.listDocuments.invalidate({ renewalId });
      utils.aeoRenewals.checklistSummary.invalidate({ renewalId });
      toast.success("Document status updated");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleFileUpload(docType: string, file: File) {
    setUploading(docType);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        renewalId,
        docType,
        fileName: file.name,
        fileBase64: base64,
        mimeType: file.type || "application/pdf",
      });
    };
    reader.readAsDataURL(file);
  }

  const DOC_STATUS_COLOR: Record<string, string> = {
    pending:  "text-amber-600 bg-amber-500/10 border-amber-500/30",
    uploaded: "text-blue-600 bg-blue-500/10 border-blue-500/30",
    accepted: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
    rejected: "text-red-600 bg-red-500/10 border-red-500/30",
  };

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading checklist…</div>;

  return (
    <div className="space-y-3">
      {summary && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">Required Documents</span>
              <span className="text-xs font-bold text-foreground">{summary.requiredUploaded}/{summary.required}</span>
            </div>
            <Progress value={summary.completionPct} className="h-1.5" />
          </div>
          {summary.isReadyToSubmit ? (
            <span className="text-xs font-medium text-emerald-600 flex items-center gap-1">
              <CheckCircle size={12} /> Ready
            </span>
          ) : (
            <span className="text-xs font-medium text-amber-600 flex items-center gap-1">
              <AlertTriangle size={12} /> Incomplete
            </span>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        {(docs ?? []).map((doc) => (
          <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-border/60 bg-background hover:bg-muted/20 transition-colors">
            <FileText size={14} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground truncate">{doc.label}</span>
                {doc.required && <span className="text-[10px] text-red-500 font-medium">required</span>}
              </div>
              {doc.fileUrl && (
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-blue-500 hover:underline flex items-center gap-0.5 mt-0.5">
                  <ExternalLink size={9} /> View uploaded file
                </a>
              )}
              {doc.reviewNotes && (
                <p className="text-[10px] text-red-500 mt-0.5">{doc.reviewNotes}</p>
              )}
            </div>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${DOC_STATUS_COLOR[doc.status ?? "pending"] ?? DOC_STATUS_COLOR.pending}`}>
              {doc.status ?? "pending"}
            </span>
            {!isAdmin && (doc.status === "pending" || doc.status === "rejected") && (
              <label className="cursor-pointer">
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png"
                  disabled={uploading === doc.docType}
                  onChange={(e) => e.target.files?.[0] && handleFileUpload(doc.docType, e.target.files[0])}
                />
                <Button size="sm" variant="outline" className="text-[10px] h-6 px-2" asChild>
                  <span>{uploading === doc.docType ? "Uploading…" : <><Upload size={10} className="mr-1" />Upload</>}</span>
                </Button>
              </label>
            )}
            {isAdmin && doc.status === "uploaded" && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline"
                  className="text-[10px] h-6 px-2 text-emerald-600 border-emerald-500/40 hover:bg-emerald-500/10"
                  onClick={() => reviewDocMutation.mutate({ documentId: doc.id, status: "accepted" })}
                >Accept</Button>
                <Button size="sm" variant="outline"
                  className="text-[10px] h-6 px-2 text-red-600 border-red-500/40 hover:bg-red-500/10"
                  onClick={() => reviewDocMutation.mutate({ documentId: doc.id, status: "rejected", reviewNotes: "Please resubmit" })}
                >Reject</Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AEORenewalWorkflow() {
  const { user } = useAuth();
  const isAdmin = ["admin", "customs_officer"].includes(user?.role ?? "");
  const utils = trpc.useUtils();
  const [expandedChecklist, setExpandedChecklist] = useState<number | null>(null);

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
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Checklist</th>
                    {isAdmin && <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {renewals.map((r) => (
                    <>
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
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-xs h-7 gap-1"
                          onClick={() => setExpandedChecklist(expandedChecklist === r.id ? null : r.id)}
                        >
                          {expandedChecklist === r.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          Docs
                        </Button>
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
                    {expandedChecklist === r.id && (
                      <tr key={`checklist-${r.id}`}>
                        <td colSpan={isAdmin ? 8 : 7} className="px-4 pb-4 pt-0">
                          <div className="border border-border/60 rounded-lg p-3 bg-muted/10">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Document Checklist</p>
                            <DocumentChecklist renewalId={r.id} isAdmin={isAdmin} />
                          </div>
                        </td>
                      </tr>
                    )}
                    </>
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
