/**
 * DeclarationStatusTracker
 * Vertical timeline on mobile, horizontal progress bar on desktop.
 * Shows the full lifecycle of a customs declaration.
 */
import { cn } from "@/lib/utils";
import {
  CheckCircle2, Circle, Clock, AlertTriangle,
  FileText, Search, CreditCard, Stamp, PackageCheck, XCircle,
} from "lucide-react";

export type DeclarationStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "risk_assessment"
  | "pending_payment"
  | "payment_confirmed"
  | "examination_required"
  | "cleared"
  | "rejected";

interface Step {
  id: DeclarationStatus;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  description: string;
}

const STEPS: Step[] = [
  {
    id: "draft",
    label: "Draft",
    shortLabel: "Draft",
    icon: <FileText className="w-4 h-4" />,
    description: "Declaration saved as draft",
  },
  {
    id: "submitted",
    label: "Submitted",
    shortLabel: "Submitted",
    icon: <FileText className="w-4 h-4" />,
    description: "Declaration submitted to customs",
  },
  {
    id: "under_review",
    label: "Under Review",
    shortLabel: "Review",
    icon: <Search className="w-4 h-4" />,
    description: "Customs officer reviewing documents",
  },
  {
    id: "risk_assessment",
    label: "Risk Assessment",
    shortLabel: "Risk",
    icon: <Search className="w-4 h-4" />,
    description: "AI risk engine scoring declaration",
  },
  {
    id: "pending_payment",
    label: "Pending Payment",
    shortLabel: "Payment",
    icon: <CreditCard className="w-4 h-4" />,
    description: "Awaiting duty payment",
  },
  {
    id: "payment_confirmed",
    label: "Payment Confirmed",
    shortLabel: "Paid",
    icon: <CreditCard className="w-4 h-4" />,
    description: "Duty payment received",
  },
  {
    id: "cleared",
    label: "Cleared",
    shortLabel: "Cleared",
    icon: <PackageCheck className="w-4 h-4" />,
    description: "Goods cleared for release",
  },
];

const TERMINAL_STEPS: Step[] = [
  {
    id: "examination_required",
    label: "Examination Required",
    shortLabel: "Exam",
    icon: <AlertTriangle className="w-4 h-4" />,
    description: "Physical examination scheduled",
  },
  {
    id: "rejected",
    label: "Rejected",
    shortLabel: "Rejected",
    icon: <XCircle className="w-4 h-4" />,
    description: "Declaration rejected",
  },
];

function getStepState(
  stepId: DeclarationStatus,
  currentStatus: DeclarationStatus,
  steps: Step[]
): "completed" | "current" | "pending" | "skipped" {
  if (currentStatus === "rejected" || currentStatus === "examination_required") {
    if (stepId === currentStatus) return "current";
    const mainIdx = steps.findIndex(s => s.id === stepId);
    const currentMainIdx = steps.findIndex(s => s.id === currentStatus);
    if (mainIdx >= 0 && currentMainIdx >= 0) {
      return mainIdx < currentMainIdx ? "completed" : "pending";
    }
    return "skipped";
  }
  const stepIdx = steps.findIndex(s => s.id === stepId);
  const currentIdx = steps.findIndex(s => s.id === currentStatus);
  if (stepIdx < 0 || currentIdx < 0) return "pending";
  if (stepIdx < currentIdx) return "completed";
  if (stepIdx === currentIdx) return "current";
  return "pending";
}

function StepIcon({
  state,
  icon,
}: {
  state: "completed" | "current" | "pending" | "skipped";
  icon: React.ReactNode;
}) {
  if (state === "completed") {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-600 text-white ring-2 ring-emerald-200">
        <CheckCircle2 className="w-4 h-4" />
      </span>
    );
  }
  if (state === "current") {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white ring-2 ring-blue-200 animate-pulse">
        <Clock className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-full bg-muted text-muted-foreground ring-1 ring-border">
      <Circle className="w-4 h-4" />
    </span>
  );
}

interface Props {
  status: DeclarationStatus;
  riskLane?: "GREEN" | "YELLOW" | "RED" | null;
  className?: string;
}

