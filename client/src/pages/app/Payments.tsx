/**
 * Payments — TradeGateway™ NGSWTP
 * Full payments management: initiate, history, detail, reconciliation report.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/DashboardLayout";

import {
  DollarSign, RefreshCw, Search, CheckCircle, Clock, AlertTriangle,
  TrendingUp, FileText, CreditCard, Smartphone, Building2, Shield,
  Download, BarChart3, ChevronRight,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
  processing: "bg-blue-100 text-blue-800 border-blue-200",
  completed: "bg-green-100 text-green-800 border-green-200",
  failed: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
  refunded: "bg-purple-100 text-purple-800 border-purple-200",
};

const METHOD_ICONS: Record<string, React.ReactNode> = {
  bank_transfer: <Building2 className="w-4 h-4" />,
  mobile_money: <Smartphone className="w-4 h-4" />,
  card: <CreditCard className="w-4 h-4" />,
  bond: <Shield className="w-4 h-4" />,
};

function formatCurrency(amount: string | number, currency = "USD") {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n || 0);
}

function formatDate(ts: Date | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

export default function Payments() {
  const { user } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activeTab, setActiveTab] = useState<"history" | "reconciliation" | "queue">("history");
  const [showInitiateDialog, setShowInitiateDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedPaymentId, setSelectedPaymentId] = useState<number | null>(null);
  const [initiateForm, setInitiateForm] = useState({
    declarationId: "",
    paymentMethod: "bank_transfer" as "bank_transfer" | "mobile_money" | "card" | "bond",
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const isAdmin = user?.role === "admin";
  const isFinance = user?.role === "finance";
  const canExportAll = isAdmin || isFinance;
  const [exportLoading, setExportLoading] = useState(false);

  const exportMyHistoryMutation = trpc.payments.exportMyHistory.useMutation();
  const exportAllMutation = trpc.finance.exportCSV.useMutation();

  const handleExportCSV = async () => {
    setExportLoading(true);
    try {
      let result: { csv: string; rowCount: number; filename: string };
      if (canExportAll) {
        result = await exportAllMutation.mutateAsync({
          startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
          limit: 5000,
        });
      } else {
        result = await exportMyHistoryMutation.mutateAsync({ limit: 2000 });
      }
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export complete", description: `Downloaded ${result.rowCount} payment records` });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const { data: historyData, isLoading: historyLoading } = trpc.payments.myHistory.useQuery(
    { limit: 50, offset: 0 },
    { enabled: !isAdmin }
  );

  const { data: allPayments, isLoading: allLoading } = trpc.payments.listAll.useQuery(
    { limit: 100, offset: 0 },
    { enabled: isAdmin }
  );

  const { data: trendData } = trpc.payments.trend.useQuery({ days: 30 });

  const { data: reconciliation, isLoading: reconLoading, refetch: refetchRecon } =
    trpc.payments.reconciliationReport.useQuery({}, { enabled: activeTab === "reconciliation" });

  const { data: pendingList } = trpc.payments.pendingList.useQuery(
    { limit: 20 },
    { enabled: isAdmin && activeTab === "queue" }
  );

  const { data: queueStats } = trpc.batchPayments.getQueueStats.useQuery(undefined, {
    enabled: activeTab === "queue",
    refetchInterval: 10000,
  });

  const { data: paymentDetail } = trpc.payments.getById.useQuery(
    { paymentId: selectedPaymentId! },
    { enabled: selectedPaymentId !== null }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const initiateMutation = trpc.payments.initiate.useMutation({
    onSuccess: () => {
      toast({ title: "Payment initiated", description: "Your payment has been queued for processing." });
      utils.payments.myHistory.invalidate();
      utils.payments.listAll.invalidate();
      setShowInitiateDialog(false);
      setInitiateForm({ declarationId: "", paymentMethod: "bank_transfer" });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const cancelMutation = trpc.payments.cancel.useMutation({
    onSuccess: () => {
      toast({ title: "Payment cancelled" });
      utils.payments.myHistory.invalidate();
      utils.payments.listAll.invalidate();
      setShowDetailDialog(false);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Filtered list ─────────────────────────────────────────────────────────────
  const rawList: any[] = isAdmin ? (allPayments?.transactions ?? []) : (historyData?.transactions ?? []);
  const filtered = useMemo(() => {
    return rawList.filter((p) => {
      const matchSearch = !search ||
        p.reference?.toLowerCase().includes(search.toLowerCase()) ||
        String(p.declarationId).includes(search);
      const matchStatus = statusFilter === "all" || p.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [rawList, search, statusFilter]);

  const totalAmount = filtered.reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
  const completedCount = filtered.filter((p) => p.status === "completed").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-accent" />
            Payments
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage duty payments, track transactions, and reconcile ledger entries
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exportLoading}
            onClick={handleExportCSV}
          >
            {exportLoading ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Export CSV
          </Button>
          <Button
            onClick={() => setShowInitiateDialog(true)}
            className="bg-accent hover:bg-[#b8891a] text-white"
          >
            <DollarSign className="w-4 h-4 mr-2" />
            Initiate Payment
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Volume</div>
          <div className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalAmount)}</div>
          <div className="text-xs text-muted-foreground">{filtered.length} transactions</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Completed</div>
          <div className="text-2xl font-bold text-green-600 mt-1">{completedCount}</div>
          <div className="text-xs text-muted-foreground">
            {filtered.length > 0 ? Math.round((completedCount / filtered.length) * 100) : 0}% success rate
          </div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Pending</div>
          <div className="text-2xl font-bold text-yellow-600 mt-1">
            {filtered.filter((p) => p.status === "pending" || p.status === "processing").length}
          </div>
          <div className="text-xs text-muted-foreground">Awaiting processing</div>
        </div>
        <div className="bg-card border rounded-lg p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Queue Stats</div>
          <div className="text-2xl font-bold text-blue-600 mt-1">
            {queueStats?.queued ?? "—"}
          </div>
          <div className="text-xs text-muted-foreground">Queued in batch processor</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(["history", "reconciliation", "queue"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-accent text-accent"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "history" ? "Transaction History" : tab === "reconciliation" ? "Reconciliation" : "Batch Queue"}
          </button>
        ))}
      </div>

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by reference or declaration ID..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          {historyLoading || allLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading payments...
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No payments found</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Reference</th>
                    <th className="text-left px-4 py-3 font-medium">Declaration</th>
                    <th className="text-left px-4 py-3 font-medium">Amount</th>
                    <th className="text-left px-4 py-3 font-medium">Method</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs">{p.reference}</td>
                      <td className="px-4 py-3 text-muted-foreground">#{p.declarationId}</td>
                      <td className="px-4 py-3 font-semibold">
                        {formatCurrency(p.amount, p.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 text-muted-foreground">
                          {METHOD_ICONS[p.paymentMethod] ?? <CreditCard className="w-4 h-4" />}
                          <span className="capitalize text-xs">{p.paymentMethod?.replace("_", " ")}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs border ${STATUS_COLORS[p.status] ?? ""}`}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {formatDate(p.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedPaymentId(p.id);
                            setShowDetailDialog(true);
                          }}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reconciliation Tab */}
      {activeTab === "reconciliation" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Ledger Reconciliation Report</h2>
            <Button variant="outline" size="sm" onClick={() => refetchRecon()}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
          </div>
          {reconLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Running reconciliation...
            </div>
          ) : reconciliation ? (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card border rounded-lg p-4">
                  <div className="text-xs text-muted-foreground uppercase">Total Payments</div>
                  <div className="text-xl font-bold mt-1">{reconciliation.payments.totalCount}</div>
                </div>
                <div className="bg-card border rounded-lg p-4">
                  <div className="text-xs text-muted-foreground uppercase">Payments Amount</div>
                  <div className="text-xl font-bold mt-1">
                    {formatCurrency(reconciliation.payments.totalAmount)}
                  </div>
                </div>
                <div className="bg-card border rounded-lg p-4">
                  <div className="text-xs text-muted-foreground uppercase">Ledger Amount</div>
                  <div className="text-xl font-bold mt-1">
                    {formatCurrency(reconciliation.mojaloop.totalAmount)}
                  </div>
                </div>
                <div className={`border rounded-lg p-4 ${
                  reconciliation.reconciliation.status === "BALANCED"
                    ? "bg-green-50 border-green-200"
                    : "bg-yellow-50 border-yellow-200"
                }`}>
                  <div className="text-xs text-muted-foreground uppercase">Status</div>
                  <div className={`text-xl font-bold mt-1 capitalize ${
                    reconciliation.reconciliation.status === "BALANCED" ? "text-green-700" : "text-yellow-700"
                  }`}>
                    {reconciliation.reconciliation.status}
                  </div>
                  <div className="text-xs mt-1">
                    Discrepancy: {formatCurrency(reconciliation.reconciliation.discrepancy)}
                  </div>
                </div>
              </div>

              {/* Trend Chart (text-based) */}
              {trendData && (trendData as any[]).length > 0 && (
                <div className="bg-card border rounded-lg p-4">
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" /> 30-Day Payment Trend
                  </h3>
                  <div className="flex items-end gap-1 h-20">
                    {(trendData as any[]).slice(-14).map((d: any, i: number) => {
                      const max = Math.max(...(trendData as any[]).map((x: any) => parseFloat(x.totalAmount || "0")));
                      const h = max > 0 ? (parseFloat(d.totalAmount || "0") / max) * 100 : 0;
                      return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-1">
                          <div
                            className="w-full bg-accent rounded-t opacity-80"
                            style={{ height: `${h}%`, minHeight: h > 0 ? "4px" : "0" }}
                            title={`${d.date}: ${formatCurrency(d.totalAmount)}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 text-center">Last 14 days</div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Batch Queue Tab */}
      {activeTab === "queue" && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Batch Payment Queue</h2>
          {queueStats && (
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: "Queued", value: queueStats.queued, color: "text-blue-600" },
                { label: "Processing", value: queueStats.processing, color: "text-yellow-600" },
                { label: "Committed", value: queueStats.committed, color: "text-green-600" },
                { label: "Failed", value: queueStats.failed, color: "text-red-600" },
                { label: "Dead Letter", value: queueStats.deadLetter, color: "text-gray-600" },
                { label: "Idempotency Keys", value: queueStats.activeIdempotencyKeys, color: "text-purple-600" },
              ].map((s) => (
                <div key={s.label} className="bg-card border rounded-lg p-3 text-center">
                  <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {pendingList && (pendingList as any[]).length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-4 py-2 text-sm font-medium">Pending Payments</div>
              <table className="w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2">Reference</th>
                    <th className="text-left px-4 py-2">Amount</th>
                    <th className="text-left px-4 py-2">Method</th>
                    <th className="text-left px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(pendingList as any[]).map((p: any) => (
                    <tr key={p.id} className="hover:bg-muted/20">
                      <td className="px-4 py-2 font-mono text-xs">{p.reference}</td>
                      <td className="px-4 py-2">{formatCurrency(p.amount, p.currency)}</td>
                      <td className="px-4 py-2 capitalize text-xs">{p.paymentMethod?.replace("_", " ")}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{formatDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Initiate Payment Dialog */}
      <Dialog open={showInitiateDialog} onOpenChange={setShowInitiateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Initiate Payment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Declaration ID</label>
              <Input
                placeholder="Enter declaration ID"
                value={initiateForm.declarationId}
                onChange={(e) => setInitiateForm((f) => ({ ...f, declarationId: e.target.value }))}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Payment Method</label>
              <Select
                value={initiateForm.paymentMethod}
                onValueChange={(v) => setInitiateForm((f) => ({ ...f, paymentMethod: v as any }))}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="mobile_money">Mobile Money</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="bond">Bond</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInitiateDialog(false)}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!initiateForm.declarationId || initiateMutation.isPending}
              onClick={() => {
                const id = parseInt(initiateForm.declarationId);
                if (isNaN(id)) {
                  toast({ title: "Invalid ID", description: "Please enter a valid declaration ID.", variant: "destructive" });
                  return;
                }
                initiateMutation.mutate({ declarationId: id, paymentMethod: initiateForm.paymentMethod });
              }}
            >
              {initiateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <DollarSign className="w-4 h-4 mr-2" />}
              Initiate Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
          </DialogHeader>
          {paymentDetail ? (
            <div className="space-y-3 py-2">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">Reference</div>
                  <div className="font-mono font-medium">{paymentDetail.reference}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Status</div>
                  <Badge className={`text-xs border ${STATUS_COLORS[paymentDetail.status] ?? ""}`}>
                    {paymentDetail.status}
                  </Badge>
                </div>
                <div>
                  <div className="text-muted-foreground">Amount</div>
                  <div className="font-semibold">{formatCurrency(paymentDetail.amount, paymentDetail.currency)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Method</div>
                  <div className="capitalize">{paymentDetail.paymentMethod?.replace("_", " ")}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Declaration</div>
                  <div>#{paymentDetail.declarationId}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Created</div>
                  <div className="text-xs">{formatDate(paymentDetail.createdAt)}</div>
                </div>
              </div>
              {paymentDetail.mojalooopTransferId && (
                <div className="bg-muted/50 rounded p-3">
                  <div className="text-xs text-muted-foreground">Mojaloop Transfer ID</div>
                  <div className="font-mono text-xs mt-1">{paymentDetail.mojalooopTransferId}</div>
                </div>
              )}
              {paymentDetail.ledgerEntries && paymentDetail.ledgerEntries.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">Ledger Entries</div>
                  <div className="space-y-1">
                    {paymentDetail.ledgerEntries.map((e: any) => (
                      <div key={e.id} className="flex justify-between text-xs bg-muted/30 rounded px-3 py-2">
                        <span className="capitalize text-muted-foreground">{e.entryType}</span>
                        <span className="font-medium">{formatCurrency(e.amount, e.currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading...
            </div>
          )}
          <DialogFooter>
            {paymentDetail?.status === "pending" && (
              <Button
                variant="destructive"
                size="sm"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ paymentId: selectedPaymentId!, reason: "Cancelled by user" })}
              >
                Cancel Payment
              </Button>
            )}
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
