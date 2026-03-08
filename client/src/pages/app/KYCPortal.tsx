/**
 * KYCPortal.tsx — KYC/KYB Document Verification Portal
 *
 * Allows traders to:
 *   - Upload identity and business documents for verification
 *   - Track document analysis status (OCR + VLM pipeline)
 *   - View extracted entity data and authenticity scores
 *   - Submit KYC (individual) or KYB (business entity) verification
 *   - Track overall verification status
 *
 * Admin view (role=admin):
 *   - Review pending verifications
 *   - Approve / reject / request more info
 */

import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Fingerprint,
  ShieldCheck,
  Upload,
  XCircle,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type DocumentType =
  | "national_id" | "passport" | "drivers_license"
  | "business_registration" | "tax_certificate"
  | "bank_statement" | "utility_bill"
  | "certificate_of_incorporation" | "memorandum_of_association"
  | "board_resolution" | "other";

const DOCUMENT_LABELS: Record<DocumentType, string> = {
  national_id: "National ID Card",
  passport: "International Passport",
  drivers_license: "Driver's License",
  business_registration: "Business Registration Certificate",
  tax_certificate: "Tax Clearance Certificate",
  bank_statement: "Bank Statement (last 3 months)",
  utility_bill: "Utility Bill (address proof)",
  certificate_of_incorporation: "Certificate of Incorporation",
  memorandum_of_association: "Memorandum of Association",
  board_resolution: "Board Resolution",
  other: "Other Document",
};

