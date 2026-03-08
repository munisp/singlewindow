/**
 * Post-Clearance Audit Module
 * Customs officers schedule and record audits; traders view their audit status.
 * Ghana ICUMS AEO programme pattern.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  ClipboardCheck, AlertTriangle, CheckCircle2, Clock, TrendingUp,
  DollarSign, Search, Plus, Eye, Edit3, ChevronLeft, ChevronRight,
} from "lucide-react";

// ─── STATUS / OUTCOME BADGES ─────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  in_progress: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  completed: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  escalated: "bg-red-500/20 text-red-300 border-red-500/30",
  closed: "bg-slate-500/20 text-slate-300 border-slate-500/30",
};
const OUTCOME_COLORS: Record<string, string> = {
  compliant: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  minor_discrepancy: "bg-yellow-500/20 text-yellow-300 border-yellow-500/30",
  major_discrepancy: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  fraud_suspected: "bg-red-500/20 text-red-300 border-red-500/30",
  pending: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

function fmt(val: string | null | undefined) {
  if (!val) return "—";
  return parseFloat(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── SCHEDULE DIALOG ─────────────────────────────────────────────────────────
function ScheduleAuditDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [declarationId, setDeclarationId] = useState("");
  const [triggerReason, setTriggerReason] = useState("");

  const schedule = trpc.postAudit.schedule.useMutation({
    onSuccess: () => {
      toast.success("Audit scheduled", { description: "Post-clearance audit has been scheduled." });
      utils.postAudit.list.invalidate();
      utils.postAudit.stats.invalidate();
      onClose();
      setDeclarationId("");
      setTriggerReason("");
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0D1B2E] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">Schedule Post-Clearance Audit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-slate-300">Declaration ID</Label>
            <Input
              type="number"
              value={declarationId}
              onChange={(e) => setDeclarationId(e.target.value)}
              placeholder="e.g. 42"
              className="bg-white/5 border-white/10 text-white mt-1"
            />
          </div>
          <div>
            <Label className="text-slate-300">Trigger Reason</Label>
            <Textarea
              value={triggerReason}
              onChange={(e) => setTriggerReason(e.target.value)}
              placeholder="Describe why this declaration was selected for audit..."
              className="bg-white/5 border-white/10 text-white mt-1 min-h-[100px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-slate-300">Cancel</Button>
          <Button
            onClick={() => schedule.mutate({
              declarationId: parseInt(declarationId),
              triggerReason,
            })}
            disabled={!declarationId || !triggerReason || schedule.isPending}
            className="bg-gold text-navy font-semibold hover:bg-gold/90"
          >
            {schedule.isPending ? "Scheduling…" : "Schedule Audit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── UPDATE DIALOG ────────────────────────────────────────────────────────────
function UpdateAuditDialog({ audit, open, onClose }: {
  audit: { id: number; auditNumber: string; status: string; declaredValue: string | null };
  open: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState(audit.status);
  const [outcome, setOutcome] = useState("pending");
  const [auditedValue, setAuditedValue] = useState("");
  const [additionalDuty, setAdditionalDuty] = useState("");
  const [penalty, setPenalty] = useState("");
  const [findings, setFindings] = useState("");

  const update = trpc.postAudit.update.useMutation({
    onSuccess: () => {
      toast.success("Audit updated", { description: `Audit ${audit.auditNumber} has been updated.` });
      utils.postAudit.list.invalidate();
      utils.postAudit.stats.invalidate();
      onClose();
    },
    onError: (e) => toast.error("Error", { description: e.message }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="bg-[#0D1B2E] border-white/10 text-white max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-gold font-display">Update Audit — {audit.auditNumber}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-slate-300">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0D1B2E] border-white/10">
                  {["scheduled", "in_progress", "completed", "escalated", "closed"].map(s => (
                    <SelectItem key={s} value={s} className="text-white capitalize">{s.replace("_", " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-slate-300">Outcome</Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0D1B2E] border-white/10">
                  {["pending", "compliant", "minor_discrepancy", "major_discrepancy", "fraud_suspected"].map(o => (
                    <SelectItem key={o} value={o} className="text-white capitalize">{o.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label className="text-slate-300 text-xs">Audited Value (USD)</Label>
              <Input value={auditedValue} onChange={(e) => setAuditedValue(e.target.value)} type="number" placeholder="0.00" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Add. Duty (USD)</Label>
              <Input value={additionalDuty} onChange={(e) => setAdditionalDuty(e.target.value)} type="number" placeholder="0.00" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
            <div>
              <Label className="text-slate-300 text-xs">Penalty (USD)</Label>
              <Input value={penalty} onChange={(e) => setPenalty(e.target.value)} type="number" placeholder="0.00" className="bg-white/5 border-white/10 text-white mt-1" />
            </div>
          </div>
          <div>
            <Label className="text-slate-300">Findings</Label>
            <Textarea value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="Record audit findings..." className="bg-white/5 border-white/10 text-white mt-1 min-h-[80px]" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-slate-300">Cancel</Button>
          <Button
            onClick={() => update.mutate({
              id: audit.id,
              status: status as any,
              outcome: outcome as any,
              ...(auditedValue ? { auditedValue: parseFloat(auditedValue) } : {}),
              ...(additionalDuty ? { additionalDutyAssessed: parseFloat(additionalDuty) } : {}),
              ...(penalty ? { penaltyAmount: parseFloat(penalty) } : {}),
              ...(findings ? { findings } : {}),
            })}
            disabled={update.isPending}
            className="bg-gold text-navy font-semibold hover:bg-gold/90"
          >
            {update.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────
export default function PostClearanceAudit() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [updateAudit, setUpdateAudit] = useState<any | null>(null);
  const PAGE_SIZE = 15;

  const isOfficer = ["customs_officer", "admin", "inspector"].includes(user?.role ?? "");

  const { data: stats } = trpc.postAudit.stats.useQuery(undefined, { enabled: isOfficer });
  const { data, isLoading } = trpc.postAudit.list.useQuery({
    status: statusFilter !== "all" ? statusFilter as any : undefined,
    search: search || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const audits = data?.audits ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white font-display flex items-center gap-2">
              <ClipboardCheck className="text-gold" size={24} />
              Post-Clearance Audit
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Schedule and manage post-clearance audits for cleared declarations
            </p>
          </div>
          {isOfficer && (
            <Button
              onClick={() => setScheduleOpen(true)}
              className="bg-gold text-navy font-semibold hover:bg-gold/90"
            >
              <Plus size={16} className="mr-2" /> Schedule Audit
            </Button>
          )}
        </div>

        {/* KPI Cards — officers only */}
        {isOfficer && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            {[
              { label: "Total Audits", value: stats.total, icon: <ClipboardCheck size={16} />, color: "text-slate-300" },
              { label: "Scheduled", value: stats.scheduled, icon: <Clock size={16} />, color: "text-blue-400" },
              { label: "In Progress", value: stats.inProgress, icon: <TrendingUp size={16} />, color: "text-yellow-400" },
              { label: "Completed", value: stats.completed, icon: <CheckCircle2 size={16} />, color: "text-emerald-400" },
              { label: "Escalated", value: stats.escalated, icon: <AlertTriangle size={16} />, color: "text-red-400" },
              { label: "Add. Duty Recovered", value: `$${stats.totalAdditionalDuty.toLocaleString()}`, icon: <DollarSign size={16} />, color: "text-gold" },
              { label: "Compliance Rate", value: `${stats.complianceRate}%`, icon: <CheckCircle2 size={16} />, color: "text-emerald-400" },
            ].map((kpi) => (
              <Card key={kpi.label} className="bg-[#0D1B2E]/80 border-white/10">
                <CardContent className="p-4">
                  <div className={`flex items-center gap-1.5 ${kpi.color} mb-1`}>
                    {kpi.icon}
                    <span className="text-xs font-mono tracking-wide">{kpi.label}</span>
                  </div>
                  <div className="text-xl font-bold text-white font-display">{kpi.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              placeholder="Search by audit # or declaration #…"
              className="pl-9 bg-white/5 border-white/10 text-white"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44 bg-white/5 border-white/10 text-white">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent className="bg-[#0D1B2E] border-white/10">
              <SelectItem value="all" className="text-white">All Statuses</SelectItem>
              {["scheduled", "in_progress", "completed", "escalated", "closed"].map(s => (
                <SelectItem key={s} value={s} className="text-white capitalize">{s.replace("_", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card className="bg-[#0D1B2E]/80 border-white/10">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400 font-mono text-xs">Audit #</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Declaration</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Status</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Outcome</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Declared Value</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Audited Value</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Add. Duty</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Penalty</TableHead>
                    <TableHead className="text-slate-400 font-mono text-xs">Scheduled</TableHead>
                    {isOfficer && <TableHead className="text-slate-400 font-mono text-xs">Actions</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={isOfficer ? 10 : 9} className="text-center text-slate-400 py-12">
                        Loading audits…
                      </TableCell>
                    </TableRow>
                  ) : audits.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isOfficer ? 10 : 9} className="text-center py-12">
                        <ClipboardCheck size={32} className="text-slate-600 mx-auto mb-3" />
                        <p className="text-slate-400">No audits found</p>
                        {isOfficer && (
                          <Button onClick={() => setScheduleOpen(true)} variant="outline" size="sm" className="mt-3 border-gold/30 text-gold">
                            Schedule First Audit
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ) : audits.map((audit) => (
                    <TableRow key={audit.id} className="border-white/5 hover:bg-white/3">
                      <TableCell className="font-mono text-xs text-gold">{audit.auditNumber}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-300">{audit.declarationNumber}</TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${STATUS_COLORS[audit.status] ?? ""} capitalize`}>
                          {audit.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs border ${OUTCOME_COLORS[audit.outcome] ?? ""} capitalize`}>
                          {audit.outcome.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-300 text-xs">${fmt(audit.declaredValue)}</TableCell>
                      <TableCell className="text-slate-300 text-xs">${fmt(audit.auditedValue)}</TableCell>
                      <TableCell className={`text-xs font-semibold ${parseFloat(audit.additionalDutyAssessed ?? "0") > 0 ? "text-red-400" : "text-slate-500"}`}>
                        ${fmt(audit.additionalDutyAssessed)}
                      </TableCell>
                      <TableCell className={`text-xs font-semibold ${parseFloat(audit.penaltyAmount ?? "0") > 0 ? "text-orange-400" : "text-slate-500"}`}>
                        ${fmt(audit.penaltyAmount)}
                      </TableCell>
                      <TableCell className="text-slate-400 text-xs">
                        {audit.scheduledDate ? new Date(audit.scheduledDate).toLocaleDateString() : "—"}
                      </TableCell>
                      {isOfficer && (
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setUpdateAudit(audit)}
                            className="border-white/10 text-slate-300 hover:text-gold h-7 px-2"
                          >
                            <Edit3 size={12} className="mr-1" /> Update
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-slate-400">
            <span>Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0} className="border-white/10">
                <ChevronLeft size={14} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1} className="border-white/10">
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ScheduleAuditDialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} />
      {updateAudit && (
        <UpdateAuditDialog
          audit={updateAudit}
          open={!!updateAudit}
          onClose={() => setUpdateAudit(null)}
        />
      )}
    </DashboardLayout>
  );
}
