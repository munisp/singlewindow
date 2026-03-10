/**
 * Sprint 80 — Public Certificate Verification Page
 * Route: /verify/:certNumber (no auth required)
 * Accessible via QR code on AfCFTA certificates of origin.
 * Mobile-first layout for border agency use.
 */
import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { CheckCircle2, XCircle, AlertCircle, Loader2, Shield, Calendar, Globe, Package, FileText, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

interface CertVerifyResult {
  valid: boolean;
  certNumber: string;
  certType?: string;
  status?: string;
  isExpired?: boolean;
  exporterName?: string;
  importerName?: string;
  originCountry?: string;
  destinationCountry?: string;
  goodsDescription?: string;
  hsCode?: string;
  invoiceNumber?: string;
  originCriteria?: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
  verifiedAt: string;
  verifiedBy?: string;
  error?: string;
}

function StatusBanner({ result }: { result: CertVerifyResult }) {
  if (result.valid) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-50 border-2 border-emerald-400">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 shrink-0" />
        <div>
          <p className="font-bold text-emerald-800 text-lg">Certificate Valid</p>
          <p className="text-emerald-700 text-sm">This certificate of origin is authentic and current.</p>
        </div>
      </div>
    );
  }
  if (result.isExpired) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-400">
        <AlertCircle className="h-8 w-8 text-amber-600 shrink-0" />
        <div>
          <p className="font-bold text-amber-800 text-lg">Certificate Expired</p>
          <p className="text-amber-700 text-sm">This certificate was valid but has passed its expiry date.</p>
        </div>
      </div>
    );
  }
  if (result.error === "Certificate not found") {
    return (
      <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border-2 border-red-400">
        <XCircle className="h-8 w-8 text-red-600 shrink-0" />
        <div>
          <p className="font-bold text-red-800 text-lg">Certificate Not Found</p>
          <p className="text-red-700 text-sm">No certificate with this number exists in the registry.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border-2 border-red-400">
      <XCircle className="h-8 w-8 text-red-600 shrink-0" />
      <div>
        <p className="font-bold text-red-800 text-lg">Certificate Invalid</p>
        <p className="text-red-700 text-sm">This certificate has not been approved or has been revoked.</p>
      </div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-sm font-medium text-foreground break-words">{value}</p>
      </div>
    </div>
  );
}

export default function CertVerify() {
  const params = useParams<{ certNumber: string }>();
  const certNumber = params.certNumber;

  const [result, setResult] = useState<CertVerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    if (!certNumber) return;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/verify/${encodeURIComponent(certNumber)}`)
      .then(async (res) => {
        const data = await res.json();
        setResult(data);
      })
      .catch((err) => {
        setFetchError(err.message ?? "Network error");
      })
      .finally(() => setLoading(false));
  }, [certNumber]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-start px-4 py-8">
      {/* Header */}
      <div className="w-full max-w-lg mb-6 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <Shield className="h-7 w-7 text-amber-400" />
          <span className="text-white font-bold text-xl tracking-tight">TradeGateway™ NGSWTP</span>
        </div>
        <p className="text-slate-400 text-sm">Certificate of Origin Registry — Verification Service</p>
      </div>

      <div className="w-full max-w-lg space-y-4">
        {/* Loading state */}
        {loading && (
          <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
            <CardContent className="p-8 flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
              <p className="text-slate-300 text-sm">Verifying certificate <span className="font-mono text-amber-300">{certNumber}</span>…</p>
            </CardContent>
          </Card>
        )}

        {/* Network error */}
        {!loading && fetchError && (
          <Card className="border-red-700 bg-red-950/40">
            <CardContent className="p-6">
              <div className="flex items-center gap-3">
                <XCircle className="h-6 w-6 text-red-400 shrink-0" />
                <div>
                  <p className="font-semibold text-red-300">Verification service unavailable</p>
                  <p className="text-red-400 text-sm mt-0.5">{fetchError}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result */}
        {!loading && result && (
          <>
            {/* Status banner */}
            <Card className="border-slate-700 bg-white overflow-hidden">
              <CardContent className="p-4">
                <StatusBanner result={result} />
              </CardContent>
            </Card>

            {/* Certificate details */}
            {!result.error && (
              <Card className="border-slate-700 bg-slate-800/60 backdrop-blur">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base text-white flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-400" />
                    Certificate Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <InfoRow icon={FileText} label="Certificate Number" value={result.certNumber} />
                    <InfoRow icon={FileText} label="Certificate Type" value={result.certType?.replace(/_/g, " ").toUpperCase()} />
                    <InfoRow icon={FileText} label="Invoice Number" value={result.invoiceNumber} />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="grid grid-cols-1 gap-3">
                    <InfoRow icon={Building2} label="Exporter" value={result.exporterName} />
                    <InfoRow icon={Building2} label="Importer" value={result.importerName} />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow icon={Globe} label="Origin Country" value={result.originCountry} />
                    <InfoRow icon={Globe} label="Destination" value={result.destinationCountry} />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="grid grid-cols-1 gap-3">
                    <InfoRow icon={Package} label="Goods Description" value={result.goodsDescription} />
                    <InfoRow icon={Package} label="HS Code" value={result.hsCode} />
                    <InfoRow icon={Package} label="Origin Criteria" value={result.originCriteria} />
                  </div>

                  <Separator className="bg-slate-700" />

                  <div className="grid grid-cols-2 gap-3">
                    <InfoRow
                      icon={Calendar}
                      label="Approved"
                      value={result.approvedAt ? new Date(result.approvedAt).toLocaleDateString() : undefined}
                    />
                    <InfoRow
                      icon={Calendar}
                      label="Expires"
                      value={result.expiresAt ? new Date(result.expiresAt).toLocaleDateString() : undefined}
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <Badge
                      variant="outline"
                      className={
                        result.valid
                          ? "border-emerald-500 text-emerald-400 bg-emerald-500/10"
                          : result.isExpired
                          ? "border-amber-500 text-amber-400 bg-amber-500/10"
                          : "border-red-500 text-red-400 bg-red-500/10"
                      }
                    >
                      {result.status?.toUpperCase() ?? "UNKNOWN"}
                    </Badge>
                    <span className="text-xs text-slate-500">
                      {result.isExpired && "EXPIRED · "}
                      Verified {new Date(result.verifiedAt).toLocaleString()}
                    </span>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {/* Footer */}
        <div className="text-center text-slate-500 text-xs pt-2 pb-4">
          <p>{result?.verifiedBy ?? "TradeGateway™ NGSWTP Certificate Registry"}</p>
          <p className="mt-1">Nigeria Customs Service · AfCFTA Secretariat</p>
        </div>
      </div>
    </div>
  );
}
