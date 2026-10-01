/**
 * Phase 22 — Compliance Reporting Dashboard
 * UI for the previously orphaned `complianceReporting` tRPC router:
 * compliance audit results, regulatory submissions, and GDPR/NDPR
 * data-subject requests.
 */
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ShieldCheck, Send, Users } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  COMPLIANT: "bg-green-500/20 text-green-600",
  UNQUALIFIED: "bg-green-500/20 text-green-600",
  PARTIALLY_COMPLIANT: "bg-amber-500/20 text-amber-600",
  QUALIFIED: "bg-amber-500/20 text-amber-600",
  NON_COMPLIANT: "bg-red-500/20 text-red-600",
  ADVERSE: "bg-red-500/20 text-red-600",
  NOT_ASSESSED: "bg-muted text-muted-foreground",
  SUBMITTED: "bg-green-500/20 text-green-600",
  STAGED: "bg-blue-500/20 text-blue-600",
  PENDING: "bg-yellow-500/20 text-yellow-600",
  FAILED: "bg-red-500/20 text-red-600",
  COMPLETED: "bg-green-500/20 text-green-600",
};

export default function ComplianceReporting() {
  const { data: dash, isLoading, isError } = trpc.complianceReporting.getComplianceDashboard.useQuery();
  const { data: dsrData, isLoading: dsrLoading, isError: dsrError } = trpc.complianceReporting.listDataSubjectRequests.useQuery({ limit: 50 });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" />
            Compliance Reporting
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            PCI-DSS / SOC 2 audit results, automated regulatory submissions, and GDPR/NDPR data-subject requests.
          </p>
        </div>

        {isError && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            Failed to load the compliance dashboard. Please refresh the page.
          </div>
        )}

        {/* Audit results */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Compliance Audits</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !dash || dash.audit_results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No compliance audits have been run yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Standard</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Audited At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dash.audit_results.map((a: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{a.standard}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[a.status] ?? "bg-muted text-muted-foreground"}>{String(a.status).replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-xs">{a.score != null ? `${a.score}%` : "—"}</TableCell>
                      <TableCell className="text-xs">{a.audited_at ? new Date(a.audited_at).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Regulatory submissions */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Send className="w-4 h-4" />Regulatory Submissions</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !dash || dash.regulatory_submissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No regulatory submissions recorded yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Regulator</TableHead>
                    <TableHead>Report Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Submitted At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dash.regulatory_submissions.map((s: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs font-medium">{s.regulator}</TableCell>
                      <TableCell className="text-xs">{s.report_type}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[s.status] ?? "bg-muted text-muted-foreground"}>{s.status}</Badge></TableCell>
                      <TableCell className="text-xs">{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {dash && (
              <p className="text-xs text-muted-foreground mt-3">
                Standards covered: {dash.compliance_standards.join(", ")} · Regulators: {dash.regulators.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Data subject requests */}
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4" />Data Subject Requests (GDPR/NDPR)</CardTitle></CardHeader>
          <CardContent>
            {dsrError ? (
              <p className="text-sm text-red-600">Failed to load data subject requests.</p>
            ) : dsrLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : !dsrData || dsrData.requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data subject requests recorded.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Regulation</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deadline</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dsrData.requests.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs font-medium">{r.request_type}</TableCell>
                      <TableCell className="text-xs">{r.subject_email}</TableCell>
                      <TableCell className="text-xs">{r.regulation}</TableCell>
                      <TableCell><Badge className={STATUS_COLORS[r.status] ?? "bg-muted text-muted-foreground"}>{r.status}</Badge></TableCell>
                      <TableCell className="text-xs">{r.deadline ? new Date(r.deadline).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-xs">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {dash?.data_subject_requests && (
              <p className="text-xs text-muted-foreground mt-3">
                Last 30 days: {dash.data_subject_requests.total} request{dash.data_subject_requests.total !== 1 ? "s" : ""} ({dash.data_subject_requests.pending} pending)
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
