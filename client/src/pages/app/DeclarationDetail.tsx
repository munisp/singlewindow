import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, Clock, FileText,
  Globe, Package, ShieldCheck, TrendingUp, Truck, XCircle,
  DollarSign, Building2, Anchor, Plane, Train, Download, Loader2, Shield,
  FolderLock, File, Image, Archive, RefreshCw as RefreshCwIcon, ChevronDown, Trash2, Star
} from "lucide-react";
import { useState, useRef, useCallback, useMemo } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useLocation, useParams } from "wouter";

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; description: string }> = {
  draft: {
    label: "Draft",
    color: "bg-slate-100 text-slate-700 border-slate-200",
    icon: <FileText className="h-4 w-4" />,
    description: "Declaration saved but not yet submitted",
  },
  submitted: {
    label: "Submitted",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    icon: <Clock className="h-4 w-4" />,
    description: "Awaiting AI risk assessment",
  },
  under_review: {
    label: "Under Review",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    icon: <AlertTriangle className="h-4 w-4" />,
    description: "Risk assessment complete — awaiting officer review",
  },
  docs_required: {
    label: "Documents Required",
    color: "bg-orange-100 text-orange-700 border-orange-200",
    icon: <FileText className="h-4 w-4" />,
    description: "Additional documents requested by customs",
  },
  payment_pending: {
    label: "Payment Pending",
    color: "bg-purple-100 text-purple-700 border-purple-200",
    icon: <DollarSign className="h-4 w-4" />,
    description: "Duties and taxes have been assessed — awaiting payment to proceed",
  },
  under_examination: {
    label: "Under Examination",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: <AlertTriangle className="h-4 w-4" />,
    description: "Physical inspection in progress",
  },
  examination_complete: {
    label: "Examination Complete",
    color: "bg-teal-100 text-teal-700 border-teal-200",
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: "Physical inspection passed",
  },
  cleared: {
    label: "Cleared",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    icon: <CheckCircle2 className="h-4 w-4" />,
    description: "Clearance permit issued — goods may be released",
  },
  rejected: {
    label: "Rejected",
    color: "bg-red-100 text-red-700 border-red-200",
    icon: <XCircle className="h-4 w-4" />,
    description: "Declaration rejected — see notes for reason",
  },
};

const LANE_CONFIG: Record<string, { label: string; color: string; description: string }> = {
  green: {
    label: "Green Lane",
    color: "bg-emerald-100 text-emerald-700 border-emerald-200",
    description: "Auto-approved — low risk, clearance within 4 hours",
  },
  yellow: {
    label: "Yellow Lane",
    color: "bg-amber-100 text-amber-700 border-amber-200",
    description: "Document review required — 1-3 business days",
  },
  red: {
    label: "Red Lane",
    color: "bg-red-100 text-red-700 border-red-200",
    description: "Physical inspection required — 3-7 business days",
  },
  blue: {
    label: "Blue Lane (AEO)",
    color: "bg-blue-100 text-blue-700 border-blue-200",
    description: "AEO fast-track — clearance within 1 hour",
  },
};

// ─── TRANSPORT ICON ───────────────────────────────────────────────────────────

function TransportIcon({ mode }: { mode: string }) {
  switch (mode?.toLowerCase()) {
    case "sea": return <Anchor className="h-4 w-4" />;
    case "air": return <Plane className="h-4 w-4" />;
    case "rail": return <Train className="h-4 w-4" />;
    default: return <Truck className="h-4 w-4" />;
  }
}

// ─── CLEARANCE TIMELINE ───────────────────────────────────────────────────────

const TIMELINE_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "under_review", label: "Risk Assessment" },
  { key: "payment_pending", label: "Duty Payment" },
  { key: "cleared", label: "Cleared" },
];

