/**
 * Sprint 67 — Trader Onboarding Wizard
 * 5-step guided onboarding: Company Profile → KYC Documents → Bank Account
 *   → Test Declaration → AEO Eligibility Check
 */

import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Building2, FileCheck, Landmark, ClipboardList, Award,
  CheckCircle2, Circle, ChevronRight, ChevronLeft,
  Upload, Shield, Sparkles, ArrowRight, RotateCcw,
  AlertCircle, Loader2,
} from "lucide-react";

// ─── STEP DEFINITIONS ────────────────────────────────────────────────────────

const STEPS = [
  {
    id: "company_profile",
    title: "Company Profile",
    description: "Tell us about your business",
    icon: Building2,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
  },
  {
    id: "kyc_documents",
    title: "KYC Documents",
    description: "Upload identity & incorporation documents",
    icon: FileCheck,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
  },
  {
    id: "bank_account",
    title: "Bank Account",
    description: "Verify your payment account",
    icon: Landmark,
    color: "text-green-400",
    bg: "bg-green-400/10",
  },
  {
    id: "test_declaration",
    title: "Test Declaration",
    description: "Submit a guided sample declaration",
    icon: ClipboardList,
    color: "text-yellow-400",
    bg: "bg-yellow-400/10",
  },
  {
    id: "aeo_eligibility",
    title: "AEO Eligibility",
    description: "Check your Trusted Trader status",
    icon: Award,
    color: "text-orange-400",
    bg: "bg-orange-400/10",
  },
] as const;

type StepId = typeof STEPS[number]["id"];

// ─── PROGRESS BAR ────────────────────────────────────────────────────────────

