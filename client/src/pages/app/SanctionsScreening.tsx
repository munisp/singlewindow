/**
 * Sanctions & Restricted Party Screening — Production
 * Real-time entity screening against OFAC SDN, UN, EU, OFSI, INTERPOL.
 * Includes KPI summary, alert history tab, and match detail display.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Globe, Search, AlertTriangle, CheckCircle, Shield, RefreshCw, Clock, XCircle, Upload } from "lucide-react";
import { toast } from "sonner";

const RESULT_CFG: Record<string, { label: string; color: string; bg: string; border: string; Icon: React.ComponentType<any> }> = {
  confirmed_match: { label: "CONFIRMED MATCH", color: "text-red-400", bg: "bg-red-500/5", border: "border-red-500/30", Icon: XCircle },
  potential_match: { label: "POTENTIAL MATCH", color: "text-amber-400", bg: "bg-amber-500/5", border: "border-amber-500/30", Icon: AlertTriangle },
  clear: { label: "CLEAR", color: "text-emerald-400", bg: "bg-emerald-500/5", border: "border-emerald-500/30", Icon: CheckCircle },
};

const SCREENING_SOURCES = [
  "OFAC Specially Designated Nationals (SDN)",
  "UN Security Council Consolidated",
  "EU Consolidated Sanctions List",
  "OFSI (UK Treasury)",
  "INTERPOL Notices",
  "WCO CEN Network",
];

export default function SanctionsScreening() {
  const [query, setQuery] = useState("");
  const [entityType, setEntityType] = useState<"individual" | "company" | "vessel" | "aircraft">("company");

  const screen = trpc.security.screenEntity.useMutation();
  const { data: alerts, isLoading: alertsLoading, refetch } = trpc.security.alerts.useQuery({ limit: 50, offset: 0 });

  const handleScreen = () => {
    if (!query.trim()) return;
    screen.mutate({ entityName: query, entityType }, {
      onSuccess: (r) => {
        const isHit = r.checkResult === "confirmed_match" || r.checkResult === "potential_match";
        if (isHit) toast.error(`Sanctions hit detected: ${r.entityName}`);
        else toast.success(`${r.entityName} — CLEAR`);
      },
      onError: (e) => toast.error(e.message),
    });
  };

  const result = screen.data;
  const resultCfg = result ? (RESULT_CFG[result.checkResult] ?? RESULT_CFG.clear) : null;

  const complianceAlerts = (alerts ?? []).filter((a: any) =>
    a.category === "compliance" || a.title?.toLowerCase().includes("sanction")
  );

  const batchScreenMutation = trpc.security.batchScreenEntities.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch screening complete: ${data.results.length} entities processed`);
    },
    onError: (err) => {
      toast.error(`Batch screening failed: ${err.message}`);
    },
  });

  const handleBatchCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      // Expect CSV: name,type (header optional)
      const entities = lines
        .filter(l => !l.toLowerCase().startsWith('name'))
        .map(l => {
          const [name, type] = l.split(',');
          const rawType = type?.trim() || 'individual';
          const entityType = (['individual', 'company', 'vessel'].includes(rawType) ? rawType : 'individual') as 'individual' | 'company' | 'vessel';
          return { name: name?.trim() || '', entityType };
        })
        .filter(e => e.name);
      if (entities.length === 0) {
        toast.error("No valid entities found in CSV");
        return;
      }
      batchScreenMutation.mutate({ entities });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const confirmedHits = complianceAlerts.filter((a: any) => a.severity === "critical" || a.severity === "high").length;
  const pendingReview = complianceAlerts.filter((a: any) => !a.acknowledgedAt).length;

  return (
    <DashboardLayout title="Sanctions Screening">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />Sanctions & Restricted Party Screening
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              OFAC SDN · UN Security Council · EU Consolidated · OFSI · INTERPOL
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer">
              <input type="file" accept=".csv" className="hidden" onChange={handleBatchCsvUpload} />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors">
                {batchScreenMutation.isPending ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Batch CSV
              </span>
            </label>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Compliance Alerts", value: complianceAlerts.length, Icon: Shield, color: "text-primary", bg: "bg-primary/10" },
            { label: "Confirmed Hits", value: confirmedHits, Icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
            { label: "Pending Review", value: pendingReview, Icon: Clock, color: "text-amber-400", bg: "bg-amber-500/10" },
          ].map(({ label, value, Icon, color, bg }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{alertsLoading ? "—" : value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="screen">
          <TabsList>
            <TabsTrigger value="screen">Screen Entity</TabsTrigger>
            <TabsTrigger value="alerts">Alert History</TabsTrigger>
          </TabsList>

          <TabsContent value="screen" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Real-Time Entity Screening</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    placeholder="Entity name, vessel name, or individual..."
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleScreen()}
                    className="flex-1"
                  />
                  <select
                    className="border rounded-md px-3 text-sm bg-background"
                    value={entityType}
                    onChange={e => setEntityType(e.target.value as typeof entityType)}
                  >
                    <option value="individual">Individual</option>
                    <option value="company">Company</option>
                    <option value="vessel">Vessel</option>
                    <option value="aircraft">Aircraft</option>
                  </select>
                  <Button onClick={handleScreen} disabled={screen.isPending} className="gap-1.5">
                    <Search className="h-4 w-4" />
                    {screen.isPending ? "Screening..." : "Screen"}
                  </Button>
                </div>

                {screen.isPending && (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                )}

                {result && resultCfg && (
                  <div className={`p-4 rounded-lg border ${resultCfg.border} ${resultCfg.bg}`}>
                    <div className="flex items-center gap-3 mb-3">
                      <resultCfg.Icon className={`h-5 w-5 ${resultCfg.color}`} />
                      <div>
                        <p className="font-semibold">{result.entityName}</p>
                        <p className="text-xs text-muted-foreground capitalize">{result.entityType}</p>
                      </div>
                      <Badge variant="outline" className={`${resultCfg.color} ml-auto border-current/20`}>
                        {resultCfg.label}
                      </Badge>
                    </div>
                    {result.matchDetails != null &&
                      typeof result.matchDetails === "object" &&
                      Object.keys(result.matchDetails as Record<string, unknown>).length > 0 && (
                        <div className="mt-2 p-3 bg-background/50 rounded text-xs">
                          <p className="font-medium mb-1">Match Details:</p>
                          <pre className="text-muted-foreground whitespace-pre-wrap">
                            {JSON.stringify(result.matchDetails as Record<string, unknown>, null, 2)}
                          </pre>
                        </div>
                      )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Screened: {result.createdAt ? new Date(result.createdAt).toLocaleString() : "—"}
                    </p>
                  </div>
                )}

                <div className="mt-4 p-3 bg-muted/30 rounded-lg text-xs text-muted-foreground">
                  <p className="font-medium mb-2">Active Screening Sources</p>
                  <div className="grid grid-cols-2 gap-1">
                    {SCREENING_SOURCES.map(s => (
                      <div key={s} className="flex items-center gap-1.5">
                        <CheckCircle className="h-3 w-3 text-emerald-400 flex-shrink-0" />
                        <span>{s}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="alerts" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {alertsLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : complianceAlerts.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Shield className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No compliance alerts on record</p>
                  </div>
                ) : (
                  <div className="divide-y max-h-[500px] overflow-y-auto">
                    {complianceAlerts.map((a: any) => (
                      <div key={a.id} className="p-3 flex items-center justify-between hover:bg-muted/20">
                        <div className="flex items-center gap-3">
                          <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                            a.severity === "critical" ? "bg-red-400" :
                            a.severity === "high" ? "bg-orange-400" : "bg-amber-400"
                          }`} />
                          <div>
                            <p className="text-xs font-medium">{a.title}</p>
                            <p className="text-xs text-muted-foreground">{a.description?.slice(0, 80) ?? "—"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="outline" className="text-xs capitalize">{a.severity}</Badge>
                          <p className="text-xs text-muted-foreground">
                            {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
