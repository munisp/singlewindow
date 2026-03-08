/**
 * Admin KYC Review — TradeGateway NGSWTP
 * Review and approve/reject KYC/KYB verifications.
 * Wired to real tRPC kyc.listPendingVerifications + kyc.reviewVerification.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  CheckCircle, XCircle, AlertCircle, FileText, User,
  Building2, Clock, Eye, RefreshCw
} from "lucide-react";

type VerificationType = "INDIVIDUAL" | "BUSINESS" | "ALL";

function VerificationTypeBadge({ type }: { type: string }) {
  return type === "INDIVIDUAL"
    ? <Badge variant="outline" className="gap-1"><User className="h-3 w-3" />Individual</Badge>
    : <Badge variant="outline" className="gap-1"><Building2 className="h-3 w-3" />Business</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    PENDING_REVIEW: { label: "Pending Review", className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    APPROVED: { label: "Approved", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    REJECTED: { label: "Rejected", className: "bg-red-500/10 text-red-400 border-red-500/20" },
    MORE_INFO_REQUIRED: { label: "More Info Required", className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  };
  const cfg = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

export default function AdminKYCReview() {
  const [filterType, setFilterType] = useState<VerificationType>("ALL");
  const [selectedVerification, setSelectedVerification] = useState<number | null>(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);

  const utils = trpc.useUtils();

  const { data: verifications, isLoading, refetch } = trpc.kyc.listPendingVerifications.useQuery({
    limit: 50,
    offset: 0,
    verificationType: filterType,
  });

  const reviewMutation = trpc.kyc.reviewVerification.useMutation({
    onSuccess: (result) => {
      toast.success(`Verification ${result.status.toLowerCase().replace(/_/g, " ")}`);
      utils.kyc.listPendingVerifications.invalidate();
      setReviewDialogOpen(false);
      setReviewNotes("");
      setRejectionReason("");
      setSelectedVerification(null);
    },
    onError: (err) => toast.error("Review failed", { description: err.message }),
  });

  const handleReview = (decision: "APPROVED" | "REJECTED" | "MORE_INFO_REQUIRED") => {
    if (!selectedVerification) return;
    reviewMutation.mutate({
      verificationId: selectedVerification,
      decision,
      notes: reviewNotes || undefined,
      rejectionReason: decision === "REJECTED" ? rejectionReason || undefined : undefined,
    });
  };

  const openReview = (id: number) => {
    setSelectedVerification(id);
    setReviewNotes("");
    setRejectionReason("");
    setReviewDialogOpen(true);
  };

  const selected = verifications?.find(v => v.id === selectedVerification);

  return (
    <DashboardLayout title="KYC Review">
      <div className="space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">KYC / KYB Review</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Review and approve identity and business verification submissions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as VerificationType)}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="INDIVIDUAL">Individual (KYC)</SelectItem>
                <SelectItem value="BUSINESS">Business (KYB)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5 flex items-center gap-3">
              <Clock className="h-8 w-8 text-amber-400" />
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : (verifications?.length ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Pending Review</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex items-center gap-3">
              <User className="h-8 w-8 text-blue-400" />
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : (verifications?.filter(v => v.verificationType === "INDIVIDUAL").length ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Individual KYC</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5 flex items-center gap-3">
              <Building2 className="h-8 w-8 text-purple-400" />
              <div>
                <p className="text-2xl font-bold">{isLoading ? "—" : (verifications?.filter(v => v.verificationType === "BUSINESS").length ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Business KYB</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Verification List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending Verifications</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !verifications || verifications.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 text-emerald-400" />
                <p className="font-medium">All caught up!</p>
                <p className="text-sm mt-1">No pending KYC/KYB verifications</p>
              </div>
            ) : (
              <div className="divide-y">
                {verifications.map((v) => (
                  <div key={v.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                        {v.verificationType === "INDIVIDUAL"
                          ? <User className="h-5 w-5 text-muted-foreground" />
                          : <Building2 className="h-5 w-5 text-muted-foreground" />
                        }
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {v.verificationType === "INDIVIDUAL"
                              ? `KYC #${v.id}`
                              : `KYB #${v.id}`
                            }
                          </span>
                          <VerificationTypeBadge type={v.verificationType} />
                          <StatusBadge status={v.status} />
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                          <span>User #{v.userId}</span>
                          <span>·</span>
                          <span>Submitted {new Date(v.submittedAt!).toLocaleDateString()}</span>
                          {v.metadata && (v.metadata as any)?.overallScore && (
                            <>
                              <span>·</span>
                              <span>Score: {Math.round(((v.metadata as any).overallScore) * 100)}%</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => openReview(v.id)} className="gap-1.5">
                      <Eye className="h-3.5 w-3.5" />
                      Review
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Review Dialog */}
        <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Review Verification #{selectedVerification}</DialogTitle>
            </DialogHeader>

            {selected && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground text-xs mb-1">Type</p>
                    <VerificationTypeBadge type={selected.verificationType} />
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground text-xs mb-1">Status</p>
                    <StatusBadge status={selected.status} />
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground text-xs mb-1">User ID</p>
                    <p className="font-medium">#{selected.userId}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted/50">
                    <p className="text-muted-foreground text-xs mb-1">Authenticity Score</p>
                    <p className="font-medium">
                      {(selected.metadata as any)?.overallScore
                        ? `${Math.round(((selected.metadata as any).overallScore) * 100)}%`
                        : "—"}
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Review Notes</label>
                  <Textarea
                    placeholder="Add notes about this verification decision..."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Rejection Reason (if rejecting)</label>
                  <Textarea
                    placeholder="Explain why this verification is being rejected..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
            )}

            <DialogFooter className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleReview("MORE_INFO_REQUIRED")}
                disabled={reviewMutation.isPending}
                className="gap-1.5"
              >
                <AlertCircle className="h-4 w-4 text-blue-400" />
                Request More Info
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleReview("REJECTED")}
                disabled={reviewMutation.isPending}
                className="gap-1.5"
              >
                <XCircle className="h-4 w-4" />
                Reject
              </Button>
              <Button
                onClick={() => handleReview("APPROVED")}
                disabled={reviewMutation.isPending}
                className="gap-1.5"
              >
                <CheckCircle className="h-4 w-4" />
                Approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
