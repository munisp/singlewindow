/**
 * TradeGateway NGSWTP — Temporal Workflow Trace Panel
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 *
 * Animated 9-step declaration workflow state machine:
 * - Each activity shows: status, duration, retries, input/output
 * - Failure injection and retry simulation
 * - Live timeline with compensation logic
 * - Workflow execution history panel
 */

import { useState, useEffect, useRef } from "react";
import { Play, RotateCcw, AlertTriangle, CheckCircle, Clock, Zap, ChevronDown, ChevronRight, Activity } from "lucide-react";

type ActivityStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "RETRYING" | "COMPENSATING" | "SKIPPED";

interface WorkflowActivity {
  id: string;
  name: string;
  service: string;
  language: "Go" | "Python" | "Rust";
  description: string;
  durationMs: number;
  retryPolicy: string;
  input: string;
  output: string;
  failureOutput: string;
  compensationActivity?: string;
  status: ActivityStatus;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  lane?: "GREEN" | "YELLOW" | "RED";
}

const WORKFLOW_ACTIVITIES: WorkflowActivity[] = [
  {
    id: "ocr-extract",
    name: "OCR Document Extraction",
    service: "ocr-service",
    language: "Python",
    description: "LayoutLMv3 extracts structured data from uploaded invoice, BL, and supporting documents",
    durationMs: 1200,
    retryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0",
    input: '{"declaration_id": "URN-2026-GH-00847", "documents": ["invoice.pdf", "bl.pdf", "cert_origin.pdf"]}',
    output: '{"extracted_fields": {"shipper": "Shenzhen Electronics Ltd", "consignee": "Accra Imports Ltd", "hs_code_raw": "8471.30", "value_usd": 45200, "weight_kg": 320, "country_origin": "CN"}, "confidence": 0.94}',
    failureOutput: '{"error": "OCR_QUALITY_LOW", "retry": true, "message": "Document scan quality insufficient, requesting re-upload"}',
    compensationActivity: "notify-trader-reupload",
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "hs-classify",
    name: "HS Code Classification",
    service: "hs-classifier",
    language: "Python",
    description: "BERT NLP model classifies commodity to 6-digit HS code with confidence score",
    durationMs: 800,
    retryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.5",
    input: '{"raw_description": "Portable automatic data processing machines weighing not more than 10kg", "country_origin": "CN"}',
    output: '{"hs_code": "8471.30.00", "confidence": 0.97, "chapter": "84", "description": "Portable ADP machines ≤10kg", "wco_validated": true}',
    failureOutput: '{"error": "LOW_CONFIDENCE", "confidence": 0.61, "top_candidates": ["8471.30.00", "8471.41.00"], "action": "MANUAL_REVIEW"}',
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "tariff-calc",
    name: "Tariff & Duty Calculation",
    service: "tariff-svc",
    language: "Go",
    description: "Calculates import duty, VAT, levies, and excise based on WCO Data Model v3.10",
    durationMs: 350,
    retryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0",
    input: '{"hs_code": "8471.30.00", "cif_value_usd": 45200, "country_origin": "CN", "country_destination": "GH", "trader_id": "TRD-GH-00124"}',
    output: '{"import_duty_pct": 10, "vat_pct": 15, "nhil_pct": 2.5, "getfl_pct": 0.5, "total_duty_usd": 12814, "total_duty_ghs": 153768, "breakdown": {"duty": 4520, "vat": 7480, "nhil": 1130, "getfl": 226}}',
    failureOutput: '{"error": "TARIFF_TABLE_STALE", "retry": true, "message": "Tariff schedule cache expired, refreshing from WCO"}',
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "risk-score",
    name: "Risk Score Computation",
    service: "risk-engine",
    language: "Rust",
    description: "200-rule parallel risk evaluator + GNN fraud detector produces composite risk score in <200ms",
    durationMs: 180,
    retryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.0",
    input: '{"declaration_id": "URN-2026-GH-00847", "trader_id": "TRD-GH-00124", "hs_code": "8471.30.00", "cif_value": 45200, "country_origin": "CN", "aeo_status": false}',
    output: '{"risk_score": 28, "risk_level": "LOW", "lane": "GREEN", "rule_hits": ["R042_FIRST_TIME_IMPORTER"], "gnn_fraud_score": 0.12, "contributing_factors": {"value_anomaly": 0.1, "route_risk": 0.15, "trader_history": 0.03}}',
    failureOutput: '{"error": "RISK_ENGINE_TIMEOUT", "fallback": "YELLOW_LANE", "message": "Risk engine timeout, defaulting to Yellow lane for manual review"}',
    status: "PENDING",
    retryCount: 0,
    lane: "GREEN",
  },
  {
    id: "oga-fanout",
    name: "OGA Agency Fan-Out",
    service: "oga-hub",
    language: "Go",
    description: "Parallel fan-out to relevant government agencies based on HS code and commodity type",
    durationMs: 2400,
    retryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0, PerAgencyTimeout: 30s",
    input: '{"declaration_id": "URN-2026-GH-00847", "hs_code": "8471.30.00", "agencies": ["CUSTOMS", "STANDARDS_AUTH", "COMPANY_REGISTRY"]}',
    output: '{"responses": {"CUSTOMS": {"status": "APPROVED", "latency_ms": 280}, "STANDARDS_AUTH": {"status": "APPROVED", "latency_ms": 1840}, "COMPANY_REGISTRY": {"status": "APPROVED", "latency_ms": 620}}, "all_approved": true, "total_latency_ms": 2400}',
    failureOutput: '{"error": "OGA_TIMEOUT", "agency": "STANDARDS_AUTH", "retry": true, "circuit_breaker": "HALF_OPEN"}',
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "payment-quote",
    name: "Mojaloop ILP Quote",
    service: "payment-svc",
    language: "Go",
    description: "Requests ILP payment quote from Mojaloop switch; TigerBeetle reserves duty amount",
    durationMs: 420,
    retryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0",
    input: '{"declaration_id": "URN-2026-GH-00847", "amount_ghs": 153768, "payer_fsp": "GCB_BANK", "payee_fsp": "REVENUE_AUTH", "ilp_condition": "sha256:abc..."}',
    output: '{"quote_id": "QT-2026-00847", "ilp_packet": "AYIBg...", "condition": "sha256:abc...", "expiry": "2026-03-07T22:15:00Z", "tb_pending_id": "TB-PEND-00847", "reserved_amount": 153768}',
    failureOutput: '{"error": "QUOTE_EXPIRED", "retry": true, "message": "ILP quote expired, requesting new quote"}',
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "payment-transfer",
    name: "Mojaloop Transfer & Fulfilment",
    service: "payment-svc",
    language: "Go",
    description: "Executes ILP transfer; on fulfilment callback, TigerBeetle posts the reserved amount",
    durationMs: 680,
    retryPolicy: "MaxAttempts: 2, BackoffCoefficient: 1.5, IdempotencyKey: declaration_id",
    input: '{"quote_id": "QT-2026-00847", "ilp_packet": "AYIBg...", "condition": "sha256:abc...", "transfer_id": "TRF-2026-00847"}',
    output: '{"transfer_id": "TRF-2026-00847", "fulfilment": "sha256:xyz...", "state": "COMMITTED", "tb_posted_id": "TB-POST-00847", "ledger_entry": {"debit_account": "TRADER_GCB", "credit_account": "REVENUE_AUTH_DUTY", "amount": 153768}}',
    failureOutput: '{"error": "TRANSFER_ABORTED", "reason": "PAYER_INSUFFICIENT_FUNDS", "compensation": "RELEASE_TB_RESERVE", "message": "Payment failed — releasing TigerBeetle reservation"}',
    compensationActivity: "release-tb-reservation",
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "permit-issue",
    name: "Clearance Permit Issuance",
    service: "permit-svc",
    language: "Go",
    description: "Issues Ed25519-signed digital clearance permit with QR code for port gate pass",
    durationMs: 290,
    retryPolicy: "MaxAttempts: 3, BackoffCoefficient: 2.0",
    input: '{"declaration_id": "URN-2026-GH-00847", "payment_ref": "TRF-2026-00847", "lane": "GREEN", "oga_approvals": ["CUSTOMS", "STANDARDS_AUTH", "COMPANY_REGISTRY"]}',
    output: '{"permit_id": "CLR-2026-GH-00847", "valid_until": "2026-03-14T23:59:59Z", "qr_code": "data:image/png;base64,iVBOR...", "ed25519_signature": "base64:sig...", "gate_pass_ref": "GP-TEMA-00847"}',
    failureOutput: '{"error": "SIGNING_KEY_UNAVAILABLE", "retry": true, "message": "HSM signing key rotation in progress, retrying"}',
    status: "PENDING",
    retryCount: 0,
  },
  {
    id: "audit-archive",
    name: "Audit Trail Archival",
    service: "audit-svc",
    language: "Go",
    description: "Writes immutable hash-chained audit record to PostgreSQL + Delta Lake Bronze layer",
    durationMs: 150,
    retryPolicy: "MaxAttempts: 5, BackoffCoefficient: 2.0",
    input: '{"declaration_id": "URN-2026-GH-00847", "workflow_id": "WF-2026-00847", "events": [...], "permit_id": "CLR-2026-GH-00847"}',
    output: '{"audit_id": "AUD-2026-00847", "chain_hash": "sha256:def...", "prev_hash": "sha256:abc...", "block_height": 1847293, "kafka_offset": 9284710, "delta_lake_path": "s3://tradegateway/bronze/declarations/2026/03/07/"}',
    failureOutput: '{"error": "DB_CONNECTION_LOST", "retry": true, "kafka_buffered": true, "message": "DB unavailable, event buffered in Kafka for replay"}',
    status: "PENDING",
    retryCount: 0,
  },
];

