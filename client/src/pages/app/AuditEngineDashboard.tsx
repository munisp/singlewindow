import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ClipboardCheck, ChevronRight, User, DollarSign, TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";


const STATUS_COLORS: Record<string, string> = {
  pending: "bg-gray-100 text-gray-700",
  assigned: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  findings_submitted: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
  appealed: "bg-purple-100 text-purple-700",
};

const REASON_LABELS: Record<string, string> = {
  risk_score_high: "High Risk Score",
  random_sample: "Random Sample",
  trader_tier_review: "Trader Tier",
  value_threshold: "Value Threshold",
  hs_chapter_sensitive: "Sensitive HS Chapter",
  repeat_offender: "Repeat Offender",
  post_green_lane: "Post Green-Lane",
};

export default function AuditEngineDashboard() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  const { data: tasksData, isLoading, isError, refetch: refetchTasks } = trpc.auditEngine.getAuditTasks.useQuery({
    status: statusFilter === "all" ? undefined : (statusFilter as any),
    limit: 50,
  });

  const { data: stats } = trpc.auditEngine.getAuditStats.useQuery();
  const { data: report } = trpc.auditEngine.getDutyDiscrepancyReport.useQuery({});

  const assignTask = trpc.auditEngine.assignAuditTask.useMutation({
    onSuccess: () => { toast.success("Task assigned"); refetchTasks(); },
  });

  const closeAudit = trpc.auditEngine.closeAudit.useMutation({
    onSuccess: () => { toast.success("Audit closed"); refetchTasks(); },
  });

  const tasks = (tasksData as any)?.tasks ?? [];
  const auditStats = stats as any;
  const discrepancyReport = report as any;

  if (isLoading) return (
    <div className="p-6 flex items-center justify-center h-64">
      <div className="flex items-center gap-2 text-muted-foreground">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        Loading audit data...
      </div>
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      {isError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          Failed to load audit data. Please refresh the page.
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6 text-blue-500" />
            Audit Engine Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automated risk-based audit selection, officer assignment, findings management, and duty discrepancy reporting
          </p>
        </div>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-orange-600 border-orange-300">
            {auditStats?.byStatus?.pending ?? 0} Pending
          </Badge>
          <Badge variant="outline" className="text-red-600 border-red-300">
            {auditStats?.overdueTasks ?? 0} Overdue
          </Badge>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{auditStats?.total ?? 0}</div>
            <div className="text-sm text-muted-foreground">Total Audits</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-orange-600">{auditStats?.byStatus?.in_progress ?? 0}</div>
            <div className="text-sm text-muted-foreground">In Progress</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{auditStats?.byStatus?.closed ?? 0}</div>
            <div className="text-sm text-muted-foreground">Closed</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">
              ${((auditStats?.totalDiscrepancyUsd ?? 0) / 1000).toFixed(0)}K
            </div>
            <div className="text-sm text-muted-foreground">Total Discrepancy</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Audit Tasks</TabsTrigger>
          <TabsTrigger value="report">Discrepancy Report</TabsTrigger>
          <TabsTrigger value="selection">Selection Breakdown</TabsTrigger>
        </TabsList>

        {/* Tasks */}
        <TabsContent value="tasks" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="assigned">Assigned</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="findings_submitted">Findings Submitted</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{tasks.length} tasks</span>
          </div>

          <div className="space-y-2">
            {tasks.map((task: any) => (
              <Card key={task.id} className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => setSelectedTask(selectedTask === task.id ? null : task.id)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={STATUS_COLORS[task.status] ?? ""}>{task.status.replace(/_/g, " ")}</Badge>
                        <span className="font-semibold text-sm">{task.declarationId}</span>
                        <Badge variant="outline" className="text-xs">{REASON_LABELS[task.selectionReason] ?? task.selectionReason}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex gap-3 flex-wrap">
                        <span>{task.declarantName}</span>
                        <span>HS: {task.hsCode}</span>
                        <span>Value: ${task.declaredValueUsd.toLocaleString()}</span>
                        <span>Risk: {task.riskScore}%</span>
                        <span>Due: {new Date(task.dueAt).toLocaleDateString()}</span>
                      </div>
                      {task.assignedOfficerName && (
                        <div className="mt-1 text-xs flex items-center gap-1 text-blue-600">
                          <User className="h-3 w-3" />
                          {task.assignedOfficerName}
                        </div>
                      )}
                      {task.dutyDiscrepancyUsd > 0 && (
                        <div className="mt-1 text-xs text-red-600 font-medium">
                          Discrepancy: ${task.dutyDiscrepancyUsd.toLocaleString()}
                        </div>
                      )}
                    </div>
                    <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedTask === task.id ? "rotate-90" : ""}`} />
                  </div>

                  {selectedTask === task.id && (
                    <div className="mt-4 pt-4 border-t space-y-3">
                      {task.findings?.length > 0 && (
                        <div>
                          <div className="text-sm font-medium mb-2">Findings:</div>
                          {task.findings.map((f: any) => (
                            <div key={f.id} className="text-sm p-2 bg-muted rounded mb-1">
                              <span className="font-medium capitalize">{f.findingType.replace(/_/g, " ")}</span>
                              {f.amountUsd > 0 && <span className="text-red-600 ml-2">${f.amountUsd.toLocaleString()}</span>}
                              <p className="text-muted-foreground text-xs mt-1">{f.description}</p>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-2 flex-wrap">
                        {task.status === "pending" && (
                          <Button size="sm" onClick={(e) => {
                            e.stopPropagation();
                            assignTask.mutate({ auditId: task.id, officerId: "off-001", officerName: "Inspector Kwame Asante" });
                          }}>
                            Assign to Officer
                          </Button>
                        )}
                        {task.status === "findings_submitted" && (
                          <Button size="sm" variant="outline" className="text-green-700" onClick={(e) => {
                            e.stopPropagation();
                            closeAudit.mutate({ auditId: task.id });
                          }}>
                            Close Audit
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Discrepancy Report */}
        <TabsContent value="report" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">{discrepancyReport?.totalAudited ?? 0}</div>
                <div className="text-sm text-muted-foreground">Audited</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-orange-600">{discrepancyReport?.withFindings ?? 0}</div>
                <div className="text-sm text-muted-foreground">With Findings</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold text-red-600">
                  ${((discrepancyReport?.totalDiscrepancyUsd ?? 0) / 1000).toFixed(1)}K
                </div>
                <div className="text-sm text-muted-foreground">Total Discrepancy</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-2xl font-bold">
                  ${((discrepancyReport?.averageDiscrepancyUsd ?? 0) / 1000).toFixed(1)}K
                </div>
                <div className="text-sm text-muted-foreground">Avg per Finding</div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discrepancy by Finding Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries((discrepancyReport?.byFindingType ?? {}) as Record<string, number>)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, amount]) => (
                    <div key={type} className="flex items-center gap-3">
                      <div className="w-44 text-sm capitalize">{type.replace(/_/g, " ")}</div>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div
                          className="bg-red-500 h-2 rounded-full"
                          style={{ width: `${Math.min(100, (amount / Math.max(1, discrepancyReport?.totalDiscrepancyUsd ?? 1)) * 100)}%` }}
                        />
                      </div>
                      <div className="text-sm font-medium w-24 text-right">${amount.toLocaleString()}</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Selection Breakdown */}
        <TabsContent value="selection">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit Selection Reasons</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {Object.entries((auditStats?.byReason ?? {}) as Record<string, number>)
                  .sort(([, a], [, b]) => b - a)
                  .map(([reason, count]) => (
                    <div key={reason} className="flex items-center gap-3">
                      <div className="w-44 text-sm">{REASON_LABELS[reason] ?? reason}</div>
                      <div className="flex-1 bg-muted rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${Math.min(100, (count / Math.max(1, auditStats?.total ?? 1)) * 100)}%` }}
                        />
                      </div>
                      <div className="text-sm font-medium w-8 text-right">{count}</div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
