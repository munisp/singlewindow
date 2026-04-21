/**
 * AdminUsers — full user management with search, role filter, role change, name edit, stats
 */
import { useState, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Users, ShieldCheck, Search, RefreshCw, Edit2, ChevronDown, BarChart3 } from "lucide-react";
import { toast } from "sonner";

const ROLE_OPTIONS = [
  { value: "ALL", label: "All Roles" },
  { value: "user", label: "User" },
  { value: "admin", label: "Admin" },
  { value: "customs_officer", label: "Customs Officer" },
  { value: "oga_officer", label: "OGA Officer" },
  { value: "inspector", label: "Inspector" },
  { value: "finance", label: "Finance" },
];

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/10 text-red-400 border-red-500/20",
  customs_officer: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  oga_officer: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  inspector: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  user: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const utils = trpc.useUtils();
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [editUser, setEditUser] = useState<{ id: number; name: string } | null>(null);
  const [editName, setEditName] = useState("");

  // 300ms debounce
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading, refetch } = trpc.auth.listUsers.useQuery({
    search: debouncedSearch || undefined,
    role: roleFilter !== "ALL" ? roleFilter : undefined,
  });

  const { data: stats } = trpc.auth.userStats.useQuery();

  const changeRoleMutation = trpc.auth.changeRole.useMutation({
    onSuccess: (updated) => {
      toast.success(`Role updated to "${updated.role}" for ${updated.name ?? updated.email}`);
      utils.auth.listUsers.invalidate();
      utils.auth.userStats.invalidate();
    },
    onError: (err) => toast.error("Failed to change role", { description: err.message }),
  });

  const updateNameMutation = trpc.auth.updateUserName.useMutation({
    onSuccess: (updated) => {
      toast.success(`Name updated to "${updated.name}"`);
      utils.auth.listUsers.invalidate();
      setEditUser(null);
    },
    onError: (err) => toast.error("Failed to update name", { description: err.message }),
  });

  const openEdit = (u: { id: number; name: string | null }) => {
    setEditUser({ id: u.id, name: u.name ?? "" });
    setEditName(u.name ?? "");
  };

  const users = data ?? [];

  return (
    <DashboardLayout title="User Management">
      <div className="space-y-6 max-w-6xl">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            User Management
          </h1>
          <Badge variant="outline" className="ml-auto gap-1">
            <ShieldCheck className="h-3 w-3" /> Admin Only
          </Badge>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-bold">{stats.total}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Total Users</p>
              </CardContent>
            </Card>
            {["admin", "customs_officer", "oga_officer"].map(role => (
              <Card key={role}>
                <CardContent className="p-4">
                  <p className="text-2xl font-bold">{stats.byRole[role] ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 capitalize">{role.replace(/_/g, " ")}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48 max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">{users.length} user(s) shown</span>
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Registered Users
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : users.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p>No users found matching your filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Last Sign-in</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Joined</th>
                      <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/20">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                              {(u.name ?? u.email ?? "?")[0].toUpperCase()}
                            </div>
                            <span className="font-medium">{u.name ?? "—"}</span>
                            {u.id === me?.id && <Badge variant="outline" className="text-xs py-0 h-4">You</Badge>}
                          </div>
                        </td>
                        <td className="p-3 text-muted-foreground text-xs">{u.email ?? "—"}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[u.role] ?? ROLE_COLORS.user}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {u.lastSignedIn ? new Date(u.lastSignedIn).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="p-3">
                          {u.id === me?.id ? (
                            <span className="text-xs text-muted-foreground italic">Current user</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Button
                                variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs"
                                onClick={() => openEdit(u)}
                              >
                                <Edit2 className="h-3 w-3" />Edit
                              </Button>
                              <Select
                                value={u.role}
                                onValueChange={(newRole) => changeRoleMutation.mutate({ userId: u.id, role: newRole as any })}
                                disabled={changeRoleMutation.isPending}
                              >
                                <SelectTrigger className="h-7 w-36 text-xs">
                                  <SelectValue />
                                  <ChevronDown className="h-3 w-3 ml-auto" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="user">user</SelectItem>
                                  <SelectItem value="admin">admin</SelectItem>
                                  <SelectItem value="customs_officer">customs_officer</SelectItem>
                                  <SelectItem value="oga_officer">oga_officer</SelectItem>
                                  <SelectItem value="inspector">inspector</SelectItem>
                                  <SelectItem value="finance">finance</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Name Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => { if (!open) setEditUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User Name</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="editName">Display Name</Label>
              <Input
                id="editName"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="Full name"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!editUser || !editName.trim()) return;
                updateNameMutation.mutate({ userId: editUser.id, name: editName.trim() });
              }}
              disabled={updateNameMutation.isPending || !editName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
