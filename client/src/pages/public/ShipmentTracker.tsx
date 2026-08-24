import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { AlertCircle, CheckCircle2, Clock, Loader2, MapPin, Search, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

export default function ShipmentTracker() {
  const params = useParams<{ declarationRef?: string }>();
  const [, navigate] = useLocation();
  const [input, setInput] = useState(params.declarationRef ?? "");
  const declarationRef = params.declarationRef?.trim() ?? "";
  const query = trpc.cargoTracking.getShipmentPosition.useQuery(
    { declarationRef: declarationRef || "________" },
    { enabled: declarationRef.length >= 8, retry: false },
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value.length >= 8) navigate(`/track-shipment/${encodeURIComponent(value)}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 px-4 py-8 text-slate-100">
      <div className="mx-auto w-full max-w-lg space-y-4">
        <header className="text-center">
          <Shield className="mx-auto mb-2 h-8 w-8 text-amber-400" />
          <h1 className="text-xl font-semibold">Track your Shipment</h1>
          <p className="mt-1 text-sm text-slate-400">Nigeria National Single Window public services</p>
        </header>
        <Card className="border-slate-700 bg-slate-800/70">
          <CardHeader><CardTitle className="text-base">Declaration or UCR reference</CardTitle></CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={submit}>
              <Input value={input} onChange={e => setInput(e.target.value)} placeholder="Enter declaration number or UCR" className="bg-slate-900 text-white" />
              <Button type="submit" disabled={input.trim().length < 8}><Search className="mr-2 h-4 w-4" />Track</Button>
            </form>
          </CardContent>
        </Card>
        {query.isLoading && <Card className="border-slate-700 bg-slate-800/70"><CardContent className="flex items-center gap-2 p-6 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Checking vessel tracking…</CardContent></Card>}
        {!query.isLoading && query.isError && (
          <Card className="border-red-700 bg-red-950/40"><CardContent className="flex gap-3 p-6 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
            <span>{query.error.data?.code === "NOT_FOUND" ? "Shipment reference not found." : "Shipment tracking is unavailable. Please try again later."}</span>
          </CardContent></Card>
        )}
        {query.data?.trackingStatus === "not_linked" && (
          <Card className="border-amber-700 bg-amber-950/40"><CardContent className="flex gap-3 p-6 text-sm">
            <Clock className="h-5 w-5 shrink-0 text-amber-400" />
            <span>{query.data.message}</span>
          </CardContent></Card>
        )}
        {query.data?.trackingStatus === "unavailable" && (
          <Card className="border-red-700 bg-red-950/40"><CardContent className="flex gap-3 p-6 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
            <span>{query.data.message}</span>
          </CardContent></Card>
        )}
        {query.data?.trackingStatus === "position" && (
          <Card className="border-slate-700 bg-white text-slate-900">
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="font-semibold">{query.data.vesselName ?? "Vessel name unavailable"}</span>
                <Badge variant="outline" className="border-emerald-500 text-emerald-700">Position available</Badge>
              </div>
              <div className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /><span>{query.data.latitude.toFixed(5)}, {query.data.longitude.toFixed(5)}</span></div>
              <div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span>Destination: {query.data.destination ?? "Unavailable"}</span></div>
              <div className="space-y-1 text-xs text-slate-500">
                <p>ETA: {query.data.eta ? new Date(query.data.eta).toLocaleString() : "Unavailable"}</p>
                <p>Last update: {new Date(query.data.lastUpdate).toLocaleString()}</p>
                <p>Linkage: {query.data.linkage}</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
