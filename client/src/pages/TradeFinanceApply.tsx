/**
 * TradeFinanceApply.tsx — WP-6 trade-finance application wizard.
 * Four standardized products (CamelONE starter catalogue), wired to the
 * financial-controls rail through the signed fail-closed API.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Landmark, ArrowRight, ArrowLeft, Loader2, CheckCircle } from "lucide-react";

const PRODUCTS = [
  { value: "IMPORT_LC_FACILITATION", label: "Import LC Facilitation" },
  { value: "EXPORT_PRESHIPMENT_FINANCE", label: "Export Pre-shipment Finance" },
  { value: "INVOICE_RECEIVABLES_FINANCE", label: "Invoice / Receivables Finance" },
  { value: "DUTY_DEFERRAL_GUARANTEE", label: "Duty Deferral Guarantee" },
] as const;

export default function TradeFinanceApply() {
  const [step, setStep] = useState(0);
  const [product, setProduct] = useState<string>("");
  const [applicationId, setApplicationId] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [bankId, setBankId] = useState("");
  const [consentId, setConsentId] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [officers, setOfficers] = useState({ kycOfficer: "", creditOfficer: "", customsOfficer: "", treasuryOfficer: "" });

  const applyMutation = trpc.tradeFinance.financeApply.useMutation({
    onSuccess: () => { toast.success("Application submitted"); setStep(3); },
    onError: (err) => toast.error(err.message),
  });

  const amountMinor = Math.round(parseFloat(amountMajor || "0") * 100);

  const steps = ["Product", "Facility", "Approvers", "Done"];

  return (
    <div className="min-h-screen bg-[#0A1628] text-slate-100 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Landmark className="w-7 h-7 text-[#D4A017]" />
        <div>
          <h1 className="text-2xl font-bold">Trade Finance Application</h1>
          <p className="text-slate-400 text-sm">Multi-bank standardized products — consent-gated financing (NTP TFC model).</p>
        </div>
      </div>

      <div className="flex gap-2">
        {steps.map((label, index) => (
          <div key={label} className={`px-3 py-1 rounded text-sm ${index === step ? "bg-[#D4A017] text-[#0A1628]" : "bg-slate-800 text-slate-400"}`}>{label}</div>
        ))}
      </div>

      <Card className="bg-slate-900/60 border-slate-700 max-w-3xl">
        <CardHeader><CardTitle>{steps[step]}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {step === 0 && (
            <>
              <Label>Standardized product</Label>
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger className="bg-slate-950 border-slate-700"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {PRODUCTS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={() => setStep(1)} disabled={!product} className="bg-[#D4A017] text-[#0A1628]">Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
            </>
          )}
          {step === 1 && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Application ID</Label><Input value={applicationId} onChange={(e) => setApplicationId(e.target.value)} placeholder="tf-app-001" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>External reference</Label><Input value={externalRef} onChange={(e) => setExternalRef(e.target.value)} placeholder="PO-2026-0001" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Bank</Label><Input value={bankId} onChange={(e) => setBankId(e.target.value)} placeholder="bank-gtb" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Active consent ID</Label><Input value={consentId} onChange={(e) => setConsentId(e.target.value)} placeholder="tf-con-001" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Amount (major units)</Label><Input type="number" min="0" value={amountMajor} onChange={(e) => setAmountMajor(e.target.value)} className="bg-slate-950 border-slate-700" /></div>
                <div>
                  <Label>Currency</Label>
                  <Select value={currency} onValueChange={(v) => setCurrency(v as "NGN" | "USD")}>
                    <SelectTrigger className="bg-slate-950 border-slate-700"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="NGN">NGN</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                <Button onClick={() => setStep(2)} disabled={!applicationId || !externalRef || !bankId || !consentId || amountMinor <= 0} className="bg-[#D4A017] text-[#0A1628]">Next <ArrowRight className="w-4 h-4 ml-1" /></Button>
              </div>
            </>
          )}
          {step === 2 && (
            <>
              <p className="text-slate-400 text-sm">Assign the four approval parties (strict separation of duties; you are the trader party).</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><Label>Bank KYC officer</Label><Input value={officers.kycOfficer} onChange={(e) => setOfficers({ ...officers, kycOfficer: e.target.value })} className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Bank credit officer</Label><Input value={officers.creditOfficer} onChange={(e) => setOfficers({ ...officers, creditOfficer: e.target.value })} className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Customs compliance officer</Label><Input value={officers.customsOfficer} onChange={(e) => setOfficers({ ...officers, customsOfficer: e.target.value })} className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Bank treasury officer</Label><Input value={officers.treasuryOfficer} onChange={(e) => setOfficers({ ...officers, treasuryOfficer: e.target.value })} className="bg-slate-950 border-slate-700" /></div>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
                <Button
                  disabled={applyMutation.isPending || Object.values(officers).some((v) => !v)}
                  onClick={() => applyMutation.mutate({
                    applicationId, externalRef, bankId, consentId,
                    product: product as any, amountMinor, currency, assignments: officers,
                  })}
                  className="bg-[#D4A017] text-[#0A1628]">
                  {applyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit application"}
                </Button>
              </div>
            </>
          )}
          {step === 3 && (
            <div className="flex items-center gap-3 text-emerald-400">
              <CheckCircle className="w-6 h-6" />
              <div>
                <p className="font-semibold">Application {applicationId} submitted.</p>
                <p className="text-slate-400 text-sm">Track it on the status page; the bank sees only your consented datasets.</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
