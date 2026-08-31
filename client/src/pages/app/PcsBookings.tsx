/**
 * PcsBookings.tsx — terminal bookings (Phase 8, R3). Read-through from
 * port-interop; initiation is product-gated and the form renders the typed
 * INTEGRATION_GAPS disclosure instead of a fake success.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarCheck } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, PcsGapList, ProvenanceLine, formatNaira } from "./pcs/pcsUi";

interface BookingItem {
  link: { bookingId: string; createdVia: string; createdAt: string };
  booking: {
    booking_id: string; terminal_id: string; status: string;
    amount_kobo: number; currency: string; truck_plate: string;
    expires_at: string; updated_at: string; version: number;
  } | null;
  itemError?: { code: number; message: string };
}

export default function PcsBookings() {
  const query = trpc.pcs.bookings.list.useQuery();
  const result = query.data;

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-4xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold">Terminal bookings</h1>
          <p className="text-sm text-slate-500">
            eCallUp bookings read live from the port system. Booking initiation is disabled pending a product decision — see the notice below.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><CalendarCheck className="h-4 w-4" /> My bookings</CardTitle>
            <CardDescription>Statuses are read-through from port-interop — never cached silently.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              <>
                {result.data.bookings.length === 0 ? (
                  <PcsEmptyState
                    title="No bookings associated with your account"
                    hint="When a terminal booking is initiated for your cargo (once the write path is approved), it appears here with live status."
                  />
                ) : (
                  (result.data.bookings as BookingItem[]).map((item) => (
                    <div key={item.link.bookingId} className="rounded-md border border-slate-700/60 p-3">
                      {item.booking ? (
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-sm">{item.booking.booking_id}</p>
                            <p className="text-xs text-slate-500">
                              {item.booking.terminal_id} · truck {item.booking.truck_plate} · expires {new Date(item.booking.expires_at).toLocaleString()}
                            </p>
                            <ProvenanceLine
                              source="port-interop /v1/bookings"
                              detail={`record v${item.booking.version} · updated ${new Date(item.booking.updated_at).toLocaleString()} · via ${item.link.createdVia}`}
                            />
                          </div>
                          <div className="text-right">
                            <Badge variant="outline">{item.booking.status}</Badge>
                            <p className="mt-1 text-sm font-medium">{formatNaira(item.booking.amount_kobo)}</p>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <p className="font-mono text-sm text-slate-400">{item.link.bookingId}</p>
                          <p className="text-xs text-amber-400">
                            Upstream reported this booking as {item.itemError?.code === 404 ? "not found" : "inaccessible"} ({item.itemError?.code}): {item.itemError?.message}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
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
