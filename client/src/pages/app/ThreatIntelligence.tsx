import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, AlertTriangle, Search, Download, RefreshCw, Target, Activity } from "lucide-react";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: "bg-red-600 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-blue-500 text-white",
};

const THREAT_COLORS: Record<string, string> = {
  DRUG: "bg-purple-600 text-white",
  WEAPONS: "bg-red-700 text-white",
  COUNTERFEITING: "bg-orange-600 text-white",
  SANCTIONS: "bg-red-500 text-white",
  FRAUD: "bg-yellow-600 text-black",
};

interface STIXIndicator {
  id: string;
  name: string;
  pattern: string;
  confidence: number;
  labels: string[];
  description: string;
  hs_codes?: string[];
  trader_entities?: string[];
  origin_countries?: string[];
  threat_type: string;
  severity: string;
  valid_from: string;
}

export default function ThreatIntelligence() {
  const [matchForm, setMatchForm] = useState({
    ucr: "",
    hsCodes: "",
    traderName: "",
    originCountry: "",
  });
  const [matchResult, setMatchResult] = useState<{
    matched: boolean;
    risk_score: number;
    threat_types: string[];
    explanation: string;
    indicators: STIXIndicator[];
  } | null>(null);

  const { data: indicators, isLoading: loadingIndicators, refetch } = trpc.threatIntel.getIndicators.useQuery();
  const { data: stats, isLoading: loadingStats } = trpc.threatIntel.getStats.useQuery();
  const { data: stixBundle } = trpc.threatIntel.exportStix.useQuery();

  const matchMutation = trpc.threatIntel.matchDeclaration.useMutation({
    onSuccess: (data) => {
      setMatchResult(data as typeof matchResult);
      if (data.matched) {
        toast.warning(`${data.indicators.length} threat indicator(s) matched — risk score: ${data.risk_score}`);
      } else {
        toast.success("No threat indicators matched for this declaration.");
      }
    },
    onError: () => toast.error("Failed to match declaration against threat indicators"),
  });

  const handleMatch = () => {
    if (!matchForm.ucr) {
      toast.error("UCR is required");
      return;
    }
    matchMutation.mutate({
      ucr: matchForm.ucr,
      hsCodes: matchForm.hsCodes ? matchForm.hsCodes.split(",").map(s => s.trim()) : [],
      traderName: matchForm.traderName || undefined,
      originCountry: matchForm.originCountry || undefined,
    });
  };

  const handleExportSTIX = () => {
    if (!stixBundle) return;
    const blob = new Blob([JSON.stringify(stixBundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stix-bundle-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("STIX bundle exported");
  };

  const indicatorList = (indicators as { indicators?: STIXIndicator[] } | undefined)?.indicators ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="h-6 w-6 text-red-500" />
              Threat Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              OpenCTI STIX 2.1 indicators — match declarations against known threat actors
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Sync
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportSTIX}>
              <Download className="h-4 w-4 mr-1" /> Export STIX
            </Button>
          </div>
        </div>

        {/* Stats Row */}
        {!loadingStats && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total Indicators", value: (stats as { total_indicators?: number }).total_indicators ?? 0, icon: <Shield className="h-5 w-5 text-red-400" /> },
              { label: "Threat Actors", value: (stats as { total_actors?: number }).total_actors ?? 0, icon: <Target className="h-5 w-5 text-orange-400" /> },
              { label: "Critical", value: (stats as { by_severity?: Record<string, number> }).by_severity?.CRITICAL ?? 0, icon: <AlertTriangle className="h-5 w-5 text-red-500" /> },
              { label: "High", value: (stats as { by_severity?: Record<string, number> }).by_severity?.HIGH ?? 0, icon: <Activity className="h-5 w-5 text-orange-500" /> },
            ].map(s => (
              <Card key={s.label} className="bg-card border-border">
                <CardContent className="p-4 flex items-center gap-3">
                  {s.icon}
                  <div>
                    <p className="text-2xl font-bold text-foreground">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Tabs defaultValue="indicators">
          <TabsList>
            <TabsTrigger value="indicators">STIX Indicators</TabsTrigger>
            <TabsTrigger value="match">Declaration Match</TabsTrigger>
          </TabsList>

          {/* Indicators Tab */}
          <TabsContent value="indicators" className="space-y-3 mt-4">
            {loadingIndicators ? (
              <p className="text-muted-foreground text-sm">Loading indicators…</p>
            ) : indicatorList.length === 0 ? (
              <p className="text-muted-foreground text-sm">No indicators loaded.</p>
            ) : (
              indicatorList.map((ind: STIXIndicator) => (
                <Card key={ind.id} className="bg-card border-border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-semibold text-foreground text-sm">{ind.name}</span>
                          <Badge className={`text-xs ${SEVERITY_COLORS[ind.severity] ?? "bg-gray-500 text-white"}`}>
                            {ind.severity}
                          </Badge>
                          <Badge className={`text-xs ${THREAT_COLORS[ind.threat_type] ?? "bg-gray-500 text-white"}`}>
                            {ind.threat_type}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mb-2">{ind.description}</p>
                        <code className="text-xs bg-muted px-2 py-1 rounded font-mono block truncate">{ind.pattern}</code>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {ind.hs_codes?.map(hs => (
                            <Badge key={hs} variant="outline" className="text-xs">HS: {hs}</Badge>
                          ))}
                          {ind.origin_countries?.map(c => (
                            <Badge key={c} variant="outline" className="text-xs">Origin: {c}</Badge>
                          ))}
                          {ind.labels?.map(l => (
                            <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">Confidence</p>
                        <p className="text-lg font-bold text-foreground">{ind.confidence}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          {/* Declaration Match Tab */}
          <TabsContent value="match" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Search className="h-4 w-4" /> Match Declaration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <Label>UCR *</Label>
                    <Input placeholder="UCR-2026-001234" value={matchForm.ucr}
                      onChange={e => setMatchForm(f => ({ ...f, ucr: e.target.value }))} />
                  </div>
                  <div>
                    <Label>HS Codes (comma-separated)</Label>
                    <Input placeholder="2939.99, 8471.30" value={matchForm.hsCodes}
                      onChange={e => setMatchForm(f => ({ ...f, hsCodes: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Trader Name</Label>
                    <Input placeholder="Acme Trading Co" value={matchForm.traderName}
                      onChange={e => setMatchForm(f => ({ ...f, traderName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Origin Country (ISO-2)</Label>
                    <Input placeholder="CO" maxLength={2} value={matchForm.originCountry}
                      onChange={e => setMatchForm(f => ({ ...f, originCountry: e.target.value.toUpperCase() }))} />
                  </div>
                  <Button className="w-full" onClick={handleMatch} disabled={matchMutation.isPending}>
                    {matchMutation.isPending ? "Matching…" : "Match Against Indicators"}
                  </Button>
                </CardContent>
              </Card>

              {matchResult && (
                <Card className={`border-2 ${matchResult.matched ? "border-red-500 bg-red-950/20" : "border-green-500 bg-green-950/20"}`}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      {matchResult.matched ? (
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      ) : (
                        <Shield className="h-4 w-4 text-green-400" />
                      )}
                      Match Result
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge className={matchResult.matched ? "bg-red-600 text-white" : "bg-green-600 text-white"}>
                        {matchResult.matched ? "THREAT MATCHED" : "CLEAR"}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Risk Score</span>
                      <span className="text-xl font-bold text-foreground">{matchResult.risk_score}</span>
                    </div>
                    {matchResult.threat_types.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Threat Types</p>
                        <div className="flex flex-wrap gap-1">
                          {matchResult.threat_types.map(t => (
                            <Badge key={t} className={THREAT_COLORS[t] ?? "bg-gray-500 text-white"}>{t}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{matchResult.explanation}</p>
                    {matchResult.indicators.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-1">Matched Indicators</p>
                        {matchResult.indicators.map((ind: STIXIndicator) => (
                          <div key={ind.id} className="text-xs bg-muted rounded px-2 py-1 mb-1">
                            <span className="font-medium">{ind.name}</span>
                            <span className="text-muted-foreground ml-2">{ind.severity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
