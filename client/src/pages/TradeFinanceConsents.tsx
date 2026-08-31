/**
 * TradeFinanceConsents.tsx — WP-6 consent management (NTP TFC pattern).
 * Grant/revoke/list bank consents with digest evidence. All operations go
 * through the financial-controls rail (fail-closed client); when the rail is
 * unconfigured the surface shows the unavailable state instead of stub data.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Shield, ShieldCheck, ShieldOff, Loader2, FileKey, RefreshCw } from "lucide-react";

const SCOPES = ["DECLARATION_DIGESTS", "DUTY_PAYMENT_HISTORY", "TAX_STAMP_STATUS"] as const;

const STATE_COLORS: Record<string, string> = {
  PENDING_CHECKER: "bg-amber-900/40 border-amber-500/30",
  ACTIVE: "bg-emerald-900/40 border-emerald-500/30",
  REJECTED: "bg-rose-900/40 border-rose-500/30",
  REVOCATION_PENDING: "bg-amber-900/40 border-amber-500/30",
  REVOKED: "bg-slate-800/60 border-slate-500/30",
};

export default function TradeFinanceConsents() {
  const utils = trpc.useUtils();
  const consentsQuery = trpc.tradeFinance.consentList.useQuery(undefined, { retry: false });

  const [consentId, setConsentId] = useState("");
  const [bankId, setBankId] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["DECLARATION_DIGESTS"]);
  const [refs, setRefs] = useState<Record<string, string>>({});

  const grantMutation = trpc.tradeFinance.consentGrant.useMutation({
    onSuccess: () => {
      toast.success("Consent grant requested — pending compliance checker");
      utils.tradeFinance.consentList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const moveMutation = trpc.tradeFinance.consentMove.useMutation({
    onSuccess: () => {
      toast.success("Consent updated");
      utils.tradeFinance.consentList.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const unavailable = consentsQuery.error?.data?.code === "SERVICE_UNAVAILABLE";

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope]
    );
  }

  function submitGrant() {
    const datasetRefs: Record<string, string[]> = {};
    for (const scope of selectedScopes) {
      const list = (refs[scope] ?? "").split(",").map((r) => r.trim()).filter(Boolean);
      datasetRefs[scope] = list;
    }
    grantMutation.mutate({
      consentId,
      bankId,
      scopes: selectedScopes as any,
      datasetRefs: datasetRefs as any,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  const consents: any[] = (consentsQuery.data as any)?.consents ?? [];

  return (
    <div className="min-h-screen bg-[#0A1628] text-slate-100 p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="w-7 h-7 text-[#D4A017]" />
        <div>
          <h1 className="text-2xl font-bold">Trade Finance — Data Sharing Consents</h1>
          <p className="text-slate-400 text-sm">
            Grant your bank scoped access to customs declaration and duty-payment evidence (Singapore NTP TFC model).
          </p>
        </div>
      </div>

      {unavailable ? (
        <Card className="bg-slate-900/60 border-slate-700">
          <CardContent className="p-6 text-slate-300">
            The trade-finance rail is not configured for this environment. Contact the platform operator.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader><CardTitle className="flex items-center gap-2"><FileKey className="w-5 h-5 text-[#D4A017]" /> Grant consent</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div><Label>Consent ID</Label><Input value={consentId} onChange={(e) => setConsentId(e.target.value)} placeholder="tf-con-001" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Bank</Label><Input value={bankId} onChange={(e) => setBankId(e.target.value)} placeholder="bank-gtb" className="bg-slate-950 border-slate-700" /></div>
                <div><Label>Expires at</Label><Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="bg-slate-950 border-slate-700" /></div>
              </div>
              {SCOPES.map((scope) => (
                <div key={scope} className="flex items-start gap-3">
                  <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="mt-1" />
                  <div className="flex-1">
                    <Label>{scope}</Label>
                    {selectedScopes.includes(scope) && (
                      <Input
                        value={refs[scope] ?? ""}
                        onChange={(e) => setRefs({ ...refs, [scope]: e.target.value })}
                        placeholder="sha256:<64 hex>, comma-separated digest refs"
                        className="bg-slate-950 border-slate-700 mt-1"
                      />
                    )}
                  </div>
                </div>
              ))}
              <Button onClick={submitGrant} disabled={grantMutation.isPending || !consentId || !bankId || !expiresAt || selectedScopes.length === 0} className="bg-[#D4A017] text-[#0A1628] hover:bg-[#b8890f]">
                {grantMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Request grant"}
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-slate-900/60 border-slate-700">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>My consents</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => consentsQuery.refetch()}><RefreshCw className="w-4 h-4" /></Button>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Consent</TableHead><TableHead>Bank</TableHead><TableHead>Scopes</TableHead>
                    <TableHead>State</TableHead><TableHead>Expires</TableHead><TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consents.map((consent) => (
                    <TableRow key={consent.consent_id}>
                      <TableCell className="font-mono text-xs">{consent.consent_id}</TableCell>
                      <TableCell>{consent.bank_id}</TableCell>
                      <TableCell className="text-xs">{(consent.scopes ?? []).join(", ")}</TableCell>
                      <TableCell><Badge className={STATE_COLORS[consent.state] ?? ""}>{consent.state}</Badge></TableCell>
                      <TableCell className="text-xs">{consent.expires_at ? new Date(consent.expires_at).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="space-x-2">
                        {consent.state === "ACTIVE" && (
                          <Button size="sm" variant="destructive"
                            disabled={moveMutation.isPending}
                            onClick={() => moveMutation.mutate({ consentId: consent.consent_id, move: "request-revocation", version: consent.version, bankId: consent.bank_id })}>
                            <ShieldOff className="w-4 h-4 mr-1" /> Revoke
                          </Button>
                        )}
                        {consent.state === "PENDING_CHECKER" && (
                          <Badge className="bg-amber-900/40"><ShieldCheck className="w-3 h-3 mr-1" /> awaiting checker</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {consents.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-slate-400">No consents yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <p className="text-xs text-slate-500 mt-3">
                Evidence rows recorded locally with envelope digests: {(consentsQuery.data as any)?.evidenceCount ?? 0}
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
