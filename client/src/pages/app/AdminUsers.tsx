import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

export default function AdminUsers() {
  const { data, isLoading } = trpc.auth.listUsers.useQuery(undefined);
  return (
    <DashboardLayout title="User Management">
      <div className="space-y-6 max-w-5xl">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" />
          User Management
        </h1>
        <Card>
          <CardHeader><CardTitle className="text-base">Registered Users</CardTitle></CardHeader>
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
                  </tr></thead>
                  <tbody className="divide-y">
                    {(data ?? []).map((u: any) => (
                      <tr key={u.id} className="hover:bg-muted/20">
                        <td className="p-3 font-medium">{u.name ?? "—"}</td>
                        <td className="p-3 text-muted-foreground">{u.email ?? "—"}</td>
                        <td className="p-3"><Badge variant="outline">{u.role}</Badge></td>
                        <td className="p-3 text-xs text-muted-foreground">{u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—"}</td>
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
