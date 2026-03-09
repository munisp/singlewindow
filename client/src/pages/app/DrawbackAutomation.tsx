/**
 * Sprint 60 — Duty Drawback Automation
 * Eligibility Checker + Refund Calculator + PDF Claim Summary
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2, XCircle, Calculator, FileText, ArrowRight,
  DollarSign, Percent, Info,
} from "lucide-react";

type DrawbackType = "manufacturing" | "unused_merchandise" | "rejected_merchandise" | "substitution";

const DRAWBACK_TYPE_LABELS: Record<DrawbackType, string> = {
  manufacturing: "Manufacturing Drawback (99%)",
  unused_merchandise: "Unused Merchandise (99%)",
  rejected_merchandise: "Rejected Merchandise (100%)",
  substitution: "Substitution Drawback (99%)",
};

// ─── ELIGIBILITY CHECKER ─────────────────────────────────────────────────────

function EligibilityChecker() {
  const [importDeclId, setImportDeclId] = useState("");
  const [drawbackType, setDrawbackType] = useState<DrawbackType>("manufacturing");
  const [checkId, setCheckId] = useState<number | null>(null);
  const [checkType, setCheckType] = useState<DrawbackType>("manufacturing");

  const eligibilityQ = trpc.drawback.checkEligibility.useQuery(
    { importDeclarationId: checkId!, drawbackType: checkType },
    { enabled: checkId !== null }
  );

  function handleCheck() {
    const id = parseInt(importDeclId);
    if (!isNaN(id) && id > 0) {
      setCheckId(id);
      setCheckType(drawbackType);
    }
  }

  const result = eligibilityQ.data;

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            Eligibility Checker
          </CardTitle>
          <CardDescription>
            Enter an import declaration ID to check if it qualifies for duty drawback.
            The engine verifies ownership, clearance status, existing claims, and the 3-year filing deadline.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Import Declaration ID</Label>
              <Input
                type="number"
                placeholder="e.g. 1042"
                value={importDeclId}
                onChange={(e) => setImportDeclId(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Drawback Type</Label>
              <Select value={drawbackType} onValueChange={(v) => setDrawbackType(v as DrawbackType)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DRAWBACK_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleCheck} disabled={!importDeclId || eligibilityQ.isFetching} className="w-full gap-2">
                <ArrowRight className="w-4 h-4" />
                {eligibilityQ.isFetching ? "Checking…" : "Check Eligibility"}
              </Button>
            </div>
          </div>

          {result && (
            <div className={`p-4 rounded-lg border ${result.eligible ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
              <div className="flex items-center gap-2 mb-3">
                {result.eligible
                  ? <CheckCircle2 className="w-5 h-5 text-green-400" />
                  : <XCircle className="w-5 h-5 text-red-400" />}
                <span className={`font-semibold ${result.eligible ? "text-green-400" : "text-red-400"}`}>
                  {result.eligible ? "Eligible for Duty Drawback" : "Not Eligible"}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{result.reason}</p>
              {result.eligible && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Declaration #", value: result.declarationNumber ?? "—" },
                    { label: "HS Code", value: result.hsCode ?? "—" },
                    { label: "Duty Paid", value: `USD ${result.dutyPaid?.toLocaleString() ?? 0}` },
                    { label: "Est. Refund", value: `USD ${result.estimatedRefund?.toLocaleString() ?? 0}` },
                  ].map((item) => (
                    <div key={item.label} className="bg-background/50 rounded p-2">
                      <div className="text-xs text-muted-foreground">{item.label}</div>
                      <div className="text-sm font-medium">{item.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Eligibility Rules Reference */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            Eligibility Rules (CEMA Section 118)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            {[
              { rule: "Declaration must be cleared", detail: "Status must be 'cleared' before filing" },
              { rule: "Trader ownership required", detail: "Only the importer of record may file" },
              { rule: "No duplicate claims", detail: "One active claim per import declaration" },
              { rule: "3-year filing deadline", detail: "Must file within 3 years of clearance date" },
              { rule: "Manufacturing drawback", detail: "99% of duty paid on imported materials used in manufacture" },
              { rule: "Rejected merchandise", detail: "100% refund for goods returned as defective" },
            ].map((item) => (
              <div key={item.rule} className="flex gap-2 p-2 rounded bg-muted/20">
                <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium text-xs">{item.rule}</div>
                  <div className="text-xs text-muted-foreground">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── REFUND CALCULATOR ────────────────────────────────────────────────────────

function RefundCalculator() {
  const [drawbackType, setDrawbackType] = useState<DrawbackType>("manufacturing");
  const [dutyPaid, setDutyPaid] = useState("");
  const [importQty, setImportQty] = useState("");
  const [exportQty, setExportQty] = useState("");
  const [calcParams, setCalcParams] = useState<{
    drawbackType: DrawbackType; dutyPaid: number;
    importQuantity?: number; exportQuantity?: number;
  } | null>(null);

  const calcQ = trpc.drawback.calculateRefund.useQuery(calcParams!, { enabled: calcParams !== null });

  function handleCalculate() {
    const duty = parseFloat(dutyPaid);
    if (isNaN(duty) || duty <= 0) return;
    setCalcParams({
      drawbackType,
      dutyPaid: duty,
      importQuantity: importQty ? parseFloat(importQty) : undefined,
      exportQuantity: exportQty ? parseFloat(exportQty) : undefined,
    });
  }

  const result = calcQ.data;

  return (
    <div className="space-y-6">
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Calculator className="w-4 h-4 text-blue-400" />
            Refund Calculator
          </CardTitle>
          <CardDescription>
            Calculate the net refund amount before submitting a claim. Supports partial quantity claims.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Drawback Type</Label>
              <Select value={drawbackType} onValueChange={(v) => setDrawbackType(v as DrawbackType)}>
                <SelectTrigger className="bg-background border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DRAWBACK_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Original Duty Paid (USD)</Label>
              <Input
                type="number"
                placeholder="e.g. 15000"
                value={dutyPaid}
                onChange={(e) => setDutyPaid(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Import Quantity (optional)</Label>
              <Input
                type="number"
                placeholder="e.g. 1000"
                value={importQty}
                onChange={(e) => setImportQty(e.target.value)}
                className="bg-background border-border"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Export Quantity (optional)</Label>
              <Input
                type="number"
                placeholder="e.g. 800"
                value={exportQty}
                onChange={(e) => setExportQty(e.target.value)}
                className="bg-background border-border"
              />
            </div>
          </div>
          <Button onClick={handleCalculate} disabled={!dutyPaid || calcQ.isFetching} className="gap-2">
            <Calculator className="w-4 h-4" />
            {calcQ.isFetching ? "Calculating…" : "Calculate Refund"}
          </Button>

          {result && (
            <div className="p-4 rounded-lg border bg-blue-500/10 border-blue-500/30 space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Refund Rate", value: `${(result.refundRate * 100).toFixed(0)}%`, icon: <Percent className="w-4 h-4 text-blue-400" /> },
                  { label: "Qty Adjustment", value: `${(result.quantityRatio * 100).toFixed(1)}%`, icon: <ArrowRight className="w-4 h-4 text-yellow-400" /> },
                  { label: "Gross Refund", value: `USD ${result.grossRefund.toLocaleString()}`, icon: <DollarSign className="w-4 h-4 text-green-400" /> },
                  { label: "Net Refund", value: `USD ${result.netRefund.toLocaleString()}`, icon: <DollarSign className="w-4 h-4 text-emerald-400" /> },
                ].map((item) => (
                  <div key={item.label} className="bg-background/50 rounded p-3">
                    <div className="flex items-center gap-1.5 mb-1">{item.icon}<span className="text-xs text-muted-foreground">{item.label}</span></div>
                    <div className="text-lg font-bold">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="text-xs text-muted-foreground space-y-1 border-t border-border/50 pt-3">
                <div>Processing fee deducted: USD {result.processingFee.toLocaleString()} ({result.breakdown.processingFeeNote})</div>
                <div>Quantity adjustment: {result.breakdown.quantityAdjustment}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

export default function DrawbackAutomation() {
  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-400" />
            Duty Drawback Automation
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Automated eligibility checking and refund calculation for duty drawback claims
          </p>
        </div>

        <Tabs defaultValue="eligibility">
          <TabsList className="bg-muted/30">
            <TabsTrigger value="eligibility" className="gap-2">
              <CheckCircle2 className="w-4 h-4" /> Eligibility Checker
            </TabsTrigger>
            <TabsTrigger value="calculator" className="gap-2">
              <Calculator className="w-4 h-4" /> Refund Calculator
            </TabsTrigger>
          </TabsList>
          <TabsContent value="eligibility" className="mt-4">
            <EligibilityChecker />
          </TabsContent>
          <TabsContent value="calculator" className="mt-4">
            <RefundCalculator />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