function ClearanceTimeline({ currentStatus }: { currentStatus: string }) {
  const statusOrder = ["draft", "submitted", "under_review", "docs_required", "payment_pending", "under_examination", "examination_complete", "cleared"];
  const currentIndex = statusOrder.indexOf(currentStatus);
  const isRejected = currentStatus === "rejected";

  return (
    <div className="flex items-center gap-0">
      {TIMELINE_STEPS.map((step, i) => {
        const stepIndex = statusOrder.indexOf(step.key);
        const isComplete = currentIndex > stepIndex;
        const isCurrent = currentIndex === stepIndex;
        const isLast = i === TIMELINE_STEPS.length - 1;

        return (
          <div key={step.key} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                isRejected && isCurrent ? "border-red-500 bg-red-50 text-red-600" :
                isComplete ? "border-emerald-500 bg-emerald-50 text-emerald-600" :
                isCurrent ? "border-primary bg-primary/10 text-primary" :
                "border-muted bg-muted/30 text-muted-foreground"
              }`}>
                {isRejected && isCurrent ? (
                  <XCircle className="h-4 w-4" />
                ) : isComplete ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <span className="text-xs font-bold">{i + 1}</span>
                )}
              </div>
              <span className="text-xs text-muted-foreground mt-1 text-center whitespace-nowrap">{step.label}</span>
            </div>
            {!isLast && (
              <div className={`flex-1 h-0.5 mx-1 mb-4 ${isComplete ? "bg-emerald-400" : "bg-muted"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── RISK SCORE GAUGE ─────────────────────────────────────────────────────────

function RiskScoreGauge({ score, lane }: { score: number | null; lane: string | null }) {
  if (score === null || score === undefined) return null;

  const laneConf = lane ? LANE_CONFIG[lane] : null;
  const color = score < 30 ? "#10b981" : score < 60 ? "#f59e0b" : "#ef4444";
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-28 h-28">
        <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="10" />
          <circle
            cx="50" cy="50" r="40" fill="none"
            stroke={color} strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      {laneConf && (
        <Badge variant="outline" className={laneConf.color}>
          {laneConf.label}
        </Badge>
      )}
    </div>
  );
}

// ─── DETAIL ROW ───────────────────────────────────────────────────────────────

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-start py-2 border-b border-muted/50 last:border-0">
      <span className="text-sm text-muted-foreground shrink-0 mr-4">{label}</span>
      <span className={`text-sm font-medium text-right ${mono ? "font-mono" : ""}`}>{value || "—"}</span>
    </div>
  );
}

// ─── DECLARATION PROGRESS BAR ───────────────────────────────────────────────

const PROGRESS_STEPS = [
  { key: "draft",              label: "Draft",          shortLabel: "Draft" },
  { key: "submitted",          label: "Submitted",       shortLabel: "Submit" },
  { key: "under_review",       label: "Risk Assessment", shortLabel: "Risk" },
  { key: "lane_assigned",      label: "Lane Assigned",   shortLabel: "Lane" },
  { key: "cleared",            label: "Cleared",         shortLabel: "Clear" },
];

const STATUS_TO_STEP: Record<string, number> = {
  draft: 0,
  submitted: 1,
  under_review: 2,
  docs_required: 2,
  payment_pending: 2,
  under_examination: 3,
  examination_complete: 3,
  green_lane: 3,
  yellow_lane: 3,
  red_lane: 3,
  cleared: 4,
  rejected: 4,
};

function DeclarationProgressBar({ status, riskLane }: { status: string; riskLane?: string | null }) {
  const currentStep = STATUS_TO_STEP[status] ?? 0;
  const isRejected = status === "rejected";
  const laneLabel = riskLane ? riskLane.replace(/_lane$/, "").toUpperCase() : null;
  const laneColor = riskLane === "green_lane" ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : riskLane === "yellow_lane" ? "text-amber-600 bg-amber-50 border-amber-200"
    : riskLane === "red_lane" ? "text-red-600 bg-red-50 border-red-200"
    : "text-blue-600 bg-blue-50 border-blue-200";

  return (
    <div className="w-full">
      {/* Desktop: horizontal stepper */}
      <div className="hidden sm:flex items-center w-full">
        {PROGRESS_STEPS.map((step, i) => {
          const isComplete = currentStep > i;
          const isCurrent = currentStep === i;
          const isLast = i === PROGRESS_STEPS.length - 1;
          const showLane = i === 3 && laneLabel;
          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all ${
                  isRejected && isCurrent ? "bg-red-500 border-red-500 text-white" :
                  isComplete ? "bg-emerald-500 border-emerald-500 text-white" :
                  isCurrent ? "bg-primary border-primary text-white shadow-md shadow-primary/30" :
                  "bg-muted/50 border-muted text-muted-foreground"
                }`}>
                  {isRejected && isCurrent ? <XCircle className="h-4 w-4" /> :
                   isComplete ? <CheckCircle2 className="h-4 w-4" /> :
                   <span>{i + 1}</span>}
                </div>
                <span className={`text-xs font-medium ${
                  isRejected && isCurrent ? "text-red-600" :
                  isComplete ? "text-emerald-600" :
                  isCurrent ? "text-primary" :
                  "text-muted-foreground"
                }`}>
                  {showLane ? (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-semibold ${laneColor}`}>
                      {laneLabel}
                    </span>
                  ) : step.label}
                </span>
              </div>
              {!isLast && (
                <div className={`flex-1 h-0.5 mx-2 mb-5 rounded-full transition-all ${
                  currentStep > i ? "bg-emerald-400" : "bg-muted"
                }`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: compact progress indicator */}
      <div className="flex sm:hidden items-center gap-3 p-3 bg-muted/30 rounded-lg border">
        <div className="flex gap-1">
          {PROGRESS_STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                isRejected && currentStep === i ? "w-8 bg-red-500" :
                currentStep > i ? "w-8 bg-emerald-500" :
                currentStep === i ? "w-8 bg-primary" :
                "w-4 bg-muted"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium">
          Step {currentStep + 1} of {PROGRESS_STEPS.length}:
          <span className={`ml-1 ${
            isRejected ? "text-red-600" :
            currentStep === PROGRESS_STEPS.length - 1 ? "text-emerald-600" :
            "text-primary"
          }`}>
            {isRejected ? "Rejected" : PROGRESS_STEPS[currentStep]?.label}
          </span>
        </span>
        {laneLabel && (
          <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded border ${laneColor}`}>
            {laneLabel} LANE
          </span>
        )}
      </div>
    </div>
  );
}

// ─── TRADER RATING WIDGET ────────────────────────────────────────────────────

function TraderRatingWidget({ declarationId, traderId }: { declarationId: number; traderId: number }) {
  const { user } = useAuth();
  const [hovered, setHovered] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [showComment, setShowComment] = useState(false);
  const utils = trpc.useUtils();

  const { data: existing, isLoading } = trpc.traderRatings.getMine.useQuery(
    { declarationId },
    { enabled: user?.id === traderId },
  );

  const submitMutation = trpc.traderRatings.submit.useMutation({
    onSuccess: () => {
      toast.success("Thank you for your feedback!");
      utils.traderRatings.getMine.invalidate({ declarationId });
      setShowComment(false);
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return null;

  const currentRating = existing?.rating ?? 0;
  const displayRating = hovered ?? currentRating;

  return (
    <div className="mt-3 pt-3 border-t border-muted/50">
      <p className="text-xs text-muted-foreground mb-2 font-medium">Rate your clearance experience</p>
      <div className="flex items-center gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className="p-0.5 transition-transform hover:scale-110"
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => {
              submitMutation.mutate({ declarationId, rating: star, comment: comment || undefined });
            }}
          >
            <Star
              className={`h-5 w-5 transition-colors ${
                star <= displayRating
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground/40"
              }`}
            />
          </button>
        ))}
        {currentRating > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">{currentRating}/5 — thank you!</span>
        )}
      </div>
      {!existing && (
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          onClick={() => setShowComment((v) => !v)}
        >
          {showComment ? "Hide comment" : "Add a comment (optional)"}
        </button>
      )}
      {showComment && !existing && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            placeholder="Your feedback..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="flex-1 h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
        </div>
      )}
      {existing?.comment && (
        <p className="text-xs text-muted-foreground italic mt-1">"{existing.comment}"</p>
      )}
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function DeclarationDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [certLoading, setCertLoading] = useState(false);
  const [pdfExportLoading, setPdfExportLoading] = useState(false);
  const [statusNotes, setStatusNotes] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");

  const declarationId = parseInt(id ?? "0", 10);
  const isOfficer = ["admin", "customs_officer", "inspector"].includes(user?.role ?? "");
  const [selectedOfficerId, setSelectedOfficerId] = useState<string>("");

  const { data: declaration, isLoading, error, refetch } = trpc.declarations.byId.useQuery(
    { id: declarationId },
    { enabled: !!declarationId && !isNaN(declarationId) }
  );

  const { data: timeline, isLoading: timelineLoading } = trpc.declarations.getTimeline.useQuery(
    { id: declarationId },
    { enabled: !!declarationId && !isNaN(declarationId) }
  );

  // Sprint 112: List officers for assignment dropdown
  const { data: officerList } = trpc.declarations.listOfficers.useQuery(undefined, {
    enabled: isOfficer,
  });

  const utils = trpc.useUtils();

  const assignOfficerMutation = trpc.declarations.assignOfficer.useMutation({
    onSuccess: (data) => {
      toast.success(data.officerId ? `Assigned to ${data.officerName}` : "Officer assignment cleared");
      setSelectedOfficerId("");
      utils.declarations.byId.invalidate({ id: declarationId });
      utils.declarations.workload.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateStatusMutation = trpc.declarations.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Declaration status updated");
      setStatusNotes("");
      setSelectedStatus("");
      utils.declarations.byId.invalidate({ id: declarationId });
      utils.declarations.getTimeline.invalidate({ id: declarationId });
      refetch();
    },
    onError: (err) => toast.error("Failed to update status", { description: err.message }),
  });

  const certMutation = trpc.declarations.generateClearanceCertificate.useMutation({
    onSuccess: (result) => {
      setCertLoading(false);
      // Open the certificate in a new tab
      window.open(result.url, "_blank");
      toast.success("Clearance certificate ready", {
        description: `Certificate for ${result.declarationNumber} opened in a new tab.`,
      });
    },
    onError: (err) => {
      setCertLoading(false);
      toast.error("Failed to generate certificate", { description: err.message });
    },
  });

  const handleDownloadCert = () => {
    setCertLoading(true);
    certMutation.mutate({ id: declarationId });
  };

  const exportPdfMutation = trpc.declarations.exportSummaryPDF.useMutation({
    onSuccess: (result) => {
      setPdfExportLoading(false);
      window.open(result.url, "_blank");
      toast.success("Declaration summary ready", {
        description: `PDF for ${result.declarationNumber} opened in a new tab.`,
      });
    },
    onError: (err) => {
      setPdfExportLoading(false);
      toast.error("Export failed", { description: err.message });
    },
  });

  const handleExportPdf = () => {
    setPdfExportLoading(true);
    exportPdfMutation.mutate({ id: declarationId });
  };

  // Cast to any for fields that may not be in the inferred type but exist at runtime
  const decl = declaration as any;
  const statusConf = decl ? STATUS_CONFIG[decl.status as string] ?? STATUS_CONFIG.draft : null;

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation(user?.role === "admin" ? "/app/customs" : "/app/trader")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div className="flex-1">
        {isLoading ? (
          <Skeleton className="h-7 w-48" />
        ) : (
          <h1 className="text-xl font-bold font-mono">
            {decl?.declarationNumber ?? "Declaration"}
          </h1>
        )}
          {decl && (
            <p className="text-sm text-muted-foreground">UCR: {decl.ucr}</p>
          )}
          </div>
          {statusConf && (
            <Badge variant="outline" className={`gap-1.5 ${statusConf.color}`}>
              {statusConf.icon}
              {statusConf.label}
            </Badge>
          )}
        </div>

        {/* Declaration Status Progress Bar — horizontal on desktop, compact on mobile */}
        {decl && !isLoading && (
          <DeclarationProgressBar status={decl.status} riskLane={decl.riskLane} />
        )}

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <Card className="border-destructive/30">
            <CardContent className="p-8 text-center">
              <XCircle className="h-10 w-10 text-destructive/50 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {error.message === "NOT_FOUND" ? "Declaration not found." : "Failed to load declaration."}
              </p>
            </CardContent>
          </Card>
        ) : decl ? (
          <>
            {/* Clearance Timeline */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Clearance Progress
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    {/* PDF Summary Export — available for all statuses */}
                    {decl && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleExportPdf}
                        disabled={pdfExportLoading}
                        className="gap-2 text-muted-foreground hover:text-foreground"
                        title="Export declaration summary as PDF"
                      >
                        {pdfExportLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4" />
                        )}
                        {pdfExportLoading ? "Exporting..." : "Export PDF"}
                      </Button>
                    )}
                    {decl.status === "cleared" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleDownloadCert}
                        disabled={certLoading}
                        className="gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                      >
                        {certLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {certLoading ? "Generating..." : "Download Clearance Certificate"}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {/* Rich tRPC-backed timeline */}
                {timelineLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                        <div className="flex-1 space-y-1">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-64" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : timeline ? (
                  <div className="relative">
                    {/* Vertical connector line */}
                    <div className="absolute left-4 top-4 bottom-4 w-0.5 bg-muted" />
                    <div className="space-y-0">
                      {timeline.steps.map((step, idx) => {
                        const isCompleted = step.status === "completed";
                        const isCurrent = step.status === "current";
                        const isPending = step.status === "pending";
                        const isSkipped = step.status === "skipped";
                        return (
                          <div key={step.key} className="relative flex items-start gap-4 pb-6 last:pb-0">
                            {/* Step circle */}
                            <div className={`relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                              isCompleted ? "bg-emerald-500 border-emerald-500 text-white" :
                              isCurrent ? "bg-primary border-primary text-white shadow-md shadow-primary/30" :
                              isSkipped ? "bg-muted border-muted-foreground/20 text-muted-foreground" :
                              "bg-background border-muted text-muted-foreground"
                            }`}>
                              {isCompleted ? (
                                <CheckCircle2 className="h-4 w-4" />
                              ) : isCurrent ? (
                                <Clock className="h-4 w-4" />
                              ) : (
                                <span className="text-xs font-bold">{idx + 1}</span>
                              )}
                            </div>
                            {/* Step content */}
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex items-center justify-between gap-2">
                                <p className={`text-sm font-semibold ${
                                  isCompleted ? "text-emerald-700" :
                                  isCurrent ? "text-primary" :
                                  isPending ? "text-muted-foreground" :
                                  "text-muted-foreground/50 line-through"
                                }`}>{step.label}</p>
                                {step.timestamp && (
                                  <span className="text-xs text-muted-foreground shrink-0">
                                    {new Date(step.timestamp).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                              {step.notes && (
                                <p className="text-xs text-amber-600 mt-1 italic">“{step.notes}”</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  // Fallback to simple static timeline if tRPC query fails
                  <ClearanceTimeline currentStatus={decl.status} />
                )}
                {statusConf && !timeline && (
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    {statusConf.description}
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Left: Declaration Details */}
              <div className="lg:col-span-2 space-y-4">
                {/* Goods Information */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Package className="h-4 w-4 text-primary" />
                      Goods & Shipment
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailRow label="Declaration Type" value={
                      <Badge variant="outline" className="capitalize">{decl.declarationType}</Badge>
                    } />
                    <DetailRow label="HS Code" value={decl.hsCode} mono />
                    <DetailRow label="Goods Description" value={decl.goodsDescription} />
                    <DetailRow label="Gross Weight" value={`${decl.grossWeight?.toLocaleString()} kg`} />
                    <DetailRow label="Net Weight" value={`${decl.netWeight?.toLocaleString()} kg`} />
                    {decl.numberOfPackages && (
                      <DetailRow label="Packages" value={decl.numberOfPackages.toLocaleString()} />
                    )}
                    {decl.containerNumbers && (
                      <DetailRow label="Containers" value={decl.containerNumbers} mono />
                    )}
                  </CardContent>
                </Card>

                {/* Parties */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      Parties
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailRow label="Importer" value={decl.importerName} />
                    <DetailRow label="Importer TIN" value={decl.importerTin} mono />
                    <DetailRow label="Exporter" value={decl.exporterName} />
                    <DetailRow label="Country of Origin" value={decl.countryOfOrigin} />
                    <DetailRow label="Country of Export" value={decl.countryOfExport} />
                  </CardContent>
                </Card>

                {/* Transport & Route */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Truck className="h-4 w-4 text-primary" />
                      Transport & Route
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailRow label="Mode of Transport" value={
                      <span className="flex items-center gap-1.5">
                        <TransportIcon mode={decl.modeOfTransport} />
                        <span className="capitalize">{decl.modeOfTransport}</span>
                      </span>
                    } />
                    <DetailRow label="Port of Entry" value={decl.portOfEntry} />
                    {decl.vesselName && (
                      <DetailRow label="Vessel / Flight" value={decl.vesselName} />
                    )}
                    {decl.billOfLadingNumber && (
                      <DetailRow label="Bill of Lading" value={decl.billOfLadingNumber} mono />
                    )}
                    {decl.arrivalDate && (
                      <DetailRow label="Arrival Date" value={new Date(decl.arrivalDate).toLocaleDateString()} />
                    )}
                  </CardContent>
                </Card>

                {/* Financial */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <DollarSign className="h-4 w-4 text-primary" />
                      Financial
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailRow
                      label="Invoice Value"
                      value={`${decl.invoiceCurrency} ${decl.invoiceValue?.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                    />
                    {decl.freightCost && (
                      <DetailRow label="Freight Cost" value={`${decl.invoiceCurrency} ${decl.freightCost.toLocaleString()}`} />
                    )}
                    {decl.insuranceCost && (
                      <DetailRow label="Insurance" value={`${decl.invoiceCurrency} ${decl.insuranceCost.toLocaleString()}`} />
                    )}
                    <DetailRow label="Incoterms" value={decl.incoterms} />
                    {decl.dutyAmount && (
                      <>
                        <Separator className="my-2" />
                        <DetailRow
                          label="Total Duties Assessed"
                          value={
                            <span className="font-bold text-primary">
                              GHS {decl.dutyAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          }
                        />
                      </>
                    )}
                    {decl.paymentReference && (
                      <DetailRow label="Payment Reference" value={decl.paymentReference} mono />
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right: Risk & Clearance */}
              <div className="space-y-4">
                {/* Risk Score */}
                {(decl.riskScore !== null && decl.riskScore !== undefined) && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        Risk Assessment
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col items-center gap-4">
                      <RiskScoreGauge score={decl.riskScore} lane={decl.lane} />
                      {decl.riskFactors && Array.isArray(decl.riskFactors) && decl.riskFactors.length > 0 && (
                        <div className="w-full space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Risk Factors</p>
                          {(decl.riskFactors as Array<{ name: string; weight: number; description: string }>).map((f, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                              <div>
                                <p className="text-xs font-medium">{f.name}</p>
                                <p className="text-xs text-muted-foreground">{f.description}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Clearance Info */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold flex items-center gap-2">
                      <Globe className="h-4 w-4 text-primary" />
                      Clearance Info
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <DetailRow label="Submitted" value={new Date(decl.createdAt).toLocaleString()} />
                    <DetailRow label="Last Updated" value={new Date(decl.updatedAt).toLocaleString()} />
                    {decl.clearedAt && (
                      <DetailRow label="Cleared At" value={new Date(decl.clearedAt).toLocaleString()} />
                    )}
                    {/* Trader satisfaction rating — shown only to the owning trader on cleared declarations */}
                    {decl.status === "cleared" && user?.id === decl.traderId && (
                      <TraderRatingWidget declarationId={decl.id} traderId={decl.traderId} />
                    )}
                    {decl.permitNumber && (
                      <>
                        <Separator className="my-2" />
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-center">
                          <p className="text-xs text-emerald-600 font-medium mb-1">Clearance Permit</p>
                          <p className="font-mono font-bold text-emerald-700">{decl.permitNumber}</p>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Documents */}
                {decl.documents && Array.isArray(decl.documents) && decl.documents.length > 0 && (
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary" />
                        Documents
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {(decl.documents as Array<{ name: string; url: string; type: string }>).map((doc, i) => (
                        <a
                          key={i}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                          <FileText className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{doc.name || doc.type}</span>
                        </a>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Notes */}
                {decl.notes && (
                  <Card className="border-amber-200 bg-amber-50/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold text-amber-700 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Customs Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-amber-800">{decl.notes}</p>
                    </CardContent>
                  </Card>
                )}

                {/* Officer Action Panel */}
                {isOfficer && !(["cleared", "rejected", "cancelled"] as string[]).includes(decl.status) && (
                  <Card className="border-primary/30 bg-primary/5">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary" />
                        Officer Actions
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Sprint 112: Assign Officer */}
                      {officerList && officerList.length > 0 && (
                        <div className="space-y-1.5">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Assign Officer</p>
                          <div className="flex gap-2">
                            <Select
                              value={selectedOfficerId}
                              onValueChange={setSelectedOfficerId}
                            >
                              <SelectTrigger className="flex-1">
                                <SelectValue placeholder={
                                  decl.assignedOfficerId
                                    ? (officerList.find(o => o.id === decl.assignedOfficerId)?.name ?? `Officer #${decl.assignedOfficerId}`)
                                    : "Unassigned — select officer..."
                                } />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassign">— Unassign —</SelectItem>
                                {officerList.map(o => (
                                  <SelectItem key={o.id} value={String(o.id)}>
                                    {o.name} <span className="text-muted-foreground text-xs ml-1">({o.role})</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!selectedOfficerId || assignOfficerMutation.isPending}
                              onClick={() => {
                                if (!selectedOfficerId) return;
                                assignOfficerMutation.mutate({
                                  declarationId,
                                  officerId: selectedOfficerId === "unassign" ? null : parseInt(selectedOfficerId, 10),
                                });
                              }}
                            >
                              {assignOfficerMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Assign"}
                            </Button>
                          </div>
                          {decl.assignedOfficerId && (
                            <p className="text-xs text-muted-foreground">
                              Currently assigned to: <span className="font-medium text-foreground">{officerList.find(o => o.id === decl.assignedOfficerId)?.name ?? `Officer #${decl.assignedOfficerId}`}</span>
                            </p>
                          )}
                        </div>
                      )}
                      <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select new status..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="docs_required">Request Documents</SelectItem>
                          <SelectItem value="payment_pending">Assess Duties (Payment Pending)</SelectItem>
                          <SelectItem value="under_examination">Send for Physical Examination</SelectItem>
                          <SelectItem value="examination_complete">Mark Examination Complete</SelectItem>
                          <SelectItem value="cleared">Clear Declaration</SelectItem>
                          <SelectItem value="rejected">Reject Declaration</SelectItem>
                        </SelectContent>
                      </Select>
                      <Textarea
                        placeholder="Officer notes (optional)..."
                        value={statusNotes}
                        onChange={(e) => setStatusNotes(e.target.value)}
                        rows={2}
                        className="text-sm"
                      />
                      <Button
                        className="w-full"
                        disabled={!selectedStatus || updateStatusMutation.isPending}
                        onClick={() => {
                          if (!selectedStatus) return;
                          updateStatusMutation.mutate({
                            id: declarationId,
                            status: selectedStatus as any,
                            notes: statusNotes || undefined,
                          });
                        }}
                      >
                        {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Update Status
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </>
        ) : null}

        {/* Attached Documents from Document Vault */}
        {declarationId > 0 && <AttachedDocuments declarationId={declarationId} declarationStatus={decl?.status ?? ""} />}
        {/* Declaration Amendments */}
        {declarationId > 0 && <DeclarationAmendmentsPanel declarationId={declarationId} declarationStatus={decl?.status ?? ""} isOfficer={isOfficer} />}
        {/* KYC History */}
        {declarationId > 0 && <KycHistoryPanel declarationId={declarationId} />}
      </div>
    </DashboardLayout>
  );
}

// ─── KYC History Panel ───────────────────────────────────────────────────────

const RISK_LEVEL_COLORS: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  high: "bg-red-100 text-red-700 border-red-200",
  critical: "bg-red-200 text-red-800 border-red-300",
};

const KYC_STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700 border-slate-200",
  approved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  rejected: "bg-red-100 text-red-700 border-red-200",
  flagged: "bg-amber-100 text-amber-700 border-amber-200",
  more_info: "bg-blue-100 text-blue-700 border-blue-200",
};

function KycHistoryPanel({ declarationId }: { declarationId: number }) {
  const { data, isLoading, error } = trpc.kyc.getKycEventsByDeclaration.useQuery(
    { declarationId },
    { enabled: declarationId > 0 }
  );

  if (isLoading) {
    return (
      <Card className="mt-6">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> KYC History</CardTitle></CardHeader>
        <CardContent><div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div></CardContent>
      </Card>
    );
  }

  if (error || !data || data.length === 0) {
    return (
      <Card className="mt-6">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> KYC History</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error ? "Failed to load KYC events." : "No KYC events recorded for this declaration."}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          KYC History
          <Badge variant="outline" className="ml-2">{data.length} event{data.length !== 1 ? "s" : ""}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />
          <div className="space-y-4">
            {data.map((evt, idx) => (
              <div key={evt.id ?? idx} className="relative flex gap-4 pl-10">
                {/* Timeline dot */}
                <div className="absolute left-2.5 top-2 w-3 h-3 rounded-full border-2 border-primary bg-background" />
                <div className="flex-1 min-w-0 border rounded-lg p-3 bg-muted/20">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-sm font-semibold capitalize">
                      {(evt.documentType ?? "Unknown").replace(/_/g, " ")}
                    </span>
                    {evt.riskLevel && (
                      <Badge variant="outline" className={`text-xs ${RISK_LEVEL_COLORS[evt.riskLevel] ?? ""}`}>
                        {evt.riskLevel.toUpperCase()}
                      </Badge>
                    )}
                    {evt.status && (
                      <Badge variant="outline" className={`text-xs ${KYC_STATUS_COLORS[evt.status] ?? ""}`}>
                        {evt.status.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {evt.riskScore != null && (
                      <span className="text-xs text-muted-foreground ml-auto">Risk score: {evt.riskScore}</span>
                    )}
                  </div>
                  {evt.errorMessage && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{evt.errorMessage}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {evt.createdAt ? new Date(evt.createdAt).toLocaleString() : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Declaration Amendments Panel ───────────────────────────────────────────

function DeclarationAmendmentsPanel({ declarationId, declarationStatus, isOfficer }: {
  declarationId: number;
  declarationStatus: string;
  isOfficer: boolean;
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [showForm, setShowForm] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  const { data: amendments, isLoading } = trpc.declarationAmendments.listByDeclaration.useQuery(
    { declarationId },
    { enabled: !!declarationId }
  );

  const requestMutation = trpc.declarationAmendments.requestAmendment.useMutation({
    onSuccess: () => {
      toast.success("Amendment request submitted");
      setShowForm(false);
      setFieldName(""); setNewValue(""); setReason("");
      utils.declarationAmendments.listByDeclaration.invalidate({ declarationId });
    },
    onError: (err) => toast.error("Failed to submit amendment", { description: err.message }),
  });

  const reviewMutation = trpc.declarationAmendments.reviewAmendment.useMutation({
    onSuccess: (data) => {
      toast.success(`Amendment ${data.status}`);
      setReviewingId(null); setReviewNotes("");
      utils.declarationAmendments.listByDeclaration.invalidate({ declarationId });
    },
    onError: (err) => toast.error("Review failed", { description: err.message }),
  });

  const canRequest = declarationStatus === "cleared" || isOfficer;

  const AMENDMENT_FIELDS = [
    "goodsDescription", "hsCode", "countryOfOrigin", "portOfEntry",
    "grossWeight", "netWeight", "numberOfPackages", "invoiceValue", "invoiceCurrency",
  ];

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Declaration Amendments
          {amendments && amendments.length > 0 && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">({amendments.length})</span>
          )}
          {canRequest && (
            <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => setShowForm(v => !v)}>
              {showForm ? "Cancel" : "+ Request Amendment"}
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && (
          <div className="rounded-lg border border-border/60 p-4 bg-muted/20 space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Amendment Request</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Field to Amend</label>
                <select
                  value={fieldName}
                  onChange={e => setFieldName(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="">Select field…</option>
                  {AMENDMENT_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">New Value</label>
                <input
                  type="text"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder="Enter new value"
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Reason (min 10 chars)</label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="Explain why this amendment is needed…"
                className="text-xs min-h-[60px]"
              />
            </div>
            <Button
              size="sm"
              disabled={!fieldName || !newValue || reason.length < 10 || requestMutation.isPending}
              onClick={() => requestMutation.mutate({ declarationId, fieldName, newValue, reason })}
            >
              {requestMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Submit Request
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : !amendments || amendments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No amendment requests yet.</p>
        ) : (
          <div className="space-y-2">
            {amendments.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-border/40 p-3 text-sm">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={
                      a.status === "approved" ? "text-emerald-700 border-emerald-300 bg-emerald-50" :
                      a.status === "rejected" ? "text-red-700 border-red-300 bg-red-50" :
                      "text-amber-700 border-amber-300 bg-amber-50"
                    }>{a.status}</Badge>
                    <span className="font-mono text-xs font-semibold">{a.fieldName}</span>
                    <span className="text-muted-foreground text-xs">→</span>
                    <span className="font-medium text-xs">{a.newValue}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{new Date(a.requestedAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{a.reason}</p>
                {a.reviewNotes && <p className="text-xs text-muted-foreground mt-1 italic">Review: {a.reviewNotes}</p>}
                {isOfficer && a.status === "pending" && (
                  <div className="mt-2 space-y-2">
                    {reviewingId === a.id ? (
                      <div className="flex gap-2 items-end">
                        <input
                          type="text"
                          placeholder="Review notes (optional)"
                          value={reviewNotes}
                          onChange={e => setReviewNotes(e.target.value)}
                          className="h-7 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                        />
                        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                          disabled={reviewMutation.isPending}
                          onClick={() => reviewMutation.mutate({ amendmentId: a.id, decision: "approved", reviewNotes })}
                        >Approve</Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-300"
                          disabled={reviewMutation.isPending}
                          onClick={() => reviewMutation.mutate({ amendmentId: a.id, decision: "rejected", reviewNotes })}
                        >Reject</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setReviewingId(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReviewingId(a.id)}>Review</Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Attached Documents Panel ────────────────────────────────────────────────

function getDocFileIcon(mimeType: string) {
  if (mimeType?.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
  if (mimeType?.includes("zip") || mimeType?.includes("tar") || mimeType?.includes("gzip"))
    return <Archive className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
}

function formatDocBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** All categories must match the server-side DOCUMENT_CATEGORIES enum in documentVault.ts */
const UPLOAD_CATEGORIES: { value: string; label: string; group: string }[] = [
  // Trade documents
  { value: "commercial_invoice",   label: "Commercial Invoice",        group: "Trade Documents" },
  { value: "bill_of_lading",       label: "Bill of Lading",            group: "Trade Documents" },
  { value: "packing_list",         label: "Packing List",              group: "Trade Documents" },
  { value: "certificate_of_origin",label: "Certificate of Origin",     group: "Trade Documents" },
  { value: "insurance_cert",       label: "Insurance Certificate",     group: "Trade Documents" },
  // Regulatory & permits
  { value: "phytosanitary_cert",   label: "Phytosanitary Certificate", group: "Regulatory" },
  { value: "import_permit",        label: "Import Permit",             group: "Regulatory" },
  { value: "export_permit",        label: "Export Permit",             group: "Regulatory" },
  { value: "customs_bond",         label: "Customs Bond",              group: "Regulatory" },
  // Compliance & KYC
  { value: "kyc_identity",         label: "KYC — Identity",            group: "Compliance" },
  { value: "kyc_business",         label: "KYC — Business",            group: "Compliance" },
  { value: "aeo_supporting",       label: "AEO Supporting Document",   group: "Compliance" },
  { value: "post_clearance",       label: "Post-Clearance Audit",      group: "Compliance" },
  // General
  { value: "correspondence",       label: "Correspondence",            group: "General" },
  { value: "other",                label: "Other",                     group: "General" },
];

function AttachedDocuments({ declarationId, declarationStatus }: { declarationId: number; declarationStatus: string }) {
  const { user } = useAuth();
  const [isDragging, setIsDragging] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<string>("other");
  const [uploadDescription, setUploadDescription] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Upload is allowed for officers always; for traders on non-terminal statuses
  const isOfficer = ["admin", "customs_officer", "inspector", "oga_officer"].includes(user?.role ?? "");
  const terminalStatuses = ["cleared", "rejected", "cancelled"];
  const canUpload = isOfficer || !terminalStatuses.includes(declarationStatus);

  const { data: docs, isLoading, refetch } = trpc.documentVault.listByDeclaration.useQuery(
    { declarationId },
    { enabled: declarationId > 0 }
  );

  // Use a ref so processFile closure always reads the latest replaceDocId
  const replaceDocIdRef = useRef<number | null>(null);

  const archiveVersionMutation = trpc.documentVault.archiveVersion.useMutation();

  const uploadMutation = trpc.documentVault.upload.useMutation({
    onSuccess: () => {
      // If this was a replace operation, archive then soft-delete the old doc
      if (replaceDocIdRef.current !== null) {
        const oldId = replaceDocIdRef.current;
        replaceDocIdRef.current = null;
        // Archive version first (best-effort), then delete
        archiveVersionMutation.mutate(
          { documentId: oldId, reason: "Replaced via upload dropzone" },
          { onSettled: () => deleteDoc.mutate({ id: oldId }) }
        );
        toast.success("Document replaced", { description: "Previous version archived, new file attached." });
      } else {
        toast.success("Document uploaded", { description: "File attached to this declaration." });
      }
      refetch();
      setUploadDescription("");
      setUploadCategory("other");
      setReplaceDocId(null);
    },
    onError: (err) => {
      replaceDocIdRef.current = null;
      setReplaceDocId(null);
      toast.error("Upload failed", { description: err.message });
    },
  });

  const processFile = useCallback(async (file: File) => {
    const MAX_SIZE = 20 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      toast.error("File too large", { description: "Maximum file size is 20 MB." });
      return;
    }
    // Capture the replaceDocId into the ref so the onSuccess closure can read it
    replaceDocIdRef.current = replaceDocId;
    setIsUploading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      await uploadMutation.mutateAsync({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        fileData: base64,
        sizeBytes: file.size,
        category: uploadCategory as any,
        accessLevel: "shared_with_customs",
        description: uploadDescription || undefined,
        declarationId,
      });
    } catch { /* handled by onError */ } finally {
      setIsUploading(false);
    }
  }, [uploadMutation, uploadCategory, uploadDescription, declarationId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }, [processFile]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processFile]);

  const download = trpc.documentVault.download.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("Download ready", { description: "Presigned link expires in 1 hour." });
    },
    onError: (err) => toast.error("Download failed", { description: err.message }),
  });

  // Sprint 117: soft-delete a document
  const deleteDoc = trpc.documentVault.delete.useMutation({
    onSuccess: () => {
      toast.success("Document removed", { description: "The document has been deleted." });
      refetch();
    },
    onError: (err) => toast.error("Delete failed", { description: err.message }),
  });

  // Officers can delete any doc; traders can only delete their own (handled server-side, show button for all)
  const canDelete = isOfficer || !terminalStatuses.includes(declarationStatus);

  // Sprint 118: Replace — tracks which doc is being replaced so we can delete it after upload
  const [replaceDocId, setReplaceDocId] = useState<number | null>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const handleReplace = useCallback((doc: any) => {
    // Pre-fill category and description from the doc being replaced
    setUploadCategory(doc.category ?? "other");
    setUploadDescription(doc.description ?? "");
    setReplaceDocId(doc.id);
    // Scroll to and focus the dropzone
    setTimeout(() => {
      dropzoneRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      fileInputRef.current?.click();
    }, 100);
  }, []);

  if (!isLoading && (!docs || docs.length === 0) && !canUpload) return null;

  return (
    <Card className="mt-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FolderLock className="h-4 w-4 text-primary" />
          Attached Documents
          {docs && docs.length > 0 && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">({docs.length})</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 w-7 p-0"
            onClick={() => refetch()}
          >
            <RefreshCwIcon className="h-3.5 w-3.5" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Upload Dropzone */}
        {canUpload && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2 mb-2">
              <select
                value={uploadCategory}
                onChange={e => setUploadCategory(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {UPLOAD_CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Description (optional)"
                value={uploadDescription}
                onChange={e => setUploadDescription(e.target.value)}
                className="h-8 flex-1 min-w-32 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {replaceDocId !== null && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs mb-1">
                <RefreshCwIcon className="h-3 w-3 flex-shrink-0" />
                <span>Replacing document — select a new file below. The old file will be deleted on upload.</span>
                <button type="button" className="ml-auto underline" onClick={() => { setReplaceDocId(null); replaceDocIdRef.current = null; }}>Cancel</button>
              </div>
            )}
            <div
              ref={dropzoneRef}
              role="button"
              tabIndex={0}
              aria-label="Upload document — click or drag a file here"
              className={`relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed transition-colors cursor-pointer p-4 ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border/60 hover:border-primary/60 hover:bg-muted/30"
              } ${isUploading ? "pointer-events-none opacity-60" : ""}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={e => e.key === "Enter" && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.zip,.tar,.gz"
                onChange={handleFileChange}
              />
              {isUploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground">Uploading…</p>
                </>
              ) : (
                <>
                  <Download className="h-5 w-5 text-muted-foreground rotate-180" />
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-primary">Click to upload</span> or drag &amp; drop
                  </p>
                  <p className="text-[10px] text-muted-foreground/70">PDF, Word, Excel, Images, ZIP — max 20 MB</p>
                </>
              )}
            </div>
          </div>
        )}
        {isLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <GroupedDocumentList docs={docs ?? []} download={download} deleteDoc={deleteDoc} canDelete={canDelete} userId={user?.id} onReplace={canDelete ? handleReplace : undefined} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Grouped Document List ────────────────────────────────────────────────────
// Groups documents by their category and renders each group as a collapsible section.
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  UPLOAD_CATEGORIES.map(c => [c.value, c.label])
);
const GROUP_ORDER = ["Trade Documents", "Regulatory", "Compliance", "General"];

function GroupedDocumentList({ docs, download, deleteDoc, canDelete, userId, onReplace }: {
  docs: any[];
  download: any;
  deleteDoc: any;
  canDelete: boolean;
  userId?: number;
  onReplace?: (doc: any) => void;
}) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  // Build a map: group → docs
  const grouped = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const doc of docs) {
      const catMeta = UPLOAD_CATEGORIES.find(c => c.value === doc.category);
      const group = catMeta?.group ?? "General";
      if (!map[group]) map[group] = [];
      map[group].push(doc);
    }
    return map;
  }, [docs]);

  const orderedGroups = [
    ...GROUP_ORDER.filter(g => grouped[g]),
    ...Object.keys(grouped).filter(g => !GROUP_ORDER.includes(g)),
  ];

  // Track which groups are collapsed
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (group: string) => setCollapsed(prev => ({ ...prev, [group]: !prev[group] }));

  if (docs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No documents attached yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {orderedGroups.map(group => {
        const groupDocs = grouped[group] ?? [];
        const isCollapsed = collapsed[group] ?? false;
        return (
          <div key={group} className="rounded-lg border border-border/40 overflow-hidden">
            {/* Group header */}
            <button
              type="button"
              onClick={() => toggle(group)}
              className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wide">{group}</span>
                <span className="text-xs text-muted-foreground font-normal">({groupDocs.length})</span>
              </div>
              <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`} />
            </button>
            {/* Group items */}
            {!isCollapsed && (
              <div className="divide-y divide-border/30">
                {groupDocs.map((doc: any) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-3 px-3 py-2.5 bg-card/20 hover:bg-card/50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center bg-primary/10 text-primary">
                      {getDocFileIcon(doc.mimeType)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{doc.filename}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-muted-foreground">{formatDocBytes(doc.sizeBytes)}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(doc.createdAt).toLocaleDateString()}
                        </span>
                        {doc.category && doc.category !== "other" && (
                          <>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">
                              {CATEGORY_LABEL[doc.category] ?? doc.category}
                            </span>
                          </>
                        )}
                        {doc.description && (
                          <>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{doc.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 flex-shrink-0"
                      title="Download"
                      onClick={() => download.mutate({ id: doc.id })}
                      disabled={download.isPending}
                    >
                      {download.isPending
                        ? <RefreshCwIcon className="h-3 w-3 animate-spin" />
                        : <Download className="h-3 w-3" />}
                    </Button>
                    {onReplace && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-amber-600"
                        title="Replace document"
                        onClick={() => onReplace(doc)}
                      >
                        <RefreshCwIcon className="h-3 w-3" />
                      </Button>
                    )}
                    {canDelete && (
                      confirmDeleteId === doc.id ? (
                        // Inline confirmation
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => { deleteDoc.mutate({ id: doc.id }); setConfirmDeleteId(null); }}
                            disabled={deleteDoc.isPending}
                          >
                            {deleteDoc.isPending ? <RefreshCwIcon className="h-3 w-3 animate-spin" /> : "Confirm"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 flex-shrink-0 text-muted-foreground hover:text-destructive"
                          title="Delete document"
                          onClick={() => setConfirmDeleteId(doc.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
