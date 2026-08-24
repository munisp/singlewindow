import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertCircle, CheckCircle2, Clock, Loader2, Search, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function ApplicationTracker() {
  const params = useParams<{ referenceNumber?: string }>();
  const [, navigate] = useLocation();
  const [input, setInput] = useState(params.referenceNumber ?? "");
  const referenceNumber = params.referenceNumber?.trim() ?? "";
  const query = trpc.applicationTracking.track.useQuery(
    { referenceNumber: referenceNumber || "________" },
    { enabled: referenceNumber.length >= 8, retry: false },
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value.length >= 8) navigate(`/track-application/${encodeURIComponent(value)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 px-4 py-8 text-slate-100">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <header className="text-center">
          <Shield className="mx-auto mb-2 h-8 w-8 text-amber-400" />
          <h1 className="text-xl font-semibold">Track your Application</h1>
          <p className="mt-1 text-sm text-slate-400">Nigeria National Single Window public services</p>
        </header>
        <Card className="border-slate-700 bg-slate-800/70">
          <CardHeader><CardTitle className="text-base">Application reference</CardTitle></CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={submit}>
              <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Enter your reference number" className="bg-slate-900 text-white" />
              <Button type="submit" disabled={input.trim().length < 8}><Search className="mr-2 h-4 w-4" />Track</Button>
            </form>
          </CardContent>
        </Card>
        {query.isLoading && <Card className="border-slate-700 bg-slate-800/70"><CardContent className="flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Checking the application registry…</CardContent></Card>}
        {!query.isLoading && query.isError && (
          <Card className="border-red-700 bg-red-950/40"><CardContent className="flex gap-3 p-6 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
            <span>{query.error.data?.code === "NOT_FOUND" ? "Application not found." : "Application tracking is unavailable. Please try again later."}</span>
          </CardContent></Card>
        )}
        {query.data && (
          <Card className="border-slate-700 bg-white text-slate-900">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm">{query.data.referenceNumber}</span>
                <Badge variant="outline" className="capitalize">{query.data.status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span>Type: {query.data.type.replace(/_/g, " ")}</span></div>
              <div className="space-y-1 text-xs text-slate-500">
                <p><Clock className="mr-1 inline h-3 w-3" />Submitted: {new Date(query.data.createdAt).toLocaleString()}</p>
                <p>Last updated: {new Date(query.data.updatedAt).toLocaleString()}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
