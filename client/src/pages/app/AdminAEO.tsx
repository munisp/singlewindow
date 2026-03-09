import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { useState } from "react";
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, Award,
  BarChart3, FileText, User, AlertTriangle, Zap,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  submitted:    { label: "Submitted",    color: "bg-blue-100 text-blue-800",   icon: <FileText className="h-3 w-3" /> },
  under_review: { label: "Under Review", color: "bg-amber-100 text-amber-800", icon: <Clock className="h-3 w-3" /> },
  approved:     { label: "Approved",     color: "bg-emerald-100 text-emerald-800", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected:     { label: "Rejected",     color: "bg-red-100 text-red-800",     icon: <XCircle className="h-3 w-3" /> },
};

function ScoreBar({ label, score }: { label: string; score: number | null }) {
  const pct = score ?? 0;
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium">{pct}/100</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function AdminAEO() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.aeo.all.useQuery({ limit: 100, offset: 0 });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const approveMutation = trpc.aeo.approve.useMutation({
    onSuccess: (updated: any) => {
      toast.success(`AEO certificate ${updated?.certificateNumber} issued`);
      utils.aeo.all.invalidate();
      setSelectedId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rejectMutation = trpc.aeo.reject.useMutation({
    onSuccess: () => {
      toast.success("Application rejected and trader notified");
      utils.aeo.all.invalidate();
      setSelectedId(null);
      setShowRejectForm(false);
      setRejectReason("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const apps = data ?? [];
  const pending = apps.filter((a: any) => a.status === "submitted" || a.status === "under_review");
  const approved = apps.filter((a: any) => a.status === "approved");
  const rejected = apps.filter((a: any) => a.status === "rejected");
  const selected = apps.find((a: any) => a.id === selectedId) as any;

  const avgCompliance = approved.length > 0
    ? Math.round(approved.reduce((s: number, a: any) => s + (a.complianceScore ?? 0), 0) / approved.length)
    : 0;

  return (
    <DashboardLayout title="AEO Management">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Authorised Economic Operator Programme
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Review applications, issue certificates, and manage green-lane privileges
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Pending Review", value: pending.length, icon: <Clock className="h-5 w-5 text-amber-500" />, color: "text-amber-600" },
            { label: "Certified AEOs", value: approved.length, icon: <Award className="h-5 w-5 text-emerald-500" />, color: "text-emerald-600" },
            { label: "Rejected", value: rejected.length, icon: <XCircle className="h-5 w-5 text-red-500" />, color: "text-red-600" },
            { label: "Avg Compliance", value: `${avgCompliance}%`, icon: <BarChart3 className="h-5 w-5 text-blue-500" />, color: "text-blue-600" },
          ].map(({ label, value, icon, color }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-muted">{icon}</div>
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{isLoading ? "—" : value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Applications</h2>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : apps.length === 0 ? (
              <Card><CardContent className="p-6 text-center text-muted-foreground text-sm">No applications yet</CardContent></Card>
            ) : (
              apps.map((a: any) => {
                const cfg = STATUS_CONFIG[a.status] ?? STATUS_CONFIG.submitted;
                return (
                  <Card
                    key={a.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${selectedId === a.id ? "ring-2 ring-primary" : ""}`}
                    onClick={() => { setSelectedId(a.id); setShowRejectForm(false); }}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-xs font-medium truncate">{a.applicationNumber}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            Trader #{a.traderId}
                          </p>
                        </div>
                        <Badge className={`text-xs shrink-0 flex items-center gap-1 ${cfg.color}`}>
                          {cfg.icon}{cfg.label}
                        </Badge>
                      </div>
                      {(a.complianceScore !== null) && (
                        <div className="mt-2">
                          <Progress value={a.complianceScore ?? 0} className="h-1" />
                          <p className="text-xs text-muted-foreground mt-0.5">Compliance: {a.complianceScore}/100</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          <div className="lg:col-span-3">
            {!selected ? (
              <Card className="h-full">
                <CardContent className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                  Select an application to review
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base font-mono">{selected.applicationNumber}</CardTitle>
                      <CardDescription>
                        Submitted {selected.createdAt ? new Date(selected.createdAt).toLocaleDateString() : "—"}
                        {selected.tier && <span className="ml-2">· Tier: <strong>{selected.tier}</strong></span>}
                      </CardDescription>
                    </div>
                    {(() => {
                      const cfg = STATUS_CONFIG[selected.status] ?? STATUS_CONFIG.submitted;
                      return (
                        <Badge className={`flex items-center gap-1 ${cfg.color}`}>
                          {cfg.icon}{cfg.label}
                        </Badge>
                      );
                    })()}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-primary" />
                      Compliance Scoring
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <ScoreBar label="Overall Compliance" score={selected.complianceScore} />
                      <ScoreBar label="Self-Assessment" score={selected.selfAssessmentScore} />
                      <ScoreBar label="Security" score={selected.securityScore} />
                      <ScoreBar label="Financial Standing" score={selected.financialStandingScore} />
                    </div>
                  </div>

                  {selected.status === "approved" && selected.certificateNumber && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold flex items-center gap-2">
                          <Award className="h-4 w-4 text-emerald-600" />
                          Certificate Details
                        </h3>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Certificate Number</p>
                            <p className="font-mono font-medium">{selected.certificateNumber}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Expires</p>
                            <p className="font-medium">
                              {selected.certificateExpiresAt
                                ? new Date(selected.certificateExpiresAt).toLocaleDateString()
                                : "—"}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800">
                          <Zap className="h-4 w-4 shrink-0" />
                          <span>Green-lane fast-track clearance is <strong>active</strong> for this trader</span>
                        </div>
                      </div>
                    </>
                  )}

                  {selected.reviewerNotes && (
                    <>
                      <Separator />
                      <div>
                        <h3 className="text-sm font-semibold flex items-center gap-2 mb-1">
                          <FileText className="h-4 w-4" />
                          Reviewer Notes
                        </h3>
                        <p className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">{selected.reviewerNotes}</p>
                      </div>
                    </>
                  )}

                  {(selected.status === "submitted" || selected.status === "under_review") && (
                    <>
                      <Separator />
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">Review Actions</h3>
                        {!showRejectForm ? (
                          <div className="flex gap-3">
                            <Button
                              size="sm"
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                              onClick={() => approveMutation.mutate({ applicationId: selected.id })}
                              disabled={approveMutation.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              {approveMutation.isPending ? "Issuing…" : "Approve & Issue Certificate"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-red-300 text-red-600 hover:bg-red-50"
                              onClick={() => setShowRejectForm(true)}
                            >
                              <XCircle className="h-4 w-4 mr-1" />
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              The trader will be notified with the reason provided below.
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="reject-reason" className="text-sm">Rejection Reason (min. 10 characters)</Label>
                              <Textarea
                                id="reject-reason"
                                placeholder="Describe the specific compliance gaps or missing documentation…"
                                value={rejectReason}
                                onChange={(e) => setRejectReason(e.target.value)}
                                rows={3}
                              />
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => rejectMutation.mutate({ applicationId: selected.id, reason: rejectReason })}
                                disabled={rejectReason.length < 10 || rejectMutation.isPending}
                              >
                                {rejectMutation.isPending ? "Rejecting…" : "Confirm Rejection"}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setShowRejectForm(false)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
