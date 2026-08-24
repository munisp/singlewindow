import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertCircle, CheckCircle2, Loader2, Search, Shield, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function PermitValidation() {
  const params = useParams<{ permitNumber?: string }>();
  const [, navigate] = useLocation();
  const [input, setInput] = useState(params.permitNumber ?? "");
  const permitNumber = params.permitNumber?.trim() ?? "";
  const query = trpc.oga.validatePermit.useQuery(
    { permitNumber: permitNumber || "________" },
    { enabled: permitNumber.length > 0, retry: false },
  );
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value) navigate(`/verify/permit/${encodeURIComponent(value)}`);
  };
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 px-4 py-8 text-slate-100">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <header className="text-center">
          <Shield className="mx-auto mb-2 h-8 w-8 text-amber-400" />
          <h1 className="text-xl font-semibold">Permit Validation</h1>
          <p className="mt-1 text-sm text-slate-400">Verify an OGA permit before relying on it</p>
        </header>
        <Card className="border-slate-700 bg-slate-800/70">
          <CardHeader><CardTitle className="text-base">Permit number</CardTitle></CardHeader>
          <CardContent><form className="flex gap-2" onSubmit={submit}>
            <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Enter permit number" className="bg-slate-900 text-white" />
            <Button type="submit" disabled={!input.trim()}><Search className="mr-2 h-4 w-4" />Validate</Button>
          </form></CardContent>
        </Card>
        {query.isLoading && <Card className="border-slate-700 bg-slate-800/70"><CardContent className="flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Checking the permit registry…</CardContent></Card>}
        {!query.isLoading && query.isError && <Card className="border-red-700 bg-red-950/40"><CardContent className="flex gap-3 p-6 text-sm"><AlertCircle className="h-5 w-5 shrink-0 text-red-400" />{query.error.data?.code === "NOT_FOUND" ? "Permit not found." : "Permit validation is unavailable."}</CardContent></Card>}
        {query.data && <Card className="border-slate-700 bg-white text-slate-900"><CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-3">{query.data.isValid ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <XCircle className="h-7 w-7 text-red-600" />}<div><p className="font-semibold">{query.data.isValid ? "Permit valid" : query.data.isExpired ? "Permit expired" : "Permit not valid"}</p><p className="font-mono text-xs">{query.data.permitNumber}</p></div></div>
          <div className="grid grid-cols-2 gap-3 text-sm"><span>Agency</span><span className="font-medium">{query.data.agencyName} ({query.data.agencyCode})</span><span>Permit type</span><span>{query.data.permitType ?? "—"}</span><span>Status</span><Badge variant="outline" className="w-fit capitalize">{query.data.status}</Badge><span>Expires</span><span>{query.data.expiresAt ? new Date(query.data.expiresAt).toLocaleDateString() : "No expiry recorded"}</span></div>
        </CardContent></Card>}
      </div>
    </div>
  );
}
