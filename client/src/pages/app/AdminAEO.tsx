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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useState } from "react";
import {
  ShieldCheck, CheckCircle2, XCircle, Clock, Award,
  BarChart3, FileText, User, AlertTriangle, Zap, RefreshCw, Bell, History, TrendingUp,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function ComplianceSparkline({ applicationId }: { applicationId: number }) {
  const { data: trend, isLoading } = trpc.aeo.getComplianceScoreTrend.useQuery({ applicationId });
  if (isLoading) return <div className="h-12 flex items-center text-xs text-muted-foreground">Loading trend…</div>;
  if (!trend || trend.length < 2) return <div className="text-xs text-muted-foreground italic">Insufficient renewal data for trend</div>;
  const latest = trend[trend.length - 1].score;
  const first = trend[0].score;
  const delta = latest - first;
  return (
    <div className="flex items-center gap-3">
      <div style={{ width: 120, height: 40 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={trend} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={2} dot={false} />
            <Tooltip
              contentStyle={{ fontSize: 11, padding: "2px 8px" }}
              formatter={(v: number) => [`${v}/100`, "Score"]}
              labelFormatter={(l: string) => l}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-xs">
        <span className="font-medium">{latest}/100</span>
        {delta !== 0 && (
          <span className={delta > 0 ? "text-emerald-600 ml-1" : "text-red-500 ml-1"}>
            {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
        <div className="text-muted-foreground">{trend.length} data points</div>
      </div>
    </div>
  );
}

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

function ExpiryBadge({ daysLeft }: { daysLeft: number | null }) {
  if (daysLeft === null) return null;
  if (daysLeft <= 7) return <Badge className="bg-red-100 text-red-800 text-xs">Expires in {daysLeft}d ⚠️</Badge>;
  if (daysLeft <= 30) return <Badge className="bg-orange-100 text-orange-800 text-xs">Expires in {daysLeft}d</Badge>;
  if (daysLeft <= 60) return <Badge className="bg-amber-100 text-amber-800 text-xs">Expires in {daysLeft}d</Badge>;
  return null;
}

export default function AdminAEO() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.aeo.all.useQuery({ limit: 100, offset: 0 });
  const { data: expiringData } = trpc.aeo.getExpiringCertificates.useQuery({ withinDays: 60 });
  const { data: renewalRequestsData, refetch: refetchRenewalRequests } = trpc.aeo.listRenewalRequests.useQuery({ status: "pending" });
  // All renewal requests (no status filter) for the audit trail tab
  const { data: allRenewalHistory, isLoading: historyLoading } = trpc.aeo.listRenewalRequests.useQuery({});

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  const approveMutation = trpc.aeo.approve.useMutation({
    onSuccess: (updated: any) => {
      toast.success(`AEO certificate ${updated?.certificateNumber} issued`);
      utils.aeo.all.invalidate();
      utils.aeo.getExpiringCertificates.invalidate();
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

  const renewMutation = trpc.aeo.renewCertificate.useMutation({
    onSuccess: (updated: any) => {
      toast.success(`Certificate renewed — new number: ${updated?.certificateNumber}`);
      utils.aeo.all.invalidate();
      utils.aeo.getExpiringCertificates.invalidate();
      setSelectedId(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const processRenewalMutation = trpc.aeo.processRenewalRequest.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Renewal request ${res.action}`);
      utils.aeo.all.invalidate();
      utils.aeo.getExpiringCertificates.invalidate();
      refetchRenewalRequests();
      utils.aeo.listRenewalRequests.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const apps = data ?? [];
  const pending = apps.filter((a: any) => a.status === "submitted" || a.status === "under_review");
  const approved = apps.filter((a: any) => a.status === "approved");
  const rejected = apps.filter((a: any) => a.status === "rejected");
  const selected = apps.find((a: any) => a.id === selectedId) as any;
  const expiring = expiringData ?? [];

  const avgCompliance = approved.length > 0
    ? Math.round(approved.reduce((s: number, a: any) => s + (a.complianceScore ?? 0), 0) / approved.length)
    : 0;

  const selectedDaysLeft = selected?.certificateExpiresAt
    ? Math.ceil((new Date(selected.certificateExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

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

        {/* Pending Renewal Requests Banner */}
        {(renewalRequestsData ?? []).length > 0 && (
          <Card className="border-blue-300 bg-blue-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <RefreshCw className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-blue-800">
                    {(renewalRequestsData ?? []).length} pending renewal request{(renewalRequestsData ?? []).length !== 1 ? "s" : ""} from traders
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {(renewalRequestsData ?? []).map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs text-blue-700 gap-2 flex-wrap">
                        <span className="font-mono truncate">{r.certNumber ?? `App #${r.applicationId}`}</span>
                        <span className="shrink-0">{r.traderName ?? `Trader #${r.traderId}`}</span>
                        {r.certExpiresAt && <span className="shrink-0 text-blue-500">Expires {new Date(r.certExpiresAt).toLocaleDateString()}</span>}
                        <div className="flex gap-1.5 shrink-0">
                          <Button size="sm" variant="outline"
                            className="h-6 text-xs border-emerald-400 text-emerald-800 hover:bg-emerald-100"
                            onClick={() => processRenewalMutation.mutate({ requestId: r.id, action: "approved" })}
                            disabled={processRenewalMutation.isPending}
                          >
                            <CheckCircle2 className="h-3 w-3 mr-1" />Approve
                          </Button>
                          <Button size="sm" variant="outline"
                            className="h-6 text-xs border-red-400 text-red-800 hover:bg-red-100"
                            onClick={() => processRenewalMutation.mutate({ requestId: r.id, action: "rejected" })}
                            disabled={processRenewalMutation.isPending}
                          >
                            <XCircle className="h-3 w-3 mr-1" />Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Expiring Certificates Alert Banner */}
        {expiring.length > 0 && (
          <Card className="border-amber-300 bg-amber-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <Bell className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-800">
                    {expiring.length} AEO certificate{expiring.length !== 1 ? "s" : ""} expiring within 60 days
                  </p>
                  <div className="mt-2 space-y-1">
                    {expiring.slice(0, 5).map((c: any) => (
                      <div key={c.id} className="flex items-center justify-between text-xs text-amber-700 gap-2">
                        <span className="font-mono truncate">{c.certificateNumber ?? `App #${c.id}`}</span>
                        <span className="shrink-0">{c.traderName ?? `Trader #${c.traderId}`}</span>
                        <ExpiryBadge daysLeft={c.daysUntilExpiry} />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-xs border-amber-400 text-amber-800 hover:bg-amber-100 shrink-0"
                          onClick={() => renewMutation.mutate({ applicationId: c.id })}
                          disabled={renewMutation.isPending}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Renew
                        </Button>
                      </div>
                    ))}
                    {expiring.length > 5 && (
                      <p className="text-xs text-amber-600 mt-1">…and {expiring.length - 5} more</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* KPI row */}
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

        {/* Main Tabs: Applications | Renewal Audit Trail */}
        <Tabs defaultValue="applications">
          <TabsList className="mb-4">
            <TabsTrigger value="applications" className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4" /> Applications
            </TabsTrigger>
            <TabsTrigger value="renewal-trail" className="flex items-center gap-1.5">
              <History className="h-4 w-4" /> Renewal Audit Trail
              {(allRenewalHistory ?? []).length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                  {(allRenewalHistory ?? []).length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Applications Tab ── */}
          <TabsContent value="applications">
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
                    const daysLeft = a.certificateExpiresAt
                      ? Math.ceil((new Date(a.certificateExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                      : null;
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
                            <div className="flex flex-col items-end gap-1">
                              <Badge className={`text-xs shrink-0 flex items-center gap-1 ${cfg.color}`}>
                                {cfg.icon}{cfg.label}
                              </Badge>
                              {daysLeft !== null && daysLeft <= 60 && <ExpiryBadge daysLeft={daysLeft} />}
                            </div>
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
                        <div className="flex flex-col items-end gap-1">
                          {(() => {
                            const cfg = STATUS_CONFIG[selected.status] ?? STATUS_CONFIG.submitted;
                            return (
                              <Badge className={`flex items-center gap-1 ${cfg.color}`}>
                                {cfg.icon}{cfg.label}
                              </Badge>
                            );
                          })()}
                          {selectedDaysLeft !== null && selectedDaysLeft <= 60 && (
                            <ExpiryBadge daysLeft={selectedDaysLeft} />
                          )}
                        </div>
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
                            {selectedDaysLeft !== null && selectedDaysLeft <= 60 && (
                              <Button
                                size="sm"
                                className="bg-amber-600 hover:bg-amber-700 text-white w-full"
                                onClick={() => renewMutation.mutate({ applicationId: selected.id })}
                                disabled={renewMutation.isPending}
                              >
                                <RefreshCw className="h-4 w-4 mr-2" />
                                {renewMutation.isPending ? "Renewing…" : `Renew Certificate (${selectedDaysLeft} days left)`}
                              </Button>
                            )}
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
          </TabsContent>

          {/* ── Renewal Audit Trail Tab ── */}
          <TabsContent value="renewal-trail">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" />
                  Renewal Request History
                </CardTitle>
                <CardDescription className="text-xs">
                  Complete lifecycle view of all AEO certificate renewal requests — pending, approved, and rejected.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {historyLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
                  </div>
                ) : (allRenewalHistory ?? []).length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground">
                    <History className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No renewal requests yet.</p>
                    <p className="text-xs mt-1">Requests appear here when traders initiate a renewal from their AEO portal.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="text-left py-2 pr-3 font-medium">Certificate</th>
                          <th className="text-left py-2 pr-3 font-medium">Trader</th>
                          <th className="text-left py-2 pr-3 font-medium">Tier</th>
                          <th className="text-left py-2 pr-3 font-medium">Requested</th>
                          <th className="text-left py-2 pr-3 font-medium">Processed</th>
                          <th className="text-left py-2 pr-3 font-medium">Decision</th>
                          <th className="text-left py-2 pr-3 font-medium">Score Trend</th>
                          <th className="text-left py-2 font-medium">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {(allRenewalHistory ?? []).map((r: any) => (
                          <tr key={r.id} className="hover:bg-muted/20">
                            <td className="py-2.5 pr-3 font-mono text-xs font-medium">
                              {r.certNumber ?? `App #${r.applicationId}`}
                            </td>
                            <td className="py-2.5 pr-3 text-xs">
                              <div>{r.traderName ?? `Trader #${r.traderId}`}</div>
                              {r.traderEmail && <div className="text-muted-foreground">{r.traderEmail}</div>}
                            </td>
                            <td className="py-2.5 pr-3">
                              {r.tier ? (
                                <Badge variant="outline" className="text-xs capitalize">{r.tier}</Badge>
                              ) : "—"}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                              {r.requestedAt ? new Date(r.requestedAt).toLocaleString() : "—"}
                            </td>
                            <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                              {r.processedAt ? new Date(r.processedAt).toLocaleString() : "—"}
                            </td>
                            <td className="py-2.5 pr-3">
                              {r.status === "approved" && (
                                <Badge className="bg-emerald-100 text-emerald-800 text-xs flex items-center gap-1 w-fit">
                                  <CheckCircle2 className="h-3 w-3" /> Approved
                                </Badge>
                              )}
                              {r.status === "rejected" && (
                                <Badge className="bg-red-100 text-red-800 text-xs flex items-center gap-1 w-fit">
                                  <XCircle className="h-3 w-3" /> Rejected
                                </Badge>
                              )}
                              {r.status === "pending" && (
                                <Badge className="bg-amber-100 text-amber-800 text-xs flex items-center gap-1 w-fit">
                                  <Clock className="h-3 w-3" /> Pending
                                </Badge>
                              )}
                            </td>
                            <td className="py-2.5 pr-3">
                              <ComplianceSparkline applicationId={r.applicationId} />
                            </td>
                            <td className="py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">
                              {r.notes ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
