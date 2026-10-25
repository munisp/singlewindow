import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Waves, RefreshCw, Plus, ShieldCheck, ChevronDown, ChevronRight,
  FileText, Building2, Fish, Leaf, Banknote, BadgeCheck, BadgeX,
} from "lucide-react";

/**
 * Phase 28 W2 — State Blue Economy Operations dashboard.
 *
 * Talks to the `stateOps` tRPC router (built in parallel, W1). The router
 * types are not available to the client yet, so the namespace is accessed
 * via a typed `any` shim and row shapes are defined locally below to match
 * the agreed contract exactly. No data is fabricated: empty states render
 * when the backend returns no rows.
 */

// ─── Local contract types (mirror of the stateOps router contract) ──────────

export interface StateLicense {
  id: string;
  state: string;
  licenseType: string;
  holderName: string;
  holderRef: string;
  status: string;
  feeAmount: number;
  currency: string;
  issuedAt: string;
  expiresAt: string;
}

export interface StateConcession {
  id: string;
  state: string;
  concessionType: string;
  operatorName: string;
  annualFee: number;
  startsOn: string;
  endsOn: string;
  status: string;
}

export interface StateEstate {
  id: string;
  state: string;
  name: string;
  location: string;
  hectares: number;
  leaseFeeAnnual: number;
  operatorName: string;
  status: string;
}

export interface CarbonProject {
  id: string;
  state: string;
  name: string;
  ecosystem: string;
  areaHa: number;
  status: string;
  creditsIssued: number;
  pricePerTonne: number;
  registryRef: string;
}

export interface MrvEvidence {
  id: string;
  evidenceType: string;
  period: string;
  co2Tonnes: number;
  documentUri: string;
  verificationHash: string;
  verifier: string;
  createdAt: string;
}

export interface StateRevenueRow {
  state: string;
  totalLicenseFees: number;
  licenseCount: number;
  licensesByType: Record<string, number>;
  concessionAnnualFees: number;
  leaseFees: number;
  carbonCreditsValue: number;
  projectCount: number;
}

/** Nigeria's coastal states covered by the blue-economy programme. */
export const COASTAL_STATES = [
  "Lagos",
  "Rivers",
  "Bayelsa",
  "Delta",
  "Akwa Ibom",
  "Cross River",
  "Ondo",
  "Edo",
] as const;

