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
import { ShieldAlert, Upload, RefreshCw, AlertTriangle, CheckCircle, SkipForward, GitMerge, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const [conflictBatchId, setConflictBatchId] = useState<number | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<Record<number, "overwrite" | "skip" | "merge">>({});

  const { data: jobs, isLoading, refetch } = trpc.sanctionsBatch.list.useQuery();

  const createMutation = trpc.sanctionsBatch.create.useMutation({
    onSuccess: () => {
      utils.sanctionsBatch.list.invalidate();
      toast.success("Batch job submitted — processing will begin shortly");
      setUploading(false);
    },
    onError: (e) => { toast.error(e.message); setUploading(false); },
  });

  const { data: conflicts } = trpc.sanctionsBatch.listConflicts.useQuery(
    { batchId: conflictBatchId! },
    { enabled: conflictBatchId !== null }
  );

  const resolveConflictMutation = trpc.sanctionsBatch.bulkResolveConflicts.useMutation({
    onSuccess: () => {
      utils.sanctionsBatch.list.invalidate();
      setConflictBatchId(null);
      setConflictResolutions({});
      toast.success("All conflicts resolved");
    },
    onError: (e: any) => toast.error(e.message),
  });

  function setAllResolution(action: "overwrite" | "skip" | "merge") {
    if (!conflicts) return;
    const all: Record<number, "overwrite" | "skip" | "merge"> = {};
    conflicts.forEach(c => { all[c.id] = action; });
    setConflictResolutions(all);
  }

  const singleResolveMutation = trpc.sanctionsBatch.resolveConflict.useMutation();

  async function handleResolve() {
    if (!conflictBatchId || !conflicts) return;
    try {
      for (const c of conflicts) {
        const resolution = conflictResolutions[c.id] ?? "skip";
        await singleResolveMutation.mutateAsync({ conflictId: c.id, resolution });
      }
      utils.sanctionsBatch.list.invalidate();
      setConflictBatchId(null);
      setConflictResolutions({});
      toast.success(`${conflicts.length} conflict(s) resolved`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to resolve conflicts");
    }
  }

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
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Conflicts</th>
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
                        <td className="px-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-xs h-7 text-amber-600 border-amber-500/40 hover:bg-amber-500/10 gap-1"
                              onClick={() => { setConflictBatchId(job.id); setConflictResolutions({}); }}
                            >
                              <AlertTriangle size={12} />
                              Conflicts
                            </Button>
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

      {/* Conflict Resolution Dialog */}
      <Dialog open={conflictBatchId !== null} onOpenChange={() => { setConflictBatchId(null); setConflictResolutions({}); }}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              Resolve Sanctions Conflicts
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto space-y-3 py-2">
            {/* Bulk action bar */}
            <div className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border">
              <span className="text-xs text-muted-foreground font-medium mr-1">Apply to all:</span>
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-emerald-600 border-emerald-500/40" onClick={() => setAllResolution("overwrite")}>
                <CheckCircle size={11} /> Overwrite All
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-slate-500" onClick={() => setAllResolution("skip")}>
                <SkipForward size={11} /> Skip All
              </Button>
              <Button size="sm" variant="outline" className="text-xs h-7 gap-1 text-blue-600 border-blue-500/40" onClick={() => setAllResolution("merge")}>
                <GitMerge size={11} /> Merge All
              </Button>
            </div>
            {/* Conflict rows */}
            {(conflicts ?? []).map((c) => {
              const chosen = conflictResolutions[c.id] ?? "skip";
              return (
                <div key={c.id} className="border border-border rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/20 border-b border-border">
                    <span className="text-xs font-semibold text-foreground">{c.entityName}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">#{c.id}</span>
                  </div>
                  <Tabs value={chosen} onValueChange={v => setConflictResolutions(prev => ({ ...prev, [c.id]: v as any }))}>
                    <div className="px-3 pt-2">
                      <TabsList className="h-7 text-xs">
                        <TabsTrigger value="overwrite" className="text-xs h-6 gap-1"><CheckCircle size={10} />Overwrite</TabsTrigger>
                        <TabsTrigger value="skip" className="text-xs h-6 gap-1"><SkipForward size={10} />Skip</TabsTrigger>
                        <TabsTrigger value="merge" className="text-xs h-6 gap-1"><GitMerge size={10} />Merge</TabsTrigger>
                      </TabsList>
                    </div>
                    <TabsContent value="overwrite" className="px-3 pb-3 pt-1">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground font-medium mb-1">Existing Record</p>
                          <pre className="bg-muted/30 rounded p-2 text-[10px] overflow-auto max-h-20">{JSON.stringify(c.existingData, null, 2)}</pre>
                        </div>
                        <div>
                          <p className="text-emerald-600 font-medium mb-1">Incoming (will replace)</p>
                          <pre className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2 text-[10px] overflow-auto max-h-20">{JSON.stringify(c.incomingData, null, 2)}</pre>
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="skip" className="px-3 pb-3 pt-1">
                      <p className="text-xs text-muted-foreground">The existing record will be kept unchanged. The incoming entry will be discarded.</p>
                    </TabsContent>
                    <TabsContent value="merge" className="px-3 pb-3 pt-1">
                      <p className="text-xs text-muted-foreground mb-2">Non-null fields from the incoming record will be merged into the existing record. Existing values are preserved where the incoming field is null.</p>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="text-muted-foreground font-medium mb-1">Existing</p>
                          <pre className="bg-muted/30 rounded p-2 text-[10px] overflow-auto max-h-20">{JSON.stringify(c.existingData, null, 2)}</pre>
                        </div>
                        <div>
                          <p className="text-blue-600 font-medium mb-1">Incoming (merge source)</p>
                          <pre className="bg-blue-500/5 border border-blue-500/20 rounded p-2 text-[10px] overflow-auto max-h-20">{JSON.stringify(c.incomingData, null, 2)}</pre>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                </div>
              );
            })}
          </div>
          <DialogFooter className="border-t border-border pt-3">
            <Button variant="outline" size="sm" onClick={() => { setConflictBatchId(null); setConflictResolutions({}); }}>Cancel</Button>
            <Button
              size="sm"
              className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
              disabled={resolveConflictMutation.isPending || !conflicts || conflicts.length === 0}
              onClick={handleResolve}
            >
              {resolveConflictMutation.isPending ? "Resolving…" : `Apply ${(conflicts ?? []).length} Resolutions`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
