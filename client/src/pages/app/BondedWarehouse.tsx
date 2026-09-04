/**
 * Bonded Warehouse Management
 * Port operators register warehouses, deposit goods under duty suspension,
 * track inventory, and release goods after duty payment.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Warehouse, Package, DollarSign, TrendingUp, Plus, ArrowUpRight,
  ArrowDownRight, RefreshCw, CheckCircle2, AlertTriangle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WarehouseItem {
  id: string;
  licence_number: string;
  name: string;
  port_code: string;
  address: string;
  max_capacity_m3: number;
  used_capacity_m3: number;
  status: string;
  registered_at: string;
}

interface InventoryItem {
  id: string;
  warehouse_id: string;
  bond_id: string;
  ucr: string;
  hs_code: string;
  description: string;
  quantity_kg: number;
  volume_m3: number;
  declared_value: number;
  duty_owed: number;
  status: string;
  deposited_at: string;
  released_at?: string;
  max_storage_days: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BondedWarehouse() {
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [showReleaseDialog, setShowReleaseDialog] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Register form
  const [regName, setRegName] = useState("");
  const [regPort, setRegPort] = useState("");
  const [regAddress, setRegAddress] = useState("");
  const [regCapacity, setRegCapacity] = useState("5000");

  // Deposit form
  const [depWarehouseId, setDepWarehouseId] = useState("");
  const [depUcr, setDepUcr] = useState("");
  const [depDeclId, setDepDeclId] = useState("");
  const [depHsCode, setDepHsCode] = useState("");
  const [depDesc, setDepDesc] = useState("");
  const [depQty, setDepQty] = useState("");
  const [depVol, setDepVol] = useState("");
  const [depValue, setDepValue] = useState("");
  const [depDutyRate, setDepDutyRate] = useState("0.20");
  const [depBondValue, setDepBondValue] = useState("");

  // Release form
  const [relDutyPaid, setRelDutyPaid] = useState("");
  const [relPaymentRef, setRelPaymentRef] = useState("");
  const [relDestType, setRelDestType] = useState<"domestic" | "re_export" | "destruction">("domestic");

  const statsQ = trpc.warehouse.stats.useQuery();
  const listQ = trpc.warehouse.list.useQuery();
  const inventoryQ = trpc.warehouse.listInventory.useQuery();

  const registerMut = trpc.warehouse.register.useMutation({
    onSuccess: () => {
      toast.success("Warehouse registered successfully");
      setShowRegisterDialog(false);
      listQ.refetch();
      statsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const depositMut = trpc.warehouse.deposit.useMutation({
    onSuccess: () => {
      toast.success("Goods deposited. Duty-suspension bond issued.");
      setShowDepositDialog(false);
      inventoryQ.refetch();
      statsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const releaseMut = trpc.warehouse.release.useMutation({
    onSuccess: (data) => {
      toast.success(`Goods released. Permit: ${data.clearance_permit}`);
      setShowReleaseDialog(false);
      setSelectedItem(null);
      inventoryQ.refetch();
      statsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const stats = statsQ.data as any;
  const warehouses: WarehouseItem[] = (listQ.data as any)?.warehouses ?? [];
  const inventory: InventoryItem[] = (inventoryQ.data as any)?.inventory ?? [];

  const statusColor = (s: string) => {
    if (s === "active" || s === "deposited") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    if (s === "released") return "bg-blue-500/15 text-blue-400 border-blue-500/30";
    if (s === "suspended" || s === "transferred") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return "bg-red-500/15 text-red-400 border-red-500/30";
  };

  const utilPct = stats?.utilisation_pct ?? 0;

  const isInitialLoading = (statsQ.isLoading || listQ.isLoading || inventoryQ.isLoading) && !statsQ.data && !listQ.data;
  const loadError = statsQ.error || listQ.error || inventoryQ.error;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {isInitialLoading && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading warehouse data">
            <div className="h-8 w-64 animate-pulse rounded bg-muted" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
            <div className="h-64 animate-pulse rounded-lg bg-muted" />
          </div>
        )}
        {!isInitialLoading && loadError && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <p className="font-medium text-destructive">Warehouse data is unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError.message || "The platform could not be reached. No warehouse figures are shown rather than stale or fabricated ones."}
            </p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => { statsQ.refetch(); listQ.refetch(); inventoryQ.refetch(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
          </div>
        )}
        {!isInitialLoading && !loadError && (
        <>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Warehouse className="h-6 w-6 text-amber-400" />
              Bonded Warehouse Management
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Duty-suspension bonds, inventory tracking, and goods release
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { listQ.refetch(); inventoryQ.refetch(); statsQ.refetch(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowRegisterDialog(true)}>
              <Plus className="h-4 w-4 mr-1" /> Register Warehouse
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowDepositDialog(true)}>
              <ArrowDownRight className="h-4 w-4 mr-1" /> Deposit Goods
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Warehouses", value: stats?.total_warehouses ?? 0, icon: <Warehouse className="h-5 w-5 text-amber-400" /> },
            { label: "Capacity Used", value: `${utilPct}%`, icon: <TrendingUp className="h-5 w-5 text-blue-400" /> },
            { label: "Active Bonds", value: stats?.active_bonds ?? 0, icon: <Package className="h-5 w-5 text-purple-400" /> },
            { label: "Duty Suspended", value: `$${(stats?.total_duty_suspended ?? 0).toLocaleString()}`, icon: <DollarSign className="h-5 w-5 text-emerald-400" /> },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
                  </div>
                  {s.icon}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Warehouses */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base">Registered Warehouses</CardTitle>
          </CardHeader>
          <CardContent>
            {warehouses.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Warehouse className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No warehouses registered yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Licence</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Port</TableHead>
                    <TableHead>Capacity (m³)</TableHead>
                    <TableHead>Used (m³)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warehouses.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="font-mono text-xs">{w.licence_number}</TableCell>
                      <TableCell className="font-medium">{w.name}</TableCell>
                      <TableCell>{w.port_code}</TableCell>
                      <TableCell>{(w.max_capacity_m3 ?? 0).toLocaleString()}</TableCell>
                      <TableCell>{(w.used_capacity_m3 ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(w.status)}>{w.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Inventory */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base">Inventory Under Duty Suspension</CardTitle>
          </CardHeader>
          <CardContent>
            {inventory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No goods currently in bonded storage.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>UCR</TableHead>
                    <TableHead>HS Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Vol (m³)</TableHead>
                    <TableHead>Duty Owed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventory.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.ucr}</TableCell>
                      <TableCell>{item.hs_code}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{item.description}</TableCell>
                      <TableCell>{item.volume_m3}</TableCell>
                      <TableCell className="font-medium text-amber-400">${(item.duty_owed ?? 0).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusColor(item.status)}>{item.status}</Badge>
                      </TableCell>
                      <TableCell>
                        {item.status === "deposited" && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setSelectedItem(item);
                            setRelDutyPaid(item.duty_owed.toString());
                            setShowReleaseDialog(true);
                          }}>
                            <ArrowUpRight className="h-3 w-3 mr-1" /> Release
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        </>
        )}
      </div>

      {/* Register Warehouse Dialog */}
      <Dialog open={showRegisterDialog} onOpenChange={setShowRegisterDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Register Bonded Warehouse</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Warehouse Name</Label><Input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="Tema Port Bonded Warehouse A" /></div>
            <div><Label>Port Code</Label><Input value={regPort} onChange={(e) => setRegPort(e.target.value)} placeholder="GHTMA" /></div>
            <div><Label>Address</Label><Input value={regAddress} onChange={(e) => setRegAddress(e.target.value)} placeholder="Gate 5, Tema Port, Ghana" /></div>
            <div><Label>Max Capacity (m³)</Label><Input type="number" value={regCapacity} onChange={(e) => setRegCapacity(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRegisterDialog(false)}>Cancel</Button>
            <Button onClick={() => registerMut.mutate({ name: regName, portCode: regPort, address: regAddress, maxCapacityM3: parseFloat(regCapacity) })} disabled={registerMut.isPending}>
              {registerMut.isPending ? "Registering..." : "Register"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Deposit Goods Dialog */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Deposit Goods Under Duty Suspension</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Warehouse</Label>
              <Select value={depWarehouseId} onValueChange={setDepWarehouseId}>
                <SelectTrigger><SelectValue placeholder="Select warehouse" /></SelectTrigger>
                <SelectContent>
                  {warehouses.filter(w => w.status === "active").map(w => (
                    <SelectItem key={w.id} value={w.id}>{w.name} ({w.port_code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div><Label>UCR</Label><Input value={depUcr} onChange={(e) => setDepUcr(e.target.value)} placeholder="GH2024UCR001" /></div>
            <div><Label>Declaration ID</Label><Input type="number" value={depDeclId} onChange={(e) => setDepDeclId(e.target.value)} /></div>
            <div><Label>HS Code</Label><Input value={depHsCode} onChange={(e) => setDepHsCode(e.target.value)} placeholder="8471.30" /></div>
            <div><Label>Description</Label><Input value={depDesc} onChange={(e) => setDepDesc(e.target.value)} /></div>
            <div><Label>Quantity (kg)</Label><Input type="number" value={depQty} onChange={(e) => setDepQty(e.target.value)} /></div>
            <div><Label>Volume (m³)</Label><Input type="number" value={depVol} onChange={(e) => setDepVol(e.target.value)} /></div>
            <div><Label>Declared Value (USD)</Label><Input type="number" value={depValue} onChange={(e) => setDepValue(e.target.value)} /></div>
            <div><Label>Duty Rate (e.g. 0.20)</Label><Input type="number" step="0.01" value={depDutyRate} onChange={(e) => setDepDutyRate(e.target.value)} /></div>
            <div className="col-span-2"><Label>Bond Value (USD) — must ≥ duty owed</Label><Input type="number" value={depBondValue} onChange={(e) => setDepBondValue(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDepositDialog(false)}>Cancel</Button>
            <Button onClick={() => depositMut.mutate({
              warehouseId: depWarehouseId,
              ucr: depUcr,
              declarationId: parseInt(depDeclId),
              hsCode: depHsCode,
              description: depDesc,
              quantityKg: parseFloat(depQty) || 0,
              volumeM3: parseFloat(depVol) || 0,
              declaredValue: parseFloat(depValue),
              dutyRate: parseFloat(depDutyRate),
              bondValue: parseFloat(depBondValue),
            })} disabled={depositMut.isPending}>
              {depositMut.isPending ? "Depositing..." : "Deposit & Issue Bond"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Goods Dialog */}
      <Dialog open={showReleaseDialog} onOpenChange={setShowReleaseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Release Goods from Bonded Storage</DialogTitle></DialogHeader>
          {selectedItem && (
            <div className="space-y-3">
              <div className="bg-muted/30 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">UCR</span><span className="font-mono">{selectedItem.ucr}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Duty Owed</span><span className="font-medium text-amber-400">${(selectedItem.duty_owed ?? 0).toLocaleString()}</span></div>
              </div>
              <div><Label>Duty Paid (USD)</Label><Input type="number" value={relDutyPaid} onChange={(e) => setRelDutyPaid(e.target.value)} /></div>
              <div><Label>Payment Reference</Label><Input value={relPaymentRef} onChange={(e) => setRelPaymentRef(e.target.value)} placeholder="MOJ-2024-XXXXX" /></div>
              <div>
                <Label>Destination Type</Label>
                <Select value={relDestType} onValueChange={(v) => setRelDestType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="domestic">Domestic Release</SelectItem>
                    <SelectItem value="re_export">Re-Export</SelectItem>
                    <SelectItem value="destruction">Destruction</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowReleaseDialog(false); setSelectedItem(null); }}>Cancel</Button>
            <Button onClick={() => selectedItem && releaseMut.mutate({
              inventoryId: selectedItem.id,
              bondId: selectedItem.bond_id,
              dutyPaid: parseFloat(relDutyPaid),
              paymentRef: relPaymentRef,
              destinationType: relDestType,
            })} disabled={releaseMut.isPending}>
              {releaseMut.isPending ? "Releasing..." : <><CheckCircle2 className="h-4 w-4 mr-1" /> Release & Discharge Bond</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