const LICENSE_TYPES = ["fishing", "trawler", "artisanal", "aquaculture", "processing", "export"];
const CONCESSION_TYPES = ["jetty", "cold_chain", "landing_site", "marina", "fish_market", "processing_zone"];
const ECOSYSTEMS = ["mangrove", "seagrass", "saltmarsh", "wetland"];

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatNaira(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `₦${n.toLocaleString("en-NG", { maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  issued: "bg-green-100 text-green-800",
  verified: "bg-green-100 text-green-800",
  valid: "bg-green-100 text-green-800",
  pending: "bg-blue-100 text-blue-800",
  suspended: "bg-yellow-100 text-yellow-800",
  expired: "bg-orange-100 text-orange-800",
  revoked: "bg-red-100 text-red-800",
  invalid: "bg-red-100 text-red-800",
  draft: "bg-gray-100 text-gray-800",
  terminated: "bg-gray-100 text-gray-800",
};

function StatusBadge({ status }: { status: string }) {
  const key = (status ?? "").toLowerCase();
  return (
    <Badge className={`text-xs capitalize ${STATUS_COLORS[key] ?? "bg-gray-100 text-gray-800"}`}>
      {status}
    </Badge>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="p-8 text-center text-muted-foreground text-sm">
      <div className="mx-auto mb-2 w-8 h-8 opacity-30 flex items-center justify-center">{icon}</div>
      {message}
    </div>
  );
}

function StateFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-48 h-8 text-xs">
        <SelectValue placeholder="All coastal states" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All coastal states</SelectItem>
        {COASTAL_STATES.map(s => (
          <SelectItem key={s} value={s}>{s}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The stateOps router ships with W1; until its types land on the client we
// access the namespace through a shim. Calls match the agreed contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stateOps = (trpc as any).stateOps;

// ─── Main page ──────────────────────────────────────────────────────────────

export default function StateOpsDashboard() {
  const [activeTab, setActiveTab] = useState("licenses");
  const [stateFilter, setStateFilter] = useState("all");
  const stateParam = stateFilter === "all" ? undefined : stateFilter;

  const utils = trpc.useUtils();

  // Queries
  const licensesQuery = stateOps.listLicenses.useQuery(
    { state: stateParam },
    { enabled: activeTab === "licenses" }
  );
  const concessionsQuery = stateOps.listConcessions.useQuery(
    { state: stateParam },
    { enabled: activeTab === "concessions" }
  );
  const estatesQuery = stateOps.listEstates.useQuery(
    { state: stateParam },
    { enabled: activeTab === "aquaculture" }
  );
  const projectsQuery = stateOps.listCarbonProjects.useQuery(
    { state: stateParam },
    { enabled: activeTab === "carbon" }
  );
  const revenueQuery = stateOps.stateRevenueSummary.useQuery(
    { state: stateParam },
    { enabled: activeTab === "revenue" }
  );

  const refetchActive = () => {
    licensesQuery.refetch();
    concessionsQuery.refetch();
    estatesQuery.refetch();
    projectsQuery.refetch();
    revenueQuery.refetch();
  };

  // ── Mutations ──
  const onErr = (err: any) => toast.error(err?.message ?? "Operation failed");
  const invalidateAll = () => {
    (utils as any).stateOps?.invalidate?.();
    refetchActive();
  };

  const issueLicenseMutation = stateOps.issueLicense.useMutation({
    onSuccess: () => { toast.success("License issued"); setLicenseDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const renewLicenseMutation = stateOps.renewLicense.useMutation({
    onSuccess: () => { toast.success("License renewed"); setRenewTarget(null); invalidateAll(); },
    onError: onErr,
  });
  const revokeLicenseMutation = stateOps.revokeLicense.useMutation({
    onSuccess: () => { toast.success("License revoked"); invalidateAll(); },
    onError: onErr,
  });
  const upsertConcessionMutation = stateOps.upsertConcession.useMutation({
    onSuccess: () => { toast.success("Concession saved"); setConcessionDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertEstateMutation = stateOps.upsertEstate.useMutation({
    onSuccess: () => { toast.success("Estate saved"); setEstateDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertProjectMutation = stateOps.upsertCarbonProject.useMutation({
    onSuccess: () => { toast.success("Carbon project saved"); setProjectDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const addEvidenceMutation = stateOps.addMrvEvidence.useMutation({
    onSuccess: () => { toast.success("MRV evidence added"); setEvidenceDialogProject(null); invalidateAll(); },
    onError: onErr,
  });
  const verifyEvidenceMutation = stateOps.verifyMrvEvidence.useMutation({
    onError: onErr,
  });

  // ── Dialog state ──
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [editingLicense, setEditingLicense] = useState<StateLicense | null>(null);
  const [licenseForm, setLicenseForm] = useState({
    state: "Lagos", licenseType: "fishing", holderName: "", holderRef: "",
    feeAmount: "", currency: "NGN", expiresAt: "",
  });

  const [renewTarget, setRenewTarget] = useState<StateLicense | null>(null);
  const [renewExpiresAt, setRenewExpiresAt] = useState("");

  const [concessionDialogOpen, setConcessionDialogOpen] = useState(false);
  const [editingConcession, setEditingConcession] = useState<StateConcession | null>(null);
  const [concessionForm, setConcessionForm] = useState({
    state: "Lagos", concessionType: "jetty", operatorName: "", annualFee: "", startsOn: "", endsOn: "",
  });

  const [estateDialogOpen, setEstateDialogOpen] = useState(false);
  const [editingEstate, setEditingEstate] = useState<StateEstate | null>(null);
  const [estateForm, setEstateForm] = useState({
    state: "Lagos", name: "", location: "", hectares: "", leaseFeeAnnual: "", operatorName: "",
  });

  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<CarbonProject | null>(null);
  const [projectForm, setProjectForm] = useState({
    state: "Lagos", name: "", ecosystem: "mangrove", areaHa: "", pricePerTonne: "", registryRef: "",
  });

  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [evidenceDialogProject, setEvidenceDialogProject] = useState<CarbonProject | null>(null);
  const [evidenceForm, setEvidenceForm] = useState({
    evidenceType: "satellite", period: "", co2Tonnes: "", documentUri: "", verifier: "",
  });
  const [verificationResults, setVerificationResults] = useState<Record<string, boolean>>({});

  const licenses: StateLicense[] = useMemo(() => ((licensesQuery.data as any)?.rows ?? licensesQuery.data ?? []) as StateLicense[], [licensesQuery.data]);
  const concessions: StateConcession[] = useMemo(() => (concessionsQuery.data ?? []) as StateConcession[], [concessionsQuery.data]);
  const estates: StateEstate[] = useMemo(() => (estatesQuery.data ?? []) as StateEstate[], [estatesQuery.data]);
  const projects: CarbonProject[] = useMemo(() => (projectsQuery.data ?? []) as CarbonProject[], [projectsQuery.data]);
  const revenueRows: StateRevenueRow[] = useMemo(() => (revenueQuery.data ?? []) as StateRevenueRow[], [revenueQuery.data]);

  // ── Submit handlers ──
  const submitLicense = () => {
    if (!licenseForm.holderName || !licenseForm.holderRef) {
      toast.error("Holder name and reference are required");
      return;
    }
    issueLicenseMutation.mutate({
      ...(editingLicense ? { id: editingLicense.id } : {}),
      state: licenseForm.state,
      licenseType: licenseForm.licenseType,
      holderName: licenseForm.holderName,
      holderRef: licenseForm.holderRef,
      feeAmount: parseFloat(licenseForm.feeAmount) || 0,
      currency: licenseForm.currency || "NGN",
      expiresAt: licenseForm.expiresAt || undefined,
    });
  };

  const submitConcession = () => {
    if (!concessionForm.operatorName) {
      toast.error("Operator name is required");
      return;
    }
    upsertConcessionMutation.mutate({
      ...(editingConcession ? { id: editingConcession.id } : {}),
      state: concessionForm.state,
      concessionType: concessionForm.concessionType,
      operatorName: concessionForm.operatorName,
      annualFee: parseFloat(concessionForm.annualFee) || 0,
      startsOn: concessionForm.startsOn || undefined,
      endsOn: concessionForm.endsOn || undefined,
    });
  };

  const submitEstate = () => {
    if (!estateForm.name || !estateForm.location) {
      toast.error("Estate name and location are required");
      return;
    }
    upsertEstateMutation.mutate({
      ...(editingEstate ? { id: editingEstate.id } : {}),
      state: estateForm.state,
      name: estateForm.name,
      location: estateForm.location,
      hectares: parseFloat(estateForm.hectares) || 0,
      leaseFeeAnnual: parseFloat(estateForm.leaseFeeAnnual) || 0,
      operatorName: estateForm.operatorName,
    });
  };

  const submitProject = () => {
    if (!projectForm.name) {
      toast.error("Project name is required");
      return;
    }
    upsertProjectMutation.mutate({
      ...(editingProject ? { id: editingProject.id } : {}),
      state: projectForm.state,
      name: projectForm.name,
      ecosystem: projectForm.ecosystem,
      areaHa: parseFloat(projectForm.areaHa) || 0,
      pricePerTonne: parseFloat(projectForm.pricePerTonne) || 0,
      registryRef: projectForm.registryRef || undefined,
    });
  };

  const submitEvidence = () => {
    if (!evidenceDialogProject) return;
    if (!evidenceForm.period || !evidenceForm.documentUri) {
      toast.error("Period and document URI are required");
      return;
    }
    addEvidenceMutation.mutate({
      projectId: evidenceDialogProject.id,
      evidenceType: evidenceForm.evidenceType,
      period: evidenceForm.period,
      co2Tonnes: parseFloat(evidenceForm.co2Tonnes) || 0,
      documentUri: evidenceForm.documentUri,
      verifier: evidenceForm.verifier || undefined,
    });
  };

  const handleVerify = (evidenceId: string) => {
    verifyEvidenceMutation.mutate(
      { id: evidenceId },
      {
        onSuccess: (res: any) => {
          const valid = !!res?.valid;
          setVerificationResults(prev => ({ ...prev, [evidenceId]: valid }));
          if (valid) toast.success("Evidence verification hash is valid");
          else toast.error("Evidence verification failed — hash mismatch");
        },
      }
    );
  };

  const totals = useMemo(() => ({
    licenseFees: revenueRows.reduce((s, r) => s + (r.totalLicenseFees || 0), 0),
    concessionFees: revenueRows.reduce((s, r) => s + (r.concessionAnnualFees || 0), 0),
    leaseFees: revenueRows.reduce((s, r) => s + (r.leaseFees || 0), 0),
    carbonValue: revenueRows.reduce((s, r) => s + (r.carbonCreditsValue || 0), 0),
  }), [revenueRows]);

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Waves className="w-7 h-7 text-sky-600" />
              State Blue Economy Operations
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Licenses, concessions, aquaculture estates, blue-carbon projects and state revenue across Nigeria's coastal states
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StateFilter value={stateFilter} onChange={setStateFilter} />
            <Button variant="outline" size="sm" onClick={refetchActive}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="licenses">Licenses</TabsTrigger>
            <TabsTrigger value="concessions">Concessions</TabsTrigger>
            <TabsTrigger value="aquaculture">Aquaculture</TabsTrigger>
            <TabsTrigger value="carbon">Blue Carbon</TabsTrigger>
            <TabsTrigger value="revenue">Revenue</TabsTrigger>
          </TabsList>

          {/* ── Licenses ── */}
          <TabsContent value="licenses" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    State Fishing &amp; Maritime Licenses
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setEditingLicense(null);
                      setLicenseForm({ state: stateParam ?? "Lagos", licenseType: "fishing", holderName: "", holderRef: "", feeAmount: "", currency: "NGN", expiresAt: "" });
                      setLicenseDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Issue License
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {licensesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading licenses...</div>
                ) : licenses.length === 0 ? (
                  <EmptyState icon={<FileText className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Holder</TableHead>
                        <TableHead>Fee</TableHead>
                        <TableHead>Issued</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {licenses.map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="font-medium">{l.state}</TableCell>
                          <TableCell className="capitalize">{l.licenseType}</TableCell>
                          <TableCell>
                            <div className="text-sm">{l.holderName}</div>
                            <div className="text-xs text-muted-foreground font-mono">{l.holderRef}</div>
                          </TableCell>
                          <TableCell>{formatNaira(l.feeAmount)}</TableCell>
                          <TableCell className="text-xs">{formatDate(l.issuedAt)}</TableCell>
                          <TableCell className="text-xs">{formatDate(l.expiresAt)}</TableCell>
                          <TableCell><StatusBadge status={l.status} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {l.status !== "revoked" && (
                                <>
                                  <Button variant="outline" size="sm" className="h-7 text-xs"
                                    onClick={() => { setRenewTarget(l); setRenewExpiresAt(l.expiresAt?.slice(0, 10) ?? ""); }}>
                                    Renew
                                  </Button>
                                  <Button variant="outline" size="sm"
                                    className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                    disabled={revokeLicenseMutation.isPending}
                                    onClick={() => revokeLicenseMutation.mutate({ id: l.id })}>
                                    Revoke
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Concessions ── */}
          <TabsContent value="concessions" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="w-4 h-4" />
                    Coastal Infrastructure Concessions
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setEditingConcession(null);
                      setConcessionForm({ state: stateParam ?? "Lagos", concessionType: "jetty", operatorName: "", annualFee: "", startsOn: "", endsOn: "" });
                      setConcessionDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Concession
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {concessionsQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading concessions...</div>
                ) : concessions.length === 0 ? (
                  <EmptyState icon={<Building2 className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Annual Fee</TableHead>
                        <TableHead>Term</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {concessions.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.state}</TableCell>
                          <TableCell className="capitalize">{c.concessionType?.replace(/_/g, " ")}</TableCell>
                          <TableCell>{c.operatorName}</TableCell>
                          <TableCell>{formatNaira(c.annualFee)}</TableCell>
                          <TableCell className="text-xs">{formatDate(c.startsOn)} → {formatDate(c.endsOn)}</TableCell>
                          <TableCell><StatusBadge status={c.status} /></TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => {
                                setEditingConcession(c);
                                setConcessionForm({
                                  state: c.state, concessionType: c.concessionType, operatorName: c.operatorName,
                                  annualFee: String(c.annualFee ?? ""), startsOn: c.startsOn?.slice(0, 10) ?? "", endsOn: c.endsOn?.slice(0, 10) ?? "",
                                });
                                setConcessionDialogOpen(true);
                              }}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Aquaculture estates ── */}
          <TabsContent value="aquaculture" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Fish className="w-4 h-4" />
                    Aquaculture Estates
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setEditingEstate(null);
                      setEstateForm({ state: stateParam ?? "Lagos", name: "", location: "", hectares: "", leaseFeeAnnual: "", operatorName: "" });
                      setEstateDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Estate
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {estatesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading estates...</div>
                ) : estates.length === 0 ? (
                  <EmptyState icon={<Fish className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Estate</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Hectares</TableHead>
                        <TableHead>Annual Lease</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {estates.map(e => (
                        <TableRow key={e.id}>
                          <TableCell className="font-medium">{e.state}</TableCell>
                          <TableCell>{e.name}</TableCell>
                          <TableCell className="text-xs">{e.location}</TableCell>
                          <TableCell>{e.hectares?.toLocaleString()}</TableCell>
                          <TableCell>{formatNaira(e.leaseFeeAnnual)}</TableCell>
                          <TableCell className="text-xs">{e.operatorName}</TableCell>
                          <TableCell><StatusBadge status={e.status} /></TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => {
                                setEditingEstate(e);
                                setEstateForm({
                                  state: e.state, name: e.name, location: e.location,
                                  hectares: String(e.hectares ?? ""), leaseFeeAnnual: String(e.leaseFeeAnnual ?? ""),
                                  operatorName: e.operatorName ?? "",
                                });
                                setEstateDialogOpen(true);
                              }}>
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Blue Carbon ── */}
          <TabsContent value="carbon" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Leaf className="w-4 h-4" />
                    Blue Carbon Projects &amp; MRV
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setEditingProject(null);
                      setProjectForm({ state: stateParam ?? "Lagos", name: "", ecosystem: "mangrove", areaHa: "", pricePerTonne: "", registryRef: "" });
                      setProjectDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Project
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {projectsQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading projects...</div>
                ) : projects.length === 0 ? (
                  <EmptyState icon={<Leaf className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>State</TableHead>
                        <TableHead>Project</TableHead>
                        <TableHead>Ecosystem</TableHead>
                        <TableHead>Area (ha)</TableHead>
                        <TableHead>Credits Issued</TableHead>
                        <TableHead>Value</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projects.map(p => (
                        <ProjectRows
                          key={p.id}
                          project={p}
                          expanded={expandedProjectId === p.id}
                          onToggle={() => setExpandedProjectId(expandedProjectId === p.id ? null : p.id)}
                          onEdit={() => {
                            setEditingProject(p);
                            setProjectForm({
                              state: p.state, name: p.name, ecosystem: p.ecosystem,
                              areaHa: String(p.areaHa ?? ""), pricePerTonne: String(p.pricePerTonne ?? ""),
                              registryRef: p.registryRef ?? "",
                            });
                            setProjectDialogOpen(true);
                          }}
                          onAddEvidence={() => {
                            setEvidenceDialogProject(p);
                            setEvidenceForm({ evidenceType: "satellite", period: "", co2Tonnes: "", documentUri: "", verifier: "" });
                          }}
                          onVerify={handleVerify}
                          verificationResults={verificationResults}
                          verifyPending={verifyEvidenceMutation.isPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Revenue ── */}
          <TabsContent value="revenue" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total License Fees", value: totals.licenseFees, icon: <FileText className="w-5 h-5 text-sky-600" />, color: "text-sky-600" },
                { label: "Concession Annual Fees", value: totals.concessionFees, icon: <Building2 className="w-5 h-5 text-emerald-600" />, color: "text-emerald-600" },
                { label: "Aquaculture Lease Fees", value: totals.leaseFees, icon: <Fish className="w-5 h-5 text-blue-500" />, color: "text-blue-600" },
                { label: "Blue Carbon Value", value: totals.carbonValue, icon: <Banknote className="w-5 h-5 text-green-600" />, color: "text-green-600" },
              ].map(stat => (
                <Card key={stat.label}>
                  <CardContent className="p-4 flex items-center gap-3">
                    {stat.icon}
                    <div className="min-w-0">
                      <div className={`text-xl font-bold truncate ${stat.color}`}>{formatNaira(stat.value)}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  Per-State Revenue Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {revenueQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading revenue summary...</div>
                ) : revenueRows.length === 0 ? (
                  <EmptyState icon={<Banknote className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>License Fees</TableHead>
                        <TableHead>Licenses</TableHead>
                        <TableHead>Licenses by Type</TableHead>
                        <TableHead>Concession Fees</TableHead>
                        <TableHead>Lease Fees</TableHead>
                        <TableHead>Carbon Value</TableHead>
                        <TableHead>Projects</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueRows.map(r => (
                        <TableRow key={r.state}>
                          <TableCell className="font-medium">{r.state}</TableCell>
                          <TableCell>{formatNaira(r.totalLicenseFees)}</TableCell>
                          <TableCell>{r.licenseCount}</TableCell>
                          <TableCell className="text-xs">
                            {r.licensesByType && Object.keys(r.licensesByType).length > 0
                              ? Object.entries(r.licensesByType).map(([t, n]) => `${t}: ${n}`).join(" · ")
                              : "—"}
                          </TableCell>
                          <TableCell>{formatNaira(r.concessionAnnualFees)}</TableCell>
                          <TableCell>{formatNaira(r.leaseFees)}</TableCell>
                          <TableCell>{formatNaira(r.carbonCreditsValue)}</TableCell>
                          <TableCell>{r.projectCount}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Issue License dialog ── */}
      <Dialog open={licenseDialogOpen} onOpenChange={setLicenseDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingLicense ? "Edit License" : "Issue New License"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={licenseForm.state} onValueChange={v => setLicenseForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>License Type</Label>
                <Select value={licenseForm.licenseType} onValueChange={v => setLicenseForm(f => ({ ...f, licenseType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LICENSE_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Holder Name *</Label>
                <Input value={licenseForm.holderName} onChange={e => setLicenseForm(f => ({ ...f, holderName: e.target.value }))} placeholder="e.g. Eko Fisheries Ltd" />
              </div>
              <div>
                <Label>Holder Reference *</Label>
                <Input value={licenseForm.holderRef} onChange={e => setLicenseForm(f => ({ ...f, holderRef: e.target.value }))} placeholder="RC / NIN / permit ref" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Fee Amount</Label>
                <Input type="number" value={licenseForm.feeAmount} onChange={e => setLicenseForm(f => ({ ...f, feeAmount: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Currency</Label>
                <Input value={licenseForm.currency} onChange={e => setLicenseForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} />
              </div>
              <div>
                <Label>Expires On</Label>
                <Input type="date" value={licenseForm.expiresAt} onChange={e => setLicenseForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLicenseDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitLicense} disabled={issueLicenseMutation.isPending}>
              {issueLicenseMutation.isPending ? "Saving..." : editingLicense ? "Save Changes" : "Issue License"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Renew License dialog ── */}
      <Dialog open={!!renewTarget} onOpenChange={open => { if (!open) setRenewTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renew License — {renewTarget?.holderName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>New Expiry Date *</Label>
              <Input type="date" value={renewExpiresAt} onChange={e => setRenewExpiresAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenewTarget(null)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white"
              disabled={renewLicenseMutation.isPending || !renewExpiresAt}
              onClick={() => renewTarget && renewLicenseMutation.mutate({ id: renewTarget.id, expiresAt: renewExpiresAt })}>
              {renewLicenseMutation.isPending ? "Renewing..." : "Confirm Renewal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Concession dialog ── */}
      <Dialog open={concessionDialogOpen} onOpenChange={setConcessionDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingConcession ? "Edit Concession" : "New Concession"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={concessionForm.state} onValueChange={v => setConcessionForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Concession Type</Label>
                <Select value={concessionForm.concessionType} onValueChange={v => setConcessionForm(f => ({ ...f, concessionType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONCESSION_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Operator Name *</Label>
              <Input value={concessionForm.operatorName} onChange={e => setConcessionForm(f => ({ ...f, operatorName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Annual Fee (₦)</Label>
                <Input type="number" value={concessionForm.annualFee} onChange={e => setConcessionForm(f => ({ ...f, annualFee: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Starts On</Label>
                <Input type="date" value={concessionForm.startsOn} onChange={e => setConcessionForm(f => ({ ...f, startsOn: e.target.value }))} />
              </div>
              <div>
                <Label>Ends On</Label>
                <Input type="date" value={concessionForm.endsOn} onChange={e => setConcessionForm(f => ({ ...f, endsOn: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConcessionDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitConcession} disabled={upsertConcessionMutation.isPending}>
              {upsertConcessionMutation.isPending ? "Saving..." : "Save Concession"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Estate dialog ── */}
      <Dialog open={estateDialogOpen} onOpenChange={setEstateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingEstate ? "Edit Estate" : "New Aquaculture Estate"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={estateForm.state} onValueChange={v => setEstateForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Estate Name *</Label>
                <Input value={estateForm.name} onChange={e => setEstateForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Location *</Label>
              <Input value={estateForm.location} onChange={e => setEstateForm(f => ({ ...f, location: e.target.value }))} placeholder="LGA / coordinates / landmark" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Hectares</Label>
                <Input type="number" value={estateForm.hectares} onChange={e => setEstateForm(f => ({ ...f, hectares: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Annual Lease (₦)</Label>
                <Input type="number" value={estateForm.leaseFeeAnnual} onChange={e => setEstateForm(f => ({ ...f, leaseFeeAnnual: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Operator</Label>
                <Input value={estateForm.operatorName} onChange={e => setEstateForm(f => ({ ...f, operatorName: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEstateDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitEstate} disabled={upsertEstateMutation.isPending}>
              {upsertEstateMutation.isPending ? "Saving..." : "Save Estate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Carbon project dialog ── */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingProject ? "Edit Carbon Project" : "New Blue Carbon Project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={projectForm.state} onValueChange={v => setProjectForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Ecosystem</Label>
                <Select value={projectForm.ecosystem} onValueChange={v => setProjectForm(f => ({ ...f, ecosystem: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ECOSYSTEMS.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Project Name *</Label>
              <Input value={projectForm.name} onChange={e => setProjectForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Cross River Mangrove Restoration" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Area (ha)</Label>
                <Input type="number" value={projectForm.areaHa} onChange={e => setProjectForm(f => ({ ...f, areaHa: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Price / Tonne (₦)</Label>
                <Input type="number" value={projectForm.pricePerTonne} onChange={e => setProjectForm(f => ({ ...f, pricePerTonne: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Registry Ref</Label>
                <Input value={projectForm.registryRef} onChange={e => setProjectForm(f => ({ ...f, registryRef: e.target.value }))} placeholder="VCS-XXXX" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitProject} disabled={upsertProjectMutation.isPending}>
              {upsertProjectMutation.isPending ? "Saving..." : "Save Project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Add MRV evidence dialog ── */}
      <Dialog open={!!evidenceDialogProject} onOpenChange={open => { if (!open) setEvidenceDialogProject(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add MRV Evidence — {evidenceDialogProject?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Evidence Type</Label>
                <Select value={evidenceForm.evidenceType} onValueChange={v => setEvidenceForm(f => ({ ...f, evidenceType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="satellite">Satellite imagery</SelectItem>
                    <SelectItem value="field_survey">Field survey</SelectItem>
                    <SelectItem value="biomass_sampling">Biomass sampling</SelectItem>
                    <SelectItem value="third_party_audit">Third-party audit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Reporting Period *</Label>
                <Input value={evidenceForm.period} onChange={e => setEvidenceForm(f => ({ ...f, period: e.target.value }))} placeholder="e.g. 2026-Q1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>CO₂ Tonnes</Label>
                <Input type="number" value={evidenceForm.co2Tonnes} onChange={e => setEvidenceForm(f => ({ ...f, co2Tonnes: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Verifier</Label>
                <Input value={evidenceForm.verifier} onChange={e => setEvidenceForm(f => ({ ...f, verifier: e.target.value }))} placeholder="Accredited verifier" />
              </div>
            </div>
            <div>
              <Label>Document URI *</Label>
              <Input value={evidenceForm.documentUri} onChange={e => setEvidenceForm(f => ({ ...f, documentUri: e.target.value }))} placeholder="https://.../evidence.pdf" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEvidenceDialogProject(null)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitEvidence} disabled={addEvidenceMutation.isPending}>
              {addEvidenceMutation.isPending ? "Adding..." : "Add Evidence"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

// ─── Carbon project row pair (project + expandable MRV evidence) ───────────

function ProjectRows({
  project: p,
  expanded,
  onToggle,
  onEdit,
  onAddEvidence,
  onVerify,
  verificationResults,
  verifyPending,
}: {
  project: CarbonProject;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAddEvidence: () => void;
  onVerify: (evidenceId: string) => void;
  verificationResults: Record<string, boolean>;
  verifyPending: boolean;
}) {
  const evidenceQuery = stateOps.getMrvEvidence.useQuery(
    { projectId: p.id },
    { enabled: expanded }
  );
  const evidence: MrvEvidence[] = (evidenceQuery.data ?? []) as MrvEvidence[];
  const value = (p.creditsIssued || 0) * (p.pricePerTonne || 0);

  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </TableCell>
        <TableCell className="font-medium">{p.state}</TableCell>
        <TableCell>
          <div className="text-sm">{p.name}</div>
          {p.registryRef && <div className="text-xs text-muted-foreground font-mono">{p.registryRef}</div>}
        </TableCell>
        <TableCell className="capitalize">{p.ecosystem}</TableCell>
        <TableCell>{p.areaHa?.toLocaleString()}</TableCell>
        <TableCell>{p.creditsIssued?.toLocaleString()}</TableCell>
        <TableCell>{formatNaira(value)}</TableCell>
        <TableCell><StatusBadge status={p.status} /></TableCell>
        <TableCell className="text-right" onClick={e => e.stopPropagation()}>
          <div className="flex justify-end gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAddEvidence}>
              <Plus className="w-3 h-3 mr-1" />
              Evidence
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onEdit}>
              Edit
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/30 p-0">
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                MRV Evidence — {p.name}
              </div>
              {evidenceQuery.isLoading ? (
                <div className="text-xs text-muted-foreground py-2">Loading evidence...</div>
              ) : evidence.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2">No records yet</div>
              ) : (
                <div className="space-y-2">
                  {evidence.map(ev => {
                    const verified = verificationResults[ev.id];
                    return (
                      <div key={ev.id} className="flex items-center justify-between gap-3 rounded border bg-background p-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-xs">
                            <Badge variant="outline" className="text-xs capitalize">{ev.evidenceType?.replace(/_/g, " ")}</Badge>
                            <span className="font-medium">{ev.period}</span>
                            <span className="text-muted-foreground">{ev.co2Tonnes?.toLocaleString()} tCO₂</span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate mt-0.5">
                            {ev.documentUri}
                            {ev.verifier ? ` · Verifier: ${ev.verifier}` : ""}
                            {` · Submitted ${formatDate(ev.createdAt)}`}
                          </div>
                          {ev.verificationHash && (
                            <div className="text-[10px] font-mono text-muted-foreground truncate mt-0.5">
                              hash: {ev.verificationHash}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {verified === true && (
                            <Badge className="text-xs bg-green-100 text-green-800">
                              <BadgeCheck className="w-3 h-3 mr-1" /> Valid
                            </Badge>
                          )}
                          {verified === false && (
                            <Badge className="text-xs bg-red-100 text-red-800">
                              <BadgeX className="w-3 h-3 mr-1" /> Invalid
                            </Badge>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={verifyPending}
                            onClick={() => onVerify(ev.id)}
                          >
                            <ShieldCheck className="w-3 h-3 mr-1" />
                            Verify
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
