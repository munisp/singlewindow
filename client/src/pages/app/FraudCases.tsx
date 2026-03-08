/**
 * Fraud Cases Management Page
 *
 * Features:
 *   - Case list with status/priority filters
 *   - Create new case modal
 *   - Case detail side-panel with notes and evidence
 *   - Status workflow transitions
 *   - Add investigator notes
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Gavel,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Shield,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type CaseStatus =
  | "open"
  | "under_review"
  | "escalated"
  | "closed_confirmed"
  | "closed_cleared"
  | "referred_prosecution";

type CasePriority = "low" | "medium" | "high" | "critical";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<CaseStatus, string> = {
  open: "Open",
  under_review: "Under Review",
  escalated: "Escalated",
  closed_confirmed: "Closed — Confirmed",
  closed_cleared: "Closed — Cleared",
  referred_prosecution: "Referred to Prosecution",
};

const STATUS_COLORS: Record<CaseStatus, string> = {
  open: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  under_review: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  escalated: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  closed_confirmed: "bg-red-500/20 text-red-300 border-red-500/30",
  closed_cleared: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  referred_prosecution: "bg-purple-500/20 text-purple-300 border-purple-500/30",
};

const PRIORITY_COLORS: Record<CasePriority, string> = {
  low: "bg-slate-500/20 text-slate-300 border-slate-500/30",
  medium: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  high: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  critical: "bg-red-500/20 text-red-300 border-red-500/30",
};

const STATUS_ICON: Record<CaseStatus, React.ReactNode> = {
  open: <Clock size={12} />,
  under_review: <RefreshCw size={12} />,
  escalated: <AlertTriangle size={12} />,
  closed_confirmed: <XCircle size={12} />,
  closed_cleared: <CheckCircle2 size={12} />,
  referred_prosecution: <Gavel size={12} />,
};

const NEXT_STATUSES: Record<CaseStatus, CaseStatus[]> = {
  open: ["under_review", "escalated", "closed_cleared"],
  under_review: ["escalated", "closed_confirmed", "closed_cleared", "referred_prosecution"],
  escalated: ["under_review", "closed_confirmed", "referred_prosecution"],
  closed_confirmed: [],
  closed_cleared: [],
  referred_prosecution: [],
};

// ─── CREATE CASE DIALOG ───────────────────────────────────────────────────────

function CreateCaseDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [traderId, setTraderId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<CasePriority>("medium");

  const utils = trpc.useUtils();
  const createCase = trpc.fraudCases.createCase.useMutation({
    onSuccess: () => {
      toast.success("Fraud case created");
      utils.fraudCases.listCases.invalidate();
      utils.fraudCases.caseStats.invalidate();
      setOpen(false);
      setTraderId("");
      setTitle("");
      setDescription("");
      setPriority("medium");
      onCreated();
    },
    onError: (err) => toast.error(`Failed to create case: ${err.message}`),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2 bg-gold text-navy hover:bg-gold/90 font-semibold">
          <Plus size={14} />
          New Case
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-navy-900 border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">Open Fraud Investigation Case</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <Label className="text-slate-300 text-xs mb-1 block">Trader ID *</Label>
            <Input
              value={traderId}
              onChange={(e) => setTraderId(e.target.value)}
              placeholder="Numeric trader ID"
              className="bg-navy-800 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-xs mb-1 block">Case Title *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the suspected fraud"
              className="bg-navy-800 border-white/10 text-white"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-xs mb-1 block">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed notes on the suspected fraud pattern..."
              rows={4}
              className="bg-navy-800 border-white/10 text-white resize-none"
            />
          </div>
          <div>
            <Label className="text-slate-300 text-xs mb-1 block">Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as CasePriority)}>
              <SelectTrigger className="bg-navy-800 border-white/10 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-navy-900 border-white/10">
                {(["low", "medium", "high", "critical"] as CasePriority[]).map((p) => (
                  <SelectItem key={p} value={p} className="text-white capitalize">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} className="text-slate-400">
              Cancel
            </Button>
            <Button
              onClick={() =>
                createCase.mutate({
                  traderId: parseInt(traderId, 10),
                  title,
                  description,
                  priority,
                })
              }
              disabled={!traderId || !title || createCase.isPending}
              className="bg-gold text-navy hover:bg-gold/90 font-semibold"
            >
              {createCase.isPending ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
              Create Case
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── CASE DETAIL PANEL ────────────────────────────────────────────────────────

function CaseDetailPanel({
  caseId,
  onClose,
}: {
  caseId: number;
  onClose: () => void;
}) {
  const [noteContent, setNoteContent] = useState("");
  const [newStatus, setNewStatus] = useState<CaseStatus | "">("");
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.fraudCases.getCase.useQuery({ caseId });

  const addNote = trpc.fraudCases.addNote.useMutation({
    onSuccess: () => {
      toast.success("Note added");
      utils.fraudCases.getCase.invalidate({ caseId });
      setNoteContent("");
    },
    onError: (err) => toast.error(`Failed to add note: ${err.message}`),
  });

  const updateStatus = trpc.fraudCases.updateStatus.useMutation({
    onSuccess: () => {
      toast.success("Case status updated");
      utils.fraudCases.getCase.invalidate({ caseId });
      utils.fraudCases.listCases.invalidate();
      utils.fraudCases.caseStats.invalidate();
      setNewStatus("");
    },
    onError: (err) => toast.error(`Failed to update status: ${err.message}`),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="animate-spin text-gold" size={24} />
      </div>
    );
  }

  if (!data) return null;

  const currentStatus = data.status as CaseStatus;
  const nextStatuses = NEXT_STATUSES[currentStatus];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-white/10">
        <div>
          <div className="text-xs font-mono text-gold mb-1">{data.caseNumber}</div>
          <div className="text-base font-bold text-white font-display">{data.title}</div>
          <div className="flex items-center gap-2 mt-2">
            <Badge className={`text-xs border ${STATUS_COLORS[currentStatus]} flex items-center gap-1`}>
              {STATUS_ICON[currentStatus]}
              {STATUS_LABELS[currentStatus]}
            </Badge>
            <Badge className={`text-xs border ${PRIORITY_COLORS[data.priority as CasePriority]} capitalize`}>
              {data.priority}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">
          ✕
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-5 space-y-5">
          {/* Description */}
          {data.description && (
            <div>
              <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">Description</div>
              <p className="text-sm text-slate-300 leading-relaxed">{data.description}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <span className="text-slate-500">Trader ID</span>
              <div className="text-white font-mono mt-0.5">{data.traderId}</div>
            </div>
            <div>
              <span className="text-slate-500">Created</span>
              <div className="text-white mt-0.5">
                {data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "—"}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Risk Score</span>
              <div className="text-white mt-0.5">
                {data.riskScore != null ? Number(data.riskScore).toFixed(2) : "—"}
              </div>
            </div>
            <div>
              <span className="text-slate-500">Last Updated</span>
              <div className="text-white mt-0.5">
                {data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : "—"}
              </div>
            </div>
          </div>

          <Separator className="bg-white/10" />

          {/* Status Transition */}
          {nextStatuses.length > 0 && (
            <div>
              <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">Advance Status</div>
              <div className="flex flex-wrap gap-2">
                {nextStatuses.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant="outline"
                    onClick={() => updateStatus.mutate({ caseId, status: s })}
                    disabled={updateStatus.isPending}
                    className={`text-xs border ${STATUS_COLORS[s]} hover:opacity-80 bg-transparent`}
                  >
                    {STATUS_ICON[s]}
                    <span className="ml-1">{STATUS_LABELS[s]}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Separator className="bg-white/10" />

          {/* Notes */}
          <div>
            <div className="text-xs font-mono tracking-widest text-gold uppercase mb-3 flex items-center gap-2">
              <MessageSquare size={12} />
              Investigator Notes ({data.notes?.length ?? 0})
            </div>
            {data.notes && data.notes.length > 0 ? (
              <div className="space-y-3 mb-4">
                {data.notes.map((note) => (
                  <div
                    key={note.id}
                    className="bg-navy-800/60 border border-white/10 rounded-lg p-3"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-slate-500">
                        {note.createdAt ? new Date(note.createdAt).toLocaleString() : "—"}
                      </span>
                      {note.isInternal && (
                        <Badge className="text-xs bg-slate-700/50 text-slate-400 border-slate-600">
                          Internal
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed">{note.content}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 mb-4">No notes yet.</p>
            )}

            {/* Add Note */}
            <Textarea
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              placeholder="Add an investigator note..."
              rows={3}
              className="bg-navy-800 border-white/10 text-white resize-none text-sm mb-2"
            />
            <Button
              size="sm"
              onClick={() => addNote.mutate({ caseId, content: noteContent })}
              disabled={!noteContent.trim() || addNote.isPending}
              className="bg-gold text-navy hover:bg-gold/90 font-semibold text-xs"
            >
              {addNote.isPending ? <Loader2 size={12} className="animate-spin mr-1" /> : null}
              Add Note
            </Button>
          </div>

          {/* Evidence */}
          {data.evidence && data.evidence.length > 0 && (
            <>
              <Separator className="bg-white/10" />
              <div>
                <div className="text-xs font-mono tracking-widest text-gold uppercase mb-3 flex items-center gap-2">
                  <FileText size={12} />
                  Evidence Files ({data.evidence.length})
                </div>
                <div className="space-y-2">
                  {data.evidence.map((ev) => (
                    <a
                      key={ev.id}
                      href={ev.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300 bg-navy-800/60 border border-white/10 rounded-lg px-3 py-2"
                    >
                      <FileText size={12} />
                      <span className="truncate">{ev.fileName}</span>
                      {ev.fileSizeBytes && (
                        <span className="text-slate-500 ml-auto shrink-0">
                          {(ev.fileSizeBytes / 1024).toFixed(0)} KB
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function FraudCases() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);

  const { data: stats } = trpc.fraudCases.caseStats.useQuery();
  const { data: cases, isLoading, refetch } = trpc.fraudCases.listCases.useQuery({
    status: statusFilter as "all" | "open" | "under_review" | "escalated" | "closed_confirmed" | "closed_cleared" | "referred_prosecution",
    priority: priorityFilter as "all" | "low" | "medium" | "high" | "critical",
  });

  return (
    <DashboardLayout>
      <div className="flex h-full overflow-hidden">
        {/* Main list */}
        <div className={`flex flex-col flex-1 min-w-0 ${selectedCaseId ? "hidden lg:flex" : "flex"}`}>
          {/* Header */}
          <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white font-display flex items-center gap-2">
                <Shield size={20} className="text-gold" />
                Fraud Cases
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">Investigation case management</p>
            </div>
            <CreateCaseDialog onCreated={() => refetch()} />
          </div>

          {/* Stats bar */}
          {stats && (
            <div className="px-6 py-3 border-b border-white/10 flex items-center gap-6 text-xs overflow-x-auto">
              <span className="text-slate-400">
                Total: <span className="text-white font-semibold">{stats.total}</span>
              </span>
              {Object.entries(stats.byStatus).map(([s, count]) => (
                <span key={s} className="flex items-center gap-1 text-slate-400 shrink-0">
                  <span
                    className={`px-1.5 py-0.5 rounded text-xs border ${STATUS_COLORS[s as CaseStatus] ?? "bg-slate-700 text-slate-300"}`}
                  >
                    {STATUS_LABELS[s as CaseStatus] ?? s}
                  </span>
                  <span className="text-white font-semibold">{count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Filters */}
          <div className="px-6 py-3 border-b border-white/10 flex items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44 bg-navy-800 border-white/10 text-white text-xs h-8">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="bg-navy-900 border-white/10">
                <SelectItem value="all" className="text-white text-xs">All Statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as CaseStatus[]).map((s) => (
                  <SelectItem key={s} value={s} className="text-white text-xs">
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36 bg-navy-800 border-white/10 text-white text-xs h-8">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent className="bg-navy-900 border-white/10">
                <SelectItem value="all" className="text-white text-xs">All Priorities</SelectItem>
                {(["low", "medium", "high", "critical"] as CasePriority[]).map((p) => (
                  <SelectItem key={p} value={p} className="text-white text-xs capitalize">
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Case list */}
          <ScrollArea className="flex-1">
            {isLoading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="animate-spin text-gold" size={24} />
              </div>
            ) : !cases?.length ? (
              <div className="flex flex-col items-center justify-center h-60 text-slate-500">
                <Shield size={32} className="mb-3 opacity-30" />
                <p className="text-sm">No fraud cases found</p>
                <p className="text-xs mt-1">Create a new case to begin an investigation</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {cases.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCaseId(c.id)}
                    className={`w-full text-left px-6 py-4 hover:bg-white/5 transition-colors ${
                      selectedCaseId === c.id ? "bg-white/5 border-l-2 border-gold" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-mono text-gold mb-0.5">{c.caseNumber}</div>
                        <div className="text-sm font-medium text-white truncate">{c.title}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Trader {c.traderId} ·{" "}
                          {c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <Badge
                          className={`text-xs border ${STATUS_COLORS[c.status as CaseStatus]} flex items-center gap-1`}
                        >
                          {STATUS_ICON[c.status as CaseStatus]}
                          {STATUS_LABELS[c.status as CaseStatus] ?? c.status}
                        </Badge>
                        <Badge
                          className={`text-xs border ${PRIORITY_COLORS[c.priority as CasePriority]} capitalize`}
                        >
                          {c.priority}
                        </Badge>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Detail panel */}
        {selectedCaseId && (
          <div className="w-full lg:w-[480px] border-l border-white/10 flex flex-col bg-navy-950/50">
            <CaseDetailPanel
              caseId={selectedCaseId}
              onClose={() => setSelectedCaseId(null)}
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
