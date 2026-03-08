import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
export default function CustomsRisk() {
  const { data, isLoading } = trpc.declarations.all.useQuery({ limit: 50, offset: 0 });
  const redLane = (data ?? []).filter((d: any) => d.riskLane === "red");
  const yellowLane = (data ?? []).filter((d: any) => d.riskLane === "yellow");
  return (
    <DashboardLayout title="Risk Assessment">
      <div className="space-y-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <AlertTriangle className="h-6 w-6 text-primary" />Risk Assessment Queue
        </h1>
        <div className="grid grid-cols-2 gap-4">
          <Card className="border-red-500/30">
            <CardHeader><CardTitle className="text-base text-red-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4"/>Red Lane ({redLane.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {isLoading ? <Skeleton className="h-40 m-4" /> : (
                <div className="divide-y max-h-80 overflow-y-auto">
                  {redLane.map((d: any) => (
                    <div key={d.id} className="p-3 flex items-center justify-between">
                      <div>
                        <p className="font-mono text-xs font-medium">{d.declarationNumber}</p>
                        <p className="text-xs text-muted-foreground">{d.hsCode} · {d.countryOfOrigin}</p>
                      </div>
                      <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20">Score: {d.riskScore ?? "—"}</Badge>
                    </div>
                  ))}
                  {redLane.length === 0 && <p className="p-4 text-sm text-muted-foreground">No red-lane declarations</p>}
                </div>
              )}
            </CardContent>
          </Card>
          <Card className="border-amber-500/30">
            <CardHeader><CardTitle className="text-base text-amber-400 flex items-center gap-2"><AlertTriangle className="h-4 w-4"/>Yellow Lane ({yellowLane.length})</CardTitle></CardHeader>
            <CardContent className="p-0">
              {isLoading ? <Skeleton className="h-40 m-4" /> : (
                <div className="divide-y max-h-80 overflow-y-auto">
                  {yellowLane.map((d: any) => (
                    <div key={d.id} className="p-3 flex items-center justify-between">
                      <div>
                        <p className="font-mono text-xs font-medium">{d.declarationNumber}</p>
                        <p className="text-xs text-muted-foreground">{d.hsCode} · {d.countryOfOrigin}</p>
                      </div>
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20">Score: {d.riskScore ?? "—"}</Badge>
                    </div>
                  ))}
                  {yellowLane.length === 0 && <p className="p-4 text-sm text-muted-foreground">No yellow-lane declarations</p>}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
