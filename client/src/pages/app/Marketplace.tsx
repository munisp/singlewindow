/**
 * WP-8 — API Marketplace: browse/search the signed platform API catalogue.
 * Shows tamper-evidence metadata (sha256 catalogue digest, JWS status) and
 * honest states when the catalogue cannot be loaded.
 */
import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Search, ShieldCheck, ShieldAlert, Package, KeyRound } from "lucide-react";

const CLASS_STYLE: Record<string, string> = {
  PUBLIC: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  PARTNER: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  RESTRICTED: "bg-red-500/10 text-red-400 border-red-500/30",
};

export default function Marketplace() {
  const [query, setQuery] = useState("");
  const [classification, setClassification] = useState<string>("all");
  const { data, isLoading, isError, error } = trpc.marketplace.getSignedCatalogue.useQuery();

  const entries = data?.catalogue.entries ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (classification !== "all" && e.classification !== classification) return false;
      if (!q) return true;
      return (
        e.apiId.toLowerCase().includes(q) ||
        e.title.toLowerCase().includes(q) ||
        e.owner.toLowerCase().includes(q)
      );
    });
  }, [entries, query, classification]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Package className="w-6 h-6" /> API Marketplace
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Signed catalogue of every public API across the BlueEconomy platform.
            </p>
          </div>
          {data && (
            <div className="text-xs text-muted-foreground space-y-1 text-right">
              <div className="flex items-center gap-1.5 justify-end">
                {data.signatureStatus === "SIGNED" ? (
                  <>
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                    <span>Signed (envelope v1.0, Ed25519 JWS, kid {data.kid})</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    <span>Unsigned — signing key not configured on this deployment</span>
                  </>
                )}
              </div>
              <div className="font-mono break-all max-w-md">
                sha256: {data.catalogueDigest}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search APIs by name, owner, or id…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {["all", "PUBLIC", "PARTNER", "RESTRICTED"].map((c) => (
              <button
                key={c}
                onClick={() => setClassification(c)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  classification === c
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>
        </div>

        {isLoading && (
          <div className="grid gap-4 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-40 rounded-xl bg-muted/40 animate-pulse" />
            ))}
          </div>
        )}

        {isError && (
          <Card>
            <CardContent className="py-10 text-center">
              <ShieldAlert className="w-8 h-8 text-amber-500 mx-auto mb-2" />
              <p className="text-sm font-medium">Catalogue unavailable</p>
              <p className="text-xs text-muted-foreground mt-1">{error?.message}</p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm font-medium">No APIs match your search</p>
              <p className="text-xs text-muted-foreground mt-1">
                {entries.length === 0
                  ? "The catalogue is empty on this deployment."
                  : "Try a different keyword or classification filter."}
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((e) => (
            <Card key={e.apiId}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{e.title}</CardTitle>
                  <Badge variant="outline" className={CLASS_STYLE[e.classification] ?? ""}>
                    {e.classification}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{e.apiId} · v{e.version}</p>
              </CardHeader>
              <CardContent className="text-xs space-y-2">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <span className="text-muted-foreground">Owner</span>
                  <span>{e.owner}</span>
                  <span className="text-muted-foreground">SLA</span>
                  <span>
                    {e.sla.availabilityPct}% · ≤{e.sla.maxLatencyMs}ms · {e.sla.support}
                  </span>
                  <span className="text-muted-foreground">Sandbox</span>
                  <span className="flex items-center gap-1">
                    <KeyRound className="w-3 h-3" />
                    {e.sandboxAvailable ? "Available" : "Not available"}
                  </span>
                  <span className="text-muted-foreground">OpenAPI</span>
                  <span className="font-mono truncate" title={e.openapiRef}>{e.openapiRef}</span>
                </div>
                {e.procedures.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {e.procedures.slice(0, 6).map((p) => (
                      <span key={p} className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono">
                        {p}
                      </span>
                    ))}
                    {e.procedures.length > 6 && (
                      <span className="text-[10px] text-muted-foreground">
                        +{e.procedures.length - 6} more
                      </span>
                    )}
                  </div>
                )}
                <p className="font-mono text-[10px] text-muted-foreground break-all pt-1">
                  spec sha256: {e.specDigest}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
