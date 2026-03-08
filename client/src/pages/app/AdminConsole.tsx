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
  Building2,
  CheckCircle,
  Search,
  Shield,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
    p.companyName?.toLowerCase().includes(profileSearch.toLowerCase()) ||
    p.tin?.includes(profileSearch)
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
                            <span className="font-semibold text-sm">{p.companyName}</span>
                            <Badge variant="outline" className="text-xs">{p.stakeholderType?.replace(/_/g, " ")}</Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-6 mt-2 text-xs text-muted-foreground">
                            <span>TIN: <span className="font-mono">{p.tin}</span></span>
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
                            <td className="px-4 py-3 font-medium">{p.companyName}</td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">{p.stakeholderType?.replace(/_/g, " ")}</td>
                            <td className="px-4 py-3 font-mono text-xs">{p.tin}</td>
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
