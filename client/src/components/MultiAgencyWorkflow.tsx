/**
 * TradeGateway NGSWTP — Multi-Agency Approval Workflow Demo
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Reflects actual production implementation:
 * - services/go/oga-hub/internal/service/oga_hub_service.go
 * - services/go/oga-hub/internal/adapters/oga_adapters.go
 * - workflows/declaration_workflow.go (Temporal activities)
 * - workflows/aeo_workflow.go
 *
 * Animates the OGA fan-out for a Yellow-lane declaration,
 * showing each agency receiving, processing, and responding.
 */

import { useState, useEffect, useRef } from "react";
import { CheckCircle, Clock, AlertCircle, XCircle, Play, RotateCcw, ChevronRight, Building2, Zap, FileText } from "lucide-react";

type AgencyStatus = "idle" | "notified" | "reviewing" | "approved" | "conditional" | "rejected" | "timeout";

interface Agency {
  id: string;
  name: string;
  shortName: string;
  category: "customs" | "revenue" | "agriculture" | "standards" | "immigration" | "port" | "health";
  slaHours: number;
  requiredFor: string[];
  color: string;
  response?: {
    status: "approved" | "conditional" | "rejected";
    conditions?: string[];
    officer: string;
    ref: string;
    durationMs: number;
  };
}

interface WorkflowStep {
  id: string;
  name: string;
  service: string;
  status: "pending" | "running" | "completed" | "failed";
  durationMs?: number;
  output?: string;
}

const AGENCIES: Agency[] = [
  { id: "customs", name: "Customs Authority", shortName: "Customs", category: "customs", slaHours: 2, requiredFor: ["all"], color: "#3b82f6" },
  { id: "revenue", name: "Revenue Authority", shortName: "Revenue", category: "revenue", slaHours: 1, requiredFor: ["all"], color: "#D4A017" },
  { id: "agriculture", name: "Agriculture Dept", shortName: "AgriDept", category: "agriculture", slaHours: 4, requiredFor: ["food", "plants", "animals"], color: "#10b981" },
  { id: "standards", name: "Standards Authority", shortName: "Standards", category: "standards", slaHours: 3, requiredFor: ["electronics", "vehicles", "chemicals"], color: "#8b5cf6" },
  { id: "port", name: "Port Authority", shortName: "Port Auth", category: "port", slaHours: 1, requiredFor: ["all"], color: "#06b6d4" },
  { id: "health", name: "Ministry of Health", shortName: "MoH", category: "health", slaHours: 6, requiredFor: ["pharmaceuticals", "food", "medical"], color: "#f97316" },
];

const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: "submit", name: "Declaration Submitted", service: "declaration-svc", status: "pending" },
  { id: "ocr", name: "OCR Document Extraction", service: "ocr-service (Python)", status: "pending" },
  { id: "hs", name: "HS Code Classification", service: "hs-classifier (BERT)", status: "pending" },
  { id: "risk", name: "Risk Score Computation", service: "risk-engine (Rust)", status: "pending" },
  { id: "lane", name: "Lane Assignment: YELLOW", service: "declaration-svc", status: "pending" },
  { id: "fanout", name: "OGA Fan-Out (6 agencies)", service: "oga-hub", status: "pending" },
  { id: "aggregate", name: "Response Aggregation", service: "oga-hub", status: "pending" },
  { id: "duty", name: "Duty Calculation", service: "tariff-svc", status: "pending" },
  { id: "permit", name: "Clearance Permit Issued", service: "permit-svc (Ed25519)", status: "pending" },
];

const AGENCY_RESPONSES: Record<string, Agency["response"]> = {
  customs: { status: "approved", officer: "Officer K. Mwangi", ref: "CUS-2026-78234", durationMs: 1200 },
  revenue: { status: "approved", officer: "Assessor J. Otieno", ref: "REV-2026-45123", durationMs: 800 },
  agriculture: { status: "conditional", conditions: ["Phytosanitary certificate required", "Fumigation certificate must be valid"], officer: "Inspector A. Kamau", ref: "AGR-2026-12345", durationMs: 3200 },
  standards: { status: "approved", officer: "Inspector P. Wanjiku", ref: "STD-2026-67890", durationMs: 2100 },
  port: { status: "approved", officer: "Port Officer M. Odhiambo", ref: "PRT-2026-34567", durationMs: 600 },
  health: { status: "conditional", conditions: ["Health certificate from country of origin required"], officer: "Dr. S. Njoroge", ref: "MOH-2026-89012", durationMs: 4800 },
};

