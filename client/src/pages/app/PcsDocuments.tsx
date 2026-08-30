/**
 * PcsDocuments.tsx — PCS document exchange (Phase 8, R5): delivery orders,
 * gate passes, terminal notices and port correspondence via the shared
 * document vault (identical AV-scan/quarantine semantics).
 */
import { useRef, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FileText, Upload } from "lucide-react";
import { PcsDegradedBanner, PcsEmptyState, ProvenanceLine } from "./pcs/pcsUi";

const CATEGORY_LABELS: Record<string, string> = {
  delivery_order: "Delivery order",
  gate_pass: "Gate pass",
  terminal_notice: "Terminal notice",
  pcs_correspondence: "Port correspondence",
};

interface DocRow {
  id: number;
  filename: string;
  category: string;
  sizeBytes: number;
  createdAt: string;
  status: string;
}

export default function PcsDocuments() {
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [shareCategory, setShareCategory] = useState<string>("delivery_order");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = trpc.pcs.documents.inbox.useQuery({
    category: categoryFilter === "ALL" ? undefined : (categoryFilter as never),
  });
  const share = trpc.pcs.documents.share.useMutation({
    onSuccess: () => {
      toast.success("Document shared with the port community vault");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      void query.refetch();
    },
    onError: (err) => toast.error(err.message),
  });
  const result = query.data;

  async function handleShare() {
    if (!file) return;
    const buffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
    share.mutate({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      fileData: base64,
      sizeBytes: file.size,
      category: shareCategory as never,
    });
  }

  return (
    <DashboardLayout>
      <div className="container mx-auto max-w-4xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-bold">Port documents</h1>
          <p className="text-sm text-slate-500">
            Delivery orders, gate passes and terminal notices exchanged through the shared document vault.
          </p>
        </div>

        {/* Share form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Upload className="h-4 w-4" /> Share a document</CardTitle>
            <CardDescription>Uploaded files are virus-scanned before they become visible — same vault pipeline as declarations.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pcs-doc-category">Category</Label>
              <Select value={shareCategory} onValueChange={setShareCategory}>
                <SelectTrigger id="pcs-doc-category" className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pcs-doc-file">File (max 20 MB)</Label>
              <Input
                id="pcs-doc-file"
                ref={fileRef}
                type="file"
                className="w-72"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <Button onClick={handleShare} disabled={!file || share.isPending}>
              {share.isPending ? "Sharing…" : "Share"}
            </Button>
          </CardContent>
        </Card>

        {/* Inbox */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" /> Inbox</CardTitle>
                <CardDescription>Documents issued to or shared by your account.</CardDescription>
              </div>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All categories</SelectItem>
                  {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {query.isLoading && <Skeleton className="h-24 w-full" />}
            {result?.status === "unavailable" && (
              <PcsDegradedBanner reason={result.reason} detail={result.detail} onRetry={() => query.refetch()} />
            )}
            {result?.status === "ok" && (
              result.data.documents.length === 0 ? (
                <PcsEmptyState
                  title="No port documents yet"
                  hint="Delivery orders, gate passes and terminal notices issued to your account appear here."
                />
              ) : (
                (result.data.documents as DocRow[]).map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-md border border-slate-700/60 p-3">
                    <div>
                      <p className="text-sm font-medium">{d.filename}</p>
                      <ProvenanceLine
                        source="document vault"
                        detail={`${(d.sizeBytes / 1024).toFixed(1)} KB · ${new Date(d.createdAt).toLocaleString()}`}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{CATEGORY_LABELS[d.category] ?? d.category}</Badge>
                      <Badge variant="outline" className="text-emerald-400">{d.status}</Badge>
                    </div>
                  </div>
                ))
              )
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
