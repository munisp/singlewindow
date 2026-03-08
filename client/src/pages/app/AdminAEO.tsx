import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
export default function AdminAEO() {
  const { data, isLoading } = trpc.aeo.all.useQuery({ limit: 50, offset: 0 });
  return (
    <DashboardLayout title="AEO Management">
      <div className="space-y-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />AEO Management
        </h1>
        <Card>
          <CardHeader><CardTitle className="text-base">AEO Applications</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10 w-full"/>)}</div> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Application #</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Submitted</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {(data ?? []).map((a: any) => (
                      <tr key={a.id} className="hover:bg-muted/20">
                        <td className="p-3 font-mono text-xs">{a.applicationNumber}</td>
                        <td className="p-3">{a.aeoType}</td>
                        <td className="p-3"><Badge variant="outline">{a.status}</Badge></td>
                        <td className="p-3 text-xs text-muted-foreground">{a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