const STEP_DURATIONS: Record<string, number> = {
  submit: 300,
  ocr: 1800,
  hs: 1200,
  risk: 400,
  lane: 200,
  fanout: 500,
  aggregate: 6000,
  duty: 600,
  permit: 800,
};

export default function MultiAgencyWorkflow() {
  const [steps, setSteps] = useState<WorkflowStep[]>(WORKFLOW_STEPS.map((s) => ({ ...s })));
  const [agencyStatuses, setAgencyStatuses] = useState<Record<string, AgencyStatus>>({});
  const [agencyDetails, setAgencyDetails] = useState<Record<string, Agency["response"]>>({});
  const [currentStep, setCurrentStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [selectedAgency, setSelectedAgency] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const reset = () => {
    setSteps(WORKFLOW_STEPS.map((s) => ({ ...s })));
    setAgencyStatuses({});
    setAgencyDetails({});
    setCurrentStep(-1);
    setIsRunning(false);
    setIsComplete(false);
    setSelectedAgency(null);
    setElapsedMs(0);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const runWorkflow = async () => {
    if (isRunning) return;
    reset();
    await new Promise((r) => setTimeout(r, 50));
    setIsRunning(true);
    startTimeRef.current = Date.now();
    timerRef.current = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 100);

    for (let i = 0; i < WORKFLOW_STEPS.length; i++) {
      setCurrentStep(i);
      setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, status: "running" } : s));

      const stepId = WORKFLOW_STEPS[i].id;
      const duration = STEP_DURATIONS[stepId] || 500;

      if (stepId === "fanout") {
        // Notify all agencies simultaneously
        const initialStatuses: Record<string, AgencyStatus> = {};
        AGENCIES.forEach((a) => { initialStatuses[a.id] = "notified"; });
        setAgencyStatuses(initialStatuses);
        await new Promise((r) => setTimeout(r, duration));

        // Agencies start reviewing
        const reviewingStatuses: Record<string, AgencyStatus> = {};
        AGENCIES.forEach((a) => { reviewingStatuses[a.id] = "reviewing"; });
        setAgencyStatuses(reviewingStatuses);

        // Agencies respond at different times during aggregate step
        const agencyTimers = AGENCIES.map((agency) =>
          new Promise<void>((resolve) => {
            const resp = AGENCY_RESPONSES[agency.id];
            setTimeout(() => {
              setAgencyStatuses((prev) => ({ ...prev, [agency.id]: resp?.status === "approved" ? "approved" : resp?.status === "conditional" ? "conditional" : "rejected" }));
              if (resp) setAgencyDetails((prev) => ({ ...prev, [agency.id]: resp }));
              resolve();
            }, resp?.durationMs || 2000);
          })
        );

        setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, status: "completed", durationMs: duration, output: "6 agencies notified via Dapr pub/sub" } : s));
        setCurrentStep(i + 1);
        setSteps((prev) => prev.map((s, idx) => idx === i + 1 ? { ...s, status: "running" } : s));
        await Promise.all(agencyTimers);
        setSteps((prev) => prev.map((s, idx) => idx === i + 1 ? { ...s, status: "completed", durationMs: STEP_DURATIONS["aggregate"], output: "4 approved, 2 conditional — proceeding with conditions" } : s));
        i++; // skip aggregate step since we handled it here
      } else {
        await new Promise((r) => setTimeout(r, duration));
        const outputs: Record<string, string> = {
          submit: "URN-2026-001239 assigned, Kafka event published",
          ocr: "Invoice, B/L, packing list extracted — 98.2% confidence",
          hs: "HS 8471.30 — Portable computers — confidence 94.7%",
          risk: "Risk score: 62/100 — Trader history: 3 prior violations",
          lane: "YELLOW lane — Document review required",
          duty: "Import duty: $12,450 · VAT: $8,715 · Total: $21,165",
          permit: "Permit TGW-2026-001239 signed with Ed25519 key",
        };
        setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, status: "completed", durationMs: duration, output: outputs[stepId] } : s));
      }
    }

    if (timerRef.current) clearInterval(timerRef.current);
    setIsRunning(false);
    setIsComplete(true);
    setCurrentStep(-1);
  };

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const getStepIcon = (step: WorkflowStep) => {
    if (step.status === "completed") return <CheckCircle className="w-4 h-4 text-emerald-400" />;
    if (step.status === "running") return <div className="w-4 h-4 rounded-full border-2 border-[#D4A017] border-t-transparent animate-spin" />;
    if (step.status === "failed") return <XCircle className="w-4 h-4 text-red-400" />;
    return <div className="w-4 h-4 rounded-full border-2 border-slate-700" />;
  };

  const getAgencyStatusColor = (status: AgencyStatus) => {
    const colors: Record<AgencyStatus, string> = {
      idle: "#334155", notified: "#3b82f6", reviewing: "#f59e0b",
      approved: "#10b981", conditional: "#f97316", rejected: "#ef4444", timeout: "#6b7280",
    };
    return colors[status] || "#334155";
  };

  const selectedAgencyData = selectedAgency ? AGENCIES.find((a) => a.id === selectedAgency) : null;
  const selectedAgencyResponse = selectedAgency ? agencyDetails[selectedAgency] : null;

  return (
    <section id="multi-agency-workflow" className="py-20 bg-[#0A1628]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Temporal · OGA Hub · Multi-Agency
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Multi-Agency Approval Workflow
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Yellow-lane declaration routed to 6 government agencies simultaneously via Temporal workflow
            and Dapr pub/sub fan-out. Reflects actual{" "}
            <code className="text-cyan-400 text-sm bg-slate-800 px-1.5 py-0.5 rounded">oga-hub</code>{" "}
            and{" "}
            <code className="text-cyan-400 text-sm bg-slate-800 px-1.5 py-0.5 rounded">declaration_workflow.go</code>{" "}
            production code.
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={runWorkflow}
            disabled={isRunning}
            className="flex items-center gap-2 bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-50 disabled:cursor-not-allowed text-[#0A1628] font-bold px-6 py-3 rounded-xl transition-all"
          >
            <Play className="w-4 h-4" />
            {isRunning ? "Workflow Running..." : "Run Yellow-Lane Workflow"}
          </button>
          <button onClick={reset} className="flex items-center gap-2 border border-slate-700/50 text-slate-400 hover:text-white px-4 py-3 rounded-xl text-sm transition-all">
            <RotateCcw className="w-4 h-4" /> Reset
          </button>
          {isRunning && (
            <div className="ml-auto flex items-center gap-2 text-sm text-slate-400">
              <Clock className="w-4 h-4 text-[#D4A017]" />
              <span className="font-mono text-white">{(elapsedMs / 1000).toFixed(1)}s</span>
              elapsed
            </div>
          )}
          {isComplete && (
            <div className="ml-auto flex items-center gap-2 text-sm text-emerald-400 font-semibold">
              <CheckCircle className="w-4 h-4" />
              Clearance issued in {(elapsedMs / 1000).toFixed(1)}s
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Workflow Steps */}
          <div className="lg:col-span-2 bg-[#0D1E35] border border-slate-700/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-700/30 flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#D4A017]" />
              <span className="text-sm font-semibold text-white">Temporal Workflow Activities</span>
            </div>
            <div className="divide-y divide-slate-800/50">
              {steps.map((step, idx) => (
                <div key={step.id} className={`flex items-start gap-3 px-4 py-3 transition-colors ${step.status === "running" ? "bg-[#D4A017]/5" : ""}`}>
                  <div className="flex-shrink-0 mt-0.5">{getStepIcon(step)}</div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs font-semibold ${step.status === "running" ? "text-[#D4A017]" : step.status === "completed" ? "text-white" : "text-slate-500"}`}>
                      {step.name}
                    </div>
                    <div className="text-xs text-slate-600 font-mono">{step.service}</div>
                    {step.output && <div className="text-xs text-emerald-400 mt-0.5">{step.output}</div>}
                    {step.durationMs && <div className="text-xs text-slate-600">{step.durationMs}ms</div>}
                  </div>
                  <div className="text-xs text-slate-700 flex-shrink-0">#{idx + 1}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Agency Fan-Out */}
          <div className="lg:col-span-3 flex flex-col gap-4">
            <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-700/30 flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#D4A017]" />
                <span className="text-sm font-semibold text-white">OGA Fan-Out — 6 Agencies</span>
                <span className="ml-auto text-xs text-slate-500">via Dapr pub/sub + circuit breaker</span>
              </div>
              <div className="p-4 grid grid-cols-2 md:grid-cols-3 gap-3">
                {AGENCIES.map((agency) => {
                  const status = agencyStatuses[agency.id] || "idle";
                  const statusColor = getAgencyStatusColor(status);
                  const isSelected = selectedAgency === agency.id;
                  return (
                    <button
                      key={agency.id}
                      onClick={() => setSelectedAgency(isSelected ? null : agency.id)}
                      className={`rounded-xl p-3 text-left border transition-all ${isSelected ? "border-[#D4A017]/50 bg-[#D4A017]/5" : "border-slate-700/30 bg-slate-900/30 hover:border-slate-600/50"}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="w-2 h-2 rounded-full transition-all" style={{ background: statusColor }} />
                        <span className="text-xs font-mono" style={{ color: statusColor }}>{status}</span>
                      </div>
                      <div className="text-xs font-semibold text-white mb-0.5">{agency.shortName}</div>
                      <div className="text-xs text-slate-500">SLA: {agency.slaHours}h</div>
                      {status === "reviewing" && (
                        <div className="mt-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full animate-pulse" style={{ width: "60%" }} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected Agency Detail */}
            {selectedAgencyData && (
              <div className="bg-[#0D1E35] border border-slate-700/50 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="w-4 h-4 text-[#D4A017]" />
                  <span className="text-sm font-semibold text-white">{selectedAgencyData.name} — Response Detail</span>
                </div>
                {selectedAgencyResponse ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {selectedAgencyResponse.status === "approved" ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : selectedAgencyResponse.status === "conditional" ? (
                        <AlertCircle className="w-4 h-4 text-amber-400" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-400" />
                      )}
                      <span className={`text-sm font-bold ${selectedAgencyResponse.status === "approved" ? "text-emerald-400" : selectedAgencyResponse.status === "conditional" ? "text-amber-400" : "text-red-400"}`}>
                        {selectedAgencyResponse.status.toUpperCase()}
                      </span>
                      <span className="text-xs text-slate-500 ml-auto font-mono">{selectedAgencyResponse.ref}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-900/50 rounded-lg p-2">
                        <div className="text-slate-500 mb-0.5">Officer</div>
                        <div className="text-white">{selectedAgencyResponse.officer}</div>
                      </div>
                      <div className="bg-slate-900/50 rounded-lg p-2">
                        <div className="text-slate-500 mb-0.5">Response Time</div>
                        <div className="text-white">{(selectedAgencyResponse.durationMs / 1000).toFixed(1)}s</div>
                      </div>
                    </div>
                    {selectedAgencyResponse.conditions && (
                      <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3">
                        <div className="text-xs text-amber-400 font-semibold mb-1">Conditions Required</div>
                        {selectedAgencyResponse.conditions.map((c, i) => (
                          <div key={i} className="text-xs text-amber-300 flex items-start gap-1.5">
                            <ChevronRight className="w-3 h-3 flex-shrink-0 mt-0.5" /> {c}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">
                    {agencyStatuses[selectedAgencyData.id] === "idle" ? "Run the workflow to see agency response" : "Waiting for agency response..."}
                  </div>
                )}
              </div>
            )}

            {/* Final Result */}
            {isComplete && (
              <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-emerald-400">Clearance Permit Issued</span>
                </div>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <div className="text-slate-500 mb-0.5">Permit Ref</div>
                    <div className="text-white font-mono">TGW-2026-001239</div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <div className="text-slate-500 mb-0.5">Total Duty</div>
                    <div className="text-[#D4A017] font-bold">$21,165</div>
                  </div>
                  <div className="bg-slate-900/50 rounded-lg p-2">
                    <div className="text-slate-500 mb-0.5">Total Time</div>
                    <div className="text-white font-mono">{(elapsedMs / 1000).toFixed(1)}s</div>
                  </div>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Permit signed with Ed25519 key · 2 conditional approvals noted · Conditions must be satisfied within 48h
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
