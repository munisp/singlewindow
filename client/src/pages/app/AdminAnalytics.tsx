import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, TrendingUp, FileText, Clock, CheckCircle } from "lucide-react";
export default function AdminAnalytics() {
  const { data: stats, isLoading } = trpc.declarations.stats.useQuery();
  return (
    <DashboardLayout title="Analytics">
      <div className="space-y-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />Platform Analytics
        </h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Declarations", value: stats?.total, icon: <FileText className="h-5 w-5 text-blue-400" /> },
            { label: "Cleared", value: stats?.cleared, icon: <CheckCircle className="h-5 w-5 text-emerald-400" /> },
            { label: "Pending", value: stats?.pending, icon: <Clock className="h-5 w-5 text-amber-400" /> },
            { label: "Rejected", value: stats?.rejected, icon: <TrendingUp className="h-5 w-5 text-purple-400" /> },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {s.icon}
                <div>
                  <p className="text-xl font-bold">{isLoading ? <Skeleton className="h-6 w-16" /> : (s.value ?? "—")}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Declaration Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <Skeleton className="h-40 w-full" /> : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  ["Total", stats?.total],
                  ["Cleared", stats?.cleared],
                  ["Pending", stats?.pending],
                  ["Rejected", stats?.rejected],
                ].map(([label, val]) => (
                  <div key={label as string} className="text-center p-3 rounded-lg bg-muted/30">
                    <p className="text-2xl font-bold">{String(val ?? 0)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{label}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
