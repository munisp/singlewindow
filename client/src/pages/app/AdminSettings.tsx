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
import { Settings, Save, RefreshCw, ShieldAlert, Clock } from "lucide-react";

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
    </DashboardLayout>
  );
}
