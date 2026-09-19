/**
 * DangerousGoodsBoard.tsx — Officer dangerous-goods (IMDG) review board (Phase 20).
 *
 * Wires the Phase 19 `dangerousGoods` tRPC router (previously orphaned: API
 * shipped without UI). Officers see all DG-flagged declarations with their
 * IMDG line items (UN number, class, packing group, EmS codes, marine
 * pollutant flag). Structural validation happens server-side; substance-level
 * IMDG lookup is honestly unavailable (server returns PRECONDITION_FAILED).
 */

import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, AlertTriangle, Flame } from "lucide-react";

type DgItem = {
  id: number;
  unNumber: string;
  imoClass: string;
  packingGroup?: string | null;
  properShippingName?: string | null;
  flashpointCelsius?: string | null;
  emsCodes?: string[] | null;
  marinePollutant?: boolean | null;
  quantityDescription?: string | null;
};

type BoardEntry = {
  declaration: { id: number; declarationNumber?: string | null; status?: string | null };
  items: DgItem[];
};

export default function DangerousGoodsBoard() {
  const boardQuery = trpc.dangerousGoods.officerBoard.useQuery({});

  const board = (boardQuery.data?.board ?? []) as BoardEntry[];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Flame className="h-6 w-6" /> Dangerous Goods (IMDG) Board
            </h1>
            <p className="text-sm text-muted-foreground">
              Declarations carrying dangerous-goods line items (Phase 19 F5b).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => boardQuery.refetch()} disabled={boardQuery.isFetching}>
            {boardQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {boardQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading board…
          </div>
        ) : boardQuery.error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{boardQuery.error.message}</CardContent>
          </Card>
        ) : board.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              No dangerous-goods declarations on record.
            </CardContent>
          </Card>
        ) : (
          board.map((entry) => (
            <Card key={entry.declaration.id}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Declaration #{entry.declaration.id}
                  {entry.declaration.declarationNumber ? (
                    <span className="font-mono text-sm text-muted-foreground">
                      {entry.declaration.declarationNumber}
                    </span>
                  ) : null}
                  {entry.declaration.status ? <Badge variant="outline">{entry.declaration.status}</Badge> : null}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-3">UN No.</th>
                      <th className="p-3">IMO Class</th>
                      <th className="p-3">Packing Group</th>
                      <th className="p-3">Proper Shipping Name</th>
                      <th className="p-3">EmS</th>
                      <th className="p-3">Marine Pollutant</th>
                      <th className="p-3">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.items.map((item) => (
                      <tr key={item.id} className="border-b">
                        <td className="p-3 font-mono">{item.unNumber}</td>
                        <td className="p-3">
                          <Badge variant="secondary">{item.imoClass}</Badge>
                        </td>
                        <td className="p-3">{item.packingGroup ?? "—"}</td>
                        <td className="p-3">{item.properShippingName ?? "—"}</td>
                        <td className="p-3 font-mono text-xs">
                          {item.emsCodes?.length ? item.emsCodes.join(", ") : "—"}
                        </td>
                        <td className="p-3">
                          {item.marinePollutant ? <Badge variant="destructive">P</Badge> : "—"}
                        </td>
                        <td className="p-3">{item.quantityDescription ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </DashboardLayout>
  );
}
