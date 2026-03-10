/**
 * OGA Permit Expiry Calendar — Sprint 22
 *
 * Shows permits expiring within a configurable window (30/60/90/180 days),
 * colour-coded by urgency:
 *   - Red:    ≤ 7 days
 *   - Amber:  8–30 days
 *   - Yellow: 31–60 days
 *   - Green:  > 60 days
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  CalendarClock,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  Search,
} from "lucide-react";

const WINDOWS = [
  { label: "Next 30 days", value: 30 },
  { label: "Next 60 days", value: 60 },
  { label: "Next 90 days", value: 90 },
  { label: "Next 180 days", value: 180 },
];

function urgencyConfig(days: number) {
  if (days <= 7)
    return {
      label: "Critical",
      badgeClass: "bg-red-500/15 text-red-400 border-red-500/30",
      rowClass: "border-l-4 border-l-red-500",
      icon: <AlertTriangle className="h-3.5 w-3.5 text-red-400" />,
    };
  if (days <= 30)
    return {
      label: "Urgent",
      badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
      rowClass: "border-l-4 border-l-amber-500",
      icon: <Clock className="h-3.5 w-3.5 text-amber-400" />,
    };
  if (days <= 60)
    return {
      label: "Due Soon",
      badgeClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
      rowClass: "border-l-4 border-l-yellow-500",
      icon: <Clock className="h-3.5 w-3.5 text-yellow-400" />,
    };
  return {
    label: "Upcoming",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    rowClass: "border-l-4 border-l-emerald-500",
    icon: <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />,
  };
}

export default function OGAExpiryCalendar() {
  const [windowDays, setWindowDays] = useState(90);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isFetching } =
    trpc.oga.expiryCalendar.useQuery({ days: windowDays });

  const filtered = (data ?? []).filter((p) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.declarationNumber?.toLowerCase().includes(q) ||
      p.agencyName?.toLowerCase().includes(q) ||
      p.agencyCode?.toLowerCase().includes(q) ||
      p.permitNumber?.toLowerCase().includes(q)
    );
  });

  // Summary counts by urgency band
  const critical = filtered.filter((p) => p.daysUntilExpiry <= 7).length;
  const urgent = filtered.filter(
    (p) => p.daysUntilExpiry > 7 && p.daysUntilExpiry <= 30
  ).length;
  const dueSoon = filtered.filter(
    (p) => p.daysUntilExpiry > 30 && p.daysUntilExpiry <= 60
  ).length;
  const upcoming = filtered.filter((p) => p.daysUntilExpiry > 60).length;

  return (
    <DashboardLayout title="Permit Expiry Calendar">
      <div className="space-y-6 max-w-6xl">
        {isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Failed to load permit expiry data. Please refresh the page.
          </div>
        )}
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CalendarClock className="h-6 w-6 text-primary" />
              Permit Expiry Calendar
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upcoming permit expiry dates across active declarations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(windowDays)}
              onValueChange={(v) => setWindowDays(Number(v))}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WINDOWS.map((w) => (
                  <SelectItem key={w.value} value={String(w.value)}>
                    {w.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              className="gap-1.5"
            >
              <RefreshCw
                className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              label: "Critical (≤7d)",
              count: critical,
              cls: "border-red-500/30 bg-red-500/5",
              textCls: "text-red-400",
            },
            {
              label: "Urgent (8–30d)",
              count: urgent,
              cls: "border-amber-500/30 bg-amber-500/5",
              textCls: "text-amber-400",
            },
            {
              label: "Due Soon (31–60d)",
              count: dueSoon,
              cls: "border-yellow-500/30 bg-yellow-500/5",
              textCls: "text-yellow-400",
            },
            {
              label: "Upcoming (>60d)",
              count: upcoming,
              cls: "border-emerald-500/30 bg-emerald-500/5",
              textCls: "text-emerald-400",
            },
          ].map((s) => (
            <Card key={s.label} className={`border ${s.cls}`}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-2xl font-bold mt-1 ${s.textCls}`}>
                  {isLoading ? "—" : s.count}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by declaration, agency, permit…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Expiring Permits ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">
                <CalendarClock className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No permits expiring in this window</p>
                <p className="text-sm mt-1">
                  {search
                    ? "Try clearing the search filter"
                    : `No permits expire within the next ${windowDays} days`}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Urgency
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Permit #
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Agency
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Declaration
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Permit Type
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Expires
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        Days Left
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((p) => {
                      const urg = urgencyConfig(p.daysUntilExpiry);
                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-muted/20 ${urg.rowClass}`}
                        >
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              {urg.icon}
                              <Badge
                                variant="outline"
                                className={`text-xs ${urg.badgeClass}`}
                              >
                                {urg.label}
                              </Badge>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-xs font-semibold">
                            {p.permitNumber ?? "—"}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col">
                              <span className="text-xs font-medium">
                                {p.agencyName}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {p.agencyCode}
                              </span>
                            </div>
                          </td>
                          <td className="p-3 font-mono text-xs">
                            {p.declarationNumber}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {p.permitType ?? "Standard"}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className="text-xs capitalize"
                            >
                              {p.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-xs">
                            {p.expiresAt
                              ? new Date(p.expiresAt).toLocaleDateString(
                                  "en-GB",
                                  {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                  }
                                )
                              : "—"}
                          </td>
                          <td className="p-3">
                            <span
                              className={`text-sm font-bold ${
                                p.daysUntilExpiry <= 7
                                  ? "text-red-400"
                                  : p.daysUntilExpiry <= 30
                                  ? "text-amber-400"
                                  : p.daysUntilExpiry <= 60
                                  ? "text-yellow-400"
                                  : "text-emerald-400"
                              }`}
                            >
                              {p.daysUntilExpiry}d
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
