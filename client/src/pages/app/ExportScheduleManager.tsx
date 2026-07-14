/**
 * Export Schedule Manager — configure recurring CSV delivery
 * Sprint 136: Item 3
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const CADENCE_LABELS: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const PRESET_LABELS: Record<string, string> = { "7": "Last 7 days", "30": "Last 30 days", "90": "Last 90 days", year: "Year-to-date", all: "All time" };
const EXPORT_TYPE_LABELS: Record<string, string> = { ledger: "Ledger Entries", payments: "Payment History" };

export default function ExportScheduleManager() {
  const utils = trpc.useUtils();
  const { data: schedules, isLoading } = trpc.exportSchedules.list.useQuery();

  const [newType, setNewType] = useState<"ledger" | "payments">("ledger");
  const [newCadence, setNewCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [newPreset, setNewPreset] = useState<"7" | "30" | "90" | "year" | "all">("30");
  const [adding, setAdding] = useState(false);

  const upsertMutation = trpc.exportSchedules.upsert.useMutation({
    onSuccess: () => {
      utils.exportSchedules.list.invalidate();
      setAdding(false);
      toast.success("Export schedule saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const setActiveMutation = trpc.exportSchedules.setActive.useMutation({
    onSuccess: () => utils.exportSchedules.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = trpc.exportSchedules.delete.useMutation({
    onSuccess: () => {
      utils.exportSchedules.list.invalidate();
      toast.success("Schedule removed");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CalendarClock size={22} className="text-[#D4A017]" />
          <div>
            <h1 className="text-xl font-bold text-foreground">Recurring Export Schedules</h1>
            <p className="text-sm text-muted-foreground">Automatically deliver CSV exports to your Notification Centre</p>
          </div>
        </div>
        {!adding && (
          <Button size="sm" className="gap-1.5 bg-[#D4A017] hover:bg-[#B8860B] text-black" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add Schedule
          </Button>
        )}
      </div>

      {/* Add new schedule form */}
      {adding && (
        <Card className="border-[#D4A017]/40 bg-[#D4A017]/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">New Recurring Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Export Type</Label>
                <Select value={newType} onValueChange={v => setNewType(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ledger">Ledger Entries</SelectItem>
                    <SelectItem value="payments">Payment History</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cadence</Label>
                <Select value={newCadence} onValueChange={v => setNewCadence(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily (06:00)</SelectItem>
                    <SelectItem value="weekly">Weekly (Mon 06:00)</SelectItem>
                    <SelectItem value="monthly">Monthly (1st 06:00)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date Range</Label>
                <Select value={newPreset} onValueChange={v => setNewPreset(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">Last 7 days</SelectItem>
                    <SelectItem value="30">Last 30 days</SelectItem>
                    <SelectItem value="90">Last 90 days</SelectItem>
                    <SelectItem value="year">Year-to-date</SelectItem>
                    <SelectItem value="all">All time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-[#D4A017] hover:bg-[#B8860B] text-black"
                disabled={upsertMutation.isPending}
                onClick={() => upsertMutation.mutate({ exportType: newType, cadence: newCadence, filterPreset: newPreset, isActive: true })}
              >
                {upsertMutation.isPending ? "Saving…" : "Save Schedule"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing schedules */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active Schedules
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading schedules…</div>
          ) : !schedules || schedules.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              No recurring exports configured. Click <strong>Add Schedule</strong> to get started.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {schedules.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={s.isActive}
                      onCheckedChange={v => setActiveMutation.mutate({ id: s.id, isActive: v })}
                    />
                    <div>
                      <p className="text-sm font-medium text-foreground">{EXPORT_TYPE_LABELS[s.exportType] ?? s.exportType}</p>
                      <p className="text-xs text-muted-foreground">
                        {CADENCE_LABELS[s.cadence] ?? s.cadence} · {PRESET_LABELS[s.filterPreset] ?? s.filterPreset}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {s.nextRunAt && (
                      <span className="text-xs text-muted-foreground">
                        Next: {new Date(s.nextRunAt).toLocaleDateString()}
                      </span>
                    )}
                    <Badge variant={s.isActive ? "default" : "secondary"} className="text-xs">
                      {s.isActive ? "Active" : "Paused"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: s.id })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
