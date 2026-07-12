/**
 * AEO Applications — TradeGateway™ NGSWTP
 * Authorised Economic Operator programme: apply, track status, manage certificates.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/DashboardLayout";

import {
  Shield, RefreshCw, Search, CheckCircle, AlertTriangle,
  Plus, Award, Star, TrendingUp, RotateCcw,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  submitted: "bg-blue-100 text-blue-800 border-blue-200",
  under_review: "bg-yellow-100 text-yellow-800 border-yellow-200",
  approved: "bg-green-100 text-green-800 border-green-200",
  rejected: "bg-red-100 text-red-800 border-red-200",
  suspended: "bg-orange-100 text-orange-800 border-orange-200",
  revoked: "bg-red-200 text-red-900 border-red-300",
};

function formatDate(ts: Date | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString();
}

export default function AEOApplications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showApplyDialog, setShowApplyDialog] = useState(false);
  const [showDetailId, setShowDetailId] = useState<number | null>(null);
  const [applyForm, setApplyForm] = useState({
    applicantType: "importer" as "importer" | "exporter" | "customs_broker" | "freight_forwarder" | "warehouse_operator",
    yearsInBusiness: "",
    annualTradeVolume: "",
    numberOfDeclarationsPerYear: "",
    hasComplianceOfficer: false,
    hasTradingPartnerVetting: false,
    hasSecurityProcedures: false,
    hasFinancialSolvency: false,
    selfAssessmentScore: "75",
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: myApp, isLoading } = trpc.aeo.myApplication.useQuery();
  const { data: allApps, isLoading: adminLoading } = trpc.aeo.all.useQuery(
    { limit: 100 },
    { enabled: isAdmin }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const applyMutation = trpc.aeo.submitApplication.useMutation({
    onSuccess: () => {
      toast({ title: "AEO Application Submitted", description: "Your application is under review." });
      utils.aeo.myApplication.invalidate();
      utils.aeo.all.invalidate();
      setShowApplyDialog(false);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const approveMutation = trpc.aeo.approve.useMutation({
    onSuccess: () => {
      toast({ title: "Application Approved" });
      utils.aeo.all.invalidate();
      setShowDetailId(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [renewalDialogId, setRenewalDialogId] = useState<number | null>(null);
  const [renewalNote, setRenewalNote] = useState("");
  const renewalMutation = trpc.aeo.initiateAeoRenewal.useMutation({
    onSuccess: () => {
      toast({ title: "Renewal Initiated", description: "Your AEO renewal request has been submitted." });
      utils.aeo.myApplication.invalidate();
      utils.aeo.all.invalidate();
      setRenewalDialogId(null);
      setRenewalNote("");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const rejectMutation = trpc.aeo.reject.useMutation({
    onSuccess: () => {
      toast({ title: "Application Rejected" });
      utils.aeo.all.invalidate();
      setShowDetailId(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rawList = isAdmin ? (allApps ?? []) : (myApp ? [myApp] : []);
  const filtered = useMemo(() => rawList.filter((a) => {
    const matchSearch = !search ||
      a.applicationNumber?.toLowerCase().includes(search.toLowerCase()) ||
      a.certificateNumber?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || a.status === statusFilter;
    return matchSearch && matchStatus;
  }), [rawList, search, statusFilter]);

  const approvedCount = rawList.filter((a) => a.status === "approved").length;
  const pendingCount = rawList.filter((a) => ["submitted", "under_review"].includes(a.status)).length;
  const selectedItem = showDetailId !== null ? rawList.find((a) => a.id === showDetailId) : null;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Shield className="w-7 h-7 text-accent" />
            AEO Applications
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Authorised Economic Operator programme — apply for trusted trader status
          </p>
        </div>
        {!isAdmin && !myApp && (
          <Button
            onClick={() => setShowApplyDialog(true)}
            className="bg-accent hover:bg-[#b8891a] text-white"
          >
            <Plus className="w-4 h-4 mr-2" /> Apply for AEO
          </Button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Applications</div>
          <div className="text-2xl font-bold mt-1">{rawList.length}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Approved</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{approvedCount}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Under Review</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">{pendingCount}</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Approval Rate</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {rawList.length > 0 ? Math.round((approvedCount / rawList.length) * 100) : 0}%
          </div>
        </div>
      </div>

      {/* AEO Benefits Banner (for traders without an application) */}
      {!isAdmin && !myApp && (
        <div className="bg-gradient-to-r from-[#0A1628] to-[#1E3A5F] rounded-xl p-6 text-white">
          <div className="flex items-start gap-4">
            <Award className="w-10 h-10 text-accent flex-shrink-0 mt-1" />
            <div>
              <h3 className="text-lg font-bold mb-2">Become an Authorised Economic Operator</h3>
              <p className="text-blue-100 text-sm mb-4">
                AEO status grants your business priority processing, reduced inspections, and access to
                simplified customs procedures — reducing clearance time by up to 80%.
              </p>
              <div className="grid grid-cols-3 gap-4 text-sm">
                {[
                  { icon: <TrendingUp className="w-4 h-4" />, text: "Green-lane clearance" },
                  { icon: <CheckCircle className="w-4 h-4" />, text: "Fewer inspections" },
                  { icon: <Star className="w-4 h-4" />, text: "Trusted trader status" },
                ].map((b, i) => (
                  <div key={i} className="flex items-center gap-2 text-blue-100">
                    <span className="text-accent">{b.icon}</span>
                    {b.text}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by application # or certificate..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {(isLoading || adminLoading) ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading applications...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Shield className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No AEO applications found</p>
          {!isAdmin && (
            <Button className="mt-4 bg-accent hover:bg-[#b8891a] text-white" onClick={() => setShowApplyDialog(true)}>
              <Plus className="w-4 h-4 mr-2" /> Apply Now
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Application #</th>
                <th className="text-left px-4 py-3 font-medium">Tier</th>
                <th className="text-left px-4 py-3 font-medium">Certificate #</th>
                <th className="text-left px-4 py-3 font-medium">Compliance Score</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((a) => (
                <tr key={a.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs">{a.applicationNumber}</td>
                  <td className="px-4 py-3 text-xs uppercase">{a.tier ?? "standard"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{a.certificateNumber ?? "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-2 max-w-20">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${a.complianceScore ?? 0}%` }}
                        />
                      </div>
                      <span className="text-xs">{a.complianceScore ?? 0}/100</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={`text-xs border ${STATUS_COLORS[a.status] ?? ""}`}>{a.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(a.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setShowDetailId(a.id)}>View</Button>
                      {a.status === "approved" && (
                        <Button variant="ghost" size="sm" className="text-amber-600" onClick={() => { setRenewalDialogId(a.id); setRenewalNote(""); }}>
                          <RotateCcw className="w-3.5 h-3.5 mr-1" />Renew
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Renewal Dialog */}
      <Dialog open={renewalDialogId !== null} onOpenChange={(open) => { if (!open) setRenewalDialogId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><RotateCcw className="w-4 h-4 text-amber-600" />Initiate AEO Renewal</DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <p className="text-sm text-muted-foreground">Submit a renewal request for this AEO certificate. Our team will review your continued compliance.</p>
            <div>
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea className="mt-1" rows={3} placeholder="Any changes to your business since last certification…" value={renewalNote} onChange={(e) => setRenewalNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewalDialogId(null)}>Cancel</Button>
            <Button onClick={() => renewalMutation.mutate({ applicationId: renewalDialogId!, renewalNotes: renewalNote })} disabled={renewalMutation.isPending}>
              {renewalMutation.isPending ? "Submitting…" : "Submit Renewal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Dialog */}
      <Dialog open={showApplyDialog} onOpenChange={setShowApplyDialog}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Apply for AEO Status</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Applicant Type *</label>
                <Select value={applyForm.applicantType} onValueChange={(v) => setApplyForm((f) => ({ ...f, applicantType: v as any }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="importer">Importer</SelectItem>
                    <SelectItem value="exporter">Exporter</SelectItem>
                    <SelectItem value="customs_broker">Customs Broker</SelectItem>
                    <SelectItem value="freight_forwarder">Freight Forwarder</SelectItem>
                    <SelectItem value="warehouse_operator">Warehouse Operator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Years in Business *</label>
                <Input className="mt-1" type="number" min="0"
                  value={applyForm.yearsInBusiness}
                  onChange={(e) => setApplyForm((f) => ({ ...f, yearsInBusiness: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Annual Trade Volume (USD) *</label>
                <Input className="mt-1" type="number" min="1" placeholder="e.g. 5000000"
                  value={applyForm.annualTradeVolume}
                  onChange={(e) => setApplyForm((f) => ({ ...f, annualTradeVolume: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Declarations Per Year *</label>
                <Input className="mt-1" type="number" min="0" placeholder="e.g. 500"
                  value={applyForm.numberOfDeclarationsPerYear}
                  onChange={(e) => setApplyForm((f) => ({ ...f, numberOfDeclarationsPerYear: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Self-Assessment Score (0–100)</label>
                <Input className="mt-1" type="number" min="0" max="100"
                  value={applyForm.selfAssessmentScore}
                  onChange={(e) => setApplyForm((f) => ({ ...f, selfAssessmentScore: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-3">
              <div className="text-sm font-medium">Compliance Checklist</div>
              {[
                { key: "hasComplianceOfficer", label: "Dedicated compliance officer on staff" },
                { key: "hasTradingPartnerVetting", label: "Trading partner vetting procedures in place" },
                { key: "hasSecurityProcedures", label: "Supply chain security procedures documented" },
                { key: "hasFinancialSolvency", label: "Financial solvency demonstrated (last 3 years)" },
              ].map((item) => (
                <div key={item.key} className="flex items-center gap-3">
                  <Checkbox
                    id={item.key}
                    checked={applyForm[item.key as keyof typeof applyForm] as boolean}
                    onCheckedChange={(v) => setApplyForm((f) => ({ ...f, [item.key]: !!v }))}
                  />
                  <label htmlFor={item.key} className="text-sm cursor-pointer">{item.label}</label>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApplyDialog(false)}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!applyForm.yearsInBusiness || !applyForm.annualTradeVolume || applyMutation.isPending}
              onClick={() => applyMutation.mutate({
                applicantType: applyForm.applicantType,
                yearsInBusiness: parseInt(applyForm.yearsInBusiness) || 0,
                annualTradeVolume: parseFloat(applyForm.annualTradeVolume) || 1,
                numberOfDeclarationsPerYear: parseInt(applyForm.numberOfDeclarationsPerYear) || 0,
                hasComplianceOfficer: applyForm.hasComplianceOfficer,
                hasTradingPartnerVetting: applyForm.hasTradingPartnerVetting,
                hasSecurityProcedures: applyForm.hasSecurityProcedures,
                hasFinancialSolvency: applyForm.hasFinancialSolvency,
                selfAssessmentScore: parseFloat(applyForm.selfAssessmentScore) || 75,
              })}
            >
              {applyMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Shield className="w-4 h-4 mr-2" />}
              Submit Application
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={showDetailId !== null} onOpenChange={() => setShowDetailId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>AEO Application Detail</DialogTitle>
          </DialogHeader>
          {selectedItem ? (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><div className="text-muted-foreground">Application #</div><div className="font-mono text-xs">{selectedItem.applicationNumber}</div></div>
                <div><div className="text-muted-foreground">Status</div>
                  <Badge className={`text-xs border ${STATUS_COLORS[selectedItem.status] ?? ""}`}>{selectedItem.status}</Badge>
                </div>
                <div><div className="text-muted-foreground">Tier</div><div className="capitalize">{selectedItem.tier ?? "standard"}</div></div>
                <div><div className="text-muted-foreground">Certificate #</div><div className="font-mono text-xs">{selectedItem.certificateNumber ?? "—"}</div></div>
                <div><div className="text-muted-foreground">Compliance Score</div><div className="font-bold">{selectedItem.complianceScore ?? "—"}/100</div></div>
                <div><div className="text-muted-foreground">Security Score</div><div className="font-bold">{selectedItem.securityScore ?? "—"}/100</div></div>
                <div><div className="text-muted-foreground">Certificate Issued</div><div>{formatDate(selectedItem.certificateIssuedAt)}</div></div>
                <div><div className="text-muted-foreground">Certificate Expires</div><div>{formatDate(selectedItem.certificateExpiresAt)}</div></div>
              </div>
              {selectedItem.reviewerNotes && (
                <div className="bg-muted/50 rounded p-3">
                  <div className="text-muted-foreground text-xs mb-1">Reviewer Notes</div>
                  <div>{selectedItem.reviewerNotes}</div>
                </div>
              )}
              {isAdmin && ["submitted", "under_review"].includes(selectedItem.status) && (
                <div className="flex gap-2 pt-2">
                  <Button
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate({ applicationId: showDetailId! })}
                  >
                    <CheckCircle className="w-4 h-4 mr-2" /> Approve
                  </Button>
                  <Button
                    variant="destructive" className="flex-1"
                    disabled={rejectMutation.isPending}
                    onClick={() => rejectMutation.mutate({ applicationId: showDetailId!, reason: "Does not meet AEO criteria" })}
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" /> Reject
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading...
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </DashboardLayout>
  );
}
