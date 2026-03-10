import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Shield, CheckCircle2, Clock, XCircle, Award, Star, Zap,
  FileText, DollarSign, Lock, TrendingUp, ChevronRight,
  AlertTriangle, Info, RefreshCw,
} from "lucide-react";

const TIERS = [
  {
    id: "standard", label: "Standard AEO", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20",
    benefits: ["Reduced documentary checks (30% reduction)", "Priority processing at border", "Access to AEO helpdesk", "Recognition in COMESA Single Window"],
    requirements: [
      { id: "compliance_officer", label: "Designated Compliance Officer", category: "Compliance" },
      { id: "financial_solvency", label: "Demonstrated Financial Solvency (3 years audited accounts)", category: "Financial" },
      { id: "security_procedures", label: "Written Security Procedures and Controls", category: "Security" },
      { id: "trading_partner_vetting", label: "Trading Partner Vetting Process", category: "Compliance" },
      { id: "record_keeping", label: "Adequate Record Keeping System (5 years)", category: "Compliance" },
      { id: "customs_competency", label: "Customs Competency Training for Staff", category: "Competency" },
    ],
  },
  {
    id: "silver", label: "Silver AEO", color: "text-slate-300", bg: "bg-slate-500/10 border-slate-500/20",
    benefits: ["All Standard AEO benefits", "Reduced physical inspections (60% reduction)", "Green-lane clearance eligibility", "Mutual recognition with 4 partner countries", "Dedicated customs liaison officer"],
    requirements: [
      { id: "iso_9001", label: "ISO 9001 Quality Management Certification", category: "Quality" },
      { id: "3yr_aeo", label: "Minimum 3 years as Standard AEO holder", category: "Track Record" },
      { id: "zero_violations", label: "Zero serious customs violations in 3 years", category: "Compliance" },
      { id: "supply_chain_security", label: "Supply Chain Security Assessment", category: "Security" },
      { id: "it_systems", label: "Integrated IT Systems with customs interface", category: "Technology" },
    ],
  },
  {
    id: "gold", label: "Gold AEO", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20",
    benefits: ["All Silver AEO benefits", "Blue-lane fast-track (< 4 hours guaranteed)", "Pre-arrival clearance", "Mutual recognition with all ASEAN Single Window partners", "Annual compliance review (no random audits)", "Priority access to bonded warehouse facilities"],
    requirements: [
      { id: "iso_28000", label: "ISO 28000 Supply Chain Security Certification", category: "Security" },
      { id: "5yr_silver", label: "Minimum 5 years as Silver AEO holder", category: "Track Record" },
      { id: "annual_volume", label: "Minimum 500 declarations per year", category: "Volume" },
      { id: "customs_partnership", label: "Active participation in Customs-Business Partnership Programme", category: "Partnership" },
      { id: "cyber_security", label: "Cyber Security Assessment and Controls (NIST Framework)", category: "Technology" },
    ],
  },
];

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  submitted: { label: "Under Review", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  under_review: { label: "Under Review", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  approved: { label: "Approved", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  rejected: { label: "Rejected", color: "bg-red-500/10 text-red-400 border-red-500/20" },
  suspended: { label: "Suspended", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
};

export default function TraderAEO() {
  const { data: application, isLoading, refetch } = trpc.aeo.myApplication.useQuery();
  const submitMutation = trpc.aeo.submitApplication.useMutation({
    onSuccess: () => { toast.success("AEO application submitted. You will be notified of the outcome."); refetch(); },
    onError: (err) => toast.error(err.message),
  });
  const { data: renewalStatus, refetch: refetchRenewal } = trpc.aeo.myRenewalStatus.useQuery();
  const requestRenewalMutation = trpc.aeo.requestRenewal.useMutation({
    onSuccess: () => { toast.success("Renewal request submitted. You will be notified once processed."); refetch(); refetchRenewal(); },
    onError: (err) => toast.error(err.message),
  });
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    applicantType: "importer" as "importer" | "exporter" | "customs_broker" | "freight_forwarder" | "warehouse_operator",
    yearsInBusiness: 0, annualTradeVolume: 0, numberOfDeclarationsPerYear: 0,
  });
  const standardReqs = TIERS[0].requirements;
  const completedCount = standardReqs.filter(r => checklist[r.id]).length;
  const checklistScore = Math.round((completedCount / standardReqs.length) * 100);
  const handleSubmit = () => submitMutation.mutate({
    applicantType: form.applicantType, yearsInBusiness: form.yearsInBusiness,
    annualTradeVolume: form.annualTradeVolume, numberOfDeclarationsPerYear: form.numberOfDeclarationsPerYear,
    hasComplianceOfficer: !!checklist.compliance_officer, hasTradingPartnerVetting: !!checklist.trading_partner_vetting,
    hasSecurityProcedures: !!checklist.security_procedures, hasFinancialSolvency: !!checklist.financial_solvency,
    selfAssessmentScore: checklistScore,
  });
  const app = application as any;
  const currentTier = app?.tier ?? null;
  const appStatus = app?.status ?? null;

  return (
    <DashboardLayout title="AEO Programme">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Award className="h-6 w-6 text-amber-400" />Authorised Economic Operator Programme
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Achieve AEO status to unlock fast-track clearance, reduced inspections, and international mutual recognition.</p>
        </div>

        {isLoading ? <Skeleton className="h-24 w-full" /> : application ? (
          <Card className={`border ${appStatus === "approved" ? "border-emerald-500/30 bg-emerald-500/5" : "border-blue-500/30 bg-blue-500/5"}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${appStatus === "approved" ? "bg-emerald-500/20" : "bg-blue-500/20"}`}>
                  {appStatus === "approved" ? <Award className="h-6 w-6 text-amber-400" /> : <Clock className="h-6 w-6 text-blue-400" />}
                </div>
                <div>
                  <p className="font-semibold">{appStatus === "approved" ? `AEO ${currentTier?.charAt(0).toUpperCase()}${currentTier?.slice(1)} Certificate Issued` : "Application In Progress"}</p>
                  <p className="text-sm text-muted-foreground">{app.applicationNumber}{app.certificateNumber && ` · Cert: ${app.certificateNumber}`}{app.certificateExpiresAt && ` · Expires: ${new Date(app.certificateExpiresAt).toLocaleDateString()}`}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {appStatus && STATUS_CONFIG[appStatus] && <Badge variant="outline" className={STATUS_CONFIG[appStatus].color}>{STATUS_CONFIG[appStatus].label}</Badge>}
                {renewalStatus?.status === "pending" && (
                  <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">Renewal Pending</Badge>
                )}
                {appStatus === "approved" && app.certificateExpiresAt && (() => {
                  const daysLeft = Math.ceil((new Date(app.certificateExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
                  if (daysLeft <= 90 && !renewalStatus) return (
                    <button
                      onClick={() => requestRenewalMutation.mutate()}
                      disabled={requestRenewalMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" />
                      {requestRenewalMutation.isPending ? "Submitting…" : `Request Renewal (${daysLeft}d left)`}
                    </button>
                  );
                  return null;
                })()}
                <div className="text-right text-sm"><p className="text-muted-foreground text-xs">Compliance Score</p><p className="font-bold text-lg">{app.complianceScore ?? 0}%</p></div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-500/20 bg-amber-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <Info className="h-5 w-5 text-amber-400 shrink-0" />
              <p className="text-sm text-muted-foreground">You have not yet applied for AEO status. Complete the checklist below and submit your application to begin the process.</p>
            </CardContent>
          </Card>
        )}

        <div>
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />AEO Tier Progression</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {TIERS.map((tier, idx) => {
              const isActive = currentTier === tier.id && appStatus === "approved";
              return (
                <Card key={tier.id} className={`border ${isActive ? tier.bg : ""}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className={`flex items-center gap-2 ${tier.color}`}>
                        {idx === 0 ? <Shield className="h-5 w-5" /> : idx === 1 ? <Star className="h-5 w-5" /> : <Award className="h-5 w-5" />}
                        <CardTitle className="text-sm">{tier.label}</CardTitle>
                      </div>
                      {isActive ? <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">Active</Badge> : idx > 0 ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Benefits</p>
                      <ul className="space-y-1">{tier.benefits.slice(0, 3).map((b, i) => <li key={i} className="flex items-start gap-1.5 text-xs"><Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />{b}</li>)}{tier.benefits.length > 3 && <li className="text-xs text-muted-foreground">+{tier.benefits.length - 3} more</li>}</ul>
                    </div>
                    <Separator />
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5">Key Requirements</p>
                      <ul className="space-y-1">{tier.requirements.slice(0, 3).map((r, i) => <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" />{r.label}</li>)}{tier.requirements.length > 3 && <li className="text-xs text-muted-foreground">+{tier.requirements.length - 3} more</li>}</ul>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {!application && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4 text-primary" />Standard AEO Self-Assessment Checklist</CardTitle>
              <CardDescription>Complete all requirements before submitting your application.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Checklist Completion</span><span className="font-semibold">{completedCount}/{standardReqs.length} ({checklistScore}%)</span></div>
                <Progress value={checklistScore} className="h-2" />
              </div>
              <Separator />
              {["Compliance", "Financial", "Security", "Competency"].map(category => {
                const items = standardReqs.filter(r => r.category === category);
                return (
                  <div key={category}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{category}</p>
                    <div className="space-y-2">{items.map(req => (
                      <div key={req.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-muted/20">
                        <Checkbox id={req.id} checked={!!checklist[req.id]} onCheckedChange={(v) => setChecklist(prev => ({ ...prev, [req.id]: !!v }))} />
                        <Label htmlFor={req.id} className="text-sm cursor-pointer flex-1">{req.label}</Label>
                        {checklist[req.id] && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
                      </div>
                    ))}</div>
                  </div>
                );
              })}
              <Separator />
              <div>
                <p className="text-sm font-semibold mb-3">Application Details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1"><Label className="text-xs">Applicant Type</Label>
                    <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.applicantType} onChange={e => setForm(f => ({ ...f, applicantType: e.target.value as typeof form.applicantType }))}>
                      <option value="importer">Importer</option><option value="exporter">Exporter</option><option value="customs_broker">Customs Broker</option><option value="freight_forwarder">Freight Forwarder</option><option value="warehouse_operator">Warehouse Operator</option>
                    </select>
                  </div>
                  <div className="space-y-1"><Label className="text-xs">Years in Business</Label><Input type="number" min={0} value={form.yearsInBusiness} onChange={e => setForm(f => ({ ...f, yearsInBusiness: +e.target.value }))} className="h-9" /></div>
                  <div className="space-y-1"><Label className="text-xs">Annual Trade Volume (USD)</Label><Input type="number" min={0} value={form.annualTradeVolume} onChange={e => setForm(f => ({ ...f, annualTradeVolume: +e.target.value }))} className="h-9" /></div>
                  <div className="space-y-1"><Label className="text-xs">Declarations per Year</Label><Input type="number" min={0} value={form.numberOfDeclarationsPerYear} onChange={e => setForm(f => ({ ...f, numberOfDeclarationsPerYear: +e.target.value }))} className="h-9" /></div>
                </div>
              </div>
              <Button onClick={handleSubmit} disabled={submitMutation.isPending || checklistScore < 50} className="w-full">{submitMutation.isPending ? "Submitting..." : "Submit AEO Application"}</Button>
              {checklistScore < 50 && <p className="text-xs text-muted-foreground text-center">Complete at least 50% of the checklist to submit your application.</p>}
            </CardContent>
          </Card>
        )}

        {application && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />Assessment Score Breakdown</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: "Compliance Score", value: app.complianceScore ?? 0, icon: <Shield className="h-4 w-4 text-blue-400" />, color: "text-blue-400" },
                  { label: "Security Score", value: app.securityScore ?? 0, icon: <Lock className="h-4 w-4 text-purple-400" />, color: "text-purple-400" },
                  { label: "Financial Standing", value: app.financialStandingScore ?? 0, icon: <DollarSign className="h-4 w-4 text-emerald-400" />, color: "text-emerald-400" },
                ].map(s => (
                  <div key={s.label} className="space-y-2">
                    <div className="flex items-center gap-2">{s.icon}<span className="text-xs text-muted-foreground">{s.label}</span></div>
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}%</p>
                    <Progress value={s.value} className="h-1.5" />
                  </div>
                ))}
              </div>
              {app.reviewerNotes && <div className="mt-4 p-3 rounded-md bg-muted/30 border border-border"><p className="text-xs font-medium text-muted-foreground mb-1">Reviewer Notes</p><p className="text-sm">{app.reviewerNotes}</p></div>}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
