/**
 * Notification Centre — Sprint 15 / Sprint 21
 * In-app inbox for traders and all platform users.
 * Backed by the user_notifications table via userNotifications tRPC router.
 * Sprint 21: Added Acknowledge button for security_alert port congestion notifications.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Bell, CheckCheck, RefreshCw, FileText, AlertTriangle,
  CheckCircle, Clock, Shield, Info, Package, ShieldCheck
} from "lucide-react";
import { toast } from "sonner";

const TYPE_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  declaration_status_change: { icon: FileText, color: "text-blue-500", label: "Declaration Update" },
  clearance_complete: { icon: CheckCircle, color: "text-green-500", label: "Clearance Complete" },
  declaration_submitted: { icon: Package, color: "text-blue-400", label: "Submission Confirmed" },
  declaration_cleared: { icon: CheckCircle, color: "text-green-500", label: "Cleared" },
  declaration_rejected: { icon: AlertTriangle, color: "text-red-500", label: "Rejected" },
  permit_expiry_warning: { icon: Clock, color: "text-amber-500", label: "Permit Expiry Warning" },
  permit_approved: { icon: CheckCircle, color: "text-green-500", label: "Permit Approved" },
  permit_rejected: { icon: AlertTriangle, color: "text-red-500", label: "Permit Rejected" },
  fraud_case_opened: { icon: Shield, color: "text-red-500", label: "Fraud Case Opened" },
  fraud_case_assigned: { icon: Shield, color: "text-orange-500", label: "Case Assigned" },
  sla_breach: { icon: AlertTriangle, color: "text-red-600", label: "SLA Breach" },
  kyc_approved: { icon: CheckCircle, color: "text-green-500", label: "Identity Verified" },
  kyc_rejected: { icon: AlertTriangle, color: "text-red-500", label: "Verification Failed" },
  duty_payment_due: { icon: Clock, color: "text-amber-500", label: "Payment Due" },
  payment_confirmed: { icon: CheckCircle, color: "text-green-500", label: "Payment Confirmed" },
  security_alert: { icon: Shield, color: "text-red-600", label: "Security Alert" },
  aeo_status_update: { icon: CheckCircle, color: "text-blue-500", label: "AEO Status Update" },
  document_required: { icon: FileText, color: "text-amber-500", label: "Document Required" },
  general: { icon: Info, color: "text-muted-foreground", label: "General" },
  system: { icon: Info, color: "text-muted-foreground", label: "System" },
};

function getTypeMeta(type: string) {
  return TYPE_META[type] ?? TYPE_META.general;
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Extract port code from port congestion alert body text.
 *  Expected format: "Port XXXX has reached critical congestion..."
 */
function extractPortCodeFromAlert(body: string | null | undefined): string | null {
  if (!body) return null;
  const match = body.match(/Port\s+([A-Z]{2,16})\s+has reached critical/);
  return match?.[1] ?? null;
}

export default function NotificationCentre() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const canAcknowledge = user?.role === "admin" || user?.role === "customs_officer";
  const [tab, setTab] = useState<"all" | "unread">("all");

  const { data, isLoading, refetch } = trpc.userNotifications.getMyNotifications.useQuery({
    limit: 100,
    onlyUnread: tab === "unread",
  });

  const { data: countData } = trpc.userNotifications.getUnreadCount.useQuery();
  const unreadCount = countData?.count ?? 0;

  const markAsRead = trpc.userNotifications.markAsRead.useMutation({
    onSuccess: () => {
      utils.userNotifications.getMyNotifications.invalidate();
      utils.userNotifications.getUnreadCount.invalidate();
    },
    onError: () => toast.error("Failed to mark as read"),
  });

  const markAllRead = trpc.userNotifications.markAllRead.useMutation({
    onSuccess: () => {
      utils.userNotifications.getMyNotifications.invalidate();
      utils.userNotifications.getUnreadCount.invalidate();
      toast.success("All notifications marked as read");
    },
    onError: () => toast.error("Failed to mark all as read"),
  });

  const acknowledgePortAlert = trpc.geospatial.acknowledgePortAlert.useMutation({
    onSuccess: (result) => {
      toast.success(`Port ${result.portCode} alert acknowledged — cron scan will suppress repeat alerts until status changes again`);
      utils.userNotifications.getMyNotifications.invalidate();
    },
    onError: (err) => toast.error(err.message ?? "Failed to acknowledge alert"),
  });

  const notifications = data ?? [];

  return (
    <DashboardLayout title="Notification Centre">
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />
              Notification Centre
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-1">{unreadCount} unread</Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Stay informed about your declarations, permits, and account activity
            </p>
          </div>
          <div className="flex gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="gap-1.5"
              >
                <CheckCheck className="h-4 w-4" />
                Mark all read
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")}>
          <TabsList>
            <TabsTrigger value="all">All ({data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="unread">
              Unread
              {unreadCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 text-[10px]">{unreadCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {tab === "unread" ? "Unread Notifications" : "All Notifications"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">
                      {tab === "unread" ? "No unread notifications" : "No notifications yet"}
                    </p>
                    <p className="text-sm mt-1">
                      {tab === "unread"
                        ? "You're all caught up!"
                        : "Activity updates will appear here as your declarations progress."}
                    </p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {notifications.map((n) => {
                      const meta = getTypeMeta(n.type);
                      const Icon = meta.icon;
                      // For security_alert port congestion notifications, extract the port code
                      const portCode = n.type === "security_alert"
                        ? extractPortCodeFromAlert(n.body)
                        : null;
                      return (
                        <div
                          key={n.id}
                          className={`p-4 flex items-start gap-3 transition-colors ${
                            !n.isRead ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/30"
                          }`}
                        >
                          {/* Unread dot */}
                          <div
                            className={`h-2 w-2 rounded-full mt-2.5 shrink-0 ${
                              !n.isRead ? "bg-primary" : "bg-transparent"
                            }`}
                          />
                          {/* Icon */}
                          <div className={`mt-0.5 shrink-0 ${meta.color}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className={`text-sm font-medium ${!n.isRead ? "text-foreground" : "text-muted-foreground"}`}>
                                  {n.title}
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {n.body}
                                </p>
                              </div>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                  {timeAgo(n.createdAt)}
                                </span>
                                <Badge variant="outline" className="text-[10px] h-4 px-1">
                                  {meta.label}
                                </Badge>
                              </div>
                            </div>
                            {/* Action buttons row */}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {!n.isRead && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs px-2 text-muted-foreground hover:text-foreground"
                                  onClick={() => markAsRead.mutate({ id: n.id })}
                                  disabled={markAsRead.isPending}
                                >
                                  Mark as read
                                </Button>
                              )}
                              {/* Acknowledge button for port congestion critical alerts */}
                              {portCode && canAcknowledge && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-6 text-xs px-2 gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                                  onClick={() => acknowledgePortAlert.mutate({ portCode })}
                                  disabled={acknowledgePortAlert.isPending}
                                  title={`Acknowledge critical congestion alert for port ${portCode}`}
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  Acknowledge {portCode}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
