import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Mail, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw,
  Clock, CheckCircle, XCircle, Send, History, AlertCircle, Download,
} from "lucide-react";

export default function ComplianceEmailSettings() {
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");

  const { data: schedules, refetch } = trpc.rulesOfOrigin.listComplianceSchedules.useQuery();
  const { data: deliveryLogs, refetch: refetchLogs } = trpc.rulesOfOrigin.listDeliveryLogs.useQuery({ limit: 30 });
  const exportLogsMutation = trpc.rulesOfOrigin.exportDeliveryLogsCsv.useQuery(
    { limit: 100 },
    { enabled: false }
  );

  const handleExportHistory = async () => {
    const result = await exportLogsMutation.refetch();
    if (!result.data?.csv) {
      toast.error("No delivery history to export");
      return;
    }
    const blob = new Blob([result.data.csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-email-delivery-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Delivery history exported");
  };

  const addMutation = trpc.rulesOfOrigin.addComplianceRecipient.useMutation({
    onSuccess: () => {
      toast.success("Compliance recipient added");
      setNewEmail("");
      setNewName("");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const toggleMutation = trpc.rulesOfOrigin.toggleComplianceRecipient.useMutation({
    onSuccess: (row) => {
      toast.success(`Recipient ${row.isActive ? "activated" : "deactivated"}`);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.rulesOfOrigin.deleteComplianceRecipient.useMutation({
    onSuccess: () => {
      toast.success("Recipient removed");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });
  const triggerMutation = trpc.rulesOfOrigin.triggerNightlyCsvEmail.useMutation({
    onSuccess: (result) => {
      if (result.sent) {
        toast.success(`Test email sent to ${result.recipients.join(", ")} (${result.rowCount} rows)`);
      } else {
        toast.info(`Email skipped: ${result.reason ?? "unknown reason"}`);
      }
      refetchLogs();
    },
    onError: (e) => toast.error(e.message),
  });

  const activeCount = (schedules ?? []).filter((s: any) => s.isActive).length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Mail className="h-6 w-6 text-blue-600" />
            Compliance Email Settings
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Configure recipients for the nightly certificate revocation log CSV email, delivered at 04:00 UTC every day.
            Requires <code className="text-xs bg-muted px-1 rounded">SENDGRID_API_KEY</code> to be set.
          </p>
        </div>

        {/* Status card */}
        <Card className={activeCount > 0 ? "border-emerald-300 bg-emerald-50/40" : "border-amber-300 bg-amber-50/40"}>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              {activeCount > 0
                ? <CheckCircle className="h-5 w-5 text-emerald-600 shrink-0" />
                : <XCircle className="h-5 w-5 text-amber-600 shrink-0" />}
              <div>
                <p className="text-sm font-semibold">
                  {activeCount > 0
                    ? `Nightly delivery active — ${activeCount} recipient${activeCount !== 1 ? "s" : ""} will receive the CSV at 04:00 UTC`
                    : "Nightly delivery inactive — no active recipients configured"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The CSV contains all certificates revoked in the previous 24 hours (UTC).
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Add recipient */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Recipient
            </CardTitle>
            <CardDescription className="text-xs">
              Add a compliance officer email address to receive the nightly revocation log.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor="rec-email" className="text-xs">Email address *</Label>
                <Input
                  id="rec-email"
                  type="email"
                  placeholder="compliance@tradegateway.ng"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newEmail) {
                      addMutation.mutate({ recipientEmail: newEmail, recipientName: newName || undefined });
                    }
                  }}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label htmlFor="rec-name" className="text-xs">Display name (optional)</Label>
                <Input
                  id="rec-name"
                  placeholder="Chief Compliance Officer"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => addMutation.mutate({ recipientEmail: newEmail, recipientName: newName || undefined })}
                  disabled={!newEmail || addMutation.isPending}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {addMutation.isPending ? "Adding…" : "Add"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recipient list */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Recipients ({(schedules ?? []).length})
                </CardTitle>
                <CardDescription className="text-xs">
                  Toggle active status or remove recipients. Only active recipients receive the nightly email.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50"
                  onClick={() => triggerMutation.mutate()}
                  disabled={triggerMutation.isPending}
                >
                  <Send className="h-3.5 w-3.5 mr-1" />
                  {triggerMutation.isPending ? "Sending…" : "Send Test Now"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {(schedules ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No recipients configured yet. Add one above.
              </p>
            ) : (
              <div className="space-y-2">
                {(schedules ?? []).map((s: any) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-3 p-3 rounded-lg border ${
                      s.isActive ? "border-emerald-200 bg-emerald-50/30" : "border-gray-200 bg-gray-50/30"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Mail className={`h-4 w-4 shrink-0 ${s.isActive ? "text-emerald-600" : "text-gray-400"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.recipientEmail}</p>
                        {s.recipientName && (
                          <p className="text-xs text-muted-foreground">{s.recipientName}</p>
                        )}
                        {s.lastSentAt && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" />
                            Last sent: {new Date(s.lastSentAt).toLocaleString()} · {s.lastSentRows ?? 0} rows
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={s.isActive ? "default" : "secondary"} className="text-xs">
                        {s.isActive ? "Active" : "Inactive"}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => toggleMutation.mutate({ id: s.id, isActive: !s.isActive })}
                        disabled={toggleMutation.isPending}
                        title={s.isActive ? "Deactivate" : "Activate"}
                      >
                        {s.isActive
                          ? <ToggleRight className="h-4 w-4 text-emerald-600" />
                          : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => deleteMutation.mutate({ id: s.id })}
                        disabled={deleteMutation.isPending}
                        title="Remove recipient"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delivery history log */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <History className="h-4 w-4" /> Delivery History
                </CardTitle>
                <CardDescription className="text-xs">
                  Last 30 nightly delivery attempts — both scheduled (cron) and manual (Send Test Now).
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => refetchLogs()}>
                  <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  onClick={handleExportHistory}
                  disabled={exportLogsMutation.isFetching}
                >
                  <Download className="h-3.5 w-3.5 mr-1" />
                  {exportLogsMutation.isFetching ? "Exporting…" : "Export History"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!deliveryLogs || deliveryLogs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No delivery history yet. The log is populated after each nightly run or manual trigger.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-3 font-medium">Date</th>
                      <th className="text-left py-2 pr-3 font-medium">Triggered</th>
                      <th className="text-right py-2 pr-3 font-medium">Rows</th>
                      <th className="text-right py-2 pr-3 font-medium">Recipients</th>
                      <th className="text-right py-2 pr-3 font-medium">Duration</th>
                      <th className="text-left py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveryLogs.map((log: any) => (
                      <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-3 font-mono whitespace-nowrap">
                          <span className="font-medium">{log.dateLabel}</span>
                          <span className="text-muted-foreground ml-1">
                            {new Date(log.triggeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="text-xs font-normal">
                            {log.triggeredBy.startsWith("manual:") ? "Manual" : "Cron"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{log.rowCount}</td>
                        <td className="py-2 pr-3 text-right font-mono">{log.recipientCount}</td>
                        <td className="py-2 pr-3 text-right text-muted-foreground">
                          {log.durationMs != null ? `${log.durationMs}ms` : "—"}
                        </td>
                        <td className="py-2">
                          {log.success ? (
                            <span className="flex items-center gap-1 text-emerald-600">
                              <CheckCircle className="h-3.5 w-3.5" /> Sent
                            </span>
                          ) : (
                            <span
                              className="flex items-center gap-1 text-red-600"
                              title={log.errorMessage ?? "Unknown error"}
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span className="truncate max-w-[120px]">
                                {log.errorMessage ? log.errorMessage.slice(0, 40) : "Failed"}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        {/* Schedule info */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How it works</p>
          <p>1. Every day at 04:00 UTC, the server queries all certificates revoked in the previous 24 hours.</p>
          <p>2. A CSV file is generated and emailed to all active recipients as an attachment.</p>
          <p>3. If no certificates were revoked, an empty log is still sent for audit completeness.</p>
          <p>4. Use "Send Test Now" to trigger an immediate delivery (uses yesterday's data).</p>
          <p>5. Every delivery attempt (success or failure) is recorded in the Delivery History log above.</p>
          <p>6. Delivery requires <code className="bg-muted px-1 rounded">SENDGRID_API_KEY</code> to be set in the environment.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}
