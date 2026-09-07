/**
 * TransshipmentWizard.tsx — multi-step transshipment declaration wizard
 * (Phase 16 Wave P1). Steps: Manifests → Goods → Review. Follows the
 * NewDeclaration wizard pattern (react-hook-form + zod, per-step field
 * validation via trigger()). Manifest coupling is validated server-side
 * (inbound discharge port === outbound loading port); server errors are
 * surfaced verbatim via toast — never masked.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, CheckCircle, Loader2, Ship } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { z } from "zod";

const schema = z.object({
  inboundManifestNumber: z.string().min(3, "Inbound manifest number is required"),
  outboundManifestNumber: z.string().min(3, "Outbound manifest number is required"),
  goodsDescription: z.string().min(5, "Describe the transshipped goods"),
  hsCode: z.string().regex(/^\d{4,10}$/, "HS code must be 4–10 digits").optional().or(z.literal("")),
  grossWeight: z.string().optional(),
  numberOfPackages: z.string().optional(),
  ucr: z.string().max(64).optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

const STEPS = ["Manifests", "Goods", "Review"];

const STEP_FIELDS: (keyof FormData)[][] = [
  ["inboundManifestNumber", "outboundManifestNumber"],
  ["goodsDescription", "hsCode"],
  [],
];

export default function TransshipmentWizard() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      inboundManifestNumber: "",
      outboundManifestNumber: "",
      goodsDescription: "",
      hsCode: "",
      grossWeight: "",
      numberOfPackages: "",
      ucr: "",
    },
  });

  const createMutation = trpc.transshipment.create.useMutation({
    onSuccess: (data) => {
      toast.success(`Transshipment declaration ${data.declaration.declarationNumber} filed — bonded transfer initiated.`);
      navigate(`/app/transshipment/${data.link.id}`);
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const next = async () => {
    const fields = STEP_FIELDS[step];
    const valid = fields.length === 0 || (await form.trigger(fields));
    if (valid) setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const submit = form.handleSubmit((values) => {
    createMutation.mutate({
      inboundManifestNumber: values.inboundManifestNumber.trim(),
      outboundManifestNumber: values.outboundManifestNumber.trim(),
      goodsDescription: values.goodsDescription,
      hsCode: values.hsCode || undefined,
      grossWeight: values.grossWeight || undefined,
      numberOfPackages: values.numberOfPackages ? Number(values.numberOfPackages) : undefined,
      ucr: values.ucr || undefined,
    });
  });

  const values = form.watch();

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-3xl space-y-6 py-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold"><Ship className="h-6 w-6" /> New transshipment declaration</h1>
          <p className="text-sm text-slate-500">
            Couples one inbound and one outbound manifest through a bonded transfer at the transshipment port.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <Badge key={label} variant={i === step ? "default" : i < step ? "secondary" : "outline"}>
              {i + 1}. {label}
            </Badge>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{STEPS[step]}</CardTitle>
            {step === 0 && (
              <CardDescription>
                The inbound manifest must discharge at the same port where the outbound manifest loads.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <>
                <div>
                  <Label htmlFor="inboundManifestNumber">Inbound manifest number</Label>
                  <Input id="inboundManifestNumber" {...form.register("inboundManifestNumber")} placeholder="e.g. MF-2026-0001" />
                  {form.formState.errors.inboundManifestNumber && (
                    <p className="mt-1 text-xs text-red-400">{form.formState.errors.inboundManifestNumber.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="outboundManifestNumber">Outbound manifest number</Label>
                  <Input id="outboundManifestNumber" {...form.register("outboundManifestNumber")} placeholder="e.g. MF-2026-0042" />
                  {form.formState.errors.outboundManifestNumber && (
                    <p className="mt-1 text-xs text-red-400">{form.formState.errors.outboundManifestNumber.message}</p>
                  )}
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <div>
                  <Label htmlFor="goodsDescription">Goods description</Label>
                  <Textarea id="goodsDescription" {...form.register("goodsDescription")} rows={3} />
                  {form.formState.errors.goodsDescription && (
                    <p className="mt-1 text-xs text-red-400">{form.formState.errors.goodsDescription.message}</p>
                  )}
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="hsCode">HS code (optional)</Label>
                    <Input id="hsCode" {...form.register("hsCode")} placeholder="6–10 digits" />
                    {form.formState.errors.hsCode && (
                      <p className="mt-1 text-xs text-red-400">{form.formState.errors.hsCode.message}</p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="grossWeight">Gross weight kg (optional)</Label>
                    <Input id="grossWeight" {...form.register("grossWeight")} inputMode="decimal" />
                  </div>
                  <div>
                    <Label htmlFor="numberOfPackages">Packages (optional)</Label>
                    <Input id="numberOfPackages" {...form.register("numberOfPackages")} inputMode="numeric" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ucr">UCR (optional)</Label>
                  <Input id="ucr" {...form.register("ucr")} />
                </div>
              </>
            )}
            {step === 2 && (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-slate-500">Inbound manifest</dt><dd className="font-mono">{values.inboundManifestNumber}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Outbound manifest</dt><dd className="font-mono">{values.outboundManifestNumber}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-500">Goods</dt><dd>{values.goodsDescription}</dd></div>
                {values.hsCode && <div className="flex justify-between"><dt className="text-slate-500">HS code</dt><dd className="font-mono">{values.hsCode}</dd></div>}
                <p className="rounded-md border border-slate-700/60 p-2 text-xs text-slate-400">
                  Filing creates the declaration, the manifest coupling and the first bonded-transfer audit record atomically.
                </p>
              </dl>
            )}

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" onClick={() => setStep((s) => Math.max(s - 1, 0))} disabled={step === 0 || createMutation.isPending}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button onClick={next}>
                  Next <ArrowRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={submit} disabled={createMutation.isPending}>
                  {createMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1.5 h-4 w-4" />}
                  File transshipment declaration
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
