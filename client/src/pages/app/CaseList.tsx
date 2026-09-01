import { useState } from "react";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { AlertCircle } from "lucide-react";

const STATUSES = ["open", "triaged", "in_progress", "resolved", "closed"] as const;

/**
 * CRM case board (Phase 12). Fail-closed: query errors render an explicit
 * alert; pagination is hard-capped server-side.
 */
export default function CaseList() {
  const [status, setStatus] = useState<string>("");
  const [page, setPage] = useState(0);
  const limit = 25;

  const list = trpc.cases.list.useQuery({
    status: (status || undefined) as any,
    limit,
    offset: page * limit,
  });

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">CRM Cases</h1>
            <p className="text-muted-foreground">Case workflow: open → triaged → in progress → resolved → closed.</p>
          </div>
          <Select value={status} onValueChange={(v) => { setStatus(v === "all" ? "" : v); setPage(0); }}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {list.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Case board unavailable</AlertTitle>
            <AlertDescription>{list.error.message}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader><CardTitle>{list.data ? `${list.data.total} case(s)` : "Cases"}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {list.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">No cases match the filter.</p>
            )}
            {list.data?.items.map((c: any) => (
              <Link key={c.id} href={`/app/crm/cases/${c.id}`}>
                <a className="block border rounded p-3 hover:bg-accent">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{c.caseNumber} — {c.subject}</div>
                    <div className="flex gap-2">
                      <Badge variant="outline">{c.caseType}</Badge>
                      <Badge variant={c.priority === "critical" || c.priority === "high" ? "destructive" : "secondary"}>
                        {c.priority}
                      </Badge>
                      <Badge>{c.status.replace("_", " ")}</Badge>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Opened {new Date(c.createdAt).toLocaleString()}
                    {c.slaResolutionDue && ` · resolution due ${new Date(c.slaResolutionDue).toLocaleString()}`}
                  </div>
                </a>
              </Link>
            ))}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <Button
            variant="outline"
            disabled={!list.data || (page + 1) * limit >= list.data.total}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
