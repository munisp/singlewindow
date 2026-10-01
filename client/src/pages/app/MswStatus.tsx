/**
 * Phase 22 — Maritime Single Window (MSW / IMO FAL) Status & Submission
 * UI for the previously orphaned `msw` tRPC router (Phase 9 WP-C PBAC surface).
 * The router is mutation-only (no list/get queries): agents create port-call
 * visits and submit FAL declarations; agency decisions happen via the same
 * procedures with the appropriate Keycloak MSW roles. This page provides the
 * agent-facing submission forms and surfaces the server's stable reason codes
 * verbatim — nothing is fabricated.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ship, FileUp, ShieldCheck, AlertTriangle } from "lucide-react";

const FAL_FORMS = [
  { value: "FAL1", label: "FAL 1 — General Declaration" },
  { value: "FAL2", label: "FAL 2 — Cargo Declaration" },
  { value: "FAL3", label: "FAL 3 — Ship's Stores Declaration" },
  { value: "FAL4", label: "FAL 4 — Crew's Effects Declaration" },
  { value: "FAL5", label: "FAL 5 — Crew List" },
  { value: "FAL6", label: "FAL 6 — Passenger List" },
  { value: "FAL7", label: "FAL 7 — Dangerous Goods Manifest" },
  { value: "MDOH", label: "MDOH — Maritime Declaration of Health" },
];

function ReasonCodeError({ message }: { message: string }) {
  const code = message.split(":")[0];
  return (
    <div className="p-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-mono text-xs font-semibold">{code}</p>
        <p className="text-xs mt-0.5">{message}</p>
      </div>
    </div>
  );
}

export default function MswStatus() {
  // ─── Create visit ─────────────────────────────────────────────────────────
  const [imo, setImo] = useState("");
  const [vesselName, setVesselName] = useState("");
  const [flag, setFlag] = useState("");
  const [portCode, setPortCode] = useState("");
  const [agentRef, setAgentRef] = useState("");
  const [eta, setEta] = useState("");
  const [etd, setEtd] = useState("");
  const [portCallId, setPortCallId] = useState("");
  const [createdVisit, setCreatedVisit] = useState<any>(null);
  const [visitError, setVisitError] = useState<string | null>(null);

  const createVisitMutation = trpc.msw.createVisit.useMutation({
    onSuccess: (v) => {
      setCreatedVisit(v);
      setVisitError(null);
      toast.success("Port-call visit created");
    },
    onError: (e) => setVisitError(e.message),
  });

  // ─── Submit FAL declaration ───────────────────────────────────────────────
  const [declVisitId, setDeclVisitId] = useState("");
  const [formType, setFormType] = useState("FAL1");
  const [payload, setPayload] = useState("{}");
  const [submittedDecl, setSubmittedDecl] = useState<any>(null);
  const [declError, setDeclError] = useState<string | null>(null);

  const submitDeclMutation = trpc.msw.submitDeclaration.useMutation({
    onSuccess: (d) => {
      setSubmittedDecl(d);
      setDeclError(null);
      toast.success("FAL declaration submitted for agency review");
    },
    onError: (e) => setDeclError(e.message),
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ship className="w-6 h-6 text-primary" />
            Maritime Single Window (IMO FAL)
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Single-submission port-call reporting for IMO FAL parties. Actions are role-gated
            (msw-agent, msw-port-health, agency roles) and fail closed with stable reason codes.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" />How decisions flow
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
              <li>Agent creates the port-call visit and submits FAL declarations.</li>
              <li>Port Health grants/refuses pratique anchored to the MDOH.</li>
              <li>Agency officers (NIS, Customs, NDLEA, NIMASA, NPA) review declarations, board, then grant or refuse clearance.</li>
            </ol>
            <p className="text-xs text-muted-foreground mt-3">
              If you lack the required Keycloak MSW role, the API returns FORBIDDEN with the required role named in the message.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Create Port-Call Visit (msw-agent)</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="grid grid-cols-1 md:grid-cols-2 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                setVisitError(null);
                if (!eta || Number.isNaN(Date.parse(eta))) return toast.error("ETA must be a valid date/time");
                createVisitMutation.mutate({
                  vesselImoNumber: imo.trim(),
                  vesselName: vesselName.trim(),
                  vesselFlagCode: flag.trim().toUpperCase(),
                  portCode: portCode.trim().toUpperCase(),
                  agentReference: agentRef.trim(),
                  eta: new Date(eta).toISOString(),
                  ...(etd && !Number.isNaN(Date.parse(etd)) ? { etd: new Date(etd).toISOString() } : {}),
                  ...(portCallId.trim() ? { portCallId: portCallId.trim() } : {}),
                });
              }}
            >
              <Input placeholder="IMO number (e.g. 9074729)" value={imo} onChange={(e) => setImo(e.target.value)} />
              <Input placeholder="Vessel name" value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
              <Input placeholder="Flag (ISO alpha-2, e.g. NG)" value={flag} onChange={(e) => setFlag(e.target.value)} maxLength={2} />
              <Input placeholder="Port UN/LOCODE (e.g. NGLOS)" value={portCode} onChange={(e) => setPortCode(e.target.value)} maxLength={5} />
              <Input placeholder="Agent reference" value={agentRef} onChange={(e) => setAgentRef(e.target.value)} />
              <Input placeholder="Port call ID (optional)" value={portCallId} onChange={(e) => setPortCallId(e.target.value)} />
              <label className="text-xs text-muted-foreground space-y-1">
                ETA
                <Input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
              </label>
              <label className="text-xs text-muted-foreground space-y-1">
                ETD (optional)
                <Input type="datetime-local" value={etd} onChange={(e) => setEtd(e.target.value)} />
              </label>
              <div className="md:col-span-2">
                <Button type="submit" disabled={createVisitMutation.isPending}>
                  {createVisitMutation.isPending ? "Creating…" : "Create Visit"}
                </Button>
              </div>
            </form>
            {visitError && <ReasonCodeError message={visitError} />}
            {createdVisit && (
              <div className="p-3 rounded-lg border text-sm space-y-1">
                <p className="font-medium">Visit created</p>
                <p className="font-mono text-xs break-all">visitId: {createdVisit.visitId ?? createdVisit.id ?? "—"}</p>
                {createdVisit.portCallVerified === false && (
                  <p className="text-xs text-amber-600">Port call not independently verified — the adapter is unconfigured (PORT_CALL_UNAVAILABLE would fail closed on submit paths that require it).</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="w-4 h-4" />Submit FAL Declaration (msw-agent)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setDeclError(null);
                let parsed: Record<string, unknown>;
                try {
                  parsed = JSON.parse(payload);
                  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
                } catch {
                  return toast.error("Form payload must be a valid JSON object");
                }
                submitDeclMutation.mutate({
                  visitId: declVisitId.trim(),
                  formType: formType as any,
                  formPayload: parsed,
                });
              }}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input placeholder="Visit ID" value={declVisitId} onChange={(e) => setDeclVisitId(e.target.value)} />
                <Select value={formType} onValueChange={setFormType}>
                  <SelectTrigger><SelectValue placeholder="FAL form" /></SelectTrigger>
                  <SelectContent>
                    {FAL_FORMS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <textarea
                className="w-full min-h-32 rounded-md border bg-background px-3 py-2 text-sm font-mono"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder='{"key": "value"}'
              />
              <Button type="submit" disabled={submitDeclMutation.isPending}>
                {submitDeclMutation.isPending ? "Submitting…" : "Submit Declaration"}
              </Button>
            </form>
            {declError && <ReasonCodeError message={declError} />}
            {submittedDecl && (
              <div className="p-3 rounded-lg border text-sm">
                <p className="font-medium">Declaration submitted</p>
                <p className="font-mono text-xs break-all mt-1">
                  declarationId: {submittedDecl.declarationId ?? submittedDecl.id ?? "—"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
