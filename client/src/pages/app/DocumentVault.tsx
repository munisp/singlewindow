/**
 * DocumentVault.tsx
 *
 * Secure document management page backed by RustFS (via Go microservice).
 * Features: upload, list with filters, presigned download, revoke, stats.
 *
 * Design: Deep Navy (#0A1628) + Gold (#D4A017) — Sovereign Blueprint theme.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  FolderLock,
  Upload,
  Download,
  Trash2,
  FileText,
  File,
  Image,
  Archive,
  HardDrive,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Plus,
  AlertTriangle,
  Shield,
  Share2,
  Link2,
  Clock,
  Lock,
  Copy,
  Eye,
  Ban,
  Calendar,
  ExternalLink,
  BarChart2,
  ChevronRight,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const DOCUMENT_CATEGORIES = [
  { value: "commercial_invoice", label: "Commercial Invoice" },
  { value: "bill_of_lading", label: "Bill of Lading" },
  { value: "packing_list", label: "Packing List" },
  { value: "certificate_of_origin", label: "Certificate of Origin" },
  { value: "phytosanitary_cert", label: "Phytosanitary Certificate" },
  { value: "import_permit", label: "Import Permit" },
  { value: "export_permit", label: "Export Permit" },
  { value: "insurance_cert", label: "Insurance Certificate" },
  { value: "customs_bond", label: "Customs Bond" },
  { value: "kyc_identity", label: "KYC — Identity" },
  { value: "kyc_business", label: "KYC — Business" },
  { value: "aeo_supporting", label: "AEO Supporting Document" },
  { value: "post_clearance", label: "Post-Clearance Audit" },
  { value: "correspondence", label: "Correspondence" },
  { value: "other", label: "Other" },
] as const;

type DocCategory = typeof DOCUMENT_CATEGORIES[number]["value"];

const ACCESS_LEVELS = [
  { value: "private", label: "Private (only you)" },
  { value: "shared_with_customs", label: "Shared with Customs" },
  { value: "shared_with_oga", label: "Shared with OGA" },
  { value: "public", label: "Public" },
] as const;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <Image className="h-4 w-4" />;
  if (mimeType === "application/pdf") return <FileText className="h-4 w-4" />;
  if (mimeType.includes("zip") || mimeType.includes("tar") || mimeType.includes("gzip"))
    return <Archive className="h-4 w-4" />;
  return <File className="h-4 w-4" />;
}

function getCategoryLabel(value: string): string {
  return DOCUMENT_CATEGORIES.find(c => c.value === value)?.label ?? value;
}

// ─── Upload Dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocCategory>("commercial_invoice");
  const [accessLevel, setAccessLevel] = useState("private");
  const [description, setDescription] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [linkedDeclarationId, setLinkedDeclarationId] = useState<string>("none");

  // Fetch trader's recent declarations for the selector
  const { data: myDeclarations } = trpc.declarations.myDeclarations.useQuery(
    { limit: 50, offset: 0 },
    { staleTime: 60_000 }
  );

  const upload = trpc.documentVault.upload.useMutation({
    onSuccess: () => {
      toast.success("Document uploaded", { description: `${selectedFile?.name} stored in RustFS.` });
      onSuccess();
      onClose();
      setSelectedFile(null);
      setDescription("");
      setLinkedDeclarationId("none");
    },
    onError: (err) => {
      toast.error("Upload failed", { description: err.message });
    },
  });

  const handleFile = useCallback((file: File) => {
    if (file.size > MAX_FILE_SIZE) {
      toast.error("File too large", { description: "Maximum file size is 20 MB." });
      return;
    }
    setSelectedFile(file);
  }, [toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleSubmit = async () => {
    if (!selectedFile) return;

    const arrayBuffer = await selectedFile.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const base64 = btoa(binary);

    upload.mutate({
      filename: selectedFile.name,
      contentType: selectedFile.type || "application/octet-stream",
      fileData: base64,
      sizeBytes: selectedFile.size,
      category,
      accessLevel: accessLevel as "private" | "shared_with_customs" | "shared_with_oga" | "public",
      description: description || undefined,
      declarationId: linkedDeclarationId !== "none" ? Number(linkedDeclarationId) : undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Upload Document to Vault
          </DialogTitle>
          <DialogDescription>
            Files are stored in RustFS (S3-compatible). Maximum 20 MB per file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {selectedFile ? (
              <div className="flex items-center justify-center gap-3">
                {getFileIcon(selectedFile.type)}
                <div className="text-left">
                  <p className="text-sm font-medium truncate max-w-[280px]">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(selectedFile.size)}</p>
                </div>
                <CheckCircle2 className="h-5 w-5 text-green-500 ml-auto" />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Drop a file here or <span className="text-primary underline">browse</span>
                </p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, XLSX, images, ZIP — max 20 MB</p>
              </div>
            )}
          </div>

          {/* Category */}
          <div className="space-y-1.5">
            <Label>Document Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as DocCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Access level */}
          <div className="space-y-1.5">
            <Label>Access Level</Label>
            <Select value={accessLevel} onValueChange={setAccessLevel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCESS_LEVELS.map(a => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Link to declaration */}
          <div className="space-y-1.5">
            <Label>Link to Declaration (optional)</Label>
            <Select value={linkedDeclarationId} onValueChange={setLinkedDeclarationId}>
              <SelectTrigger>
                <SelectValue placeholder="No declaration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No declaration</SelectItem>
                {(myDeclarations ?? []).map(d => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    #{d.id} — {d.ucr ?? "Draft"} ({d.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Attach this document to a specific declaration so customs officers can view it inline.
            </p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="Brief note about this document…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={1000}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={upload.isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!selectedFile || upload.isPending}>
            {upload.isPending ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Uploading…</>
            ) : (
              <><Upload className="h-4 w-4 mr-2" /> Upload</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Revoke Confirm Dialog ────────────────────────────────────────────────────

function RevokeDialog({
  docId,
  docName,
  open,
  onClose,
  onSuccess,
}: {
  docId: number;
  docName: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const revoke = trpc.documentVault.revoke.useMutation({
    onSuccess: () => {
      toast.success("Document revoked", { description: `${docName} has been revoked.` });
      onSuccess();
      onClose();
    },
    onError: (err) => {
      toast.error("Revoke failed", { description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Revoke Document
          </DialogTitle>
          <DialogDescription>
            Revoking <strong>{docName}</strong> will make it inaccessible. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={revoke.isPending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => revoke.mutate({ id: docId })}
            disabled={revoke.isPending}
          >
            {revoke.isPending
              ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              : <Trash2 className="h-4 w-4 mr-2" />}
            Revoke
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar() {
  const { data: stats, isLoading } = trpc.documentVault.stats.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </div>
    );
  }

  const items = [
    { label: "Total Files", value: stats?.totalFiles ?? 0, icon: <FolderLock className="h-5 w-5" />, color: "text-blue-400" },
    { label: "Storage Used", value: formatBytes(stats?.totalBytes ?? 0), icon: <HardDrive className="h-5 w-5" />, color: "text-amber-400" },
    { label: "Active", value: stats?.activeFiles ?? 0, icon: <CheckCircle2 className="h-5 w-5" />, color: "text-green-400" },
    { label: "Revoked", value: stats?.revokedFiles ?? 0, icon: <XCircle className="h-5 w-5" />, color: "text-red-400" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(item => (
        <Card key={item.label} className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className={`${item.color} mb-2`}>{item.icon}</div>
            <div className="text-2xl font-bold">{item.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{item.label}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── formatExpiry helper ────────────────────────────────────────────────────

function formatExpiry(expiresAt: Date): { label: string; isExpired: boolean; isNear: boolean } {
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  const diff = exp - now;
  if (diff <= 0) return { label: "Expired", isExpired: true, isNear: false };
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return { label: `${days}d ${hours % 24}h`, isExpired: false, isNear: days < 2 };
  return { label: `${hours}h ${Math.floor((diff % 3_600_000) / 60_000)}m`, isExpired: false, isNear: true };
}

// ─── PreviewDrawer ────────────────────────────────────────────────────────────

type PreviewDoc = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  status: string;
  createdAt: Date;
};

function PreviewDrawer({
  doc,
  open,
  onClose,
}: {
  doc: PreviewDoc | null;
  open: boolean;
  onClose: () => void;
}) {
  const [presignedUrl, setPresignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  const downloadMut = trpc.documentVault.download.useMutation({
    onSuccess: (data) => {
      setPresignedUrl(data.url);
      setLoadingUrl(false);
    },
    onError: (err) => {
      toast.error("Preview failed", { description: err.message });
      setLoadingUrl(false);
    },
  });

  useEffect(() => {
    if (open && doc) {
      setPresignedUrl(null);
      setLoadingUrl(true);
      downloadMut.mutate({ id: doc.id, expiresIn: 3600 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, doc?.id]);

  const isImage = doc?.mimeType.startsWith("image/") ?? false;
  const isPdf = doc?.mimeType === "application/pdf";
  const canPreview = isImage || isPdf;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-border/40">
          <SheetTitle className="flex items-center gap-2 text-base">
            {doc && getFileIcon(doc.mimeType)}
            <span className="truncate">{doc?.filename ?? "Document Preview"}</span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {doc && (
              <span className="flex flex-wrap gap-3 mt-1">
                <span className="flex items-center gap-1">
                  <HardDrive className="h-3 w-3" />
                  {formatBytes(doc.sizeBytes)}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {getCategoryLabel(doc.category)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(doc.createdAt).toLocaleDateString()}
                </span>
                <Badge variant={doc.status === "active" ? "default" : "destructive"} className="text-xs h-5">
                  {doc.status}
                </Badge>
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-6">
          {loadingUrl ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <RefreshCw className="h-8 w-8 animate-spin" />
              <p className="text-sm">Generating secure preview link…</p>
            </div>
          ) : !presignedUrl ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <AlertTriangle className="h-8 w-8" />
              <p className="text-sm">Could not load preview. Try downloading instead.</p>
            </div>
          ) : !canPreview ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
              <div className="p-6 rounded-2xl bg-card/50 border border-border/40 flex flex-col items-center gap-3">
                {doc && getFileIcon(doc.mimeType)}
                <p className="text-sm font-medium text-foreground">{doc?.filename}</p>
                <p className="text-xs text-center">
                  Preview not available for <span className="font-mono">{doc?.mimeType}</span>
                </p>
                <Button size="sm" asChild>
                  <a href={presignedUrl} target="_blank" rel="noopener noreferrer" download={doc?.filename}>
                    <Download className="h-4 w-4 mr-1.5" />
                    Download File
                  </a>
                </Button>
              </div>
            </div>
          ) : isImage ? (
            <div className="flex items-center justify-center h-full">
              <img
                src={presignedUrl}
                alt={doc?.filename}
                className="max-w-full max-h-full object-contain rounded-lg shadow-lg"
              />
            </div>
          ) : (
            <iframe
              src={presignedUrl}
              title={doc?.filename}
              className="w-full h-full rounded-lg border border-border/40 min-h-[500px]"
            />
          )}
        </div>

        {presignedUrl && (
          <div className="p-4 border-t border-border/40 flex gap-2 justify-end">
            <Button variant="outline" size="sm" asChild>
              <a href={presignedUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Open in New Tab
              </a>
            </Button>
            <Button size="sm" asChild>
              <a href={presignedUrl} download={doc?.filename}>
                <Download className="h-4 w-4 mr-1.5" />
                Download
              </a>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── ManageSharesTab ──────────────────────────────────────────────────────────

function ManageSharesTab({ docs }: { docs: Array<{ id: number; filename: string; mimeType: string }> }) {
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const utils = trpc.useUtils();

  const { data: shares, isLoading } = trpc.documentVault.listShares.useQuery(
    { documentId: selectedDocId! },
    { enabled: !!selectedDocId }
  );

  const revokeShare = trpc.documentVault.revokeShare.useMutation({
    onSuccess: () => {
      toast.success("Share link revoked");
      utils.documentVault.listShares.invalidate({ documentId: selectedDocId! });
    },
    onError: (err) => toast.error(err.message),
  });

  const activeShares = shares?.filter(s => !s.revokedAt) ?? [];
  const revokedShares = shares?.filter(s => s.revokedAt) ?? [];

  return (
    <div className="space-y-4">
      <Card className="bg-card/30 border-border/40">
        <CardContent className="p-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Select a document to manage its share links</p>
            <Select
              value={selectedDocId ? String(selectedDocId) : ""}
              onValueChange={(v) => setSelectedDocId(Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Choose a document…" />
              </SelectTrigger>
              <SelectContent>
                {docs.map(d => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    <span className="flex items-center gap-2">
                      {getFileIcon(d.mimeType)}
                      <span className="truncate max-w-[280px]">{d.filename}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {selectedDocId && (
        <Card className="bg-card/30 border-border/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-primary" />
                Share Links
              </span>
              <div className="flex gap-2">
                {activeShares.length > 0 && (
                  <Badge variant="default" className="text-xs">{activeShares.length} active</Badge>
                )}
                {revokedShares.length > 0 && (
                  <Badge variant="secondary" className="text-xs">{revokedShares.length} revoked</Badge>
                )}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : !shares || shares.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
                <Link2 className="h-8 w-8 opacity-30" />
                <p className="text-sm">No share links for this document</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shares.map(share => {
                  const expiry = formatExpiry(share.expiresAt);
                  const isRevoked = !!share.revokedAt;
                  const shareUrl = `${window.location.origin}/share/${share.token}`;
                  return (
                    <div
                      key={share.id}
                      className={`p-3 rounded-lg border transition-colors ${
                        isRevoked
                          ? "border-border/30 bg-card/20 opacity-60"
                          : "border-border/50 bg-card/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0 space-y-1">
                          {share.label && (
                            <p className="text-xs font-medium text-foreground truncate">{share.label}</p>
                          )}
                          <div className="flex flex-wrap gap-2 items-center">
                            <Badge variant="outline" className="text-xs gap-1 h-5">
                              <Download className="h-2.5 w-2.5" />
                              {share.downloadCount}
                              {share.maxDownloads !== null && ` / ${share.maxDownloads}`}
                            </Badge>
                            <Badge
                              variant={isRevoked ? "secondary" : expiry.isExpired ? "destructive" : expiry.isNear ? "outline" : "default"}
                              className={`text-xs gap-1 h-5 ${expiry.isNear && !expiry.isExpired && !isRevoked ? "border-yellow-500/50 text-yellow-400" : ""}`}
                            >
                              <Clock className="h-2.5 w-2.5" />
                              {isRevoked ? "Revoked" : expiry.label}
                            </Badge>
                            {share.hasPassword && (
                              <Badge variant="outline" className="text-xs gap-1 h-5">
                                <Lock className="h-2.5 w-2.5" />
                                Password
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground font-mono truncate">
                            {share.token.slice(0, 16)}…
                          </p>
                        </div>
                        {!isRevoked && !expiry.isExpired && (
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                navigator.clipboard.writeText(shareUrl);
                                toast.success("Link copied");
                              }}
                              title="Copy link"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                              onClick={() => revokeShare.mutate({ shareId: share.id })}
                              disabled={revokeShare.isPending}
                              title="Revoke link"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!selectedDocId && (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Share2 className="h-12 w-12 opacity-20" />
          <p className="text-sm">Select a document above to view and manage its share links</p>
        </div>
      )}
    </div>
  );
}

// ─── Document Row ─────────────────────────────────────────────────────────────

type DocRecord = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  accessLevel: string;
  status: string;
  description: string | null;
  createdAt: Date;
};

// ─── Share Dialog ─────────────────────────────────────────────────────────────

function ShareDialog({
  docId,
  docName,
  open,
  onClose,
}: {
  docId: number;
  docName: string;
  open: boolean;
  onClose: () => void;
}) {
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [maxDownloads, setMaxDownloads] = useState("");
  const [label, setLabel] = useState("");
  const [shareResult, setShareResult] = useState<{ token: string; expiresAt: Date } | null>(null);

  const share = trpc.documentVault.share.useMutation({
    onSuccess: (data) => {
      setShareResult({ token: data.token, expiresAt: data.expiresAt });
      toast.success("Share link created");
    },
    onError: (err) => toast.error("Failed to create share link", { description: err.message }),
  });

  const shareUrl = shareResult
    ? `${window.location.origin}/share/${shareResult.token}`
    : null;

  const handleCopy = () => {
    if (shareUrl) {
      navigator.clipboard.writeText(shareUrl);
      toast.success("Link copied to clipboard");
    }
  };

  const handleClose = () => {
    setShareResult(null);
    setPassword("");
    setUsePassword(false);
    setMaxDownloads("");
    setLabel("");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-blue-400" />
            Share Document
          </DialogTitle>
          <DialogDescription>
            Create a time-limited link for <span className="font-medium text-foreground">{docName}</span>.
          </DialogDescription>
        </DialogHeader>

        {shareResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
              <p className="text-sm font-medium text-green-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Share link created
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Expires: {new Date(shareResult.expiresAt).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-2">
              <Input
                value={shareUrl ?? ""}
                readOnly
                className="text-xs font-mono"
              />
              <Button size="sm" variant="outline" onClick={handleCopy}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Expires in</Label>
              <Select value={String(expiresInHours)} onValueChange={(v) => setExpiresInHours(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 hour</SelectItem>
                  <SelectItem value="6">6 hours</SelectItem>
                  <SelectItem value="24">24 hours</SelectItem>
                  <SelectItem value="72">3 days</SelectItem>
                  <SelectItem value="168">7 days</SelectItem>
                  <SelectItem value="720">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Password protect</Label>
              <button
                type="button"
                role="switch"
                aria-checked={usePassword}
                onClick={() => setUsePassword(!usePassword)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  usePassword ? "bg-primary" : "bg-muted"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  usePassword ? "translate-x-4" : "translate-x-0.5"
                }`} />
              </button>
            </div>

            {usePassword && (
              <div className="space-y-1.5">
                <Label>Password (min 4 characters)</Label>
                <Input
                  type="password"
                  placeholder="Enter password…"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={4}
                  maxLength={64}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Max downloads (optional)</Label>
              <Input
                type="number"
                placeholder="Unlimited"
                value={maxDownloads}
                onChange={(e) => setMaxDownloads(e.target.value)}
                min={1}
                max={1000}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input
                placeholder="e.g. For Customs Officer John"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={255}
              />
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose} disabled={share.isPending}>Cancel</Button>
              <Button
                onClick={() => share.mutate({
                  documentId: docId,
                  expiresInHours,
                  password: usePassword && password.length >= 4 ? password : undefined,
                  maxDownloads: maxDownloads ? Number(maxDownloads) : undefined,
                  label: label || undefined,
                })}
                disabled={share.isPending || (usePassword && password.length < 4)}
              >
                {share.isPending
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Creating…</>
                  : <><Link2 className="h-4 w-4 mr-2" /> Create Link</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Document Row ─────────────────────────────────────────────────────────────

function DocumentRow({
  doc,
  onRevoke,
  onShare,
  onPreview,
}: {
  doc: DocRecord;
  onRevoke: (id: number, name: string) => void;
  onShare: (id: number, name: string) => void;
  onPreview: (doc: DocRecord) => void;
}) {
  const download = trpc.documentVault.download.useMutation({
    onSuccess: (data) => {
      window.open(data.url, "_blank");
      toast.success("Download ready", { description: "Presigned link expires in 1 hour." });
    },
    onError: (err) => {
      toast.error("Download failed", { description: err.message });
    },
  });

  const isActive = doc.status === "active";

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
      isActive
        ? "bg-card/30 border-border/40 hover:bg-card/60"
        : "bg-muted/20 border-border/20 opacity-60"
    }`}>
      <div className={`flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center ${
        isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}>
        {getFileIcon(doc.mimeType)}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{doc.filename}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-muted-foreground">{getCategoryLabel(doc.category)}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">{formatBytes(doc.sizeBytes)}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {new Date(doc.createdAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <Badge
        variant={isActive ? "default" : "secondary"}
        className={`text-xs flex-shrink-0 ${
          isActive ? "bg-green-500/20 text-green-400 border-green-500/30" : ""
        }`}
      >
        {doc.status}
      </Badge>

      <div className="flex items-center gap-1 flex-shrink-0">
        {isActive && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0"
              title="Download (presigned URL)"
              onClick={() => download.mutate({ id: doc.id })}
              disabled={download.isPending}
            >
              {download.isPending
                ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-violet-400 hover:text-violet-300"
              title="Preview document"
              onClick={() => onPreview(doc)}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-blue-400 hover:text-blue-300"
              title="Share document"
              onClick={() => onShare(doc.id, doc.filename)}
            >
              <Share2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              title="Revoke document"
              onClick={() => onRevoke(doc.id, doc.filename)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function DocumentVault() {
  const [uploadOpen, setUploadOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{ id: number; name: string } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: number; name: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<DocRecord | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "revoked">("active");
  const [search, setSearch] = useState("");

  const utils = trpc.useUtils();

  const { data: docs, isLoading, refetch } = trpc.documentVault.list.useQuery({
    status: statusFilter,
    category: categoryFilter === "all" ? undefined : categoryFilter as DocCategory,
    limit: 100,
  });

  const { data: health } = trpc.documentVault.health.useQuery();

  const handleRefresh = useCallback(() => {
    refetch();
    utils.documentVault.stats.invalidate();
  }, [refetch, utils]);

  const filteredDocs = (docs ?? []).filter(doc =>
    search === "" || doc.filename.toLowerCase().includes(search.toLowerCase())
  );

  const handlePreview = useCallback((doc: DocRecord) => {
    setPreviewTarget(doc);
    setPreviewOpen(true);
  }, []);

  return (
    <DashboardLayout title="Document Vault">
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FolderLock className="h-6 w-6 text-primary" />
              Document Vault
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Secure document storage backed by{" "}
              <span className="font-medium text-foreground">RustFS</span> — S3-compatible object storage via Go microservice.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {health && (
              <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
                health.rustfsSvc
                  ? "bg-green-500/10 text-green-400 border-green-500/30"
                  : "bg-red-500/10 text-red-400 border-red-500/30"
              }`}>
                {health.rustfsSvc
                  ? <><Shield className="h-3 w-3" /> RustFS Online</>
                  : <><AlertTriangle className="h-3 w-3" /> RustFS Offline</>}
              </div>
            )}
            <Button onClick={() => setUploadOpen(true)} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Upload Document
            </Button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-card/30 border border-border/40 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab("documents")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "documents"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <FolderLock className="h-3.5 w-3.5" />
              My Documents
            </span>
          </button>
          <button
            onClick={() => setActiveTab("shares")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeTab === "shares"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Share2 className="h-3.5 w-3.5" />
              Manage Shares
            </span>
          </button>
        </div>

        {/* Stats */}
        <StatsBar />

        {/* Filters — only shown in Documents tab */}
        {activeTab === "documents" && (
          <>
            {/* Filters */}
            <Card className="bg-card/30 border-border/40">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-center">
                  <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by filename…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-9"
                    />
                  </div>

                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-[200px] h-9">
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {DOCUMENT_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as "active" | "revoked")}>
                    <SelectTrigger className="w-[130px] h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="revoked">Revoked</SelectItem>
                    </SelectContent>
                  </Select>

                  <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-9">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Document list */}
            <Card className="bg-card/30 border-border/40">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {statusFilter === "active" ? "Active Documents" : "Revoked Documents"}
                  {filteredDocs.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({filteredDocs.length})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {isLoading ? (
                  [...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
                ) : filteredDocs.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <FolderLock className="h-12 w-12 text-muted-foreground/30" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">No documents found</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {statusFilter === "active"
                          ? "Upload your first document to get started."
                          : "No revoked documents in this vault."}
                      </p>
                    </div>
                    {statusFilter === "active" && (
                      <Button size="sm" onClick={() => setUploadOpen(true)}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Upload Document
                      </Button>
                    )}
                  </div>
                ) : (
                  filteredDocs.map(doc => (
                    <DocumentRow
                      key={doc.id}
                      doc={doc}
                      onRevoke={(id, name) => setRevokeTarget({ id, name })}
                      onShare={(id, name) => setShareTarget({ id, name })}
                      onPreview={handlePreview}
                    />
                  ))
                )}
              </CardContent>
            </Card>
          </>
        )}

        {activeTab === "shares" && (
          <ManageSharesTab
            docs={(docs ?? []).map(d => ({ id: d.id, filename: d.filename, mimeType: d.mimeType }))}
          />
        )}
      </div>

      <PreviewDrawer
        doc={previewTarget}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
      />

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={handleRefresh}
      />

      {revokeTarget && (
        <RevokeDialog
          docId={revokeTarget.id}
          docName={revokeTarget.name}
          open={true}
          onClose={() => setRevokeTarget(null)}
          onSuccess={handleRefresh}
        />
      )}
      {shareTarget && (
        <ShareDialog
          docId={shareTarget.id}
          docName={shareTarget.name}
          open={true}
          onClose={() => setShareTarget(null)}
        />
      )}
    </DashboardLayout>
  );
}