function ProgressBar({ currentStep, completedSteps }: { currentStep: StepId; completedSteps: StepId[] }) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-6">
        {STEPS.map((step, idx) => {
          const isCompleted = completedSteps.includes(step.id);
          const isCurrent = step.id === currentStep;
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    isCompleted
                      ? "bg-green-500 border-green-500 text-white"
                      : isCurrent
                      ? `${step.bg} border-current ${step.color}`
                      : "bg-muted border-border text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className={`text-[10px] font-medium text-center leading-tight max-w-[60px] ${isCurrent ? "text-foreground" : "text-muted-foreground"}`}>
                  {step.title}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 ${isCompleted ? "bg-green-500" : "bg-border"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── STEP 1: COMPANY PROFILE ─────────────────────────────────────────────────

function CompanyProfileStep({ onNext, savedData }: { onNext: (data: Record<string, unknown>) => void; savedData?: Record<string, unknown> }) {
  const [form, setForm] = useState({
    companyName: (savedData?.companyName as string) ?? "",
    registrationNumber: (savedData?.registrationNumber as string) ?? "",
    country: (savedData?.country as string) ?? "KE",
    address: (savedData?.address as string) ?? "",
    city: (savedData?.city as string) ?? "",
    postalCode: (savedData?.postalCode as string) ?? "",
    industry: (savedData?.industry as string) ?? "manufacturing",
    annualTradeVolume: (savedData?.annualTradeVolume as string) ?? "100k_1m",
    website: (savedData?.website as string) ?? "",
    phone: (savedData?.phone as string) ?? "",
  });

  const isValid = form.companyName && form.registrationNumber && form.address && form.city && form.phone;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="companyName">Company Name *</Label>
          <Input id="companyName" value={form.companyName} onChange={e => setForm(f => ({ ...f, companyName: e.target.value }))} placeholder="Acme Trading Ltd" />
        </div>
        <div>
          <Label htmlFor="regNo">Registration Number *</Label>
          <Input id="regNo" value={form.registrationNumber} onChange={e => setForm(f => ({ ...f, registrationNumber: e.target.value }))} placeholder="CPR/2024/001234" />
        </div>
        <div>
          <Label htmlFor="country">Country *</Label>
          <Select value={form.country} onValueChange={v => setForm(f => ({ ...f, country: v }))}>
            <SelectTrigger id="country"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[["KE","Kenya"],["TZ","Tanzania"],["UG","Uganda"],["RW","Rwanda"],["ET","Ethiopia"],["GH","Ghana"],["NG","Nigeria"],["ZA","South Africa"]].map(([code, name]) => (
                <SelectItem key={code} value={code}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label htmlFor="address">Business Address *</Label>
          <Input id="address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="123 Commerce Street" />
        </div>
        <div>
          <Label htmlFor="city">City *</Label>
          <Input id="city" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="Nairobi" />
        </div>
        <div>
          <Label htmlFor="postalCode">Postal Code</Label>
          <Input id="postalCode" value={form.postalCode} onChange={e => setForm(f => ({ ...f, postalCode: e.target.value }))} placeholder="00100" />
        </div>
        <div>
          <Label htmlFor="industry">Industry Sector *</Label>
          <Select value={form.industry} onValueChange={v => setForm(f => ({ ...f, industry: v }))}>
            <SelectTrigger id="industry"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[["manufacturing","Manufacturing"],["agriculture","Agriculture"],["mining","Mining"],["textiles","Textiles"],["electronics","Electronics"],["chemicals","Chemicals"],["food_beverage","Food & Beverage"],["automotive","Automotive"],["pharmaceuticals","Pharmaceuticals"],["other","Other"]].map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="volume">Annual Trade Volume *</Label>
          <Select value={form.annualTradeVolume} onValueChange={v => setForm(f => ({ ...f, annualTradeVolume: v }))}>
            <SelectTrigger id="volume"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="under_100k">Under $100K</SelectItem>
              <SelectItem value="100k_1m">$100K – $1M</SelectItem>
              <SelectItem value="1m_10m">$1M – $10M</SelectItem>
              <SelectItem value="over_10m">Over $10M</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="phone">Phone Number *</Label>
          <Input id="phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+254 700 000000" />
        </div>
        <div>
          <Label htmlFor="website">Website (optional)</Label>
          <Input id="website" value={form.website} onChange={e => setForm(f => ({ ...f, website: e.target.value }))} placeholder="https://example.com" />
        </div>
      </div>
      <Button className="w-full" disabled={!isValid} onClick={() => onNext(form)}>
        Continue <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── STEP 2: KYC DOCUMENTS ───────────────────────────────────────────────────

type DocSlot = { label: string; docType: "certificate_of_incorporation" | "tax_certificate" | "national_id"; desc: string; urlKey: string; nameKey: string };
const DOC_SLOTS: DocSlot[] = [
  { label: "Certificate of Incorporation", docType: "certificate_of_incorporation", desc: "Official company registration document", urlKey: "incorporationCertUrl", nameKey: "incorporationCertName" },
  { label: "Tax Registration Certificate", docType: "tax_certificate", desc: "Government-issued tax ID certificate", urlKey: "taxIdCertUrl", nameKey: "taxIdCertName" },
  { label: "Director National ID", docType: "national_id", desc: "Passport or national ID of primary director", urlKey: "directorIdUrl", nameKey: "directorIdName" },
];

function KycDocumentsStep({ onNext, onBack, savedData }: { onNext: (data: Record<string, unknown>) => void; onBack: () => void; savedData?: Record<string, unknown> }) {
  const [form, setForm] = useState({
    taxId: (savedData?.taxId as string) ?? "",
    directorName: (savedData?.directorName as string) ?? "",
    incorporationCertUrl: (savedData?.incorporationCertUrl as string) ?? "",
    incorporationCertName: (savedData?.incorporationCertName as string) ?? "",
    taxIdCertUrl: (savedData?.taxIdCertUrl as string) ?? "",
    taxIdCertName: (savedData?.taxIdCertName as string) ?? "",
    directorIdUrl: (savedData?.directorIdUrl as string) ?? "",
    directorIdName: (savedData?.directorIdName as string) ?? "",
  });
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const uploadMutation = trpc.kyc.uploadDocument.useMutation();

  const handleFileSelect = async (slot: DocSlot, file: File) => {
    if (file.size > 20 * 1024 * 1024) { toast.error("File must be under 20 MB"); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf", "image/tiff"];
    if (!allowed.includes(file.type)) { toast.error("Unsupported file type"); return; }
    setUploading(u => ({ ...u, [slot.urlKey]: true }));
    try {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve((e.target?.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await uploadMutation.mutateAsync({
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "image/tiff",
        documentType: slot.docType,
        fileSize: file.size,
        fileData,
      });
      setForm(f => ({ ...f, [slot.urlKey]: result.fileUrl, [slot.nameKey]: file.name }));
      toast.success(`${slot.label} uploaded successfully`);
    } catch (err: unknown) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(u => ({ ...u, [slot.urlKey]: false }));
    }
  };

  const isValid = form.taxId && form.directorName;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {DOC_SLOTS.map(doc => {
          const uploaded = !!(form as Record<string, string>)[doc.urlKey];
          const isUploading = !!uploading[doc.urlKey];
          return (
            <div key={doc.urlKey} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card/50">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${uploaded ? "bg-green-500/10" : "bg-muted/30"}`}>
                {isUploading ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : uploaded ? <FileCheck className="h-5 w-5 text-green-400" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{doc.label}</p>
                <p className="text-xs text-muted-foreground">{doc.desc}</p>
                {uploaded && <p className="text-xs text-green-400 mt-0.5 truncate">{(form as Record<string, string>)[doc.nameKey]}</p>}
              </div>
              <label className="cursor-pointer">
                <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(doc, f); e.target.value = ""; }} disabled={isUploading} />
                <Badge variant="outline" className={`shrink-0 cursor-pointer ${uploaded ? "text-green-400 border-green-400/50" : "text-primary border-primary/50"}`}>
                  {uploaded ? <><CheckCircle2 className="h-3 w-3 mr-1" /> Uploaded</> : <><Upload className="h-3 w-3 mr-1" /> Upload</>}
                </Badge>
              </label>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="taxId">Tax Identification Number *</Label>
          <Input id="taxId" value={form.taxId} onChange={e => setForm(f => ({ ...f, taxId: e.target.value }))} placeholder="P051234567A" />
        </div>
        <div>
          <Label htmlFor="directorName">Primary Director Name *</Label>
          <Input id="directorName" value={form.directorName} onChange={e => setForm(f => ({ ...f, directorName: e.target.value }))} placeholder="John Kamau" />
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button className="flex-1" disabled={!isValid} onClick={() => onNext(form)}>
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── STEP 3: BANK ACCOUNT ────────────────────────────────────────────────────

function BankAccountStep({ onNext, onBack, savedData }: { onNext: (data: Record<string, unknown>) => void; onBack: () => void; savedData?: Record<string, unknown> }) {
  const [form, setForm] = useState({
    accountHolderName: (savedData?.accountHolderName as string) ?? "",
    accountNumber: (savedData?.accountNumber as string) ?? "",
    bankName: (savedData?.bankName as string) ?? "",
    bankCode: (savedData?.bankCode as string) ?? "",
    swiftBic: (savedData?.swiftBic as string) ?? "",
    currency: (savedData?.currency as string) ?? "KES",
    iban: (savedData?.iban as string) ?? "",
  });

  const isValid = form.accountHolderName && form.accountNumber && form.bankName && form.swiftBic;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="holderName">Account Holder Name *</Label>
          <Input id="holderName" value={form.accountHolderName} onChange={e => setForm(f => ({ ...f, accountHolderName: e.target.value }))} placeholder="Acme Trading Ltd" />
        </div>
        <div>
          <Label htmlFor="bankName">Bank Name *</Label>
          <Input id="bankName" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))} placeholder="Kenya Commercial Bank" />
        </div>
        <div>
          <Label htmlFor="bankCode">Bank Code</Label>
          <Input id="bankCode" value={form.bankCode} onChange={e => setForm(f => ({ ...f, bankCode: e.target.value }))} placeholder="01" />
        </div>
        <div>
          <Label htmlFor="accountNumber">Account Number *</Label>
          <Input id="accountNumber" value={form.accountNumber} onChange={e => setForm(f => ({ ...f, accountNumber: e.target.value }))} placeholder="1234567890" />
        </div>
        <div>
          <Label htmlFor="swiftBic">SWIFT / BIC Code *</Label>
          <Input id="swiftBic" value={form.swiftBic} onChange={e => setForm(f => ({ ...f, swiftBic: e.target.value }))} placeholder="KCBLKENX" />
        </div>
        <div>
          <Label htmlFor="currency">Account Currency *</Label>
          <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
            <SelectTrigger id="currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[["KES","KES — Kenyan Shilling"],["USD","USD — US Dollar"],["EUR","EUR — Euro"],["GBP","GBP — British Pound"],["TZS","TZS — Tanzanian Shilling"],["UGX","UGX — Ugandan Shilling"]].map(([v,l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="iban">IBAN (optional)</Label>
          <Input id="iban" value={form.iban} onChange={e => setForm(f => ({ ...f, iban: e.target.value }))} placeholder="GB29 NWBK 6016 1331 9268 19" />
        </div>
      </div>
      <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400 flex gap-2">
        <Shield className="h-4 w-4 shrink-0 mt-0.5" />
        <p>Bank account details are encrypted at rest and used only for duty payment processing via Mojaloop.</p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button className="flex-1" disabled={!isValid} onClick={() => onNext(form)}>
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── STEP 4: TEST DECLARATION ────────────────────────────────────────────────

function TestDeclarationStep({ onNext, onBack }: { onNext: (data: Record<string, unknown>) => void; onBack: () => void }) {
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const sampleDeclaration = {
    declarationNumber: `URN-DEMO-${Date.now().toString().slice(-6)}`,
    hsCode: "8471.30",
    goodsDescription: "Laptop computers — personal use, 10 units",
    countryOfOrigin: "CN",
    invoiceValue: 8500.00,
    currency: "USD",
    grossWeight: 35.0,
    numberOfPackages: 2,
    submittedAt: new Date().toISOString(),
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await new Promise(r => setTimeout(r, 1500)); // Simulate processing
    setSubmitted(true);
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm text-yellow-400 flex gap-2">
        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>This is a guided test declaration with pre-filled data. No duties will be charged. It demonstrates the declaration workflow.</p>
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-yellow-400" />
          Sample Import Declaration
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          {[
            ["Declaration No.", sampleDeclaration.declarationNumber],
            ["HS Code", sampleDeclaration.hsCode],
            ["Country of Origin", "China (CN)"],
            ["Invoice Value", `USD ${sampleDeclaration.invoiceValue.toLocaleString()}`],
            ["Gross Weight", `${sampleDeclaration.grossWeight} kg`],
            ["Packages", `${sampleDeclaration.numberOfPackages} cartons`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground">{label}</span>
              <span className="font-medium font-mono">{value}</span>
            </div>
          ))}
          <div className="col-span-2 flex flex-col gap-0.5">
            <span className="text-muted-foreground">Goods Description</span>
            <span className="font-medium">{sampleDeclaration.goodsDescription}</span>
          </div>
        </div>
      </div>

      {submitted ? (
        <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-4 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 text-green-400 mx-auto" />
          <p className="text-sm font-semibold text-green-400">Declaration Submitted Successfully!</p>
          <p className="text-xs text-muted-foreground">Reference: <span className="font-mono">{sampleDeclaration.declarationNumber}</span></p>
          <p className="text-xs text-muted-foreground">Risk Assessment: <span className="text-green-400 font-medium">GREEN LANE</span> — Auto-cleared</p>
        </div>
      ) : (
        <Button className="w-full" onClick={handleSubmit} disabled={isSubmitting}>
          {isSubmitting ? (
            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processing...</>
          ) : (
            <><ClipboardList className="mr-2 h-4 w-4" /> Submit Test Declaration</>
          )}
        </Button>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button className="flex-1" disabled={!submitted} onClick={() => onNext(sampleDeclaration as unknown as Record<string, unknown>)}>
          Continue <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── STEP 5: AEO ELIGIBILITY ─────────────────────────────────────────────────

function AeoEligibilityStep({
  onComplete, onBack, companyData,
}: {
  onComplete: (data: Record<string, unknown>) => void;
  onBack: () => void;
  companyData?: Record<string, unknown>;
}) {
  const [checked, setChecked] = useState(false);
  const [result, setResult] = useState<{ tier: string; score: number; factors: string[] } | null>(null);

  const calcMutation = trpc.onboarding.calculateAeoEligibility.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setChecked(true);
    },
  });

  const handleCheck = () => {
    calcMutation.mutate({
      companyName: (companyData?.companyName as string) ?? "Demo Company",
      registrationNumber: (companyData?.registrationNumber as string) ?? "REG001",
      country: (companyData?.country as string) ?? "KE",
      address: (companyData?.address as string) ?? "123 Main St",
      city: (companyData?.city as string) ?? "Nairobi",
      postalCode: (companyData?.postalCode as string) ?? "00100",
      industry: (companyData?.industry as "manufacturing") ?? "manufacturing",
      annualTradeVolume: (companyData?.annualTradeVolume as "100k_1m") ?? "100k_1m",
      phone: (companyData?.phone as string) ?? "+254700000000",
      website: (companyData?.website as string | undefined),
    });
  };

  const TIER_COLORS: Record<string, string> = {
    gold: "text-yellow-400 border-yellow-400/50",
    silver: "text-slate-300 border-slate-300/50",
    standard: "text-blue-400 border-blue-400/50",
    not_eligible: "text-red-400 border-red-400/50",
  };

  const TIER_LABELS: Record<string, string> = {
    gold: "AEO Gold — Premium Trusted Trader",
    silver: "AEO Silver — Trusted Trader",
    standard: "AEO Standard — Authorised Trader",
    not_eligible: "Not Yet Eligible — Build your trade history",
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-orange-500/10 border border-orange-500/20 p-3 text-sm text-orange-400 flex gap-2">
        <Sparkles className="h-4 w-4 shrink-0 mt-0.5" />
        <p>AEO (Authorised Economic Operator) status grants expedited clearance, reduced inspections, and priority processing under the WCO SAFE Framework.</p>
      </div>

      {!checked ? (
        <div className="text-center py-6 space-y-4">
          <Award className="h-16 w-16 text-orange-400 mx-auto opacity-60" />
          <div>
            <p className="font-medium">Ready to check your AEO eligibility?</p>
            <p className="text-sm text-muted-foreground mt-1">We'll analyse your company profile and trade history to determine your Trusted Trader tier.</p>
          </div>
          <Button onClick={handleCheck} disabled={calcMutation.isPending} className="mx-auto">
            {calcMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analysing...</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Run Eligibility Check</>
            )}
          </Button>
        </div>
      ) : result ? (
        <div className="space-y-4">
          <div className={`rounded-lg border p-4 text-center ${TIER_COLORS[result.tier]?.split(" ")[1] ? `border-${TIER_COLORS[result.tier].split(" ")[1]}` : "border-border"}`}>
            <Award className={`h-10 w-10 mx-auto mb-2 ${TIER_COLORS[result.tier]?.split(" ")[0] ?? "text-muted-foreground"}`} />
            <p className={`text-lg font-bold ${TIER_COLORS[result.tier]?.split(" ")[0] ?? "text-foreground"}`}>
              {TIER_LABELS[result.tier] ?? result.tier}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Eligibility Score: <span className="font-bold text-foreground">{result.score}/100</span></p>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Scoring Factors:</p>
            {result.factors.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0" />
                <span>{f}</span>
              </div>
            ))}
          </div>
          {result.tier !== "not_eligible" && (
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-xs text-green-400">
              You qualify for AEO {result.tier} status. A formal application can be submitted from your Trusted Trader dashboard after onboarding.
            </div>
          )}
        </div>
      ) : null}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onBack}>
          <ChevronLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button className="flex-1" disabled={!checked} onClick={() => onComplete(result ?? {})}>
          Complete Onboarding <CheckCircle2 className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── COMPLETION SCREEN ───────────────────────────────────────────────────────

function CompletionScreen({ onGoToDashboard }: { onGoToDashboard: () => void }) {
  return (
    <div className="text-center py-8 space-y-6">
      <div className="relative inline-block">
        <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
          <CheckCircle2 className="h-12 w-12 text-green-400" />
        </div>
        <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-yellow-400 flex items-center justify-center">
          <Sparkles className="h-4 w-4 text-yellow-900" />
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-bold">Welcome to TradeGateway!</h2>
        <p className="text-muted-foreground mt-2 max-w-md mx-auto">
          Your account is fully set up. You can now submit declarations, track shipments, and manage your trade operations.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto text-center">
        {[
          { icon: ClipboardList, label: "Submit Declarations", color: "text-blue-400" },
          { icon: Building2, label: "Manage Profile", color: "text-purple-400" },
          { icon: Award, label: "Apply for AEO", color: "text-yellow-400" },
        ].map(item => (
          <div key={item.label} className="flex flex-col items-center gap-2 p-3 rounded-lg bg-card/50 border border-border">
            <item.icon className={`h-6 w-6 ${item.color}`} />
            <span className="text-xs text-muted-foreground">{item.label}</span>
          </div>
        ))}
      </div>
      <Button size="lg" onClick={onGoToDashboard} className="mx-auto">
        Go to My Dashboard <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

// ─── ROLE DEFINITIONS ────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  {
    value: "user" as const,
    label: "Trader / Importer / Exporter",
    description: "Submit declarations, manage shipments, apply for AEO status",
    icon: Building2,
    color: "text-blue-400",
    bg: "bg-blue-400/10",
    border: "border-blue-400/30",
    portal: "/app/trader",
  },
  {
    value: "customs_officer" as const,
    label: "Customs Officer",
    description: "Review declarations, assign risk lanes, issue clearances",
    icon: Shield,
    color: "text-amber-400",
    bg: "bg-amber-400/10",
    border: "border-amber-400/30",
    portal: "/app/customs",
  },
  {
    value: "oga_officer" as const,
    label: "Other Government Agency (OGA) Officer",
    description: "Review and approve permits, licences, and certificates",
    icon: ClipboardList,
    color: "text-purple-400",
    bg: "bg-purple-400/10",
    border: "border-purple-400/30",
    portal: "/app/oga",
  },
  {
    value: "inspector" as const,
    label: "Port Inspector",
    description: "Conduct physical inspections, manage cargo tracking",
    icon: FileCheck,
    color: "text-green-400",
    bg: "bg-green-400/10",
    border: "border-green-400/30",
    portal: "/app/geo/heatmap",
  },
  {
    value: "finance" as const,
    label: "Finance / Revenue Officer",
    description: "Monitor duty revenue, manage payments and drawbacks",
    icon: Landmark,
    color: "text-emerald-400",
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/30",
    portal: "/app/finance",
  },
] as const;

type SelfAssignableRole = typeof ROLE_OPTIONS[number]["value"];

// ─── ROLE SELECTION STEP ──────────────────────────────────────────────────────

function RoleSelectionStep({ onSelect }: { onSelect: (role: SelfAssignableRole) => void }) {
  const [selected, setSelected] = useState<SelfAssignableRole | null>(null);
  const selectRoleMutation = trpc.onboarding.selectRole.useMutation();

  const handleConfirm = async () => {
    if (!selected) return;
    try {
      await selectRoleMutation.mutateAsync({ role: selected });
    } catch {
      // Ignore DB errors
    }
    onSelect(selected);
  };

  return (
    <div className="space-y-4">
      <div className="text-center space-y-1 pb-2">
        <h2 className="text-lg font-semibold">What is your role?</h2>
        <p className="text-muted-foreground text-sm">Select your role to be directed to the right portal and setup flow.</p>
      </div>
      <div className="grid gap-3">
        {ROLE_OPTIONS.map(role => {
          const Icon = role.icon;
          const isSelected = selected === role.value;
          return (
            <button
              key={role.value}
              onClick={() => setSelected(role.value)}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
                isSelected
                  ? `${role.bg} ${role.border} ring-1 ring-offset-0`
                  : "border-border hover:border-muted-foreground/50 bg-card"
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-lg ${role.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                  <Icon className={`h-5 w-5 ${role.color}`} />
                </div>
                <div className="min-w-0">
                  <p className={`font-medium text-sm ${isSelected ? role.color : "text-foreground"}`}>{role.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>
                </div>
                {isSelected && <CheckCircle2 className={`h-5 w-5 ${role.color} ml-auto shrink-0 mt-0.5`} />}
              </div>
            </button>
          );
        })}
      </div>
      <Button
        className="w-full"
        disabled={!selected || selectRoleMutation.isPending}
        onClick={handleConfirm}
      >
        {selectRoleMutation.isPending ? (
          <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</>
        ) : (
          <>Continue <ArrowRight className="h-4 w-4 ml-2" /></>
        )}
      </Button>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function TraderOnboarding() {
  const [, navigate] = useLocation();
  const { user } = useAuth();

  // Sprint 80: role-selection gate before the 5-step wizard
  const [roleSelected, setRoleSelected] = useState<SelfAssignableRole | null>(
    user?.role && user.role !== "user" ? (user.role as SelfAssignableRole) : null
  );

  const [currentStep, setCurrentStep] = useState<StepId>("company_profile");
  const [completedSteps, setCompletedSteps] = useState<StepId[]>([]);
  const [stepData, setStepData] = useState<Record<string, Record<string, unknown>>>({});
  const [isComplete, setIsComplete] = useState(false);

  const { data: progress } = trpc.onboarding.getProgress.useQuery();
  const saveStepMutation = trpc.onboarding.saveStep.useMutation();

  // Restore progress on mount
  useEffect(() => {
    if (progress?.exists) {
      setCurrentStep(progress.currentStep as StepId);
      setCompletedSteps(progress.completedSteps as StepId[]);
      if (progress.overallStatus === "completed") setIsComplete(true);
    }
  }, [progress]);

  const handleStepComplete = async (step: StepId, data: Record<string, unknown>) => {
    const newCompleted = completedSteps.includes(step)
      ? completedSteps
      : [...completedSteps, step];
    setCompletedSteps(newCompleted);
    setStepData(prev => ({ ...prev, [step]: data }));

    const stepIdx = (["company_profile","kyc_documents","bank_account","test_declaration","aeo_eligibility"] as StepId[]).indexOf(step);
    const isLast = stepIdx === 4;

    try {
      await saveStepMutation.mutateAsync({ step, data });
    } catch {
      // Ignore DB errors in sandbox
    }

    if (isLast) {
      setIsComplete(true);
      toast.success("Onboarding Complete!", { description: "Your account is now fully set up." });
    } else {
      const nextSteps: StepId[] = ["company_profile","kyc_documents","bank_account","test_declaration","aeo_eligibility"];
      setCurrentStep(nextSteps[stepIdx + 1]);
    }
  };

  const handleBack = () => {
    const steps: StepId[] = ["company_profile","kyc_documents","bank_account","test_declaration","aeo_eligibility"];
    const idx = steps.indexOf(currentStep);
    if (idx > 0) setCurrentStep(steps[idx - 1]);
  };

  // Sprint 80: role-selection gate — show before the wizard if role not yet chosen
  if (!roleSelected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-2xl space-y-4">
          <div className="text-center space-y-1">
            <h1 className="text-2xl font-bold">Welcome to TradeGateway™</h1>
            <p className="text-muted-foreground text-sm">Let’s get you set up in the right portal</p>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base">Step 0 of 6 — Role Selection</CardTitle>
                  <CardDescription>Choose your role to unlock the right features</CardDescription>
                </div>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4">
              <RoleSelectionStep
                onSelect={(role) => {
                  setRoleSelected(role);
                  // Non-trader roles skip the 5-step wizard and go straight to their portal
                  if (role !== "user") {
                    const portal = ROLE_OPTIONS.find(r => r.value === role)?.portal ?? "/app/trader";
                    toast.success("Role confirmed!", { description: `Redirecting you to the ${role.replace("_", " ")} portal.` });
                    setTimeout(() => navigate(portal), 1200);
                  }
                }}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="pt-6">
            <CompletionScreen onGoToDashboard={() => navigate("/app/trader")} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const currentStepDef = STEPS.find(s => s.id === currentStep)!

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold">Welcome to TradeGateway™</h1>
          <p className="text-muted-foreground text-sm">Complete your account setup to start trading</p>
        </div>

        {/* Progress */}
        <ProgressBar currentStep={currentStep} completedSteps={completedSteps} />

        {/* Step Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${currentStepDef.bg} flex items-center justify-center`}>
                <currentStepDef.icon className={`h-5 w-5 ${currentStepDef.color}`} />
              </div>
              <div>
                <CardTitle className="text-base">{currentStepDef.title}</CardTitle>
                <CardDescription>{currentStepDef.description}</CardDescription>
              </div>
              <Badge variant="outline" className="ml-auto text-xs">
                Step {STEPS.findIndex(s => s.id === currentStep) + 1} of {STEPS.length}
              </Badge>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4">
            {currentStep === "company_profile" && (
              <CompanyProfileStep
                onNext={d => handleStepComplete("company_profile", d)}
                savedData={stepData.company_profile}
              />
            )}
            {currentStep === "kyc_documents" && (
              <KycDocumentsStep
                onNext={d => handleStepComplete("kyc_documents", d)}
                onBack={handleBack}
                savedData={stepData.kyc_documents}
              />
            )}
            {currentStep === "bank_account" && (
              <BankAccountStep
                onNext={d => handleStepComplete("bank_account", d)}
                onBack={handleBack}
                savedData={stepData.bank_account}
              />
            )}
            {currentStep === "test_declaration" && (
              <TestDeclarationStep
                onNext={d => handleStepComplete("test_declaration", d)}
                onBack={handleBack}
              />
            )}
            {currentStep === "aeo_eligibility" && (
              <AeoEligibilityStep
                onComplete={d => handleStepComplete("aeo_eligibility", d)}
                onBack={handleBack}
                companyData={stepData.company_profile}
              />
            )}
          </CardContent>
        </Card>

        {/* Skip link */}
        <div className="text-center">
          <button
            onClick={() => navigate("/app/trader")}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Skip for now — complete later from your profile
          </button>
        </div>
      </div>
    </div>
  );
}
