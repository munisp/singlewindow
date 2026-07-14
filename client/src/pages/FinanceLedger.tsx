/**
 * FinanceLedger.tsx — Sprint 31
 * Finance Ledger dashboard: TigerBeetle double-entry account balances,
 * recent transfers, payment risk scoring, and two-phase payment workflow.
 *
 * Design: Sovereign Blueprint — Deep Navy (#0A1628) + Gold (#D4A017)
 * Uses DashboardLayout sidebar pattern (internal tool).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  DollarSign,
  TrendingUp,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Shield,
  ArrowRight,
  BarChart3,
  Loader2,
  Download,
} from "lucide-react";

// ─── Account colour map ───────────────────────────────────────────────────────

const ACCOUNT_COLORS: Record<string, string> = {
  TRADER_LIABILITY: "bg-blue-900/40 border-blue-500/30",
  CUSTOMS_REVENUE_PENDING: "bg-amber-900/40 border-amber-500/30",
  CUSTOMS_REVENUE_CONFIRMED: "bg-emerald-900/40 border-emerald-500/30",
  BOND_DEPOSIT: "bg-purple-900/40 border-purple-500/30",
  DRAWBACK_PAYABLE: "bg-rose-900/40 border-rose-500/30",
};

const ACCOUNT_ICONS: Record<string, React.ReactNode> = {
  TRADER_LIABILITY: <DollarSign className="w-5 h-5 text-blue-400" />,
  CUSTOMS_REVENUE_PENDING: <Clock className="w-5 h-5 text-amber-400" />,
  CUSTOMS_REVENUE_CONFIRMED: <CheckCircle className="w-5 h-5 text-emerald-400" />,
  BOND_DEPOSIT: <Shield className="w-5 h-5 text-purple-400" />,
  DRAWBACK_PAYABLE: <ArrowRight className="w-5 h-5 text-rose-400" />,
};

function formatAmount(amount: number | string | undefined, currency = "GHS"): string {
  if (amount === undefined || amount === null) return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(num);
}

function RiskTierBadge({ tier }: { tier: string }) {
  const map: Record<string, string> = {
    LOW: "bg-emerald-900/60 text-emerald-300 border-emerald-500/40",
    MEDIUM: "bg-amber-900/60 text-amber-300 border-amber-500/40",
    HIGH: "bg-orange-900/60 text-orange-300 border-orange-500/40",
    CRITICAL: "bg-red-900/60 text-red-300 border-red-500/40",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${map[tier] ?? "bg-gray-800 text-gray-300"}`}>
      {tier}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    POSTED: "bg-emerald-900/60 text-emerald-300",
    PENDING: "bg-amber-900/60 text-amber-300",
    VOIDED: "bg-gray-800 text-gray-400",
    posted: "bg-emerald-900/60 text-emerald-300",
    pending: "bg-amber-900/60 text-amber-300",
    voided: "bg-gray-800 text-gray-400",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status] ?? "bg-gray-800 text-gray-400"}`}>
      {status}
    </span>
  );
}

// ─── Risk Scorer Panel ────────────────────────────────────────────────────────

function RiskScorerPanel() {
  const [form, setForm] = useState({
    traderId: "TRADER-001",
    amount: "50000",
    fspId: "MTN_MOMO",
    fspType: "MOBILE_MONEY" as "BANK" | "MOBILE_MONEY" | "RTGS",
    payerAccount: "0244123456",
    declarationValue: "200000",
    traderComplianceScore: "0.75",
    isFirstPayment: false,
  });
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const scoreMutation = trpc.ledger.scorePaymentRisk.useMutation({
    onSuccess: (data) => {
      setResult(data as Record<string, unknown>);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleScore = () => {
    scoreMutation.mutate({
      traderId: form.traderId,
      amount: parseFloat(form.amount),
      fspId: form.fspId,
      fspType: form.fspType,
      payerAccount: form.payerAccount,
      declarationValue: parseFloat(form.declarationValue) || undefined,
      traderComplianceScore: parseFloat(form.traderComplianceScore) || undefined,
      isFirstPayment: form.isFirstPayment,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Trader ID</Label>
          <Input
            value={form.traderId}
            onChange={(e) => setForm({ ...form, traderId: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Amount (GHS)</Label>
          <Input
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">FSP ID</Label>
          <Select value={form.fspId} onValueChange={(v) => setForm({ ...form, fspId: v })}>
            <SelectTrigger className="bg-[#0A1628] border-[#1E3A5F] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0D1F3C] border-[#1E3A5F]">
              {["GCB_BANK", "ECOBANK_GH", "STANBIC_GH", "MTN_MOMO", "VODAFONE_CASH", "AIRTELTIGO_MONEY", "CENTRAL_BANK"].map(fsp => (
                <SelectItem key={fsp} value={fsp} className="text-white">{fsp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">FSP Type</Label>
          <Select value={form.fspType} onValueChange={(v) => setForm({ ...form, fspType: v as any })}>
            <SelectTrigger className="bg-[#0A1628] border-[#1E3A5F] text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0D1F3C] border-[#1E3A5F]">
              <SelectItem value="BANK" className="text-white">BANK</SelectItem>
              <SelectItem value="MOBILE_MONEY" className="text-white">MOBILE_MONEY</SelectItem>
              <SelectItem value="RTGS" className="text-white">RTGS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Payer Account / MSISDN</Label>
          <Input
            value={form.payerAccount}
            onChange={(e) => setForm({ ...form, payerAccount: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Declared Goods Value (GHS)</Label>
          <Input
            value={form.declarationValue}
            onChange={(e) => setForm({ ...form, declarationValue: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-gray-300 text-sm">Trader Compliance Score (0–1)</Label>
          <Input
            value={form.traderComplianceScore}
            onChange={(e) => setForm({ ...form, traderComplianceScore: e.target.value })}
            className="bg-[#0A1628] border-[#1E3A5F] text-white"
          />
        </div>
      </div>

      <Button
        onClick={handleScore}
        disabled={scoreMutation.isPending}
        className="bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-semibold"
      >
        {scoreMutation.isPending ? (
          <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scoring…</>
        ) : (
          <><Shield className="w-4 h-4 mr-2" />Score Payment Risk</>
        )}
      </Button>

      {result && (
        <div className="mt-4 p-4 rounded-lg border border-[#1E3A5F] bg-[#0D1F3C] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-300 text-sm font-medium">Risk Assessment Result</span>
            <RiskTierBadge tier={result.risk_tier as string || result.riskTier as string} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-gray-500">Risk Score</span>
              <p className="text-white font-bold text-lg">
                {((result.risk_score as number || result.riskScore as number) * 100).toFixed(1)}%
              </p>
            </div>
            <div>
              <span className="text-gray-500">Recommended Action</span>
              <p className="text-[#D4A017] font-semibold">
                {result.recommended_action as string || result.recommendedAction as string}
              </p>
            </div>
          </div>
          {(result.flags as string[])?.length > 0 && (
            <div>
              <span className="text-gray-500 text-xs">Flags</span>
              <ul className="mt-1 space-y-1">
                {(result.flags as string[]).map((flag, i) => (
                  <li key={i} className="text-amber-300 text-xs flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    {flag}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-gray-600 text-xs">
            Model: {result.model_version as string || result.modelVersion as string} · Scored: {new Date(result.scored_at as string || result.scoredAt as string).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinanceLedger() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportStartDate, setExportStartDate] = useState("");
  const [exportEndDate, setExportEndDate] = useState("");
  const [exportEntryType, setExportEntryType] = useState("all");

  const exportCSVMutation = trpc.ledger.exportCSV.useMutation();
  const [emailLoading, setEmailLoading] = useState(false);
  const emailCSVMutation = trpc.finance.emailCSV.useMutation();

  const handleEmailCSV = async () => {
    setEmailLoading(true);
    try {
      const result = await emailCSVMutation.mutateAsync({
        startDate: exportStartDate ? new Date(exportStartDate).toISOString() : undefined,
        endDate: exportEndDate ? new Date(exportEndDate).toISOString() : undefined,
        limit: 5000,
      });
      toast.success(`Export summary sent to your Notification Centre (${result.rowCount} records)`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send export notification");
    } finally {
      setEmailLoading(false);
    }
  };

  const summaryQuery = trpc.ledger.getSummary.useQuery(undefined, {
    retry: false,
    refetchInterval: 30_000,
  });

  const refresh = () => {
    setRefreshKey(k => k + 1);
    summaryQuery.refetch();
  };

  const handleExportCSV = async () => {
    setExportLoading(true);
    try {
      const result = await exportCSVMutation.mutateAsync({
        startDate: exportStartDate ? new Date(exportStartDate).toISOString() : undefined,
        endDate: exportEndDate ? new Date(exportEndDate).toISOString() : undefined,
        entryType: exportEntryType !== "all" ? exportEntryType : undefined,
        limit: 5000,
      });
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${result.rowCount} ledger entries`);
    } catch (e: any) {
      toast.error(e?.message ?? "CSV export failed");
    } finally {
      setExportLoading(false);
    }
  };

  const summary = summaryQuery.data as any;
  const accounts: any[] = summary?.accounts ?? [];
  const recentTransfers: any[] = summary?.recentTransfers ?? [];
  const ledgerSummary = summary?.summary ?? {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white" style={{ fontFamily: "'Playfair Display', serif" }}>
            Finance Ledger
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            TigerBeetle double-entry bookkeeping · WCO financial model
          </p>
        </div>
        <div className="flex items-center gap-3">
          {ledgerSummary.mode === "db_fallback" && (
            <Badge className="bg-amber-900/60 text-amber-300 border border-amber-500/40">
              DB Fallback Mode
            </Badge>
          )}
          {ledgerSummary.mode === "simulation" && (
            <Badge className="bg-blue-900/60 text-blue-300 border border-blue-500/40">
              Simulation Mode
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            className="border-[#1E3A5F] text-gray-300 hover:bg-[#1E3A5F]"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exportLoading}
            onClick={handleExportCSV}
            className="border-[#D4A017]/50 text-[#D4A017] hover:bg-[#D4A017]/10"
          >
            {exportLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
            Export CSV
          </Button>
        </div>
      </div>

      {/* CSV Export Filters */}
      <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Quick-preset date range buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-gray-400 text-xs font-medium">Quick range:</span>
              {[
                { label: "Last 7d",  days: 7 },
                { label: "Last 30d", days: 30 },
                { label: "Last 90d", days: 90 },
                { label: "This Year", days: null },
              ].map((preset) => {
                const isActive = (() => {
                  if (preset.days === null) {
                    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];
                    return exportStartDate === yearStart && exportEndDate === "";
                  }
                  const expected = new Date(Date.now() - preset.days * 86400_000).toISOString().split("T")[0];
                  return exportStartDate === expected && exportEndDate === "";
                })();
                return (
                  <button
                    key={preset.label}
                    onClick={() => {
                      if (preset.days === null) {
                        setExportStartDate(new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0]);
                      } else {
                        setExportStartDate(new Date(Date.now() - preset.days * 86400_000).toISOString().split("T")[0]);
                      }
                      setExportEndDate("");
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium border transition-all ${
                      isActive
                        ? "bg-[#D4A017] text-[#0A1628] border-[#D4A017]"
                        : "bg-transparent text-[#D4A017] border-[#D4A017]/40 hover:bg-[#D4A017]/10"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
              {(exportStartDate || exportEndDate) && (
                <button
                  onClick={() => { setExportStartDate(""); setExportEndDate(""); }}
                  className="px-2.5 py-1 rounded text-xs font-medium border border-gray-600 text-gray-400 hover:text-white hover:border-gray-400 transition-all"
                >
                  Clear
                </button>
              )}
            </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-gray-400 text-xs">From Date</Label>
              <Input
                type="date"
                value={exportStartDate}
                onChange={(e) => setExportStartDate(e.target.value)}
                className="bg-[#0A1628] border-[#1E3A5F] text-white text-sm w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-400 text-xs">To Date</Label>
              <Input
                type="date"
                value={exportEndDate}
                onChange={(e) => setExportEndDate(e.target.value)}
                className="bg-[#0A1628] border-[#1E3A5F] text-white text-sm w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-gray-400 text-xs">Entry Type</Label>
              <Select value={exportEntryType} onValueChange={setExportEntryType}>
                <SelectTrigger className="bg-[#0A1628] border-[#1E3A5F] text-white text-sm w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0D1F3C] border-[#1E3A5F]">
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="duty_payment">Duty Payment</SelectItem>
                  <SelectItem value="bond_deposit">Bond Deposit</SelectItem>
                  <SelectItem value="bond_release">Bond Release</SelectItem>
                  <SelectItem value="drawback_payment">Drawback Payment</SelectItem>
                  <SelectItem value="transit_guarantee">Transit Guarantee</SelectItem>
                  <SelectItem value="penalty">Penalty</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={exportLoading}
                onClick={handleExportCSV}
                className="bg-[#D4A017] hover:bg-[#B8860B] text-[#0A1628] font-semibold"
              >
                {exportLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Download className="w-4 h-4 mr-1" />}
                Download CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={emailLoading}
                onClick={handleEmailCSV}
                className="border-[#D4A017]/40 text-[#D4A017] hover:bg-[#D4A017]/10"
              >
                {emailLoading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <span className="mr-1 text-base leading-none">📬</span>}
                Send to Inbox
              </Button>
            </div>
          </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Balances */}
      {summaryQuery.isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-[#D4A017]" />
        </div>
      ) : summaryQuery.isError ? (
        <Card className="bg-red-900/20 border-red-500/30">
          <CardContent className="p-4">
            <p className="text-red-300 text-sm">
              TigerBeetle bridge unavailable — {summaryQuery.error?.message}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((acct: any) => (
            <Card
              key={acct.id}
              className={`border ${ACCOUNT_COLORS[acct.accountType] ?? "bg-[#0D1F3C] border-[#1E3A5F]"}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  {ACCOUNT_ICONS[acct.accountType]}
                  <CardTitle className="text-sm font-medium text-gray-300">
                    {acct.description || acct.accountType}
                  </CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-white">
                  {formatAmount(acct.creditsPosted - acct.debitsPosted, acct.currency)}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div>
                    <span className="block">Credits Posted</span>
                    <span className="text-emerald-400">{formatAmount(acct.creditsPosted, acct.currency)}</span>
                  </div>
                  <div>
                    <span className="block">Debits Posted</span>
                    <span className="text-rose-400">{formatAmount(acct.debitsPosted, acct.currency)}</span>
                  </div>
                  {(acct.creditsPending > 0 || acct.debitsPending > 0) && (
                    <>
                      <div>
                        <span className="block">Credits Pending</span>
                        <span className="text-amber-400">{formatAmount(acct.creditsPending, acct.currency)}</span>
                      </div>
                      <div>
                        <span className="block">Debits Pending</span>
                        <span className="text-amber-400">{formatAmount(acct.debitsPending, acct.currency)}</span>
                      </div>
                    </>
                  )}
                </div>
                <p className="mt-2 text-xs text-gray-600">Account {acct.id}</p>
              </CardContent>
            </Card>
          ))}

          {/* Revenue summary card */}
          {ledgerSummary.totalRevenueConfirmed !== undefined && (
            <Card className="bg-gradient-to-br from-[#1A4A3A]/60 to-[#0A1628] border-emerald-500/30">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-[#D4A017]" />
                  <CardTitle className="text-sm font-medium text-gray-300">Total Revenue</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-[#D4A017]">
                  {formatAmount(ledgerSummary.totalRevenueConfirmed, ledgerSummary.currency)}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Pending: {formatAmount(ledgerSummary.totalRevenuePending, ledgerSummary.currency)}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Tabs: Recent Transfers + Risk Scorer */}
      <Tabs defaultValue="transfers" className="space-y-4">
        <TabsList className="bg-[#0D1F3C] border border-[#1E3A5F]">
          <TabsTrigger value="transfers" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <BarChart3 className="w-4 h-4 mr-1" />
            Recent Transfers
          </TabsTrigger>
          <TabsTrigger value="risk" className="data-[state=active]:bg-[#1E3A5F] text-gray-300">
            <Shield className="w-4 h-4 mr-1" />
            Payment Risk Scorer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transfers">
          <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="text-white text-base">Recent Ledger Transfers</CardTitle>
            </CardHeader>
            <CardContent>
              {recentTransfers.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                  No transfers recorded yet. Post a transfer to see it here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-[#1E3A5F] hover:bg-transparent">
                        <TableHead className="text-gray-400">ID</TableHead>
                        <TableHead className="text-gray-400">Amount</TableHead>
                        <TableHead className="text-gray-400">Debit Acct</TableHead>
                        <TableHead className="text-gray-400">Credit Acct</TableHead>
                        <TableHead className="text-gray-400">Status</TableHead>
                        <TableHead className="text-gray-400">Reference</TableHead>
                        <TableHead className="text-gray-400">Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentTransfers.map((t: any) => (
                        <TableRow key={t.id} className="border-[#1E3A5F] hover:bg-[#1E3A5F]/20">
                          <TableCell className="text-gray-400 font-mono text-xs">
                            {t.id?.slice(0, 8)}…
                          </TableCell>
                          <TableCell className="text-white font-medium">
                            {formatAmount(t.amount, t.currency)}
                          </TableCell>
                          <TableCell className="text-gray-400 font-mono text-xs">
                            {t.debitAccountId?.slice(-6)}
                          </TableCell>
                          <TableCell className="text-gray-400 font-mono text-xs">
                            {t.creditAccountId?.slice(-6)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={t.status} />
                          </TableCell>
                          <TableCell className="text-gray-400 text-xs max-w-[120px] truncate">
                            {t.reference || "—"}
                          </TableCell>
                          <TableCell className="text-gray-500 text-xs">
                            {t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="risk">
          <Card className="bg-[#0D1F3C] border-[#1E3A5F]">
            <CardHeader>
              <CardTitle className="text-white text-base">Payment Risk Scorer</CardTitle>
              <p className="text-gray-400 text-sm">
                ML-powered risk assessment via Python payment-risk-scorer service.
                Score a payment before initiating a Mojaloop transfer.
              </p>
            </CardHeader>
            <CardContent>
              <RiskScorerPanel />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
