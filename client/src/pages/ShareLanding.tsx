/**
 * ShareLanding.tsx
 *
 * Public landing page for document share links.
 * Route: /share/:token
 *
 * Validates the share token (+ optional password) via the public
 * verifyShare tRPC procedure, then redirects to the presigned download URL.
 */

import { useState } from "react";
import { useParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FolderLock,
  Download,
  Lock,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Shield,
} from "lucide-react";

export default function ShareLanding() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [downloadReady, setDownloadReady] = useState<{
    url: string;
    filename: string;
    expiresAt: Date;
    downloadsRemaining: number | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = trpc.documentVault.verifyShare.useMutation({
    onSuccess: (data) => {
      setError(null);
      setDownloadReady({
        url: data.url,
        filename: data.filename,
        expiresAt: data.expiresAt,
        downloadsRemaining: data.downloadsRemaining,
      });
      // Auto-open download
      window.open(data.url, "_blank");
    },
    onError: (err) => {
      if (err.message === "Password required") {
        setNeedsPassword(true);
        setError(null);
      } else if (err.message === "Incorrect password") {
        setError("Incorrect password. Please try again.");
      } else {
        setError(err.message);
      }
    },
  });

  const handleAccess = () => {
    if (!token) return;
    verify.mutate({ token, password: needsPassword ? password : undefined });
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Invalid Link
            </CardTitle>
            <CardDescription>This share link is malformed or missing a token.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-6">
        {/* Brand header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-4">
            <FolderLock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">TradeGateway™</h1>
          <p className="text-sm text-muted-foreground mt-1">Secure Document Vault</p>
        </div>

        {downloadReady ? (
          /* Success state */
          <Card className="border-green-500/30 bg-green-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                Download Ready
              </CardTitle>
              <CardDescription>
                Your download for <span className="font-medium text-foreground">{downloadReady.filename}</span> has started.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Link expires: <span className="text-foreground">{new Date(downloadReady.expiresAt).toLocaleString()}</span>
              </p>
              {downloadReady.downloadsRemaining !== null && (
                <p>
                  Downloads remaining: <span className="text-foreground">{downloadReady.downloadsRemaining}</span>
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button
                className="w-full"
                onClick={() => window.open(downloadReady.url, "_blank")}
              >
                <Download className="h-4 w-4 mr-2" />
                Download Again
              </Button>
            </CardFooter>
          </Card>
        ) : error && !needsPassword ? (
          /* Error state (expired, revoked, not found, etc.) */
          <Card className="border-destructive/30 bg-destructive/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                Access Denied
              </CardTitle>
              <CardDescription>{error}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                This share link may have expired, been revoked, or reached its download limit.
                Please contact the sender for a new link.
              </p>
            </CardContent>
          </Card>
        ) : (
          /* Access form (initial or password prompt) */
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {needsPassword
                  ? <><Lock className="h-5 w-5 text-amber-400" /> Password Required</>
                  : <><Shield className="h-5 w-5 text-primary" /> Secure Document</>}
              </CardTitle>
              <CardDescription>
                {needsPassword
                  ? "This document is password protected. Enter the password to download."
                  : "You have been granted access to a secure document. Click below to download."}
              </CardDescription>
            </CardHeader>

            {needsPassword && (
              <CardContent>
                <div className="space-y-1.5">
                  <Label htmlFor="share-password">Password</Label>
                  <Input
                    id="share-password"
                    type="password"
                    placeholder="Enter password…"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAccess()}
                    autoFocus
                  />
                  {error && (
                    <p className="text-xs text-destructive mt-1">{error}</p>
                  )}
                </div>
              </CardContent>
            )}

            <CardFooter className="flex flex-col gap-3">
              <Button
                className="w-full"
                onClick={handleAccess}
                disabled={verify.isPending || (needsPassword && !password)}
              >
                {verify.isPending ? (
                  <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Verifying…</>
                ) : (
                  <><Download className="h-4 w-4 mr-2" /> {needsPassword ? "Download" : "Access Document"}</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                This link was shared via TradeGateway™ NGSWTP Document Vault.
                Files are stored in RustFS (S3-compatible) and served via presigned URLs.
              </p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
