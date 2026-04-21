/**
 * MojaloopPayments — full duty payment centre with initiate payment, search, filter, pagination
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  CreditCard, RefreshCw, CheckCircle, Clock, XCircle, Search,
  Plus, ChevronLeft, ChevronRight, Activity, DollarSign,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  COMPLETED: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  FAILED: "bg-red-500/10 text-red-400 border-red-500/20",
  PROCESSING: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  CANCELLED: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const CURRENCIES = ["GHS", "USD", "EUR", "GBP", "NGN", "KES", "ZAR"];
const PAGE_SIZE = 20;

export default function MojaloopPayments() {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [initiateOpen, setInitiateOpen] = useState(false);
  const [form, setForm] = useState({
    declarationId: "",
    amount: "",
    currency: "GHS",
    fspId: "GCB_BANK",
    payerAccount: "",
    payerName: "",
    paymentNote: "",
  });

  const { data: mojaStatus } = trpc.mojaloop.getIntegrationStatus.useQuery();
  const { data: fsps } = trpc.mojaloop.getSupportedFSPs.useQuery();
  const fspList = fsps ? [...(fsps as readonly any[])] : [];
  const { data, isLoading, refetch, isError } = trpc.payments.listAll.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const initiateMutation = trpc.mojaloop.initiatePayment.useMutation({
    onSuccess: (r) => {
      toast.success(`Payment initiated: ${r.transferId}`);
      setInitiateOpen(false);
      setForm({ declarationId: "", amount: "", currency: "GHS", fspId: "GCB_BANK", payerAccount: "", payerName: "", paymentNote: "" });
      utils.payments.listAll.invalidate();
    },
    onError: (e) => toast.error("Payment initiation failed", { description: e.message }),
  });

  const transactions = data?.transactions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filtered = transactions.filter((t: any) => {
    const s = !search ||
      String(t.transactionId ?? "").toLowerCase().includes(search.toLowerCase()) ||
      String(t.declarationId ?? "").toLowerCase().includes(search.toLowerCase());
    const st = statusFilter === "ALL" || t.status === statusFilter;
    return s && st;
  });

  const stats = {
    total: total,
    completed: transactions.filter((t: any) => t.status === "COMPLETED").length,
    pending: transactions.filter((t: any) => t.status === "PENDING").length,
    failed: transactions.filter((t: any) => t.status === "FAILED").length,
    totalAmount: transactions.reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0),
  };

  return (
    <DashboardLayout title="Payment Flows">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CreditCard className="h-6 w-6 text-primary" />Duty Payment Centre
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Real-time duty and tax payment transactions via Mojaloop ILP
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
            <Button size="sm" onClick={() => setInitiateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />Initiate Payment
            </Button>
          </div>
        </div>

        {/* Gateway Status */}
        {mojaStatus && (
          <Card className={mojaStatus.connected ? "border-emerald-500/30" : "border-amber-500/30"}>
            <CardContent className="p-3 flex items-center gap-3">
              <div className={`h-2 w-2 rounded-full ${mojaStatus.connected ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="text-sm font-medium">{mojaStatus.connected ? "Payment Gateway: Live" : "Payment Gateway: Simulation Mode"}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                Protocol: {mojaStatus.ilpVersion} · Standard: {mojaStatus.isoStandard} · Banks: {mojaStatus.supportedFSPs}
              </span>
            </CardContent>
          </Card>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          {[
            { label: "Total", value: stats.total, icon: <Activity className="h-4 w-4 text-blue-400" /> },
            { label: "Completed", value: stats.completed, icon: <CheckCircle className="h-4 w-4 text-emerald-400" /> },
            { label: "Pending", value: stats.pending, icon: <Clock className="h-4 w-4 text-amber-400" /> },
            { label: "Failed", value: stats.failed, icon: <XCircle className="h-4 w-4 text-red-400" /> },
            { label: "Total Amount", value: `${stats.totalAmount.toLocaleString()} GHS`, icon: <DollarSign className="h-4 w-4 text-primary" /> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-lg font-bold">{isLoading ? "—" : s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search transaction ID or declaration…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {["ALL", "PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"].map(s => (
                <SelectItem key={s} value={s}>{s === "ALL" ? "All Statuses" : s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Transactions Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Transactions ({filtered.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No payment transactions found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Transaction ID</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Declaration</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Currency</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Method</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((t: any) => (
                      <tr key={t.id} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs">{t.transactionId ?? t.id}</td>
                        <td className="p-3 font-mono text-xs">{t.declarationId ?? "—"}</td>
                        <td className="p-3 font-semibold">{Number(t.amount).toLocaleString()}</td>
                        <td className="p-3 text-muted-foreground text-xs">{t.currency}</td>
                        <td className="p-3"><Badge variant="outline" className={STATUS_STYLES[t.status] ?? ""}>{t.status}</Badge></td>
                        <td className="p-3 text-xs">{t.paymentMethod ?? "—"}</td>
                        <td className="p-3 text-xs text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Page {page + 1} of {totalPages}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="h-8 w-8 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="h-8 w-8 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Initiate Payment Dialog */}
      <Dialog open={initiateOpen} onOpenChange={setInitiateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Duty Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Declaration ID *</Label>
                <Input value={form.declarationId} onChange={e => setForm(f => ({ ...f, declarationId: e.target.value }))} placeholder="12345" />
              </div>

              <div className="space-y-1.5">
                <Label>Amount *</Label>
                <Input type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Payer Bank</Label>
              <Select value={form.fspId} onValueChange={v => setForm(f => ({ ...f, fspId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {fspList.map((fsp: any) => (
                    <SelectItem key={fsp.fspId} value={fsp.fspId}>{fsp.name}</SelectItem>
                  ))}
                  {fspList.length === 0 && <SelectItem value="GCB_BANK">Ghana Commercial Bank</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Payer Account Number *</Label>
              <Input value={form.payerAccount} onChange={e => setForm(f => ({ ...f, payerAccount: e.target.value }))} placeholder="1234567890" />
            </div>
            <div className="space-y-1.5">
              <Label>Payer Name *</Label>
              <Input value={form.payerName} onChange={e => setForm(f => ({ ...f, payerName: e.target.value }))} placeholder="John Doe" />
            </div>
            <div className="space-y-1.5">
              <Label>Payment Note</Label>
              <Input value={form.paymentNote} onChange={e => setForm(f => ({ ...f, paymentNote: e.target.value }))} placeholder="Duty payment for shipment…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInitiateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.declarationId || !form.amount || !form.payerAccount || !form.payerName) {
                  toast.error("Declaration ID, amount, account, and payer name are required"); return;
                }
                initiateMutation.mutate({
                  declarationId: Number(form.declarationId),
                  amount: Number(form.amount),
                  currency: form.currency,
                  fspId: form.fspId,
                  payerAccount: form.payerAccount,
                  payerName: form.payerName,
                  paymentNote: form.paymentNote || undefined,
                });
              }}
              disabled={initiateMutation.isPending}
            >
              {initiateMutation.isPending ? "Processing…" : "Initiate Payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
