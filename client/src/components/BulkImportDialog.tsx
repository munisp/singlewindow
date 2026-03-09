/**
 * BulkImportDialog — Sprint 22
 *
 * Allows traders to upload a CSV file to create up to 200 draft declarations.
 * Shows progress and a per-row error report after processing.
 *
 * Required CSV columns:
 *   hsCode, goodsDescription, portOfEntry, countryOfOrigin,
 *   invoiceValue, invoiceCurrency, grossWeight, numberOfPackages
 * Optional: netWeight, countryOfDestination
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle, Upload, FileText, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_CSV = [
  "hsCode,goodsDescription,portOfEntry,countryOfOrigin,invoiceValue,invoiceCurrency,grossWeight,numberOfPackages,netWeight,countryOfDestination",
  "0901.11,Green Coffee Beans,TEMA,ETH,45000,USD,20000,200,19500,GHA",
  "8471.30,Laptop Computers,KOTOKA,CHN,120000,USD,500,50,480,GHA",
].join("\r\n");

interface ImportResult {
  row: number;
  success: boolean;
  declarationNumber?: string;
  error?: string;
}

interface Props {
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function BulkImportDialog({ trigger, onSuccess }: Props) {
  const [open, setOpen] = useState(false);
  const [csvContent, setCsvContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [summary, setSummary] = useState<{
    total: number;
    successCount: number;
    errorCount: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const importMutation = trpc.bulkExport.importDeclarations.useMutation({
    onSuccess: (data) => {
      setResults(data.results);
      setSummary({
        total: data.total,
        successCount: data.successCount,
        errorCount: data.errorCount,
      });
      if (data.successCount > 0) {
        utils.declarations.myDeclarations.invalidate();
        utils.declarations.stats.invalidate();
        toast.success(
          `${data.successCount} declaration${data.successCount !== 1 ? "s" : ""} imported as drafts`
        );
        onSuccess?.();
      }
      if (data.errorCount > 0) {
        toast.warning(`${data.errorCount} row${data.errorCount !== 1 ? "s" : ""} failed — see error report`);
      }
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      toast.error("File too large — maximum 5 MB");
      return;
    }
    setFileName(file.name);
    setResults(null);
    setSummary(null);
    const reader = new FileReader();
    reader.onload = (ev) => setCsvContent(ev.target?.result as string);
    reader.readAsText(file);
  }

  function handleImport() {
    if (!csvContent) return;
    importMutation.mutate({ csvContent });
  }

  function handleReset() {
    setCsvContent(null);
    setFileName(null);
    setResults(null);
    setSummary(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bulk-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const rowCount = csvContent
    ? csvContent.split(/\r?\n/).filter((l) => l.trim()).length - 1
    : 0;

  const isPending = importMutation.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) handleReset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-1.5">
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk Declaration Import
          </DialogTitle>
          <DialogDescription>
            Upload a CSV file to create multiple draft declarations at once. Maximum 200 rows per upload.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Template download */}
          <Alert>
            <FileText className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between gap-2">
              <span className="text-sm">
                Download the CSV template to see required column names and example data.
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={downloadTemplate}
                className="gap-1.5 shrink-0"
              >
                <Download className="h-3 w-3" /> Template
              </Button>
            </AlertDescription>
          </Alert>

          {/* File picker */}
          {!summary && (
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-8 w-8 text-muted-foreground/50 mx-auto mb-2" />
              {fileName ? (
                <div>
                  <p className="text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {rowCount} data row{rowCount !== 1 ? "s" : ""} detected
                    {rowCount > 200 && (
                      <span className="text-destructive ml-1">(max 200)</span>
                    )}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium">Click to select a CSV file</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports .csv files up to 5 MB
                  </p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>
          )}

          {/* Processing indicator */}
          {isPending && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Processing {rowCount} row{rowCount !== 1 ? "s" : ""}…
              </span>
            </div>
          )}

          {/* Results summary */}
          {summary && (
            <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/50">
              <div className="flex items-center gap-1.5 text-emerald-600">
                <CheckCircle className="h-4 w-4" />
                <span className="text-sm font-medium">{summary.successCount} imported</span>
              </div>
              {summary.errorCount > 0 && (
                <div className="flex items-center gap-1.5 text-destructive">
                  <XCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">{summary.errorCount} failed</span>
                </div>
              )}
              <span className="text-xs text-muted-foreground ml-auto">
                {summary.total} total rows
              </span>
            </div>
          )}

          {/* Per-row error report */}
          {results && results.some((r) => !r.success) && (
            <div>
              <p className="text-sm font-medium mb-2 text-destructive">Error Report</p>
              <ScrollArea className="h-40 rounded border">
                <div className="p-2 space-y-1">
                  {results
                    .filter((r) => !r.success)
                    .map((r) => (
                      <div key={r.row} className="flex items-start gap-2 text-xs">
                        <Badge variant="destructive" className="text-xs shrink-0">
                          Row {r.row}
                        </Badge>
                        <span className="text-muted-foreground">{r.error}</span>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Successful imports (collapsible) */}
          {results && results.some((r) => r.success) && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                View {results.filter((r) => r.success).length} imported declaration numbers
              </summary>
              <ScrollArea className="h-32 mt-2 rounded border">
                <div className="p-2 space-y-1">
                  {results
                    .filter((r) => r.success)
                    .map((r) => (
                      <div key={r.row} className="flex items-center gap-2">
                        <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" />
                        <span className="font-mono">{r.declarationNumber}</span>
                        <span className="text-muted-foreground">row {r.row}</span>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </details>
          )}
        </div>

        <DialogFooter className="gap-2">
          {summary ? (
            <>
              <Button variant="outline" onClick={handleReset}>
                Import Another File
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={!csvContent || isPending || rowCount === 0 || rowCount > 200}
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Importing…
                  </>
                ) : (
                  `Import ${rowCount > 0 ? `${rowCount} Row${rowCount !== 1 ? "s" : ""}` : ""}`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
