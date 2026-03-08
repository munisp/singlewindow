/**
 * ExportDeclarationsDialog — Sprint 15
 *
 * Reusable dialog for bulk-exporting declarations as CSV or JSON.
 * Works for both traders (own declarations) and admins/officers (all declarations).
 *
 * Usage:
 *   <ExportDeclarationsDialog trigger={<Button>Export</Button>} />
 *   <ExportDeclarationsDialog trigger={<Button>Export</Button>} traderId={42} />
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, FileJson, Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface ExportDeclarationsDialogProps {
  trigger: React.ReactNode;
  /** Admin only: restrict export to a specific trader */
  traderId?: number;
}

function downloadFile(filename: string, base64Content: string, mimeType: string) {
  const binary = atob(base64Content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportDeclarationsDialog({
  trigger,
  traderId,
}: ExportDeclarationsDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [status, setStatus] = useState("all");
  const [riskLane, setRiskLane] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [limit, setLimit] = useState(1000);

  const previewInput = useMemo(
    () => ({
      status,
      riskLane,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      traderId,
    }),
    [status, riskLane, dateFrom, dateTo, traderId]
  );

  const { data: preview } = trpc.bulkExport.previewCount.useQuery(previewInput, {
    enabled: open,
  });

  const exportMutation = trpc.bulkExport.exportDeclarations.useMutation({
    onSuccess: (result) => {
      const mimeType =
        result.format === "json" ? "application/json" : "text/csv;charset=utf-8;";
      downloadFile(result.filename, result.content, mimeType);
      toast.success(
        `Exported ${result.rowCount} declaration${result.rowCount !== 1 ? "s" : ""} as ${result.format.toUpperCase()}`
      );
      setOpen(false);
    },
    onError: (err) => toast.error(`Export failed: ${err.message}`),
  });

  const handleExport = () => {
    exportMutation.mutate({
      format,
      status: status as any,
      riskLane: riskLane as any,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      traderId,
      limit,
    });
  };

  const rowCount = preview?.count ?? 0;
  const isOverLimit = rowCount > limit;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            Export Declarations
          </DialogTitle>
          <DialogDescription>
            Configure filters and download declarations as CSV or JSON.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Format */}
          <div className="space-y-1.5">
            <Label>Export Format</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  format === "csv"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                <FileText className="h-4 w-4" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  format === "json"
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border hover:bg-muted"
                }`}
              >
                <FileJson className="h-4 w-4" />
                JSON
              </button>
            </div>
          </div>

          {/* Status filter */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="under_assessment">Under Assessment</SelectItem>
                  <SelectItem value="docs_required">Docs Required</SelectItem>
                  <SelectItem value="payment_pending">Payment Pending</SelectItem>
                  <SelectItem value="payment_confirmed">Payment Confirmed</SelectItem>
                  <SelectItem value="under_examination">Under Examination</SelectItem>
                  <SelectItem value="examination_complete">Exam Complete</SelectItem>
                  <SelectItem value="cleared">Cleared</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Risk Lane</Label>
              <Select value={riskLane} onValueChange={setRiskLane}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lanes</SelectItem>
                  <SelectItem value="green">Green</SelectItem>
                  <SelectItem value="yellow">Yellow</SelectItem>
                  <SelectItem value="red">Red</SelectItem>
                  <SelectItem value="blue">Blue (AEO)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date range */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Submitted From</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Submitted To</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </div>

          {/* Row limit */}
          <div className="space-y-1.5">
            <Label>Max Rows</Label>
            <Select
              value={String(limit)}
              onValueChange={(v) => setLimit(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="100">100 rows</SelectItem>
                <SelectItem value="500">500 rows</SelectItem>
                <SelectItem value="1000">1,000 rows</SelectItem>
                <SelectItem value="2000">2,000 rows</SelectItem>
                <SelectItem value="5000">5,000 rows</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Preview count */}
          <div className="rounded-lg bg-muted/50 border px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Matching declarations</span>
            <div className="flex items-center gap-2">
              <Badge variant={isOverLimit ? "destructive" : "secondary"} className="text-sm">
                {rowCount.toLocaleString()}
              </Badge>
              {isOverLimit && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Capped at {limit.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exportMutation.isPending || rowCount === 0}
            className="gap-2"
          >
            {exportMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export {format.toUpperCase()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
