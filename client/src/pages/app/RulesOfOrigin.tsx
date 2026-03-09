import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  FileCheck, Search, Plus, CheckCircle, XCircle, Globe, AlertTriangle,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  submitted: "bg-blue-100 text-blue-700",
  under_review: "bg-yellow-100 text-yellow-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-orange-100 text-orange-700",
};

const CERT_TYPE_LABELS: Record<string, string> = {
  afcfta_co: "AfCFTA CO",
  form_a: "Form A (GSP)",
  eur1: "EUR.1 (EU)",
  comesa_co: "COMESA CO",
  ecowas_co: "ECOWAS CO",
  bilateral_co: "Bilateral CO",
};

export default function RulesOfOrigin() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreate, setShowCreate] = useState(false);
  const [showVerify, setShowVerify] = useState(false);
  const [verifyCertNumber, setVerifyCertNumber] = useState("");

  // Create form state
  const [form, setForm] = useState({
    declarationId: "",
    certType: "afcfta_co",
    exporterName: "",
    exporterAddress: "",
    importerName: "",
    importerAddress: "",
    originCountry: "NGA",
    destinationCountry: "",
    goodsDescription: "",
    hsCode: "",
    grossWeight: "",
    invoiceNumber: "",
    invoiceDate: "",
    originCriteria: "substantial_transformation",
    localValueAddedPct: "",
  });

  const utils = trpc.useUtils();

  const { data: certs, isLoading } = trpc.rulesOfOrigin.getMyCertificates.useQuery({
    status: statusFilter === "all" ? undefined : statusFilter as "submitted" | "draft" | "approved" | "rejected" | "expired" | "under_review",
    limit: 50,
    offset: 0,
  });

  const { data: pendingCerts } = trpc.rulesOfOrigin.listPending.useQuery(
    { limit: 50, offset: 0 },
    { enabled: ["oga_officer", "admin"].includes(user?.role ?? "") }
  );

  const { data: stats } = trpc.rulesOfOrigin.getStats.useQuery(undefined, {
    enabled: ["oga_officer", "admin", "customs_officer"].includes(user?.role ?? ""),
  });

  const { data: verifyResult, refetch: doVerify, isFetching: isVerifying } = trpc.rulesOfOrigin.verify.useQuery(
    { certNumber: verifyCertNumber },
    { enabled: false }
  );

  const submitMutation = trpc.rulesOfOrigin.submitCertificate.useMutation({
    onSuccess: () => {
      toast.success("Certificate submitted successfully");
      setShowCreate(false);
      utils.rulesOfOrigin.getMyCertificates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const reviewMutation = trpc.rulesOfOrigin.review.useMutation({
    onSuccess: (_, vars) => {
      toast.success(`Certificate ${vars.decision}`);
      utils.rulesOfOrigin.listPending.invalidate();
      utils.rulesOfOrigin.getMyCertificates.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const handleCreate = () => {
    if (!form.exporterName || !form.importerName || !form.destinationCountry || !form.hsCode || !form.goodsDescription) {
      toast.error("Please fill in all required fields");
      return;
    }
    submitMutation.mutate({
      declarationId: form.declarationId ? parseInt(form.declarationId) : undefined,
      certType: form.certType as "afcfta_co" | "form_a" | "eur1" | "ecowas_co" | "comesa_co" | "bilateral_co",
      exporterName: form.exporterName,
      exporterAddress: form.exporterAddress,
      importerName: form.importerName,
      importerAddress: form.importerAddress,
      originCountry: form.originCountry,
      destinationCountry: form.destinationCountry,
      goodsDescription: form.goodsDescription,
      hsCode: form.hsCode,
      grossWeight: form.grossWeight || undefined,
      invoiceNumber: form.invoiceNumber || undefined,
      invoiceDate: form.invoiceDate ? new Date(form.invoiceDate) : undefined,
      originCriteria: form.originCriteria as "wholly_obtained" | "substantial_transformation" | "value_added_rule" | "tariff_shift_rule",
      localValueAddedPct: form.localValueAddedPct ? parseInt(form.localValueAddedPct) : undefined,
    });
  };

  // Show pending certs for OGA officers, own certs for traders
  const displayCerts = ["oga_officer", "admin"].includes(user?.role ?? "") ? (pendingCerts ?? []) : (certs ?? []);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FileCheck className="h-6 w-6 text-emerald-600" />
              Rules of Origin — AfCFTA e-Certification
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Issue, review, and verify origin certificates for AfCFTA, ECOWAS, AGOA, and GSP trade corridors.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowVerify(true)}>
              <Search className="h-4 w-4 mr-2" /> Verify Certificate
            </Button>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" /> New Certificate
            </Button>
          </div>
        </div>

        {/* Stats (OGA/Admin only) */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {[
              { label: "Total", value: stats.total, color: "text-foreground" },
              { label: "Draft", value: stats.draft, color: "text-gray-600" },
              { label: "Submitted", value: stats.submitted, color: "text-blue-600" },
              { label: "Under Review", value: stats.underReview, color: "text-yellow-600" },
              { label: "Approved", value: stats.approved, color: "text-green-600" },
              { label: "Rejected", value: stats.rejected, color: "text-red-600" },
              { label: "Expired", value: stats.expired, color: "text-orange-600" },
            ].map(s => (
              <Card key={s.label} className="text-center p-3">
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </Card>
            ))}
          </div>
        )}

        {/* Search (trader view) */}
        {!["oga_officer", "admin"].includes(user?.role ?? "") && (
          <div className="flex gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search certificates..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Certificate List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {["oga_officer", "admin"].includes(user?.role ?? "") ? "Pending Review" : "My Certificates"}
            </CardTitle>
            <CardDescription>{displayCerts.length} certificates</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : !displayCerts.length ? (
              <div className="text-center py-12 text-muted-foreground">
                <Globe className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>No certificates found. Create your first AfCFTA origin certificate.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground text-xs">
                      <th className="text-left py-2 px-3">Cert Number</th>
                      <th className="text-left py-2 px-3">Type</th>
                      <th className="text-left py-2 px-3">Exporter</th>
                      <th className="text-left py-2 px-3">Destination</th>
                      <th className="text-left py-2 px-3">HS Code</th>
                      <th className="text-left py-2 px-3">Status</th>
                      <th className="text-left py-2 px-3">Created</th>
                      <th className="text-left py-2 px-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayCerts.map((cert: Record<string, unknown>) => (
                      <tr key={cert.id as number} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="py-2 px-3 font-mono text-xs font-semibold">{(cert.certNumber as string) ?? "—"}</td>
                        <td className="py-2 px-3">
                          <Badge variant="outline" className="text-xs">
                            {CERT_TYPE_LABELS[cert.certType as string] ?? (cert.certType as string)}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 max-w-[150px] truncate">{cert.exporterName as string}</td>
                        <td className="py-2 px-3">{cert.destinationCountry as string}</td>
                        <td className="py-2 px-3 font-mono text-xs">{cert.hsCode as string}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[cert.status as string] ?? ""}`}>
                            {(cert.status as string).replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground text-xs">
                          {new Date(cert.createdAt as string).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {(cert.status as string) === "submitted" && ["oga_officer", "admin"].includes(user?.role ?? "") && (
                              <>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs bg-green-600 hover:bg-green-700"
                                  onClick={() => reviewMutation.mutate({ id: cert.id as number, decision: "approved" })}
                                  disabled={reviewMutation.isPending}
                                >
                                  <CheckCircle className="h-3 w-3 mr-1" /> Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 text-xs"
                                  onClick={() => reviewMutation.mutate({ id: cert.id as number, decision: "rejected", reviewNotes: "Does not meet criteria" })}
                                  disabled={reviewMutation.isPending}
                                >
                                  <XCircle className="h-3 w-3 mr-1" /> Reject
                                </Button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Create Certificate Dialog */}
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>New Origin Certificate</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1">
                <Label>Certificate Type</Label>
                <Select value={form.certType} onValueChange={v => setForm(f => ({ ...f, certType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(CERT_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Declaration ID (optional)</Label>
                <Input placeholder="e.g. 1234" value={form.declarationId} onChange={e => setForm(f => ({ ...f, declarationId: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Exporter Name *</Label>
                <Input value={form.exporterName} onChange={e => setForm(f => ({ ...f, exporterName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Exporter Address *</Label>
                <Input value={form.exporterAddress} onChange={e => setForm(f => ({ ...f, exporterAddress: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Importer Name *</Label>
                <Input value={form.importerName} onChange={e => setForm(f => ({ ...f, importerName: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Importer Address *</Label>
                <Input value={form.importerAddress} onChange={e => setForm(f => ({ ...f, importerAddress: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Country of Origin (ISO-3)</Label>
                <Input value={form.originCountry} onChange={e => setForm(f => ({ ...f, originCountry: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Country of Destination (ISO-3) *</Label>
                <Input placeholder="e.g. GHA" value={form.destinationCountry} onChange={e => setForm(f => ({ ...f, destinationCountry: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>HS Code *</Label>
                <Input placeholder="e.g. 0901.11" value={form.hsCode} onChange={e => setForm(f => ({ ...f, hsCode: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Gross Weight (kg)</Label>
                <Input type="number" value={form.grossWeight} onChange={e => setForm(f => ({ ...f, grossWeight: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Invoice Number</Label>
                <Input value={form.invoiceNumber} onChange={e => setForm(f => ({ ...f, invoiceNumber: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Invoice Date</Label>
                <Input type="date" value={form.invoiceDate} onChange={e => setForm(f => ({ ...f, invoiceDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Origin Criteria</Label>
                <Select value={form.originCriteria} onValueChange={v => setForm(f => ({ ...f, originCriteria: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="wholly_obtained">Wholly Obtained (P)</SelectItem>
                    <SelectItem value="substantial_transformation">Substantial Transformation (Y)</SelectItem>
                    <SelectItem value="value_added_40pct">Value Added ≥ 40% (W)</SelectItem>
                    <SelectItem value="tariff_heading_change">Tariff Heading Change (CTH)</SelectItem>
                    <SelectItem value="specific_process">Specific Process (SP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Local Value Added %</Label>
                <Input type="number" min="0" max="100" value={form.localValueAddedPct} onChange={e => setForm(f => ({ ...f, localValueAddedPct: e.target.value }))} />
              </div>
              <div className="col-span-2 space-y-1">
                <Label>Goods Description *</Label>
                <Textarea rows={2} value={form.goodsDescription} onChange={e => setForm(f => ({ ...f, goodsDescription: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit Certificate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Verify Certificate Dialog */}
        <Dialog open={showVerify} onOpenChange={setShowVerify}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Verify Origin Certificate</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label>Certificate Number</Label>
                <Input
                  placeholder="e.g. CO-1234567890-ABCDE"
                  value={verifyCertNumber}
                  onChange={e => setVerifyCertNumber(e.target.value)}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => doVerify()}
                disabled={!verifyCertNumber || isVerifying}
              >
                {isVerifying ? "Verifying..." : "Verify"}
              </Button>
              {verifyResult && (
                <div className={`p-4 rounded-lg border ${verifyResult.status === "approved" ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"}`}>
                  {verifyResult.status === "approved" ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-green-700 font-semibold">
                        <CheckCircle className="h-4 w-4" /> Certificate Valid
                      </div>
                      <div className="text-sm space-y-1 text-green-800">
                        <div>Type: {CERT_TYPE_LABELS[verifyResult.certType ?? ""] ?? verifyResult.certType}</div>
                        <div>Exporter: {verifyResult.exporterName}</div>
                        <div>Origin: {verifyResult.originCountry} → {verifyResult.destinationCountry}</div>
                        <div>HS Code: {verifyResult.hsCode}</div>
                        {verifyResult.expiresAt && <div>Expires: {new Date(verifyResult.expiresAt).toLocaleDateString()}</div>}
                      </div>
                    </div>
              ) : (
                <div className="flex items-center gap-2 text-red-700 font-semibold">
                  <AlertTriangle className="h-4 w-4" /> Certificate status: {verifyResult.status}
                </div>
              )}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
