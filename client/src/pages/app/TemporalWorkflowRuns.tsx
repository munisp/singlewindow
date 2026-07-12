/**
 * Temporal Workflow Runs Admin Page — Sprint v83
 * Monitor, filter, and re-trigger Temporal workflow runs.
 * v83: Typed retrigger form driven by workflow_input_schemas registry.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCw, Play, CheckCircle2, XCircle, Clock, AlertTriangle, Activity, BookOpen, Save, RotateCcw, Copy, Check, History, Undo2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const STATUS_COLORS: Record<string, string> = {
  running: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  completed: "bg-green-500/10 text-green-400 border-green-500/30",
  failed: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  timed_out: "bg-amber-500/10 text-amber-400 border-amber-500/30",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  running: <Activity className="w-3 h-3" />,
  completed: <CheckCircle2 className="w-3 h-3" />,
  failed: <XCircle className="w-3 h-3" />,
  cancelled: <XCircle className="w-3 h-3" />,
  timed_out: <Clock className="w-3 h-3" />,
};

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Render a simple typed form from a JSON Schema object */
function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>;
  value: string;
  onChange: (v: string) => void;
}) {
  const props = (schema.properties as Record<string, { type?: string; description?: string; default?: unknown; enum?: string[] }>) ?? {};
  const required = (schema.required as string[]) ?? [];

  // If schema has no properties, fall back to raw textarea
  if (Object.keys(props).length === 0) {
    return (
      <Textarea
        className="font-mono text-xs h-32"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{}"
      />
    );
  }

  // Parse current value into an object for field binding
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(value || "{}"); } catch { /* ignore */ }

  const update = (key: string, val: unknown) => {
    const next = { ...parsed, [key]: val };
    onChange(JSON.stringify(next, null, 2));
  };

  return (
    <div className="space-y-3">
      {Object.entries(props).map(([key, def]) => {
        const isRequired = required.includes(key);
        const currentVal = parsed[key] ?? def.default ?? "";
        return (
          <div key={key} className="space-y-1">
            <label className="text-xs font-medium text-foreground flex items-center gap-1">
              {key}
              {isRequired && <span className="text-red-400">*</span>}
              {def.type && <span className="text-muted-foreground font-normal">({def.type})</span>}
            </label>
            {def.description && <p className="text-xs text-muted-foreground">{def.description}</p>}
            {def.enum ? (
              <Select
                value={String(currentVal)}
                onValueChange={(v) => update(key, v)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {def.enum.map((opt) => (
                    <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : def.type === "boolean" ? (
              <Select
                value={String(currentVal)}
                onValueChange={(v) => update(key, v === "true")}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true" className="text-xs">true</SelectItem>
                  <SelectItem value="false" className="text-xs">false</SelectItem>
                </SelectContent>
              </Select>
            ) : def.type === "integer" || def.type === "number" ? (
              <input
                type="number"
                className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                value={String(currentVal)}
                onChange={(e) => update(key, def.type === "integer" ? parseInt(e.target.value) : parseFloat(e.target.value))}
              />
            ) : def.type === "array" ? (
              <Textarea
                className="font-mono text-xs h-16"
                value={Array.isArray(currentVal) ? JSON.stringify(currentVal) : String(currentVal)}
                onChange={(e) => {
                  try { update(key, JSON.parse(e.target.value)); } catch { update(key, e.target.value); }
                }}
                placeholder="[]"
              />
            ) : (
              <input
                type="text"
                className="flex h-8 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm"
                value={String(currentVal)}
                onChange={(e) => update(key, e.target.value)}
              />
            )}
          </div>
        );
      })}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw JSON</summary>
        <Textarea
          className="font-mono text-xs h-24 mt-1"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </details>
    </div>
  );
}

/** Schema editor state for a single workflow type */
function SchemaEditorRow({ schema, onSave }: {
  schema: { workflowType: string; description?: string | null; jsonSchema: unknown; version: number; isActive: boolean };
  onSave: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState(JSON.stringify(schema.jsonSchema, null, 2));
  const [desc, setDesc] = useState(schema.description ?? "");
  const [version, setVersion] = useState(String(schema.version));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyQuery = trpc.workflowSchemas.getVersionHistory.useQuery(
    { workflowType: schema.workflowType },
    { enabled: historyOpen }
  );
  const restoreMutation = trpc.workflowSchemas.restoreVersion.useMutation({
    onSuccess: () => { toast({ title: "Version restored" }); onSave(); setHistoryOpen(false); },
    onError: (err) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }),
  });

  const isDirty = draft !== JSON.stringify(schema.jsonSchema, null, 2) || desc !== (schema.description ?? "") || version !== String(schema.version);

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      toast({ title: "Copied!", description: `JSON schema for ${schema.workflowType} copied to clipboard.` });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", description: "Clipboard access denied.", variant: "destructive" });
    }
  };

  const upsertMutation = trpc.workflowSchemas.upsertSchema.useMutation({
    onSuccess: () => {
      toast({ title: "Schema saved", description: `${schema.workflowType} v${version} updated.` });
      onSave();
    },
    onError: (err) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const handleSave = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(draft);
      setJsonError(null);
    } catch {
      setJsonError("Invalid JSON");
      return;
    }
    upsertMutation.mutate({
      workflowType: schema.workflowType,
      jsonSchema: parsed,
      description: desc || undefined,
      version: parseInt(version) || schema.version,
      isActive: schema.isActive,
    });
  };

  return (
    <>
    <Card className="bg-card border-border">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-mono text-sm font-semibold text-foreground">{schema.workflowType}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc || "No description"}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              v{schema.version}
            </Badge>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setHistoryOpen(true)}>
              <History className="w-3 h-3 mr-1" />
              History
            </Button>
            {isDirty && (
              <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={upsertMutation.isPending}>
                {upsertMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                Save
              </Button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Description</label>
            <Input className="h-8 text-xs" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Version (new version = new row)</label>
            <Input className="h-8 text-xs" type="number" value={version} onChange={(e) => setVersion(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">JSON Schema</label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={handleCopyJson}
            >
              {copied ? <Check className="w-3 h-3 mr-1 text-green-400" /> : <Copy className="w-3 h-3 mr-1" />}
              {copied ? "Copied!" : "Copy JSON"}
            </Button>
          </div>
          <Textarea
            className={`font-mono text-xs h-40 ${jsonError ? "border-red-500" : ""}`}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setJsonError(null); }}
          />
          {jsonError && <p className="text-xs text-red-400">{jsonError}</p>}
        </div>
      </CardContent>
    </Card>
    <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
      <SheetContent className="w-[480px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm">Version History — {schema.workflowType}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : (historyQuery.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No version history available.</p>
          ) : (
            (historyQuery.data ?? []).map((v) => (
              <div key={v.id} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-foreground">v{v.version}</span>
                    {v.description && <span className="ml-2 text-xs text-muted-foreground">{v.description}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{new Date(v.updatedAt).toLocaleString()}</span>
                    {v.version !== schema.version ? (
                      <Button size="sm" variant="outline" className="h-6 text-xs"
                        onClick={() => restoreMutation.mutate({ workflowType: schema.workflowType, version: v.version })}
                        disabled={restoreMutation.isPending}>
                        <Undo2 className="w-3 h-3 mr-1" />Restore
                      </Button>
                    ) : (
                      <Badge variant="outline" className="text-xs h-6">Current</Badge>
                    )}
                  </div>
                </div>
                <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto max-h-32">{JSON.stringify(v.jsonSchema, null, 2)}</pre>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

export default function TemporalWorkflowRuns() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("runs");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [page, setPage] = useState(0);
  const [retriggerTarget, setRetriggerTarget] = useState<{ runId: string; workflowType: string; input?: Record<string, unknown> } | null>(null);
  const [editedInput, setEditedInput] = useState<string>("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [showInputHistory, setShowInputHistory] = useState(false);
  const PAGE_SIZE = 20;

  const statsQuery = trpc.temporalRuns.getWorkflowStats.useQuery();
  const typesQuery = trpc.temporalRuns.getWorkflowTypes.useQuery();
  const runsQuery = trpc.temporalRuns.getWorkflowRuns.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    status: statusFilter !== "ALL" ? (statusFilter as any) : undefined,
    workflowType: typeFilter !== "ALL" ? typeFilter : undefined,
  });

  const inputHistoryQuery = trpc.temporalRuns.getWorkflowInputHistory.useQuery(
    { workflowType: retriggerTarget?.workflowType ?? "", limit: 5 },
    { enabled: !!retriggerTarget?.workflowType && showInputHistory }
  );
  const schemaQuery = trpc.workflowSchemas.getSchemaForType.useQuery(
    { workflowType: retriggerTarget?.workflowType ?? "" },
    { enabled: !!retriggerTarget?.workflowType }
  );

  // Initialise editedInput when dialog opens
  useEffect(() => {
    if (retriggerTarget) {
      setEditedInput(JSON.stringify(retriggerTarget.input ?? {}, null, 2));
      setInputError(null);
    }
  }, [retriggerTarget?.runId]);

  const retriggerMutation = trpc.temporalRuns.retriggerWorkflow.useMutation({
    onSuccess: (data) => {
      toast({ title: "Workflow re-triggered", description: data.message });
      setRetriggerTarget(null);
      setEditedInput("");
      runsQuery.refetch();
    },
    onError: (err) => {
      toast({ title: "Re-trigger failed", description: err.message, variant: "destructive" });
    },
  });

  const handleConfirmRetrigger = () => {
    if (!retriggerTarget) return;
    let parsedInput: Record<string, unknown> | undefined;
    try {
      parsedInput = editedInput.trim() ? JSON.parse(editedInput) : undefined;
      setInputError(null);
    } catch {
      setInputError("Invalid JSON — please fix the input before re-triggering.");
      return;
    }
    retriggerMutation.mutate({
      runId: retriggerTarget.runId,
      workflowType: retriggerTarget.workflowType,
      input: parsedInput,
    });
  };

  const schemasQuery = trpc.workflowSchemas.listWorkflowTypes.useQuery(undefined, {
    enabled: activeTab === "schemas",
  });

  const stats = statsQuery.data;
  const runs = runsQuery.data?.runs ?? [];
  const total = runsQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Temporal Workflow Runs</h1>
          <p className="text-sm text-muted-foreground mt-1">Monitor durable workflow executions across all queues</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => runsQuery.refetch()} disabled={runsQuery.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-2 ${runsQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="runs">Workflow Runs</TabsTrigger>
          <TabsTrigger value="schemas">Manage Schemas</TabsTrigger>
        </TabsList>

        <TabsContent value="runs" className="space-y-4 mt-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Running", value: stats?.running, color: "text-blue-400", icon: <Activity className="w-4 h-4" /> },
          { label: "Completed", value: stats?.completed, color: "text-green-400", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "Failed", value: stats?.failed, color: "text-red-400", icon: <XCircle className="w-4 h-4" /> },
          { label: "Timed Out", value: stats?.timedOut, color: "text-amber-400", icon: <Clock className="w-4 h-4" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <span className={s.color}>{s.icon}</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>
                {statsQuery.isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (s.value ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            {["running", "completed", "failed", "cancelled", "timed_out"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ").toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Workflow Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            {(typesQuery.data ?? []).map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-muted-foreground self-center ml-auto">
          {total} run{total !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border">
                <TableHead>Workflow Type</TableHead>
                <TableHead>Run ID</TableHead>
                <TableHead>Task Queue</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runsQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No workflow runs found
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id} className="border-border hover:bg-muted/30">
                    <TableCell className="font-medium text-sm">{run.workflowType}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground truncate max-w-[140px]" title={run.runId}>
                      {run.runId.slice(0, 16)}…
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{run.taskQueue}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`text-xs gap-1 ${STATUS_COLORS[run.status] ?? ""}`}>
                        {STATUS_ICONS[run.status]}
                        {run.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDuration(run.durationMs)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {(run.status === "failed" || run.status === "timed_out") && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-amber-400 hover:text-amber-300"
                          onClick={() => setRetriggerTarget({
                            runId: run.runId,
                            workflowType: run.workflowType,
                            input: (run as any).input ?? undefined,
                          })}
                          disabled={retriggerMutation.isPending}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Re-trigger
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-sm text-muted-foreground self-center">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}

        </TabsContent>

        <TabsContent value="schemas" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Workflow Input Schema Registry</h2>
              <p className="text-sm text-muted-foreground">Edit JSON schemas that drive the typed retrigger form. Increment version to create a new revision.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => schemasQuery.refetch()} disabled={schemasQuery.isFetching}>
              <RefreshCw className={`w-4 h-4 mr-2 ${schemasQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {schemasQuery.isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
          ) : (schemasQuery.data ?? []).length === 0 ? (
            <Card className="bg-card border-border">
              <CardContent className="py-12 text-center text-muted-foreground">
                No schemas registered. Schemas are seeded automatically on first use.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {(schemasQuery.data ?? []).map((s) => (
                <SchemaEditorRow
                  key={s.workflowType}
                  schema={s}
                  onSave={() => schemasQuery.refetch()}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Re-trigger Confirmation AlertDialog — typed form from schema registry */}
      <AlertDialog
        open={!!retriggerTarget}
        onOpenChange={(open) => { if (!open) { setRetriggerTarget(null); setEditedInput(""); setInputError(null); } }}
      >
        <AlertDialogContent className="max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Re-trigger Workflow Run?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  This will submit a <strong>new execution</strong> of{" "}
                  <span className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">
                    {retriggerTarget?.workflowType}
                  </span>{" "}
                  to the Temporal task queue. The original failed run will not be modified.
                </p>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Original Run ID:</span>{" "}
                  <span className="font-mono">{retriggerTarget?.runId}</span>
                </div>

                {/* Schema description */}
                {schemaQuery.data?.description && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded p-2">
                    <BookOpen className="w-3.5 h-3.5 mt-0.5 shrink-0 text-blue-400" />
                    <span>{schemaQuery.data.description}</span>
                  </div>
                )}

                {/* Typed input form */}
                <div>
                  <p className="text-xs font-medium text-foreground mb-2">
                    Input Payload
                    {schemaQuery.isLoading && <Loader2 className="w-3 h-3 animate-spin inline ml-1" />}
                  </p>
                  {schemaQuery.data?.jsonSchema ? (
                    <SchemaForm
                      schema={schemaQuery.data.jsonSchema as Record<string, unknown>}
                      value={editedInput}
                      onChange={(v) => { setEditedInput(v); setInputError(null); }}
                    />
                  ) : (
                    <Textarea
                      className="font-mono text-xs h-32"
                      value={editedInput}
                      onChange={(e) => { setEditedInput(e.target.value); setInputError(null); }}
                      placeholder="{}"
                    />
                  )}
                  {inputError && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> {inputError}
                    </p>
                  )}
                </div>

                {/* Input History */}
                <div>
                  <button
                    type="button"
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                    onClick={() => setShowInputHistory((v) => !v)}
                  >
                    <History className="w-3 h-3" />
                    {showInputHistory ? "Hide" : "Show"} recent input history
                  </button>
                  {showInputHistory && (
                    <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                      {inputHistoryQuery.isLoading ? (
                        <p className="text-xs text-muted-foreground">Loading…</p>
                      ) : (inputHistoryQuery.data ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">No previous inputs found.</p>
                      ) : (
                        (inputHistoryQuery.data ?? []).map((h: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 bg-muted/40 rounded p-2">
                            <pre className="text-xs font-mono text-muted-foreground flex-1 whitespace-pre-wrap">{JSON.stringify(h.input, null, 2)}</pre>
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline shrink-0"
                              onClick={() => { setEditedInput(JSON.stringify(h.input, null, 2)); setInputError(null); }}
                            >Use</button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Duplicate runs may cause side effects if the workflow is not idempotent.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={retriggerMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleConfirmRetrigger}
              disabled={retriggerMutation.isPending || !!inputError}
            >
              {retriggerMutation.isPending
                ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Re-triggering…</>
                : <><Play className="w-4 h-4 mr-2" />Confirm Re-trigger</>}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}