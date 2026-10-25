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
  Anchor, Sailboat, Ship, AlertTriangle, Umbrella, Shell, GraduationCap, Zap,
} from "lucide-react";

/**
 * Phase 28 W2 — State Blue Economy Operations dashboard.
 * Phase 29 W2 — extended with Fisheries permits & IUU penalties, Small Craft
 * registry, Dredging permits & royalty declarations, and Water Transport routes.
 * Phase 30 W2 — extended with Tourism operators & levies, Mariculture farms,
 * Training academies & certifications, and Renewable Energy Certificates (RECs).
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

// Phase 30 contract types

export interface TourismOperator {
  id: string;
  state: string;
  operatorName: string;
  operatorType: string; // beach_resort | boat_tour | eco_lodge | mangrove_boardwalk | jet_ski | other
  site: string;
  licenceFee: number;
  visitorLevyRate: number; // ₦ levy per visitor
  status: string;
  expiresAt: string;
}

export interface TourismLevy {
  id: string;
  operatorId: string;
  period: string; // YYYY-MM
  visitorCount: number;
  levyDueNaira: number; // computed server-side — never computed in the UI
  status: string; // declared | invoiced | paid
}

export interface MaricultureFarm {
  id: string;
  state: string;
  operatorName: string;
  farmType: string; // seaweed | oyster | mussel | shrimp | finfish_cage
  estateId?: string; // linked aquaculture estate, if any
  hectares: number;
  leaseFeeAnnual: number;
  offTaker: string;
  status: string;
}

export interface Academy {
  id: string;
  state: string;
  name: string;
  programType: string; // fishery_skills | boat_handling | diving | hospitality | stcw_adjacent
  capacity: number;
  status: string;
}

export interface Certification {
  id: string;
  academyId: string;
  traineeName: string;
  program: string;
  certNo: string;
  feeAmount: number;
  issuedAt: string;
}

export interface Rec {
  id: string;
  state: string;
  projectName: string;
  source: string; // tidal | offshore_wind | solar_floating
  mwh: number;
  period: string; // YYYY-MM
  pricePerMwh: number;
  status: string; // issued | verified | sold
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
  tourismLevies?: number;
  maricultureLeases?: number;
  trainingFees?: number;
  recRevenue?: number;
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
const REVENUE_STREAMS = ["fisheries", "dredging", "water_transport", "licenses", "concessions", "tourism", "mariculture", "training", "energy_credits"];
const TOURISM_OPERATOR_TYPES = ["beach_resort", "boat_tour", "eco_lodge", "mangrove_boardwalk", "jet_ski", "other"];
const MARICULTURE_TYPES = ["seaweed", "oyster", "mussel", "shrimp", "finfish_cage"];
const PROGRAM_TYPES = ["fishery_skills", "boat_handling", "diving", "hospitality", "stcw_adjacent"];
const REC_SOURCES = ["tidal", "offshore_wind", "solar_floating"];

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
  sold: "bg-green-100 text-green-800",
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
  // Phase 30 queries
  const tourismOperatorsQuery = stateOps.listTourismOperators.useQuery(
    { state: stateParam },
    { enabled: activeTab === "tourism" }
  );
  const tourismLeviesQuery = stateOps.listTourismLevies.useQuery(
    { state: stateParam },
    { enabled: activeTab === "tourism" }
  );
  const maricultureFarmsQuery = stateOps.listMaricultureFarms.useQuery(
    { state: stateParam },
    { enabled: activeTab === "mariculture" }
  );
  const academiesQuery = stateOps.listAcademies.useQuery(
    { state: stateParam },
    { enabled: activeTab === "training" }
  );
  const certificationsQuery = stateOps.listCertifications.useQuery(
    { state: stateParam },
    { enabled: activeTab === "training" }
  );
  const recsQuery = stateOps.listRecs.useQuery(
    { state: stateParam },
    { enabled: activeTab === "energy" }
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
    tourismOperatorsQuery.refetch();
    tourismLeviesQuery.refetch();
    maricultureFarmsQuery.refetch();
    academiesQuery.refetch();
    certificationsQuery.refetch();
    recsQuery.refetch();
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

  // Phase 30 mutations
  const upsertTourismOperatorMutation = stateOps.upsertTourismOperator.useMutation({
    onSuccess: () => { toast.success("Tourism operator saved"); setTourismDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const declareTourismLevyMutation = stateOps.declareTourismLevy.useMutation({
    onSuccess: () => { toast.success("Tourism levy declared"); setLevyDeclareDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertMaricultureFarmMutation = stateOps.upsertMaricultureFarm.useMutation({
    onSuccess: () => { toast.success("Mariculture farm saved"); setFarmDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const upsertAcademyMutation = stateOps.upsertAcademy.useMutation({
    onSuccess: () => { toast.success("Academy saved"); setAcademyDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const issueCertificationMutation = stateOps.issueCertification.useMutation({
    onSuccess: () => { toast.success("Certification issued"); setCertDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const verifyCertificationMutation = stateOps.verifyCertification.useMutation({
    onError: onErr,
  });
  const issueRecMutation = stateOps.issueRec.useMutation({
    onSuccess: () => { toast.success("REC issued"); setRecDialogOpen(false); invalidateAll(); },
    onError: onErr,
  });
  const verifyRecMutation = stateOps.verifyRec.useMutation({
    onError: onErr,
  });
  const markRecSoldMutation = stateOps.markRecSold.useMutation({
    onSuccess: () => { toast.success("REC marked sold"); invalidateAll(); },
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

  // Phase 30 dialog state
  const [tourismDialogOpen, setTourismDialogOpen] = useState(false);
  const [editingTourismOperator, setEditingTourismOperator] = useState<TourismOperator | null>(null);
  const [tourismForm, setTourismForm] = useState({
    state: "Lagos", operatorName: "", operatorType: "beach_resort", site: "",
    licenceFee: "", visitorLevyRate: "", expiresAt: "",
  });

  const [levyDeclareDialogOpen, setLevyDeclareDialogOpen] = useState(false);
  const [levyDeclareForm, setLevyDeclareForm] = useState({ operatorId: "", period: "", visitorCount: "" });

  const [farmDialogOpen, setFarmDialogOpen] = useState(false);
  const [editingFarm, setEditingFarm] = useState<MaricultureFarm | null>(null);
  const [farmForm, setFarmForm] = useState({
    state: "Lagos", operatorName: "", farmType: "seaweed", estateId: "",
    hectares: "", leaseFeeAnnual: "", offTaker: "",
  });

  const [academyDialogOpen, setAcademyDialogOpen] = useState(false);
  const [editingAcademy, setEditingAcademy] = useState<Academy | null>(null);
  const [academyForm, setAcademyForm] = useState({
    state: "Lagos", name: "", programType: "fishery_skills", capacity: "",
  });

  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [certForm, setCertForm] = useState({
    academyId: "", traineeName: "", program: "fishery_skills", certNo: "", feeAmount: "",
  });
  const [certVerificationResults, setCertVerificationResults] = useState<Record<string, boolean>>({});

  const [recDialogOpen, setRecDialogOpen] = useState(false);
  const [recForm, setRecForm] = useState({
    state: "Lagos", projectName: "", source: "tidal", mwh: "", period: "", pricePerMwh: "",
  });
  const [recVerificationResults, setRecVerificationResults] = useState<Record<string, boolean>>({});

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
  const tourismOperators: TourismOperator[] = useMemo(() => (tourismOperatorsQuery.data ?? []) as TourismOperator[], [tourismOperatorsQuery.data]);
  const tourismLevies: TourismLevy[] = useMemo(() => (tourismLeviesQuery.data ?? []) as TourismLevy[], [tourismLeviesQuery.data]);
  const maricultureFarms: MaricultureFarm[] = useMemo(() => (maricultureFarmsQuery.data ?? []) as MaricultureFarm[], [maricultureFarmsQuery.data]);
  const academies: Academy[] = useMemo(() => (academiesQuery.data ?? []) as Academy[], [academiesQuery.data]);
  const certifications: Certification[] = useMemo(() => (certificationsQuery.data ?? []) as Certification[], [certificationsQuery.data]);
  const recs: Rec[] = useMemo(() => (recsQuery.data ?? []) as Rec[], [recsQuery.data]);

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

  // Phase 30 submit handlers
  const submitTourismOperator = () => {
    if (!tourismForm.operatorName || !tourismForm.site) {
      toast.error("Operator name and site are required");
      return;
    }
    upsertTourismOperatorMutation.mutate({
      ...(editingTourismOperator ? { id: editingTourismOperator.id } : {}),
      state: tourismForm.state,
      operatorName: tourismForm.operatorName,
      operatorType: tourismForm.operatorType,
      site: tourismForm.site,
      licenceFee: parseFloat(tourismForm.licenceFee) || 0,
      visitorLevyRate: parseFloat(tourismForm.visitorLevyRate) || 0,
      expiresAt: tourismForm.expiresAt || undefined,
    });
  };

  const submitTourismLevy = () => {
    if (!levyDeclareForm.operatorId || !levyDeclareForm.period) {
      toast.error("Operator and period (YYYY-MM) are required");
      return;
    }
    declareTourismLevyMutation.mutate({
      operatorId: levyDeclareForm.operatorId,
      period: levyDeclareForm.period,
      visitorCount: parseInt(levyDeclareForm.visitorCount, 10) || 0,
    });
  };

  const submitFarm = () => {
    if (!farmForm.operatorName) {
      toast.error("Operator name is required");
      return;
    }
    upsertMaricultureFarmMutation.mutate({
      ...(editingFarm ? { id: editingFarm.id } : {}),
      state: farmForm.state,
      operatorName: farmForm.operatorName,
      farmType: farmForm.farmType,
      estateId: farmForm.estateId || undefined,
      hectares: parseFloat(farmForm.hectares) || 0,
      leaseFeeAnnual: parseFloat(farmForm.leaseFeeAnnual) || 0,
      offTaker: farmForm.offTaker || undefined,
    });
  };

  const submitAcademy = () => {
    if (!academyForm.name) {
      toast.error("Academy name is required");
      return;
    }
    upsertAcademyMutation.mutate({
      ...(editingAcademy ? { id: editingAcademy.id } : {}),
      state: academyForm.state,
      name: academyForm.name,
      programType: academyForm.programType,
      capacity: parseInt(academyForm.capacity, 10) || 0,
    });
  };

  const submitCertification = () => {
    if (!certForm.academyId || !certForm.traineeName) {
      toast.error("Academy and trainee name are required");
      return;
    }
    issueCertificationMutation.mutate({
      academyId: certForm.academyId,
      traineeName: certForm.traineeName,
      program: certForm.program,
      certNo: certForm.certNo || undefined,
      feeAmount: parseFloat(certForm.feeAmount) || 0,
    });
  };

  const handleVerifyCert = (certId: string) => {
    verifyCertificationMutation.mutate(
      { id: certId },
      {
        onSuccess: (res: any) => {
          const valid = !!res?.valid;
          setCertVerificationResults(prev => ({ ...prev, [certId]: valid }));
          if (valid) toast.success("Certification is valid");
          else toast.error("Certification verification failed");
        },
      }
    );
  };

  const submitRec = () => {
    if (!recForm.projectName || !recForm.period) {
      toast.error("Project name and period (YYYY-MM) are required");
      return;
    }
    issueRecMutation.mutate({
      state: recForm.state,
      projectName: recForm.projectName,
      source: recForm.source,
      mwh: parseFloat(recForm.mwh) || 0,
      period: recForm.period,
      pricePerMwh: parseFloat(recForm.pricePerMwh) || 0,
    });
  };

  const handleVerifyRec = (recId: string) => {
    verifyRecMutation.mutate(
      { id: recId },
      {
        onSuccess: (res: any) => {
          const valid = !!res?.valid;
          setRecVerificationResults(prev => ({ ...prev, [recId]: valid }));
          if (valid) toast.success("REC is valid");
          else toast.error("REC verification failed");
        },
      }
    );
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
    tourismLevies: revenueRows.reduce((s, r) => s + (r.tourismLevies ?? 0), 0),
    maricultureLeases: revenueRows.reduce((s, r) => s + (r.maricultureLeases ?? 0), 0),
    trainingFees: revenueRows.reduce((s, r) => s + (r.trainingFees ?? 0), 0),
    recRevenue: revenueRows.reduce((s, r) => s + (r.recRevenue ?? 0), 0),
  }), [revenueRows]);

  const dredgingPermitById = useMemo(() => {
    const map: Record<string, DredgingPermit> = {};
    for (const p of dredgingPermits) map[p.id] = p;
    return map;
  }, [dredgingPermits]);

  const tourismOperatorById = useMemo(() => {
    const map: Record<string, TourismOperator> = {};
    for (const o of tourismOperators) map[o.id] = o;
    return map;
  }, [tourismOperators]);

  const academyById = useMemo(() => {
    const map: Record<string, Academy> = {};
    for (const a of academies) map[a.id] = a;
    return map;
  }, [academies]);
