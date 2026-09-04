/**
 * Webhook Management — Sprint 74
 * Manage webhook subscriptions, view delivery history, and rotate secrets.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { extractFieldErrors, friendlyErrorMessage } from "@/lib/errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Webhook, Plus, Trash2, RefreshCw, Copy, CheckCircle,
  XCircle, Clock, Activity, Shield, ExternalLink, Eye, EyeOff
} from "lucide-react";

const EVENT_CATEGORIES: Record<string, string[]> = {
  "Declarations": ["declaration.submitted", "declaration.approved", "declaration.rejected", "declaration.released"],
  "Payments": ["payment.confirmed", "payment.failed"],
  "KYC": ["kyc.approved", "kyc.rejected"],
  "Permits": ["permit.issued", "permit.expiring"],
  "Vessels": ["vessel.geofence_entry", "vessel.geofence_exit"],
  "Security": ["alert.high_risk", "alert.sanctions_hit"],
};

function CreateWebhookDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["declaration.submitted", "declaration.approved"]);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const createMutation = trpc.webhooks.create.useMutation({
    onSuccess: (data) => {
      setFieldErrors({});
      setCreatedSecret(data.secret);
      toast.success("Webhook created");
      onSuccess();
    },
    onError: (err) => {
      // Field-level errors inline where the server provided them; friendly toast otherwise.
      const fields = extractFieldErrors(err);
      setFieldErrors(fields ?? {});
      toast.error(friendlyErrorMessage(err, "Could not create webhook"));
    },
  });

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) return toast.error("Name is required");
    if (!url.trim()) return toast.error("URL is required");
    if (selectedEvents.length === 0) return toast.error("Select at least one event");
    createMutation.mutate({ name, url, events: selectedEvents as any });
  };

  if (createdSecret) {
    return (
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setCreatedSecret(null); }}>
        <DialogTrigger asChild>
          <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Webhook</Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5 text-emerald-400" />Webhook Created</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
              <p className="font-medium mb-1">Save your signing secret</p>
              <p className="text-xs">This secret will only be shown once. Use it to verify webhook signatures.</p>
            </div>
            <div className="space-y-2">
              <Label>Signing Secret</Label>
              <div className="flex gap-2">
                <Input value={createdSecret} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => { navigator.clipboard.writeText(createdSecret); toast.success("Copied"); }}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Button onClick={() => { setOpen(false); setCreatedSecret(null); }} className="w-full">Done</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Webhook</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Webhook Subscription</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="My Webhook" />
            {fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
          </div>
          <div className="space-y-2">
            <Label>Endpoint URL *</Label>
            <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://api.example.com/webhooks" type="url" />
            {fieldErrors.url && <p className="text-xs text-destructive">{fieldErrors.url}</p>}
          </div>
          <div className="space-y-3">
            <Label>Events to Subscribe</Label>
            {Object.entries(EVENT_CATEGORIES).map(([category, events]) => (
              <div key={category}>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">{category}</p>
                <div className="space-y-1.5">
                  {events.map(event => (
                    <div key={event} className="flex items-center gap-2">
                      <Checkbox
                        id={event}
                        checked={selectedEvents.includes(event)}
                        onCheckedChange={() => toggleEvent(event)}
                      />
                      <label htmlFor={event} className="text-xs font-mono cursor-pointer">{event}</label>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} className="w-full">
            {createMutation.isPending ? "Creating..." : "Create Webhook"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecretDisplay({ secret }: { secret: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex items-center gap-1">
      <span className="font-mono text-xs text-muted-foreground">
        {show ? secret : `${secret.slice(0, 12)}${"•".repeat(16)}`}
      </span>
      <button onClick={() => setShow(!show)} className="text-muted-foreground hover:text-foreground">
        {show ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
    </div>
  );
}

export default function WebhookManagement() {
  const utils = trpc.useUtils();
  const [selectedSubId, setSelectedSubId] = useState<number | null>(null);

  const { data: subs, isLoading } = trpc.webhooks.list.useQuery();
  const { data: deliveries, isLoading: deliveriesLoading } = trpc.webhooks.deliveries.useQuery(
    { subscriptionId: selectedSubId! },
    { enabled: selectedSubId !== null }
  );
  const { data: stats } = trpc.webhooks.stats.useQuery();

  const deleteMutation = trpc.webhooks.delete.useMutation({
    onSuccess: () => { toast.success("Webhook deleted"); utils.webhooks.list.invalidate(); },
    onError: (err) => toast.error(friendlyErrorMessage(err)),
  });

  const toggleMutation = trpc.webhooks.update.useMutation({
    onSuccess: () => utils.webhooks.list.invalidate(),
    onError: (err) => toast.error(friendlyErrorMessage(err)),
  });

  const rotateMutation = trpc.webhooks.rotateSecret.useMutation({
    onSuccess: (data) => {
      navigator.clipboard.writeText(data.secret);
      toast.success("Secret rotated and copied to clipboard");
      utils.webhooks.list.invalidate();
    },
    onError: (err) => toast.error(friendlyErrorMessage(err)),
  });

  return (
    <DashboardLayout title="Webhook Management">
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Webhook className="h-6 w-6 text-primary" />Webhook Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Subscribe to platform events and receive HMAC-signed HTTP POST notifications
            </p>
          </div>
          <CreateWebhookDialog onSuccess={() => utils.webhooks.list.invalidate()} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Total Subscriptions", value: stats?.totalSubscriptions, icon: Webhook, color: "text-primary", bg: "bg-primary/10" },
            { label: "Active", value: stats?.activeSubscriptions, icon: CheckCircle, color: "text-emerald-400", bg: "bg-emerald-500/10" },
            { label: "Total Deliveries", value: stats?.totalDeliveries, icon: Activity, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Failed Deliveries", value: stats?.failedDeliveries, icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-5 gap-4">
          {/* Subscriptions list */}
          <div className="col-span-3">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Subscriptions</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
                ) : (subs?.length ?? 0) === 0 ? (
                  <div className="p-10 text-center text-muted-foreground">
                    <Webhook className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">No webhooks configured</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {subs?.map((sub) => (
                      <div
                        key={sub.id}
                        className={`p-4 cursor-pointer transition-colors ${selectedSubId === sub.id ? "bg-muted/40" : "hover:bg-muted/20"}`}
                        onClick={() => setSelectedSubId(sub.id)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm">{sub.name}</p>
                              <Badge variant="outline" className={`text-xs py-0 ${sub.isActive ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-slate-500/10 text-slate-400"}`}>
                                {sub.isActive ? "Active" : "Inactive"}
                              </Badge>
                              {sub.failureCount > 0 && (
                                <Badge variant="outline" className="text-xs py-0 bg-red-500/10 text-red-400 border-red-500/20">
                                  {sub.failureCount} failures
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{sub.url}</p>
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {(sub.events as string[]).slice(0, 4).map(e => (
                                <span key={e} className="text-xs bg-muted/50 px-1.5 py-0.5 rounded font-mono">{e}</span>
                              ))}
                              {(sub.events as string[]).length > 4 && (
                                <span className="text-xs text-muted-foreground">+{(sub.events as string[]).length - 4} more</span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Switch
                              checked={sub.isActive}
                              onCheckedChange={(checked) => toggleMutation.mutate({ id: sub.id, isActive: checked })}
                              onClick={e => e.stopPropagation()}
                            />
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8"
                              onClick={(e) => { e.stopPropagation(); rotateMutation.mutate({ id: sub.id }); }}
                              title="Rotate secret"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => { e.stopPropagation(); deleteMutation.mutate({ id: sub.id }); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Delivery history */}
          <div className="col-span-2">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {selectedSubId ? "Delivery History" : "Select a subscription"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedSubId ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">Click a subscription to view deliveries</p>
                  </div>
                ) : deliveriesLoading ? (
                  <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                ) : (deliveries?.length ?? 0) === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    <Activity className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No deliveries yet</p>
                  </div>
                ) : (
                  <div className="divide-y max-h-[500px] overflow-y-auto">
                    {deliveries?.map((d) => (
                      <div key={d.id} className="p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono text-xs">{d.eventType}</span>
                          <div className="flex items-center gap-1.5">
                            {d.success
                              ? <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                              : <XCircle className="h-3.5 w-3.5 text-red-400" />
                            }
                            {d.statusCode && (
                              <Badge variant="outline" className={`text-xs py-0 ${d.success ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
                                {d.statusCode}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{new Date(d.deliveredAt).toLocaleString()}</p>
                        {d.attemptCount > 1 && (
                          <p className="text-xs text-amber-400 mt-0.5">{d.attemptCount} attempts</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Signature verification guide */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />Signature Verification
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Every webhook delivery includes an <code className="bg-muted px-1 rounded text-xs">X-TradeGateway-Signature</code> header.
              Verify it using your signing secret to ensure authenticity.
            </p>
            <div className="bg-muted/30 rounded-lg p-3 font-mono text-xs overflow-x-auto">
              <pre>{`// Node.js verification example
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expected = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature), Buffer.from(expected)
  );
}`}</pre>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
