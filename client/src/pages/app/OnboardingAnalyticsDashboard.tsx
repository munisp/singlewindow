/**
 * Onboarding Analytics Dashboard — Sprint 72
 * Admin view of trader onboarding funnel metrics, completion rates, and AEO tier distribution.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  Users, TrendingUp, TrendingDown, Clock, CheckCircle, Target, Award,
} from "lucide-react";

const STEP_LABELS: Record<string, string> = {
  company_profile: "Company Profile",
  kyc_documents: "KYC Documents",
  bank_account: "Bank Account",
  test_declaration: "Test Declaration",
  aeo_eligibility: "AEO Eligibility",
};

const AEO_COLORS = ["#D4A017", "#C0C0C0", "#CD7F32"];
const AEO_TIERS = ["Gold", "Silver", "Standard"];

export default function OnboardingAnalyticsDashboard() {
  const { data: funnel, isLoading: funnelLoading } = trpc.onboardingAnalytics.funnel.useQuery();
  const { data: overview, isLoading: overviewLoading } = trpc.onboardingAnalytics.summary.useQuery();
  const { data: aeoTiersData } = trpc.onboardingAnalytics.aeoTiers.useQuery();

  const funnelData = (funnel ?? []).map((f: any) => ({
    step: STEP_LABELS[f.step as string] ?? f.step,
    users: f.usersReached as number,
    completed: f.usersCompleted as number,
    dropOff: f.dropOffRate as number,
    avgTime: f.avgTimeMinutes as number,
  }));

  const aeoData = AEO_TIERS.map((tier, i) => ({
    name: tier,
    value: aeoTiersData?.find((t: { tier: string; count: number }) => t.tier === tier)?.count ?? 0,
    color: AEO_COLORS[i],
  }));

  const kpis = [
    {
      label: "Total Started",
      value: overviewLoading ? "—" : String(overview?.totalStarted ?? 0),
      icon: Users,
      color: "text-primary",
      bg: "bg-primary/10",
      trend: null as string | null,
    },
    {
      label: "Completed",
      value: overviewLoading ? "—" : String(overview?.totalCompleted ?? 0),
      icon: CheckCircle,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      trend: overview?.overallCompletionRate != null ? `${overview.overallCompletionRate.toFixed(1)}% rate` : null,
    },
    {
      label: "This Week (Started)",
      value: overviewLoading ? "—" : String(overview?.recentStarts7d ?? 0),
      icon: TrendingUp,
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      trend: null,
    },
    {
      label: "This Week (Completed)",
      value: overviewLoading ? "—" : String(overview?.recentCompletions7d ?? 0),
      icon: Award,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      trend: null,
    },
  ];

  return (
    <DashboardLayout title="Onboarding Analytics">
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />Onboarding Analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Trader onboarding funnel metrics, completion rates, and step-by-step breakdown
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-4 gap-4">
          {kpis.map(({ label, value, icon: Icon, color, bg, trend }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {trend && <p className="text-xs text-emerald-400 mt-0.5">{trend}</p>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Funnel chart */}
          <div className="col-span-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Onboarding Funnel</CardTitle>
              </CardHeader>
              <CardContent>
                {funnelLoading ? (
                  <Skeleton className="h-64 w-full" />
                ) : funnelData.length === 0 ? (
                  <div className="h-64 flex items-center justify-center text-muted-foreground">
                    <div className="text-center">
                      <Target className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">No funnel data yet</p>
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={funnelData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                      <XAxis dataKey="step" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                        formatter={(value: number, name: string) => [value, name === "users" ? "Reached" : "Completed"]}
                      />
                      <Bar dataKey="users" fill="#3B82F6" radius={[4, 4, 0, 0]} name="users" />
                      <Bar dataKey="completed" fill="#10B981" radius={[4, 4, 0, 0]} name="completed" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* AEO distribution placeholder */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-400" />AEO Tier Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={aeoData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value">
                    {aeoData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", fontSize: "12px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {aeoData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                      <span>{d.name}</span>
                    </div>
                    <span className="font-medium">{d.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Step-by-step breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Step-by-Step Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {funnelLoading ? (
              <div className="space-y-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : funnelData.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <p className="text-sm">No step data available</p>
              </div>
            ) : (
              <div className="space-y-4">
                {funnelData.map((step, i) => {
                  const completionRate = step.users > 0 ? (step.completed / step.users) * 100 : 0;
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-medium">{i + 1}</span>
                          <span className="font-medium">{step.step}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span>{step.users} reached</span>
                          <span>{step.completed} completed</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{step.avgTime?.toFixed(0) ?? "—"} min avg
                          </span>
                          {step.dropOff > 0 && (
                            <span className="flex items-center gap-1 text-red-400">
                              <TrendingDown className="h-3 w-3" />{step.dropOff.toFixed(1)}% drop-off
                            </span>
                          )}
                        </div>
                      </div>
                      <Progress value={completionRate} className="h-2" />
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
