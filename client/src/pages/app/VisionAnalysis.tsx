/**
 * VisionAnalysis.tsx — Computer Vision Cargo Inspection Dashboard
 *
 * Customs officer tool for AI-powered cargo image analysis:
 *   - Upload cargo images for YOLOv8 object detection
 *   - Container seal verification
 *   - License plate / container number OCR
 *   - Dangerous goods label detection
 *   - Manifest discrepancy flagging
 *
 * Uses the vision tRPC router which calls the Python vision-service (port 8094).
 */

import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Eye,
  FileText,
  Package,
  ScanLine,
  Shield,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type AnalysisType = "cargo_inspection" | "seal_verification" | "plate_ocr" | "dangerous_goods";

const ANALYSIS_LABELS: Record<AnalysisType, { label: string; icon: React.ReactNode; description: string }> = {
  cargo_inspection: {
    label: "Cargo Inspection",
    icon: <Package className="h-4 w-4" />,
    description: "YOLOv8 object detection for cargo contents and manifest verification",
  },
  seal_verification: {
    label: "Seal Verification",
    icon: <Shield className="h-4 w-4" />,
    description: "Container seal integrity check — detect tampering or damage",
  },
  plate_ocr: {
    label: "Container & Plate Reading",
    icon: <ScanLine className="h-4 w-4" />,
    description: "Automatically reads container numbers, vehicle plates, and shipping marks from images",
  },
  dangerous_goods: {
    label: "Dangerous Goods Labels",
    icon: <AlertTriangle className="h-4 w-4" />,
    description: "IMDG class symbol detection for hazardous material classification",
  },
};

// ─── Detection Result Card ────────────────────────────────────────────────────

