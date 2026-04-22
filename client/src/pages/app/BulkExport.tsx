/**
 * Bulk Export — TradeGateway™ NGSWTP
 * Export declarations, payments, and transaction history as CSV/JSON.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Download, FileText, RefreshCw, Calendar, Filter,
  Table2, FileJson, CheckCircle,
} from "lucide-react";

type ExportType = "declarations" | "payments" | "transactions";
type ExportFormat = "csv" | "json";

const EXPORT_TYPES = [
  { value: "declarations", label: "Declarations", icon: <FileText className="w-4 h-4" /> },
  { value: "payments", label: "Payments", icon: <Table2 className="w-4 h-4" /> },
  { value: "transactions", label: "Transaction History", icon: <FileJson className="w-4 h-4" /> },
];

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BulkExport() {
  const { toast } = useToast();
  const [exportType, setExportType] = useState<ExportType>("declarations");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isExporting, setIsExporting] = useState(false);
  const [lastExport, setLastExport] = useState<{ type: string; rows: number; at: Date } | null>(null);

  const exportDeclarationsMutation = trpc.bulkExport.exportDeclarations.useMutation({
    onSuccess: (data) => {
      const ts = new Date().toISOString().slice(0, 10);
      const ext = format;
      const filename = `declarations-${ts}.${ext}`;
      const content = (data as any).data ? JSON.stringify((data as any).data, null, 2) : data.content ?? "";
      downloadBlob(content, filename, format === "json" ? "application/json" : "text/csv");
      setLastExport({ type: "Declarations", rows: data.rowCount, at: new Date() });
      toast({ title: "Export complete", description: `${data.rowCount} declarations exported.` });
      setIsExporting(false);
    },
    onError: (err) => {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
      setIsExporting(false);
    },
  });

  const exportPaymentsMutation = trpc.bulkExport.exportPayments.useMutation({
    onSuccess: (data) => {
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `payments-${ts}.${format}`;
      const content = (data as any).data ? JSON.stringify((data as any).data, null, 2) : data.content ?? "";
      downloadBlob(content, filename, format === "json" ? "application/json" : "text/csv");
      setLastExport({ type: "Payments", rows: data.rowCount, at: new Date() });
      toast({ title: "Export complete", description: `${data.rowCount} payment records exported.` });
      setIsExporting(false);
    },
    onError: (err) => {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
      setIsExporting(false);
    },
  });

  const exportTransactionsMutation = trpc.bulkExport.exportTransactionHistory.useMutation({
    onSuccess: (data) => {
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `transactions-${ts}.${format}`;
      const content = (data as any).data ? JSON.stringify((data as any).data, null, 2) : data.content ?? "";
      downloadBlob(content, filename, format === "json" ? "application/json" : "text/csv");
      setLastExport({ type: "Transactions", rows: data.rowCount, at: new Date() });
      toast({ title: "Export complete", description: `${data.rowCount} transaction records exported.` });
      setIsExporting(false);
    },
    onError: (err) => {
      toast({ title: "Export failed", description: err.message, variant: "destructive" });
      setIsExporting(false);
    },
  });

  const handleExport = () => {
    setIsExporting(true);

    const fromStr = dateFrom || undefined;
    const toStr = dateTo || undefined;
    if (exportType === "declarations") {
      exportDeclarationsMutation.mutate({
        format: format as "csv" | "json",
        status: (statusFilter !== "all" ? statusFilter : "all") as any,
        dateFrom: fromStr,
        dateTo: toStr,
      });
    } else if (exportType === "payments") {
      exportPaymentsMutation.mutate({
        format: format as "csv" | "json",
        status: (statusFilter !== "all" ? statusFilter : "all") as any,
        dateFrom: fromStr,
        dateTo: toStr,
      });
    } else {
      exportTransactionsMutation.mutate({
        format: format as "csv" | "json",
        dateFrom: fromStr,
        dateTo: toStr,
      });
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Download className="w-7 h-7 text-[#D4A017]" />
          Bulk Export
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Export declarations, payments, and transaction history as CSV or JSON
        </p>
      </div>

      {/* Export Configuration */}
      <div className="bg-card border rounded-xl p-6 space-y-6">
        <h2 className="text-lg font-semibold">Configure Export</h2>

        {/* Export Type */}
        <div>
          <label className="text-sm font-medium mb-3 block">Data Type</label>
          <div className="grid grid-cols-3 gap-3">
            {EXPORT_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setExportType(t.value as ExportType)}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-colors text-left ${
                  exportType === t.value
                    ? "border-[#D4A017] bg-[#D4A017]/5"
                    : "border-border hover:border-muted-foreground"
                }`}
              >
                <span className={exportType === t.value ? "text-[#D4A017]" : "text-muted-foreground"}>
                  {t.icon}
                </span>
                <span className="font-medium text-sm">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Format */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-sm font-medium mb-1 block">Format</label>
            <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV (Spreadsheet)</SelectItem>
                <SelectItem value="json">JSON (API)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div>
            <label className="text-sm font-medium mb-1 block flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Date From
            </label>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Date To
            </label>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>

          {/* Status Filter (for declarations/payments) */}
          {exportType !== "transactions" && (
            <div>
              <label className="text-sm font-medium mb-1 block flex items-center gap-1">
                <Filter className="w-3 h-3" /> Status Filter
              </label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {exportType === "declarations" ? (
                    <>
                      <SelectItem value="submitted">Submitted</SelectItem>
                      <SelectItem value="cleared">Cleared</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                      <SelectItem value="under_assessment">Under Assessment</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="failed">Failed</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Export Button */}
        <div className="flex items-center gap-4">
          <Button
            className="bg-[#D4A017] hover:bg-[#b8891a] text-white px-8"
            disabled={isExporting}
            onClick={handleExport}
          >
            {isExporting ? (
              <><RefreshCw className="w-4 h-4 animate-spin mr-2" /> Exporting...</>
            ) : (
              <><Download className="w-4 h-4 mr-2" /> Export {EXPORT_TYPES.find((t) => t.value === exportType)?.label}</>
            )}
          </Button>
          {lastExport && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              Last export: {lastExport.type} — {lastExport.rows} rows at {lastExport.at.toLocaleTimeString()}
            </div>
          )}
        </div>
      </div>

      {/* Export Guide */}
      <div className="bg-muted/30 rounded-xl p-6">
        <h3 className="text-sm font-semibold mb-3">Export Guide</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-muted-foreground">
          <div>
            <div className="font-medium text-foreground mb-1">Declarations Export</div>
            <p>Includes declaration number, HS codes, trader, status, risk lane, duties, and clearance timestamps.</p>
          </div>
          <div>
            <div className="font-medium text-foreground mb-1">Payments Export</div>
            <p>Includes payment reference, amount, currency, method, Mojaloop transfer ID, and settlement status.</p>
          </div>
          <div>
            <div className="font-medium text-foreground mb-1">Transaction History</div>
            <p>Full audit trail of all financial transactions including ledger entries and reconciliation data.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
