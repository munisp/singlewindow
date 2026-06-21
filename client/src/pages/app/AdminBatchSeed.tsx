/**
 * TradeGateway NGSWTP — Admin Batch Seed UI (PWA)
 * Sprint v67 — Batch TigerBeetle account seeding
 *
 * Allows admins to seed TigerBeetle accounts for multiple traders at once.
 * Input: newline-separated trader IDs in a textarea
 * Output: progress bar + per-trader result summary table
 */
import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Database, Play, RotateCcw, CheckCircle2, XCircle, Loader2, Shield } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type SeedStatus = "pending" | "running" | "success" | "error";

interface TraderSeedResult {
  traderId: string;
  status: SeedStatus;
  message?: string;
  accounts?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminBatchSeed() {
  const { user } = useAuth();
  const [input, setInput] = useState("");
  const [results, setResults] = useState<TraderSeedResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(false);

  const seedTraderMutation = trpc.tigerbeetleSeed.seedTraderAccounts.useMutation();

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Shield className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-40" />
            <h2 className="text-xl font-semibold">Access Restricted</h2>
            <p className="text-muted-foreground mt-2">Batch Seed is only available to administrators.</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const parseTraderIds = (raw: string): string[] => {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  };

  const handleRun = async () => {
    const traderIds = parseTraderIds(input);
    if (traderIds.length === 0) {
      toast.error("No trader IDs", { description: "Enter at least one trader ID." });
      return;
    }
    if (traderIds.length > 500) {
      toast.error("Too many IDs", { description: "Maximum 500 trader IDs per batch." });
      return;
    }

    abortRef.current = false;
    setIsRunning(true);
    setProgress(0);
    setResults(traderIds.map((id) => ({ traderId: id, status: "pending" })));

    let completed = 0;
    for (const traderId of traderIds) {
      if (abortRef.current) break;

      setResults((prev) =>
        prev.map((r) => (r.traderId === traderId ? { ...r, status: "running" } : r))
      );

      try {
        const result = await seedTraderMutation.mutateAsync({ traderId });
        setResults((prev) =>
          prev.map((r) =>
            r.traderId === traderId
              ? { ...r, status: "success", message: "Seeded successfully", accounts: (result as any)?.accountsCreated ?? 4 }
              : r
          )
        );
      } catch (err: any) {
        setResults((prev) =>
          prev.map((r) =>
            r.traderId === traderId
              ? { ...r, status: "error", message: err?.message ?? "Unknown error" }
              : r
          )
        );
      }

      completed++;
      setProgress(Math.round((completed / traderIds.length) * 100));
    }

    setIsRunning(false);
    if (!abortRef.current) {
      const successCount = results.filter((r) => r.status === "success").length + 1;
      toast.success("Batch complete", {
        description: `${completed} traders processed.`,
      });
    }
  };

  const handleAbort = () => {
    abortRef.current = true;
    setIsRunning(false);
    toast.warning("Batch aborted");
  };

  const handleReset = () => {
    setResults([]);
    setProgress(0);
    setInput("");
  };

  const traderIds = parseTraderIds(input);
  const successCount = results.filter((r) => r.status === "success").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  const pendingCount = results.filter((r) => r.status === "pending").length;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Database className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Batch Trader Account Seed</h1>
            <p className="text-sm text-muted-foreground">
              Seed TigerBeetle accounts for multiple traders at once (max 500 per batch)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Trader IDs</CardTitle>
              <CardDescription>
                Enter one trader ID per line (or comma/semicolon separated).
                Each trader gets 4 TigerBeetle accounts (duty, bonds, transit, drawback).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="trader-ids">Trader IDs</Label>
                <Textarea
                  id="trader-ids"
                  placeholder={"TRD-001\nTRD-002\nTRD-003"}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  rows={12}
                  disabled={isRunning}
                  className="font-mono text-sm mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {traderIds.length} trader{traderIds.length !== 1 ? "s" : ""} detected
                </p>
              </div>

              <div className="flex gap-2">
                {!isRunning ? (
                  <Button
                    onClick={handleRun}
                    disabled={traderIds.length === 0}
                    className="flex-1"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Run Batch Seed ({traderIds.length})
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={handleAbort} className="flex-1">
                    <XCircle className="h-4 w-4 mr-2" />
                    Abort
                  </Button>
                )}
                <Button variant="outline" onClick={handleReset} disabled={isRunning}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Progress & Summary Panel */}
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription>Real-time seeding progress and per-trader results</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {results.length > 0 && (
                <>
                  <div className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span>{progress}% complete</span>
                      <span>{successCount + errorCount} / {results.length}</span>
                    </div>
                    <Progress value={progress} className="h-3" />
                  </div>

                  <div className="flex gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                      <span>{successCount} succeeded</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span>{errorCount} failed</span>
                    </div>
                    {pendingCount > 0 && (
                      <div className="flex items-center gap-1">
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span>{pendingCount} pending</span>
                      </div>
                    )}
                  </div>
                </>
              )}

              {results.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Database className="h-12 w-12 mx-auto mb-3 opacity-40" />
                  <p>Enter trader IDs and click Run to begin</p>
                </div>
              ) : (
                <div className="overflow-y-auto max-h-80">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 px-2">Trader ID</th>
                        <th className="text-left py-1.5 px-2">Status</th>
                        <th className="text-left py-1.5 px-2">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r) => (
                        <tr key={r.traderId} className="border-b hover:bg-muted/30">
                          <td className="py-1.5 px-2 font-mono">{r.traderId}</td>
                          <td className="py-1.5 px-2">
                            {r.status === "pending" && (
                              <Badge variant="outline" className="text-xs">Pending</Badge>
                            )}
                            {r.status === "running" && (
                              <Badge className="text-xs bg-blue-500">
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />Running
                              </Badge>
                            )}
                            {r.status === "success" && (
                              <Badge className="text-xs bg-green-600">
                                <CheckCircle2 className="h-3 w-3 mr-1" />Success
                              </Badge>
                            )}
                            {r.status === "error" && (
                              <Badge variant="destructive" className="text-xs">
                                <XCircle className="h-3 w-3 mr-1" />Error
                              </Badge>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-muted-foreground">
                            {r.status === "success" && r.accounts != null
                              ? `${r.accounts} accounts created`
                              : r.message ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
