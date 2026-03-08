/**
 * Duty Drawback Module
 * Traders submit re-export evidence and claim duty refunds.
 * Finance/customs officers review and approve/reject claims.
 * Closes the TigerBeetle double-entry loop: payment → drawback refund.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  RotateCcw, DollarSign, CheckCircle2, XCircle, Clock,
  Search, Plus, ChevronLeft, ChevronRight, FileText, TrendingDown,
} from "lucide-react";

// ─── STATUS BADGES ────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  submitted: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  approved: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/20 text-red-300 border-red-500/30",
  paid: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

function fmt(val: string | null | undefined) {
  if (!val) return "—";
  const n = parseFloat(val);
  return isNaN(n) ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── NEW CLAIM DIALOG ─────────────────────────────────────────────────────────
function NewClaimDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [importDeclId, setImportDeclId] = useState("");
  const [exportDeclId, setExportDeclId] = useState("");
  const [drawbackType, setDrawbackType] = useState("unused_merchandise");
  const [claimedAmount, setClaimedAmount] = useState("");
  const [goodsDescription, setGoodsDescription] = useState("");

  const create = trpc.drawback.create.useMutation({
    onSuccess: () => {
      toast.success("Claim created", { description: "Your duty drawback claim has been saved as a draft." });
      utils.drawback.list.invalidate();
      utils.drawback.stats.invalidate();
      onClose();
      setImportDeclId(""); setExportDeclId(""); setClaimedAmount(""); setGoodsDescription("");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0D1B2E] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">New Duty Drawback Claim</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300 text-sm">Import Declaration ID *</Label>
              <Input value={importDeclId} onChange={(e) => setImportDeclId(e.target.value)} type="number" placeholder="e.g. 42" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-300 text-sm">Export Declaration ID</Label>
              <Input value={exportDeclId} onChange={(e) => setExportDeclId(e.target.value)} type="number" placeholder="Optional" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-slate-300 text-sm">Drawback Type *</Label>
            <Select value={drawbackType} onValueChange={setDrawbackType}>
              <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0D1B2E] border-white/10">
                {[
                  { value: "manufacturing", label: "Manufacturing Drawback" },
                  { value: "unused_merchandise", label: "Unused Merchandise" },
                  { value: "rejected_merchandise", label: "Rejected Merchandise" },
                  { value: "substitution", label: "Substitution Drawback" },
                ].map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-slate-300 text-sm">Claimed Amount (USD) *</Label>
            <Input value={claimedAmount} onChange={(e) => setClaimedAmount(e.target.value)} type="number" placeholder="0.00" className="bg-white/5 border-white/10 text-white mt-1" />
          </div>
          <div>
            <Label className="text-slate-300 text-sm">Goods Description</Label>
            <Textarea value={goodsDescription} onChange={(e) => setGoodsDescription(e.target.value)} placeholder="Describe the goods being re-exported..." className="bg-white/5 border-white/10 text-white mt-1 min-h-[80px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-slate-300">Cancel</Button>
          <Button
            onClick={() => create.mutate({
              importDeclarationId: parseInt(importDeclId),
              exportDeclarationId: exportDeclId ? parseInt(exportDeclId) : undefined,
              drawbackType: drawbackType as any,
              claimedAmount: parseFloat(claimedAmount),
              goodsDescription: goodsDescription || undefined,
            })}
            disabled={!importDeclId || !claimedAmount || create.isPending}
            className="bg-gold text-navy font-semibold hover:bg-gold/90"
          >
            {create.isPending ? "Creating…" : "Create Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── REVIEW DIALOG ────────────────────────────────────────────────────────────
function ReviewClaimDialog({ claim, open, onClose }: {
  claim: { id: number; claimNumber: string; claimedAmount: string };
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [decision, setDecision] = useState<"approved" | "rejected">("approved");
  const [approvedAmount, setApprovedAmount] = useState(claim.claimedAmount);
  const [notes, setNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  const review = trpc.drawback.review.useMutation({
    onSuccess: () => {
      toast.success(`Claim ${decision}`, { description: `Claim ${claim.claimNumber} has been ${decision}.` });
      utils.drawback.list.invalidate();
      utils.drawback.stats.invalidate();
      onClose();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0D1B2E] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">Review Claim — {claim.claimNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex gap-3">
            <Button
              onClick={() => setDecision("approved")}
              className={`flex-1 ${decision === "approved" ? "bg-emerald-600 text-white" : "bg-white/5 text-slate-300 border border-white/10"}`}
            >
              <CheckCircle2 size={14} className="mr-2" /> Approve
            </Button>
            <Button
              onClick={() => setDecision("rejected")}
              className={`flex-1 ${decision === "rejected" ? "bg-red-600 text-white" : "bg-white/5 text-slate-300 border border-white/10"}`}
            >
              <XCircle size={14} className="mr-2" /> Reject
            </Button>
          </div>
          {decision === "approved" && (
            <div>
              <Label className="text-slate-300 text-sm">Approved Amount (USD)</Label>
              <Input value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} type="number" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          )}
          {decision === "rejected" && (
            <div>
              <Label className="text-slate-300 text-sm">Rejection Reason *</Label>
              <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Explain why the claim is being rejected..." className="bg-white/5 border-white/10 text-white mt-1 min-h-[80px]" />
            </div>
          )}
          <div>
            <Label className="text-slate-300 text-sm">Reviewer Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes..." className="bg-white/5 border-white/10 text-white mt-1 min-h-[60px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-slate-300">Cancel</Button>
          <Button
            onClick={() => review.mutate({
              id: claim.id,
              decision,
              approvedAmount: decision === "approved" ? parseFloat(approvedAmount) : undefined,
              reviewerNotes: notes || undefined,
              rejectionReason: decision === "rejected" ? rejectionReason : undefined,
            })}
            disabled={review.isPending || (decision === "rejected" && !rejectionReason)}
            className={`font-semibold ${decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"} text-white`}
          >
            {review.isPending ? "Submitting…" : `Confirm ${decision === "approved" ? "Approval" : "Rejection"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function DutyDrawback() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [newClaimOpen, setNewClaimOpen] = useState(false);
  const [reviewClaim, setReviewClaim] = useState<any | null>(null);
  const PAGE_SIZE = 15;

  const isReviewer = ["customs_officer", "admin", "finance"].includes(user?.role ?? "");
  const isTrader = !isReviewer;

  const { data: stats } = trpc.drawback.stats.useQuery();
  const { data, isLoading } = trpc.drawback.list.useQuery({
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const utils = trpc.useUtils();
  const submit = trpc.drawback.submit.useMutation({
    onSuccess: (c) => {
      toast.success("Claim submitted", { description: `${c.claimNumber} submitted for review.` });
      utils.drawback.list.invalidate();
      utils.drawback.stats.invalidate();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });
  const markPaid = trpc.drawback.markPaid.useMutation({
    onSuccess: (c) => {
      toast.success("Claim paid", { description: `${c.claimNumber} marked as paid.` });
      utils.drawback.list.invalidate();
      utils.drawback.stats.invalidate();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  const claims = data?.claims ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white font-display flex items-center gap-2">
              <RotateCcw className="text-gold" size={24} />
              Duty Drawback
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              {isTrader
                ? "Claim refunds on duties paid for re-exported or rejected goods"
                : "Review and approve duty drawback claims from traders"}
            </p>
          </div>
          {isTrader && (
            <Button onClick={() => setNewClaimOpen(true)} className="bg-gold text-navy font-semibold hover:bg-gold/90">
              <Plus size={16} className="mr-2" /> New Claim
            </Button>
          )}
        </div>

        {/* KPI Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {[
              { label: "Total Claims", value: stats.total, color: "text-slate-300" },
              { label: "Submitted", value: stats.submitted, color: "text-blue-400" },
              { label: "Under Review", value: stats.underReview, color: "text-yellow-400" },
              { label: "Approved", value: stats.approved, color: "text-emerald-400" },
              { label: "Paid", value: stats.paid, color: "text-purple-400" },
              { label: "Total Claimed", value: `$${stats.totalClaimed.toLocaleString()}`, color: "text-gold" },
              { label: "Total Paid", value: `$${stats.totalPaid.toLocaleString()}`, color: "text-emerald-400" },
            ].map((kpi) => (
              <Card key={kpi.label} className="bg-[#0D1B2E]/80 border-white/10">
                <CardContent className="p-4">
                  <div className={`text-xs font-mono tracking-wide ${kpi.color} mb-1`}>{kpi.label}</div>
                  <div className="text-xl font-bold text-white font-display">{kpi.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by claim # or declaration #…"
              className="pl-9 bg-white/5 border-white/10 text-white"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent className="bg-[#0D1B2E] border-white/10">
              <SelectItem value="all" className="text-white">All Statuses</SelectItem>
              {["draft", "submitted", "under_review", "approved", "rejected", "paid"].map(s => (
                <SelectItem key={s} value={s} className="text-white capitalize">{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="bg-[#0D1B2E]/80 border-white/10">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-mono text-xs">Claim #</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Import Decl.</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Type</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Status</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Duty Paid</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Claimed</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Approved</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Paid</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Submitted</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center text-slate-400 py-12">Loading claims…</TableCell>
                    </TableRow>
                  ) : claims.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-12">
                        <RotateCcw size={32} className="text-slate-600 mx-auto mb-3" />
                        <p className="text-slate-400">No drawback claims found</p>
                        {isTrader && (
                          <Button onClick={() => setNewClaimOpen(true)} variant="outline" size="sm" className="mt-3 border-gold/30 text-gold">
                            Submit First Claim
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : claims.map((claim) => (
                    <TableRow key={claim.id} className="border-white/5 hover:bg-white/3">
                      <TableCell className="font-mono text-xs text-gold">{claim.claimNumber}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-300">{claim.importDeclarationNumber}</TableCell>
                      <TableCell className="text-slate-400 text-xs capitalize">{claim.drawbackType.replace(/_/g, " ")}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${STATUS_COLORS[claim.status] ?? ""} capitalize`}>
                          {claim.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">${fmt(claim.originalDutyPaid)}</TableCell>
                      <TableCell className="text-slate-300 text-xs font-semibold">${fmt(claim.claimedAmount)}</TableCell>
                      <TableCell className={`text-xs font-semibold ${claim.approvedAmount ? "text-emerald-400" : "text-slate-500"}`}>
                        ${fmt(claim.approvedAmount)}
                      </TableCell>
                      <TableCell className={`text-xs font-semibold ${claim.paidAmount ? "text-purple-400" : "text-slate-500"}`}>
                        ${fmt(claim.paidAmount)}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {claim.submittedAt ? new Date(claim.submittedAt).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {isTrader && claim.status === "draft" && (
                            <Button
                              size="sm"
                              onClick={() => submit.mutate({ id: claim.id })}
                              disabled={submit.isPending}
                              className="h-7 px-2 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                            >
                              Submit
                            </Button>
                          )}
                          {isReviewer && ["submitted", "under_review"].includes(claim.status) && (
                            <Button
                              size="sm"
                              onClick={() => setReviewClaim(claim)}
                              className="h-7 px-2 bg-gold text-navy font-semibold text-xs"
                            >
                              Review
                            </Button>
                          )}
                          {isReviewer && claim.status === "approved" && (
                            <Button
                              size="sm"
                              onClick={() => markPaid.mutate({ id: claim.id, paidAmount: parseFloat(claim.approvedAmount ?? claim.claimedAmount) })}
                              disabled={markPaid.isPending}
                              className="h-7 px-2 bg-purple-600 hover:bg-purple-700 text-white text-xs"
                            >
                              Mark Paid
                            </Button>
                          )}
                          {claim.rejectionReason && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => toast.info("Rejection reason", { description: claim.rejectionReason })}
                              className="h-7 px-2 border-white/10 text-slate-400 text-xs"
                            >
                              Reason
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0} className="border-white/10">
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="border-white/10">
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <NewClaimDialog open={newClaimOpen} onClose={() => setNewClaimOpen(false)} />
      {reviewClaim && (
        <ReviewClaimDialog
          claim={reviewClaim}
          open={!!reviewClaim}
          onClose={() => setReviewClaim(null)}
        />
      )}
    </DashboardLayout>
  );
}
