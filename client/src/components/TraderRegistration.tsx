/**
 * TradeGateway NGSWTP — Trader Self-Registration Wizard
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * 4-step onboarding wizard:
 * 1. Company Details (name, TIN, type, country)
 * 2. Document Upload (TIN cert, business reg, director IDs)
 * 3. AEO Eligibility Check (compliance history, trade volume, security measures)
 * 4. Keycloak Account Creation (username, password, MFA setup)
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, FileText, ShieldCheck, UserPlus,
  CheckCircle2, AlertCircle, Upload, Eye, EyeOff,
  ChevronRight, ChevronLeft, Loader2, Star
} from "lucide-react";

interface CompanyDetails {
  company_name: string;
  tin: string;
  trader_type: string;
  country: string;
  address: string;
  contact_email: string;
  contact_phone: string;
  annual_trade_volume_usd: string;
}

interface DocumentUpload {
  tin_certificate: boolean;
  business_registration: boolean;
  director_id: boolean;
  audited_accounts: boolean;
  customs_bond: boolean;
}

interface AEOEligibility {
  years_in_business: string;
  customs_violations_5yr: string;
  security_officer: boolean;
  cctv_warehouse: boolean;
  iso_certified: boolean;
  edi_capable: boolean;
  trade_volume_annual: string;
}

interface AccountDetails {
  username: string;
  password: string;
  confirm_password: string;
  mfa_method: string;
  agreed_terms: boolean;
}

const STEPS = [
  { id: 1, label: "Company Details", icon: Building2, description: "Business registration information" },
  { id: 2, label: "Documents", icon: FileText, description: "Upload required certificates" },
  { id: 3, label: "AEO Eligibility", icon: ShieldCheck, description: "Authorised Economic Operator check" },
  { id: 4, label: "Create Account", icon: UserPlus, description: "Keycloak identity provisioning" },
];

const TRADER_TYPES = [
  "Importer", "Exporter", "Import/Export", "Freight Forwarder",
  "Customs Broker", "Shipping Agent", "Warehouse Operator", "Manufacturer",
];

const COUNTRIES = [
  "Kenya", "Uganda", "Tanzania", "Rwanda", "Ethiopia", "Ghana",
  "Nigeria", "South Africa", "Egypt", "Morocco", "Senegal", "Other",
];

function computeAEOScore(aeo: AEOEligibility): { score: number; tier: string; color: string } {
  let score = 0;
  const years = parseInt(aeo.years_in_business) || 0;
  const violations = parseInt(aeo.customs_violations_5yr) || 0;
  const volume = parseInt(aeo.trade_volume_annual) || 0;

  if (years >= 5) score += 20;
  else if (years >= 2) score += 10;
  if (violations === 0) score += 25;
  else if (violations <= 2) score += 10;
  if (aeo.security_officer) score += 15;
  if (aeo.cctv_warehouse) score += 10;
  if (aeo.iso_certified) score += 15;
  if (aeo.edi_capable) score += 10;
  if (volume >= 1000000) score += 5;

  const tier = score >= 80 ? "AEO-F (Full)" : score >= 60 ? "AEO-C (Customs)" : score >= 40 ? "AEO-S (Security)" : "Standard";
  const color = score >= 80 ? "text-emerald-400" : score >= 60 ? "text-blue-400" : score >= 40 ? "text-amber-400" : "text-slate-400";
  return { score, tier, color };
}

export default function TraderRegistration() {
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [registrationResult, setRegistrationResult] = useState<{ urn: string; keycloak_id: string } | null>(null);

  const [company, setCompany] = useState<CompanyDetails>({
    company_name: "", tin: "", trader_type: "Importer", country: "Kenya",
    address: "", contact_email: "", contact_phone: "", annual_trade_volume_usd: "",
  });

  const [docs, setDocs] = useState<DocumentUpload>({
    tin_certificate: false, business_registration: false, director_id: false,
    audited_accounts: false, customs_bond: false,
  });

  const [aeo, setAEO] = useState<AEOEligibility>({
    years_in_business: "", customs_violations_5yr: "0", security_officer: false,
    cctv_warehouse: false, iso_certified: false, edi_capable: false, trade_volume_annual: "",
  });

  const [account, setAccount] = useState<AccountDetails>({
    username: "", password: "", confirm_password: "", mfa_method: "TOTP", agreed_terms: false,
  });

  const aeoResult = computeAEOScore(aeo);

  const canProceed = () => {
    if (step === 1) return company.company_name && company.tin && company.contact_email;
    if (step === 2) return docs.tin_certificate && docs.business_registration && docs.director_id;
    if (step === 3) return aeo.years_in_business !== "";
    if (step === 4) return account.username && account.password && account.password === account.confirm_password && account.agreed_terms;
    return false;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    await new Promise((r) => setTimeout(r, 2800));
    setRegistrationResult({
      urn: `TRD-${Date.now().toString(36).toUpperCase()}`,
      keycloak_id: `kc-${Math.random().toString(36).slice(2, 10)}`,
    });
    setIsSubmitting(false);
    setIsComplete(true);
  };

  if (isComplete && registrationResult) {
    return (
      <section id="trader-registration" className="py-20 bg-[#0A1628]">
        <div className="container max-w-2xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#060F1E] border border-emerald-500/30 rounded-2xl p-10 text-center"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <h2 className="font-['Playfair_Display'] text-3xl font-bold text-white mb-3">Registration Complete</h2>
            <p className="text-slate-400 mb-8">Your trader account has been provisioned in Keycloak and your application is under review.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
              <div className="bg-slate-800/40 rounded-xl p-4 text-left">
                <div className="text-xs text-slate-500 mb-1">Trader URN</div>
                <div className="font-mono text-[#D4A017] font-bold text-sm">{registrationResult.urn}</div>
              </div>
              <div className="bg-slate-800/40 rounded-xl p-4 text-left">
                <div className="text-xs text-slate-500 mb-1">Keycloak ID</div>
                <div className="font-mono text-blue-400 font-bold text-sm">{registrationResult.keycloak_id}</div>
              </div>
              <div className="bg-slate-800/40 rounded-xl p-4 text-left">
                <div className="text-xs text-slate-500 mb-1">AEO Tier Assigned</div>
                <div className={`font-bold text-sm ${aeoResult.color}`}>{aeoResult.tier}</div>
              </div>
              <div className="bg-slate-800/40 rounded-xl p-4 text-left">
                <div className="text-xs text-slate-500 mb-1">MFA Method</div>
                <div className="text-white font-bold text-sm">{account.mfa_method}</div>
              </div>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-left mb-6">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-300">
                  A verification email has been sent to <strong>{company.contact_email}</strong>. Your account will be activated within 2 business days after document verification.
                </div>
              </div>
            </div>
            <button
              onClick={() => { setIsComplete(false); setStep(1); setRegistrationResult(null); }}
              className="px-6 py-2.5 rounded-xl bg-[#D4A017]/20 border border-[#D4A017]/40 text-[#D4A017] text-sm font-medium hover:bg-[#D4A017]/30 transition-colors"
            >
              Register Another Trader
            </button>
          </motion.div>
        </div>
      </section>
    );
  }

  return (
    <section id="trader-registration" className="py-20 bg-[#0A1628]">
      <div className="container max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#D4A017]/10 border border-[#D4A017]/20 text-[#D4A017] text-xs font-medium mb-4">
            <UserPlus className="w-3.5 h-3.5" />
            Trader Self-Registration
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Onboard to <span className="text-[#D4A017]">TradeGateway</span>
          </h2>
          <p className="text-slate-400 max-w-xl mx-auto">
            Complete the 4-step registration to receive your Trader URN, Keycloak identity, and AEO eligibility assessment.
          </p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center mb-10 overflow-x-auto pb-2">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = step === s.id;
            const isDone = step > s.id;
            return (
              <div key={s.id} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                    isDone ? "bg-[#D4A017] border-[#D4A017]" :
                    isActive ? "bg-[#D4A017]/20 border-[#D4A017]" :
                    "bg-slate-800/60 border-white/10"
                  }`}>
                    {isDone ? (
                      <CheckCircle2 className="w-5 h-5 text-[#0A1628]" />
                    ) : (
                      <Icon className={`w-4 h-4 ${isActive ? "text-[#D4A017]" : "text-slate-500"}`} />
                    )}
                  </div>
                  <div className={`text-[10px] mt-1.5 font-medium hidden sm:block ${isActive ? "text-[#D4A017]" : isDone ? "text-slate-400" : "text-slate-600"}`}>
                    {s.label}
                  </div>
                </div>
                {idx < STEPS.length - 1 && (
                  <div className={`w-12 sm:w-20 h-0.5 mx-2 transition-colors ${step > s.id ? "bg-[#D4A017]" : "bg-white/10"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Form card */}
        <div className="bg-[#060F1E] border border-white/10 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 bg-white/2">
            <div className="flex items-center gap-3">
              {(() => { const Icon = STEPS[step - 1].icon; return <Icon className="w-5 h-5 text-[#D4A017]" />; })()}
              <div>
                <div className="text-white font-semibold text-sm">{STEPS[step - 1].label}</div>
                <div className="text-slate-500 text-xs">{STEPS[step - 1].description}</div>
              </div>
              <div className="ml-auto text-xs text-slate-600">Step {step} of 4</div>
            </div>
          </div>

          <div className="p-6">
            <AnimatePresence mode="wait">
              {/* STEP 1 — Company Details */}
              {step === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { label: "Company Name *", key: "company_name", placeholder: "Acme Imports Ltd" },
                      { label: "Tax Identification Number (TIN) *", key: "tin", placeholder: "P051234567A" },
                      { label: "Contact Email *", key: "contact_email", placeholder: "trade@company.com" },
                      { label: "Contact Phone", key: "contact_phone", placeholder: "+254 700 000 000" },
                      { label: "Physical Address", key: "address", placeholder: "123 Trade Street, Nairobi" },
                      { label: "Annual Trade Volume (USD)", key: "annual_trade_volume_usd", placeholder: "500000" },
                    ].map(({ label, key, placeholder }) => (
                      <div key={key}>
                        <label className="block text-xs text-slate-400 mb-1.5">{label}</label>
                        <input
                          type="text"
                          value={(company as unknown as Record<string, string>)[key]}
                          onChange={(e) => setCompany({ ...company, [key]: e.target.value })}
                          placeholder={placeholder}
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-[#D4A017]/50 transition-colors"
                        />
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Trader Type</label>
                      <select
                        value={company.trader_type}
                        onChange={(e) => setCompany({ ...company, trader_type: e.target.value })}
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                      >
                        {TRADER_TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Country of Registration</label>
                      <select
                        value={company.country}
                        onChange={(e) => setCompany({ ...company, country: e.target.value })}
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                      >
                        {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 2 — Document Upload */}
              {step === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <p className="text-slate-400 text-sm mb-6">Upload the required documents. Minimum: TIN Certificate, Business Registration, and Director ID.</p>
                  <div className="space-y-3">
                    {[
                      { key: "tin_certificate", label: "TIN Certificate", required: true, desc: "Issued by Revenue Authority" },
                      { key: "business_registration", label: "Business Registration Certificate", required: true, desc: "Company registry certificate" },
                      { key: "director_id", label: "Director National ID / Passport", required: true, desc: "For all directors" },
                      { key: "audited_accounts", label: "Audited Financial Accounts (last 2 years)", required: false, desc: "Required for AEO-F tier" },
                      { key: "customs_bond", label: "Customs Bond / Guarantee", required: false, desc: "Required for duty deferment" },
                    ].map(({ key, label, required, desc }) => {
                      const uploaded = (docs as unknown as Record<string, boolean>)[key];
                      return (
                        <div
                          key={key}
                          onClick={() => setDocs({ ...docs, [key]: !uploaded })}
                          className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
                            uploaded ? "border-emerald-500/40 bg-emerald-500/5" : "border-white/10 bg-slate-800/30 hover:border-white/20"
                          }`}
                        >
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${uploaded ? "bg-emerald-500/20" : "bg-slate-700/60"}`}>
                            {uploaded ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Upload className="w-5 h-5 text-slate-500" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-white font-medium">{label}</span>
                              {required && <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Required</span>}
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
                          </div>
                          <div className="text-xs text-slate-500">{uploaded ? "✓ Uploaded" : "Click to upload"}</div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* STEP 3 — AEO Eligibility */}
              {step === 3 && (
                <motion.div key="step3" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Years in Business *</label>
                        <input
                          type="number" min="0"
                          value={aeo.years_in_business}
                          onChange={(e) => setAEO({ ...aeo, years_in_business: e.target.value })}
                          placeholder="e.g. 7"
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Customs Violations (last 5 years)</label>
                        <input
                          type="number" min="0"
                          value={aeo.customs_violations_5yr}
                          onChange={(e) => setAEO({ ...aeo, customs_violations_5yr: e.target.value })}
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1.5">Annual Trade Volume (USD)</label>
                        <input
                          type="number" min="0"
                          value={aeo.trade_volume_annual}
                          onChange={(e) => setAEO({ ...aeo, trade_volume_annual: e.target.value })}
                          placeholder="e.g. 2000000"
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                        />
                      </div>
                      <div className="space-y-2.5">
                        {[
                          { key: "security_officer", label: "Dedicated Security Officer" },
                          { key: "cctv_warehouse", label: "CCTV-monitored Warehouse" },
                          { key: "iso_certified", label: "ISO 9001 / ISO 28000 Certified" },
                          { key: "edi_capable", label: "EDI / API Integration Capable" },
                        ].map(({ key, label }) => (
                          <label key={key} className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(aeo as unknown as Record<string, boolean>)[key]}
                              onChange={(e) => setAEO({ ...aeo, [key]: e.target.checked } as AEOEligibility)}
                              className="w-4 h-4 rounded border-white/20 bg-slate-800 accent-[#D4A017]"
                            />
                            <span className="text-sm text-slate-300">{label}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* AEO Score Card */}
                    <div className="bg-slate-800/30 border border-white/10 rounded-xl p-5 flex flex-col items-center justify-center text-center">
                      <div className="text-xs text-slate-500 mb-2 uppercase tracking-widest">AEO Score</div>
                      <div className={`text-6xl font-bold font-['Playfair_Display'] mb-2 ${aeoResult.color}`}>
                        {aeoResult.score}
                      </div>
                      <div className={`text-sm font-semibold mb-4 ${aeoResult.color}`}>{aeoResult.tier}</div>
                      <div className="w-full bg-slate-700/50 rounded-full h-2 mb-4">
                        <div
                          className="h-2 rounded-full transition-all duration-500"
                          style={{
                            width: `${aeoResult.score}%`,
                            background: aeoResult.score >= 80 ? "#10b981" : aeoResult.score >= 60 ? "#3b82f6" : aeoResult.score >= 40 ? "#f59e0b" : "#64748b"
                          }}
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 w-full text-left">
                        {[
                          { tier: "AEO-F (Full)", min: 80, color: "text-emerald-400" },
                          { tier: "AEO-C (Customs)", min: 60, color: "text-blue-400" },
                          { tier: "AEO-S (Security)", min: 40, color: "text-amber-400" },
                          { tier: "Standard", min: 0, color: "text-slate-400" },
                        ].map(({ tier, min, color }) => (
                          <div key={tier} className={`flex items-center gap-1.5 text-[10px] ${aeoResult.score >= min ? color : "text-slate-700"}`}>
                            <Star className="w-3 h-3 flex-shrink-0" />
                            {tier}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* STEP 4 — Account Creation */}
              {step === 4 && (
                <motion.div key="step4" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                  <div className="max-w-md mx-auto space-y-4">
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Username *</label>
                      <input
                        type="text"
                        value={account.username}
                        onChange={(e) => setAccount({ ...account, username: e.target.value })}
                        placeholder="trader.username"
                        className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Password *</label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={account.password}
                          onChange={(e) => setAccount({ ...account, password: e.target.value })}
                          placeholder="Min 12 chars, uppercase, number, symbol"
                          className="w-full bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2.5 pr-10 text-sm text-white focus:outline-none focus:border-[#D4A017]/50"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((s) => !s)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">Confirm Password *</label>
                      <input
                        type="password"
                        value={account.confirm_password}
                        onChange={(e) => setAccount({ ...account, confirm_password: e.target.value })}
                        className={`w-full bg-slate-800/60 border rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none transition-colors ${
                          account.confirm_password && account.password !== account.confirm_password
                            ? "border-red-500/50 focus:border-red-500/70"
                            : "border-white/10 focus:border-[#D4A017]/50"
                        }`}
                      />
                      {account.confirm_password && account.password !== account.confirm_password && (
                        <div className="text-xs text-red-400 mt-1">Passwords do not match</div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-slate-400 mb-1.5">MFA Method</label>
                      <div className="grid grid-cols-3 gap-2">
                        {["TOTP", "SMS", "Email OTP"].map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setAccount({ ...account, mfa_method: m })}
                            className={`py-2 rounded-xl text-xs font-medium border transition-all ${
                              account.mfa_method === m
                                ? "bg-[#D4A017]/20 border-[#D4A017]/50 text-[#D4A017]"
                                : "bg-slate-800/60 border-white/10 text-slate-400 hover:text-white"
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={account.agreed_terms}
                        onChange={(e) => setAccount({ ...account, agreed_terms: e.target.checked })}
                        className="w-4 h-4 mt-0.5 rounded border-white/20 bg-slate-800 accent-[#D4A017]"
                      />
                      <span className="text-xs text-slate-400">
                        I agree to the <span className="text-[#D4A017] underline cursor-pointer">Terms of Service</span>, <span className="text-[#D4A017] underline cursor-pointer">Privacy Policy</span>, and the TradeGateway NGSWTP Trader Agreement. I confirm all submitted information is accurate.
                      </span>
                    </label>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Navigation buttons */}
          <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between">
            <button
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
              Back
            </button>
            {step < 4 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
                disabled={!canProceed()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A017] text-[#0A1628] text-sm font-semibold hover:bg-[#D4A017]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!canProceed() || isSubmitting}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#D4A017] text-[#0A1628] text-sm font-semibold hover:bg-[#D4A017]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Provisioning...</>
                ) : (
                  <><UserPlus className="w-4 h-4" /> Create Account</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
