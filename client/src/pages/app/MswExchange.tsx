/**
 * Phase 22 — MSW Cross-Border Exchange (admin)
 * UI for the previously orphaned `mswExchange` tRPC router (Phase 10 WP-3):
 * transforms an ACCEPTED FAL declaration version into a signed IMO Compendium
 * envelope v1.0 and optionally delivers it to the configured peer authority.
 * Admin-only (router is adminProcedure; route is AdminGuard-wrapped).
 * Delivery state is shown honestly — NOT_DELIVERED_NO_PEER_CONFIGURED unless
 * MSW_EXCHANGE_PEER_URL is set and deliver=true. Fail closed on any mismatch.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Globe2, Send, AlertTriangle, FileJson } from "lucide-react";

export default function MswExchange() {
  const [declarationId, setDeclarationId] = useState("");
  const [deliver, setDeliver] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const exportMutation = trpc.mswExchange.exportDeclaration.useMutation({
    onSuccess: (r) => {
      setResult(r);
      setError(null);
      toast.success("Signed IMO Compendium envelope built");
    },
    onError: (e) => {
      setResult(null);
      setError(e.message);
    },
  });

  const deliveryState: string | undefined = result?.delivery?.state ?? result?.deliveryState ?? undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe2 className="w-6 h-6 text-primary" />
            MSW Cross-Border Exchange
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Export an ACCEPTED declaration as a signed IMO Compendium envelope v1.0 for a peer
            Maritime Single Window authority. Ingest is peer-authenticated on{" "}
            <code className="text-xs">POST /api/v1/msw/exchange/ingest</code> and has no UI.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Export Declaration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-wrap items-center gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setError(null);
                if (!declarationId.trim()) return toast.error("Enter a declaration ID");
                exportMutation.mutate({ declarationId: declarationId.trim(), deliver });
              }}
            >
              <Input
                className="w-72"
                placeholder="Declaration ID"
                value={declarationId}
                onChange={(e) => setDeclarationId(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} />
                Attempt delivery to configured peer (MSW_EXCHANGE_PEER_URL)
              </label>
              <Button type="submit" disabled={exportMutation.isPending}>
                <Send className="w-4 h-4 mr-1" />
                {exportMutation.isPending ? "Building envelope…" : "Export"}
              </Button>
            </form>

            {error && (
              <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <p className="font-mono text-xs font-semibold">{error.split(":")[0]}</p>
                  <p className="text-xs mt-0.5">{error}</p>
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Delivery state:</span>
                  <Badge className={deliveryState === "DELIVERED" ? "bg-green-500/20 text-green-600" : "bg-amber-500/20 text-amber-600"}>
                    {deliveryState ?? "UNKNOWN"}
                  </Badge>
                </div>
                {deliveryState === "NOT_DELIVERED_NO_PEER_CONFIGURED" && (
                  <p className="text-xs text-muted-foreground">
                    Envelope was built and signed but not delivered — no peer URL configured
                    (MSW_EXCHANGE_PEER_URL unset) or delivery not requested. This is the honest default.
                  </p>
                )}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileJson className="w-4 h-4" />Signed envelope
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs font-mono overflow-auto max-h-96 p-3 rounded bg-muted/50">
                      {JSON.stringify(result.envelope ?? result, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
