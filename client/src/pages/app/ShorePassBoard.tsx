/**
 * ShorePassBoard.tsx — Officer shore-pass / crew-change review board (Phase 20).
 *
 * Wires the Phase 19 `shorePass` tRPC router (previously orphaned: API
 * shipped without UI). Officers list applications, inspect a single
 * application with its append-only event history, and decide
 * (approve/reject) or revoke. STCW verification state is surfaced honestly
 * (NOT_CONFIGURED / FAILED block approval server-side — fail closed).
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RefreshCw, Ship, ClipboardCheck } from "lucide-react";

type Application = {
  id: number;
  status: string;
  vesselImoNumber: string;
  portCode: string;
  seafarerName?: string | null;
  nationality?: string | null;
  verificationStatus?: string | null;
  createdAt?: string | Date | null;
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SUBMITTED: "secondary",
  APPROVED: "default",
  REJECTED: "destructive",
  REVOKED: "destructive",
  EXPIRED: "outline",
};

export default function ShorePassBoard() {
  const utils = trpc.useUtils();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [validUntil, setValidUntil] = useState("");

  const closeDialog = () => {
    setSelectedId(null);
    setReason("");
    setValidUntil("");
  };

  const listQuery = trpc.shorePass.listForOfficer.useQuery({});
  const detailQuery = trpc.shorePass.get.useQuery(
    { applicationId: selectedId ?? 0 },
    { enabled: selectedId != null }
  );

  const decide = trpc.shorePass.decide.useMutation({
    onSuccess: () => {
      toast.success("Decision recorded");
      utils.shorePass.listForOfficer.invalidate();
      if (selectedId != null) utils.shorePass.get.invalidate({ applicationId: selectedId });
    },
    onError: (err) => toast.error(err.message),
  });
  const revoke = trpc.shorePass.revoke.useMutation({
    onSuccess: () => {
      toast.success("Shore pass revoked");
      utils.shorePass.listForOfficer.invalidate();
      if (selectedId != null) utils.shorePass.get.invalidate({ applicationId: selectedId });
    },
    onError: (err) => toast.error(err.message),
  });

  const applications = (listQuery.data?.applications ?? []) as Application[];
  const detail = detailQuery.data as
    | { application: Application; events: Array<{ id: number; action?: string; detail?: string | null; createdAt?: string | Date | null }> }
    | undefined;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Ship className="h-6 w-6" /> Shore-Pass Applications
            </h1>
            <p className="text-sm text-muted-foreground">
              Officer review of shore-pass / crew-change applications (Phase 19 F5a).
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
            {listQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Refresh</span>
          </Button>
        </div>

        {listQuery.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading applications…
          </div>
        ) : listQuery.error ? (
          <Card>
            <CardContent className="p-6 text-sm text-destructive">{listQuery.error.message}</CardContent>
          </Card>
        ) : applications.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">No shore-pass applications.</CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{applications.length} application(s)</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">ID</th>
                    <th className="p-3">Vessel IMO</th>
                    <th className="p-3">Port</th>
                    <th className="p-3">Verification</th>
                    <th className="p-3">Status</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {applications.map((a) => (
                    <tr key={a.id} className="border-b hover:bg-muted/40">
                      <td className="p-3 font-mono">#{a.id}</td>
                      <td className="p-3 font-mono">{a.vesselImoNumber}</td>
                      <td className="p-3">{a.portCode}</td>
                      <td className="p-3">
                        <Badge variant="outline">{a.verificationStatus ?? "NOT_REQUESTED"}</Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={STATUS_VARIANT[a.status] ?? "outline"}>{a.status}</Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setSelectedId(a.id)}>
                          <ClipboardCheck className="h-4 w-4 mr-1" /> Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        <Dialog open={selectedId != null} onOpenChange={(open) => !open && closeDialog()}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Shore-pass application #{selectedId}</DialogTitle>
            </DialogHeader>
            {detailQuery.isLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : detailQuery.error ? (
              <p className="text-sm text-destructive">{detailQuery.error.message}</p>
            ) : detail ? (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-muted-foreground">Status:</span>{" "}
                    <Badge variant={STATUS_VARIANT[detail.application.status] ?? "outline"}>
                      {detail.application.status}
                    </Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">STCW verification:</span>{" "}
                    <Badge variant="outline">{detail.application.verificationStatus ?? "NOT_REQUESTED"}</Badge>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Vessel IMO:</span>{" "}
                    <span className="font-mono">{detail.application.vesselImoNumber}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Port:</span> {detail.application.portCode}
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Event history</h3>
                  {detail.events.length === 0 ? (
                    <p className="text-muted-foreground">No events recorded.</p>
                  ) : (
                    <ul className="space-y-1">
                      {detail.events.map((e) => (
                        <li key={e.id} className="text-xs font-mono">
                          {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"} — {e.action ?? "event"}
                          {e.detail ? ` — ${e.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
            {detail && (
              <DialogFooter className="flex-col gap-3 sm:flex-col">
                {detail.application.status === "SUBMITTED" && (
                  <>
                    <div className="w-full space-y-2">
                      <Label htmlFor="sp-valid-until">Valid until (required to approve)</Label>
                      <Input
                        id="sp-valid-until"
                        type="datetime-local"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                      />
                      <Label htmlFor="sp-reason">Reason (required to reject)</Label>
                      <Input
                        id="sp-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Decision reason"
                      />
                    </div>
                    <div className="flex gap-2 justify-end w-full">
                      <Button
                        variant="destructive"
                        disabled={decide.isPending || !reason.trim()}
                        onClick={() =>
                          decide.mutate({ applicationId: detail.application.id, approve: false, reason: reason.trim() })
                        }
                      >
                        Reject
                      </Button>
                      <Button
                        disabled={decide.isPending || !validUntil}
                        onClick={() =>
                          decide.mutate({
                            applicationId: detail.application.id,
                            approve: true,
                            reason: reason.trim() || undefined,
                            validUntil: new Date(validUntil).toISOString(),
                          })
                        }
                      >
                        Approve
                      </Button>
                    </div>
                  </>
                )}
                {detail.application.status === "APPROVED" && (
                  <div className="w-full space-y-2">
                    <Label htmlFor="sp-revoke-reason">Revocation reason</Label>
                    <Input
                      id="sp-revoke-reason"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why is this pass being revoked?"
                    />
                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        disabled={revoke.isPending || reason.trim().length < 3}
                        onClick={() =>
                          revoke.mutate({ applicationId: detail.application.id, reason: reason.trim() })
                        }
                      >
                        Revoke
                      </Button>
                    </div>
                  </div>
                )}
              </DialogFooter>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