const LANG_COLORS: Record<string, string> = {
  Go: "bg-cyan-900/40 text-cyan-300 border-cyan-700/40",
  Python: "bg-yellow-900/40 text-yellow-300 border-yellow-700/40",
  Rust: "bg-orange-900/40 text-orange-300 border-orange-700/40",
};

const STATUS_CONFIG: Record<ActivityStatus, { color: string; bg: string; label: string }> = {
  PENDING: { color: "text-slate-400", bg: "bg-slate-800/50", label: "Pending" },
  RUNNING: { color: "text-blue-400", bg: "bg-blue-900/30", label: "Running" },
  COMPLETED: { color: "text-emerald-400", bg: "bg-emerald-900/30", label: "Completed" },
  FAILED: { color: "text-red-400", bg: "bg-red-900/30", label: "Failed" },
  RETRYING: { color: "text-amber-400", bg: "bg-amber-900/30", label: "Retrying" },
  COMPENSATING: { color: "text-purple-400", bg: "bg-purple-900/30", label: "Compensating" },
  SKIPPED: { color: "text-slate-500", bg: "bg-slate-800/30", label: "Skipped" },
};

export default function TemporalWorkflow() {
  const [activities, setActivities] = useState<WorkflowActivity[]>(
    WORKFLOW_ACTIVITIES.map((a) => ({ ...a }))
  );
  const [isRunning, setIsRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [expandedStep, setExpandedStep] = useState<string | null>(null);
  const [injectFailure, setInjectFailure] = useState(false);
  const [failureStep, setFailureStep] = useState(3); // default: risk-score
  const [workflowStatus, setWorkflowStatus] = useState<"IDLE" | "RUNNING" | "COMPLETED" | "FAILED">("IDLE");
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [showHistory, setShowHistory] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const reset = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setActivities(WORKFLOW_ACTIVITIES.map((a) => ({ ...a })));
    setCurrentStep(-1);
    setIsRunning(false);
    setWorkflowStatus("IDLE");
    setTotalElapsed(0);
  };

  const runWorkflow = async () => {
    reset();
    await new Promise((r) => setTimeout(r, 100));
    setIsRunning(true);
    setWorkflowStatus("RUNNING");
    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setTotalElapsed(Date.now() - startTimeRef.current);
    }, 100);

    const updatedActivities = WORKFLOW_ACTIVITIES.map((a) => ({ ...a }));

    for (let i = 0; i < updatedActivities.length; i++) {
      setCurrentStep(i);

      // Mark as RUNNING
      updatedActivities[i].status = "RUNNING";
      updatedActivities[i].startedAt = Date.now();
      setActivities([...updatedActivities]);

      const duration = updatedActivities[i].durationMs;
      await new Promise((r) => setTimeout(r, duration));

      // Inject failure if configured
      if (injectFailure && i === failureStep) {
        updatedActivities[i].status = "FAILED";
        updatedActivities[i].completedAt = Date.now();
        setActivities([...updatedActivities]);

        await new Promise((r) => setTimeout(r, 600));

        // Retry once
        updatedActivities[i].status = "RETRYING";
        updatedActivities[i].retryCount = 1;
        setActivities([...updatedActivities]);

        await new Promise((r) => setTimeout(r, duration * 1.5));

        // Succeed on retry
        updatedActivities[i].status = "COMPLETED";
        updatedActivities[i].completedAt = Date.now();
        setActivities([...updatedActivities]);
      } else {
        updatedActivities[i].status = "COMPLETED";
        updatedActivities[i].completedAt = Date.now();
        setActivities([...updatedActivities]);
      }

      await new Promise((r) => setTimeout(r, 80));
    }

    if (timerRef.current) clearInterval(timerRef.current);
    setTotalElapsed(Date.now() - startTimeRef.current);
    setIsRunning(false);
    setWorkflowStatus("COMPLETED");
    setCurrentStep(-1);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const completedCount = activities.filter((a) => a.status === "COMPLETED").length;
  const totalDuration = activities.reduce((s, a) => s + a.durationMs, 0);

  return (
    <section id="temporal-workflow" className="py-20 bg-[#0D1E35]">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Temporal Workflow Engine
            </span>
          </div>
          <h2 className="font-['Playfair_Display'] text-4xl font-bold text-white mb-4">
            Declaration Workflow Trace
          </h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            Live execution trace of the 9-step Temporal workflow orchestrating the full declaration
            lifecycle — from OCR extraction through duty payment to clearance permit issuance.
            Each activity shows its service, language runtime, retry policy, and I/O payload.
          </p>
        </div>

        {/* Controls */}
        <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl p-6 mb-8">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <button
              onClick={runWorkflow}
              disabled={isRunning}
              className="flex items-center gap-2 bg-[#D4A017] hover:bg-[#B8860B] disabled:opacity-50 text-[#0A1628] font-bold px-6 py-3 rounded-xl transition-colors"
            >
              {isRunning ? (
                <>
                  <Activity className="w-4 h-4 animate-pulse" />
                  Executing Workflow...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Execute Workflow
                </>
              )}
            </button>
            <button
              onClick={reset}
              disabled={isRunning}
              className="flex items-center gap-2 bg-slate-700/50 hover:bg-slate-600/50 disabled:opacity-50 text-slate-300 px-6 py-3 rounded-xl transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
            <div className="flex items-center gap-3 ml-auto">
              <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={injectFailure}
                  onChange={(e) => setInjectFailure(e.target.checked)}
                  className="w-4 h-4 accent-amber-500"
                />
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Inject Failure at Step
              </label>
              {injectFailure && (
                <select
                  value={failureStep}
                  onChange={(e) => setFailureStep(Number(e.target.value))}
                  className="bg-[#0A1628] border border-amber-700/50 rounded-lg px-3 py-1.5 text-amber-300 text-sm"
                >
                  {WORKFLOW_ACTIVITIES.map((a, i) => (
                    <option key={a.id} value={i}>{i + 1}. {a.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          <div className="flex items-center gap-4">
            <div className="flex-1 bg-slate-800 rounded-full h-2">
              <div
                className="bg-gradient-to-r from-[#D4A017] to-emerald-400 h-2 rounded-full transition-all duration-300"
                style={{ width: `${(completedCount / activities.length) * 100}%` }}
              />
            </div>
            <span className="text-sm text-slate-400 whitespace-nowrap">
              {completedCount}/{activities.length} activities
            </span>
            {totalElapsed > 0 && (
              <span className="text-sm font-mono text-[#D4A017] whitespace-nowrap">
                {(totalElapsed / 1000).toFixed(1)}s elapsed
              </span>
            )}
          </div>

          {workflowStatus === "COMPLETED" && (
            <div className="mt-4 flex items-center gap-3 bg-emerald-900/20 border border-emerald-700/30 rounded-xl px-4 py-3">
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <span className="text-emerald-400 font-semibold">Workflow Completed Successfully</span>
                <span className="text-slate-400 text-sm ml-3">
                  Total: {(totalElapsed / 1000).toFixed(2)}s · Expected: {(totalDuration / 1000).toFixed(2)}s · Permit: CLR-2026-GH-00847
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Activity Timeline */}
        <div className="space-y-3 mb-8">
          {activities.map((activity, index) => {
            const statusCfg = STATUS_CONFIG[activity.status];
            const isExpanded = expandedStep === activity.id;
            const isActive = currentStep === index;
            const duration = activity.completedAt && activity.startedAt
              ? activity.completedAt - activity.startedAt
              : null;

            return (
              <div
                key={activity.id}
                className={`border rounded-xl transition-all duration-300 ${
                  isActive
                    ? "border-[#D4A017]/60 bg-[#D4A017]/5"
                    : activity.status === "COMPLETED"
                    ? "border-emerald-700/30 bg-emerald-900/10"
                    : activity.status === "FAILED" || activity.status === "RETRYING"
                    ? "border-amber-700/30 bg-amber-900/10"
                    : "border-slate-700/30 bg-[#0A1628]/50"
                }`}
              >
                {/* Activity Header */}
                <button
                  onClick={() => setExpandedStep(isExpanded ? null : activity.id)}
                  className="w-full flex items-center gap-4 p-4 text-left"
                >
                  {/* Step Number */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    activity.status === "COMPLETED" ? "bg-emerald-600 text-white" :
                    activity.status === "RUNNING" ? "bg-[#D4A017] text-[#0A1628] animate-pulse" :
                    activity.status === "FAILED" || activity.status === "RETRYING" ? "bg-amber-600 text-white" :
                    "bg-slate-700 text-slate-400"
                  }`}>
                    {activity.status === "COMPLETED" ? <CheckCircle className="w-4 h-4" /> :
                     activity.status === "RUNNING" ? <Activity className="w-4 h-4" /> :
                     activity.status === "RETRYING" ? <RotateCcw className="w-4 h-4" /> :
                     index + 1}
                  </div>

                  {/* Activity Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold text-white">{activity.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border ${LANG_COLORS[activity.language]}`}>
                        {activity.language}
                      </span>
                      <span className="text-xs text-slate-500">{activity.service}</span>
                      {activity.retryCount > 0 && (
                        <span className="text-xs bg-amber-900/30 text-amber-400 border border-amber-700/30 px-2 py-0.5 rounded">
                          Retry #{activity.retryCount}
                        </span>
                      )}
                      {activity.lane && activity.status === "COMPLETED" && (
                        <span className={`text-xs px-2 py-0.5 rounded border ${
                          activity.lane === "GREEN" ? "bg-emerald-900/30 text-emerald-400 border-emerald-700/30" :
                          activity.lane === "YELLOW" ? "bg-amber-900/30 text-amber-400 border-amber-700/30" :
                          "bg-red-900/30 text-red-400 border-red-700/30"
                        }`}>
                          {activity.lane} Lane
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">{activity.description}</div>
                  </div>

                  {/* Duration & Status */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    {duration && (
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Clock className="w-3 h-3" />
                        {duration}ms
                      </div>
                    )}
                    <span className={`text-xs font-semibold px-2 py-1 rounded ${statusCfg.bg} ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-700/30 pt-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Retry Policy */}
                      <div className="bg-slate-800/50 rounded-xl p-3">
                        <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Retry Policy</div>
                        <div className="text-xs text-slate-300 font-mono">{activity.retryPolicy}</div>
                      </div>

                      {/* Expected Duration */}
                      <div className="bg-slate-800/50 rounded-xl p-3">
                        <div className="text-xs text-slate-500 mb-1 font-semibold uppercase tracking-wider">Expected Duration</div>
                        <div className="text-xs text-[#D4A017] font-mono font-bold">{activity.durationMs}ms</div>
                      </div>

                      {/* Input */}
                      <div className="bg-slate-900/60 rounded-xl p-3">
                        <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider flex items-center gap-1">
                          <Zap className="w-3 h-3" /> Input Payload
                        </div>
                        <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                          {JSON.stringify(JSON.parse(activity.input), null, 2)}
                        </pre>
                      </div>

                      {/* Output */}
                      <div className={`rounded-xl p-3 ${
                        activity.status === "FAILED" ? "bg-red-900/20" :
                        activity.status === "RETRYING" ? "bg-amber-900/20" :
                        "bg-emerald-900/10"
                      }`}>
                        <div className="text-xs text-slate-500 mb-2 font-semibold uppercase tracking-wider flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          {activity.status === "FAILED" || activity.status === "RETRYING" ? "Failure Output" : "Success Output"}
                        </div>
                        <pre className="text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                          {JSON.stringify(JSON.parse(
                            activity.status === "FAILED" || activity.status === "RETRYING"
                              ? activity.failureOutput
                              : activity.output
                          ), null, 2)}
                        </pre>
                      </div>
                    </div>

                    {activity.compensationActivity && (
                      <div className="mt-3 bg-purple-900/20 border border-purple-700/30 rounded-xl p-3">
                        <div className="text-xs text-purple-400 font-semibold">
                          ⟲ Compensation Activity: <span className="font-mono">{activity.compensationActivity}</span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          Triggered automatically by Temporal on permanent failure after all retries exhausted
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Workflow Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Activities", value: "9", color: "text-white" },
            { label: "Go Services", value: "6", color: "text-cyan-400" },
            { label: "Python Services", value: "2", color: "text-yellow-400" },
            { label: "Rust Engines", value: "1", color: "text-orange-400" },
          ].map((stat) => (
            <div key={stat.label} className="bg-[#0A1628] border border-slate-700/30 rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${stat.color} mb-1`}>{stat.value}</div>
              <div className="text-xs text-slate-500">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Architecture Note */}
        <div className="mt-6 bg-[#0A1628] border border-[#D4A017]/20 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <Activity className="w-5 h-5 text-[#D4A017] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-[#D4A017] mb-1">Temporal Workflow Architecture</div>
              <div className="text-xs text-slate-400 leading-relaxed">
                The declaration workflow is implemented as a Temporal Workflow Definition in Go
                (<code className="text-cyan-300">declaration-svc/internal/workflow/declaration_workflow.go</code>).
                Each activity is registered with its own retry policy, heartbeat timeout, and schedule-to-close timeout.
                The Temporal server persists workflow state in PostgreSQL, enabling automatic recovery from worker crashes
                mid-execution. Compensation activities (saga pattern) handle rollback of TigerBeetle reservations and
                Mojaloop transfers on permanent failure.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
