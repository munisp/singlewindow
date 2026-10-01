/**
 * Phase 22 — Combined Reporting Form (CRF) Dashboard
 * UI for the previously orphaned `crf` tRPC router: traders list/create/submit
 * CRFs (statutory trade-statistics reporting to NBS/CBN); admins get the
 * period stats and accept/reject review actions.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileBarChart, Plus, Send, CheckCircle, XCircle } from "lucide-react";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-blue-500/20 text-blue-500",
  ACCEPTED: "bg-green-500/20 text-green-500",
  REJECTED: "bg-red-500/20 text-red-500",
};

function CrfTable({ crfs, onAction, isAdmin, pendingId, action }: {
  crfs: any[];
  isAdmin: boolean;
  pendingId: number | null;
  action: "submit" | "review" | null;
  onAction: (kind: "submit" | "accept" | "reject", crf: any) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>CRF Number</TableHead>
          <TableHead>Period</TableHead>
          <TableHead>HS Code</TableHead>
          <TableHead>Declared Value</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {crfs.map((c) => (
          <TableRow key={c.id}>
            <TableCell className="font-mono text-xs">{c.crfNumber}</TableCell>
            <TableCell className="text-xs">{c.reportingPeriod}</TableCell>
            <TableCell className="text-xs">{c.hsCode ?? "—"}</TableCell>
            <TableCell className="text-xs">
              {c.declaredValue != null ? `${c.currency ?? "USD"} ${Number(c.declaredValue).toLocaleString()}` : "—"}
            </TableCell>
            <TableCell>
              <Badge className={`text-xs ${STATUS_STYLES[c.status] ?? "bg-muted text-muted-foreground"}`}>{c.status}</Badge>
              {c.status === "REJECTED" && c.rejectionReason && (
                <p className="text-xs text-red-500 mt-1 max-w-48 truncate" title={c.rejectionReason}>{c.rejectionReason}</p>
              )}
            </TableCell>
            <TableCell className="text-xs">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</TableCell>
            <TableCell className="text-right">
              {!isAdmin && c.status === "DRAFT" && (
                <Button
                  size="sm" variant="outline"
                  disabled={pendingId === c.id}
                  onClick={() => onAction("submit", c)}
                >
                  <Send className="w-3.5 h-3.5 mr-1" />
                  {pendingId === c.id && action === "submit" ? "Submitting…" : "Submit"}
                </Button>
              )}
              {isAdmin && c.status === "SUBMITTED" && (
                <div className="flex gap-1 justify-end">
                  <Button size="sm" variant="outline" disabled={pendingId === c.id} onClick={() => onAction("accept", c)}>
                    <CheckCircle className="w-3.5 h-3.5 mr-1 text-green-500" />Accept
                  </Button>
                  <Button size="sm" variant="outline" disabled={pendingId === c.id} onClick={() => onAction("reject", c)}>
                    <XCircle className="w-3.5 h-3.5 mr-1 text-red-500" />Reject
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function CrfDashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [periodFilter, setPeriodFilter] = useState("");
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [action, setAction] = useState<"submit" | "review" | null>(null);

  const [createDeclId, setCreateDeclId] = useState("");
  const [createUcr, setCreateUcr] = useState("");
  const [createPeriod, setCreatePeriod] = useState("");

  const listInput = {
    ...(statusFilter !== "ALL" ? { status: statusFilter as "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED" } : {}),
    ...(periodFilter.trim() ? { period: periodFilter.trim() } : {}),
    limit: 50,
  };

  const myList = trpc.crf.list.useQuery(listInput, { enabled: !isAdmin });
  const adminList = trpc.crf.listAll.useQuery(
    { limit: 100, ...(periodFilter.trim() ? { period: periodFilter.trim() } : {}) },
    { enabled: isAdmin }
  );
  const stats = trpc.crf.getStats.useQuery(
    periodFilter.trim() ? { period: periodFilter.trim() } : undefined,
    { enabled: isAdmin }
  );

  const invalidate = () => {
    utils.crf.list.invalidate();
    utils.crf.listAll.invalidate();
    utils.crf.getStats.invalidate();
  };

  const createMutation = trpc.crf.create.useMutation({
    onSuccess: (c) => { toast.success(`CRF ${c.crfNumber} created as DRAFT`); setCreateDeclId(""); setCreateUcr(""); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const submitMutation = trpc.crf.submit.useMutation({
    onSuccess: () => { toast.success("CRF submitted to NBS/CBN"); invalidate(); },
    onError: (e) => toast.error(e.message),
    onSettled: () => { setPendingId(null); setAction(null); },
  });
  const acceptMutation = trpc.crf.accept.useMutation({
    onSuccess: () => { toast.success("CRF accepted"); invalidate(); },
    onError: (e) => toast.error(e.message),
    onSettled: () => { setPendingId(null); setAction(null); },
  });
  const rejectMutation = trpc.crf.reject.useMutation({
    onSuccess: () => { toast.success("CRF rejected"); invalidate(); },
    onError: (e) => toast.error(e.message),
    onSettled: () => { setPendingId(null); setAction(null); },
  });

  const handleAction = (kind: "submit" | "accept" | "reject", crf: any) => {
    setPendingId(crf.id);
    setAction(kind === "submit" ? "submit" : "review");
    if (kind === "submit") submitMutation.mutate({ id: crf.id });
    else if (kind === "accept") acceptMutation.mutate({ id: crf.id });
    else {
      const reason = window.prompt("Rejection reason (required):");
      if (!reason || !reason.trim()) { setPendingId(null); setAction(null); return; }
      rejectMutation.mutate({ id: crf.id, reason: reason.trim().slice(0, 512) });
    }
  };

  const activeList = isAdmin ? adminList : myList;
  const crfs = activeList.data?.crfs ?? [];
  const total = activeList.data?.total ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileBarChart className="w-6 h-6 text-primary" />
            Combined Reporting Forms (CRF)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Statutory trade-statistics reporting to the National Bureau of Statistics (NBS) and CBN.
          </p>
        </div>

        {isAdmin && stats.data && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card><CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Period</p>
              <p className="text-xl font-bold mt-1">{stats.data.period ?? "—"}</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total CRFs</p>
              <p className="text-xl font-bold mt-1">{stats.data.total}</p>
            </CardContent></Card>
            {(["DRAFT", "SUBMITTED", "ACCEPTED", "REJECTED"] as const).slice(1).map((s) => (
              <Card key={s}><CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{s}</p>
                <p className="text-xl font-bold mt-1">{(stats.data.byStatus as Record<string, number>)?.[s] ?? 0}</p>
              </CardContent></Card>
            ))}
          </div>
        )}

        {!isAdmin && (
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="w-4 h-4" />Create CRF from Declaration</CardTitle></CardHeader>
            <CardContent>
              <form
                className="flex flex-wrap gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const id = Number(createDeclId);
                  if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid declaration ID");
                  if (createPeriod.trim() && !/^\d{4}-Q[1-4]$/.test(createPeriod.trim()))
                    return toast.error("Reporting period must look like 2025-Q1");
                  createMutation.mutate({
                    declarationId: id,
                    ...(createUcr.trim() ? { ucrNumber: createUcr.trim() } : {}),
                    ...(createPeriod.trim() ? { reportingPeriod: createPeriod.trim() } : {}),
                  });
                }}
              >
                <Input className="w-40" placeholder="Declaration ID" value={createDeclId} onChange={(e) => setCreateDeclId(e.target.value)} />
                <Input className="w-48" placeholder="UCR number (optional)" value={createUcr} onChange={(e) => setCreateUcr(e.target.value)} />
                <Input className="w-32" placeholder="2025-Q1 (optional)" value={createPeriod} onChange={(e) => setCreatePeriod(e.target.value)} />
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? "Creating…" : "Create CRF"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{isAdmin ? "All CRFs (Admin Review)" : "My CRFs"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {!isAdmin && (
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All statuses</SelectItem>
                    <SelectItem value="DRAFT">Draft</SelectItem>
                    <SelectItem value="SUBMITTED">Submitted</SelectItem>
                    <SelectItem value="ACCEPTED">Accepted</SelectItem>
                    <SelectItem value="REJECTED">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Input
                className="w-32" placeholder="Period e.g. 2025-Q1"
                value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}
              />
            </div>
            {activeList.isError ? (
              <p className="text-sm text-red-600">Failed to load CRFs: {activeList.error.message}</p>
            ) : activeList.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : crfs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No CRFs found{periodFilter.trim() ? ` for period ${periodFilter.trim()}` : ""}.
              </p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">{total} CRF{total !== 1 ? "s" : ""}</p>
                <CrfTable crfs={crfs} isAdmin={isAdmin} pendingId={pendingId} action={action} onAction={handleAction} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
