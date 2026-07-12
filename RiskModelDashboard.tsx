import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Brain, BarChart2, Target, Zap, AlertTriangle, CheckCircle, Activity, FlaskConical, Trophy, TrendingUp, Plus, Play } from "lucide-react";
import { toast } from "sonner";

const LANE_COLORS: Record<string, string> = {
  AUTO_APPROVE: "bg-green-600 text-white",
  DOC_CHECK: "bg-yellow-500 text-black",
  PHYSICAL_INSPECTION: "bg-red-600 text-white",
};

const TIER_COLORS: Record<string, string> = {
  GREEN: "bg-green-500 text-white",
  YELLOW: "bg-yellow-500 text-black",
  RED: "bg-red-500 text-white",
};

interface RiskScoreResult {
  ucr: string;
  score: number;
  risk_tier: string;
  lane: string;
  aeo_adjusted: boolean;
  feature_contributions: Record<string, number>;
  shap_explanation: Array<{ feature: string; value: number; contribution: number; direction: string }>;
  recommendation: string;
  scored_at: string;
}

interface AbTest {
  testId: string;
  championVersion: string;
  challengerVersion: string;
  trafficSplitPct: number;
  status: string;
  startedAt: string;
  championAccuracy: number;
  challengerAccuracy: number;
  championRequests?: number;
  challengerRequests?: number;
  winner: string | null;
}

interface AbTestResult extends AbTest {
  totalRequests: number;
  lift: number | null;
  statSignificant: boolean;
}

