/**
 * Sprint 118 — Admin Settings Page
 * Allows admins to view and edit configurable platform settings stored in site_settings.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Settings, Save, RefreshCw, ShieldAlert, Clock, History, Database, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

// Human-readable labels for known setting keys
const SETTING_META: Record<string, { label: string; unit?: string; icon?: React.ReactNode; min?: number; max?: number }> = {
  sla_breach_email_threshold: {
    label: "SLA Breach Email Threshold",
    unit: "declarations",
    icon: <ShieldAlert className="h-4 w-4 text-destructive" />,
    min: 1,
    max: 1000,
  },
  sla_green_hours: { label: "Green Lane SLA", unit: "hours", icon: <Clock className="h-4 w-4 text-green-500" />, min: 1, max: 720 },
  sla_yellow_hours: { label: "Yellow Lane SLA", unit: "hours", icon: <Clock className="h-4 w-4 text-yellow-500" />, min: 1, max: 720 },
  sla_red_hours: { label: "Red Lane SLA", unit: "hours", icon: <Clock className="h-4 w-4 text-red-500" />, min: 1, max: 720 },
  sla_blue_hours: { label: "Blue Lane SLA", unit: "hours", icon: <Clock className="h-4 w-4 text-blue-500" />, min: 1, max: 720 },
};

export default function AdminSettings() {
  const { user } = useAuth();
  const { data: settings, isLoading, refetch } = trpc.siteSettings.list.useQuery(undefined, {
    enabled: user?.role === "admin",
  });

  const setMutation = trpc.siteSettings.set.useMutation({
    onSuccess: (data) => {
      toast.success("Setting saved", { description: `${data.key} updated to "${data.value}".` });
      refetch();
    },
    onError: (err) => toast.error("Save failed", { description: err.message }),
  });

  // Local edits map: key → draft value
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const handleChange = (key: string, val: string) => {
    setDrafts((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = (key: string, currentValue: string) => {
    const value = drafts[key] ?? currentValue;
    setMutation.mutate({ key, value });
  };

  if (user?.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Admin access required.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Platform Settings</h1>
              <p className="text-sm text-muted-foreground">Configure system-wide parameters. Changes take effect on the next cron cycle.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* SLA Settings Group */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">SLA Thresholds &amp; Alerts</CardTitle>
            <CardDescription>
              Controls how long each risk lane has before a declaration is considered SLA-breached, and when escalation emails are sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))
            ) : (
              settings?.map((setting) => {
                const meta = SETTING_META[setting.key];
                const draftVal = drafts[setting.key] ?? setting.value;
                const isDirty = draftVal !== setting.value;

                return (
                  <div key={setting.key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      {meta?.icon}
                      <Label htmlFor={`setting-${setting.key}`} className="font-medium">
                        {meta?.label ?? setting.key}
                      </Label>
                      {!setting.isPersisted && (
                        <Badge variant="secondary" className="text-xs">default</Badge>
                      )}
                      {isDirty && (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">unsaved</Badge>
                      )}
                    </div>
                    {setting.description && (
                      <p className="text-xs text-muted-foreground">{setting.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <Input
                        id={`setting-${setting.key}`}
                        type="number"
                        min={meta?.min ?? 1}
                        max={meta?.max}
                        value={draftVal}
                        onChange={(e) => handleChange(setting.key, e.target.value)}
                        className="max-w-[180px]"
                      />
                      {meta?.unit && (
                        <span className="text-sm text-muted-foreground">{meta.unit}</span>
                      )}
                      <Button
                        size="sm"
                        variant={isDirty ? "default" : "outline"}
                        onClick={() => handleSave(setting.key, setting.value)}
                        disabled={setMutation.isPending || !isDirty}
                        className="ml-auto"
                      >
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        Save
                      </Button>
                    </div>
                    {setting.updatedAt && (
                      <p className="text-xs text-muted-foreground">
                        Last updated: {new Date(setting.updatedAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* TigerBeetle System Account Seeding */}
      <TigerBeetleSeedSection />
      {/* Settings Audit Log */}
      <SettingsAuditLogSection />
    </DashboardLayout>
  );
}

// ─── TigerBeetle Seed Section ────────────────────────────────────────────────
function TigerBeetleSeedSection() {
  const [result, setResult] = useState<{ success: boolean; message: string; accountsCreated?: number; accountsSkipped?: number; error?: string } | null>(null);

  const seedMutation = trpc.tigerbeetleSeed.seedSystemAccounts.useMutation({
    onSuccess: (data) => {
      setResult(data);
      if (data.success) {
        toast.success("System accounts seeded", {
          description: `${data.accountsCreated ?? 0} accounts created, ${data.accountsSkipped ?? 0} already existed.`,
        });
      } else {
        toast.error("Seeding completed with errors", {
          description: data.error ?? "Unknown error. Check the result below.",
        });
      }
    },
    onError: (err) => {
      toast.error("Seeding failed", { description: err.message });
    },
  });

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              TigerBeetle System Accounts
            </CardTitle>
            <Badge variant="outline" className="text-xs font-mono">Financial Ledger</Badge>
          </div>
          <CardDescription>
            Seeds the 13 WCO General Ledger system accounts (Revenue Authority, Central Bank, Customs Escrow,
            Bond Escrow, Transit Guarantee, Duty Drawback Reserve, Free Zone Fund, G2G Settlement) required
            before any fund-flow workflow can execute. This operation is fully idempotent — running it multiple
            times is safe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Button
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              className="gap-2"
            >
              {seedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Database className="h-4 w-4" />
              )}
              {seedMutation.isPending ? "Seeding..." : "Seed System Accounts"}
            </Button>
            {result && !seedMutation.isPending && (
              <span className="text-sm text-muted-foreground">
                Last run: {result.accountsCreated ?? 0} created, {result.accountsSkipped ?? 0} existed
              </span>
            )}
          </div>

          {result && (
            <div className="rounded-md border bg-muted/30 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                )}
                Seed Result
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Accounts created:</span>
                  <span className="font-semibold text-green-600">{result.accountsCreated ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">Already existed:</span>
                  <span className="font-semibold text-blue-600">{result.accountsSkipped ?? 0}</span>
                </div>
              </div>
              {result.error && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-destructive">Error:</p>
                  <p className="text-xs text-destructive font-mono bg-destructive/10 rounded px-2 py-1">{result.error}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsAuditLogSection() {
  const { data, isLoading, refetch } = trpc.siteSettings.listAuditLog.useQuery({ limit: 50 });

  return (
    <div className="p-6 max-w-3xl mx-auto pb-10">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4" />
              Change History
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading} className="h-7 w-7 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <CardDescription>Every setting change is recorded here for accountability.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
          ) : !data?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No changes recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Setting</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Old</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">New</th>
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Changed By</th>
                    <th className="text-left py-2 font-medium text-muted-foreground">When</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="py-2 pr-4 font-mono text-xs">{entry.settingKey}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{entry.oldValue ?? <span className="italic">—</span>}</td>
                      <td className="py-2 pr-4 font-semibold">{entry.newValue}</td>
                      <td className="py-2 pr-4">{entry.changedByName ?? entry.changedBy ?? "—"}</td>
                      <td className="py-2 text-xs text-muted-foreground">{new Date(entry.changedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
