import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Warehouse, AlertTriangle, Package, FileText, ChevronRight, Shield, RefreshCw, Download, Search, Bell,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";


const WAREHOUSE_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-yellow-100 text-yellow-700",
  revoked: "bg-red-100 text-red-700",
  pending_renewal: "bg-orange-100 text-orange-700",
};

const INVENTORY_STATUS_COLORS: Record<string, string> = {
  in_bond: "bg-blue-100 text-blue-700",
  ex_bonded: "bg-green-100 text-green-700",
  re_exported: "bg-purple-100 text-purple-700",
  destroyed: "bg-gray-100 text-gray-700",
  seized: "bg-red-100 text-red-700",
};

const PERMIT_STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-700",
  used: "bg-gray-100 text-gray-700",
  expired: "bg-red-100 text-red-700",
  cancelled: "bg-yellow-100 text-yellow-700",
};

export default function BondedWarehouseManagement() {
  const [warehouseFilter, setWarehouseFilter] = useState("all");
  const [inventoryStatus, setInventoryStatus] = useState("all");
  const [selectedWarehouse, setSelectedWarehouse] = useState<number | null>(null);
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryPage, setInventoryPage] = useState(1);
  const INVENTORY_PAGE_SIZE = 10;
  const [activeTab, setActiveTab] = useState("warehouses");
  const [permitSearch, setPermitSearch] = useState("");
  const [permitStatusFilter, setPermitStatusFilter] = useState("all");
  const [entryDialog, setEntryDialog] = useState(false);
  const [renewDialog, setRenewDialog] = useState<{ warehouseId: number; warehouseName: string } | null>(null);
  const [renewForm, setRenewForm] = useState({ newBondAmountUsd: "", newBondExpiryDays: "365", notes: "" });
  const [exitDialog, setExitDialog] = useState<{ inventoryId: number; description: string } | null>(null);
  const [exitReason, setExitReason] = useState<"ex_bonded" | "re_exported" | "destroyed" | "seized">("ex_bonded");
  const [registerDialog, setRegisterDialog] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    name: "", operatorName: "", country: "NGA", address: "",
    portCode: "", capacityCbm: "", bondAmountUsd: "", bondExpiryDays: "365",
  });
  const [entryForm, setEntryForm] = useState({
    warehouseId: "",
    ucr: "",
    hsCode: "",
    description: "",
    quantityKg: "",
    volumeCbm: "",
    invoiceValueUsd: "",
    originCountry: "",
    expiryDays: "180",
  });

  const { data: warehousesData, isLoading, isError } = trpc.bondedWarehouse.listWarehouses.useQuery({
    status: warehouseFilter === "all" ? undefined : (warehouseFilter as any),
  });

  const { data: inventoryData } = trpc.bondedWarehouse.getInventory.useQuery({
    warehouseId: selectedWarehouse ?? undefined,
    status: inventoryStatus === "all" ? undefined : (inventoryStatus as any),
    limit: 50,
  });

  // Fetch all inventory (no warehouse filter) for per-warehouse status summary chips
  const { data: allInventoryData } = trpc.bondedWarehouse.getInventory.useQuery({ limit: 200 });

  const { data: permitsData } = trpc.bondedWarehouse.listPermits.useQuery({
    warehouseId: selectedWarehouse ?? undefined,
  });

  const { data: bondGuarantees } = trpc.bondedWarehouse.getBondGuarantees.useQuery();
  const { data: alertsData } = trpc.bondedWarehouse.getExpiryAlerts.useQuery();

  const issuePermit = trpc.bondedWarehouse.issueExBondPermit.useMutation({
    onSuccess: () => toast.success("Ex-bond permit issued"),
  });

  const registerWarehouse = trpc.bondedWarehouse.registerWarehouse.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Warehouse registered — License: ${res.licenseNo}`);
      setRegisterDialog(false);
      setRegisterForm({ name: "", operatorName: "", country: "NGA", address: "", portCode: "", capacityCbm: "", bondAmountUsd: "", bondExpiryDays: "365" });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const recordExit = trpc.bondedWarehouse.recordExit.useMutation({
    onSuccess: () => {
      toast.success("Item released from bond");
      setExitDialog(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const renewBond = trpc.bondedWarehouse.renewBond.useMutation({
    onSuccess: () => {
      toast.success("Bond renewed successfully");
      setRenewDialog(null);
      setRenewForm({ newBondAmountUsd: "", newBondExpiryDays: "365", notes: "" });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const recordEntry = trpc.bondedWarehouse.recordEntry.useMutation({
    onSuccess: (res: any) => {
      toast.success(`Entry recorded — duty liability: $${res.dutyLiabilityUsd?.toLocaleString() ?? 0}`);
      setEntryDialog(false);
      setEntryForm({ warehouseId: "", ucr: "", hsCode: "", description: "", quantityKg: "", volumeCbm: "", invoiceValueUsd: "", originCountry: "", expiryDays: "180" });
    },
    onError: (err: any) => toast.error(err.message),
  });

  const warehouses = (warehousesData as any)?.warehouses ?? [];
  const allInventoryItems: any[] = (allInventoryData as any)?.items ?? [];

  // Build per-warehouse status count map
  const warehouseStatusCounts = useMemo(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const item of allInventoryItems) {
      const wid = item.warehouse_id;
      if (!map[wid]) map[wid] = {};
      map[wid][item.status] = (map[wid][item.status] ?? 0) + 1;
    }
    return map;
  }, [allInventoryItems]);
  const inventoryRaw = (inventoryData as any)?.items ?? [];
  const filteredInventory = useMemo(() => {
    if (!inventorySearch.trim()) return inventoryRaw;
    const q = inventorySearch.toLowerCase();
    return inventoryRaw.filter((item: any) =>
      (item.ucr ?? "").toLowerCase().includes(q) ||
      (item.description ?? "").toLowerCase().includes(q) ||
      (item.hsCode ?? "").toLowerCase().includes(q) ||
      (item.warehouseName ?? "").toLowerCase().includes(q) ||
      (item.originCountry ?? "").toLowerCase().includes(q)
    );
  }, [inventoryRaw, inventorySearch]);

  // Reset to page 1 when search query or status filter changes
  useEffect(() => { setInventoryPage(1); }, [inventorySearch, inventoryStatus]);

  const inventoryTotalPages = Math.max(1, Math.ceil(filteredInventory.length / INVENTORY_PAGE_SIZE));
  const inventory = filteredInventory.slice(
    (inventoryPage - 1) * INVENTORY_PAGE_SIZE,
    inventoryPage * INVENTORY_PAGE_SIZE
  );
  const permits = (permitsData as any)?.permits ?? [];
  const guarantees = (bondGuarantees as any) ?? [];
  const alerts = (alertsData as any)?.alerts ?? [];

  const criticalAlerts = alerts.filter((a: any) => a.severity === "critical");
  const warningAlerts = alerts.filter((a: any) => a.severity === "warning");
  const { user } = useAuth();
  const isAdmin = (user as any)?.role === "admin";
  const [expiryCheckDialog, setExpiryCheckDialog] = useState<null | {
    scanned: number; expiringSoon: number; alreadyExpired: number; totalFlagged: number;
    items: Array<Record<string, unknown> & { flag: string }>;
  }>(null);
  // Cached scan results merged into the alerts banner
  const [lastScanItems, setLastScanItems] = useState<Array<Record<string, unknown> & { flag: string }>>([]);

  const sendSmsMutation = trpc.bondedWarehouse.sendBondExpiryAlerts.useMutation({
    onSuccess: (res: any) => {
      toast.success(`SMS alerts sent to ${res.sent} warehouse operator(s)`);
    },
    onError: (err: any) => toast.error(err.message),
  });
  const runExpiryCheckMutation = trpc.bondedWarehouse.runExpiryCheck.useMutation({
    onSuccess: (result) => {
      setExpiryCheckDialog(result as any);
      // Merge flagged items into the banner so they persist across tab switches
      if (result.totalFlagged > 0) {
        setLastScanItems(result.items as any);
        toast.warning(`Expiry check complete — ${result.totalFlagged} item(s) flagged`);
      } else {
        setLastScanItems([]);
        toast.success("Expiry check complete — no items require attention");
      }
    },
    onError: (err) => toast.error(err.message),
  });

  /** Export allItems from the expiry banner as a CSV download */
  const exportExpiryCSV = (allItems: any[]) => {
    const headers = ["UCR / Name", "Type", "Days Until Expiry", "Severity", "Source"];
    const rows = allItems.map((item) => [
      `"${String(item.name).replace(/"/g, '""')}"`,
      `"${item.label}"`,
      item.daysUntilExpiry >= 0 ? item.daysUntilExpiry : `${Math.abs(item.daysUntilExpiry)} (overdue)`,
      item.severity,
      item.source,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bond-expiry-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading warehouse data...
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {isError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load warehouse data. Please refresh the page.
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Warehouse className="h-6 w-6 text-amber-600" />
            Bonded Warehouse Management
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Warehouse registration, goods-in-bond inventory, bond guarantees, and ex-bond permit issuance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => runExpiryCheckMutation.mutate()}
              disabled={runExpiryCheckMutation.isPending}
              className="text-xs"
            >
              <RefreshCw className={"h-3.5 w-3.5 mr-1" + (runExpiryCheckMutation.isPending ? " animate-spin" : "")} />
              {runExpiryCheckMutation.isPending ? "Scanning…" : "Run Expiry Check"}
            </Button>
          )}
          {criticalAlerts.length > 0 && (
            <Badge variant="outline" className="text-red-600 border-red-300">
              <AlertTriangle className="h-3 w-3 mr-1" />
              {criticalAlerts.length} Critical
            </Badge>
          )}
          {warningAlerts.length > 0 && (
            <Badge variant="outline" className="text-orange-600 border-orange-300">
              {warningAlerts.length} Warnings
            </Badge>
          )}
        </div>
      </div>

      {/* Expiry Check Results Dialog */}
      <Dialog open={!!expiryCheckDialog} onOpenChange={() => setExpiryCheckDialog(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bond Expiry Check Results</DialogTitle>
          </DialogHeader>
          {expiryCheckDialog && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="p-3 rounded-lg bg-muted/30">
                  <p className="text-xl font-bold">{expiryCheckDialog.scanned}</p>
                  <p className="text-xs text-muted-foreground">Scanned</p>
                </div>
                <div className="p-3 rounded-lg bg-red-50">
                  <p className="text-xl font-bold text-red-600">{expiryCheckDialog.alreadyExpired}</p>
                  <p className="text-xs text-muted-foreground">Expired</p>
                </div>
                <div className="p-3 rounded-lg bg-orange-50">
                  <p className="text-xl font-bold text-orange-600">{expiryCheckDialog.expiringSoon}</p>
                  <p className="text-xs text-muted-foreground">Expiring ≤7d</p>
                </div>
              </div>
              {expiryCheckDialog.totalFlagged === 0 ? (
                <p className="text-center text-sm text-green-600 font-medium py-2">✓ All bonds are within their validity period</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {(expiryCheckDialog.items as any[]).map((item: any, idx: number) => (
                    <div
                      key={idx}
                      className={"flex items-start justify-between p-2.5 rounded-lg border text-sm " +
                        (item.flag === "expired" ? "border-red-200 bg-red-50" : "border-orange-200 bg-orange-50")}
                    >
                      <div>
                        <p className="font-medium">{item.ucr}</p>
                        <p className="text-xs text-muted-foreground">{item.goods_description} · {item.warehouse_name}</p>
                      </div>
                      <Badge className={item.flag === "expired" ? "bg-red-600 text-white" : "bg-orange-500 text-white"}>
                        {item.flag === "expired"
                          ? `${Math.abs(item.daysUntilExpiry)}d overdue`
                          : `${item.daysUntilExpiry}d left`}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
              {expiryCheckDialog.totalFlagged > 0 && (
                <p className="text-xs text-muted-foreground text-center">Owner notification sent</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Alerts banner — shows DB alerts merged with latest manual scan results */}
      {(alerts.length > 0 || lastScanItems.length > 0) && (() => {
        // Build a unified list: DB alerts first, then scan-only items not already in DB alerts
        const dbAlertUcrs = new Set(alerts.map((a: any) => a.ucr ?? a.name));
        const scanOnlyItems = lastScanItems.filter((item) => !dbAlertUcrs.has(item.ucr));
        const allItems: any[] = [
          ...alerts.map((a: any) => ({
            key: a.id ?? a.ucr,
            label: a.type === "bond_expiry" ? "Bond expiry" : a.type === "inventory_overdue" ? "Overdue inventory" : "Permit expiry",
            name: a.name,
            daysUntilExpiry: a.daysUntilExpiry,
            severity: a.severity,
            source: "db",
          })),
          ...scanOnlyItems.map((item: any) => ({
            key: `scan-${item.ucr}`,
            label: item.flag === "expired" ? "Expired bond" : "Expiring soon",
            name: `${item.ucr} — ${item.goods_description}`,
            daysUntilExpiry: item.daysUntilExpiry,
            severity: item.flag === "expired" ? "critical" : "warning",
            source: "scan",
          })),
        ];
        return (
          <Card className="border-orange-200 bg-orange-50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <span className="font-medium text-orange-800">Expiry Alerts</span>
                  <Badge className="bg-orange-200 text-orange-800 text-xs">{allItems.length}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  {lastScanItems.length > 0 && (
                    <span className="text-xs text-orange-600 italic">Includes latest scan results</span>
                  )}
                  <button
                    onClick={() => exportExpiryCSV(allItems)}
                    className="flex items-center gap-1 text-xs text-orange-700 hover:text-orange-900 font-medium border border-orange-300 rounded px-2 py-0.5 bg-white/60 hover:bg-white/90 transition-colors"
                    title="Download expiry report as CSV"
                  >
                    <Download className="h-3 w-3" />
                    Export CSV
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => sendSmsMutation.mutate({ daysAhead: 30 })}
                      disabled={sendSmsMutation.isPending}
                      className="flex items-center gap-1 text-xs text-orange-700 hover:text-orange-900 font-medium border border-orange-300 rounded px-2 py-0.5 bg-white/60 hover:bg-white/90 transition-colors disabled:opacity-50"
                      title="Send SMS alerts to warehouse operators with expiring bonds"
                    >
                      <Bell className="h-3 w-3" />
                      {sendSmsMutation.isPending ? "Sending…" : "Send SMS Alerts"}
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                {allItems.slice(0, 8).map((item) => (
                  <div key={item.key} className="text-sm flex items-center justify-between">
                    <span className="text-orange-700">
                      {item.label}: {item.name}
                      {item.source === "scan" && (
                        <span className="ml-1 text-xs text-orange-500">(scan)</span>
                      )}
                    </span>
                    <Badge className={item.severity === "critical" ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}>
                      {item.daysUntilExpiry >= 0 ? `${item.daysUntilExpiry}d left` : `${Math.abs(item.daysUntilExpiry)}d overdue`}
                    </Badge>
                  </div>
                ))}
                {allItems.length > 8 && (
                  <p className="text-xs text-orange-600 pt-1">+{allItems.length - 8} more — run expiry check to see full list</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="warehouses">Warehouses</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="permits">Ex-Bond Permits</TabsTrigger>
          <TabsTrigger value="bonds">Bond Guarantees</TabsTrigger>
        </TabsList>

        {/* Warehouses */}
        <TabsContent value="warehouses" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={warehouseFilter} onValueChange={setWarehouseFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="suspended">Suspended</SelectItem>
                <SelectItem value="pending_renewal">Pending Renewal</SelectItem>
                <SelectItem value="revoked">Revoked</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{warehouses.length} warehouses</span>
            <Button size="sm" className="ml-auto h-8 text-xs gap-1.5" onClick={() => setRegisterDialog(true)}>
              <Warehouse className="h-3.5 w-3.5" />
              Register Warehouse
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {warehouses.map((wh: any) => (
              <Card key={wh.id} className={`cursor-pointer hover:shadow-md transition-shadow ${selectedWarehouse === wh.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => {
                  setSelectedWarehouse(wh.id);
                  setActiveTab("inventory");
                  setInventoryPage(1);
                }}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={WAREHOUSE_STATUS_COLORS[wh.status] ?? ""}>{wh.status.replace(/_/g, " ")}</Badge>
                        <span className="font-semibold text-sm">{wh.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {wh.licenseNo} · {wh.country} · {wh.operatorName}
                      </div>
                      {(() => {
                          const utilPct = Math.round(Math.min(100, (wh.usedCbm / wh.capacityCbm) * 100));
                          const barColor =
                            utilPct >= 90 ? "bg-red-500" :
                            utilPct >= 70 ? "bg-amber-500" :
                            "bg-green-500";
                          return (
                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Utilisation</span>
                            <span className={utilPct >= 90 ? "text-red-600 font-medium" : utilPct >= 70 ? "text-amber-600 font-medium" : "text-green-700"}>
                              {wh.usedCbm.toLocaleString()} / {wh.capacityCbm.toLocaleString()} m³ ({utilPct}%)
                            </span>
                          </div>
                          <Progress
                            value={utilPct}
                            className={`h-2 bg-muted [&>[data-slot=progress-indicator]]:${barColor}`}
                          />
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Bond</span>
                          <span>${wh.bondAmountUsd.toLocaleString()} · expires {new Date(wh.bondExpiry).toLocaleDateString()}</span>
                        </div>
                        {/* Inventory status summary chips */}
                        {(() => {
                          const counts = warehouseStatusCounts[wh.id] ?? {};
                          const chips: { label: string; cls: string }[] = [];
                          if (counts["in_bond"]) chips.push({ label: `${counts["in_bond"]} in bond`, cls: "bg-blue-100 text-blue-700" });
                          if (counts["ex_bonded"]) chips.push({ label: `${counts["ex_bonded"]} ex-bonded`, cls: "bg-purple-100 text-purple-700" });
                          if (counts["re_exported"]) chips.push({ label: `${counts["re_exported"]} re-exported`, cls: "bg-green-100 text-green-700" });
                          if (counts["seized"]) chips.push({ label: `${counts["seized"]} seized`, cls: "bg-red-100 text-red-700" });
                          if (counts["destroyed"]) chips.push({ label: `${counts["destroyed"]} destroyed`, cls: "bg-gray-100 text-gray-600" });
                          if (chips.length === 0) return null;
                          return (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {chips.map((c) => (
                                <span key={c.label} className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${c.cls}`}>{c.label}</span>
                              ))}
                            </div>
                          );
                        })()}
                      </div>
                          );
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Inventory */}
        <TabsContent value="inventory" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            {selectedWarehouse && (
              <Badge variant="outline" className="text-blue-600">
                Filtered: {warehouses.find((w: any) => w.id === selectedWarehouse)?.name}
                <button className="ml-2 text-muted-foreground hover:text-foreground" onClick={() => setSelectedWarehouse(null)}>×</button>
              </Badge>
            )}
            {/* Search bar */}
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={inventorySearch}
                onChange={(e) => setInventorySearch(e.target.value)}
                placeholder="Search UCR, HS code, description…"
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Select value={inventoryStatus} onValueChange={setInventoryStatus}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="in_bond">In Bond</SelectItem>
                <SelectItem value="ex_bonded">Ex-Bonded</SelectItem>
                <SelectItem value="re_exported">Re-Exported</SelectItem>
                <SelectItem value="destroyed">Destroyed</SelectItem>
                <SelectItem value="seized">Seized</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {filteredInventory.length}{inventorySearch ? ` of ${inventoryRaw.length}` : ""} items
              {inventorySearch && (
                <button className="ml-2 text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setInventorySearch("")}>clear</button>
              )}
            </span>
            <Button size="sm" className="ml-auto h-8 text-xs gap-1.5" onClick={() => setEntryDialog(true)}>
              <Package className="h-3.5 w-3.5" />
              Record Entry
            </Button>
          </div>

          <div className="space-y-2">
            {inventory.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No inventory items match your search.
              </div>
            )}
            {inventory.map((item: any) => (
              <Card key={item.id}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={INVENTORY_STATUS_COLORS[item.status] ?? ""}>{item.status.replace(/_/g, " ")}</Badge>
                      <span className="font-medium text-sm">{item.description}</span>
                      <span className="text-xs text-muted-foreground font-mono">HS {item.hsCode}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>Decl: {item.declarationId}</span>
                      <span>{item.warehouseName}</span>
                      <span>Qty: {item.quantity} {item.unit}</span>
                      <span>{item.weightKg}kg / {item.volumeCbm}m³</span>
                      <span>Value: ${item.valueUsd.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 text-xs flex gap-3 flex-wrap">
                      <span className="text-muted-foreground">Entry: {new Date(item.entryDate).toLocaleDateString()}</span>
                      <span className={new Date(item.expectedExitDate) < new Date() && item.status === "in_bond" ? "text-red-600 font-medium" : "text-muted-foreground"}>
                        Expected exit: {new Date(item.expectedExitDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  {item.status === "in_bond" && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <Button size="sm" variant="outline" onClick={() =>
                        issuePermit.mutate({
                          inventoryId: item.id,
                          quantityKg: item.quantity_kg ?? item.quantity ?? 1,
                          dutyPaidUsd: item.duty_liability_usd ?? 0,
                          validDays: 30,
                        })
                      }>
                        <FileText className="h-3 w-3 mr-1" />
                        Issue Permit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs border-red-300 text-red-600 hover:bg-red-50"
                        onClick={() => { setExitReason("ex_bonded"); setExitDialog({ inventoryId: item.id, description: item.description }); }}
                      >
                        <ChevronRight className="h-3 w-3 mr-1" />
                        Release
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {inventoryTotalPages > 1 && (
            <div className="flex items-center justify-between pt-3 border-t border-border">
              <span className="text-xs text-muted-foreground">
                Page {inventoryPage} of {inventoryTotalPages} &middot; {filteredInventory.length} item{filteredInventory.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={inventoryPage === 1}
                  onClick={() => setInventoryPage((p) => p - 1)}
                >
                  ← Prev
                </Button>
                {Array.from({ length: inventoryTotalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === inventoryTotalPages || Math.abs(p - inventoryPage) <= 1)
                  .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "..." ? (
                      <span key={`ellipsis-${idx}`} className="text-xs text-muted-foreground px-1">…</span>
                    ) : (
                      <Button
                        key={p}
                        variant={inventoryPage === p ? "default" : "outline"}
                        size="sm"
                        className="h-7 w-7 p-0 text-xs"
                        onClick={() => setInventoryPage(p as number)}
                      >
                        {p}
                      </Button>
                    )
                  )
                }
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  disabled={inventoryPage === inventoryTotalPages}
                  onClick={() => setInventoryPage((p) => p + 1)}
                >
                  Next →
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Permits */}
        <TabsContent value="permits" className="space-y-4">
          {/* Search + filter bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                value={permitSearch}
                onChange={(e) => setPermitSearch(e.target.value)}
                placeholder="Search permit no. or payment ref…"
                className="pl-8 h-9 text-sm"
              />
            </div>
            <Select value={permitStatusFilter} onValueChange={setPermitStatusFilter}>
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="used">Used</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {permits.filter((p: any) => {
                const matchSearch = !permitSearch.trim() ||
                  (p.permitNo ?? "").toLowerCase().includes(permitSearch.toLowerCase()) ||
                  (p.payment_ref ?? p.paymentRef ?? "").toLowerCase().includes(permitSearch.toLowerCase());
                const matchStatus = permitStatusFilter === "all" || p.status === permitStatusFilter;
                return matchSearch && matchStatus;
              }).length} of {permits.length} permits
            </span>
          </div>
          <div className="space-y-2">
            {permits.filter((permit: any) => {
              const matchSearch = !permitSearch.trim() ||
                (permit.permitNo ?? "").toLowerCase().includes(permitSearch.toLowerCase()) ||
                (permit.payment_ref ?? permit.paymentRef ?? "").toLowerCase().includes(permitSearch.toLowerCase());
              const matchStatus = permitStatusFilter === "all" || permit.status === permitStatusFilter;
              return matchSearch && matchStatus;
            }).map((permit: any) => (
              <Card key={permit.id}>
                <CardContent className="p-4 flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={PERMIT_STATUS_COLORS[permit.status] ?? ""}>{permit.status}</Badge>
                      <span className="font-mono text-sm font-medium">{permit.permitNo}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex gap-3 flex-wrap">
                      <span>Payment Ref: {permit.payment_ref ?? permit.paymentRef ?? "—"}</span>
                      <span>Qty: {permit.quantity}</span>
                      <span>Issued: {new Date(permit.issuedAt).toLocaleDateString()}</span>
                      <span>
                        Expires: {new Date(permit.expiresAt).toLocaleDateString()}
                        {permit.status === "active" && (() => {
                          const daysLeft = Math.ceil(
                            (new Date(permit.expiresAt).getTime() - Date.now()) / 86_400_000
                          );
                          const cls =
                            daysLeft < 0 ? "bg-red-100 text-red-700" :
                            daysLeft <= 3 ? "bg-red-100 text-red-700" :
                            daysLeft <= 7 ? "bg-amber-100 text-amber-700" :
                            "bg-green-100 text-green-700";
                          const label =
                            daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` :
                            daysLeft === 0 ? "expires today" :
                            `${daysLeft}d left`;
                          return (
                            <Badge className={`ml-2 text-xs ${cls}`}>{label}</Badge>
                          );
                        })()}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {permits.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No ex-bond permits found.
              </div>
            )}
          </div>
        </TabsContent>

        {/* Bond Guarantees */}
        <TabsContent value="bonds" className="space-y-4">
          <div className="space-y-3">
            {guarantees.map((g: any) => (
              <Card key={g.warehouseId} className={!g.isSufficient ? "border-red-200" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Shield className={`h-4 w-4 ${g.isSufficient ? "text-green-600" : "text-red-600"}`} />
                        <span className="font-medium text-sm">{g.warehouseName}</span>
                        {!g.isSufficient && <Badge className="bg-red-100 text-red-700">Insufficient Bond</Badge>}
                        {g.isExpiringSoon && <Badge className="bg-orange-100 text-orange-700">Expiring Soon</Badge>}
                      </div>
                      <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-muted-foreground">Bond Amount</div>
                          <div className="font-medium">${g.bondAmountUsd.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Required (110%)</div>
                          <div className={`font-medium ${!g.isSufficient ? "text-red-600" : ""}`}>${g.requiredBondUsd.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Inventory Value</div>
                          <div className="font-medium">${g.inventoryValueUsd.toLocaleString()}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Bond Expiry</div>
                          <div className={`font-medium ${g.isExpiringSoon ? "text-orange-600" : ""}`}>
                            {new Date(g.bondExpiry).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs shrink-0"
                      onClick={() => setRenewDialog({ warehouseId: g.warehouseId, warehouseName: g.warehouseName })}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Renew Bond
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Register Warehouse Dialog */}
      <Dialog open={registerDialog} onOpenChange={setRegisterDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5" />
              Register New Bonded Warehouse
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Warehouse Name *</Label>
              <Input className="h-9 text-sm" placeholder="e.g. Lagos Port Bonded Store A" value={registerForm.name} onChange={(e) => setRegisterForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Operator Name *</Label>
              <Input className="h-9 text-sm" placeholder="Company name" value={registerForm.operatorName} onChange={(e) => setRegisterForm((f) => ({ ...f, operatorName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Country (ISO-3)</Label>
              <Input className="h-9 text-sm" maxLength={3} value={registerForm.country} onChange={(e) => setRegisterForm((f) => ({ ...f, country: e.target.value.toUpperCase() }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Address *</Label>
              <Input className="h-9 text-sm" placeholder="Full address" value={registerForm.address} onChange={(e) => setRegisterForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Port Code</Label>
              <Input className="h-9 text-sm" placeholder="NGLOS" value={registerForm.portCode} onChange={(e) => setRegisterForm((f) => ({ ...f, portCode: e.target.value.toUpperCase() }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Capacity (m³) *</Label>
              <Input type="number" min="1" className="h-9 text-sm" placeholder="5000" value={registerForm.capacityCbm} onChange={(e) => setRegisterForm((f) => ({ ...f, capacityCbm: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bond Amount (USD) *</Label>
              <Input type="number" min="0" className="h-9 text-sm" placeholder="500000" value={registerForm.bondAmountUsd} onChange={(e) => setRegisterForm((f) => ({ ...f, bondAmountUsd: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bond Duration (days)</Label>
              <Input type="number" min="30" className="h-9 text-sm" value={registerForm.bondExpiryDays} onChange={(e) => setRegisterForm((f) => ({ ...f, bondExpiryDays: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterDialog(false)}>Cancel</Button>
            <Button
              disabled={registerWarehouse.isPending}
              onClick={() => {
                if (!registerForm.name || !registerForm.operatorName || !registerForm.address || !registerForm.capacityCbm) {
                  toast.error("Please fill in all required fields");
                  return;
                }
                registerWarehouse.mutate({
                  name: registerForm.name,
                  operatorName: registerForm.operatorName,
                  country: registerForm.country || "NGA",
                  address: registerForm.address,
                  portCode: registerForm.portCode || undefined,
                  capacityCbm: Number(registerForm.capacityCbm),
                  bondAmountUsd: Number(registerForm.bondAmountUsd) || 0,
                  bondExpiryDays: Number(registerForm.bondExpiryDays) || 365,
                });
              }}
            >
              {registerWarehouse.isPending ? "Registering…" : "Register Warehouse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release Item Dialog */}
      <Dialog open={!!exitDialog} onOpenChange={(open) => { if (!open) setExitDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Release from Bond</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Release <span className="font-medium text-foreground">{exitDialog?.description}</span> from bonded storage.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Exit Reason *</Label>
              <Select value={exitReason} onValueChange={(v) => setExitReason(v as any)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ex_bonded">Ex-Bonded (duty paid)</SelectItem>
                  <SelectItem value="re_exported">Re-Exported</SelectItem>
                  <SelectItem value="destroyed">Destroyed</SelectItem>
                  <SelectItem value="seized">Seized</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExitDialog(null)}>Cancel</Button>
            <Button
              disabled={recordExit.isPending}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (!exitDialog) return;
                recordExit.mutate({ inventoryId: exitDialog.inventoryId, exitReason });
              }}
            >
              {recordExit.isPending ? "Releasing…" : "Confirm Release"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Renew Bond Dialog */}
      <Dialog open={!!renewDialog} onOpenChange={(open) => { if (!open) setRenewDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Renew Bond — {renewDialog?.warehouseName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">New Bond Amount (USD) *</Label>
              <Input
                type="number" min="1" className="h-9 text-sm"
                placeholder="e.g. 500000"
                value={renewForm.newBondAmountUsd}
                onChange={(e) => setRenewForm((f) => ({ ...f, newBondAmountUsd: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bond Duration (days)</Label>
              <Input
                type="number" min="1" className="h-9 text-sm"
                value={renewForm.newBondExpiryDays}
                onChange={(e) => setRenewForm((f) => ({ ...f, newBondExpiryDays: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes (optional)</Label>
              <Input
                className="h-9 text-sm"
                placeholder="Reference number, insurer, etc."
                value={renewForm.notes}
                onChange={(e) => setRenewForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewDialog(null)}>Cancel</Button>
            <Button
              disabled={renewBond.isPending}
              onClick={() => {
                if (!renewDialog || !renewForm.newBondAmountUsd) {
                  toast.error("Bond amount is required");
                  return;
                }
                renewBond.mutate({
                  warehouseId: renewDialog.warehouseId,
                  newBondAmountUsd: Number(renewForm.newBondAmountUsd),
                  newBondExpiryDays: Number(renewForm.newBondExpiryDays) || 365,
                  notes: renewForm.notes || undefined,
                });
              }}
            >
              {renewBond.isPending ? "Renewing…" : "Confirm Renewal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record Entry Dialog */}
      <Dialog open={entryDialog} onOpenChange={setEntryDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Record Bonded Warehouse Entry
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Warehouse *</Label>
              <Select value={entryForm.warehouseId} onValueChange={(v) => setEntryForm((f) => ({ ...f, warehouseId: v }))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.filter((w: any) => w.status === "active").map((w: any) => (
                    <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">UCR *</Label>
              <Input className="h-9 text-sm" placeholder="UCR-2026-XXXXX" value={entryForm.ucr} onChange={(e) => setEntryForm((f) => ({ ...f, ucr: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">HS Code *</Label>
              <Input className="h-9 text-sm" placeholder="8471.30" value={entryForm.hsCode} onChange={(e) => setEntryForm((f) => ({ ...f, hsCode: e.target.value }))} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Description *</Label>
              <Input className="h-9 text-sm" placeholder="Goods description" value={entryForm.description} onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity (kg) *</Label>
              <Input type="number" min="0" className="h-9 text-sm" placeholder="0" value={entryForm.quantityKg} onChange={(e) => setEntryForm((f) => ({ ...f, quantityKg: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Volume (m³) *</Label>
              <Input type="number" min="0" step="0.01" className="h-9 text-sm" placeholder="0.00" value={entryForm.volumeCbm} onChange={(e) => setEntryForm((f) => ({ ...f, volumeCbm: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Invoice Value (USD) *</Label>
              <Input type="number" min="0" className="h-9 text-sm" placeholder="0" value={entryForm.invoiceValueUsd} onChange={(e) => setEntryForm((f) => ({ ...f, invoiceValueUsd: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Origin Country (ISO-3)</Label>
              <Input className="h-9 text-sm" placeholder="GHA" maxLength={3} value={entryForm.originCountry} onChange={(e) => setEntryForm((f) => ({ ...f, originCountry: e.target.value.toUpperCase() }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bond Period (days)</Label>
              <Input type="number" min="1" className="h-9 text-sm" value={entryForm.expiryDays} onChange={(e) => setEntryForm((f) => ({ ...f, expiryDays: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEntryDialog(false)}>Cancel</Button>
            <Button
              disabled={recordEntry.isPending}
              onClick={() => {
                if (!entryForm.warehouseId || !entryForm.ucr || !entryForm.hsCode || !entryForm.description) {
                  toast.error("Please fill in all required fields");
                  return;
                }
                recordEntry.mutate({
                  warehouseId: Number(entryForm.warehouseId),
                  ucr: entryForm.ucr,
                  hsCode: entryForm.hsCode,
                  description: entryForm.description,
                  quantityKg: Number(entryForm.quantityKg) || 0,
                  volumeCbm: Number(entryForm.volumeCbm) || 0,
                  invoiceValueUsd: Number(entryForm.invoiceValueUsd) || 0,
                  originCountry: entryForm.originCountry || undefined,
                  expiryDays: Number(entryForm.expiryDays) || 180,
                });
              }}
            >
              {recordEntry.isPending ? "Recording…" : "Record Entry"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
