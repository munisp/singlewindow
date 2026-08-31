/**
 * PcsBilling.tsx — port billing visibility (Phase 8, R4). Read-only ledger
 * projection: every row carries its projection lag + ledger commit hash.
 * Amounts are invoiced figures only — never estimates (GAP-PCS-TARIFF).
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine, formatLag, formatNaira } from "./pcs/pcsUi";

interface SnapshotRow {
  id: number;
  bookingId: string;
  invoiceId: string | null;
  amountKobo: number;
  currency: string;
  status: string;
  receiptId: string | null;
  ledgerCommitHash: string | null;
  projectionLagMs: number | null;
  occurredAt: string;
}

export default function PcsBilling() {
  const query = trpc.pcs.billing.list.useQuery({});
  const result = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-5xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold">Port billing</h1>
          <p className="text-sm text-slate-500">
            Invoiced port charges from the ledger projection. Each figure is labelled with its projection lag — this view is never the billing system of record.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> Charges & refunds</CardTitle>
            <CardDescription>Projected from verified port events (booking.paid / booking.refunded).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {result.data.snapshots.length === 0 ? (
                  <PcsEmptyState
                    title="No port charges recorded yet"
                    hint="Charges appear here when the port ledger publishes payment or refund events for your bookings."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Booking</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Receipt</TableHead>
                        <TableHead>Provenance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(result.data.snapshots as SnapshotRow[]).map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-mono text-xs">{s.bookingId}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={s.status === "REFUNDED" ? "text-amber-400" : "text-emerald-400"}>
                              {s.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatNaira(s.amountKobo)}</TableCell>
                          <TableCell className="font-mono text-xs">{s.receiptId ?? "—"}</TableCell>
                          <TableCell>
                            <ProvenanceLine
                              source={`event ${new Date(s.occurredAt).toLocaleString()}`}
                              detail={`lag ${formatLag(s.projectionLagMs)}${s.ledgerCommitHash ? ` · ledger ${s.ledgerCommitHash.slice(0, 12)}…` : ""}`}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <PcsGapList gaps={result.gaps} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
