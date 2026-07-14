/**
 * Sanctions Batch Upload — admin bulk CSV screening
 * Sprint 136: Item 5
 */
import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert, Upload, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLOR: Record<string, string> = {
  pending:    "bg-amber-500/15 text-amber-600 border-amber-500/30",
  processing: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  completed:  "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  failed:     "bg-red-500/15 text-red-600 border-red-500/30",
};

export default function SanctionsBatchUpload() {
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const { data: jobs, isLoading, refetch } = trpc.sanctionsBatch.list.useQuery();

  const createMutation = trpc.sanctionsBatch.create.useMutation({
    onSuccess: () => {
      utils.sanctionsBatch.list.invalidate();
      toast.success("Batch job submitted — processing will begin shortly");
      setUploading(false);
    },
    onError: (e) => { toast.error(e.message); setUploading(false); },
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) { toast.error("Only CSV files are supported"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("File must be under 5 MB"); return; }
    setUploading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      // Estimate row count from file size
      const estimatedRows = Math.floor(file.size / 80);
      createMutation.mutate({ fileName: file.name, fileBase64: base64, totalRows: estimatedRows });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldAlert size={22} className="text-[#D4A017]" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Sanctions Batch Screening</h1>
            <p className="text-sm text-muted-foreground">Upload a CSV of entity names/IDs for bulk sanctions list screening</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw size={14} />
            Refresh
          </Button>
          <Button
            size="sm"
            className="gap-1.5 bg-[#D4A017] hover:bg-[#B8860B] text-black"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={14} />
            {uploading ? "Uploading…" : "Upload CSV"}
          </Button>
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      {/* Format hint */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 px-4">
          <p className="text-xs text-blue-600 font-medium mb-1">Expected CSV Format</p>
          <p className="text-xs text-muted-foreground font-mono">entity_name,entity_type,country,identifier</p>
          <p className="text-xs text-muted-foreground mt-1">Max 5 MB · UTF-8 encoded · First row must be header</p>
        </CardContent>
      </Card>

      {/* Jobs table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Batch Jobs
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading jobs…</div>
          ) : !jobs || jobs.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No batch jobs submitted yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">File</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Progress</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Matches</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Submitted</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Completed</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => {
                    const pct = job.totalRows && job.totalRows > 0
                      ? Math.round(((job.processedRows ?? 0) / job.totalRows) * 100)
                      : 0;
                    return (
                      <tr key={job.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground text-xs">{job.fileName}</p>
                          {job.errorMessage && (
                            <p className="text-xs text-red-500 mt-0.5">{job.errorMessage}</p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLOR[job.status] ?? ""}`}>
                            {job.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Progress value={pct} className="w-20 h-1.5" />
                            <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {job.processedRows ?? 0}/{job.totalRows ?? 0} rows
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(job.matchCount ?? 0) > 0 ? (
                            <span className="text-red-500 font-semibold text-sm">{job.matchCount}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">{job.matchCount ?? 0}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {new Date(job.createdAt).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                          {job.completedAt ? new Date(job.completedAt).toLocaleString() : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
