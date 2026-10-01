/**
 * Phase 22 — WTO Customs Valuation
 * UI for the previously orphaned `wtoValuation` tRPC router:
 * view the NCS Minimum Customs Value (MCV) table and look up valuations
 * for a declaration.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Globe, FileSearch } from "lucide-react";

export default function WtoValuation() {
  const { data: mcv, isLoading: mcvLoading, isError: mcvError } = trpc.wtoValuation.getMCVTable.useQuery();

  const [declId, setDeclId] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const { data: valuation, isLoading: valLoading, isError: valError } = trpc.wtoValuation.getByDeclaration.useQuery(
    { declarationId: submittedId ?? "" },
    { enabled: submittedId !== null }
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            WTO Customs Valuation
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customs values calculated under the WTO Customs Valuation Agreement and the NCS Minimum Customs Value table.
          </p>
        </div>

        {/* Declaration valuation lookup */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><FileSearch className="w-4 h-4" />Valuation by Declaration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = declId.trim();
                if (!/^[0-9a-fA-F-]{36}$/.test(id)) return toast.error("Enter a valid declaration UUID");
                setSubmittedId(id);
              }}
            >
              <Input placeholder="Declaration UUID…" value={declId} onChange={(e) => setDeclId(e.target.value)} className="font-mono" />
              <Button type="submit">Look up</Button>
            </form>
            {submittedId && (
              valLoading ? (
                <p className="text-sm text-muted-foreground">Loading valuation…</p>
              ) : valError ? (
                <p className="text-sm text-red-600">Failed to load valuation: {valError.message}</p>
              ) : valuation == null ? (
                <p className="text-sm text-muted-foreground">No WTO valuation has been calculated for this declaration yet.</p>
              ) : (
                <pre className="text-xs bg-muted/50 border rounded-lg p-4 overflow-x-auto">{JSON.stringify(valuation, null, 2)}</pre>
              )
            )}
          </CardContent>
        </Card>

        {/* MCV table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Minimum Customs Value (MCV) Table</CardTitle>
          </CardHeader>
          <CardContent>
            {mcvError ? (
              <p className="text-sm text-red-600">Failed to load the MCV table.</p>
            ) : mcvLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !mcv ? (
              <p className="text-sm text-muted-foreground">No MCV table available.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                  <Badge variant="outline">{mcv.currency}</Badge>
                  <span>Effective {mcv.effectiveDate}</span>
                  <span>·</span>
                  <span>Source: {mcv.source}</span>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>HS Chapter</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>MCV per {mcv.entries[0]?.unit ?? "unit"}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mcv.entries.map((e) => (
                      <TableRow key={e.hsChapter}>
                        <TableCell className="font-mono text-xs">{e.hsChapter}</TableCell>
                        <TableCell className="text-xs">{e.description}</TableCell>
                        <TableCell className="text-xs">{mcv.currency} {e.mvcPerKg.toFixed(2)} / {e.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
