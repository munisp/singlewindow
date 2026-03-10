import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Plus,
  ShieldCheck,
  Timer,
  TrendingUp,
} from "lucide-react";
import { useLocation } from "wouter";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "Draft", variant: "secondary" },
    submitted: { label: "Submitted", variant: "outline" },
    under_review: { label: "Under Review", variant: "default" },
    green_lane: { label: "Green Lane", variant: "default" },
    yellow_lane: { label: "Yellow Lane", variant: "outline" },
    red_lane: { label: "Red Lane", variant: "destructive" },
    cleared: { label: "Cleared", variant: "default" },
    rejected: { label: "Rejected", variant: "destructive" },
    held: { label: "Held", variant: "destructive" },
  };
  const cfg = map[status] ?? { label: status, variant: "secondary" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export default function TraderDashboard() {
  const [, setLocation] = useLocation();
  const { data: stats, isLoading: statsLoading, isError} = trpc.declarations.stats.useQuery();
  const { data: declarations, isLoading: declLoading } = trpc.declarations.myDeclarations.useQuery({ limit: 5 });
  const { data: profile } = trpc.profiles.me.useQuery();
  const { data: aeoApp } = trpc.aeo.myApplication.useQuery();
  const { data: slaRisk } = trpc.slaEscalation.getMyAtRisk.useQuery();

  return (
    <DashboardLayout title="My Dashboard">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load data. Please refresh the page.
        </div>
      )}
      <div className="space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Trader Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your trade declarations and track clearance status
            </p>
          </div>
          <Button onClick={() => setLocation("/app/trader/declarations/new")} className="gap-2">
            <Plus className="h-4 w-4" />
            New Declaration
          </Button>
        </div>

        {/* Profile status banner */}
        {profile && profile.status !== "approved" && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div className="flex-1">
              <p className="font-medium text-sm">Profile {profile.status === "pending" ? "pending approval" : profile.status}</p>
              <p className="text-xs text-amber-700 mt-0.5">
                Your trader profile must be approved before you can submit declarations.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setLocation("/app/trader/profile")} className="shrink-0">
              View Profile
            </Button>
          </div>
        )}

        {/* SLA breach banner */}
        {slaRisk && slaRisk.critical > 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-red-300 bg-red-50 text-red-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
            <div className="flex-1">
              <p className="font-medium text-sm">
                {slaRisk.critical} declaration{slaRisk.critical !== 1 ? "s have" : " has"} exceeded the SLA deadline
              </p>
              <p className="text-xs text-red-700 mt-0.5">
                Our customs team has been notified and is prioritising your cases.
              </p>
            </div>
          </div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}><CardContent className="p-5"><Skeleton className="h-12 w-full" /></CardContent></Card>
            ))
          ) : (
            <>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
                      <p className="text-xs text-muted-foreground">Total Declarations</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <CheckCircle className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats?.cleared ?? 0}</p>
                      <p className="text-xs text-muted-foreground">Cleared</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                      <Clock className="h-5 w-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats?.pending ?? 0}</p>
                      <p className="text-xs text-muted-foreground">Pending</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stats?.rejected ?? 0}</p>
                      <p className="text-xs text-muted-foreground">Rejected</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {/* Recent declarations */}
          <div className="md:col-span-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base font-semibold">Recent Declarations</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setLocation("/app/trader/declarations")} className="gap-1 text-xs">
                  View all <ArrowRight className="h-3 w-3" />
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {declLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : !declarations?.length ? (
                  <div className="p-8 text-center">
                    <FileText className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No declarations yet</p>
                    <Button size="sm" className="mt-4 gap-2" onClick={() => setLocation("/app/trader/declarations/new")}>
                      <Plus className="h-4 w-4" /> Submit your first declaration
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y">
                    {declarations.map((d: any) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between px-5 py-3 hover:bg-muted/40 cursor-pointer transition-colors"
                        onClick={() => setLocation(`/app/trader/declarations/${d.id}`)}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{d.declarationNumber}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {d.importerName} · {d.portOfEntry}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <StatusBadge status={d.status} />
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="space-y-4">
            {/* AEO status */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  AEO Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {!aeoApp ? (
                  <div className="text-center py-2">
                    <p className="text-sm text-muted-foreground mb-3">
                      Authorised Economic Operator status unlocks blue-lane fast-track clearance.
                    </p>
                    <Button size="sm" variant="outline" onClick={() => setLocation("/app/trader/aeo")} className="w-full">
                      Apply for AEO
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <StatusBadge status={aeoApp.status} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Application</span>
                      <span className="text-sm font-mono">{aeoApp.applicationNumber}</span>
                    </div>
                    {aeoApp.certificateNumber && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Certificate</span>
                        <span className="text-sm font-mono text-emerald-600">{aeoApp.certificateNumber}</span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SLA Tracker widget — shown only when there are at-risk declarations */}
            {slaRisk && (slaRisk.critical > 0 || slaRisk.warning > 0) && (
              <Card className="border-amber-500/40 bg-amber-500/5">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold flex items-center gap-2 text-amber-700 dark:text-amber-400">
                    <Timer className="h-4 w-4" />
                    SLA Tracker
                    {slaRisk.critical > 0 && (
                      <Badge variant="destructive" className="ml-auto text-xs">{slaRisk.critical} breached</Badge>
                    )}
                    {slaRisk.critical === 0 && slaRisk.warning > 0 && (
                      <Badge variant="outline" className="ml-auto text-xs border-amber-500 text-amber-600">{slaRisk.warning} at risk</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {slaRisk.declarations.slice(0, 4).map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-muted/50 rounded p-1 -mx-1"
                      onClick={() => setLocation(`/app/trader/declarations/${d.id}`)}
                    >
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        d.urgency === "critical" ? "bg-red-500" :
                        d.urgency === "warning" ? "bg-amber-500" : "bg-emerald-500"
                      }`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono truncate">{d.declarationNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">{d.goodsDescription || d.portOfEntry}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-medium">
                          {d.urgency === "critical" ? "Breached" : `${d.pctElapsed}%`}
                        </p>
                        <p className="text-xs text-muted-foreground">SLA: {d.slaLabel}</p>
                      </div>
                    </div>
                  ))}
                  {slaRisk.declarations.length > 4 && (
                    <p className="text-xs text-muted-foreground text-center pt-1">
                      +{slaRisk.declarations.length - 4} more
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Quick actions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2 text-sm" onClick={() => setLocation("/app/trader/declarations/new")}>
                  <Plus className="h-4 w-4" /> New Declaration
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 text-sm" onClick={() => setLocation("/app/trader/profile")}>
                  <FileText className="h-4 w-4" /> Update Profile
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2 text-sm" onClick={() => setLocation("/app/notification-centre")}>
                  <AlertTriangle className="h-4 w-4" /> View Notifications
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
