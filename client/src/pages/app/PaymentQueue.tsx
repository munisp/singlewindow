/**
 * PaymentQueue.tsx — Async Payment Queue Dashboard
 * 1B payments/day architecture applied to TradeGateway NGSWTP.
 * Sources: https://backend.how/posts/1b-payments-per-day/
 *          https://github.com/pratikgajjar/1b-payments
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { humanizeLabel } from "@/lib/formatters";
import DashboardLayout from "@/components/DashboardLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Layers, RefreshCw, RotateCcw, CheckCircle2, XCircle,
  Clock, AlertTriangle, Archive, ChevronLeft, ChevronRight,
  Loader2,
} from "lucide-react";

type QueueStatus = "all" | "queued" | "processing" | "committed" | "failed" | "dead_letter";
type ArchivalTier = "all" | "hot" | "warm" | "cold";

const STATUS_BADGE: Record<string, {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  icon: React.ReactNode;
}> = {
  queued:      { label: "Queued",      variant: "secondary",   icon: <Clock size={12} /> },
  processing:  { label: "Processing",  variant: "default",     icon: <Loader2 size={12} className="animate-spin" /> },
  committed:   { label: "Committed",   variant: "outline",     icon: <CheckCircle2 size={12} className="text-emerald-500" /> },
  failed:      { label: "Failed",      variant: "destructive", icon: <XCircle size={12} /> },
  dead_letter: { label: "Dead Letter", variant: "destructive", icon: <AlertTriangle size={12} /> },
};

const TIER_COLORS: Record<string, string> = {
  hot:  "bg-red-100 text-red-700 border-red-200",
  warm: "bg-amber-100 text-amber-700 border-amber-200",
  cold: "bg-sky-100 text-sky-700 border-sky-200",
};

function formatAmount(minorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GH", {
      style: "currency", currency, minimumFractionDigits: 2,
    }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency}`;
  }
}

function FinancePaymentQueue() {
  const [queueStatus, setQueueStatus] = useState<QueueStatus>("all");
  const [queuePage, setQueuePage] = useState(1);
  const [archivalTier, setArchivalTier] = useState<ArchivalTier>("all");
  const [archivalPage, setArchivalPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"queue" | "archival">("queue");
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const statsQuery = trpc.batchPayments.getQueueStats.useQuery(undefined, {
    refetchInterval: 10_000,
  });
  const queueQuery = trpc.batchPayments.listQueue.useQuery({
    status: queueStatus,
    page: queuePage,
    pageSize: 20,
  });
  const archivalQuery = trpc.batchPayments.listArchivalJobs.useQuery({
    tier: archivalTier,
    page: archivalPage,
    pageSize: 20,
  });

  const retryMutation = trpc.batchPayments.retryDeadLetters.useMutation({
    onSuccess: (data) => {
      toast.success(`Retried ${data.retried} dead-letter item(s)`, {
        description: data.retried > 0
          ? `Transfer IDs: ${data.transferIds.slice(0, 3).join(", ")}${data.retried > 3 ? "…" : ""}`
          : "No eligible items found.",
      });
      statsQuery.refetch();
      queueQuery.refetch();
    },
    onError: (err) =>
      toast.error("Retry failed", { description: err.message }),
  });

  const stats = statsQuery.data as Record<string, number> | undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Layers size={22} className="text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Payment Queue</h1>
              <p className="text-sm text-muted-foreground">
                Async duty payment pipeline — 1B payments/day architecture
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              statsQuery.refetch();
              queueQuery.refetch();
              archivalQuery.refetch();
            }}
          >
            <RefreshCw size={14} className="mr-1.5" /> Refresh
          </Button>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { key: "queued",               label: "Queued",       color: "text-slate-600",   bg: "bg-slate-50" },
            { key: "processing",           label: "Processing",   color: "text-blue-600",    bg: "bg-blue-50" },
            { key: "committed",            label: "Committed",    color: "text-emerald-600", bg: "bg-emerald-50" },
            { key: "failed",               label: "Failed",       color: "text-orange-600",  bg: "bg-orange-50" },
            { key: "deadLetter",           label: "Dead Letter",  color: "text-red-600",     bg: "bg-red-50" },
            { key: "activeIdempotencyKeys",label: "Active Keys",  color: "text-purple-600",  bg: "bg-purple-50" },
          ].map(({ key, label, color, bg }) => (
            <div key={key} className={`rounded-lg border p-3 ${bg}`}>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className={`text-2xl font-bold ${color}`}>
                {statsQuery.isLoading ? "—" : String(stats?.[key] ?? 0)}
              </p>
            </div>
          ))}
        </div>

        {/* Architecture Note */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>1B Payments/Day Pattern:</strong> Payments are enqueued asynchronously with
          SHA-256 idempotency keys (24 h TTL), processed with exponential back-off (base 2, max 1 h),
          dead-lettered after 5 attempts, and archived to Hot/Warm/Cold Parquet tiers
          (≤7d / 7–90d / &gt;90d). The balance mirror tracks debits_posted / credits_posted per shard.
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b">
          {(["queue", "archival"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "queue" ? "Queue Items" : "Archival Jobs"}
            </button>
          ))}
        </div>

        {/* Queue Tab */}
        {activeTab === "queue" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Select
                value={queueStatus}
                onValueChange={(v) => {
                  setQueueStatus(v as QueueStatus);
                  setQueuePage(1);
                }}
              >
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  {["all", "queued", "processing", "committed", "failed", "dead_letter"].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All Statuses" : (STATUS_BADGE[s]?.label ?? s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isAdmin && (queueStatus === "dead_letter" || queueStatus === "all") && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => retryMutation.mutate({ limit: 10 })}
                  disabled={retryMutation.isPending}
                  title="Admin only — replay dead-letter payments"
                >
                  {retryMutation.isPending
                    ? <Loader2 size={14} className="animate-spin mr-1.5" />
                    : <RotateCcw size={14} className="mr-1.5" />}
                  Retry Dead Letters
                </Button>
              )}
            </div>

            {queueQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Transfer ID</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Amount</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Attempts</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!queueQuery.data?.items.length ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-muted-foreground">
                          No items found
                        </td>
                      </tr>
                    ) : queueQuery.data.items.map((item) => {
                      const badge = STATUS_BADGE[item.status] ?? {
                        label: item.status,
                        variant: "secondary" as const,
                        icon: null,
                      };
                      return (
                        <tr key={item.id} className="hover:bg-muted/30">
                          <td className="px-4 py-2.5 font-mono text-xs">{item.transferId}</td>
                          <td className="px-4 py-2.5">
                            {formatAmount(item.amountMinorUnits, item.currency)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge variant={badge.variant} className="gap-1 text-xs">
                              {badge.icon}{badge.label}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {item.attemptCount}/{item.maxAttempts}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {new Date(item.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {queueQuery.data && queueQuery.data.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Page {queuePage} of {queueQuery.data.totalPages} ({queueQuery.data.total} items)
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setQueuePage((p) => Math.max(1, p - 1))}
                    disabled={queuePage === 1}
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setQueuePage((p) => Math.min(queueQuery.data!.totalPages, p + 1))}
                    disabled={queuePage === queueQuery.data.totalPages}
                  >
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Archival Tab */}
        {activeTab === "archival" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Archive size={16} className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Hot ≤7d · Warm 7–90d · Cold &gt;90d (Parquet)
              </span>
              <div className="ml-auto">
                <Select
                  value={archivalTier}
                  onValueChange={(v) => {
                    setArchivalTier(v as ArchivalTier);
                    setArchivalPage(1);
                  }}
                >
                  <SelectTrigger className="w-36 h-8 text-sm">
                    <SelectValue placeholder="Filter tier" />
                  </SelectTrigger>
                  <SelectContent>
                    {["all", "hot", "warm", "cold"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t === "all" ? "All Tiers" : humanizeLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {archivalQuery.isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Job ID</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Tier</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Period</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Transfers</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Size</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {!archivalQuery.data?.jobs.length ? (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-muted-foreground">
                          No archival jobs found — jobs are created by the nightly cron
                        </td>
                      </tr>
                    ) : archivalQuery.data.jobs.map((job) => (
                      <tr key={job.id} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5 font-mono text-xs">{job.jobId}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs border font-medium ${TIER_COLORS[job.tier]}`}>
                            <span title={job.tier}>{humanizeLabel(job.tier)}</span>
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">
                          {new Date(job.periodStart).toLocaleDateString()} – {new Date(job.periodEnd).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-2.5">{job.transfersArchived.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {(job.bytesWritten / 1024).toFixed(1)} KB
                        </td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant={
                              job.status === "completed" ? "outline"
                              : job.status === "failed" ? "destructive"
                              : "secondary"
                            }
                            className="text-xs"
                          >
                            {job.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {archivalQuery.data && archivalQuery.data.totalPages > 1 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Page {archivalPage} of {archivalQuery.data.totalPages}</span>
                <div className="flex gap-1">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setArchivalPage((p) => Math.max(1, p - 1))}
                    disabled={archivalPage === 1}
                  >
                    <ChevronLeft size={14} />
                  </Button>
                  <Button
                    size="sm" variant="outline"
                    onClick={() => setArchivalPage((p) => Math.min(archivalQuery.data!.totalPages, p + 1))}
                    disabled={archivalPage === archivalQuery.data.totalPages}
                  >
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

/**
 * SW-G7: route-level split — the platform-wide queue is finance/admin data.
 * Traders hitting /app/trader/payment-queue see ONLY their own payments
 * (server-enforced via batchPayments.listMyQueue scoped by ctx.user.id).
 */
export default function PaymentQueue() {
  const { user } = useAuth();
  const isFinanceUser = user?.role === "admin" || user?.role === "finance";
  if (!isFinanceUser) return <TraderPaymentQueue />;
  return <FinancePaymentQueue />;
}

function TraderPaymentQueue() {
  const [page, setPage] = useState(1);
  const myQueue = trpc.batchPayments.listMyQueue.useQuery({ page, pageSize: 20 });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Layers className="text-primary" size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold">My Payments</h1>
            <p className="text-sm text-muted-foreground">
              Your payment records and their processing status.
            </p>
          </div>
        </div>

        {myQueue.isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Loading your payments…
          </div>
        )}
        {myQueue.error && (
          <div className="text-destructive text-sm">
            Could not load your payments: {myQueue.error.message}
          </div>
        )}

        <div className="space-y-2">
          {(myQueue.data?.items ?? []).map((p: any) => (
            <div key={p.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="font-mono text-sm">{p.reference ?? `PAY-${p.id}`}</div>
                <div className="text-xs text-muted-foreground">
                  Declaration #{p.declarationId} · {p.paymentMethod}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">{formatAmount(Number(p.amount) * 100, p.currency)}</span>
                <Badge variant={p.status === "confirmed" ? "outline" : p.status === "failed" ? "destructive" : "secondary"}>
                  {p.status}
                </Badge>
              </div>
            </div>
          ))}
          {myQueue.data && myQueue.data.items.length === 0 && (
            <div className="text-sm text-muted-foreground">No payments found for your account.</div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            <ChevronLeft size={14} /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {myQueue.data?.page ?? page} of {myQueue.data?.totalPages ?? 1}
          </span>
          <Button
            variant="outline" size="sm"
            disabled={(myQueue.data?.page ?? 1) >= (myQueue.data?.totalPages ?? 1)}
            onClick={() => setPage(page + 1)}
          >
            Next <ChevronRight size={14} />
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
