/**
 * Webhook Logs — TradeGateway™ NGSWTP
 * Manage webhook subscriptions and view delivery history.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import DashboardLayout from "@/components/DashboardLayout";

import {
  Webhook, Plus, RefreshCw, Trash2, RotateCcw, Eye, CheckCircle,
  XCircle, Clock, Shield,
} from "lucide-react";

function formatDate(ts: Date | string | null | undefined) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

const EVENT_COLORS: Record<string, string> = {
  "200": "bg-green-100 text-green-800 border-green-200",
  "201": "bg-green-100 text-green-800 border-green-200",
  "400": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "404": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "500": "bg-red-100 text-red-800 border-red-200",
  "503": "bg-red-100 text-red-800 border-red-200",
};

export default function WebhookLogs() {
  const { user } = useAuth();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showDeliveriesId, setShowDeliveriesId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState({
    name: "",
    url: "",
    events: [] as string[],
  });

  // ── Queries ──────────────────────────────────────────────────────────────────
  const { data: subscriptions, isLoading } = trpc.webhooks.list.useQuery();
  const { data: supportedEvents } = trpc.webhooks.supportedEvents.useQuery();
  const { data: deliveries, isLoading: deliveriesLoading } = trpc.webhooks.deliveries.useQuery(
    { subscriptionId: showDeliveriesId!, limit: 50 },
    { enabled: showDeliveriesId !== null }
  );
  const { data: adminStats } = trpc.webhooks.stats.useQuery(undefined, { enabled: isAdmin });

  // ── Mutations ─────────────────────────────────────────────────────────────────
  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: () => {
      toast({ title: "Webhook created" });
      utils.webhooks.list.invalidate();
      setShowCreateDialog(false);
      setCreateForm({ name: "", url: "", events: [] });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => {
      toast({ title: "Webhook deleted" });
      utils.webhooks.list.invalidate();
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rotateMutation = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Secret rotated",
        description: `New secret: ${data.secret}`,
      });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleEvent = (event: string) => {
    setCreateForm((f) => ({
      ...f,
      events: f.events.includes(event)
        ? f.events.filter((e) => e !== event)
        : [...f.events, event],
    }));
  };

  const subs = subscriptions ?? [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Webhook className="w-7 h-7 text-accent" />
            Webhook Subscriptions
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Receive real-time event notifications at your endpoint
          </p>
        </div>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-accent hover:bg-[#b8891a] text-white"
        >
          <Plus className="w-4 h-4 mr-2" /> Add Webhook
        </Button>
      </div>

      {/* Admin Stats */}
      {isAdmin && adminStats && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Total Subscriptions</div>
            <div className="text-2xl font-bold mt-1">{adminStats.totalSubscriptions}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Active</div>
            <div className="text-2xl font-bold text-green-600 mt-1">{adminStats.activeSubscriptions}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Deliveries (24h)</div>
            <div className="text-2xl font-bold mt-1">{adminStats.totalDeliveries}</div>
          </div>
          <div className="bg-card border rounded-lg p-4">
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Failed (24h)</div>
            <div className="text-2xl font-bold text-red-600 mt-1">{adminStats.failedDeliveries}</div>
          </div>
        </div>
      )}

      {/* Subscriptions Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
        </div>
      ) : subs.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Webhook className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No webhook subscriptions yet</p>
          <Button className="mt-4 bg-accent hover:bg-[#b8891a] text-white" onClick={() => setShowCreateDialog(true)}>
            <Plus className="w-4 h-4 mr-2" /> Create your first webhook
          </Button>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Endpoint URL</th>
                <th className="text-left px-4 py-3 font-medium">Events</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {subs.map((sub) => (
                <tr key={sub.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs max-w-xs truncate">{sub.url}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(sub.events as string[]).slice(0, 3).map((e) => (
                        <Badge key={e} variant="secondary" className="text-xs">{e.replace("_", ".")}</Badge>
                      ))}
                      {(sub.events as string[]).length > 3 && (
                        <Badge variant="outline" className="text-xs">+{(sub.events as string[]).length - 3}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={sub.isActive ? "bg-green-100 text-green-800 border-green-200" : "bg-gray-100 text-gray-700 border-gray-200"}>
                      {sub.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(sub.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setShowDeliveriesId(sub.id as number)}>
                        <Eye className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => rotateMutation.mutate({ id: sub.id as number })}>
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate({ id: sub.id as number })}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Webhook Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium">Webhook Name *</label>
              <Input
                className="mt-1"
                placeholder="e.g. Production Declarations Webhook"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Endpoint URL *</label>
              <Input
                className="mt-1"
                placeholder="https://your-server.com/webhooks/tradegateway"
                value={createForm.url}
                onChange={(e) => setCreateForm((f) => ({ ...f, url: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Events to Subscribe *</label>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {(supportedEvents ?? []).map((item: any) => ({
                event: item.event ?? item,
                description: item.description ?? item,
              })).map(({ event, description }) => (
                  <label key={event} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                    checked={createForm.events.includes(event)}
                    onChange={() => toggleEvent(event)}
                    className="rounded"
                  />
                  <span className="font-mono text-xs" title={description}>{event}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              className="bg-accent hover:bg-[#b8891a] text-white"
              disabled={!createForm.name || !createForm.url || createForm.events.length === 0 || createMutation.isPending}
              onClick={() => createMutation.mutate({
                name: createForm.name,
                url: createForm.url,
                events: createForm.events as any,
              })}
            >
              {createMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Webhook className="w-4 h-4 mr-2" />}
              Create Webhook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deliveries Dialog */}
      <Dialog open={showDeliveriesId !== null} onOpenChange={() => setShowDeliveriesId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delivery History</DialogTitle>
          </DialogHeader>
          {deliveriesLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Loading...
            </div>
          ) : (Array.isArray(deliveries) ? deliveries : []).length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">No deliveries yet</div>
          ) : (
            <div className="space-y-2">
              {(Array.isArray(deliveries) ? deliveries : []).map((d: any) => (
                <div key={d.id} className="border rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {d.responseStatus >= 200 && d.responseStatus < 300 ? (
                        <CheckCircle className="w-4 h-4 text-green-600" />
                      ) : d.responseStatus ? (
                        <XCircle className="w-4 h-4 text-red-600" />
                      ) : (
                        <Clock className="w-4 h-4 text-yellow-600" />
                      )}
                      <span className="font-mono text-xs">{d.eventType}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {d.responseStatus && (
                        <Badge className={`text-xs border ${EVENT_COLORS[String(d.responseStatus)] ?? "bg-gray-100 text-gray-700"}`}>
                          HTTP {d.responseStatus}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">{formatDate(d.createdAt)}</span>
                    </div>
                  </div>
                  {d.errorMessage && (
                    <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1 mt-1">{d.errorMessage}</div>
                  )}
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeliveriesId(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </DashboardLayout>
  );
}