export default function RiskModelDashboard() {
  const [scoreForm, setScoreForm] = useState({
    ucr: "",
    hsCode: "",
    declaredValue: "",
    originCountry: "",
    destCountry: "",
    traderId: "",
    aeoStatus: "none",
    traderDeclarationCount: "0",
    traderViolationCount: "0",
    weightKg: "",
    isExpress: false,
  });
  const [scoreResult, setScoreResult] = useState<RiskScoreResult | null>(null);

  // A/B Test state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createForm, setCreateForm] = useState({ championVersion: "", challengerVersion: "", trafficSplitPct: "10" });
  const [concludeDialog, setConcludeDialog] = useState<{ testId: string; autoPromote: boolean } | null>(null);

  const { data: modelStats, isLoading: loadingStats } = trpc.riskModel.getModelStats.useQuery();
  const { data: featureImportance, isLoading: loadingFeatures } = trpc.riskModel.getFeatureImportance.useQuery();
  const { data: abTests, isLoading: loadingAbTests, refetch: refetchAbTests } = trpc.riskModel.getAbTests.useQuery();
  const { data: abTestResults, isLoading: loadingAbTestResults, refetch: refetchAbTestResults } = trpc.riskModel.getAbTestResults.useQuery();

  const scoreMutation = trpc.riskModel.scoreDeclaration.useMutation({
    onSuccess: (data) => {
      setScoreResult(data as RiskScoreResult);
      toast.success(`Scored: ${(data as RiskScoreResult).risk_tier} lane — score ${(data as RiskScoreResult).score}`);
    },
    onError: () => toast.error("Failed to score declaration"),
  });

  const createAbTestMutation = trpc.riskModel.createAbTest.useMutation({
    onSuccess: () => {
      toast.success("A/B test created successfully");
      setShowCreateDialog(false);
      setCreateForm({ championVersion: "", challengerVersion: "", trafficSplitPct: "10" });
      refetchAbTests();
      refetchAbTestResults();
    },
    onError: (e) => toast.error(`Failed to create A/B test: ${e.message}`),
  });

  const concludeAbTestMutation = trpc.riskModel.concludeAbTest.useMutation({
    onSuccess: (data) => {
      const winnerLabel = data.winner === "challenger" ? "Challenger wins!" : "Champion retains lead";
      toast.success(`Test concluded — ${winnerLabel}${data.autoPromoted ? " (challenger auto-promoted)" : ""}`);
      setConcludeDialog(null);
      refetchAbTests();
      refetchAbTestResults();
    },
    onError: (e) => toast.error(`Failed to conclude test: ${e.message}`),
  });

  const handleScore = () => {
    if (!scoreForm.ucr || !scoreForm.hsCode || !scoreForm.declaredValue || !scoreForm.originCountry || !scoreForm.destCountry || !scoreForm.traderId) {
      toast.error("UCR, HS Code, Declared Value, Origin, Destination, and Trader ID are required");
      return;
    }
    scoreMutation.mutate({
      ucr: scoreForm.ucr,
      hsCode: scoreForm.hsCode,
      declaredValue: parseFloat(scoreForm.declaredValue),
      originCountry: scoreForm.originCountry.toUpperCase().slice(0, 2),
      destCountry: scoreForm.destCountry.toUpperCase().slice(0, 2),
      traderId: scoreForm.traderId,
      aeoStatus: scoreForm.aeoStatus === "none" ? null : scoreForm.aeoStatus as "FULL" | "SECURITY" | "CUSTOMS",
      traderDeclarationCount: parseInt(scoreForm.traderDeclarationCount) || 0,
      traderViolationCount: parseInt(scoreForm.traderViolationCount) || 0,
      weightKg: scoreForm.weightKg ? parseFloat(scoreForm.weightKg) : undefined,
      isExpress: scoreForm.isExpress,
    });
  };

  const stats = modelStats as {
    model_version?: string;
    algorithm?: string;
    feature_count?: number;
    training_samples?: number;
    auc_roc?: number;
    precision?: number;
    recall?: number;
    f1_score?: number;
    last_trained?: string;
    aeo_accuracy_improvement?: number;
  } | undefined;

  const features = (featureImportance as { feature_importance?: Array<{ feature: string; importance: number; weight: number }> } | undefined)?.feature_importance ?? [];
  const tests = (abTests as AbTest[] | undefined) ?? [];
  const results = (abTestResults as AbTestResult[] | undefined) ?? [];

  const statusBadge = (status: string) => {
    if (status === "running") return <Badge className="bg-blue-600 text-white">Running</Badge>;
    if (status === "concluded") return <Badge className="bg-gray-600 text-white">Concluded</Badge>;
    return <Badge variant="outline">{status}</Badge>;
  };

  const winnerBadge = (winner: string | null) => {
    if (!winner) return <span className="text-muted-foreground text-xs">Pending</span>;
    if (winner === "challenger") return <Badge className="bg-green-600 text-white flex items-center gap-1"><Trophy className="h-3 w-3" /> Challenger</Badge>;
    return <Badge className="bg-yellow-600 text-white flex items-center gap-1"><Trophy className="h-3 w-3" /> Champion</Badge>;
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-500" />
            Risk Model Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            XGBoost gradient-boosted ML risk scorer with AEO-aware feature engineering and A/B testing
          </p>
        </div>

        {/* Model Stats */}
        {!loadingStats && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "AUC-ROC", value: stats.auc_roc?.toFixed(4) ?? "—", icon: <Activity className="h-5 w-5 text-blue-400" /> },
              { label: "Precision", value: stats.precision?.toFixed(4) ?? "—", icon: <Target className="h-5 w-5 text-green-400" /> },
              { label: "Recall", value: stats.recall?.toFixed(4) ?? "—", icon: <Zap className="h-5 w-5 text-yellow-400" /> },
              { label: "F1 Score", value: stats.f1_score?.toFixed(4) ?? "—", icon: <BarChart2 className="h-5 w-5 text-purple-400" /> },
            ].map(s => (
              <Card key={s.label} className="bg-card border-border">
                <CardContent className="p-4 flex items-center gap-3">
                  {s.icon}
                  <div>
                    <p className="text-xl font-bold text-foreground">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loadingStats && stats && (
          <Card className="bg-card border-border">
            <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Model Version</p>
                <p className="font-mono font-medium text-foreground">{stats.model_version}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Algorithm</p>
                <p className="font-medium text-foreground text-xs">{stats.algorithm?.split("(")[0].trim()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Training Samples</p>
                <p className="font-medium text-foreground">{stats.training_samples?.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">AEO Accuracy Gain</p>
                <p className="font-medium text-green-400">+{((stats.aeo_accuracy_improvement ?? 0) * 100).toFixed(1)}%</p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="score">
          <TabsList>
            <TabsTrigger value="score">Score Declaration</TabsTrigger>
            <TabsTrigger value="features">Feature Importance</TabsTrigger>
            <TabsTrigger value="ab-tests" className="flex items-center gap-1">
              <FlaskConical className="h-3.5 w-3.5" /> A/B Tests
            </TabsTrigger>
          </TabsList>

          {/* Score Tab */}
          <TabsContent value="score" className="mt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-base">Declaration Features</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">UCR *</Label>
                      <Input placeholder="UCR-2026-001" value={scoreForm.ucr}
                        onChange={e => setScoreForm(f => ({ ...f, ucr: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">HS Code *</Label>
                      <Input placeholder="2939.99" value={scoreForm.hsCode}
                        onChange={e => setScoreForm(f => ({ ...f, hsCode: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Declared Value (USD) *</Label>
                      <Input type="number" placeholder="50000" value={scoreForm.declaredValue}
                        onChange={e => setScoreForm(f => ({ ...f, declaredValue: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Weight (kg)</Label>
                      <Input type="number" placeholder="1200" value={scoreForm.weightKg}
                        onChange={e => setScoreForm(f => ({ ...f, weightKg: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Origin Country *</Label>
                      <Input placeholder="CO" maxLength={2} value={scoreForm.originCountry}
                        onChange={e => setScoreForm(f => ({ ...f, originCountry: e.target.value.toUpperCase() }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Destination *</Label>
                      <Input placeholder="GH" maxLength={2} value={scoreForm.destCountry}
                        onChange={e => setScoreForm(f => ({ ...f, destCountry: e.target.value.toUpperCase() }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Trader ID *</Label>
                      <Input placeholder="TRADER-001" value={scoreForm.traderId}
                        onChange={e => setScoreForm(f => ({ ...f, traderId: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">AEO Status</Label>
                      <Select value={scoreForm.aeoStatus} onValueChange={v => setScoreForm(f => ({ ...f, aeoStatus: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="FULL">AEO Full</SelectItem>
                          <SelectItem value="SECURITY">AEO Security</SelectItem>
                          <SelectItem value="CUSTOMS">AEO Customs</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Declaration Count</Label>
                      <Input type="number" placeholder="150" value={scoreForm.traderDeclarationCount}
                        onChange={e => setScoreForm(f => ({ ...f, traderDeclarationCount: e.target.value }))} />
                    </div>
                    <div>
                      <Label className="text-xs">Violation Count</Label>
                      <Input type="number" placeholder="2" value={scoreForm.traderViolationCount}
                        onChange={e => setScoreForm(f => ({ ...f, traderViolationCount: e.target.value }))} />
                    </div>
                  </div>
                  <Button className="w-full" onClick={handleScore} disabled={scoreMutation.isPending}>
                    {scoreMutation.isPending ? "Scoring…" : "Score Declaration"}
                  </Button>
                </CardContent>
              </Card>

              {scoreResult && (
                <Card className={`border-2 ${scoreResult.risk_tier === "GREEN" ? "border-green-500" : scoreResult.risk_tier === "YELLOW" ? "border-yellow-500" : "border-red-500"}`}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      {scoreResult.risk_tier === "GREEN" ? (
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 text-orange-400" />
                      )}
                      Score Result
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-4xl font-bold text-foreground">{scoreResult.score}</p>
                        <p className="text-xs text-muted-foreground">Risk Score (0–100)</p>
                      </div>
                      <div className="text-right space-y-1">
                        <Badge className={`${TIER_COLORS[scoreResult.risk_tier] ?? "bg-gray-500 text-white"}`}>
                          {scoreResult.risk_tier}
                        </Badge>
                        <br />
                        <Badge className={`text-xs ${LANE_COLORS[scoreResult.lane] ?? "bg-gray-500 text-white"}`}>
                          {scoreResult.lane.replace(/_/g, " ")}
                        </Badge>
                        {scoreResult.aeo_adjusted && (
                          <Badge variant="outline" className="text-xs block">AEO Adjusted</Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{scoreResult.recommendation}</p>

                    {scoreResult.shap_explanation.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-2">Feature Contributions (SHAP)</p>
                        <div className="space-y-1">
                          {scoreResult.shap_explanation.slice(0, 5).map(s => (
                            <div key={s.feature} className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground w-32 shrink-0">{s.feature.replace(/_/g, " ")}</span>
                              <div className="flex-1 bg-muted rounded-full h-2">
                                <div
                                  className="bg-orange-500 h-2 rounded-full"
                                  style={{ width: `${Math.min(s.contribution * 4, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-foreground w-10 text-right">{s.contribution.toFixed(1)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          {/* Feature Importance Tab */}
          <TabsContent value="features" className="mt-4">
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart2 className="h-4 w-4" /> Feature Importance Rankings
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingFeatures ? (
                  <p className="text-muted-foreground text-sm">Loading…</p>
                ) : (
                  <div className="space-y-3">
                    {features.map((f, i) => (
                      <div key={f.feature} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                        <span className="text-sm text-foreground w-40 shrink-0">{f.feature.replace(/_/g, " ")}</span>
                        <div className="flex-1 bg-muted rounded-full h-3">
                          <div
                            className="bg-purple-500 h-3 rounded-full transition-all"
                            style={{ width: `${f.importance * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-foreground w-16 text-right">{(f.importance * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* A/B Tests Tab */}
          <TabsContent value="ab-tests" className="mt-4 space-y-4">
            {/* Summary metrics */}
            {!loadingAbTestResults && results.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: "Total Tests", value: results.length, icon: <FlaskConical className="h-4 w-4 text-blue-400" /> },
                  { label: "Running", value: results.filter(r => r.status === "running").length, icon: <Play className="h-4 w-4 text-green-400" /> },
                  { label: "Concluded", value: results.filter(r => r.status === "concluded").length, icon: <CheckCircle className="h-4 w-4 text-gray-400" /> },
                  { label: "Challenger Wins", value: results.filter(r => r.winner === "challenger").length, icon: <Trophy className="h-4 w-4 text-yellow-400" /> },
                ].map(s => (
                  <Card key={s.label} className="bg-card border-border">
                    <CardContent className="p-4 flex items-center gap-3">
                      {s.icon}
                      <div>
                        <p className="text-2xl font-bold text-foreground">{s.value}</p>
                        <p className="text-xs text-muted-foreground">{s.label}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Create button */}
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2">
                <Plus className="h-4 w-4" /> New A/B Test
              </Button>
            </div>

            {/* Tests table */}
            <Card className="bg-card border-border">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FlaskConical className="h-4 w-4 text-blue-400" /> Active &amp; Historical Experiments
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingAbTests ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                    ))}
                  </div>
                ) : tests.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No A/B tests yet. Create one to compare model versions.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-muted-foreground text-xs">
                          <th className="text-left py-2 pr-4">Test ID</th>
                          <th className="text-left py-2 pr-4">Champion</th>
                          <th className="text-left py-2 pr-4">Challenger</th>
                          <th className="text-right py-2 pr-4">Split</th>
                          <th className="text-right py-2 pr-4">Champion Acc.</th>
                          <th className="text-right py-2 pr-4">Challenger Acc.</th>
                          <th className="text-right py-2 pr-4">Lift</th>
                          <th className="text-center py-2 pr-4">Status</th>
                          <th className="text-center py-2">Winner</th>
                          <th className="text-right py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.map(t => (
                          <tr key={t.testId} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                            <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{t.testId.slice(0, 14)}…</td>
                            <td className="py-2 pr-4 font-mono text-xs">{t.championVersion}</td>
                            <td className="py-2 pr-4 font-mono text-xs">{t.challengerVersion}</td>
                            <td className="py-2 pr-4 text-right text-xs">{t.trafficSplitPct}%</td>
                            <td className="py-2 pr-4 text-right text-xs">
                              {t.championAccuracy > 0 ? (t.championAccuracy * 100).toFixed(2) + "%" : "—"}
                            </td>
                            <td className="py-2 pr-4 text-right text-xs">
                              {t.challengerAccuracy > 0 ? (t.challengerAccuracy * 100).toFixed(2) + "%" : "—"}
                            </td>
                            <td className="py-2 pr-4 text-right text-xs">
                              {t.lift !== null ? (
                                <span className={t.lift >= 0 ? "text-green-400" : "text-red-400"}>
                                  {t.lift >= 0 ? "+" : ""}{t.lift.toFixed(2)}%
                                  {t.statSignificant && <span className="ml-1 text-blue-400">✓</span>}
                                </span>
                              ) : "—"}
                            </td>
                            <td className="py-2 pr-4 text-center">{statusBadge(t.status)}</td>
                            <td className="py-2 text-center">{winnerBadge(t.winner)}</td>
                            <td className="py-2 text-right">
                              {t.status === "running" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs h-7"
                                  onClick={() => setConcludeDialog({ testId: t.testId, autoPromote: false })}
                                >
                                  Conclude
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Accuracy comparison chart for concluded tests */}
            {results.filter(r => r.status === "concluded" && r.championAccuracy > 0).length > 0 && (
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-green-400" /> Accuracy Comparison — Concluded Tests
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {results.filter(r => r.status === "concluded" && r.championAccuracy > 0).map(t => (
                      <div key={t.testId} className="space-y-2">
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span className="font-mono">{t.testId.slice(0, 18)}…</span>
                          <span>{winnerBadge(t.winner)}</span>
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs w-20 text-muted-foreground">Champion</span>
                            <div className="flex-1 bg-muted rounded-full h-4 relative overflow-hidden">
                              <div
                                className="bg-blue-500 h-4 rounded-full transition-all"
                                style={{ width: `${t.championAccuracy * 100}%` }}
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                                {(t.championAccuracy * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs w-20 text-muted-foreground">Challenger</span>
                            <div className="flex-1 bg-muted rounded-full h-4 relative overflow-hidden">
                              <div
                                className={`h-4 rounded-full transition-all ${t.winner === "challenger" ? "bg-green-500" : "bg-orange-500"}`}
                                style={{ width: `${t.challengerAccuracy * 100}%` }}
                              />
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                                {(t.challengerAccuracy * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Create A/B Test Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5 text-blue-400" /> Create A/B Test
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs">Champion Version *</Label>
              <Input
                placeholder="e.g. v2.1.0"
                value={createForm.championVersion}
                onChange={e => setCreateForm(f => ({ ...f, championVersion: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Challenger Version *</Label>
              <Input
                placeholder="e.g. v2.2.0-beta"
                value={createForm.challengerVersion}
                onChange={e => setCreateForm(f => ({ ...f, challengerVersion: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Traffic Split to Challenger (%)</Label>
              <Input
                type="number"
                min="1"
                max="50"
                placeholder="10"
                value={createForm.trafficSplitPct}
                onChange={e => setCreateForm(f => ({ ...f, trafficSplitPct: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {createForm.trafficSplitPct}% of traffic goes to challenger, {100 - parseInt(createForm.trafficSplitPct || "10")}% to champion
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createAbTestMutation.mutate({
                championVersion: createForm.championVersion,
                challengerVersion: createForm.challengerVersion,
                trafficSplitPct: parseInt(createForm.trafficSplitPct) || 10,
              })}
              disabled={createAbTestMutation.isPending || !createForm.championVersion || !createForm.challengerVersion}
            >
              {createAbTestMutation.isPending ? "Creating…" : "Create Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conclude A/B Test Dialog */}
      <Dialog open={!!concludeDialog} onOpenChange={() => setConcludeDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-400" /> Conclude A/B Test
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-4">
            <p className="text-sm text-muted-foreground">
              This will finalize the test by comparing champion vs. challenger accuracy metrics and declaring a winner.
            </p>
            <div className="flex items-center gap-3">
              <Switch
                checked={concludeDialog?.autoPromote ?? false}
                onCheckedChange={v => setConcludeDialog(d => d ? { ...d, autoPromote: v } : null)}
              />
              <div>
                <p className="text-sm font-medium text-foreground">Auto-promote challenger if it wins</p>
                <p className="text-xs text-muted-foreground">Automatically sets challenger as the new champion model</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConcludeDialog(null)}>Cancel</Button>
            <Button
              onClick={() => concludeDialog && concludeAbTestMutation.mutate({
                testId: concludeDialog.testId,
                autoPromote: concludeDialog.autoPromote,
              })}
              disabled={concludeAbTestMutation.isPending}
            >
              {concludeAbTestMutation.isPending ? "Concluding…" : "Conclude Test"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
