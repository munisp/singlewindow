/**
 * Phase 22 — Declaration Risk History
 * UI for the previously orphaned `declarationRiskHistory` tRPC router:
 * risk-score timeline for a declaration (traders see their own declarations;
 * officers/admin can view any).
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, AlertTriangle } from "lucide-react";

const LANE_COLORS: Record<string, string> = {
  red: "bg-red-500/20 text-red-600",
  yellow: "bg-yellow-500/20 text-yellow-600",
  green: "bg-green-500/20 text-green-600",
  blue: "bg-blue-500/20 text-blue-600",
};

function scoreColor(score: number): string {
  if (score >= 70) return "text-red-500";
  if (score >= 40) return "text-amber-500";
  return "text-green-500";
}

export default function DeclarationRiskHistory() {
  const [declId, setDeclId] = useState("");
  const [submittedId, setSubmittedId] = useState<number | null>(null);

  const { data: timeline, isLoading, isError, error } = trpc.declarationRiskHistory.getTimeline.useQuery(
    { declarationId: submittedId ?? 0 },
    { enabled: submittedId !== null }
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <History className="w-6 h-6 text-primary" />
            Declaration Risk History
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Timeline of recorded risk scores and lane assignments for a declaration.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Risk Timeline</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const id = Number(declId.trim());
                if (!Number.isInteger(id) || id <= 0) return toast.error("Enter a valid numeric declaration ID");
                setSubmittedId(id);
              }}
            >
              <Input placeholder="Declaration ID…" value={declId} onChange={(e) => setDeclId(e.target.value)} className="w-64" />
              <Button type="submit">Load timeline</Button>
            </form>

            {submittedId !== null && (
              isLoading ? (
                <p className="text-sm text-muted-foreground">Loading risk history…</p>
              ) : isError ? (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {error?.message ?? "Failed to load risk history."}
                </div>
              ) : !timeline || timeline.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risk history has been recorded for declaration #{submittedId}.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Recorded At</TableHead>
                      <TableHead>Risk Score</TableHead>
                      <TableHead>Lane</TableHead>
                      <TableHead>Triggered By</TableHead>
                      <TableHead>Factors</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timeline.map((r: any) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{r.recordedAt ? new Date(r.recordedAt).toLocaleString() : "—"}</TableCell>
                        <TableCell>
                          <span className={`text-sm font-bold ${scoreColor(Number(r.riskScore))}`}>{r.riskScore}</span>
                        </TableCell>
                        <TableCell>
                          {r.riskLane ? (
                            <Badge className={LANE_COLORS[String(r.riskLane).toLowerCase()] ?? "bg-muted text-muted-foreground"}>
                              {String(r.riskLane).toUpperCase()}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-xs">{r.triggeredBy ?? "—"}</TableCell>
                        <TableCell className="text-xs font-mono max-w-xs truncate">
                          {r.factors ? JSON.stringify(r.factors) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
