import { useState, useEffect, useRef } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ScanLine, Plus, Trash2, ChevronDown, ChevronRight,
  Clock, CheckCircle2, AlertCircle, Loader2, FileImage,
  Layers, RefreshCw, Eye,
} from "lucide-react";
import { toast } from "sonner";

const DOC_TYPES = [
  { value: "commercial_invoice", label: "Commercial Invoice" },
  { value: "bill_of_lading", label: "Bill of Lading" },
  { value: "packing_list", label: "Packing List" },
  { value: "certificate_of_origin", label: "Certificate of Origin" },
  { value: "phytosanitary_cert", label: "Phytosanitary Certificate" },
  { value: "import_permit", label: "Import Permit" },
  { value: "export_permit", label: "Export Permit" },
  { value: "insurance_cert", label: "Insurance Certificate" },
  { value: "customs_bond", label: "Customs Bond" },
  { value: "other", label: "Other" },
] as const;

type DocType = typeof DOC_TYPES[number]["value"];

interface DocEntry {
  id: string;
  documentId: string;
  imageUrl: string;
  documentType: DocType;
}

interface BatchJob {
  batchId: string;
  status: string;
  totalDocuments: number;
  processedDocuments: number;
  priority: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface BatchJobStatus {
  batchId: string;
  status: string;
  totalDocuments: number;
  processedDocuments: number;
  progressPct: number;
  results: Array<{ documentId: number; status: string; findings?: string[] }> | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  queued: { label: "Queued", color: "bg-gray-600 text-white", icon: <Clock className="h-3 w-3" /> },
  processing: { label: "Processing", color: "bg-blue-600 text-white", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed: { label: "Completed", color: "bg-green-600 text-white", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", color: "bg-red-600 text-white", icon: <AlertCircle className="h-3 w-3" /> },
  partial: { label: "Partial", color: "bg-yellow-600 text-white", icon: <AlertCircle className="h-3 w-3" /> },
};

const priorityBadge = (p: string) => {
  if (p === "critical") return <Badge className="bg-red-700 text-white text-xs">Critical</Badge>;
  if (p === "high") return <Badge className="bg-orange-600 text-white text-xs">High</Badge>;
  return <Badge variant="outline" className="text-xs">Normal</Badge>;
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? { label: status, color: "bg-gray-500 text-white", icon: null };
  return (
    <Badge className={`${cfg.color} flex items-center gap-1 text-xs`}>
      {cfg.icon} {cfg.label}
    </Badge>
  );
}

export default function VisionBatchAnalysis() {
  const [docs, setDocs] = useState<DocEntry[]>([
    { id: crypto.randomUUID(), documentId: "", imageUrl: "", documentType: "commercial_invoice" },
  ]);
  const [priority, setPriority] = useState<"normal" | "high" | "critical">("normal");
  const [declarationId, setDeclarationId] = useState("");
  const [pollingBatchId, setPollingBatchId] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const utils = trpc.useUtils();
  const { data: jobList, isLoading: loadingJobs, refetch: refetchJobs } = trpc.vision.listBatchJobs.useQuery({ limit: 20 });
  const { data: pollingStatus, refetch: refetchPolling } = trpc.vision.getBatchJobStatus.useQuery(
    { batchId: pollingBatchId! },
    { enabled: !!pollingBatchId, refetchInterval: false }
  );

  const submitMutation = trpc.vision.batchAnalyzeDocuments.useMutation({
    onSuccess: (data) => {
      toast.success(`Batch job submitted — ${data.totalDocuments} documents queued. Est. ${data.estimatedCompletionSeconds}s`);
      setPollingBatchId(data.batchId);
      refetchJobs();
      setDocs([{ id: crypto.randomUUID(), documentId: "", imageUrl: "", documentType: "commercial_invoice" }]);
      setDeclarationId("");
    },
    onError: (e) => toast.error(`Submission failed: ${e.message}`),
  });

  // Polling loop for active job
  useEffect(() => {
    if (!pollingBatchId) return;
    pollingRef.current = setInterval(() => {
      refetchPolling();
    }, 3000);
    return () => { if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [pollingBatchId, refetchPolling]);

  // Stop polling when job completes
  useEffect(() => {
    if (!pollingStatus) return;
    if (pollingStatus.status === "completed" || pollingStatus.status === "failed") {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (pollingStatus.status === "completed") {
        toast.success(`Batch ${pollingBatchId} completed — ${pollingStatus.totalDocuments} documents processed`);
      } else {
        toast.error(`Batch ${pollingBatchId} failed`);
      }
      refetchJobs();
      setPollingBatchId(null);
    }
  }, [pollingStatus, pollingBatchId, refetchJobs]);

  const addDoc = () => {
    if (docs.length >= 50) { toast.error("Maximum 50 documents per batch"); return; }
    setDocs(d => [...d, { id: crypto.randomUUID(), documentId: "", imageUrl: "", documentType: "commercial_invoice" }]);
  };

  const removeDoc = (id: string) => setDocs(d => d.filter(doc => doc.id !== id));
  const updateDoc = (id: string, field: keyof Omit<DocEntry, "id">, value: string) =>
    setDocs(d => d.map(doc => doc.id === id ? { ...doc, [field]: value } : doc));

  const handleSubmit = () => {
    const valid = docs.filter(d => d.documentId && d.imageUrl);
    if (valid.length === 0) { toast.error("At least one document with ID and image URL is required"); return; }
    const invalidUrls = valid.filter(d => { try { new URL(d.imageUrl); return false; } catch { return true; } });
    if (invalidUrls.length > 0) { toast.error("All image URLs must be valid URLs"); return; }
    submitMutation.mutate({
      documents: valid.map(d => ({
        documentId: parseInt(d.documentId),
        imageUrl: d.imageUrl,
        documentType: d.documentType,
      })),
      priority,
      declarationId: declarationId ? parseInt(declarationId) : undefined,
    });
  };

  const toggleExpand = (batchId: string) => {
    setExpandedJobs(s => {
      const next = new Set(s);
      if (next.has(batchId)) next.delete(batchId);
      else next.add(batchId);
      return next;
    });
  };

  const jobs = (jobList?.jobs ?? []) as BatchJob[];
  const activePolling = pollingStatus as BatchJobStatus | undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ScanLine className="h-6 w-6 text-cyan-500" />
              Vision Batch Analysis
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Submit multiple trade documents for parallel OCR and AI vision analysis
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchJobs()} className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        {/* Active polling status */}
        {activePolling && (
          <Card className="border-blue-500 bg-blue-950/20">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                  <span className="text-sm font-medium text-foreground">Processing batch…</span>
                  <span className="font-mono text-xs text-muted-foreground">{activePolling.batchId}</span>
                </div>
                <StatusBadge status={activePolling.status} />
              </div>
              <Progress value={activePolling.progressPct} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{activePolling.processedDocuments} / {activePolling.totalDocuments} documents</span>
                <span>{activePolling.progressPct}% complete</span>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Submit Form */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-400" /> New Batch Job
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Job settings */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Priority</Label>
                  <Select value={priority} onValueChange={v => setPriority(v as typeof priority)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Declaration ID (optional)</Label>
                  <Input
                    type="number"
                    placeholder="12345"
                    value={declarationId}
                    onChange={e => setDeclarationId(e.target.value)}
                  />
                </div>
              </div>

              {/* Document entries */}
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {docs.map((doc, i) => (
                  <div key={doc.id} className="border border-border rounded-lg p-3 space-y-2 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Document {i + 1}</span>
                      {docs.length > 1 && (
                        <button onClick={() => removeDoc(doc.id)} className="text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">Document ID *</Label>
                        <Input
                          type="number"
                          placeholder="101"
                          value={doc.documentId}
                          onChange={e => updateDoc(doc.id, "documentId", e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Type *</Label>
                        <Select value={doc.documentType} onValueChange={v => updateDoc(doc.id, "documentType", v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {DOC_TYPES.map(t => (
                              <SelectItem key={t.value} value={t.value} className="text-xs">{t.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Image URL *</Label>
                      <Input
                        placeholder="https://storage.example.com/doc-101.jpg"
                        value={doc.imageUrl}
                        onChange={e => updateDoc(doc.id, "imageUrl", e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={addDoc} className="flex items-center gap-1 flex-1">
                  <Plus className="h-3.5 w-3.5" /> Add Document
                </Button>
                <Button
                  size="sm"
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                  className="flex-1 flex items-center gap-1"
                >
                  {submitMutation.isPending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Submitting…</>
                  ) : (
                    <><ScanLine className="h-3.5 w-3.5" /> Submit Batch ({docs.filter(d => d.documentId && d.imageUrl).length})</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Stats summary */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: "Total Jobs", value: jobs.length, icon: <Layers className="h-4 w-4 text-cyan-400" /> },
                { label: "Completed", value: jobs.filter(j => j.status === "completed").length, icon: <CheckCircle2 className="h-4 w-4 text-green-400" /> },
                { label: "Processing", value: jobs.filter(j => j.status === "processing" || j.status === "queued").length, icon: <Loader2 className="h-4 w-4 text-blue-400" /> },
                { label: "Documents", value: jobs.reduce((s, j) => s + j.totalDocuments, 0), icon: <FileImage className="h-4 w-4 text-purple-400" /> },
              ].map(s => (
                <Card key={s.label} className="bg-card border-border">
                  <CardContent className="p-4 flex items-center gap-3">
                    {s.icon}
                    <div>
                      <p className="text-2xl font-bold text-foreground">{s.value}</p>
                      <p className="text-xs text-muted-foreground">{s.label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Quick guide */}
            <Card className="bg-muted/30 border-border">
              <CardContent className="p-4 space-y-2">
                <p className="text-xs font-semibold text-foreground">How it works</p>
                <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>Add up to 50 documents with their image URLs</li>
                  <li>Set priority and optional declaration ID</li>
                  <li>Submit — a batch job is queued immediately</li>
                  <li>Progress bar tracks real-time processing</li>
                  <li>Expand any job below to view per-document results</li>
                </ol>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Job list */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="h-4 w-4 text-muted-foreground" /> Recent Batch Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingJobs ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <ScanLine className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No batch jobs yet. Submit your first batch above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {jobs.map(job => {
                  const isExpanded = expandedJobs.has(job.batchId);
                  const pct = job.totalDocuments > 0
                    ? Math.round((job.processedDocuments / job.totalDocuments) * 100)
                    : 0;
                  return (
                    <Collapsible key={job.batchId} open={isExpanded} onOpenChange={() => toggleExpand(job.batchId)}>
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 cursor-pointer transition-colors">
                          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-foreground">{job.batchId}</span>
                              <StatusBadge status={job.status} />
                              {priorityBadge(job.priority)}
                            </div>
                            <div className="flex items-center gap-4 mt-1">
                              <span className="text-xs text-muted-foreground">
                                {job.processedDocuments}/{job.totalDocuments} docs
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {new Date(job.createdAt).toLocaleString()}
                              </span>
                            </div>
                          </div>
                          <div className="w-24 shrink-0">
                            <Progress value={pct} className="h-1.5" />
                            <p className="text-xs text-muted-foreground text-right mt-0.5">{pct}%</p>
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <BatchJobDetail batchId={job.batchId} />
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

function BatchJobDetail({ batchId }: { batchId: string }) {
  const { data, isLoading } = trpc.vision.getBatchJobStatus.useQuery({ batchId });
  const status = data as BatchJobStatus | undefined;

  if (isLoading) {
    return (
      <div className="ml-7 mt-2 p-3 bg-muted/20 rounded-lg">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading details…
        </div>
      </div>
    );
  }

  if (!status) return null;

  return (
    <div className="ml-7 mt-2 p-4 bg-muted/20 rounded-lg border border-border/50 space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Progress</p>
          <p className="font-medium text-foreground">{status.progressPct}%</p>
        </div>
        <div>
          <p className="text-muted-foreground">Processed</p>
          <p className="font-medium text-foreground">{status.processedDocuments} / {status.totalDocuments}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Last Updated</p>
          <p className="font-medium text-foreground">{new Date(status.updatedAt).toLocaleTimeString()}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Status</p>
          <p className="font-medium text-foreground capitalize">{status.status}</p>
        </div>
      </div>

      {status.results && status.results.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-foreground mb-2">Per-Document Results</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1 pr-3">Doc ID</th>
                  <th className="text-left py-1 pr-3">Status</th>
                  <th className="text-left py-1">Findings</th>
                </tr>
              </thead>
              <tbody>
                {status.results.map((r, i) => (
                  <tr key={i} className="border-b border-border/30">
                    <td className="py-1.5 pr-3 font-mono">{r.documentId}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${r.status === "ok" ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 text-muted-foreground">
                      {r.findings?.join(", ") ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          {status.status === "queued" || status.status === "processing"
            ? "Results will appear here as documents are processed…"
            : "No result details available."}
        </p>
      )}
    </div>
  );
}
