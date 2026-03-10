import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Mail, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw,
  Clock, CheckCircle, XCircle, Send, History, Download, Globe, Edit2, Check, X,
} from "lucide-react";

// Common IANA timezones for the selector
const TIMEZONES = [
  "UTC",
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Abidjan",
  "Africa/Addis_Ababa",
  "Africa/Dar_es_Salaam",
  "Africa/Kigali",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Tokyo",
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  value: String(i),
  label: `${String(i).padStart(2, "0")}:00`,
}));

function TimezoneLabel({ tz, hour }: { tz: string; hour: number }) {
  return (
    <span className="text-xs text-muted-foreground flex items-center gap-1">
      <Globe className="h-3 w-3" />
      {String(hour).padStart(2, "0")}:00 {tz}
    </span>
  );
}

export default function ComplianceEmailSettings() {
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [newTimezone, setNewTimezone] = useState("UTC");
  const [newSendHour, setNewSendHour] = useState("4");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTz, setEditTz] = useState("UTC");
  const [testEmailAddr, setTestEmailAddr] = useState("");
  const [editHour, setEditHour] = useState("4");

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
      setNewTimezone("UTC");
      setNewSendHour("4");
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.rulesOfOrigin.updateComplianceRecipient.useMutation({
    onSuccess: () => {
      toast.success("Recipient schedule updated");
      setEditingId(null);
      refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = trpc.rulesOfOrigin.toggleComplianceRecipient.useMutation({
    onSuccess: (row: any) => {
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
    onSuccess: (result: any) => {
      if (result.sent) {
        toast.success(`Test email sent to ${result.recipients.join(", ")} (${result.rowCount} rows)`);
      } else {
        toast.info(`Email skipped: ${result.reason ?? "unknown reason"}`);
      }
      refetchLogs();
    },
    onError: (e) => toast.error(e.message),
  });

  const sendTestEmailMutation = trpc.rulesOfOrigin.sendTestEmail.useMutation({
    onSuccess: (result: any) => {
      if (result.sent) {
        toast.success(result.reason);
      } else {
        toast.error(result.reason);
      }
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
            Configure recipients for the nightly certificate revocation log CSV email.
            Each recipient can have a custom timezone and delivery hour.
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
                    ? `Nightly delivery active — ${activeCount} recipient${activeCount !== 1 ? "s" : ""} configured`
                    : "Nightly delivery inactive — no active recipients configured"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The CSV contains all certificates revoked in the previous 24 hours. Delivery time is per-recipient.
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
              Add a compliance officer email address. Set their local timezone and preferred delivery hour.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="rec-email" className="text-xs">Email address *</Label>
                <Input
                  id="rec-email"
                  type="email"
                  placeholder="compliance@tradegateway.ng"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="rec-name" className="text-xs">Display name (optional)</Label>
                <Input
                  id="rec-name"
                  placeholder="Chief Compliance Officer"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Globe className="h-3 w-3" /> Timezone</Label>
                <Select value={newTimezone} onValueChange={setNewTimezone}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> Delivery hour (local time)</Label>
                <Select value={newSendHour} onValueChange={setNewSendHour}>
                  <SelectTrigger className="text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((h) => (
                      <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              onClick={() => addMutation.mutate({
                recipientEmail: newEmail,
                recipientName: newName || undefined,
                timezone: newTimezone,
                sendHourLocal: parseInt(newSendHour),
              })}
              disabled={!newEmail || addMutation.isPending}
            >
              <Plus className="h-4 w-4 mr-1" />
              {addMutation.isPending ? "Adding…" : "Add Recipient"}
            </Button>
          </CardContent>
        </Card>

        {/* SENDGRID verification */}
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Send className="h-4 w-4 text-blue-600" /> Verify Email Delivery (SENDGRID)
            </CardTitle>
            <CardDescription className="text-xs">
              Send a test email to confirm your <code className="bg-muted px-1 rounded">SENDGRID_API_KEY</code> is correctly configured.
              If not set, add it via <strong>Settings → Secrets</strong>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2 items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="test-email" className="text-xs">Send test email to</Label>
                <Input
                  id="test-email"
                  type="email"
                  placeholder="admin@tradegateway.ng"
                  value={testEmailAddr}
                  onChange={(e) => setTestEmailAddr(e.target.value)}
                />
              </div>
              <Button
                className="bg-blue-600 hover:bg-blue-700 text-white"
                onClick={() => {
                  if (!testEmailAddr) { toast.error("Enter a recipient email address"); return; }
                  sendTestEmailMutation.mutate({ toEmail: testEmailAddr });
                }}
                disabled={sendTestEmailMutation.isPending}
              >
                <Send className="h-3.5 w-3.5 mr-1" />
                {sendTestEmailMutation.isPending ? "Sending…" : "Send Test Email"}
              </Button>
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
                  Toggle active status, edit timezone/hour, or remove recipients.
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
                    className={`flex flex-col gap-2 p-3 rounded-lg border ${
                      s.isActive ? "border-emerald-200 bg-emerald-50/30" : "border-gray-200 bg-gray-50/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Mail className={`h-4 w-4 shrink-0 ${s.isActive ? "text-emerald-600" : "text-gray-400"}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{s.recipientEmail}</p>
                          {s.recipientName && (
                            <p className="text-xs text-muted-foreground">{s.recipientName}</p>
                          )}
                          {editingId !== s.id && (
                            <TimezoneLabel tz={s.timezone ?? "UTC"} hour={s.sendHourLocal ?? 4} />
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
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => {
                            if (editingId === s.id) {
                              setEditingId(null);
                            } else {
                              setEditingId(s.id);
                              setEditTz(s.timezone ?? "UTC");
                              setEditHour(String(s.sendHourLocal ?? 4));
                            }
                          }}
                          title="Edit timezone/hour"
                        >
                          <Edit2 className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0"
                          onClick={() => toggleMutation.mutate({ id: s.id, isActive: !s.isActive })}
                          disabled={toggleMutation.isPending}
                          title={s.isActive ? "Deactivate" : "Activate"}
                        >
                          {s.isActive
                            ? <ToggleRight className="h-4 w-4 text-emerald-600" />
                            : <ToggleLeft className="h-4 w-4 text-gray-400" />}
                        </Button>
                        <Button
                          variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                          onClick={() => deleteMutation.mutate({ id: s.id })}
                          disabled={deleteMutation.isPending}
                          title="Remove recipient"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Inline edit row */}
                    {editingId === s.id && (
                      <div className="flex flex-wrap items-end gap-2 pt-1 pl-7 border-t border-dashed">
                        <div className="space-y-0.5">
                          <Label className="text-xs">Timezone</Label>
                          <Select value={editTz} onValueChange={setEditTz}>
                            <SelectTrigger className="h-7 text-xs w-44">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TIMEZONES.map((tz) => (
                                <SelectItem key={tz} value={tz} className="text-xs">{tz}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-0.5">
                          <Label className="text-xs">Hour (local)</Label>
                          <Select value={editHour} onValueChange={setEditHour}>
                            <SelectTrigger className="h-7 text-xs w-24">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {HOURS.map((h) => (
                                <SelectItem key={h.value} value={h.value} className="text-xs">{h.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          size="sm" className="h-7 text-xs"
                          onClick={() => updateMutation.mutate({ id: s.id, timezone: editTz, sendHourLocal: parseInt(editHour) })}
                          disabled={updateMutation.isPending}
                        >
                          <Check className="h-3 w-3 mr-1" /> Save
                        </Button>
                        <Button
                          size="sm" variant="ghost" className="h-7 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          <X className="h-3 w-3 mr-1" /> Cancel
                        </Button>
                      </div>
                    )}
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
                  Last 30 nightly delivery attempts — date, trigger, rows, recipients, status.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleExportHistory} disabled={exportLogsMutation.isFetching}>
                <Download className="h-3.5 w-3.5 mr-1" />
                {exportLogsMutation.isFetching ? "Exporting…" : "Export History"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(deliveryLogs ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No delivery history yet. Use "Send Test Now" to trigger the first delivery.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-3 font-medium">Date</th>
                      <th className="text-left py-2 pr-3 font-medium">Trigger</th>
                      <th className="text-left py-2 pr-3 font-medium">Rows</th>
                      <th className="text-left py-2 pr-3 font-medium">Recipients</th>
                      <th className="text-left py-2 pr-3 font-medium">Duration</th>
                      <th className="text-left py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(deliveryLogs ?? []).map((log: any) => (
                      <tr key={log.id} className="hover:bg-muted/20">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {new Date(log.triggeredAt).toLocaleDateString()}
                          <span className="text-muted-foreground ml-1">
                            {new Date(log.triggeredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </td>
                        <td className="py-2 pr-3">
                          <Badge variant="outline" className="text-xs">
                            {log.triggeredBy?.startsWith("manual") ? "Manual" : "Cron"}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 font-mono">{log.rowCount ?? 0}</td>
                        <td className="py-2 pr-3 max-w-[160px] truncate" title={log.recipients}>
                          {log.recipientCount ?? 0} recipient{(log.recipientCount ?? 0) !== 1 ? "s" : ""}
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {log.durationMs != null ? `${log.durationMs}ms` : "—"}
                        </td>
                        <td className="py-2">
                          {log.success ? (
                            <Badge className="bg-emerald-100 text-emerald-800 text-xs flex items-center gap-1 w-fit">
                              <CheckCircle className="h-3 w-3" /> Sent
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-800 text-xs flex items-center gap-1 w-fit" title={log.errorMessage}>
                              <XCircle className="h-3 w-3" /> Failed
                            </Badge>
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

        {/* How it works */}
        <Card className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm">How it works</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-1.5">
            <p>1. The server runs a cron job at 04:00 UTC daily and checks each active recipient's configured timezone and send-hour.</p>
            <p>2. Recipients whose local time matches their configured send-hour receive the CSV for that day's revocations.</p>
            <p>3. The CSV contains all certificates revoked in the previous 24 hours (UTC midnight to midnight).</p>
            <p>4. Use "Send Test Now" to trigger an immediate delivery to all active recipients regardless of schedule.</p>
            <p>5. All delivery attempts are logged in the Delivery History table above for audit purposes.</p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
