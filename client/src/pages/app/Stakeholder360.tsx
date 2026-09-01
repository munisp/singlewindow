import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { Search, AlertCircle, Building2, FileText, CreditCard, Key, Briefcase } from "lucide-react";

/**
 * Stakeholder-360 — unified party profile (Phase 12).
 * Fail-closed: query errors render an explicit error alert; no fabricated
 * profile data is ever displayed.
 */
export default function Stakeholder360() {
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const search = trpc.stakeholders.search.useQuery(
    { q: submitted, limit: 25, offset: 0 },
    { enabled: submitted.length >= 0 && submitted !== "" }
  );
  const view = trpc.stakeholders.get360.useQuery(
    { profileId: selectedId ?? 0 },
    { enabled: selectedId != null }
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Stakeholder 360</h1>
          <p className="text-muted-foreground">
            Unified party view — declarations, payments, permits, certificates, API usage, open cases.
          </p>
        </div>

        <div className="flex gap-2 max-w-xl">
          <Input
            placeholder="Search by organisation, code, TIN or license…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setSubmitted(q)}
          />
          <Button onClick={() => setSubmitted(q)}>
            <Search className="h-4 w-4 mr-1" /> Search
          </Button>
        </div>

        {search.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Search unavailable</AlertTitle>
            <AlertDescription>{search.error.message}</AlertDescription>
          </Alert>
        )}

        {search.data && (
          <Card>
            <CardHeader>
              <CardTitle>{search.data.total} stakeholder(s)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {search.data.items.length === 0 && (
                <p className="text-sm text-muted-foreground">No stakeholders match the search.</p>
              )}
              {search.data.items.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedId(s.id)}
                  className={`w-full text-left border rounded p-3 hover:bg-accent flex items-center justify-between ${selectedId === s.id ? "border-primary" : ""}`}
                >
                  <div>
                    <div className="font-medium">{s.organizationName ?? `Profile #${s.id}`}</div>
                    <div className="text-xs text-muted-foreground">
                      TIN {s.taxId ?? "—"} · {s.organizationCode ?? "—"}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Badge variant="outline">{s.stakeholderType}</Badge>
                    <Badge>{s.status}</Badge>
                  </div>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {view.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>360 profile unavailable</AlertTitle>
            <AlertDescription>{view.error.message}</AlertDescription>
          </Alert>
        )}

        {view.data && (
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {view.data.profile.organizationName ?? `Profile #${view.data.profile.id}`}
                  <Badge>{view.data.profile.status}</Badge>
                  {view.data.profile.aeoStatus !== "none" && (
                    <Badge variant="secondary">AEO {view.data.profile.aeoTier}</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Type</span><div>{view.data.profile.stakeholderType}</div></div>
                <div><span className="text-muted-foreground">TIN</span><div>{view.data.profile.taxId ?? "—"}</div></div>
                <div><span className="text-muted-foreground">License</span><div>{view.data.profile.licenseNumber ?? "—"}</div></div>
                <div><span className="text-muted-foreground">Owner</span><div>{view.data.owner?.name ?? "—"} ({view.data.owner?.email ?? "—"})</div></div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-3 gap-4">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Declarations</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div>Total: {view.data.aggregates.declarations.total}</div>
                  <div>Cleared: {view.data.aggregates.declarations.cleared}</div>
                  <div>In flight: {view.data.aggregates.declarations.pending}</div>
                  <div>Duty assessed: {view.data.aggregates.declarations.totalDuty}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CreditCard className="h-4 w-4" /> Payments</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  <div>Total: {view.data.aggregates.payments.total}</div>
                  <div>Confirmed: {view.data.aggregates.payments.confirmed}</div>
                  <div>Failed: {view.data.aggregates.payments.failed}</div>
                  <div>Paid: {view.data.aggregates.payments.totalPaid}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Key className="h-4 w-4" /> API keys</CardTitle></CardHeader>
                <CardContent className="text-sm space-y-1">
                  {view.data.aggregates.apiKeys.length === 0 && <div>No API keys.</div>}
                  {view.data.aggregates.apiKeys.map((k: any) => (
                    <div key={k.id} className="flex justify-between">
                      <span>{k.name} ({k.keyPrefix}…)</span>
                      <span>{k.usage.calls30d} calls/30d</span>
                    </div>
                  ))}
                  <div className="pt-2 border-t flex items-center gap-1">
                    <Briefcase className="h-3 w-3" /> Open cases: {view.data.aggregates.openCases}
                  </div>
                </CardContent>
              </Card>
            </div>

            {!view.data.aggregates.taxStamps.available && (
              <p className="text-xs text-muted-foreground">
                Tax stamps and insurance policies are served by external services and are not aggregated locally: {view.data.aggregates.taxStamps.reason}
              </p>
            )}

            <Card>
              <CardHeader><CardTitle>Interaction timeline</CardTitle></CardHeader>
              <CardContent>
                {view.data.timeline.length === 0 && (
                  <p className="text-sm text-muted-foreground">No interactions recorded.</p>
                )}
                <ol className="relative border-l space-y-3 ml-2">
                  {view.data.timeline.map((t: any, i: number) => (
                    <li key={i} className="ml-4">
                      <div className="absolute w-2 h-2 bg-primary rounded-full -left-[5px] mt-1.5" />
                      <div className="text-xs text-muted-foreground">{new Date(t.at).toLocaleString()}</div>
                      <div className="text-sm font-medium">{t.kind}: {t.ref}</div>
                      <div className="text-sm text-muted-foreground">{t.detail}</div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
