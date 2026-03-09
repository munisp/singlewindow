/**
 * Geofence Management — Sprint 73
 * Admin page for managing port entry/exit geofence zones and viewing vessel crossing events.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  MapPin, Plus, Trash2, Edit3, Activity, Bell, BellOff,
  Shield, AlertTriangle, CheckCircle, Clock, Anchor
} from "lucide-react";

const TYPE_LABELS: Record<string, string> = {
  port_entry: "Port Entry",
  port_exit: "Port Exit",
  restricted_zone: "Restricted Zone",
  customs_zone: "Customs Zone",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-slate-500/10 text-slate-400 border-slate-500/20",
  draft: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const EVENT_STYLES: Record<string, string> = {
  entry: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  exit: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

// Predefined port geofence templates
const PORT_TEMPLATES = [
  { name: "Mombasa Port Entry Zone", portCode: "KEMBA", type: "port_entry", polygon: [
    { lat: -4.055, lon: 39.655 }, { lat: -4.045, lon: 39.680 },
    { lat: -4.070, lon: 39.690 }, { lat: -4.080, lon: 39.665 },
  ]},
  { name: "Dar es Salaam Customs Zone", portCode: "TZDAR", type: "customs_zone", polygon: [
    { lat: -6.815, lon: 39.285 }, { lat: -6.800, lon: 39.310 },
    { lat: -6.825, lon: 39.320 }, { lat: -6.840, lon: 39.295 },
  ]},
  { name: "Djibouti Restricted Zone", portCode: "DJJIB", type: "restricted_zone", polygon: [
    { lat: 11.585, lon: 43.135 }, { lat: 11.600, lon: 43.155 },
    { lat: 11.575, lon: 43.165 }, { lat: 11.560, lon: 43.145 },
  ]},
  { name: "Durban Port Entry Zone", portCode: "ZADUR", type: "port_entry", polygon: [
    { lat: -29.875, lon: 31.025 }, { lat: -29.860, lon: 31.050 },
    { lat: -29.885, lon: 31.060 }, { lat: -29.900, lon: 31.035 },
  ]},
];

function CreateGeofenceDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [portCode, setPortCode] = useState("");
  const [geofenceType, setGeofenceType] = useState<"port_entry" | "port_exit" | "restricted_zone" | "customs_zone">("port_entry");
  const [alertOnEntry, setAlertOnEntry] = useState(true);
  const [alertOnExit, setAlertOnExit] = useState(false);
  const [notifyOwner, setNotifyOwner] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<number | null>(null);

  const createMutation = trpc.geofences.create.useMutation({
    onSuccess: () => {
      toast.success("Geofence created successfully");
      setOpen(false);
      onSuccess();
    },
    onError: (err) => toast.error(err.message),
  });

  const applyTemplate = (idx: number) => {
    const t = PORT_TEMPLATES[idx];
    setName(t.name);
    setPortCode(t.portCode);
    setGeofenceType(t.type as any);
    setSelectedTemplate(idx);
  };

  const handleSubmit = () => {
    if (!name.trim()) return toast.error("Name is required");
    const polygon = selectedTemplate !== null
      ? PORT_TEMPLATES[selectedTemplate].polygon
      : [
          { lat: -4.055, lon: 39.655 }, { lat: -4.045, lon: 39.680 },
          { lat: -4.070, lon: 39.690 }, { lat: -4.080, lon: 39.665 },
        ];
    createMutation.mutate({ name, portCode: portCode || undefined, geofenceType, polygon, alertOnEntry, alertOnExit, notifyOwnerOnTrigger: notifyOwner });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" />New Geofence</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create Geofence Zone</DialogTitle></DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <Label className="text-xs text-muted-foreground mb-2 block">Quick Templates</Label>
            <div className="grid grid-cols-2 gap-2">
              {PORT_TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => applyTemplate(i)}
                  className={`text-left p-2 rounded-md border text-xs transition-colors ${selectedTemplate === i ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
                >
                  <div className="font-medium">{t.portCode}</div>
                  <div className="text-muted-foreground truncate">{TYPE_LABELS[t.type]}</div>
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Mombasa Port Entry Zone" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Port Code</Label>
              <Input value={portCode} onChange={e => setPortCode(e.target.value)} placeholder="KEMBA" />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={geofenceType} onValueChange={v => setGeofenceType(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <SelectItem key={v} value={v}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Alert on Entry</Label>
              <Switch checked={alertOnEntry} onCheckedChange={setAlertOnEntry} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Alert on Exit</Label>
              <Switch checked={alertOnExit} onCheckedChange={setAlertOnExit} />
            </div>
            <div className="flex items-center justify-between">
              <Label className="text-sm">Notify Owner on Trigger</Label>
              <Switch checked={notifyOwner} onCheckedChange={setNotifyOwner} />
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} className="w-full">
            {createMutation.isPending ? "Creating..." : "Create Geofence"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function GeofenceManagement() {
  const utils = trpc.useUtils();
  const { data: geofences, isLoading } = trpc.geofences.list.useQuery({ status: "all" });
  const { data: events, isLoading: eventsLoading } = trpc.geofences.listEvents.useQuery({ limit: 50 });
  const { data: stats } = trpc.geofences.stats.useQuery();

  const deleteMutation = trpc.geofences.delete.useMutation({
    onSuccess: () => { toast.success("Geofence deleted"); utils.geofences.list.invalidate(); },
    onError: (err) => toast.error(err.message),
  });

  const toggleMutation = trpc.geofences.update.useMutation({
    onSuccess: () => utils.geofences.list.invalidate(),
    onError: (err) => toast.error(err.message),
  });

  return (
    <DashboardLayout title="Geofence Management">
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <MapPin className="h-6 w-6 text-primary" />Geofence Management
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Define port entry/exit zones and receive real-time vessel crossing alerts
            </p>
          </div>
          <CreateGeofenceDialog onSuccess={() => utils.geofences.list.invalidate()} />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Shield className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.totalGeofences ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Total Zones</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.activeGeofences ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Active Zones</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Activity className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.events24h ?? "—"}</p>
                <p className="text-xs text-muted-foreground">Events (24h)</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="zones">
          <TabsList>
            <TabsTrigger value="zones">Zones ({geofences?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="events">Crossing Events ({events?.length ?? 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="zones" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
                ) : (geofences?.length ?? 0) === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <MapPin className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="mb-4">No geofence zones defined</p>
                    <p className="text-xs">Create your first zone to start receiving vessel crossing alerts</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    {geofences?.map((g) => (
                      <div key={g.id} className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 ${g.status === "active" ? "bg-emerald-500/10" : "bg-slate-500/10"}`}>
                            <Anchor className={`h-4 w-4 ${g.status === "active" ? "text-emerald-400" : "text-slate-400"}`} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{g.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {g.portCode && <span className="font-mono text-xs text-muted-foreground">{g.portCode}</span>}
                              <Badge variant="outline" className="text-xs py-0">{TYPE_LABELS[g.geofenceType]}</Badge>
                              <Badge variant="outline" className={`text-xs py-0 ${STATUS_STYLES[g.status]}`}>{g.status}</Badge>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {g.alertOnEntry && <span className="flex items-center gap-0.5"><Bell className="h-3 w-3 text-blue-400" />Entry</span>}
                            {g.alertOnExit && <span className="flex items-center gap-0.5 ml-2"><Bell className="h-3 w-3 text-orange-400" />Exit</span>}
                            {!g.alertOnEntry && !g.alertOnExit && <span className="flex items-center gap-0.5"><BellOff className="h-3 w-3" />Silent</span>}
                          </div>
                          <Switch
                            checked={g.status === "active"}
                            onCheckedChange={(checked) =>
                              toggleMutation.mutate({ id: g.id, status: checked ? "active" : "inactive" })
                            }
                          />
                          <Button
                            variant="ghost" size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate({ id: g.id })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {eventsLoading ? (
                  <div className="p-4 space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
                ) : (events?.length ?? 0) === 0 ? (
                  <div className="p-12 text-center text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>No crossing events recorded yet</p>
                    <p className="text-xs mt-1">Events will appear here as vessels enter or exit your geofence zones</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium text-muted-foreground">MMSI</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Vessel</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Event</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Position</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Speed</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Notified</th>
                          <th className="text-left p-3 font-medium text-muted-foreground">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {events?.map((e) => (
                          <tr key={e.id} className="hover:bg-muted/20">
                            <td className="p-3 font-mono text-xs">{e.mmsi}</td>
                            <td className="p-3 text-sm">{e.vesselName ?? "—"}</td>
                            <td className="p-3">
                              <Badge variant="outline" className={EVENT_STYLES[e.eventType] ?? ""}>
                                {e.eventType.toUpperCase()}
                              </Badge>
                            </td>
                            <td className="p-3 font-mono text-xs text-muted-foreground">
                              {e.lat.toFixed(4)}, {e.lon.toFixed(4)}
                            </td>
                            <td className="p-3 text-xs">{e.speed != null ? `${e.speed.toFixed(1)} kn` : "—"}</td>
                            <td className="p-3">
                              {e.notificationSent
                                ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                                : <Clock className="h-4 w-4 text-muted-foreground" />
                              }
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {new Date(e.occurredAt).toLocaleString()}
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
