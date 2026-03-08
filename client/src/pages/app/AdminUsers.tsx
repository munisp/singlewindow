import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-100 text-purple-700 border-purple-200",
  customs_officer: "bg-blue-100 text-blue-700 border-blue-200",
  oga_officer: "bg-teal-100 text-teal-700 border-teal-200",
  inspector: "bg-orange-100 text-orange-700 border-orange-200",
  finance: "bg-emerald-100 text-emerald-700 border-emerald-200",
  user: "bg-slate-100 text-slate-600 border-slate-200",
};

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { data, isLoading, refetch } = trpc.auth.listUsers.useQuery(undefined);
  const utils = trpc.useUtils();

  const changeRoleMutation = trpc.auth.changeRole.useMutation({
    onSuccess: (updated) => {
      toast.success(`Role updated to "${updated.role}" for ${updated.name ?? updated.email}`);
      utils.auth.listUsers.invalidate();
    },
    onError: (err) => toast.error("Failed to change role", { description: err.message }),
  });

  return (
    <DashboardLayout title="User Management">
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            User Management
          </h1>
          <Badge variant="outline" className="ml-auto gap-1">
            <ShieldCheck className="h-3 w-3" /> Admin Only
          </Badge>
        </div>
        <Card>
          <CardHeader><CardTitle className="text-base">Registered Users ({data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-10 w-full"/>)}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/30">
                    <th className="text-left p-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Joined</th>
                    <th className="text-left p-3 font-medium text-muted-foreground">Change Role</th>
                  </tr></thead>
                  <tbody className="divide-y">
                    {(data ?? []).map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/20">
                        <td className="p-3 font-medium">{u.name ?? "—"}</td>
                        <td className="p-3 text-muted-foreground text-xs">{u.email ?? "—"}</td>
                        <td className="p-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${ROLE_COLORS[u.role] ?? ROLE_COLORS.user}`}>
                            {u.role}
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
                        <td className="p-3">
                          {u.id === me?.id ? (
                            <span className="text-xs text-muted-foreground italic">You</span>
                          ) : (
                            <Select
                              value={u.role}
                              onValueChange={(newRole) => changeRoleMutation.mutate({ userId: u.id, role: newRole as any })}
                              disabled={changeRoleMutation.isPending}
                            >
                              <SelectTrigger className="h-7 w-36 text-xs">
                                <SelectValue />
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
    </DashboardLayout>
  );
}