const RISK_LEVEL_CONFIG = {
  LIKELY_GENUINE: { label: "Likely Genuine", color: "text-green-600", bg: "bg-green-50 border-green-200" },
  REQUIRES_REVIEW: { label: "Requires Review", color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  SUSPICIOUS: { label: "Suspicious", color: "text-red-600", bg: "bg-red-50 border-red-200" },
};

// ─── Document Upload Card ─────────────────────────────────────────────────────

function DocumentUploadCard({ onUploaded }: { onUploaded: (docId: number) => void }) {
  const [selectedType, setSelectedType] = useState<DocumentType>("national_id");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadMutation = trpc.kyc.uploadDocument.useMutation({
    onSuccess: (data) => {
      toast.success("Document uploaded successfully");
      onUploaded(data.documentId);
    },
    onError: (err) => {
      toast.error(`Upload failed: ${err.message}`);
    },
  });

  const analyseMutation = trpc.kyc.analyseDocument.useMutation({
    onSuccess: () => {
      toast.success("Document analysis complete");
    },
    onError: (err) => {
      toast.error(`Analysis failed: ${err.message}`);
    },
  });

  const handleFile = useCallback(async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File must be under 20MB");
      return;
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf", "image/tiff"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Unsupported file type. Please upload JPEG, PNG, WebP, TIFF, or PDF.");
      return;
    }

    setIsUploading(true);
    try {
      const reader = new FileReader();
      const fileData = await new Promise<string>((resolve, reject) => {
        reader.onload = (e) => {
          const result = e.target?.result as string;
          // Strip data URL prefix to get pure base64
          resolve(result.split(",")[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const result = await uploadMutation.mutateAsync({
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp" | "application/pdf" | "image/tiff",
        documentType: selectedType,
        fileSize: file.size,
        fileData,
      });

      // Auto-trigger analysis
      await analyseMutation.mutateAsync({
        documentId: result.documentId,
        runAuthenticity: true,
      });

      onUploaded(result.documentId);
    } finally {
      setIsUploading(false);
    }
  }, [selectedType, uploadMutation, analyseMutation, onUploaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" />
          Upload Document
        </CardTitle>
        <CardDescription>
          Upload identity or business documents for KYC/KYB verification.
          Supported: JPEG, PNG, WebP, TIFF, PDF (max 20MB).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Document Type</Label>
          <Select value={selectedType} onValueChange={(v) => setSelectedType(v as DocumentType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.entries(DOCUMENT_LABELS) as [DocumentType, string][]).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50"
          } ${isUploading ? "opacity-50 pointer-events-none" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/tiff,application/pdf"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />
          {isUploading ? (
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Uploading and analysing document...</div>
              <Progress value={undefined} className="h-1.5" />
            </div>
          ) : (
            <>
              <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-sm font-medium">Drop file here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">
                {DOCUMENT_LABELS[selectedType]}
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Document List ────────────────────────────────────────────────────────────

function DocumentList() {
  const { data: documents, isLoading, refetch } = trpc.kyc.listDocuments.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
        ))}
      </div>
    );
  }

  if (!documents?.length) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Upload your identity or business documents to begin verification.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {documents.map((doc) => {
        const analysis = doc.analysisResult as Record<string, unknown> | null;
        const verdict = doc.authenticityVerdict as keyof typeof RISK_LEVEL_CONFIG | null;
        const verdictConfig = verdict ? RISK_LEVEL_CONFIG[verdict] : null;

        return (
          <Card key={doc.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="p-2 rounded-md bg-muted shrink-0">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{doc.filename}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {DOCUMENT_LABELS[doc.documentType as DocumentType] ?? doc.documentType}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {doc.status === "ANALYSED" && doc.ocrConfidence !== null && (
                        <span className="text-xs text-muted-foreground">
                          OCR: {Math.round((doc.ocrConfidence as number) * 100)}% confidence
                        </span>
                      )}
                      {doc.status === "ANALYSED" && doc.authenticityScore !== null && (
                        <span className="text-xs text-muted-foreground">
                          Authenticity: {Math.round((doc.authenticityScore as number) * 100)}%
                        </span>
                      )}
                    </div>
                    {verdictConfig && (
                      <div className={`mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs border ${verdictConfig.bg} ${verdictConfig.color}`}>
                        {verdict === "LIKELY_GENUINE" ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <AlertCircle className="h-3 w-3" />
                        )}
                        {verdictConfig.label}
                      </div>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                  {doc.status === "PENDING_ANALYSIS" && (
                    <Badge variant="secondary" className="gap-1">
                      <Clock className="h-3 w-3" />
                      Pending
                    </Badge>
                  )}
                  {doc.status === "ANALYSED" && (
                    <Badge variant="default" className="gap-1 bg-green-600">
                      <CheckCircle2 className="h-3 w-3" />
                      Analysed
                    </Badge>
                  )}
                  {doc.status === "REJECTED" && (
                    <Badge variant="destructive" className="gap-1">
                      <XCircle className="h-3 w-3" />
                      Rejected
                    </Badge>
                  )}
                </div>
              </div>

              {/* Extracted fields preview */}
              {analysis && typeof analysis === "object" && "extracted_fields" in analysis && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Extracted Data</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {Object.entries(analysis.extracted_fields as Record<string, string>)
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <div key={key} className="flex flex-col">
                          <span className="text-xs text-muted-foreground capitalize">
                            {key.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs font-medium truncate">{String(value)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ─── Verification Status ──────────────────────────────────────────────────────

function VerificationStatus() {
  const { data, isLoading } = trpc.kyc.getVerification.useQuery();

  if (isLoading) {
    return <Card><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>;
  }

  const verification = data?.verification;

  if (!verification) {
    return (
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-900">Verification Not Started</p>
              <p className="text-xs text-amber-700 mt-1">
                Upload your documents and submit a KYC or KYB verification to trade on the platform.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const statusConfig: Record<string, { icon: React.ReactNode; label: string; className: string }> = {
    PENDING_REVIEW: {
      icon: <Clock className="h-5 w-5 text-amber-600" />,
      label: "Pending Review",
      className: "border-amber-200 bg-amber-50",
    },
    APPROVED: {
      icon: <ShieldCheck className="h-5 w-5 text-green-600" />,
      label: "Verified",
      className: "border-green-200 bg-green-50",
    },
    REJECTED: {
      icon: <XCircle className="h-5 w-5 text-red-600" />,
      label: "Rejected",
      className: "border-red-200 bg-red-50",
    },
    MORE_INFO_REQUIRED: {
      icon: <AlertCircle className="h-5 w-5 text-blue-600" />,
      label: "More Information Required",
      className: "border-blue-200 bg-blue-50",
    },
  };

  const cfg = statusConfig[verification.status] ?? statusConfig.PENDING_REVIEW;

  return (
    <Card className={cfg.className}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          {cfg.icon}
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{cfg.label}</p>
              <Badge variant="outline" className="text-xs">
                {verification.verificationType === "INDIVIDUAL" ? "KYC" : "KYB"}
              </Badge>
            </div>
            {verification.status === "PENDING_REVIEW" && (
              <p className="text-xs text-muted-foreground mt-1">
                Submitted on {new Date(verification.submittedAt).toLocaleDateString()}.
                Estimated review time: 1–2 business days.
              </p>
            )}
            {verification.status === "APPROVED" && (
              <p className="text-xs text-muted-foreground mt-1">
                Verified on {new Date(verification.reviewedAt!).toLocaleDateString()}.
                Your account is fully verified.
              </p>
            )}
            {verification.status === "REJECTED" && (
              <p className="text-xs text-red-700 mt-1">
                Reason: {verification.rejectionReason ?? "No reason provided."}
              </p>
            )}
            {verification.status === "MORE_INFO_REQUIRED" && (
              <p className="text-xs text-blue-700 mt-1">
                {verification.reviewNotes ?? "Please upload additional documents."}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Submit KYC Form ──────────────────────────────────────────────────────────

function SubmitKYCForm() {
  const { data: documents } = trpc.kyc.listDocuments.useQuery();
  const utils = trpc.useUtils();

  const verifyMutation = trpc.kyc.verifyIdentity.useMutation({
    onSuccess: () => {
      toast.success("KYC verification submitted successfully");
      utils.kyc.getVerification.invalidate();
    },
    onError: (err) => toast.error(`Submission failed: ${err.message}`),
  });

  const [primaryDocId, setPrimaryDocId] = useState<string>("");
  const [secondaryDocId, setSecondaryDocId] = useState<string>("");
  const [accepted, setAccepted] = useState(false);

  const analysedDocs = documents?.filter(d => d.status === "ANALYSED") ?? [];
  const idDocs = analysedDocs.filter(d =>
    ["national_id", "passport", "drivers_license"].includes(d.documentType)
  );
  const addressDocs = analysedDocs.filter(d =>
    ["utility_bill", "bank_statement"].includes(d.documentType)
  );

  const handleSubmit = () => {
    if (!primaryDocId) {
      toast.error("Please select a primary identity document");
      return;
    }
    if (!accepted) {
      toast.error("Please accept the KYC declaration");
      return;
    }
    verifyMutation.mutate({
      primaryDocumentId: parseInt(primaryDocId),
      secondaryDocumentId: secondaryDocId ? parseInt(secondaryDocId) : undefined,
      declarationAccepted: true,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-4 w-4" />
          Submit KYC Verification
        </CardTitle>
        <CardDescription>
          Individual identity verification for sole traders and individual importers/exporters.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>Primary Identity Document *</Label>
          <Select value={primaryDocId} onValueChange={setPrimaryDocId}>
            <SelectTrigger>
              <SelectValue placeholder="Select national ID or passport..." />
            </SelectTrigger>
            <SelectContent>
              {idDocs.map(doc => (
                <SelectItem key={doc.id} value={String(doc.id)}>
                  {DOCUMENT_LABELS[doc.documentType as DocumentType]} — {doc.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {idDocs.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No analysed identity documents found. Upload and analyse a national ID or passport first.
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>Address Proof (Optional)</Label>
          <Select value={secondaryDocId} onValueChange={setSecondaryDocId}>
            <SelectTrigger>
              <SelectValue placeholder="Select utility bill or bank statement..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {addressDocs.map(doc => (
                <SelectItem key={doc.id} value={String(doc.id)}>
                  {DOCUMENT_LABELS[doc.documentType as DocumentType]} — {doc.filename}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-start gap-2 p-3 rounded-md bg-muted/50 border">
          <input
            type="checkbox"
            id="kyc-declaration"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5"
          />
          <label htmlFor="kyc-declaration" className="text-xs text-muted-foreground cursor-pointer">
            I declare that the information and documents submitted are true, accurate, and complete.
            I consent to the verification of my identity for the purposes of trade compliance.
          </label>
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!primaryDocId || !accepted || verifyMutation.isPending}
          className="w-full"
        >
          {verifyMutation.isPending ? "Submitting..." : "Submit KYC Verification"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KYCPortal() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [lastUploadedId, setLastUploadedId] = useState<number | null>(null);

  const handleDocumentUploaded = (docId: number) => {
    setLastUploadedId(docId);
    utils.kyc.listDocuments.invalidate();
    utils.kyc.getVerification.invalidate();
  };

  return (
    <DashboardLayout title="KYC/KYB Verification">
      <div className="space-y-6 max-w-5xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            KYC / KYB Verification
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Verify your identity or business entity to unlock full trading capabilities.
            Documents are analysed using PaddleOCR, DocLing, and Qwen2-VL.
          </p>
        </div>

        {/* Verification status banner */}
        <VerificationStatus />

        {/* Pipeline info */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              icon: <FileText className="h-4 w-4" />,
              title: "OCR Extraction",
              desc: "PaddleOCR + DocLing extract text and structure from your documents",
            },
            {
              icon: <Eye className="h-4 w-4" />,
              title: "Visual Analysis",
              desc: "Qwen2-VL verifies security features, signatures, and authenticity",
            },
            {
              icon: <ShieldCheck className="h-4 w-4" />,
              title: "Compliance Check",
              desc: "Entity data matched against AML/sanctions databases",
            },
          ].map((step) => (
            <Card key={step.title} className="bg-muted/30">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-1.5 text-primary">
                  {step.icon}
                  <span className="text-xs font-semibold">{step.title}</span>
                </div>
                <p className="text-xs text-muted-foreground">{step.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Main content */}
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">My Documents</TabsTrigger>
            <TabsTrigger value="upload">Upload Document</TabsTrigger>
            <TabsTrigger value="submit-kyc">Submit KYC</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="mt-4">
            <DocumentList />
          </TabsContent>

          <TabsContent value="upload" className="mt-4">
            <DocumentUploadCard onUploaded={handleDocumentUploaded} />
          </TabsContent>

          <TabsContent value="submit-kyc" className="mt-4">
            <SubmitKYCForm />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
