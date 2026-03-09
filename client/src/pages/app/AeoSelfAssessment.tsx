/**
 * AEO Self-Assessment Questionnaire — Sprint 58
 * WCO SAFE Framework 4-pillar multi-step wizard:
 *   1. Company Details
 *   2. Financial Solvency (4 questions)
 *   3. Compliance Record (4 questions)
 *   4. Security Standards (4 questions)
 *   5. Logistics Competence (4 questions)
 *   6. Results + PDF Export
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Shield, CheckCircle2, ChevronRight, ChevronLeft, Award,
  FileText, DollarSign, Lock, TrendingUp, Download, Star,
} from "lucide-react";

const PILLAR_ICONS: Record<string, React.ReactNode> = {
  financial_solvency:  <DollarSign className="w-5 h-5 text-green-400" />,
  compliance_record:   <Shield className="w-5 h-5 text-blue-400" />,
  security_standards:  <Lock className="w-5 h-5 text-purple-400" />,
  logistics_competence:<TrendingUp className="w-5 h-5 text-orange-400" />,
};

const TIER_THRESHOLDS: Record<string, number> = { standard: 60, silver: 75, gold: 90 };
const TIER_COLOR: Record<string, string> = {
  standard: "text-blue-400",
  silver:   "text-slate-300",
  gold:     "text-amber-400",
};

type AssessmentResult = {
  overallScore: number;
  pillarScores: Record<string, number>;
  eligibleTiers: string[];
  recommendation: string;
  assessedAt: string;
  applicantName: string;
  companyName: string;
  registrationNo: string;
  targetTier: string;
};

export default function AeoSelfAssessment() {
  const [step, setStep] = useState(0); // 0=details, 1-4=pillars, 5=results
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [applicantName, setApplicantName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [registrationNo, setRegistrationNo] = useState("");
  const [targetTier, setTargetTier] = useState<"standard" | "silver" | "gold">("standard");
  const [result, setResult] = useState<AssessmentResult | null>(null);

  const questionsQ = trpc.aeo.getSelfAssessmentQuestions.useQuery();
  const submitMut = trpc.aeo.submitSelfAssessment.useMutation({
    onSuccess: (data) => {
      setResult(data as AssessmentResult);
      setStep(5);
    },
    onError: (e) => toast.error(e.message),
  });

  const pillars = questionsQ.data?.pillars ?? [];
  const totalSteps = pillars.length + 2; // details + pillars + results
  const progressPct = step === 0 ? 5 : step === 5 ? 100 : Math.round((step / (pillars.length + 1)) * 95) + 5;

  const currentPillar = step >= 1 && step <= pillars.length ? pillars[step - 1] : null;

  const toggleAnswer = (qId: string) => {
    setAnswers((prev) => ({ ...prev, [qId]: !prev[qId] }));
  };

  const canProceed = () => {
    if (step === 0) return applicantName.trim() && companyName.trim() && registrationNo.trim();
    return true; // questions are optional (unanswered = No)
  };

  const handleNext = () => {
    if (step < pillars.length) {
      setStep(step + 1);
    } else if (step === pillars.length) {
      // Submit
      submitMut.mutate({ answers, applicantName, companyName, registrationNo, targetTier });
    }
  };

  const handleExportPDF = () => {
    if (!result) return;
    // Build a simple text-based PDF summary
    const lines = [
      "WCO SAFE FRAMEWORK SELF-ASSESSMENT REPORT",
      "==========================================",
      "",
      `Company: ${result.companyName}`,
      `Registration No: ${result.registrationNo}`,
      `Applicant: ${result.applicantName}`,
      `Target Tier: ${result.targetTier.toUpperCase()}`,
      `Assessed At: ${new Date(result.assessedAt).toLocaleString()}`,
      "",
      `OVERALL SCORE: ${result.overallScore}%`,
      "",
      "PILLAR SCORES:",
      ...Object.entries(result.pillarScores).map(([k, v]) => `  ${k.replace(/_/g, " ").toUpperCase()}: ${v}%`),
      "",
      `ELIGIBLE TIERS: ${result.eligibleTiers.map(t => t.toUpperCase()).join(", ") || "None"}`,
      "",
      "RECOMMENDATION:",
      result.recommendation,
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `AEO-Self-Assessment-${result.companyName.replace(/\s+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Assessment report downloaded");
  };

  return (
    <DashboardLayout>
      <div className="p-6 max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            AEO Self-Assessment Questionnaire
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            WCO SAFE Framework — 4-pillar self-assessment for Authorised Economic Operator eligibility
          </p>
        </div>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {step === 0 ? "Company Details" : step === 5 ? "Results" : `Pillar ${step} of ${pillars.length}: ${currentPillar?.label}`}
            </span>
            <span>{progressPct}%</span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </div>

        {/* Step 0: Company Details */}
        {step === 0 && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> Company Details
              </CardTitle>
              <CardDescription>Enter your company information to begin the self-assessment</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Applicant Name *</Label>
                <Input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} placeholder="John Doe" />
              </div>
              <div>
                <Label>Company Name *</Label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Trading Ltd." />
              </div>
              <div>
                <Label>Business Registration Number *</Label>
                <Input value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)} placeholder="GH-REG-2024-001" />
              </div>
              <div>
                <Label>Target AEO Tier</Label>
                <Select value={targetTier} onValueChange={(v) => setTargetTier(v as typeof targetTier)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard AEO (≥60%)</SelectItem>
                    <SelectItem value="silver">Silver AEO (≥75%)</SelectItem>
                    <SelectItem value="gold">Gold AEO (≥90%)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Steps 1-4: Pillar Questions */}
        {currentPillar && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                {PILLAR_ICONS[currentPillar.id]}
                {currentPillar.label}
              </CardTitle>
              <CardDescription>{currentPillar.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentPillar.questions.map((q: { id: string; text: string; weight: number }) => (
                <div key={q.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/20 border border-border">
                  <Checkbox
                    id={q.id}
                    checked={!!answers[q.id]}
                    onCheckedChange={() => toggleAnswer(q.id)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label htmlFor={q.id} className="text-sm leading-relaxed cursor-pointer">
                      {q.text}
                    </Label>
                    <p className="text-xs text-muted-foreground mt-1">Weight: {Math.round(q.weight * 100)}%</p>
                  </div>
                  {answers[q.id] && <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Step 5: Results */}
        {step === 5 && result && (
          <div className="space-y-4">
            {/* Overall Score */}
            <Card className="bg-card border-border">
              <CardContent className="p-6 text-center">
                <div className="text-5xl font-bold text-foreground mb-2">{result.overallScore}%</div>
                <p className="text-muted-foreground text-sm">Overall WCO SAFE Framework Score</p>
                <div className="flex justify-center gap-2 mt-3">
                  {["standard", "silver", "gold"].map((tier) => (
                    <Badge
                      key={tier}
                      variant={result.eligibleTiers.includes(tier) ? "default" : "outline"}
                      className={result.eligibleTiers.includes(tier) ? TIER_COLOR[tier] : "opacity-40"}
                    >
                      {tier.charAt(0).toUpperCase() + tier.slice(1)} AEO {result.eligibleTiers.includes(tier) ? "✓" : `(${TIER_THRESHOLDS[tier]}%)`}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Pillar Breakdown */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Pillar Scores</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(result.pillarScores).map(([pillarId, score]) => (
                  <div key={pillarId}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="flex items-center gap-2">
                        {PILLAR_ICONS[pillarId]}
                        {pillarId.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                      </span>
                      <span className={score >= 75 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400"}>
                        {score}%
                      </span>
                    </div>
                    <Progress value={score} className="h-2" />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Recommendation */}
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Star className="w-4 h-4 text-amber-400" /> Recommendation</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-foreground">{result.recommendation}</p>
                <div className="flex gap-2 mt-4">
                  <Button onClick={handleExportPDF} variant="outline" className="gap-2">
                    <Download className="w-4 h-4" /> Export Report
                  </Button>
                  <Button onClick={() => { setStep(0); setAnswers({}); setResult(null); }} variant="ghost">
                    Start Over
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Navigation */}
        {step < 5 && (
          <div className="flex justify-between">
            <Button
              variant="outline"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="gap-2"
            >
              <ChevronLeft className="w-4 h-4" /> Back
            </Button>
            <Button
              onClick={handleNext}
              disabled={!canProceed() || submitMut.isPending}
              className="gap-2"
            >
              {step === pillars.length ? (
                submitMut.isPending ? "Calculating…" : "Submit Assessment"
              ) : (
                <>Next <ChevronRight className="w-4 h-4" /></>
              )}
            </Button>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
