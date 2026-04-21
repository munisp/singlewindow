/**
 * Notifications Page — full CRUD with filter by type, markAllRead, delete, pagination
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Bell, CheckCheck, RefreshCw, Trash2, Filter, ChevronLeft, ChevronRight,
  FileText, CreditCard, Shield, AlertTriangle, Settings, Award, Clock,
} from "lucide-react";
import { toast } from "sonner";

const TYPE_OPTIONS = [
  { value: "ALL", label: "All Types" },
  { value: "declaration_submitted", label: "Declaration Submitted" },
  { value: "declaration_cleared", label: "Declaration Cleared" },
  { value: "declaration_rejected", label: "Declaration Rejected" },
  { value: "declaration_status_change", label: "Status Change" },
  { value: "payment_confirmed", label: "Payment Confirmed" },
  { value: "permit_approved", label: "Permit Approved" },
  { value: "permit_rejected", label: "Permit Rejected" },
  { value: "permit_expiry_warning", label: "Permit Expiry Warning" },
  { value: "document_required", label: "Document Required" },
  { value: "aeo_status_update", label: "AEO Status Update" },
  { value: "security_alert", label: "Security Alert" },
  { value: "sla_breach", label: "SLA Breach" },
  { value: "kyc_approved", label: "KYC Approved" },
  { value: "kyc_rejected", label: "KYC Rejected" },
  { value: "system", label: "System" },
];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  declaration_submitted: <FileText className="h-4 w-4 text-blue-400" />,
  declaration_cleared: <CheckCheck className="h-4 w-4 text-emerald-400" />,
  declaration_rejected: <AlertTriangle className="h-4 w-4 text-red-400" />,
  declaration_status_change: <FileText className="h-4 w-4 text-blue-400" />,
  payment_confirmed: <CreditCard className="h-4 w-4 text-emerald-400" />,
  permit_approved: <Award className="h-4 w-4 text-emerald-400" />,
  permit_rejected: <AlertTriangle className="h-4 w-4 text-red-400" />,
  permit_expiry_warning: <Clock className="h-4 w-4 text-amber-400" />,
  document_required: <FileText className="h-4 w-4 text-amber-400" />,
  aeo_status_update: <Award className="h-4 w-4 text-amber-400" />,
  security_alert: <Shield className="h-4 w-4 text-red-400" />,
  sla_breach: <AlertTriangle className="h-4 w-4 text-orange-400" />,
  kyc_approved: <CheckCheck className="h-4 w-4 text-emerald-400" />,
  kyc_rejected: <AlertTriangle className="h-4 w-4 text-red-400" />,
  system: <Settings className="h-4 w-4 text-muted-foreground" />,
};

const PAGE_SIZE = 20;

export default function Notifications() {
  const utils = trpc.useUtils();
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const { data, isLoading, refetch, isError } = trpc.notifications.list.useQuery({
    limit: PAGE_SIZE,
    offset,
    type: typeFilter !== "ALL" ? (typeFilter as any) : undefined,
    unreadOnly,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const unreadCount = items.filter((n: any) => !n.read).length;

  const invalidate = () => {
    utils.notifications.list.invalidate();
    utils.notifications.unreadCount.invalidate();
  };

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} notification(s) marked as read`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const markAllRead = trpc.notifications.markAllRead.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} notification(s) marked as read`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.notifications.delete.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} notification(s) deleted`); setSelected(new Set()); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const deleteAllRead = trpc.notifications.deleteAllRead.useMutation({
    onSuccess: (r) => { toast.success(`${r.count} read notification(s) cleared`); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((n: any) => n.id)));
  };

  const handlePageChange = (newOffset: number) => {
    setOffset(newOffset);
    setSelected(new Set());
  };

  return (
    <DashboardLayout title="Notifications">
      {isError && (
        <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load notifications. Please refresh.
        </div>
      )}
      <div className="space-y-5 max-w-3xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />
              Notifications
              {unreadCount > 0 && <Badge className="ml-1">{unreadCount} unread</Badge>}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {total} total · Page {currentPage} of {Math.max(1, totalPages)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
              <RefreshCw className="h-4 w-4" />Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending} className="gap-1.5">
              <CheckCheck className="h-4 w-4" />Mark All Read
            </Button>
            <Button variant="outline" size="sm" onClick={() => deleteAllRead.mutate()} disabled={deleteAllRead.isPending} className="gap-1.5 text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />Clear Read
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Filter className="h-4 w-4" />Filter:
          </div>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-48 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant={unreadOnly ? "default" : "outline"} size="sm" className="h-8 text-xs" onClick={() => { setUnreadOnly(!unreadOnly); setOffset(0); }}>
            Unread Only
          </Button>
          {selected.size > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selected.size} selected</span>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => markRead.mutate({ ids: Array.from(selected) })} disabled={markRead.isPending}>
                <CheckCheck className="h-3 w-3" />Mark Read
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate({ ids: Array.from(selected) })} disabled={deleteMutation.isPending}>
                <Trash2 className="h-3 w-3" />Delete
              </Button>
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">All Notifications <span className="text-muted-foreground font-normal text-sm">({total})</span></CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : items.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <Bell className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No notifications</p>
                <p className="text-xs mt-1">{typeFilter !== "ALL" || unreadOnly ? "Try adjusting your filters" : "You're all caught up!"}</p>
              </div>
            ) : (
              <>
                <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3">
                  <Checkbox checked={selected.size === items.length && items.length > 0} onCheckedChange={toggleSelectAll} />
                  <span className="text-xs text-muted-foreground">Select all on this page</span>
                </div>
                <div className="divide-y">
                  {items.map((n: any) => (
                    <div key={n.id} className={`px-4 py-3 flex items-start gap-3 transition-colors ${!n.read ? "bg-primary/5" : ""} ${selected.has(n.id) ? "bg-primary/10" : ""}`}>
                      <Checkbox className="mt-1 shrink-0" checked={selected.has(n.id)} onCheckedChange={() => toggleSelect(n.id)} />
                      <div className="shrink-0 mt-0.5">
                        {TYPE_ICONS[n.type] ?? <Bell className="h-4 w-4 text-muted-foreground" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`text-sm font-medium leading-snug ${!n.read ? "" : "text-muted-foreground"}`}>{n.title}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            {!n.read && (
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => markRead.mutate({ ids: [n.id] })} disabled={markRead.isPending}>
                                <CheckCheck className="h-3 w-3" />Read
                              </Button>
                            )}
                            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate({ ids: [n.id] })} disabled={deleteMutation.isPending}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        {n.message && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs py-0 h-4">{n.type?.replace(/_/g, " ")}</Badge>
                          <span className="text-xs text-muted-foreground">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ""}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePageChange(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0} className="h-8 w-8 p-0">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs">Page {currentPage} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => handlePageChange(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total} className="h-8 w-8 p-0">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
