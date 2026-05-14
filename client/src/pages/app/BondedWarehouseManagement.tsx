import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Warehouse, AlertTriangle, Package, FileText, ChevronRight, Shield, RefreshCw, Download, Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/_core/hooks/useAuth";
import { toast } from "sonner";

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

  const { data: warehousesData, isLoading, isError } = trpc.bondedWarehouse.listWarehouses.useQuery({
    status: warehouseFilter === "all" ? undefined : (warehouseFilter as any),
  });

  const { data: inventoryData } = trpc.bondedWarehouse.getInventory.useQuery({
    warehouseId: selectedWarehouse ?? undefined,
    status: inventoryStatus === "all" ? undefined : (inventoryStatus as any),
    limit: 50,
  });

  const { data: permitsData } = trpc.bondedWarehouse.listPermits.useQuery({
    warehouseId: selectedWarehouse ?? undefined,
  });

  const { data: bondGuarantees } = trpc.bondedWarehouse.getBondGuarantees.useQuery();
  const { data: alertsData } = trpc.bondedWarehouse.getExpiryAlerts.useQuery();

  const issuePermit = trpc.bondedWarehouse.issueExBondPermit.useMutation({
    onSuccess: () => toast.success("Ex-bond permit issued"),
  });

  const warehouses = (warehousesData as any)?.warehouses ?? [];
  const inventoryRaw = (inventoryData as any)?.items ?? [];
  const inventory = useMemo(() => {
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

      <Tabs defaultValue="warehouses">
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {warehouses.map((wh: any) => (
              <Card key={wh.id} className={`cursor-pointer hover:shadow-md transition-shadow ${selectedWarehouse === wh.id ? "ring-2 ring-primary" : ""}`}
                onClick={() => setSelectedWarehouse(selectedWarehouse === wh.id ? null : wh.id)}>
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
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Capacity</span>
                          <span>{wh.usedCbm.toLocaleString()} / {wh.capacityCbm.toLocaleString()} m³</span>
                        </div>
                        <div className="bg-muted rounded-full h-1.5">
                          <div
                            className={`h-1.5 rounded-full ${wh.usedCbm / wh.capacityCbm > 0.85 ? "bg-red-500" : "bg-blue-500"}`}
                            style={{ width: `${Math.min(100, (wh.usedCbm / wh.capacityCbm) * 100)}%` }}
                          />
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Bond</span>
                          <span>${wh.bondAmountUsd.toLocaleString()} · expires {new Date(wh.bondExpiry).toLocaleDateString()}</span>
                        </div>
                      </div>
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
              {inventory.length}{inventorySearch ? ` of ${inventoryRaw.length}` : ""} items
              {inventorySearch && (
                <button className="ml-2 text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setInventorySearch("")}>clear</button>
              )}
            </span>
          </div>

          <div className="space-y-2">
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
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Permits */}
        <TabsContent value="permits" className="space-y-4">
          <div className="space-y-2">
            {permits.map((permit: any) => (
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
                      <span className={new Date(permit.expiresAt) < new Date() && permit.status === "active" ? "text-red-600 font-medium" : ""}>
                        Expires: {new Date(permit.expiresAt).toLocaleDateString()}
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
                      <div className="flex items-center gap-2">
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
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
