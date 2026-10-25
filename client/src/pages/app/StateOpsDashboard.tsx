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
  Anchor, Sailboat, Ship, AlertTriangle,
} from "lucide-react";

/**
 * Phase 28 W2 — State Blue Economy Operations dashboard.
 * Phase 29 W2 — extended with Fisheries permits & IUU penalties, Small Craft
 * registry, Dredging permits & royalty declarations, and Water Transport routes.
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

export interface FisheriesPermit {
  id: string;
  state: string;
  operatorName: string;
  permitType: string; // industrial | artisanal | crab_shrimp | collection
  vesselName: string;
  feeAmount: number;
  status: string;
  expiresAt: string;
  issuedAt?: string;
}

export interface IuuPenalty {
  id: string;
  state: string;
  vesselName: string;
  offence: string;
  fineAmount: number;
  status: string; // assessed | paid | waived | appealed
  assessedAt?: string;
}

export interface SmallCraft {
  id: string;
  state: string;
  registrationNo: string;
  craftType: string;
  ownerName: string;
  capacity: number;
  safetyCertExpiresAt: string;
  registrationFee: number;
  status: string;
}

export interface DredgingPermit {
  id: string;
  state: string;
  operatorName: string;
  site: string;
  royaltyPerM3: number;
  status: string;
  expiresAt: string;
}

export interface DredgingDeclaration {
  id: string;
  permitId: string;
  period: string; // YYYY-MM
  volumeM3: number;
  royaltyDueNaira: number; // computed server-side — never computed in the UI
  status: string; // declared | invoiced | paid
}

export interface WaterRoute {
  id: string;
  state: string;
  routeName: string;
  operatorName: string;
  fareAmount: number;
  jettyLevyPerTrip: number;
  status: string;
}

export interface RevenueShare {
  id: string;
  state: string;
  stream: string;
  stateSharePct: number;
  federalSharePct: number;
  status?: string;
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
  fisheriesFees?: number;
  iuuFines?: number;
  dredgingRoyalties?: number;
  waterTransportLevies?: number;
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
const FISHERIES_PERMIT_TYPES = ["industrial", "artisanal", "crab_shrimp", "collection"];
const IUU_OFFENCES = ["unlicensed_fishing", "closed_season", "prohibited_gear", "transhipment", "false_reporting", "incursion"];
const CRAFT_TYPES = ["canoe", "motorized_canoe", "passenger_boat", "cargo_boat", "ferry", "barge"];
const REVENUE_STREAMS = ["fisheries", "dredging", "water_transport", "licenses", "concessions"];

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

function isPastDate(value: string | null | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  issued: "bg-green-100 text-green-800",
  verified: "bg-green-100 text-green-800",
  valid: "bg-green-100 text-green-800",
  paid: "bg-green-100 text-green-800",
  registered: "bg-green-100 text-green-800",
  operational: "bg-green-100 text-green-800",
  pending: "bg-blue-100 text-blue-800",
  assessed: "bg-blue-100 text-blue-800",
  declared: "bg-blue-100 text-blue-800",
  invoiced: "bg-yellow-100 text-yellow-800",
  appealed: "bg-yellow-100 text-yellow-800",
  suspended: "bg-yellow-100 text-yellow-800",
  expired: "bg-orange-100 text-orange-800",
  waived: "bg-gray-100 text-gray-800",
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
  const fisheriesPermitsQuery = stateOps.listFisheriesPermits.useQuery(
    { state: stateParam },
    { enabled: activeTab === "fisheries" }
  );
  const iuuPenaltiesQuery = stateOps.listIuuPenalties.useQuery(
    { state: stateParam },
    { enabled: activeTab === "fisheries" }
  );
  const smallCraftQuery = stateOps.listSmallCraft.useQuery(
    { state: stateParam },
    { enabled: activeTab === "smallcraft" }
  );
  const dredgingPermitsQuery = stateOps.listDredgingPermits.useQuery(
    { state: stateParam },
    { enabled: activeTab === "dredging" }
  );
  const dredgingDeclarationsQuery = stateOps.listDredgingDeclarations.useQuery(
    { state: stateParam },
    { enabled: activeTab === "dredging" }
  );
  const waterRoutesQuery = stateOps.listWaterRoutes.useQuery(
    { state: stateParam },
    { enabled: activeTab === "water" }
  );
  const revenueSharesQuery = stateOps.listRevenueShares.useQuery(
    { state: stateParam },
    { enabled: activeTab === "revenue" }
  );

  const refetchActive = () => {
    licensesQuery.refetch();
    concessionsQuery.refetch();
    estatesQuery.refetch();
    projectsQuery.refetch();
    revenueQuery.refetch();
    fisheriesPermitsQuery.refetch();
    iuuPenaltiesQuery.refetch();
    smallCraftQuery.refetch();
    dredgingPermitsQuery.refetch();
    dredgingDeclarationsQuery.refetch();
    waterRoutesQuery.refetch();
    revenueSharesQuery.refetch();
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

  // Phase 29 mutations
  const issueFisheriesPermitMutation = stateOps.issueFisheriesPermit.useMutation({
    onSuccess: () => { toast.success("Fisheries permit issued"); setFisheriesDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const revokeFisheriesPermitMutation = stateOps.revokeFisheriesPermit.useMutation({
    onSuccess: () => { toast.success("Fisheries permit revoked"); invalidateAll(); },
    onError: onErr,
  });
  const assessIuuPenaltyMutation = stateOps.assessIuuPenalty.useMutation({
    onSuccess: () => { toast.success("IUU penalty assessed"); setIuuDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const settleIuuPenaltyMutation = stateOps.settleIuuPenalty.useMutation({
    onSuccess: () => { toast.success("IUU penalty marked paid"); invalidateAll(); },
    onError: onErr,
  });
  const registerSmallCraftMutation = stateOps.registerSmallCraft.useMutation({
    onSuccess: () => { toast.success("Small craft registered"); setCraftDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertDredgingPermitMutation = stateOps.upsertDredgingPermit.useMutation({
    onSuccess: () => { toast.success("Dredging permit saved"); setDredgingDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const declareDredgingVolumeMutation = stateOps.declareDredgingVolume.useMutation({
    onSuccess: () => { toast.success("Dredging volume declared"); setDeclareDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertWaterRouteMutation = stateOps.upsertWaterRoute.useMutation({
    onSuccess: () => { toast.success("Water route saved"); setRouteDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertRevenueShareMutation = stateOps.upsertRevenueShare.useMutation({
    onSuccess: () => { toast.success("Revenue share saved"); setShareDialogOpen(false); invalidateAll(); },
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

  // Phase 29 dialog state
  const [fisheriesDialogOpen, setFisheriesDialogOpen] = useState(false);
  const [fisheriesForm, setFisheriesForm] = useState({
    state: "Lagos", operatorName: "", permitType: "artisanal", vesselName: "", feeAmount: "", expiresAt: "",
  });

  const [iuuDialogOpen, setIuuDialogOpen] = useState(false);
  const [iuuForm, setIuuForm] = useState({
    state: "Lagos", vesselName: "", offence: "unlicensed_fishing", fineAmount: "",
  });

  const [craftDialogOpen, setCraftDialogOpen] = useState(false);
  const [craftForm, setCraftForm] = useState({
    state: "Lagos", registrationNo: "", craftType: "canoe", ownerName: "",
    capacity: "", safetyCertExpiresAt: "", registrationFee: "",
  });

  const [dredgingDialogOpen, setDredgingDialogOpen] = useState(false);
  const [editingDredgingPermit, setEditingDredgingPermit] = useState<DredgingPermit | null>(null);
  const [dredgingForm, setDredgingForm] = useState({
    state: "Lagos", operatorName: "", site: "", royaltyPerM3: "", expiresAt: "",
  });

  const [declareDialogOpen, setDeclareDialogOpen] = useState(false);
  const [declareForm, setDeclareForm] = useState({ permitId: "", period: "", volumeM3: "" });

  const [routeDialogOpen, setRouteDialogOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<WaterRoute | null>(null);
  const [routeForm, setRouteForm] = useState({
    state: "Lagos", routeName: "", operatorName: "", fareAmount: "", jettyLevyPerTrip: "",
  });

  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareForm, setShareForm] = useState({
    state: "Lagos", stream: "fisheries", stateSharePct: "", federalSharePct: "",
  });

  const licenses: StateLicense[] = useMemo(() => ((licensesQuery.data as any)?.rows ?? licensesQuery.data ?? []) as StateLicense[], [licensesQuery.data]);
  const concessions: StateConcession[] = useMemo(() => (concessionsQuery.data ?? []) as StateConcession[], [concessionsQuery.data]);
  const estates: StateEstate[] = useMemo(() => (estatesQuery.data ?? []) as StateEstate[], [estatesQuery.data]);
  const projects: CarbonProject[] = useMemo(() => (projectsQuery.data ?? []) as CarbonProject[], [projectsQuery.data]);
  const revenueRows: StateRevenueRow[] = useMemo(() => (revenueQuery.data ?? []) as StateRevenueRow[], [revenueQuery.data]);
  const fisheriesPermits: FisheriesPermit[] = useMemo(() => (fisheriesPermitsQuery.data ?? []) as FisheriesPermit[], [fisheriesPermitsQuery.data]);
  const iuuPenalties: IuuPenalty[] = useMemo(() => (iuuPenaltiesQuery.data ?? []) as IuuPenalty[], [iuuPenaltiesQuery.data]);
  const smallCraft: SmallCraft[] = useMemo(() => (smallCraftQuery.data ?? []) as SmallCraft[], [smallCraftQuery.data]);
  const dredgingPermits: DredgingPermit[] = useMemo(() => (dredgingPermitsQuery.data ?? []) as DredgingPermit[], [dredgingPermitsQuery.data]);
  const dredgingDeclarations: DredgingDeclaration[] = useMemo(() => (dredgingDeclarationsQuery.data ?? []) as DredgingDeclaration[], [dredgingDeclarationsQuery.data]);
  const waterRoutes: WaterRoute[] = useMemo(() => (waterRoutesQuery.data ?? []) as WaterRoute[], [waterRoutesQuery.data]);
  const revenueShares: RevenueShare[] = useMemo(() => (revenueSharesQuery.data ?? []) as RevenueShare[], [revenueSharesQuery.data]);

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

  // Phase 29 submit handlers
  const submitFisheriesPermit = () => {
    if (!fisheriesForm.operatorName || !fisheriesForm.vesselName) {
      toast.error("Operator name and vessel name are required");
      return;
    }
    issueFisheriesPermitMutation.mutate({
      state: fisheriesForm.state,
      operatorName: fisheriesForm.operatorName,
      permitType: fisheriesForm.permitType,
      vesselName: fisheriesForm.vesselName,
      feeAmount: parseFloat(fisheriesForm.feeAmount) || 0,
      expiresAt: fisheriesForm.expiresAt || undefined,
    });
  };

  const submitIuuPenalty = () => {
    if (!iuuForm.vesselName) {
      toast.error("Vessel name is required");
      return;
    }
    assessIuuPenaltyMutation.mutate({
      state: iuuForm.state,
      vesselName: iuuForm.vesselName,
      offence: iuuForm.offence,
      fineAmount: parseFloat(iuuForm.fineAmount) || 0,
    });
  };

  const submitSmallCraft = () => {
    if (!craftForm.registrationNo || !craftForm.ownerName) {
      toast.error("Registration number and owner name are required");
      return;
    }
    registerSmallCraftMutation.mutate({
      state: craftForm.state,
      registrationNo: craftForm.registrationNo,
      craftType: craftForm.craftType,
      ownerName: craftForm.ownerName,
      capacity: parseInt(craftForm.capacity, 10) || 0,
      safetyCertExpiresAt: craftForm.safetyCertExpiresAt || undefined,
      registrationFee: parseFloat(craftForm.registrationFee) || 0,
    });
  };

  const submitDredgingPermit = () => {
    if (!dredgingForm.operatorName || !dredgingForm.site) {
      toast.error("Operator name and site are required");
      return;
    }
    upsertDredgingPermitMutation.mutate({
      ...(editingDredgingPermit ? { id: editingDredgingPermit.id } : {}),
      state: dredgingForm.state,
      operatorName: dredgingForm.operatorName,
      site: dredgingForm.site,
      royaltyPerM3: parseFloat(dredgingForm.royaltyPerM3) || 0,
      expiresAt: dredgingForm.expiresAt || undefined,
    });
  };

  const submitDredgingDeclaration = () => {
    if (!declareForm.permitId || !declareForm.period) {
      toast.error("Permit and period (YYYY-MM) are required");
      return;
    }
    declareDredgingVolumeMutation.mutate({
      permitId: declareForm.permitId,
      period: declareForm.period,
      volumeM3: parseFloat(declareForm.volumeM3) || 0,
    });
  };

  const submitWaterRoute = () => {
    if (!routeForm.routeName || !routeForm.operatorName) {
      toast.error("Route name and operator are required");
      return;
    }
    upsertWaterRouteMutation.mutate({
      ...(editingRoute ? { id: editingRoute.id } : {}),
      state: routeForm.state,
      routeName: routeForm.routeName,
      operatorName: routeForm.operatorName,
      fareAmount: parseFloat(routeForm.fareAmount) || 0,
      jettyLevyPerTrip: parseFloat(routeForm.jettyLevyPerTrip) || 0,
    });
  };

  const submitRevenueShare = () => {
    if (!shareForm.stream) {
      toast.error("Revenue stream is required");
      return;
    }
    upsertRevenueShareMutation.mutate({
      state: shareForm.state,
      stream: shareForm.stream,
      stateSharePct: parseFloat(shareForm.stateSharePct) || 0,
      federalSharePct: parseFloat(shareForm.federalSharePct) || 0,
    });
  };

  const totals = useMemo(() => ({
    licenseFees: revenueRows.reduce((s, r) => s + (r.totalLicenseFees || 0), 0),
    concessionFees: revenueRows.reduce((s, r) => s + (r.concessionAnnualFees || 0), 0),
    leaseFees: revenueRows.reduce((s, r) => s + (r.leaseFees || 0), 0),
    carbonValue: revenueRows.reduce((s, r) => s + (r.carbonCreditsValue || 0), 0),
    fisheriesFees: revenueRows.reduce((s, r) => s + (r.fisheriesFees ?? 0), 0),
    iuuFines: revenueRows.reduce((s, r) => s + (r.iuuFines ?? 0), 0),
    dredgingRoyalties: revenueRows.reduce((s, r) => s + (r.dredgingRoyalties ?? 0), 0),
    waterTransportLevies: revenueRows.reduce((s, r) => s + (r.waterTransportLevies ?? 0), 0),
  }), [revenueRows]);

  const dredgingPermitById = useMemo(() => {
    const map: Record<string, DredgingPermit> = {};
    for (const p of dredgingPermits) map[p.id] = p;
    return map;
  }, [dredgingPermits]);

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
            <TabsTrigger value="fisheries">Fisheries</TabsTrigger>
            <TabsTrigger value="smallcraft">Small Craft</TabsTrigger>
            <TabsTrigger value="dredging">Dredging</TabsTrigger>
            <TabsTrigger value="water">Water Transport</TabsTrigger>
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

          {/* ── Fisheries ── */}
          <TabsContent value="fisheries" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Anchor className="w-4 h-4" />
                    Fisheries Permits
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setFisheriesForm({ state: stateParam ?? "Lagos", operatorName: "", permitType: "artisanal", vesselName: "", feeAmount: "", expiresAt: "" });
                      setFisheriesDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Issue Permit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {fisheriesPermitsQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading fisheries permits...</div>
                ) : fisheriesPermits.length === 0 ? (
                  <EmptyState icon={<Anchor className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Vessel</TableHead>
                        <TableHead>Fee</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fisheriesPermits.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.state}</TableCell>
                          <TableCell>{p.operatorName}</TableCell>
                          <TableCell className="capitalize">{p.permitType?.replace(/_/g, " ")}</TableCell>
                          <TableCell className="text-xs">{p.vesselName}</TableCell>
                          <TableCell>{formatNaira(p.feeAmount)}</TableCell>
                          <TableCell className="text-xs">{formatDate(p.expiresAt)}</TableCell>
                          <TableCell><StatusBadge status={p.status} /></TableCell>
                          <TableCell className="text-right">
                            {p.status !== "revoked" && (
                              <Button variant="outline" size="sm"
                                className="h-7 text-xs text-red-600 border-red-200 hover:bg-red-50"
                                disabled={revokeFisheriesPermitMutation.isPending}
                                onClick={() => revokeFisheriesPermitMutation.mutate({ id: p.id })}>
                                Revoke
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    IUU Penalties
                  </CardTitle>
                  <Button size="sm" variant="outline"
                    onClick={() => {
                      setIuuForm({ state: stateParam ?? "Lagos", vesselName: "", offence: "unlicensed_fishing", fineAmount: "" });
                      setIuuDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Assess Penalty
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {iuuPenaltiesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading IUU penalties...</div>
                ) : iuuPenalties.length === 0 ? (
                  <EmptyState icon={<AlertTriangle className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Vessel</TableHead>
                        <TableHead>Offence</TableHead>
                        <TableHead>Fine</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {iuuPenalties.map(pen => (
                        <TableRow key={pen.id}>
                          <TableCell className="font-medium">{pen.state}</TableCell>
                          <TableCell>{pen.vesselName}</TableCell>
                          <TableCell className="capitalize">{pen.offence?.replace(/_/g, " ")}</TableCell>
                          <TableCell>{formatNaira(pen.fineAmount)}</TableCell>
                          <TableCell><StatusBadge status={pen.status} /></TableCell>
                          <TableCell className="text-right">
                            {pen.status === "assessed" && (
                              <Button variant="outline" size="sm" className="h-7 text-xs"
                                disabled={settleIuuPenaltyMutation.isPending}
                                onClick={() => settleIuuPenaltyMutation.mutate({ id: pen.id })}>
                                Mark Paid
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Small Craft ── */}
          <TabsContent value="smallcraft" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Sailboat className="w-4 h-4" />
                    Small Craft Registry
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setCraftForm({ state: stateParam ?? "Lagos", registrationNo: "", craftType: "canoe", ownerName: "", capacity: "", safetyCertExpiresAt: "", registrationFee: "" });
                      setCraftDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    Register Craft
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {smallCraftQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading small craft registry...</div>
                ) : smallCraft.length === 0 ? (
                  <EmptyState icon={<Sailboat className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Registration No.</TableHead>
                        <TableHead>Craft Type</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Capacity</TableHead>
                        <TableHead>Safety Cert Expiry</TableHead>
                        <TableHead>Registration Fee</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {smallCraft.map(c => (
                        <TableRow key={c.id}>
                          <TableCell className="font-medium">{c.state}</TableCell>
                          <TableCell className="font-mono text-xs">{c.registrationNo}</TableCell>
                          <TableCell className="capitalize">{c.craftType?.replace(/_/g, " ")}</TableCell>
                          <TableCell>{c.ownerName}</TableCell>
                          <TableCell>{c.capacity?.toLocaleString()}</TableCell>
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-2">
                              {formatDate(c.safetyCertExpiresAt)}
                              {isPastDate(c.safetyCertExpiresAt) && (
                                <Badge className="text-xs bg-red-100 text-red-800">Expired</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>{formatNaira(c.registrationFee)}</TableCell>
                          <TableCell><StatusBadge status={c.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Dredging ── */}
          <TabsContent value="dredging" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Anchor className="w-4 h-4" />
                    Dredging Permits
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline"
                      disabled={dredgingPermits.length === 0}
                      onClick={() => {
                        setDeclareForm({ permitId: dredgingPermits[0]?.id ?? "", period: "", volumeM3: "" });
                        setDeclareDialogOpen(true);
                      }}>
                      <Plus className="w-4 h-4 mr-2" />
                      Declare Volume
                    </Button>
                    <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                      onClick={() => {
                        setEditingDredgingPermit(null);
                        setDredgingForm({ state: stateParam ?? "Lagos", operatorName: "", site: "", royaltyPerM3: "", expiresAt: "" });
                        setDredgingDialogOpen(true);
                      }}>
                      <Plus className="w-4 h-4 mr-2" />
                      New Permit
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {dredgingPermitsQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading dredging permits...</div>
                ) : dredgingPermits.length === 0 ? (
                  <EmptyState icon={<Anchor className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Site</TableHead>
                        <TableHead>Royalty / m³</TableHead>
                        <TableHead>Expiry</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dredgingPermits.map(p => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.state}</TableCell>
                          <TableCell>{p.operatorName}</TableCell>
                          <TableCell className="text-xs">{p.site}</TableCell>
                          <TableCell>{formatNaira(p.royaltyPerM3)}</TableCell>
                          <TableCell className="text-xs">{formatDate(p.expiresAt)}</TableCell>
                          <TableCell><StatusBadge status={p.status} /></TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => {
                                setEditingDredgingPermit(p);
                                setDredgingForm({
                                  state: p.state, operatorName: p.operatorName, site: p.site,
                                  royaltyPerM3: String(p.royaltyPerM3 ?? ""), expiresAt: p.expiresAt?.slice(0, 10) ?? "",
                                });
                                setDredgingDialogOpen(true);
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

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Royalty Declarations
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {dredgingDeclarationsQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading declarations...</div>
                ) : dredgingDeclarations.length === 0 ? (
                  <EmptyState icon={<FileText className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permit</TableHead>
                        <TableHead>Period</TableHead>
                        <TableHead>Volume (m³)</TableHead>
                        <TableHead>Royalty Due</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dredgingDeclarations.map(d => (
                        <TableRow key={d.id}>
                          <TableCell>
                            <div className="text-sm">{dredgingPermitById[d.permitId]?.operatorName ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{dredgingPermitById[d.permitId]?.site ?? d.permitId}</div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{d.period}</TableCell>
                          <TableCell>{d.volumeM3?.toLocaleString()}</TableCell>
                          {/* Royalty is computed server-side; displayed as returned */}
                          <TableCell>{formatNaira(d.royaltyDueNaira)}</TableCell>
                          <TableCell><StatusBadge status={d.status} /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Water Transport ── */}
          <TabsContent value="water" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Ship className="w-4 h-4" />
                    Inland Water Transport Routes
                  </CardTitle>
                  <Button size="sm" className="bg-sky-600 hover:bg-sky-700 text-white"
                    onClick={() => {
                      setEditingRoute(null);
                      setRouteForm({ state: stateParam ?? "Lagos", routeName: "", operatorName: "", fareAmount: "", jettyLevyPerTrip: "" });
                      setRouteDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Route
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {waterRoutesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading water routes...</div>
                ) : waterRoutes.length === 0 ? (
                  <EmptyState icon={<Ship className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Route</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead>Fare</TableHead>
                        <TableHead>Jetty Levy / Trip</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {waterRoutes.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-medium">{r.state}</TableCell>
                          <TableCell>{r.routeName}</TableCell>
                          <TableCell className="text-xs">{r.operatorName}</TableCell>
                          <TableCell>{formatNaira(r.fareAmount)}</TableCell>
                          <TableCell>{formatNaira(r.jettyLevyPerTrip)}</TableCell>
                          <TableCell><StatusBadge status={r.status} /></TableCell>
                          <TableCell className="text-right">
                            <Button variant="outline" size="sm" className="h-7 text-xs"
                              onClick={() => {
                                setEditingRoute(r);
                                setRouteForm({
                                  state: r.state, routeName: r.routeName, operatorName: r.operatorName,
                                  fareAmount: String(r.fareAmount ?? ""), jettyLevyPerTrip: String(r.jettyLevyPerTrip ?? ""),
                                });
                                setRouteDialogOpen(true);
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

          {/* ── Revenue ── */}
          <TabsContent value="revenue" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total License Fees", value: totals.licenseFees, icon: <FileText className="w-5 h-5 text-sky-600" />, color: "text-sky-600" },
                { label: "Concession Annual Fees", value: totals.concessionFees, icon: <Building2 className="w-5 h-5 text-emerald-600" />, color: "text-emerald-600" },
                { label: "Aquaculture Lease Fees", value: totals.leaseFees, icon: <Fish className="w-5 h-5 text-blue-500" />, color: "text-blue-600" },
                { label: "Blue Carbon Value", value: totals.carbonValue, icon: <Banknote className="w-5 h-5 text-green-600" />, color: "text-green-600" },
                { label: "Fisheries Fees", value: totals.fisheriesFees, icon: <Anchor className="w-5 h-5 text-teal-600" />, color: "text-teal-600" },
                { label: "IUU Fines", value: totals.iuuFines, icon: <AlertTriangle className="w-5 h-5 text-red-600" />, color: "text-red-600" },
                { label: "Dredging Royalties", value: totals.dredgingRoyalties, icon: <Banknote className="w-5 h-5 text-amber-600" />, color: "text-amber-600" },
                { label: "Water Transport Levies", value: totals.waterTransportLevies, icon: <Ship className="w-5 h-5 text-indigo-600" />, color: "text-indigo-600" },
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
                        <TableHead>Fisheries Fees</TableHead>
                        <TableHead>IUU Fines</TableHead>
                        <TableHead>Dredging Royalties</TableHead>
                        <TableHead>Water Levies</TableHead>
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
                          <TableCell>{formatNaira(r.fisheriesFees ?? 0)}</TableCell>
                          <TableCell>{formatNaira(r.iuuFines ?? 0)}</TableCell>
                          <TableCell>{formatNaira(r.dredgingRoyalties ?? 0)}</TableCell>
                          <TableCell>{formatNaira(r.waterTransportLevies ?? 0)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Banknote className="w-4 h-4" />
                    State / Federal Revenue Shares
                  </CardTitle>
                  <Button size="sm" variant="outline"
                    onClick={() => {
                      setShareForm({ state: stateParam ?? "Lagos", stream: "fisheries", stateSharePct: "", federalSharePct: "" });
                      setShareDialogOpen(true);
                    }}>
                    <Plus className="w-4 h-4 mr-2" />
                    New Share Split
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {revenueSharesQuery.isLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading revenue shares...</div>
                ) : revenueShares.length === 0 ? (
                  <EmptyState icon={<Banknote className="w-8 h-8" />} message="No records yet" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>State</TableHead>
                        <TableHead>Stream</TableHead>
                        <TableHead>State Share</TableHead>
                        <TableHead>Federal Share</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {revenueShares.map(s => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">{s.state}</TableCell>
                          <TableCell className="capitalize">{s.stream?.replace(/_/g, " ")}</TableCell>
                          <TableCell>{s.stateSharePct}%</TableCell>
                          <TableCell>{s.federalSharePct}%</TableCell>
                          <TableCell>{s.status ? <StatusBadge status={s.status} /> : "—"}</TableCell>
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

      {/* ── Issue Fisheries Permit dialog ── */}
      <Dialog open={fisheriesDialogOpen} onOpenChange={setFisheriesDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue Fisheries Permit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={fisheriesForm.state} onValueChange={v => setFisheriesForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Permit Type</Label>
                <Select value={fisheriesForm.permitType} onValueChange={v => setFisheriesForm(f => ({ ...f, permitType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FISHERIES_PERMIT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Operator Name *</Label>
                <Input value={fisheriesForm.operatorName} onChange={e => setFisheriesForm(f => ({ ...f, operatorName: e.target.value }))} />
              </div>
              <div>
                <Label>Vessel Name *</Label>
                <Input value={fisheriesForm.vesselName} onChange={e => setFisheriesForm(f => ({ ...f, vesselName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fee (₦)</Label>
                <Input type="number" value={fisheriesForm.feeAmount} onChange={e => setFisheriesForm(f => ({ ...f, feeAmount: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Expires On</Label>
                <Input type="date" value={fisheriesForm.expiresAt} onChange={e => setFisheriesForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFisheriesDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitFisheriesPermit} disabled={issueFisheriesPermitMutation.isPending}>
              {issueFisheriesPermitMutation.isPending ? "Issuing..." : "Issue Permit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Assess IUU Penalty dialog ── */}
      <Dialog open={iuuDialogOpen} onOpenChange={setIuuDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assess IUU Penalty</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={iuuForm.state} onValueChange={v => setIuuForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Vessel Name *</Label>
                <Input value={iuuForm.vesselName} onChange={e => setIuuForm(f => ({ ...f, vesselName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Offence</Label>
                <Select value={iuuForm.offence} onValueChange={v => setIuuForm(f => ({ ...f, offence: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {IUU_OFFENCES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Fine (₦)</Label>
                <Input type="number" value={iuuForm.fineAmount} onChange={e => setIuuForm(f => ({ ...f, fineAmount: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIuuDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitIuuPenalty} disabled={assessIuuPenaltyMutation.isPending}>
              {assessIuuPenaltyMutation.isPending ? "Assessing..." : "Assess Penalty"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Register Small Craft dialog ── */}
      <Dialog open={craftDialogOpen} onOpenChange={setCraftDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Register Small Craft</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={craftForm.state} onValueChange={v => setCraftForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Craft Type</Label>
                <Select value={craftForm.craftType} onValueChange={v => setCraftForm(f => ({ ...f, craftType: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CRAFT_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Registration No. *</Label>
                <Input value={craftForm.registrationNo} onChange={e => setCraftForm(f => ({ ...f, registrationNo: e.target.value }))} placeholder="e.g. LGS-SC-0001" />
              </div>
              <div>
                <Label>Owner Name *</Label>
                <Input value={craftForm.ownerName} onChange={e => setCraftForm(f => ({ ...f, ownerName: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Capacity</Label>
                <Input type="number" value={craftForm.capacity} onChange={e => setCraftForm(f => ({ ...f, capacity: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Safety Cert Expiry</Label>
                <Input type="date" value={craftForm.safetyCertExpiresAt} onChange={e => setCraftForm(f => ({ ...f, safetyCertExpiresAt: e.target.value }))} />
              </div>
              <div>
                <Label>Registration Fee (₦)</Label>
                <Input type="number" value={craftForm.registrationFee} onChange={e => setCraftForm(f => ({ ...f, registrationFee: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCraftDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitSmallCraft} disabled={registerSmallCraftMutation.isPending}>
              {registerSmallCraftMutation.isPending ? "Registering..." : "Register Craft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dredging Permit dialog ── */}
      <Dialog open={dredgingDialogOpen} onOpenChange={setDredgingDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingDredgingPermit ? "Edit Dredging Permit" : "New Dredging Permit"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={dredgingForm.state} onValueChange={v => setDredgingForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Operator Name *</Label>
                <Input value={dredgingForm.operatorName} onChange={e => setDredgingForm(f => ({ ...f, operatorName: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Dredging Site *</Label>
              <Input value={dredgingForm.site} onChange={e => setDredgingForm(f => ({ ...f, site: e.target.value }))} placeholder="Creek / channel / coordinates" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Royalty per m³ (₦)</Label>
                <Input type="number" value={dredgingForm.royaltyPerM3} onChange={e => setDredgingForm(f => ({ ...f, royaltyPerM3: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Expires On</Label>
                <Input type="date" value={dredgingForm.expiresAt} onChange={e => setDredgingForm(f => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDredgingDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitDredgingPermit} disabled={upsertDredgingPermitMutation.isPending}>
              {upsertDredgingPermitMutation.isPending ? "Saving..." : "Save Permit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Declare Dredging Volume dialog ── */}
      <Dialog open={declareDialogOpen} onOpenChange={setDeclareDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Declare Dredging Volume</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Permit *</Label>
              <Select value={declareForm.permitId} onValueChange={v => setDeclareForm(f => ({ ...f, permitId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select permit" /></SelectTrigger>
                <SelectContent>
                  {dredgingPermits.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.operatorName} — {p.site}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period (YYYY-MM) *</Label>
                <Input value={declareForm.period} onChange={e => setDeclareForm(f => ({ ...f, period: e.target.value }))} placeholder="2026-10" />
              </div>
              <div>
                <Label>Volume (m³)</Label>
                <Input type="number" value={declareForm.volumeM3} onChange={e => setDeclareForm(f => ({ ...f, volumeM3: e.target.value }))} placeholder="0" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Royalty due is computed by the server from the permit's rate and the declared volume.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclareDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitDredgingDeclaration} disabled={declareDredgingVolumeMutation.isPending}>
              {declareDredgingVolumeMutation.isPending ? "Declaring..." : "Declare Volume"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Water Route dialog ── */}
      <Dialog open={routeDialogOpen} onOpenChange={setRouteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRoute ? "Edit Water Route" : "New Water Route"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={routeForm.state} onValueChange={v => setRouteForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Route Name *</Label>
                <Input value={routeForm.routeName} onChange={e => setRouteForm(f => ({ ...f, routeName: e.target.value }))} placeholder="e.g. Marina — Badagry" />
              </div>
            </div>
            <div>
              <Label>Operator *</Label>
              <Input value={routeForm.operatorName} onChange={e => setRouteForm(f => ({ ...f, operatorName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Fare (₦)</Label>
                <Input type="number" value={routeForm.fareAmount} onChange={e => setRouteForm(f => ({ ...f, fareAmount: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Jetty Levy / Trip (₦)</Label>
                <Input type="number" value={routeForm.jettyLevyPerTrip} onChange={e => setRouteForm(f => ({ ...f, jettyLevyPerTrip: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRouteDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitWaterRoute} disabled={upsertWaterRouteMutation.isPending}>
              {upsertWaterRouteMutation.isPending ? "Saving..." : "Save Route"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Revenue Share dialog ── */}
      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New Revenue Share Split</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State *</Label>
                <Select value={shareForm.state} onValueChange={v => setShareForm(f => ({ ...f, state: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COASTAL_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Revenue Stream *</Label>
                <Select value={shareForm.stream} onValueChange={v => setShareForm(f => ({ ...f, stream: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REVENUE_STREAMS.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>State Share (%)</Label>
                <Input type="number" value={shareForm.stateSharePct} onChange={e => setShareForm(f => ({ ...f, stateSharePct: e.target.value }))} placeholder="0" />
              </div>
              <div>
                <Label>Federal Share (%)</Label>
                <Input type="number" value={shareForm.federalSharePct} onChange={e => setShareForm(f => ({ ...f, federalSharePct: e.target.value }))} placeholder="0" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareDialogOpen(false)}>Cancel</Button>
            <Button className="bg-sky-600 hover:bg-sky-700 text-white" onClick={submitRevenueShare} disabled={upsertRevenueShareMutation.isPending}>
              {upsertRevenueShareMutation.isPending ? "Saving..." : "Save Split"}
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
