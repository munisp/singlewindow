import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

export default function TraderAEO() {
  const { data, isLoading, refetch } = trpc.aeo.myApplication.useQuery();
  const apply = trpc.aeo.submitApplication.useMutation({
    onSuccess: () => {
      toast.success("AEO application submitted");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <DashboardLayout title="AEO Application">
      <div className="space-y-6 max-w-3xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-primary" />Authorised Economic Operator
        </h1>
        <Card>
          <CardHeader><CardTitle className="text-base">My AEO Application</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : !data ? (
              <div className="text-center py-8">
                <ShieldCheck className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
                <p className="text-muted-foreground mb-4">No AEO application yet</p>
                <Button
                  onClick={() => apply.mutate({
                    applicantType: "importer",
                    yearsInBusiness: 5,
                    annualTradeVolume: 1000000,
                    numberOfDeclarationsPerYear: 100,
                    hasComplianceOfficer: true,
                    hasTradingPartnerVetting: true,
                    hasSecurityProcedures: true,
                    hasFinancialSolvency: true,
                    selfAssessmentScore: 75,
                  })}
                  disabled={apply.isPending}
                >
                  Apply for AEO Status
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div>
                    <p className="font-mono text-sm font-medium">{(data as any).applicationNumber ?? "—"}</p>
                    <p className="text-sm text-muted-foreground">{(data as any).applicantType}</p>
                  </div>
                  <Badge variant="outline">{(data as any).status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ["Compliance Score", `${(data as any).complianceScore ?? "—"}/100`],
                    ["Security Score", `${(data as any).securityScore ?? "—"}/100`],
                    ["Annual Declarations", (data as any).annualDeclarationVolume],
                    ["Years in Business", (data as any).yearsInBusiness],
                  ].map(([label, value]) => (
                    <div key={label as string} className="p-3 bg-muted/30 rounded-lg">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="font-semibold">{String(value ?? "—")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
