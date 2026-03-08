/**
 * NewDeclaration.tsx — Multi-step declaration form with AI risk scoring
 * After submission, automatically calls the AI risk engine and shows the
 * risk score, lane assignment, and recommended action before redirecting.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FileText,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { z } from "zod";

const schema = z.object({
  declarationType: z.enum(["import", "export", "transit", "re_export"]),
  importerName: z.string().min(2),
  importerTin: z.string().min(5),
  exporterName: z.string().min(2),
  exporterCountry: z.string().min(2),
  portOfEntry: z.string().min(2),
  portOfLoading: z.string().min(2),
  countryOfOrigin: z.string().min(2),
  countryOfDestination: z.string().min(2),
  hsCode: z.string().min(6),
  goodsDescription: z.string().min(10),
  grossWeight: z.number().positive(),
  netWeight: z.number().positive(),
  numberOfPackages: z.number().int().positive(),
  packageType: z.string().min(2),
  invoiceValue: z.number().positive(),
  invoiceCurrency: z.string().length(3),
  freightCost: z.number().min(0),
  insuranceCost: z.number().min(0),
  incoterms: z.string().min(2),
  modeOfTransport: z.enum(["sea", "air", "road", "rail", "multimodal"]),
  vesselName: z.string().optional(),
  voyageNumber: z.string().optional(),
  billOfLadingNumber: z.string().optional(),
  containerNumbers: z.string().optional(),
  specialInstructions: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

const STEPS = ["Parties", "Goods", "Transport", "Financial", "Review"];

// ─── RISK RESULT PANEL ───────────────────────────────────────────────────────

type RiskResult = {
  riskScore: number;
  riskLane: string;
  riskFactors: string[];
  recommendedAction: string;
  reasoning: string;
  hsCodeValid: boolean;
  valuationFlag: boolean;
  originRisk: string;
  declarationId: string;
  model?: string;
};

const LANE_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType; bg: string }> = {
  GREEN: { label: "Green Lane", color: "text-emerald-600", icon: ShieldCheck, bg: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800" },
  YELLOW: { label: "Yellow Lane", color: "text-amber-600", icon: ShieldQuestion, bg: "bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800" },
  RED: { label: "Red Lane", color: "text-red-600", icon: ShieldAlert, bg: "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800" },
  BLUE: { label: "Blue Lane", color: "text-blue-600", icon: ShieldCheck, bg: "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800" },
};

function RiskResultPanel({
  result,
  declarationId,
  onContinue,
}: {
  result: RiskResult;
  declarationId: number;
  onContinue: () => void;
}) {
  const lane = LANE_CONFIG[result.riskLane] ?? LANE_CONFIG["YELLOW"];
  const LaneIcon = lane.icon;
  const scoreColor =
    result.riskScore < 30 ? "text-emerald-600" :
    result.riskScore < 60 ? "text-amber-600" :
    "text-red-600";

  return (
    <Card className={`border-2 ${lane.bg}`}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          AI Risk Assessment Complete
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score + Lane */}
        <div className="flex items-center gap-6">
          <div className="text-center">
            <div className={`text-4xl font-bold ${scoreColor}`}>{result.riskScore}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Risk Score</div>
          </div>
          <div className="flex items-center gap-2">
            <LaneIcon className={`h-6 w-6 ${lane.color}`} />
            <div>
              <div className={`font-semibold ${lane.color}`}>{lane.label}</div>
              <div className="text-xs text-muted-foreground">
                Action: <span className="font-medium">{result.recommendedAction.replace(/_/g, " ")}</span>
              </div>
            </div>
          </div>
          <div className="ml-auto flex flex-col gap-1 text-xs">
            <Badge variant={result.hsCodeValid ? "default" : "destructive"} className="text-xs">
              HS Code {result.hsCodeValid ? "Valid" : "Invalid"}
            </Badge>
            {result.valuationFlag && (
              <Badge variant="destructive" className="text-xs">
                <AlertTriangle className="h-3 w-3 mr-1" /> Valuation Flag
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              Origin Risk: {result.originRisk}
            </Badge>
          </div>
        </div>

        {/* Reasoning */}
        <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
          {result.reasoning}
        </div>

        {/* Risk Factors */}
        {result.riskFactors.length > 0 && (
          <div>
            <p className="text-xs font-medium mb-1.5">Risk Factors Identified</p>
            <ul className="space-y-1">
              {result.riskFactors.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.model && (
          <p className="text-xs text-muted-foreground">Scored by: {result.model}</p>
        )}

        <Button onClick={onContinue} className="w-full gap-2">
          <CheckCircle className="h-4 w-4" />
          View Declaration Details
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function NewDeclaration() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [createdDeclarationId, setCreatedDeclarationId] = useState<number | null>(null);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [isScoring, setIsScoring] = useState(false);
  const utils = trpc.useUtils();

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      declarationType: "import",
      modeOfTransport: "sea",
      invoiceCurrency: "USD",
      freightCost: 0,
      insuranceCost: 0,
    },
  });

  const scoreRiskMutation = trpc.ai.scoreRisk.useMutation({
    onSuccess: (data) => {
      setRiskResult(data as RiskResult);
      setIsScoring(false);
    },
    onError: () => {
      setIsScoring(false);
      // Non-fatal: skip risk scoring, proceed to declaration detail
      if (createdDeclarationId) {
        setLocation(`/app/trader/declarations/${createdDeclarationId}`);
      }
    },
  });

  const createMutation = trpc.declarations.create.useMutation({
    onSuccess: (data) => {
      utils.declarations.myDeclarations.invalidate();
      toast.success("Declaration submitted successfully", {
        description: `Reference: ${data.declarationNumber}`,
      });
      setCreatedDeclarationId(data.id);
      // Trigger AI risk scoring
      setIsScoring(true);
      const formData = watch();
      scoreRiskMutation.mutate({
        declarationId: data.declarationNumber,
        hsCode: formData.hsCode,
        goodsDescription: formData.goodsDescription,
        countryOfOrigin: formData.countryOfOrigin,
        consigneeCountry: formData.countryOfDestination,
        declaredValue: formData.invoiceValue,
        weight: formData.grossWeight,
      });
    },
    onError: (err) => {
      toast.error("Failed to submit declaration", { description: err.message });
    },
  });

  const onSubmit = (data: FormData) => {
    createMutation.mutate({
      declarationType: data.declarationType,
      hsCode: data.hsCode,
      goodsDescription: data.goodsDescription,
      countryOfOrigin: data.countryOfOrigin,
      countryOfDestination: data.countryOfDestination,
      portOfEntry: data.portOfEntry,
      grossWeight: data.grossWeight,
      netWeight: data.netWeight,
      numberOfPackages: data.numberOfPackages,
      invoiceValue: data.invoiceValue,
      invoiceCurrency: data.invoiceCurrency,
    });
  };

  // If risk result is ready, show the risk panel
  if (riskResult && createdDeclarationId) {
    return (
      <DashboardLayout title="Risk Assessment">
        <div className="max-w-2xl space-y-6">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Risk Assessment Result</h1>
              <p className="text-sm text-muted-foreground">
                AI-powered WCO SAFE Framework risk analysis for your declaration
              </p>
            </div>
          </div>
          <RiskResultPanel
            result={riskResult}
            declarationId={createdDeclarationId}
            onContinue={() => setLocation(`/app/trader/declarations/${createdDeclarationId}`)}
          />
        </div>
      </DashboardLayout>
    );
  }

  // If submitted and scoring in progress, show loading state
  if (isScoring || createMutation.isPending) {
    return (
      <DashboardLayout title="Processing Declaration">
        <div className="max-w-2xl">
          <Card>
            <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-semibold">
                  {createMutation.isPending ? "Submitting declaration..." : "Running AI risk assessment..."}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {createMutation.isPending
                    ? "Assigning Unique Reference Number and registering with customs system"
                    : "Analysing HS code, origin, value, and trader profile against WCO SAFE Framework"}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title="New Declaration">
      <div className="max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/app/trader")} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">New Declaration</h1>
            <p className="text-sm text-muted-foreground">Submit a customs declaration for clearance</p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                i < step ? "bg-primary text-primary-foreground" :
                i === step ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                "bg-muted text-muted-foreground"
              }`}>
                {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
              </div>
              <span className={`text-sm hidden sm:block ${i === step ? "font-medium" : "text-muted-foreground"}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="h-px w-6 bg-border" />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> {STEPS[step]}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Step 0: Parties */}
              {step === 0 && (
                <>
                  <div className="grid gap-2">
                    <Label>Declaration Type</Label>
                    <Select defaultValue="import" onValueChange={v => setValue("declarationType", v as any)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="import">Import</SelectItem>
                        <SelectItem value="export">Export</SelectItem>
                        <SelectItem value="transit">Transit</SelectItem>
                        <SelectItem value="re_export">Re-Export</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Importer Name *</Label>
                      <Input {...register("importerName")} placeholder="Company name" />
                      {errors.importerName && <p className="text-xs text-destructive">{errors.importerName.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Importer TIN *</Label>
                      <Input {...register("importerTin")} placeholder="Tax identification number" />
                      {errors.importerTin && <p className="text-xs text-destructive">{errors.importerTin.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Exporter Name *</Label>
                      <Input {...register("exporterName")} placeholder="Exporter company" />
                      {errors.exporterName && <p className="text-xs text-destructive">{errors.exporterName.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Exporter Country *</Label>
                      <Input {...register("exporterCountry")} placeholder="e.g. China" />
                      {errors.exporterCountry && <p className="text-xs text-destructive">{errors.exporterCountry.message}</p>}
                    </div>
                  </div>
                </>
              )}

              {/* Step 1: Goods */}
              {step === 1 && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>HS Code *</Label>
                      <Input {...register("hsCode")} placeholder="e.g. 8471.30.00" />
                      {errors.hsCode && <p className="text-xs text-destructive">{errors.hsCode.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Country of Origin *</Label>
                      <Input {...register("countryOfOrigin")} placeholder="e.g. CN" />
                      {errors.countryOfOrigin && <p className="text-xs text-destructive">{errors.countryOfOrigin.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Country of Destination *</Label>
                      <Input {...register("countryOfDestination")} placeholder="e.g. GH" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Number of Packages *</Label>
                      <Input type="number" {...register("numberOfPackages", { valueAsNumber: true })} />
                      {errors.numberOfPackages && <p className="text-xs text-destructive">{errors.numberOfPackages.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Gross Weight (kg) *</Label>
                      <Input type="number" step="0.01" {...register("grossWeight", { valueAsNumber: true })} />
                      {errors.grossWeight && <p className="text-xs text-destructive">{errors.grossWeight.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Net Weight (kg) *</Label>
                      <Input type="number" step="0.01" {...register("netWeight", { valueAsNumber: true })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Package Type *</Label>
                      <Input {...register("packageType")} placeholder="e.g. Cartons, Pallets" />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Goods Description *</Label>
                    <Textarea {...register("goodsDescription")} placeholder="Detailed description of goods" rows={3} />
                    {errors.goodsDescription && <p className="text-xs text-destructive">{errors.goodsDescription.message}</p>}
                  </div>
                </>
              )}

              {/* Step 2: Transport */}
              {step === 2 && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Mode of Transport *</Label>
                      <Select defaultValue="sea" onValueChange={v => setValue("modeOfTransport", v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sea">Sea</SelectItem>
                          <SelectItem value="air">Air</SelectItem>
                          <SelectItem value="road">Road</SelectItem>
                          <SelectItem value="rail">Rail</SelectItem>
                          <SelectItem value="multimodal">Multimodal</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Port of Entry *</Label>
                      <Input {...register("portOfEntry")} placeholder="e.g. Tema Port" />
                      {errors.portOfEntry && <p className="text-xs text-destructive">{errors.portOfEntry.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Port of Loading *</Label>
                      <Input {...register("portOfLoading")} placeholder="e.g. Shanghai" />
                      {errors.portOfLoading && <p className="text-xs text-destructive">{errors.portOfLoading.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Vessel Name</Label>
                      <Input {...register("vesselName")} placeholder="e.g. MSC Gülsün" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Voyage Number</Label>
                      <Input {...register("voyageNumber")} placeholder="e.g. 2024-001" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Bill of Lading Number</Label>
                      <Input {...register("billOfLadingNumber")} placeholder="e.g. MAEU123456789" />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Container Numbers</Label>
                    <Input {...register("containerNumbers")} placeholder="e.g. TCKU3953461, MSCU4567890" />
                  </div>
                </>
              )}

              {/* Step 3: Financial */}
              {step === 3 && (
                <>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Invoice Value *</Label>
                      <Input type="number" step="0.01" {...register("invoiceValue", { valueAsNumber: true })} />
                      {errors.invoiceValue && <p className="text-xs text-destructive">{errors.invoiceValue.message}</p>}
                    </div>
                    <div className="grid gap-2">
                      <Label>Currency *</Label>
                      <Input {...register("invoiceCurrency")} placeholder="USD" maxLength={3} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Freight Cost</Label>
                      <Input type="number" step="0.01" {...register("freightCost", { valueAsNumber: true })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Insurance Cost</Label>
                      <Input type="number" step="0.01" {...register("insuranceCost", { valueAsNumber: true })} />
                    </div>
                    <div className="grid gap-2">
                      <Label>Incoterms *</Label>
                      <Input {...register("incoterms")} placeholder="e.g. CIF, FOB, EXW" />
                      {errors.incoterms && <p className="text-xs text-destructive">{errors.incoterms.message}</p>}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Special Instructions</Label>
                    <Textarea {...register("specialInstructions")} placeholder="Any special handling or customs notes" rows={3} />
                  </div>
                </>
              )}

              {/* Step 4: Review */}
              {step === 4 && (
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Please review your declaration details before submitting. Once submitted, the declaration will be assigned a Unique Reference Number (URN) and automatically assessed by the AI risk engine.
                  </p>
                  <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                    {[
                      ["Type", watch("declarationType")?.toUpperCase()],
                      ["Importer", watch("importerName")],
                      ["TIN", watch("importerTin")],
                      ["Exporter", `${watch("exporterName")} (${watch("exporterCountry")})`],
                      ["HS Code", watch("hsCode")],
                      ["Goods", watch("goodsDescription")],
                      ["Weight", `${watch("grossWeight")} kg gross / ${watch("netWeight")} kg net`],
                      ["Invoice Value", `${watch("invoiceCurrency")} ${watch("invoiceValue")?.toLocaleString()}`],
                      ["Port of Entry", watch("portOfEntry")],
                      ["Transport", watch("modeOfTransport")?.toUpperCase()],
                    ].map(([label, value]) => (
                      <div key={label} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium text-right max-w-[60%] truncate">{value || "—"}</span>
                      </div>
                    ))}
                  </div>
                  {/* AI scoring notice */}
                  <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                    <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-muted-foreground">
                      After submission, the AI risk engine will automatically analyse this declaration against WCO SAFE Framework criteria and assign a risk lane (Green / Yellow / Red).
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Navigation buttons */}
          <div className="flex justify-between mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => step > 0 ? setStep(s => s - 1) : setLocation("/app/trader")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" /> {step === 0 ? "Cancel" : "Back"}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button type="button" onClick={() => setStep(s => s + 1)} className="gap-2">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={createMutation.isPending} className="gap-2">
                {createMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                ) : (
                  <><Zap className="h-4 w-4" /> Submit & Score Risk</>
                )}
              </Button>
            )}
          </div>
        </form>
      </div>
    </DashboardLayout>
  );
}
