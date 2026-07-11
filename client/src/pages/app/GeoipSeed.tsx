import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Globe, Upload, RefreshCw, Database, CheckCircle, XCircle, Clock, Loader2, Activity } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  running: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  completed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock size={12} />,
  running: <Loader2 size={12} className="animate-spin" />,
  completed: <CheckCircle size={12} />,
  failed: <XCircle size={12} />,
};

/** Simulated progress percentage for a job based on status */
function jobProgress(status: string): number {
  if (status === "completed") return 100;
  if (status === "failed") return 100;
  if (status === "running") return 60; // indeterminate — shown as animated
  return 10; // pending
}

export default function GeoipSeed() {
  const { toast } = useToast();
  const [s3Key, setS3Key] = useState("geoip/GeoLite2-City.csv");
  const [filename, setFilename] = useState("GeoLite2-City.csv");

  // Active job being polled after upload
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: statsData, refetch: refetchStats } = trpc.geoip.getGeoipStats.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const { data: jobsData, refetch: refetchJobs } = trpc.geoip.getSeedJobs.useQuery(
    { limit: 20, offset: 0 },
    { refetchInterval: 10_000 }
  );

  // Poll the active job every 2 seconds until terminal state
  const { data: activeJobData, refetch: refetchActiveJob } = trpc.geoip.getSeedJobById.useQuery(
    { jobId: activeJobId! },
    { enabled: !!activeJobId }
  );

  useEffect(() => {
    if (!activeJobId) return;

    pollingRef.current = setInterval(async () => {
      const result = await refetchActiveJob();
      const status = result.data?.status;
      if (status === "completed" || status === "failed") {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        refetchJobs();
        refetchStats();
        if (status === "completed") {
          toast({
            title: "Seed job completed",
            description: `${result.data?.rowsInserted?.toLocaleString() ?? 0} rows inserted successfully.`,
          });
        } else {
          toast({
            title: "Seed job failed",
            description: result.data?.errorMessage ?? "Unknown error",
            variant: "destructive",
          });
        }
        setActiveJobId(null);
      }
    }, 2000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeJobId]);

  const uploadMutation = trpc.geoip.uploadGeoipCsv.useMutation({
    onSuccess: (data) => {
      toast({ title: "Seed job queued", description: `Job ID: ${data.jobId} — polling for progress…` });
      setActiveJobId(data.jobId);
      refetchJobs();
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleUpload = () => {
    if (!s3Key.trim() || !filename.trim()) {
      toast({ title: "Validation error", description: "S3 key and filename are required.", variant: "destructive" });
      return;
    }
    uploadMutation.mutate({ s3Key: s3Key.trim(), filename: filename.trim() });
  };

  const stats = statsData ?? { totalIps: 0, countriesCount: 249, asnsCount: 72000, seedJobs: { total: 0, completed: 0, failed: 0, pending: 0, totalRowsInserted: 0 }, lastSeedAt: null };
  const jobs = jobsData?.jobs ?? [];
  const activeJob = activeJobData ?? null;

  return (
    <div className="p-6 space-y-6 bg-[#0A1628] min-h-screen text-white">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-[#1E3A5F] flex items-center justify-center">
          <Globe size={20} className="text-[#D4A017]" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">GeoIP Seed</h1>
          <p className="text-sm text-slate-400">Upload MaxMind GeoLite2 CSV to populate geolocation cache</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total IPs", value: stats.totalIps.toLocaleString(), icon: <Database size={16} className="text-[#D4A017]" /> },
          { label: "Countries", value: stats.countriesCount?.toLocaleString() ?? "—", icon: <Globe size={16} className="text-blue-400" /> },
          { label: "ASNs", value: stats.asnsCount?.toLocaleString() ?? "—", icon: <Globe size={16} className="text-purple-400" /> },
          { label: "Last Seed", value: stats.lastSeedAt ? new Date(stats.lastSeedAt).toLocaleDateString() : "Never", icon: <Clock size={16} className="text-slate-400" /> },
        ].map((s) => (
          <Card key={s.label} className="bg-[#0D1F35] border-[#1E3A5F]">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-slate-400">{s.label}</span></div>
              <div className="text-xl font-bold text-white">{s.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Active job progress banner */}
      {activeJobId && (
        <Card className="bg-[#0D1F35] border-blue-500/40">
          <CardContent className="pt-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <Activity size={16} className="text-blue-400 animate-pulse" />
              <span className="text-sm font-semibold text-blue-300">Seed job in progress</span>
              <Badge className="ml-auto bg-blue-500/15 text-blue-400 border-blue-500/30 text-xs">
                {activeJob?.status ?? "pending"}
              </Badge>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span className="font-mono">{activeJobId}</span>
                <span>{activeJob?.rowsInserted != null ? `${activeJob.rowsInserted.toLocaleString()} rows inserted` : "Waiting…"}</span>
              </div>
              <Progress
                value={jobProgress(activeJob?.status ?? "pending")}
                className="h-2 bg-[#1E3A5F]"
              />
              <p className="text-xs text-slate-500">
                {activeJob?.status === "running"
                  ? "Processing CSV rows — this may take several minutes for large files."
                  : activeJob?.status === "pending"
                  ? "Job queued, waiting for worker to pick up…"
                  : "Finalising…"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload form */}
      <Card className="bg-[#0D1F35] border-[#1E3A5F]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Upload size={16} className="text-[#D4A017]" />
            Upload GeoLite2 CSV
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-400">
            Upload your GeoLite2-City CSV to S3 first (using the file storage panel), then provide the S3 key below to trigger the seed job.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-slate-400">Filename</label>
              <Input
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="GeoLite2-City.csv"
                className="bg-[#0A1628] border-[#1E3A5F] text-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-slate-400">S3 Key</label>
              <Input
                value={s3Key}
                onChange={(e) => setS3Key(e.target.value)}
                placeholder="geoip/GeoLite2-City.csv"
                className="bg-[#0A1628] border-[#1E3A5F] text-white"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={handleUpload}
              disabled={uploadMutation.isPending || !!activeJobId}
              className="bg-[#D4A017] hover:bg-[#b8891a] text-black font-semibold"
            >
              {uploadMutation.isPending ? <Loader2 size={14} className="animate-spin mr-2" /> : <Upload size={14} className="mr-2" />}
              Queue Seed Job
            </Button>
            <Button
              variant="outline"
              onClick={() => { refetchJobs(); refetchStats(); }}
              className="border-[#1E3A5F] text-slate-300 hover:bg-[#1E3A5F]"
            >
              <RefreshCw size={14} className="mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Seed jobs table */}
      <Card className="bg-[#0D1F35] border-[#1E3A5F]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base text-white flex items-center gap-2">
            <Database size={16} className="text-blue-400" />
            Seed Job History
            <Badge className="ml-auto bg-[#1E3A5F] text-slate-300 border-[#2a4a6f]">
              {jobsData?.total ?? 0} total
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-[#1E3A5F] hover:bg-transparent">
                <TableHead className="text-slate-400 text-xs">Job ID</TableHead>
                <TableHead className="text-slate-400 text-xs">Filename</TableHead>
                <TableHead className="text-slate-400 text-xs">Status</TableHead>
                <TableHead className="text-slate-400 text-xs">Progress</TableHead>
                <TableHead className="text-slate-400 text-xs">Rows Inserted</TableHead>
                <TableHead className="text-slate-400 text-xs">Triggered By</TableHead>
                <TableHead className="text-slate-400 text-xs">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-500 py-8">
                    No seed jobs yet. Upload a GeoLite2 CSV to get started.
                  </TableCell>
                </TableRow>
              ) : (
                jobs.map((job: any) => (
                  <TableRow
                    key={job.jobId}
                    className={`border-[#1E3A5F] hover:bg-[#1E3A5F]/30 ${job.jobId === activeJobId ? "bg-blue-500/5" : ""}`}
                  >
                    <TableCell className="font-mono text-xs text-slate-300">{job.jobId}</TableCell>
                    <TableCell className="text-sm text-white">{job.filename}</TableCell>
                    <TableCell>
                      <Badge className={`text-xs flex items-center gap-1 w-fit border ${STATUS_COLORS[job.status] ?? "bg-slate-500/15 text-slate-400"}`}>
                        {STATUS_ICONS[job.status]}
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="w-28">
                      <Progress
                        value={jobProgress(job.status)}
                        className={`h-1.5 ${job.status === "failed" ? "bg-red-900" : "bg-[#1E3A5F]"}`}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-slate-300">
                      {job.rowsInserted != null ? job.rowsInserted.toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-slate-400">{job.triggeredBy ?? "—"}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {job.createdAt ? new Date(job.createdAt).toLocaleString() : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Seed job stats summary */}
      {stats.seedJobs && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Jobs", value: stats.seedJobs.total, color: "text-white" },
            { label: "Completed", value: stats.seedJobs.completed, color: "text-emerald-400" },
            { label: "Failed", value: stats.seedJobs.failed, color: "text-red-400" },
            { label: "Pending", value: stats.seedJobs.pending, color: "text-yellow-400" },
          ].map((s) => (
            <Card key={s.label} className="bg-[#0D1F35] border-[#1E3A5F]">
              <CardContent className="pt-4 pb-3 text-center">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-slate-400 mt-1">{s.label}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
