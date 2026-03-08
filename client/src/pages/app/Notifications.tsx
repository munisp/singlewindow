/**
 * Notifications Page — wired to real tRPC notifications.list + notifications.markRead
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export default function Notifications() {
  const utils = trpc.useUtils();
  const { data, isLoading, refetch } = trpc.notifications.list.useQuery({ limit: 50 });
  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: () => {
      utils.notifications.list.invalidate();
      toast.success("Notification marked as read");
    },
  });

  const unread = data?.filter((n: any) => !n.read) ?? [];

  return (
    <DashboardLayout title="Notifications">
      <div className="space-y-6 max-w-3xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />Notifications
              {unread.length > 0 && (
                <Badge className="ml-1">{unread.length} unread</Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              System alerts and trade activity updates
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">All Notifications ({data?.length ?? 0})</CardTitle></CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">{Array.from({length:5}).map((_,i)=><Skeleton key={i} className="h-16 w-full"/>)}</div>
            ) : (data?.length ?? 0) === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y">
                {data?.map((n: any) => (
                  <div key={n.id} className={`p-4 flex items-start gap-3 ${!n.read ? "bg-primary/5" : ""}`}>
                    <div className={`h-2 w-2 rounded-full mt-2 shrink-0 ${!n.read ? "bg-primary" : "bg-muted"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${!n.read ? "" : "text-muted-foreground"}`}>{n.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.message}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}
                      </p>
                    </div>
                    {!n.read && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 gap-1 text-xs"
                        onClick={() => markRead.mutate({ ids: [n.id] })}
                        disabled={markRead.isPending}
                      >
                        <CheckCheck className="h-3 w-3" />Mark read
                      </Button>
                    )}
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
