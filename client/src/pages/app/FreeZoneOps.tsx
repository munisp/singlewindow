import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Building2, Package, ArrowRightLeft, LogOut, RefreshCw,
  Plus, MapPin, BarChart2, Clock, CheckCircle, AlertCircle
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  suspended: "bg-yellow-100 text-yellow-800",
  revoked: "bg-red-100 text-red-800",
  pending: "bg-blue-100 text-blue-800",
  admitted: "bg-green-100 text-green-800",
  transferred: "bg-purple-100 text-purple-800",
  exited: "bg-gray-100 text-gray-800",
};

export default function FreeZoneOps() {
  const [activeTab, setActiveTab] = useState("zones");
  const [registerOpen, setRegisterOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [selectedZone, setSelectedZone] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferGoodsId, setTransferGoodsId] = useState("");
  const [transferForm, setTransferForm] = useState({ toZoneId: "", reason: "", officerRef: "" });

  const [registerForm, setRegisterForm] = useState({
    zoneName: "",
    zoneCode: "",
    location: "",
    operatorName: "",
    operatorLicence: "",
    zoneType: "industrial",
    totalAreaSqm: "",
  });

  const [admitForm, setAdmitForm] = useState({
    zoneId: "",
    ucr: "",
    hsCode: "",
    description: "",
    quantityKg: "",
    declaredValueUsd: "",
    originCountry: "",
    destinationCountry: "",
  });

  const { data: zonesData, isLoading: zonesLoading, refetch: refetchZones } =
    trpc.freeZone.listZones.useQuery();

  const { data: inventoryData, isLoading: inventoryLoading, refetch: refetchInventory } =
    trpc.freeZone.listInventory.useQuery(
      { zoneId: selectedZone },
      { enabled: !!selectedZone }
    );

  const { data: statsData } = trpc.freeZone.getStats.useQuery();

  const registerMutation = trpc.freeZone.registerZone.useMutation({
    onSuccess: () => {
      toast.success("Free zone registered successfully");
      setRegisterOpen(false);
      refetchZones();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const admitMutation = trpc.freeZone.admitGoods.useMutation({
    onSuccess: () => {
      toast.success("Goods admitted to free zone");
      setAdmitOpen(false);
      refetchInventory();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const exitMutation = trpc.freeZone.exitGoods.useMutation({
    onSuccess: () => { toast.success("Goods exit processed"); refetchInventory(); },
    onError: (err: any) => toast.error(err.message),
  });

  const transferMutation = trpc.freeZone.transferGoods.useMutation({
    onSuccess: () => {
      toast.success("Goods transferred successfully");
      setTransferOpen(false);
      setTransferForm({ toZoneId: "", reason: "", officerRef: "" });
      refetchInventory();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleTransfer = () => {
    if (!transferForm.toZoneId || transferForm.reason.length < 5) {
      toast.error("Please select a destination zone and provide a reason (min 5 chars)");
      return;
    }
    transferMutation.mutate({
      goodsId: transferGoodsId,
      toZoneId: transferForm.toZoneId,
      reason: transferForm.reason,
      officerRef: transferForm.officerRef || undefined,
    });
  };

  const handleRegister = () => {
    if (!registerForm.zoneName || !registerForm.zoneCode || !registerForm.location) {
      toast.error("Please fill in all required fields");
      return;
    }
    registerMutation.mutate({
      name: registerForm.zoneName,
      code: registerForm.zoneCode,
      location: registerForm.location,
      operatorName: registerForm.operatorName,
      zoneType: (registerForm.zoneType.toUpperCase() as any) || "GENERAL",
      capacityM3: parseFloat(registerForm.totalAreaSqm) || 1000,
    });
  };

  const handleAdmit = () => {
    if (!admitForm.zoneId || !admitForm.ucr || !admitForm.hsCode) {
      toast.error("Please fill in all required fields");
      return;
    }
    admitMutation.mutate({
      zoneId: admitForm.zoneId,
      ucr: admitForm.ucr,
      traderRef: admitForm.ucr,
      hsCode: admitForm.hsCode,
      description: admitForm.description || "General goods",
      originCountry: (admitForm.originCountry || "XX").substring(0, 2).toUpperCase(),
      grossWeightKg: parseFloat(admitForm.quantityKg) || 1,
      volumeM3: 1,
      invoiceValue: parseFloat(admitForm.declaredValueUsd) || 1,
      currency: "USD",
    });
  };

  const zones = (zonesData as any)?.zones ?? [];
  const inventory = (inventoryData as any)?.items ?? [];

  return (
    <DashboardLayout>
      {/* Transfer Goods Dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer Goods to Another Zone</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Destination Zone *</Label>
              <Select value={transferForm.toZoneId} onValueChange={v => setTransferForm(f => ({ ...f, toZoneId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select zone" /></SelectTrigger>
                <SelectContent>
                  {zones.map((z: any) => <SelectItem key={z.id} value={z.id}>{z.name} ({z.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Transfer Reason *</Label>
              <Textarea placeholder="Reason for transfer (min 5 characters)" value={transferForm.reason} onChange={e => setTransferForm(f => ({ ...f, reason: e.target.value }))} rows={3} />
            </div>
            <div>
              <Label>Officer Reference</Label>
              <Input placeholder="Officer badge / reference (optional)" value={transferForm.officerRef} onChange={e => setTransferForm(f => ({ ...f, officerRef: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={transferMutation.isPending}>
              {transferMutation.isPending ? "Transferring..." : "Confirm Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Building2 className="w-7 h-7 text-emerald-600" />
              Free Zone Operations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage free zone registrations, goods admissions, transfers, and exits
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchZones(); refetchInventory(); }}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Dialog open={admitOpen} onOpenChange={setAdmitOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Package className="w-4 h-4 mr-2" />
                  Admit Goods
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Admit Goods to Free Zone</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div>
                    <Label>Free Zone *</Label>
                    <Select value={admitForm.zoneId} onValueChange={v => setAdmitForm(f => ({ ...f, zoneId: v }))}>
                      <SelectTrigger><SelectValue placeholder="Select zone..." /></SelectTrigger>
                      <SelectContent>
                        {zones.map((z: any) => (
                          <SelectItem key={z.id} value={z.id}>{z.zoneName} ({z.zoneCode})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>UCR *</Label>
                      <Input placeholder="Unique Consignment Ref" value={admitForm.ucr} onChange={e => setAdmitForm(f => ({ ...f, ucr: e.target.value }))} />
                    </div>
                    <div>
                      <Label>HS Code *</Label>
                      <Input placeholder="e.g. 8471.30" value={admitForm.hsCode} onChange={e => setAdmitForm(f => ({ ...f, hsCode: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Input placeholder="Goods description" value={admitForm.description} onChange={e => setAdmitForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Quantity (kg)</Label>
                      <Input type="number" placeholder="0" value={admitForm.quantityKg} onChange={e => setAdmitForm(f => ({ ...f, quantityKg: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Declared Value (USD)</Label>
                      <Input type="number" placeholder="0" value={admitForm.declaredValueUsd} onChange={e => setAdmitForm(f => ({ ...f, declaredValueUsd: e.target.value }))} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Origin Country</Label>
                      <Input placeholder="e.g. CN" value={admitForm.originCountry} onChange={e => setAdmitForm(f => ({ ...f, originCountry: e.target.value.toUpperCase() }))} />
                    </div>
                    <div>
                      <Label>Destination Country</Label>
                      <Input placeholder="e.g. US" value={admitForm.destinationCountry} onChange={e => setAdmitForm(f => ({ ...f, destinationCountry: e.target.value.toUpperCase() }))} />
                    </div>
                  </div>
                  <Button className="w-full" onClick={handleAdmit} disabled={admitMutation.isPending}>
                    {admitMutation.isPending ? "Processing..." : "Admit Goods"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Plus className="w-4 h-4 mr-2" />
                  Register Zone
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Register New Free Zone</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Zone Name *</Label>
                      <Input placeholder="e.g. Tema Free Zone" value={registerForm.zoneName} onChange={e => setRegisterForm(f => ({ ...f, zoneName: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Zone Code *</Label>
                      <Input placeholder="e.g. TFZ" value={registerForm.zoneCode} onChange={e => setRegisterForm(f => ({ ...f, zoneCode: e.target.value.toUpperCase() }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Location *</Label>
                    <Input placeholder="Physical address" value={registerForm.location} onChange={e => setRegisterForm(f => ({ ...f, location: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Zone Type</Label>
                    <Select value={registerForm.zoneType} onValueChange={v => setRegisterForm(f => ({ ...f, zoneType: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="industrial">Industrial</SelectItem>
                        <SelectItem value="commercial">Commercial</SelectItem>
                        <SelectItem value="technology">Technology</SelectItem>
                        <SelectItem value="logistics">Logistics Hub</SelectItem>
                        <SelectItem value="agricultural">Agricultural</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Operator Name</Label>
                      <Input placeholder="Zone operator" value={registerForm.operatorName} onChange={e => setRegisterForm(f => ({ ...f, operatorName: e.target.value }))} />
                    </div>
                    <div>
                      <Label>Operator Licence</Label>
                      <Input placeholder="Licence number" value={registerForm.operatorLicence} onChange={e => setRegisterForm(f => ({ ...f, operatorLicence: e.target.value }))} />
                    </div>
                  </div>
                  <div>
                    <Label>Total Area (sqm)</Label>
                    <Input type="number" placeholder="0" value={registerForm.totalAreaSqm} onChange={e => setRegisterForm(f => ({ ...f, totalAreaSqm: e.target.value }))} />
                  </div>
                  <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleRegister} disabled={registerMutation.isPending}>
                    {registerMutation.isPending ? "Registering..." : "Register Zone"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Zones", value: (statsData as any)?.activeZones ?? "—", icon: <Building2 className="w-5 h-5 text-emerald-600" />, color: "text-emerald-600" },
            { label: "Total Inventory Items", value: (statsData as any)?.totalInventoryItems ?? "—", icon: <Package className="w-5 h-5 text-blue-500" />, color: "text-blue-600" },
            { label: "Admissions (30d)", value: (statsData as any)?.admissionsLast30Days ?? "—", icon: <CheckCircle className="w-5 h-5 text-green-500" />, color: "text-green-600" },
            { label: "Pending Exits", value: (statsData as any)?.pendingExits ?? "—", icon: <Clock className="w-5 h-5 text-orange-500" />, color: "text-orange-600" },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {stat.icon}
                <div>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="zones">Registered Zones</TabsTrigger>
            <TabsTrigger value="inventory">Zone Inventory</TabsTrigger>
          </TabsList>

          <TabsContent value="zones" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="w-4 h-4" />
                  Free Zones Registry
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {zonesLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading zones...</div>
                ) : zones.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    <Building2 className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No free zones registered yet
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {zones.map((zone: any) => (
                      <div
                        key={zone.id}
                        className={`p-4 hover:bg-muted/30 cursor-pointer transition-colors ${selectedZone === zone.id ? "bg-muted/50" : ""}`}
                        onClick={() => { setSelectedZone(zone.id); setActiveTab("inventory"); }}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-sm">{zone.zoneName}</span>
                              <Badge variant="outline" className="text-xs font-mono">{zone.zoneCode}</Badge>
                              <Badge className={`text-xs ${STATUS_COLORS[zone.status] ?? "bg-gray-100 text-gray-800"}`}>
                                {zone.status}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {zone.location}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Type: {zone.zoneType} · Operator: {zone.operatorName}
                            </div>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div>{zone.totalAreaSqm?.toLocaleString()} sqm</div>
                            <div className="mt-1">
                              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={e => { e.stopPropagation(); setSelectedZone(zone.id); setActiveTab("inventory"); }}>
                                View Inventory →
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inventory" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="w-4 h-4" />
                    Zone Inventory
                  </CardTitle>
                  <Select value={selectedZone} onValueChange={setSelectedZone}>
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue placeholder="Select zone..." />
                    </SelectTrigger>
                    <SelectContent>
                      {zones.map((z: any) => (
                        <SelectItem key={z.id} value={z.id}>{z.zoneName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!selectedZone ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Select a zone to view inventory</div>
                ) : inventoryLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading inventory...</div>
                ) : inventory.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No goods admitted to this zone
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {inventory.map((item: any) => (
                      <div key={item.id} className="p-4 hover:bg-muted/30">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{item.ucr}</span>
                              <span className="font-mono text-xs text-muted-foreground">{item.hsCode}</span>
                              <Badge className={`text-xs ${STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-800"}`}>
                                {item.status}
                              </Badge>
                            </div>
                            <div className="text-sm font-medium">{item.description}</div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {item.quantityKg} kg · USD {item.declaredValueUsd?.toLocaleString()}
                              {item.originCountry && ` · From: ${item.originCountry}`}
                              {item.destinationCountry && ` → ${item.destinationCountry}`}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Admitted: {new Date(item.admittedAt).toLocaleDateString()}
                            </div>
                          </div>
                          {item.status === "admitted" && (
                            <div className="flex gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => { setTransferGoodsId(item.id); setTransferOpen(true); }}
                              >
                                <ArrowRightLeft className="w-3 h-3 mr-1" />
                                Transfer
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                onClick={() => exitMutation.mutate({ goodsId: item.id, destination: "RE_EXPORT" })}
                              >
                                <LogOut className="w-3 h-3 mr-1" />
                                Exit
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
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
