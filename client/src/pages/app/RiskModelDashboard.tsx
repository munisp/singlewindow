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
import { Brain, BarChart2, Target, Zap, AlertTriangle, CheckCircle, Activity } from "lucide-react";
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

  const { data: modelStats, isLoading: loadingStats } = trpc.riskModel.getModelStats.useQuery();
  const { data: featureImportance, isLoading: loadingFeatures } = trpc.riskModel.getFeatureImportance.useQuery();

  const scoreMutation = trpc.riskModel.scoreDeclaration.useMutation({
    onSuccess: (data) => {
      setScoreResult(data as RiskScoreResult);
      toast.success(`Scored: ${(data as RiskScoreResult).risk_tier} lane — score ${(data as RiskScoreResult).score}`);
    },
    onError: () => toast.error("Failed to score declaration"),
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
            XGBoost gradient-boosted ML risk scorer with AEO-aware feature engineering
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
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
