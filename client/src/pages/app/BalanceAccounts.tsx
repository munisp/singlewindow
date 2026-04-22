/**
 * BalanceAccounts.tsx — Payment Balance Accounts Dashboard
 *
 * Displays all payment_accounts rows with live net balance (credits_posted − debits_posted),
 * a manual "Trigger Drift Check" button (admin-only), and a last-synced timestamp.
 *
 * Routes:
 *   /app/finance/balance-accounts  (admin + trader)
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, AlertTriangle, CheckCircle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";

const CURRENCIES = ["ALL", "GHS", "KES", "NGN", "USD", "EUR", "ZAR", "RWF", "TZS", "UGX"];

function formatMinorUnits(amount: number, currency: string): string {
  const major = amount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(major);
}

function NetBalanceBadge({ amount, currency }: { amount: number; currency: string }) {
  const isPositive = amount >= 0;
  return (
    <span
      className={`font-mono font-semibold ${
        isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
      }`}
    >
      {isPositive ? "+" : ""}
      {formatMinorUnits(amount, currency)}
    </span>
  );
}

export default function BalanceAccounts() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [page, setPage] = useState(1);
  const [currency, setCurrency] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");

  const { data, isLoading, refetch, isFetching } = trpc.batchPayments.listAllAccounts.useQuery(
    { page, pageSize: 50, currency: currency && currency !== "ALL" ? currency : undefined },
    { refetchInterval: 30_000 }
  );

  const driftCheck = trpc.batchPayments.runDriftCheck.useMutation({
    onSuccess: (result) => {
      if (!result.clean) {
        toast.warning("Balance drift detected!", {
          description: `${result.driftingAccounts?.length ?? 0} account(s) have mismatched balances. Owner has been notified.`,
        });
      } else {
        toast.success("Balance check passed", {
          description: "All account balances match the committed queue sums.",
        });
      }
      refetch();
    },
    onError: (err) => {
      toast.error("Drift check failed", { description: err.message });
    },
  });

  const accounts = data?.accounts ?? [];
  const filtered = search
    ? accounts.filter(
        (a) =>
          a.accountId.toLowerCase().includes(search.toLowerCase()) ||
          a.currency.toLowerCase().includes(search.toLowerCase()) ||
          String(a.ledger).includes(search)
      )
    : accounts;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Balance Accounts</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Live payment account mirror — credits posted minus debits posted.
              Refreshes every 30 seconds.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Refresh
            </Button>
            {isAdmin && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => driftCheck.mutate()}
                      disabled={driftCheck.isPending}
                    >
                      {driftCheck.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 mr-1" />
                      )}
                      Trigger Drift Check
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    Compares balance mirror against committed queue sums.
                    Notifies owner if drift is detected.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Total Accounts</p>
            <p className="text-2xl font-bold mt-1">{data?.total ?? "—"}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Positive Balance</p>
            <p className="text-2xl font-bold mt-1 text-emerald-600">
              {accounts.filter((a) => a.netBalance > 0).length}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Negative Balance</p>
            <p className="text-2xl font-bold mt-1 text-red-600">
              {accounts.filter((a) => a.netBalance < 0).length}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Zero Balance</p>
            <p className="text-2xl font-bold mt-1 text-muted-foreground">
              {accounts.filter((a) => a.netBalance === 0).length}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search account ID, currency, ledger…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select
            value={currency ?? "ALL"}
            onValueChange={(v) => { setCurrency(v === "ALL" ? undefined : v); setPage(1); }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Currency" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account ID</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead className="text-right">Credits Posted</TableHead>
                <TableHead className="text-right">Debits Posted</TableHead>
                <TableHead className="text-right">Pending Credits</TableHead>
                <TableHead className="text-right">Pending Debits</TableHead>
                <TableHead className="text-right">Net Balance</TableHead>
                <TableHead>Last Sync</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    {search ? "No accounts match your search." : "No payment accounts found."}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((account) => (
                  <TableRow key={account.accountId}>
                    <TableCell className="font-mono text-xs max-w-[180px] truncate">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>{account.accountId}</TooltipTrigger>
                          <TooltipContent>{account.accountId}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{account.currency}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{account.ledger}</TableCell>
                    <TableCell className="text-right font-mono text-sm text-emerald-600">
                      {formatMinorUnits(account.creditsPosted, account.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-red-600">
                      {formatMinorUnits(account.debitsPosted, account.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {formatMinorUnits(account.creditsPending, account.currency)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {formatMinorUnits(account.debitsPending, account.currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <NetBalanceBadge amount={account.netBalance} currency={account.currency} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {account.lastSyncAt
                        ? new Date(account.lastSyncAt).toLocaleString()
                        : "Never"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {data.page} of {data.totalPages} ({data.total} accounts)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
                disabled={page === data.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        {/* Drift check result indicator */}
        {driftCheck.isSuccess && (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
            <CheckCircle className="h-4 w-4" />
            Last drift check: {new Date().toLocaleTimeString()} — {
              !(driftCheck.data as { clean?: boolean })?.clean
                ? "Drift detected — owner notified"
                : "All balances reconciled"
            }
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
