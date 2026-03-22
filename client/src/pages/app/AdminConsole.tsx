import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  Building2,
  CheckCircle,
  Database,
  DollarSign,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";
import { toast } from "sonner";

function LedgerStatsCard() {
  const { data, isLoading, refetch, isRefetching } = trpc.system.ledgerStats.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-4 w-4 text-yellow-500" />
            Financial Ledger (TigerBeetle)
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading || isRefetching} className="h-7 w-7 p-0">
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant={data?.mode === "live" ? "default" : "secondary"}
                className={data?.mode === "live" ? "bg-green-600" : ""}
              >
                {data?.mode === "live" ? "Live" : data?.mode === "unavailable" ? "Unavailable" : "Simulation"}
              </Badge>
              {data?.ok === false && (
                <span className="text-xs text-muted-foreground">Bridge unreachable — showing cached zero</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <TrendingUp className="h-3 w-3" /> Confirmed Revenue
                </p>
                <p className="font-mono text-lg font-semibold">
                  {data?.currency} {parseFloat(data?.totalRevenueConfirmed ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
                  <Activity className="h-3 w-3" /> Pending Revenue
                </p>
                <p className="font-mono text-lg font-semibold">
                  {data?.currency} {parseFloat(data?.totalRevenuePending ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
            {data?.accounts && data.accounts.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Accounts</p>
                {data.accounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between text-sm py-1 border-b border-border/50 last:border-0">
                    <span className="font-mono text-xs text-muted-foreground truncate max-w-[180px]">{acc.accountType}</span>
                    <span className="font-mono text-xs">
                      {data.currency} {parseFloat(acc.creditsPosted ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {data?.recentTransferCount ?? 0} recent transfers &middot; refreshes every 30s
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RateLimitStatsCard() {
  const { data, isLoading, refetch, isRefetching } = trpc.system.rateLimitStats.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const isRedis = data?.backend === "redis";
  const redisOk = data?.redis?.ok ?? false;
  const latencyMs = data?.redis?.latencyMs;
  const inMemoryActive = data?.inMemory?.active ?? 0;
  const inMemoryExpired = data?.inMemory?.expired ?? 0;
  const inMemoryTotal = data?.inMemory?.total ?? 0;
  const checkedAt = data?.checkedAt ? new Date(data.checkedAt) : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-amber-500" />
            Rate Limiter Status
          </CardTitle>
          <div className="flex items-center gap-2">
            {checkedAt && (
              <span className="text-xs text-muted-foreground">
                Updated {checkedAt.toLocaleTimeString()}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              className="h-7 w-7 p-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        ) : (
          <>
            {/* Backend indicator */}
            <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
              <Server className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Backend:{" "}
                  <span className={isRedis ? "text-green-500" : "text-amber-500"}>
                    {isRedis ? "Redis (production)" : "In-memory (fallback)"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {isRedis
                    ? "Distributed rate limiting active across all nodes"
                    : "Redis unavailable — single-node in-memory fallback active"}
                </p>
              </div>
              <Badge
                variant="outline"
                className={isRedis
                  ? "text-green-500 border-green-500/30 bg-green-500/5"
                  : "text-amber-500 border-amber-500/30 bg-amber-500/5"}
              >
                {isRedis ? "Connected" : "Fallback"}
              </Badge>
            </div>

            {/* Redis health */}
            {isRedis && (
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">Redis Status</p>
                  <p className="text-sm font-semibold flex items-center gap-1.5 mt-1">
                    {redisOk ? (
                      <><CheckCircle className="h-3.5 w-3.5 text-green-500" /> Healthy</>
                    ) : (
                      <><XCircle className="h-3.5 w-3.5 text-destructive" /> Offline</>
                    )}
                  </p>
                </div>
                <div className="p-3 rounded-lg border">
                  <p className="text-xs text-muted-foreground">Latency</p>
                  <p className="text-sm font-semibold mt-1">
                    {latencyMs != null ? `${latencyMs} ms` : "—"}
                  </p>
                </div>
              </div>
            )}

            {/* In-memory stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border text-center">
                <p className="text-xs text-muted-foreground">Active Keys</p>
                <p className="text-lg font-bold text-foreground mt-1">{inMemoryActive}</p>
              </div>
              <div className="p-3 rounded-lg border text-center">
                <p className="text-xs text-muted-foreground">Expired Keys</p>
                <p className="text-lg font-bold text-muted-foreground mt-1">{inMemoryExpired}</p>
              </div>
              <div className="p-3 rounded-lg border text-center">
                <p className="text-xs text-muted-foreground">Total Store</p>
                <p className="text-lg font-bold text-foreground mt-1">{inMemoryTotal}</p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-muted-foreground">
                <Activity className="h-3 w-3 inline mr-1" />
                Window: 60 s / 300 req per user
              </p>
              <Link href="/app/admin/service-health">
                <Button variant="link" size="sm" className="h-auto p-0 text-xs">
                  View full service health →
                </Button>
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PortDataCard() {
  const utils = trpc.useUtils();
  const reseed = trpc.geospatial.reseedPorts.useMutation({
    onSuccess: (data) => {
      toast.success(data.message ?? "Port data reseeded successfully.");
      utils.geospatial.listPorts.invalidate();
    },
    onError: (err) => {
      toast.error(err.message ?? "Failed to reseed port data.");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Port &amp; Congestion Data
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Reseed the 25 African port locations with fresh congestion events and vessel tracking
          positions. This replaces all existing congestion data with newly generated seed data.
        </p>
        <Button
          onClick={() => reseed.mutate()}
          disabled={reseed.isPending}
          variant="outline"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${reseed.isPending ? "animate-spin" : ""}`} />
          {reseed.isPending ? "Reseeding…" : "Reseed Port Data"}
        </Button>
      </CardContent>
    </Card>
  );
}

const ROLE_COLORS: Record<string, string> = {
  trader: "bg-blue-100 text-blue-700",
  customs_officer: "bg-purple-100 text-purple-700",
  oga_officer: "bg-amber-100 text-amber-700",
  admin: "bg-red-100 text-red-700",
  security_analyst: "bg-slate-100 text-slate-700",
  user: "bg-gray-100 text-gray-700",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
  suspended: "bg-gray-100 text-gray-700",
};

export default function AdminConsole() {
  const [userSearch, setUserSearch] = useState("");
  const [profileSearch, setProfileSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const utils = trpc.useUtils();

  const { data: usersWithProfiles, isLoading: usersLoading } = trpc.profiles.usersWithProfiles.useQuery({ limit: 100 });
  const { data: profiles, isLoading: profilesLoading } = trpc.profiles.all.useQuery({ limit: 100 });

  const approveProfileMutation = trpc.profiles.approve.useMutation({
    onSuccess: () => {
      utils.profiles.all.invalidate();
      toast.success("Profile approved — trader can now submit declarations");
    },
    onError: (err: any) => toast.error("Failed to approve profile", { description: err.message }),
  });

  const rejectProfileMutation = trpc.profiles.reject.useMutation({
    onSuccess: () => {
      utils.profiles.all.invalidate();
      toast.success("Profile rejected");
    },
    onError: (err: any) => toast.error("Failed to reject profile", { description: err.message }),
  });

  const filteredUsers = usersWithProfiles?.filter((u: any) =>
    (!userSearch || u.name?.toLowerCase().includes(userSearch.toLowerCase()) || u.email?.toLowerCase().includes(userSearch.toLowerCase())) &&
    (roleFilter === "all" || u.role === roleFilter)
  ) ?? [];

  const filteredProfiles = profiles?.filter((p: any) =>
    !profileSearch ||
    p.organizationName?.toLowerCase().includes(profileSearch.toLowerCase()) ||
    p.taxId?.includes(profileSearch)
  ) ?? [];

  const pendingProfiles = filteredProfiles.filter((p: any) => p.status === "pending");
  const approvedProfiles = filteredProfiles.filter((p: any) => p.status === "approved");

  return (
    <DashboardLayout title="Admin Console">
      <div className="space-y-6 max-w-7xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Administration Console</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage users, approve stakeholder registrations, and configure platform settings.
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{usersWithProfiles?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Users</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{pendingProfiles.length}</p>
                <p className="text-xs text-muted-foreground">Pending Approval</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{approvedProfiles.length}</p>
                <p className="text-xs text-muted-foreground">Active Traders</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <Shield className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {usersWithProfiles?.filter((u: any) => u.role === "admin").length ?? 0}
                </p>
                <p className="text-xs text-muted-foreground">Administrators</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="onboarding">
          <TabsList>
            <TabsTrigger value="onboarding">Stakeholder Onboarding</TabsTrigger>
            <TabsTrigger value="users">User Management</TabsTrigger>
            <TabsTrigger value="system">System Settings</TabsTrigger>
          </TabsList>

          {/* Onboarding tab */}
          <TabsContent value="onboarding" className="space-y-4 mt-4">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by company name or TIN..."
                value={profileSearch}
                onChange={e => setProfileSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Pending approvals */}
            {pendingProfiles.length > 0 && (
              <Card className="border-amber-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold text-amber-700 flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Awaiting Approval ({pendingProfiles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {pendingProfiles.map((p: any) => (
                      <div key={p.id} className="flex items-start justify-between px-5 py-4 hover:bg-muted/30">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">{p.organizationName}</span>
                            <Badge variant="outline" className="text-xs">{p.stakeholderType?.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 mt-2 text-xs text-muted-foreground">
                            <span>TIN: <span className="font-mono">{p.taxId}</span></span>
                            <span>Country: {p.country}</span>
                            <span>Contact: {p.contactEmail}</span>
                            <span>Phone: {p.contactPhone}</span>
                          </div>
                          {p.businessDescription && (
                            <p className="text-xs text-muted-foreground mt-1 italic line-clamp-1">"{p.businessDescription}"</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-4 mt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 text-red-600 border-red-200 hover:bg-red-50"
                            disabled={rejectProfileMutation.isPending}
                            onClick={() => rejectProfileMutation.mutate({ profileId: p.id, reason: "Does not meet requirements" })}
                          >
                            <XCircle className="h-3 w-3" /> Reject
                          </Button>
                          <Button
                            size="sm"
                            className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
                            disabled={approveProfileMutation.isPending}
                            onClick={() => approveProfileMutation.mutate({ profileId: p.id })}
                          >
                            <CheckCircle className="h-3 w-3" /> Approve
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* All profiles */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold">All Stakeholder Profiles ({filteredProfiles.length})</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {profilesLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : filteredProfiles.length === 0 ? (
                  <div className="p-8 text-center">
                    <Building2 className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No profiles found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">TIN</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Country</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Registered</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredProfiles.map((p: any) => (
                          <tr key={p.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3 font-medium">{p.organizationName}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{p.stakeholderType?.replace(/_/g, " ")}</td>
                            <td className="px-4 py-3 font-mono text-xs">{p.taxId}</td>
                            <td className="px-4 py-3 text-xs">{p.country}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? "bg-gray-100 text-gray-700"}`}>
                                {p.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {new Date(p.createdAt).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Users tab */}
          <TabsContent value="users" className="space-y-4 mt-4">
            <div className="flex gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Roles</SelectItem>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Card>
              <CardContent className="p-0">
                {usersLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <div className="p-8 text-center">
                    <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No users found</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-muted/30">
                        <tr>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">System Role</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Joined</th>
                          <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {filteredUsers.map((u: any) => (
                          <tr key={u.id} className="hover:bg-muted/30">
                            <td className="px-4 py-3 font-medium">{u.name || "—"}</td>
                            <td className="px-4 py-3 text-muted-foreground">{u.email || "—"}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] ?? "bg-gray-100 text-gray-700"}`}>
                                {u.role}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {new Date(u.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3">
                              <Select
                                value={u.role}
                                onValueChange={() => toast.info("Role management available in database console")}
                              >
                                <SelectTrigger className="h-7 w-32 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user">user</SelectItem>
                                  <SelectItem value="admin">admin</SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {/* System Settings tab */}
          <TabsContent value="system" className="space-y-4 mt-4">
            <LedgerStatsCard />
            <RateLimitStatsCard />
            <PortDataCard />
            {/* Sprint 118 — Platform Settings shortcut */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="h-4 w-4" />
                  Platform Settings
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Configure SLA thresholds, breach alert email threshold, and other system-wide parameters.
                </p>
                <Link href="/app/admin/settings">
                  <Button variant="outline" size="sm">
                    Open Platform Settings →
                  </Button>
                </Link>
              </CardContent>
            </Card>
            {/* Sprint 83/84 — Certificate Revocation Log shortcut */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4" />
                  Certificate Revocation Log
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Audit trail of all revoked AfCFTA and GSP certificates with search and CSV export.
                </p>
                <Link href="/app/admin/cert-revocations">
                  <Button variant="outline" size="sm">
                    View Revocation Log →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
