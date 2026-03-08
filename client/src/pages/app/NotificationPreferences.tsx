/**
 * Notification Preferences Page — Sprint 19
 * Allows users to opt in/out of specific notification types, grouped by category.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bell, RotateCcw, CheckCircle, Mail, Clock } from "lucide-react";
import { toast } from "sonner";

export default function NotificationPreferences() {
  const utils = trpc.useUtils();
  const [pendingUpdates, setPendingUpdates] = useState<Set<string>>(new Set());

  const { data: preferences, isLoading } = trpc.notificationPreferences.getPreferences.useQuery();

  const updatePref = trpc.notificationPreferences.updatePreference.useMutation({
    onMutate: ({ notificationType }) => {
      setPendingUpdates((prev) => new Set(prev).add(notificationType));
    },
    onSuccess: (_, { notificationType }) => {
      utils.notificationPreferences.getPreferences.invalidate();
      setPendingUpdates((prev) => {
        const next = new Set(prev);
        next.delete(notificationType);
        return next;
      });
    },
    onError: (err, { notificationType }) => {
      setPendingUpdates((prev) => {
        const next = new Set(prev);
        next.delete(notificationType);
        return next;
      });
      toast.error(`Failed to update preference: ${err.message}`);
    },
  });

  const resetPrefs = trpc.notificationPreferences.resetToDefaults.useMutation({
    onSuccess: (data) => {
      utils.notificationPreferences.getPreferences.invalidate();
      toast.success(data.message);
    },
    onError: (err) => toast.error(`Failed to reset: ${err.message}`),
  });

  const { data: digestSettings, isLoading: digestLoading } = trpc.notificationPreferences.getDigestSettings.useQuery();
  const { data: digestPreview, isLoading: previewLoading } = trpc.notificationPreferences.previewDigest.useQuery();

  const updateDigest = trpc.notificationPreferences.updateDigestSettings.useMutation({
    onSuccess: (data) => {
      utils.notificationPreferences.getDigestSettings.invalidate();
      utils.notificationPreferences.previewDigest.invalidate();
      const labels: Record<string, string> = { none: "disabled", daily: "daily at 08:00 UTC", weekly: "weekly on Mondays" };
      toast.success(`Digest email ${labels[data.digestFrequency] ?? data.digestFrequency}`);
    },
    onError: (err) => toast.error(`Failed to update digest: ${err.message}`),
  });

  // Group preferences by category
  const grouped = preferences
    ? preferences.reduce(
        (acc, pref) => {
          if (!acc[pref.category]) acc[pref.category] = [];
          acc[pref.category].push(pref);
          return acc;
        },
        {} as Record<string, typeof preferences>
      )
    : {};

  const categoryOrder = ["Declarations", "Payments", "Permits", "Documents", "Account", "Compliance", "Security", "System"];

  const disabledCount = preferences?.filter((p) => !p.enabled).length ?? 0;

  return (
    <DashboardLayout title="Notification Preferences">
      <div className="space-y-6 max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Bell className="h-6 w-6 text-primary" />
              Notification Preferences
              {disabledCount > 0 && (
                <Badge variant="secondary" className="ml-1">
                  {disabledCount} disabled
                </Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Choose which notifications you receive. Disabled notifications are never sent to your inbox.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => resetPrefs.mutate()}
            disabled={resetPrefs.isPending}
            className="gap-1.5"
          >
            <RotateCcw className={`h-4 w-4 ${resetPrefs.isPending ? "animate-spin" : ""}`} />
            Reset to defaults
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
                <CardContent className="space-y-3">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center justify-between">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-6 w-11 rounded-full" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {categoryOrder
              .filter((cat) => grouped[cat]?.length > 0)
              .map((category) => (
                <Card key={category}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{category}</CardTitle>
                    <CardDescription className="text-xs">
                      {grouped[category].filter((p) => p.enabled).length} of {grouped[category].length} enabled
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1 pt-0">
                    {grouped[category].map((pref) => {
                      const isPending = pendingUpdates.has(pref.type);
                      return (
                        <div
                          key={pref.type}
                          className={`flex items-start justify-between gap-4 rounded-lg px-3 py-2.5 transition-colors ${
                            pref.enabled ? "hover:bg-muted/40" : "opacity-60 hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-sm font-medium leading-tight">{pref.label}</p>
                              {pref.enabled && (
                                <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              {pref.description}
                            </p>
                          </div>
                          <Switch
                            checked={pref.enabled}
                            disabled={isPending}
                            onCheckedChange={(enabled) =>
                              updatePref.mutate({
                                notificationType: pref.type as any,
                                enabled,
                              })
                            }
                            aria-label={`Toggle ${pref.label}`}
                          />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              ))}
          </div>
        )}

        {/* Digest Email Settings */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Mail className="h-4 w-4" />Email Digest
            </CardTitle>
            <CardDescription className="text-xs">
              Receive a summary of unread notifications by email instead of individual alerts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Digest frequency</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {digestSettings?.lastDigestSentAt
                    ? `Last sent: ${new Date(digestSettings.lastDigestSentAt).toLocaleString()}`
                    : "No digest sent yet"}
                </p>
              </div>
              {digestLoading ? (
                <Skeleton className="h-9 w-36" />
              ) : (
                <Select
                  value={digestSettings?.digestFrequency ?? "none"}
                  onValueChange={(val) =>
                    updateDigest.mutate({ digestFrequency: val as "none" | "daily" | "weekly" })
                  }
                  disabled={updateDigest.isPending}
                >
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No digest</SelectItem>
                    <SelectItem value="daily">Daily (08:00 UTC)</SelectItem>
                    <SelectItem value="weekly">Weekly (Mon 08:00)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            {/* Digest preview — live unread count */}
            <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/30 p-3">
              {previewLoading ? (
                <Skeleton className="h-4 w-48" />
              ) : digestPreview ? (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Clock className="h-3 w-3 text-muted-foreground" />
                    {digestPreview.count === 0
                      ? "No unread notifications — your next digest will be empty."
                      : `Your next digest will contain ${digestPreview.count} unread notification${digestPreview.count !== 1 ? "s" : ""}.`}
                  </p>
                  {digestPreview.sampleTitles.length > 0 && (
                    <ul className="space-y-0.5 pl-4">
                      {digestPreview.sampleTitles.map((title, i) => (
                        <li key={i} className="text-xs text-muted-foreground list-disc">{title}</li>
                      ))}
                      {digestPreview.count > 5 && (
                        <li className="text-xs text-muted-foreground list-disc">…and {digestPreview.count - 5} more</li>
                      )}
                    </ul>
                  )}
                  {digestPreview.nextDigestLabel && (
                    <p className="text-xs text-muted-foreground">
                      Next send: <span className="font-medium text-foreground">{digestPreview.nextDigestLabel}</span>
                    </p>
                  )}
                </div>
              ) : null}
            </div>
            {digestSettings?.digestFrequency !== "none" && (
              <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-500">
                <Clock className="h-3 w-3" />
                Digest emails are batched and sent via the platform owner notification channel.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Footer info */}
        <p className="text-xs text-muted-foreground text-center pb-4">
          Changes take effect immediately. Security alerts cannot be disabled by system policy.
        </p>
      </div>
    </DashboardLayout>
  );
}
