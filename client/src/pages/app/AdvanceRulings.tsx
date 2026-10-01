/**
 * Phase 22 — Advance Rulings (WTO TFA Art. 3) & AEO Mutual Recognition
 * UI for the previously orphaned `advanceRuling` tRPC router:
 * view MRA partners, list a trader's ruling requests, and validate AEO
 * credentials against partner MRAs.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Gavel, ShieldCheck, Handshake } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/20 text-yellow-600",
  under_review: "bg-blue-500/20 text-blue-600",
  issued: "bg-green-500/20 text-green-600",
  revoked: "bg-red-500/20 text-red-600",
};

export default function AdvanceRulings() {
  const { data: partners, isLoading: partnersLoading, isError: partnersError } = trpc.advanceRuling.getMRAPartners.useQuery();

  const [traderId, setTraderId] = useState("");
  const [submittedTrader, setSubmittedTrader] = useState<string | null>(null);
  const { data: rulings, isLoading: rulingsLoading, isError: rulingsError } = trpc.advanceRuling.listByTrader.useQuery(
    { traderId: submittedTrader ?? "" },
    { enabled: submittedTrader !== null }
  );

  const [aeoTrader, setAeoTrader] = useState("");
  const [aeoNumber, setAeoNumber] = useState("");
  const [aeoCountry, setAeoCountry] = useState("");
  const validateMutation = trpc.advanceRuling.validateAEO.useMutation({
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gavel className="w-6 h-6 text-primary" />
            Advance Rulings &amp; AEO Mutual Recognition
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            WTO TFA Article 3 advance rulings (tariff classification, origin, valuation) and WCO SAFE Pillar 2 AEO mutual recognition.
          </p>
        </div>

        {/* MRA partners */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Handshake className="w-4 h-4" />MRA Partners</CardTitle></CardHeader>
          <CardContent>
            {partnersError ? (
              <p className="text-sm text-red-600">Failed to load MRA partners.</p>
            ) : partnersLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !partners || partners.length === 0 ? (
              <p className="text-sm text-muted-foreground">No mutual recognition agreements are currently registered.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {partners.map((p) => (
                  <div key={p.countryCode} className="p-4 rounded-lg border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{p.name}</span>
                      <Badge variant="outline">{p.type}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">Signed {p.signedDate}</p>
                    <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-0.5">
                      {p.benefits.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rulings by trader */}
        <Card>
          <CardHeader><CardTitle className="text-base">Ruling Requests by Trader</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (traderId.trim()) setSubmittedTrader(traderId.trim());
                else toast.error("Enter a trader ID");
              }}
            >
              <Input placeholder="Trader ID…" value={traderId} onChange={(e) => setTraderId(e.target.value)} />
              <Button type="submit">Load</Button>
            </form>
            {submittedTrader && (
              rulingsLoading ? (
                <p className="text-sm text-muted-foreground">Loading rulings…</p>
              ) : rulingsError ? (
                <p className="text-sm text-red-600">Failed to load rulings: {rulingsError.message}</p>
              ) : (
                (() => {
                  const items: any[] = Array.isArray(rulings) ? rulings : (rulings as any)?.rulings ?? (rulings as any)?.items ?? [];
                  if (items.length === 0) {
                    return <p className="text-sm text-muted-foreground">No advance ruling requests found for trader {submittedTrader}.</p>;
                  }
                  return (
                    <div className="space-y-2">
                      {items.map((r: any, i: number) => (
                        <div key={r.id ?? r.ruling_id ?? i} className="p-3 rounded-lg border flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-sm font-medium">{(r.ruling_type ?? r.rulingType ?? "ruling").replace(/_/g, " ")}</p>
                            <p className="text-xs text-muted-foreground line-clamp-2">{r.goods_description ?? r.goodsDescription ?? ""}</p>
                            {r.created_at && <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>}
                          </div>
                          <Badge className={STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground"}>
                            {(r.status ?? "unknown").replace(/_/g, " ")}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  );
                })()
              )
            )}
          </CardContent>
        </Card>

        {/* AEO validation */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><ShieldCheck className="w-4 h-4" />Validate AEO Credential</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!aeoTrader.trim() || aeoNumber.trim().length < 3 || aeoCountry.trim().length !== 3) {
                  return toast.error("Trader ID, AEO number (min 3 chars) and 3-letter issuing country are required");
                }
                validateMutation.mutate({ traderId: aeoTrader.trim(), aeoNumber: aeoNumber.trim(), issuingCountry: aeoCountry.trim().toUpperCase() });
              }}
            >
              <Input className="w-40" placeholder="Trader ID" value={aeoTrader} onChange={(e) => setAeoTrader(e.target.value)} />
              <Input className="w-40" placeholder="AEO number" value={aeoNumber} onChange={(e) => setAeoNumber(e.target.value)} />
              <Input className="w-28" placeholder="Country (e.g. DEU)" value={aeoCountry} onChange={(e) => setAeoCountry(e.target.value)} />
              <Button type="submit" disabled={validateMutation.isPending}>
                {validateMutation.isPending ? "Validating…" : "Validate"}
              </Button>
            </form>
            {validateMutation.data && (
              <pre className="text-xs bg-muted/50 border rounded-lg p-4 overflow-x-auto">{JSON.stringify(validateMutation.data, null, 2)}</pre>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