export default function DeclarationStatusTracker({ status, riskLane, className }: Props) {
  const isTerminal = status === "rejected" || status === "examination_required";
  const displaySteps = STEPS;

  const currentIdx = displaySteps.findIndex(s => s.id === status);
  const progressPct = isTerminal
    ? Math.max(0, (displaySteps.findIndex(s => s.id === "risk_assessment") / (displaySteps.length - 1)) * 100)
    : currentIdx >= 0
    ? (currentIdx / (displaySteps.length - 1)) * 100
    : 0;

  const laneColor =
    riskLane === "GREEN" ? "text-emerald-600 bg-emerald-50 border-emerald-200" :
    riskLane === "YELLOW" ? "text-amber-600 bg-amber-50 border-amber-200" :
    riskLane === "RED" ? "text-red-600 bg-red-50 border-red-200" : "";

  return (
    <div className={cn("w-full", className)}>
      {/* Risk lane badge */}
      {riskLane && (
        <div className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border mb-4", laneColor)}>
          <span className={cn("w-2 h-2 rounded-full",
            riskLane === "GREEN" ? "bg-emerald-500" :
            riskLane === "YELLOW" ? "bg-amber-500" : "bg-red-500"
          )} />
          {riskLane} LANE
        </div>
      )}

      {/* ── Desktop: horizontal progress bar ─────────────────────────────── */}
      <div className="hidden md:block">
        {/* Progress bar */}
        <div className="relative mb-2">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-border" />
          <div
            className="absolute top-4 left-4 h-0.5 bg-emerald-500 transition-all duration-700"
            style={{ width: `calc(${progressPct}% * (100% - 2rem) / 100)` }}
          />
          <div className="relative flex justify-between">
            {displaySteps.map((step) => {
              const state = getStepState(step.id, status, displaySteps);
              return (
                <div key={step.id} className="flex flex-col items-center gap-1.5 min-w-0">
                  <StepIcon state={state} icon={step.icon} />
                  <span className={cn("text-xs font-medium text-center leading-tight max-w-[64px]",
                    state === "completed" ? "text-emerald-700" :
                    state === "current" ? "text-blue-700" : "text-muted-foreground"
                  )}>
                    {step.shortLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Terminal state */}
        {isTerminal && (
          <div className={cn("mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
            status === "rejected" ? "bg-red-50 text-red-700 border border-red-200" :
            "bg-amber-50 text-amber-700 border border-amber-200"
          )}>
            {status === "rejected" ? <XCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {status === "rejected" ? "Declaration rejected — contact customs for details" : "Physical examination required — await inspection appointment"}
          </div>
        )}
      </div>

      {/* ── Mobile: vertical timeline ─────────────────────────────────────── */}
      <div className="md:hidden">
        <ol className="relative border-l border-border ml-4">
          {displaySteps.map((step, idx) => {
            const state = getStepState(step.id, status, displaySteps);
            return (
              <li key={step.id} className={cn("mb-6 ml-6", idx === displaySteps.length - 1 && "mb-0")}>
                <span className={cn(
                  "absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-background",
                  state === "completed" ? "bg-emerald-600 text-white" :
                  state === "current" ? "bg-blue-600 text-white" : "bg-muted text-muted-foreground"
                )}>
                  {state === "completed" ? <CheckCircle2 className="w-3 h-3" /> :
                   state === "current" ? <Clock className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
                </span>
                <div className="flex flex-col gap-0.5">
                  <p className={cn("text-sm font-semibold",
                    state === "completed" ? "text-emerald-700" :
                    state === "current" ? "text-blue-700" : "text-muted-foreground"
                  )}>
                    {step.label}
                  </p>
                  {state === "current" && (
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                  )}
                </div>
              </li>
            );
          })}

          {isTerminal && (
            <li className="mb-0 ml-6">
              <span className={cn(
                "absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full ring-2 ring-background",
                status === "rejected" ? "bg-red-600 text-white" : "bg-amber-600 text-white"
              )}>
                {status === "rejected" ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              </span>
              <p className={cn("text-sm font-semibold",
                status === "rejected" ? "text-red-700" : "text-amber-700"
              )}>
                {status === "rejected" ? "Rejected" : "Examination Required"}
              </p>
              <p className="text-xs text-muted-foreground">
                {status === "rejected" ? "Contact customs for details" : "Physical inspection scheduled"}
              </p>
            </li>
          )}
        </ol>
      </div>
    </div>
  );
}
