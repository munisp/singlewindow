import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle,
  Clock,
  FileText,
  Search,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending Review", variant: "outline" },
  under_review: { label: "Under Review", variant: "default" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  conditional: { label: "Conditional", variant: "secondary" },
};

export default function OGAPortal() {
  const [search, setSearch] = useState("");
  const [permitStatusFilter, setPermitStatusFilter] = useState("all");
  const utils = trpc.useUtils();

  const { data: permits, isLoading } = trpc.oga.myPermits.useQuery();

  const approveMutation = trpc.oga.approve.useMutation({
    onSuccess: () => {
      utils.oga.myPermits.invalidate();
      toast.success("Permit approved");
    },
    onError: (err: any) => toast.error("Failed to approve permit", { description: err.message }),
  });

  const rejectMutation = trpc.oga.reject.useMutation({
    onSuccess: () => {
      utils.oga.myPermits.invalidate();
      toast.success("Permit rejected");
    },
    onError: (err: any) => toast.error("Failed to reject permit", { description: err.message }),
  });

  const searchFiltered = permits?.filter((p: any) =>
    !search ||
    p.permitNumber?.toLowerCase().includes(search.toLowerCase()) ||
    p.agencyCode?.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const filtered = permitStatusFilter === "all"
    ? searchFiltered
    : searchFiltered.filter((p: any) => {
        if (permitStatusFilter === "active") return p.status === "approved";
        if (permitStatusFilter === "pending") return p.status === "pending" || p.status === "under_review";
        if (permitStatusFilter === "expired") return p.status === "rejected" || p.status === "conditional";
        return true;
      });

  const pending = filtered.filter((p: any) => p.status === "pending" || p.status === "under_review");
  const decided = filtered.filter((p: any) => p.status === "approved" || p.status === "rejected" || p.status === "conditional");

  return (
    <DashboardLayout title="OGA Portal">
      <div className="space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">OGA Permit Review Portal</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Review and approve permits for your agency. All decisions are recorded in the audit trail.
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="border-l-4 border-l-amber-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-amber-600">{pending.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Awaiting Decision</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-emerald-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-emerald-600">
                {filtered.filter((p: any) => p.status === "approved").length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Approved</p>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500">
            <CardContent className="p-4">
              <p className="text-2xl font-bold text-red-600">
                {filtered.filter((p: any) => p.status === "rejected").length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Rejected</p>
            </CardContent>
          </Card>
        </div>

        {/* Quick-filter permit status pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { value: "all", label: "All Permits", count: searchFiltered.length },
            { value: "active", label: "Active", count: searchFiltered.filter((p: any) => p.status === "approved").length },
            { value: "pending", label: "Pending", count: searchFiltered.filter((p: any) => p.status === "pending" || p.status === "under_review").length },
            { value: "expired", label: "Rejected / Conditional", count: searchFiltered.filter((p: any) => p.status === "rejected" || p.status === "conditional").length },
          ].map(pill => (
            <button
              key={pill.value}
              onClick={() => setPermitStatusFilter(pill.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                permitStatusFilter === pill.value
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
              }`}
            >
              {pill.label}
              <span className={`rounded-full px-1.5 py-0 text-[10px] font-bold ${
                permitStatusFilter === pill.value ? "bg-primary-foreground/20" : "bg-muted"
              }`}>
                {pill.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by permit number or agency..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Pending permits */}
        {pending.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                Pending Review ({pending.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="divide-y">
                {pending.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between px-5 py-4 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-medium">{p.permitNumber}</span>
                        <Badge variant="outline" className="text-xs">{p.agencyCode}</Badge>
                        <Badge variant="secondary" className="text-xs">{p.permitType?.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Declaration #{p.declarationId} · Submitted {new Date(p.createdAt).toLocaleDateString()}
                      </p>
                      {p.notes && <p className="text-xs text-muted-foreground mt-0.5 italic">"{p.notes}"</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        disabled={rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate({ permitId: p.id, reason: "Rejected by OGA officer" })}
                      >
                        <XCircle className="h-3 w-3" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate({ permitId: p.id, notes: "Approved by OGA officer" })}
                      >
                        <CheckCircle className="h-3 w-3" /> Approve
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Decided permits */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Decision History ({decided.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : decided.length === 0 ? (
              <div className="p-8 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No decided permits yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Permit Number</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Agency</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Decided</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {decided.map((p: any) => {
                      const cfg = STATUS_CONFIG[p.status] ?? STATUS_CONFIG.pending;
                      return (
                        <tr key={p.id} className="hover:bg-muted/30">
                          <td className="px-4 py-3 font-mono text-xs">{p.permitNumber}</td>
                          <td className="px-4 py-3"><Badge variant="outline" className="text-xs">{p.agencyCode}</Badge></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{p.permitType?.replace(/_/g, " ")}</td>
                          <td className="px-4 py-3"><Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge></td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}
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