function DetectionCard({ detection }: { detection: Record<string, unknown> }) {
  const confidence = (detection.confidence as number) ?? 0;
  const label = (detection.label as string) ?? "Unknown";
  const category = (detection.category as string) ?? "";
  const riskLevel = (detection.risk_level as string) ?? "LOW";

  const riskColors: Record<string, string> = {
    HIGH: "text-red-600 bg-red-50 border-red-200",
    MEDIUM: "text-amber-600 bg-amber-50 border-amber-200",
    LOW: "text-green-600 bg-green-50 border-green-200",
  };

  return (
    <div className={`p-3 rounded-lg border text-xs ${riskColors[riskLevel] ?? riskColors.LOW}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold">{label}</span>
        <span className="font-mono">{Math.round(confidence * 100)}%</span>
      </div>
      {category && (
        <span className="text-muted-foreground">{category}</span>
      )}
    </div>
  );
}

// ─── Analysis Result Panel ────────────────────────────────────────────────────

function AnalysisResultPanel({ result }: { result: Record<string, unknown> }) {
  const detections = (result.detections as Record<string, unknown>[]) ?? [];
  const ocrText = result.ocr_text as string | undefined;
  const plateNumbers = result.plate_numbers as string[] | undefined;
  const sealStatus = result.seal_status as string | undefined;
  const dangerousGoods = result.dangerous_goods as Array<{ imdg_class: string; description: string; un_number?: string }> | undefined;
  const riskFlags = result.risk_flags as string[] | undefined;
  const summary = result.summary as string | undefined;

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-1">Analysis Summary</p>
            <p className="text-xs text-muted-foreground">{summary}</p>
          </CardContent>
        </Card>
      )}

      {/* Risk flags */}
      {riskFlags && riskFlags.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              <span className="text-sm font-semibold text-red-900">Risk Flags</span>
            </div>
            <ul className="space-y-1">
              {riskFlags.map((flag, i) => (
                <li key={i} className="text-xs text-red-700 flex items-start gap-1.5">
                  <span className="mt-0.5">•</span>
                  {flag}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Seal status */}
      {sealStatus && (
        <Card className={sealStatus === "INTACT" ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              {sealStatus === "INTACT" ? (
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <span className="text-sm font-semibold">
                Seal Status: {sealStatus}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plate / container numbers */}
      {plateNumbers && plateNumbers.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <ScanLine className="h-4 w-4" />
              Extracted Numbers
            </p>
            <div className="flex flex-wrap gap-2">
              {plateNumbers.map((num, i) => (
                <Badge key={i} variant="outline" className="font-mono text-sm px-3 py-1">
                  {num}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* OCR text */}
      {ocrText && (
        <Card>
          <CardContent className="p-4">
            <p className="text-sm font-medium mb-2">Text Extracted from Image</p>
            <pre className="text-xs bg-muted p-3 rounded-md overflow-x-auto whitespace-pre-wrap font-mono">
              {ocrText}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Detections */}
      {detections.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">Items Identified ({detections.length})</p>
          <div className="grid grid-cols-2 gap-2">
            {detections.map((det, i) => (
              <DetectionCard key={i} detection={det} />
            ))}
          </div>
        </div>
      )}

      {/* Dangerous goods */}
      {dangerousGoods && dangerousGoods.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <span className="text-sm font-semibold text-orange-900">
                Dangerous Goods Detected ({dangerousGoods.length})
              </span>
            </div>
            <div className="space-y-2">
              {dangerousGoods.map((dg, i) => (
                <div key={i} className="text-xs text-orange-800">
                  <span className="font-semibold">Class {dg.imdg_class as string}:</span>{" "}
                  {dg.description as string}
                  {dg.un_number && (
                    <span className="ml-2 font-mono">UN {dg.un_number as string}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Image Upload & Analysis ──────────────────────────────────────────────────

function ImageAnalyser() {
  const [analysisType, setAnalysisType] = useState<AnalysisType>("cargo_inspection");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isAnalysing, setIsAnalysing] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyseMutation = trpc.vision.submitInspection.useMutation({
    onSuccess: (data) => {
      setResult((data as Record<string, unknown>).analysis as Record<string, unknown> ?? {});
      toast.success("Image analysis complete");
    },
    onError: (err: { message: string }) => {
      toast.error(`Analysis failed: ${err.message}`);
    },
  });

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image must be under 20MB");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/tiff"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Please upload a JPEG, PNG, WebP, or TIFF image");
      return;
    }

    // Show preview
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);
    setResult(null);
    setIsAnalysing(true);

    try {
      const reader = new FileReader();
      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => {
          const result = e.target?.result as string;
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const analysisTypeMap: Record<AnalysisType, "container_inspection" | "seal_verification" | "cargo_manifest_match" | "damage_assessment" | "prohibited_goods_screening"> = {
        cargo_inspection: "container_inspection",
        seal_verification: "seal_verification",
        plate_ocr: "container_inspection",
        dangerous_goods: "prohibited_goods_screening",
      };

      const data = await analyseMutation.mutateAsync({
        imageData: fileData,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp" | "image/tiff",
        analysisType: analysisTypeMap[analysisType],
        imageFilename: file.name,
      });

      setResult((data as Record<string, unknown>).analysis as Record<string, unknown> ?? {});
    } finally {
      setIsAnalysing(false);
    }
  }, [analysisType, analyseMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Left: Upload panel */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>Analysis Type</Label>
          <Select value={analysisType} onValueChange={(v) => setAnalysisType(v as AnalysisType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(ANALYSIS_LABELS) as [AnalysisType, typeof ANALYSIS_LABELS[AnalysisType]][]).map(
                ([value, { label, icon }]) => (
                  <SelectItem key={value} value={value}>
                    <span className="flex items-center gap-2">
                      {icon}
                      {label}
                    </span>
                  </SelectItem>
                )
              )}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {ANALYSIS_LABELS[analysisType].description}
          </p>
        </div>

        <div
          className={`border-2 border-dashed rounded-lg overflow-hidden cursor-pointer transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          }`}
          style={{ minHeight: 240 }}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => !isAnalysing && fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/tiff"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {previewUrl ? (
            <div className="relative">
              <img
                src={previewUrl}
                alt="Cargo image"
                className="w-full h-60 object-contain bg-black/5"
              />
              {isAnalysing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                  <div className="text-center">
                    <Camera className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                    <p className="text-sm font-medium">Analysing...</p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-60 text-center p-6">
              <Camera className="h-10 w-10 mb-3 text-muted-foreground/40" />
              <p className="text-sm font-medium">Drop cargo image here</p>
              <p className="text-xs text-muted-foreground mt-1">
                JPEG, PNG, WebP, TIFF — max 20MB
              </p>
            </div>
          )}
        </div>

        {previewUrl && !isAnalysing && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setPreviewUrl(null);
              setResult(null);
            }}
          >
            Clear & Upload New Image
          </Button>
        )}
      </div>

      {/* Right: Results panel */}
      <div>
        {isAnalysing ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : result ? (
          <AnalysisResultPanel result={result} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full min-h-60 text-center p-6 border-2 border-dashed rounded-lg border-muted-foreground/20">
            <Eye className="h-10 w-10 mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              Upload an image to see AI analysis results
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Recent Analyses ──────────────────────────────────────────────────────────

function RecentAnalyses() {
  const { data, isLoading } = trpc.vision.listMyReports.useQuery({ limit: 10 });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Camera className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No analyses yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {(data ?? []).map((analysis: Record<string, unknown>) => {
        const analysisResult = analysis.analysisResult as Record<string, unknown> | null;
        const riskFlags = analysisResult?.risk_flags as string[] | undefined;
        const hasRisk = riskFlags && riskFlags.length > 0;
        const analysisId = analysis.id as number;
        const analysisType = analysis.analysisType as string;
        const imageFilename = analysis.imageKey as string | undefined;
        const status = analysis.status as string;
        const createdAt = analysis.createdAt as Date | string;

        return (
          <Card key={analysisId} className={hasRisk ? "border-red-200" : ""}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-md shrink-0 ${hasRisk ? "bg-red-100" : "bg-muted"}`}>
                    <Camera className={`h-4 w-4 ${hasRisk ? "text-red-600" : "text-muted-foreground"}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{imageFilename?.split("/").pop() ?? "Image"}</span>
                      <Badge variant="outline" className="text-xs">
                        {analysisType.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(createdAt).toLocaleString()}
                    </p>
                    {hasRisk && (
                      <div className="flex items-center gap-1 mt-1.5 text-xs text-red-600">
                        <AlertTriangle className="h-3 w-3" />
                        {riskFlags!.length} risk flag{riskFlags!.length > 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                </div>
                <Badge
                  variant={status === "COMPLETED" ? "default" : "secondary"}
                  className={status === "COMPLETED" ? "bg-green-600" : ""}
                >
                  {status}
                </Badge>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VisionAnalysis() {
  return (
    <DashboardLayout title="Cargo Image Inspection">
      <div className="space-y-6 max-w-6xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Camera className="h-6 w-6 text-primary" />
            Cargo Image Inspection
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Upload photos of cargo, containers, or shipping documents for automated inspection — detecting contraband, seal tampering, hazardous materials, and identity markings.
          </p>
        </div>

        {/* Capability cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.entries(ANALYSIS_LABELS) as [AnalysisType, typeof ANALYSIS_LABELS[AnalysisType]][]).map(
            ([, { label, icon, description }]) => (
              <Card key={label} className="bg-muted/30">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1.5 text-primary">
                    {icon}
                    <span className="text-xs font-semibold">{label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* Tabs */}
        <Tabs defaultValue="analyse">
          <TabsList>
            <TabsTrigger value="analyse">New Analysis</TabsTrigger>
            <TabsTrigger value="history">Recent Analyses</TabsTrigger>
          </TabsList>

          <TabsContent value="analyse" className="mt-4">
            <ImageAnalyser />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <RecentAnalyses />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
