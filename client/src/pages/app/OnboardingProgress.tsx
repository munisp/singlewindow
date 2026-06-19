/**
 * Onboarding Progress — TradeGateway™ NGSWTP
 * Multi-step trader onboarding wizard with document upload and AEO eligibility.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/DashboardLayout";

import {
  CheckCircle, Circle, RefreshCw, ChevronRight, Building2,
  FileText, CreditCard, UserCheck, Star, AlertTriangle,
} from "lucide-react";

const STEPS = [
  { id: "company_info", label: "Company Info", icon: Building2 },
  { id: "documents", label: "Documents", icon: FileText },
  { id: "bank_details", label: "Bank Details", icon: CreditCard },
  { id: "review", label: "Review & Submit", icon: UserCheck },
];

const STEP_ORDER = ["company_info", "documents", "bank_details", "review"];

function StepIndicator({ steps, currentStep, completedSteps }: {
  steps: typeof STEPS;
  currentStep: string;
  completedSteps: string[];
}) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {steps.map((step, idx) => {
        const isCompleted = completedSteps.includes(step.id);
        const isCurrent = step.id === currentStep;
        const Icon = step.icon;
        return (
          <div key={step.id} className="flex items-center flex-1">
            <div className={`flex items-center gap-2 flex-1 ${idx > 0 ? "pl-2" : ""}`}>
              {idx > 0 && (
                <div className={`flex-1 h-0.5 ${isCompleted ? "bg-accent" : "bg-border"}`} />
              )}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isCurrent ? "bg-accent/10 text-accent border border-accent/30" :
                isCompleted ? "text-green-600" : "text-muted-foreground"
              }`}>
                {isCompleted ? (
                  <CheckCircle className="w-4 h-4 text-green-600" />
                ) : isCurrent ? (
                  <Icon className="w-4 h-4" />
                ) : (
                  <Circle className="w-4 h-4" />
                )}
                <span className="hidden md:inline">{step.label}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardingProgress() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [activeStep, setActiveStep] = useState("company_info");
  const [form, setForm] = useState({
    // Company Info
    companyName: "",
    registrationNumber: "",
    country: "GH",
    address: "",
    city: "",
    postalCode: "",
    industry: "manufacturing" as const,
    annualTradeVolume: "1m_10m" as const,
    website: "",
    phone: "",
    // Documents
    incorporationCertUrl: "https://storage.tradegateway.gov/docs/demo-cert.pdf",
    incorporationCertName: "incorporation_cert.pdf",
    taxIdCertUrl: "https://storage.tradegateway.gov/docs/demo-tax.pdf",
    taxIdCertName: "tax_id_cert.pdf",
    directorIdUrl: "https://storage.tradegateway.gov/docs/demo-id.pdf",
    directorIdName: "director_id.pdf",
    taxId: "",
    directorName: "",
    // Bank Details
    accountHolderName: "",
    accountNumber: "",
    bankName: "",
    bankBranch: "",
    swiftCode: "",
    currency: "GHS",
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: progress, isLoading } = trpc.onboarding.getProgress.useQuery();
  const { data: stats } = trpc.onboarding.getOnboardingStats.useQuery();
  // calculateAeoEligibility is a mutation that requires company profile data
  const [aeoEligibility, setAeoEligibility] = useState<any>(null);
  const calcAeoMutation = trpc.onboarding.calculateAeoEligibility.useMutation({
    onSuccess: (data) => setAeoEligibility(data),
  });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const saveStepMutation = trpc.onboarding.saveStep.useMutation({
    onSuccess: () => {
      toast({ title: "Step saved" });
      utils.onboarding.getProgress.invalidate();
      const idx = STEP_ORDER.indexOf(activeStep);
      if (idx < STEP_ORDER.length - 1) setActiveStep(STEP_ORDER[idx + 1]);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const resetMutation = trpc.onboarding.resetOnboarding.useMutation({
    onSuccess: () => {
      toast({ title: "Onboarding reset" });
      utils.onboarding.getProgress.invalidate();
      setActiveStep("company_info");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const completedSteps: string[] = (progress as any)?.completedSteps ?? [];
  const overallStatus = (progress as any)?.status ?? "not_started";
  const overallPct = (progress as any)?.completionPercentage ?? 0;

  const handleSaveStep = () => {
    const stepData: any = { step: activeStep };
    if (activeStep === "company_info") {
      Object.assign(stepData, {
        companyName: form.companyName,
        registrationNumber: form.registrationNumber,
        country: form.country,
        address: form.address,
        city: form.city,
        postalCode: form.postalCode,
        industry: form.industry,
        annualTradeVolume: form.annualTradeVolume,
        phone: form.phone,
        ...(form.website ? { website: form.website } : {}),
      });
    } else if (activeStep === "documents") {
      Object.assign(stepData, {
        incorporationCertUrl: form.incorporationCertUrl,
        incorporationCertName: form.incorporationCertName,
        taxIdCertUrl: form.taxIdCertUrl,
        taxIdCertName: form.taxIdCertName,
        directorIdUrl: form.directorIdUrl,
        directorIdName: form.directorIdName,
        taxId: form.taxId,
        directorName: form.directorName,
      });
    } else if (activeStep === "bank_details") {
      Object.assign(stepData, {
        accountHolderName: form.accountHolderName,
        accountNumber: form.accountNumber,
        bankName: form.bankName,
        bankBranch: form.bankBranch,
        swiftCode: form.swiftCode,
        currency: form.currency,
      });
    } else if (activeStep === "review") {
      stepData.confirmed = true;
    }
    saveStepMutation.mutate(stepData);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading onboarding...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <UserCheck className="w-7 h-7 text-accent" />
            Trader Onboarding
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Complete your profile to access all TradeGateway services
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-medium">{overallPct}% Complete</div>
            <Badge className={`text-xs mt-1 ${
              overallStatus === "completed" ? "bg-green-100 text-green-800 border-green-200 border" :
              overallStatus === "in_progress" ? "bg-blue-100 text-blue-800 border-blue-200 border" :
              "bg-gray-100 text-gray-700 border-gray-200 border"
            }`}>
              {overallStatus.replace("_", " ")}
            </Badge>
          </div>
          {overallStatus !== "not_started" && (
            <Button variant="outline" size="sm" onClick={() => resetMutation.mutate()}>
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-muted rounded-full h-2">
        <div
          className="bg-accent h-2 rounded-full transition-all duration-500"
          style={{ width: `${overallPct}%` }}
        />
      </div>

      {/* AEO Eligibility Banner */}
      {aeoEligibility && (
        <div className={`border rounded-lg p-4 flex items-center gap-3 ${
          (aeoEligibility as any).eligible
            ? "bg-green-50 border-green-200"
            : "bg-yellow-50 border-yellow-200"
        }`}>
          {(aeoEligibility as any).eligible ? (
            <Star className="w-5 h-5 text-green-600 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0" />
          )}
          <div>
            <div className="font-medium text-sm">
              {(aeoEligibility as any).eligible
                ? "AEO Eligible — You qualify for Authorised Economic Operator status"
                : "AEO Not Yet Eligible"}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Score: {(aeoEligibility as any).score ?? 0}/100 · {(aeoEligibility as any).reason ?? "Complete onboarding to improve your score"}
            </div>
          </div>
        </div>
      )}

      {/* Step Indicator */}
      <StepIndicator steps={STEPS} currentStep={activeStep} completedSteps={completedSteps} />

      {/* Step Content */}
      <div className="bg-card border rounded-lg p-6">
        {/* Company Info Step */}
        {activeStep === "company_info" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Building2 className="w-5 h-5 text-accent" /> Company Information
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">Company Name *</label>
                <Input className="mt-1" placeholder="Registered company name"
                  value={form.companyName}
                  onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Registration Number *</label>
                <Input className="mt-1" placeholder="e.g. CS123456789"
                  value={form.registrationNumber}
                  onChange={(e) => setForm((f) => ({ ...f, registrationNumber: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Country *</label>
                <Select value={form.country} onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GH">Ghana</SelectItem>
                    <SelectItem value="RW">Rwanda</SelectItem>
                    <SelectItem value="SG">Singapore</SelectItem>
                    <SelectItem value="KE">Kenya</SelectItem>
                    <SelectItem value="NG">Nigeria</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-sm font-medium">Address *</label>
                <Input className="mt-1" placeholder="Street address"
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">City *</label>
                <Input className="mt-1" placeholder="City"
                  value={form.city}
                  onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Postal Code *</label>
                <Input className="mt-1" placeholder="Postal / ZIP"
                  value={form.postalCode}
                  onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Industry *</label>
                <Select value={form.industry} onValueChange={(v: any) => setForm((f) => ({ ...f, industry: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manufacturing">Manufacturing</SelectItem>
                    <SelectItem value="trading">Trading</SelectItem>
                    <SelectItem value="agriculture">Agriculture</SelectItem>
                    <SelectItem value="mining">Mining</SelectItem>
                    <SelectItem value="services">Services</SelectItem>
                    <SelectItem value="logistics">Logistics</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Annual Trade Volume *</label>
                <Select value={form.annualTradeVolume} onValueChange={(v: any) => setForm((f) => ({ ...f, annualTradeVolume: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="under_100k">Under $100K</SelectItem>
                    <SelectItem value="100k_1m">$100K – $1M</SelectItem>
                    <SelectItem value="1m_10m">$1M – $10M</SelectItem>
                    <SelectItem value="over_10m">Over $10M</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Phone *</label>
                <Input className="mt-1" placeholder="+233 XX XXX XXXX"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Website</label>
                <Input className="mt-1" placeholder="https://company.com"
                  value={form.website}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* Documents Step */}
        {activeStep === "documents" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="w-5 h-5 text-accent" /> Required Documents
            </h2>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Upload your documents to a secure storage service and paste the URL below. Accepted formats: PDF, JPG, PNG.
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Incorporation Certificate *</label>
                <Input className="mt-1" placeholder="https://storage.../cert.pdf"
                  value={form.incorporationCertUrl}
                  onChange={(e) => setForm((f) => ({ ...f, incorporationCertUrl: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Tax ID Certificate *</label>
                <Input className="mt-1" placeholder="https://storage.../tax.pdf"
                  value={form.taxIdCertUrl}
                  onChange={(e) => setForm((f) => ({ ...f, taxIdCertUrl: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Director ID *</label>
                <Input className="mt-1" placeholder="https://storage.../id.pdf"
                  value={form.directorIdUrl}
                  onChange={(e) => setForm((f) => ({ ...f, directorIdUrl: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Tax ID Number *</label>
                  <Input className="mt-1" placeholder="e.g. P0012345678"
                    value={form.taxId}
                    onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))} />
                </div>
                <div>
                  <label className="text-sm font-medium">Director Full Name *</label>
                  <Input className="mt-1" placeholder="As on ID document"
                    value={form.directorName}
                    onChange={(e) => setForm((f) => ({ ...f, directorName: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bank Details Step */}
        {activeStep === "bank_details" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-accent" /> Bank Account Details
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="text-sm font-medium">Account Holder Name *</label>
                <Input className="mt-1" placeholder="As registered with bank"
                  value={form.accountHolderName}
                  onChange={(e) => setForm((f) => ({ ...f, accountHolderName: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Account Number *</label>
                <Input className="mt-1" placeholder="Bank account number"
                  value={form.accountNumber}
                  onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Currency *</label>
                <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="GHS">GHS — Ghana Cedi</SelectItem>
                    <SelectItem value="USD">USD — US Dollar</SelectItem>
                    <SelectItem value="EUR">EUR — Euro</SelectItem>
                    <SelectItem value="RWF">RWF — Rwanda Franc</SelectItem>
                    <SelectItem value="SGD">SGD — Singapore Dollar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Bank Name *</label>
                <Input className="mt-1" placeholder="e.g. Ghana Commercial Bank"
                  value={form.bankName}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">Branch</label>
                <Input className="mt-1" placeholder="Branch name"
                  value={form.bankBranch}
                  onChange={(e) => setForm((f) => ({ ...f, bankBranch: e.target.value }))} />
              </div>
              <div>
                <label className="text-sm font-medium">SWIFT / BIC Code</label>
                <Input className="mt-1" placeholder="e.g. GHCBGHAC"
                  value={form.swiftCode}
                  onChange={(e) => setForm((f) => ({ ...f, swiftCode: e.target.value }))} />
              </div>
            </div>
          </div>
        )}

        {/* Review Step */}
        {activeStep === "review" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-accent" /> Review & Submit
            </h2>
            <div className="space-y-3">
              {STEP_ORDER.slice(0, 3).map((stepId) => {
                const step = STEPS.find((s) => s.id === stepId)!;
                const done = completedSteps.includes(stepId);
                const Icon = step.icon;
                return (
                  <div key={stepId} className={`flex items-center justify-between border rounded-lg p-3 ${
                    done ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-200"
                  }`}>
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      <span className="text-sm font-medium">{step.label}</span>
                    </div>
                    {done ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-yellow-600" />
                        <Button variant="ghost" size="sm" className="text-xs h-7"
                          onClick={() => setActiveStep(stepId)}>
                          Complete
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {completedSteps.length >= 3 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm text-green-800">
                All required steps completed. Click "Submit Application" to proceed to verification.
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <Button
            variant="outline"
            disabled={STEP_ORDER.indexOf(activeStep) === 0}
            onClick={() => setActiveStep(STEP_ORDER[STEP_ORDER.indexOf(activeStep) - 1])}
          >
            Back
          </Button>
          <Button
            className="bg-accent hover:bg-[#b8891a] text-white"
            disabled={saveStepMutation.isPending}
            onClick={handleSaveStep}
          >
            {saveStepMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <ChevronRight className="w-4 h-4 mr-2" />
            )}
            {activeStep === "review" ? "Submit Application" : "Save & Continue"}
          </Button>
        </div>
      </div>

      {/* Stats (admin view) */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{(stats as any).total ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Applications</div>
          </div>
          <div className="bg-card border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-green-600">{(stats as any).completed ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Completed</div>
          </div>
          <div className="bg-card border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-blue-600">{(stats as any).inProgress ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">In Progress</div>
          </div>
          <div className="bg-card border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold text-yellow-600">{(stats as any).notStarted ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Not Started</div>
          </div>
        </div>
      )}
    </div>
  );
}
