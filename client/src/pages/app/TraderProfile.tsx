import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Building2 } from "lucide-react";
export default function TraderProfile() {
  const { data, isLoading } = trpc.profiles.me.useQuery();
  return (
    <DashboardLayout title="My Profile">
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" />My Business Profile
        </h1>
        <Card>
          <CardHeader><CardTitle className="text-base">Business Details</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? <div className="space-y-3">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-8 w-full"/>)}</div> : !data ? (
              <p className="text-muted-foreground">No profile found. Please complete your business registration.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Organization Name", data.organizationName],
                  ["Organization Code", data.organizationCode],
                  ["License #", data.licenseNumber],
                  ["Tax ID", data.taxId],
                  ["Stakeholder Type", data.stakeholderType],
                  ["Country", data.country],
                  ["Phone", data.phone],
                  ["Status", data.status],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <p className="text-muted-foreground text-xs mb-1">{label}</p>
                    <p className="font-medium">{value ?? "—"}</p>
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
