/**
 * TradeGateway NGSWTP — Mojaloop Payment Flow Demo
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Interactive animated walkthrough of the full ILP payment cycle:
 * Step 1: Duty Assessment (tariff-svc calculates duty)
 * Step 2: ILP Quote Request (Mojaloop FSPIOP /quotes)
 * Step 3: Quote Response (ILP condition + expiry)
 * Step 4: Transfer Initiation (Mojaloop /transfers)
 * Step 5: TigerBeetle Reserve (two-phase pending debit)
 * Step 6: Transfer Fulfilment (DFSP confirms)
 * Step 7: TigerBeetle Post (two-phase post — finalize)
 * Step 8: Payment Confirmed → Permit Issued
 */

import { useState, useEffect, useCallback } from "react";
import {
  CheckCircle, Clock, ArrowRight, Zap, Shield, Database,
  DollarSign, RefreshCw, AlertCircle, ChevronDown, ChevronUp
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type StepStatus = "PENDING" | "ACTIVE" | "COMPLETE" | "ERROR";

interface PaymentStep {
  id: number;
  title: string;
  system: string;
  systemColor: string;
  protocol: string;
  description: string;
  requestPayload: object;
  responsePayload: object;
  latencyMs: number;
}

interface LedgerEntry {
  id: string;
  type: "PENDING_DEBIT" | "PENDING_CREDIT" | "POST_DEBIT" | "POST_CREDIT" | "VOID";
  account: string;
  amount: number;
  currency: string;
  timestamp: string;
  phase: "PENDING" | "POSTED";
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const PAYMENT_STEPS: PaymentStep[] = [
  {
    id: 1,
    title: "Duty Assessment",
    system: "tariff-svc",
    systemColor: "#D4A017",
    protocol: "gRPC",
    description: "The tariff service calculates total duty payable based on HS code, CIF value, and applicable trade agreements.",
    requestPayload: {
      declarationId: "URN-2026-GH-0041823",
      hsCode: "8471.30.00",
      cifValueUSD: 12500.00,
      originCountry: "CN",
      destinationCountry: "GH",
      tradeAgreement: "ECOWAS"
    },
    responsePayload: {
      dutyRate: 0.10,
      dutyAmountUSD: 1250.00,
      vatRate: 0.125,
      vatAmountUSD: 1718.75,
      levyAmountUSD: 62.50,
      totalPayableUSD: 3031.25,
      totalPayableGHS: 37890.63,
      currency: "GHS",
      exchangeRate: 12.50,
      paymentReference: "PAY-2026-0041823-GH",
      expiresAt: "2026-03-08T14:00:00Z"
    },
    latencyMs: 45
  },
  {
    id: 2,
    title: "ILP Quote Request",
    system: "Mojaloop Hub",
    systemColor: "#3B82F6",
    protocol: "FSPIOP REST",
    description: "The payment-svc sends a POST /quotes to the Mojaloop Hub, requesting an ILP condition and fulfillment address from the payer DFSP.",
    requestPayload: {
      quoteId: "QTE-7f3a9b2c-4d1e-8f6a",
      transactionId: "TXN-2026-0041823",
      payee: {
        partyIdType: "MSISDN",
        partyIdentifier: "+233244123456",
        fspId: "GhanaCommercialBank"
      },
      payer: {
        partyIdType: "BUSINESS",
        partyIdentifier: "TRD-GH-00412",
        fspId: "TradeGatewayFSP"
      },
      amountType: "RECEIVE",
      amount: { amount: "37890.63", currency: "GHS" },
      transactionType: { scenario: "TRANSFER", initiator: "PAYER", initiatorType: "BUSINESS" },
      note: "Customs duty payment URN-2026-GH-0041823"
    },
    responsePayload: {
      quoteId: "QTE-7f3a9b2c-4d1e-8f6a",
      transferAmount: { amount: "37890.63", currency: "GHS" },
      payeeReceiveAmount: { amount: "37890.63", currency: "GHS" },
      payeeFspFee: { amount: "0.00", currency: "GHS" },
      expiration: "2026-03-08T13:30:00Z",
      ilpPacket: "AYIBgAAAAAAAASwNGdf2LkAToBwYsl...(truncated)",
      condition: "HOr22-H3AfTDHrSkPjJtVPRG_XNjRoSTfgRoSBAgBc",
      geoCode: { latitude: "5.6037", longitude: "-0.1870" }
    },
    latencyMs: 180
  },
  {
    id: 3,
    title: "Quote Validation",
    system: "payment-svc",
    systemColor: "#D4A017",
    protocol: "Internal",
    description: "payment-svc validates the ILP condition, checks quote expiry, and verifies the transfer amount matches the duty assessment.",
    requestPayload: {
      action: "VALIDATE_QUOTE",
      quoteId: "QTE-7f3a9b2c-4d1e-8f6a",
      expectedAmount: "37890.63",
      currency: "GHS",
      conditionHash: "HOr22-H3AfTDHrSkPjJtVPRG_XNjRoSTfgRoSBAgBc"
    },
    responsePayload: {
      valid: true,
      amountMatch: true,
      conditionValid: true,
      expiryValid: true,
      riskCheck: "PASSED",
      proceedToTransfer: true
    },
    latencyMs: 12
  },
  {
    id: 4,
    title: "TigerBeetle Reserve",
    system: "tb-bridge (Rust)",
    systemColor: "#EF4444",
    protocol: "TigerBeetle Client",
    description: "The Rust tb-bridge creates a two-phase PENDING transfer in TigerBeetle, reserving funds in the duty escrow account before initiating the Mojaloop transfer.",
    requestPayload: {
      action: "CREATE_PENDING_TRANSFER",
      transfers: [{
        id: "0x0041823000000001",
        debitAccountId: "0xTRADER_GH_00412",
        creditAccountId: "0xDUTY_ESCROW_GRA",
        amount: 3789063,
        currency: "GHS_PESEWAS",
        code: 1001,
        flags: "PENDING",
        timeout: 300,
        userData128: "PAY-2026-0041823-GH"
      }]
    },
    responsePayload: {
      result: "OK",
      transferId: "0x0041823000000001",
      phase: "PENDING",
      debitAccountBalance: { debitsPosted: 0, debitsPending: 3789063, creditsPosted: 45000000 },
      creditAccountBalance: { creditsPosted: 0, creditsPending: 3789063, debitsPosted: 0 },
      timestamp: "2026-03-08T13:15:42.003Z"
    },
    latencyMs: 8
  },
  {
    id: 5,
    title: "Mojaloop Transfer",
    system: "Mojaloop Hub",
    systemColor: "#3B82F6",
    protocol: "FSPIOP REST",
    description: "payment-svc initiates the actual money movement via POST /transfers to the Mojaloop Hub using the ILP fulfillment condition.",
    requestPayload: {
      transferId: "TRF-2026-0041823-001",
      payerFsp: "TradeGatewayFSP",
      payeeFsp: "GhanaRevenueAuthority",
      amount: { amount: "37890.63", currency: "GHS" },
      ilpPacket: "AYIBgAAAAAAAASwNGdf2LkAToBwYsl...(truncated)",
      condition: "HOr22-H3AfTDHrSkPjJtVPRG_XNjRoSTfgRoSBAgBc",
      expiration: "2026-03-08T13:30:00Z"
    },
    responsePayload: {
      transferState: "RECEIVED",
      completedTimestamp: null,
      fulfilment: null
    },
    latencyMs: 220
  },
  {
    id: 6,
    title: "Transfer Fulfilment",
    system: "GRA DFSP",
    systemColor: "#10B981",
    protocol: "FSPIOP Callback",
    description: "Ghana Revenue Authority's DFSP sends the PUT /transfers/{id} callback with the ILP fulfillment, confirming receipt of funds.",
    requestPayload: {
      transferId: "TRF-2026-0041823-001",
      fulfilment: "mhPUT9ZAwd-BXLfeSd7-YPh46rBWRNBiTCSWjpku90s",
      completedTimestamp: "2026-03-08T13:15:43.891Z",
      transferState: "COMMITTED"
    },
    responsePayload: {
      transferState: "COMMITTED",
      completedTimestamp: "2026-03-08T13:15:43.891Z",
      payerFspFee: { amount: "0.00", currency: "GHS" },
      payerFspCommission: { amount: "0.00", currency: "GHS" }
    },
    latencyMs: 95
  },
  {
    id: 7,
    title: "TigerBeetle Post",
    system: "tb-bridge (Rust)",
    systemColor: "#EF4444",
    protocol: "TigerBeetle Client",
    description: "Upon receiving the Mojaloop fulfilment callback, tb-bridge posts the pending TigerBeetle transfer, finalizing the duty ledger entry.",
    requestPayload: {
      action: "POST_PENDING_TRANSFER",
      pendingId: "0x0041823000000001",
      amount: 3789063
    },
    responsePayload: {
      result: "OK",
      transferId: "0x0041823000000001",
      phase: "POSTED",
      debitAccountBalance: { debitsPosted: 3789063, debitsPending: 0, creditsPosted: 45000000 },
      creditAccountBalance: { creditsPosted: 3789063, creditsPending: 0, debitsPosted: 0 },
      timestamp: "2026-03-08T13:15:44.012Z",
      latencyNs: 180
    },
    latencyMs: 1
  },
  {
    id: 8,
    title: "Permit Issued",
    system: "permit-svc",
    systemColor: "#8B5CF6",
    protocol: "Kafka Event",
    description: "payment-svc publishes a payment.confirmed event to Kafka. permit-svc consumes it, generates an Ed25519-signed clearance permit, and notifies the trader.",
    requestPayload: {
      event: "payment.confirmed",
      declarationId: "URN-2026-GH-0041823",
      paymentReference: "PAY-2026-0041823-GH",
      amountPaid: { amount: "37890.63", currency: "GHS" },
      paidAt: "2026-03-08T13:15:44.012Z",
      transferId: "TRF-2026-0041823-001"
    },
    responsePayload: {
      permitId: "CLR-2026-GH-0041823",
      declarationId: "URN-2026-GH-0041823",
      status: "CLEARED",
      lane: "GREEN",
      issuedAt: "2026-03-08T13:15:45.234Z",
      expiresAt: "2026-03-09T13:15:45.234Z",
      signature: "Ed25519:3045022100a8f3...b7c2",
      qrCode: "data:image/png;base64,iVBOR...(QR)",
      clearanceTimeMinutes: 14,
      notificationSent: ["SMS", "WhatsApp", "Email"]
    },
    latencyMs: 1200
  }
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MojaloopDemo() {
  const [currentStep, setCurrentStep] = useState(-1);
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    PAYMENT_STEPS.map(() => "PENDING")
  );
  const [isRunning, setIsRunning] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [totalLatency, setTotalLatency] = useState(0);
  const [completed, setCompleted] = useState(false);

  const reset = useCallback(() => {
    setCurrentStep(-1);
    setStepStatuses(PAYMENT_STEPS.map(() => "PENDING"));
    setIsRunning(false);
    setExpandedStep(null);
    setLedgerEntries([]);
    setTotalLatency(0);
    setCompleted(false);
  }, []);

  const runFlow = useCallback(async () => {
    if (isRunning) return;
    reset();
    await new Promise(r => setTimeout(r, 100));
    setIsRunning(true);

    let cumLatency = 0;
    for (let i = 0; i < PAYMENT_STEPS.length; i++) {
      const step = PAYMENT_STEPS[i];
      setCurrentStep(i);
      setStepStatuses(prev => {
        const next = [...prev];
        next[i] = "ACTIVE";
        return next;
      });

      await new Promise(r => setTimeout(r, Math.max(400, step.latencyMs * 3)));

      setStepStatuses(prev => {
        const next = [...prev];
        next[i] = "COMPLETE";
        return next;
      });
      cumLatency += step.latencyMs;
      setTotalLatency(cumLatency);

      // Add ledger entries at TigerBeetle steps
      if (i === 3) {
        setLedgerEntries([
          {
            id: "0x0041823000000001",
            type: "PENDING_DEBIT",
            account: "TRADER-GH-00412",
            amount: 37890.63,
            currency: "GHS",
            timestamp: "13:15:42.003",
            phase: "PENDING"
          },
          {
            id: "0x0041823000000002",
            type: "PENDING_CREDIT",
            account: "DUTY-ESCROW-GRA",
            amount: 37890.63,
            currency: "GHS",
            timestamp: "13:15:42.003",
            phase: "PENDING"
          }
        ]);
      }
      if (i === 6) {
        setLedgerEntries([
          {
            id: "0x0041823000000001",
            type: "POST_DEBIT",
            account: "TRADER-GH-00412",
            amount: 37890.63,
            currency: "GHS",
            timestamp: "13:15:44.012",
            phase: "POSTED"
          },
          {
            id: "0x0041823000000002",
            type: "POST_CREDIT",
            account: "DUTY-ESCROW-GRA",
            amount: 37890.63,
            currency: "GHS",
            timestamp: "13:15:44.012",
            phase: "POSTED"
          }
        ]);
      }

      await new Promise(r => setTimeout(r, 200));
    }

    setIsRunning(false);
    setCompleted(true);
  }, [isRunning, reset]);

  const getStepIcon = (status: StepStatus, index: number) => {
    if (status === "COMPLETE") return <CheckCircle className="w-5 h-5 text-emerald-400" />;
    if (status === "ACTIVE") return <div className="w-5 h-5 border-2 border-[#D4A017] border-t-transparent rounded-full animate-spin" />;
    if (status === "ERROR") return <AlertCircle className="w-5 h-5 text-red-400" />;
    return <div className="w-5 h-5 rounded-full border-2 border-slate-600 flex items-center justify-center text-slate-500 text-xs font-bold">{index + 1}</div>;
  };

  return (
    <section id="mojaloop-demo" className="py-20 bg-[#0A1628]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Financial Architecture
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Mojaloop + TigerBeetle Payment Flow
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Interactive walkthrough of the full ILP duty payment cycle — from tariff assessment
            through Mojaloop FSPIOP transfer to TigerBeetle two-phase ledger finalization and
            Ed25519-signed clearance permit issuance.
          </p>
        </div>

        {/* Stats + Controls */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <button
            onClick={runFlow}
            disabled={isRunning}
            className="bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-60 text-[#0A1628] font-bold px-8 py-3 rounded-xl transition-all flex items-center gap-2"
          >
            {isRunning ? (
              <><div className="w-4 h-4 border-2 border-[#0A1628] border-t-transparent rounded-full animate-spin" />Processing...</>
            ) : (
              <><Zap className="w-4 h-4" />{completed ? "Run Again" : "Run Payment Flow"}</>
            )}
          </button>
          {(isRunning || completed) && (
            <button onClick={reset} className="flex items-center gap-2 text-slate-400 hover:text-white border border-slate-600 hover:border-slate-400 px-4 py-3 rounded-xl transition-all text-sm">
              <RefreshCw className="w-4 h-4" /> Reset
            </button>
          )}
          <div className="flex gap-6 ml-auto">
            {[
              { label: "Total Latency", value: `${totalLatency}ms`, color: "text-[#D4A017]" },
              { label: "Steps Complete", value: `${stepStatuses.filter(s => s === "COMPLETE").length}/${PAYMENT_STEPS.length}`, color: "text-emerald-400" },
              { label: "Amount", value: "GHS 37,890.63", color: "text-blue-400" },
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <div className={`text-xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-slate-500 text-xs">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Steps Timeline */}
          <div className="lg:col-span-2 space-y-2">
            {PAYMENT_STEPS.map((step, i) => {
              const status = stepStatuses[i];
              const isExpanded = expandedStep === i;
              const isActive = status === "ACTIVE";
              const isDone = status === "COMPLETE";

              return (
                <div
                  key={step.id}
                  className={`bg-[#0D1E35] border rounded-xl overflow-hidden transition-all ${
                    isActive ? "border-[#D4A017] shadow-[0_0_20px_rgba(212,160,23,0.15)]" :
                    isDone ? "border-emerald-700/40" : "border-slate-700/50"
                  }`}
                >
                  <button
                    className="w-full flex items-center gap-4 p-4 text-left"
                    onClick={() => setExpandedStep(isExpanded ? null : i)}
                  >
                    {getStepIcon(status, i)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold text-sm ${isDone ? "text-white" : isActive ? "text-[#D4A017]" : "text-slate-400"}`}>
                          {step.title}
                        </span>
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-mono"
                          style={{
                            backgroundColor: `${step.systemColor}20`,
                            color: step.systemColor,
                            border: `1px solid ${step.systemColor}40`
                          }}
                        >
                          {step.system}
                        </span>
                        <span className="text-slate-600 text-xs">{step.protocol}</span>
                      </div>
                      {isActive && (
                        <div className="text-slate-400 text-xs mt-0.5">{step.description.slice(0, 80)}...</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {isDone && (
                        <span className="text-emerald-400 text-xs font-mono">{step.latencyMs}ms</span>
                      )}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-700/50 p-4">
                      <p className="text-slate-400 text-sm mb-4">{step.description}</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <div className="text-slate-500 text-xs uppercase tracking-wider mb-2">Request</div>
                          <pre className="bg-[#0A1628] border border-slate-700/50 rounded-lg p-3 text-xs text-emerald-300 overflow-auto max-h-48 font-mono">
                            {JSON.stringify(step.requestPayload, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <div className="text-slate-500 text-xs uppercase tracking-wider mb-2">Response</div>
                          <pre className="bg-[#0A1628] border border-slate-700/50 rounded-lg p-3 text-xs text-blue-300 overflow-auto max-h-48 font-mono">
                            {JSON.stringify(step.responsePayload, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Right Panel: Ledger + Summary */}
          <div className="space-y-4">
            {/* TigerBeetle Ledger */}
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Database className="w-4 h-4 text-red-400" />
                <h3 className="text-white font-semibold text-sm">TigerBeetle Ledger</h3>
              </div>
              {ledgerEntries.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-slate-500 text-xs">Ledger entries will appear here</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {ledgerEntries.map((entry) => (
                    <div
                      key={`${entry.id}-${entry.type}`}
                      className={`rounded-lg p-3 border text-xs ${
                        entry.phase === "PENDING"
                          ? "bg-amber-900/20 border-amber-700/30"
                          : "bg-emerald-900/20 border-emerald-700/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`font-mono font-bold text-xs ${
                          entry.phase === "PENDING" ? "text-amber-400" : "text-emerald-400"
                        }`}>
                          {entry.type.replace("_", " ")}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          entry.phase === "PENDING"
                            ? "bg-amber-900/50 text-amber-300"
                            : "bg-emerald-900/50 text-emerald-300"
                        }`}>
                          {entry.phase}
                        </span>
                      </div>
                      <div className="text-slate-300 font-mono text-xs">{entry.account}</div>
                      <div className="flex justify-between mt-1">
                        <span className="text-slate-400">{entry.timestamp}</span>
                        <span className="text-white font-bold">
                          {entry.currency} {entry.amount.toLocaleString("en-GH", { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* System Legend */}
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-5">
              <h3 className="text-white font-semibold text-sm mb-4">Systems Involved</h3>
              <div className="space-y-2.5">
                {[
                  { name: "tariff-svc", lang: "Go", color: "#D4A017", role: "Duty calculation" },
                  { name: "payment-svc", lang: "Go", color: "#D4A017", role: "ILP orchestration" },
                  { name: "Mojaloop Hub", lang: "Node.js", color: "#3B82F6", role: "Interop switch" },
                  { name: "GRA DFSP", lang: "External", color: "#10B981", role: "Revenue Authority" },
                  { name: "tb-bridge", lang: "Rust", color: "#EF4444", role: "Ledger finality" },
                  { name: "permit-svc", lang: "Go", color: "#8B5CF6", role: "Clearance issuance" },
                ].map(s => (
                  <div key={s.name} className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <div className="flex-1 min-w-0">
                      <span className="text-white text-xs font-mono">{s.name}</span>
                      <span className="text-slate-500 text-xs ml-2">{s.role}</span>
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-mono shrink-0"
                      style={{ backgroundColor: `${s.color}20`, color: s.color }}
                    >
                      {s.lang}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Completion Banner */}
            {completed && (
              <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="text-emerald-400 font-bold">Payment Complete</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Permit ID</span>
                    <span className="text-white font-mono text-xs">CLR-2026-GH-0041823</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Lane</span>
                    <span className="text-emerald-400 font-bold">GREEN ✓</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Clearance Time</span>
                    <span className="text-[#D4A017] font-bold">14 minutes</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Latency</span>
                    <span className="text-white font-mono">{totalLatency}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Signature</span>
                    <span className="text-purple-400 font-mono text-xs">Ed25519 ✓</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
