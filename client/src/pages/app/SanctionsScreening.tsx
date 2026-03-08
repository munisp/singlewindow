import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Globe, Search, AlertTriangle, CheckCircle } from "lucide-react";
import { toast } from "sonner";
export default function SanctionsScreening() {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState<"individual"|"company"|"vessel"|"aircraft">("company");
  const screen = trpc.security.screenEntity.useMutation();
  const handleScreen = () => {
    if (!query.trim()) return;
    screen.mutate({ entityName: query, entityType }, { onError: (e) => toast.error(e.message) });
  };
  const result = screen.data;
  const isHit = result?.checkResult === "confirmed_match" || result?.checkResult === "potential_match";
  return (
    <DashboardLayout title="Sanctions Screening">
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Globe className="h-6 w-6 text-primary" />Sanctions & Restricted Party Screening
        </h1>
        <Card>
          <CardHeader><CardTitle className="text-base">Screen Entity</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Input placeholder="Entity name, vessel name, or individual..." value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && handleScreen()} className="flex-1" />
              <select className="border rounded-md px-3 text-sm bg-background" value={entityType} onChange={e => setEntityType(e.target.value as any)}>
                <option value="individual">Individual</option>
                <option value="company">Company</option>
                <option value="vessel">Vessel</option>
                <option value="aircraft">Aircraft</option>
              </select>
              <Button onClick={handleScreen} disabled={screen.isPending} className="gap-1.5">
                <Search className="h-4 w-4" />Screen
              </Button>
            </div>
            {result && (
              <div className={`p-4 rounded-lg border ${isHit ? "border-red-500/30 bg-red-500/5" : "border-emerald-500/30 bg-emerald-500/5"}`}>
                <div className="flex items-center gap-3 mb-3">
                  {isHit
                    ? <AlertTriangle className="h-5 w-5 text-red-400" />
                    : <CheckCircle className="h-5 w-5 text-emerald-400" />}
                  <div>
                    <p className="font-semibold">{result.entityName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{result.entityType}</p>
                  </div>
                  <Badge variant="outline" className={isHit ? "bg-red-500/10 text-red-400 border-red-500/20 ml-auto" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 ml-auto"}>
                    {result.checkResult === "confirmed_match" ? "CONFIRMED MATCH" :
                     result.checkResult === "potential_match" ? "POTENTIAL MATCH" : "CLEAR"}
                  </Badge>
                </div>
                {result.matchDetails != null && typeof result.matchDetails === "object" && Object.keys(result.matchDetails as Record<string, unknown>).length > 0 && (
                  <div className="mt-2 p-3 bg-background/50 rounded text-xs">
                    <p className="font-medium mb-1">Match Details:</p>
                    <pre className="text-muted-foreground whitespace-pre-wrap">
                      {JSON.stringify(result.matchDetails as Record<string, unknown>, null, 2)}
                    </pre>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-2">
                  Screened at: {result.createdAt ? new Date(result.createdAt).toLocaleString() : "—"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
