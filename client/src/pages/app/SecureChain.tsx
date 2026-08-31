/**
 * WP-7 Secure Chain — PIN-free, verified-chain digital container release
 * (Portbase-style). Chain management (create / nominate / accept / decline /
 * revoke), digest evidence (hash-chained audit trail) and the terminal
 * release status with the single-use signed release token.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Link2, ShieldCheck, ShieldAlert, Container, KeyRound,
  CheckCircle2, XCircle, ScrollText, RefreshCw, Ban,
} from "lucide-react";

type Link = {
  seq: number; from_org: string; to_org: string;
  accepted_at?: string; declined_at?: string; revoked_at?: string;
  link_hash: string;
};

type Chain = {
  chain_id: string; container_id: string; bl_digest: string; issuer_org: string;
  status: "ACTIVE" | "COMPLETED" | "REVOKED" | "EXPIRED";
  velocity_hold: boolean; expires_at: string; links?: Link[];
};

type AuditEntry = {
  audit_seq: number; event_type: string; prev_hash: string; entry_hash: string; created_at: string;
};

const STATUS_VARIANT: Record<Chain["status"], "default" | "secondary" | "destructive" | "outline"> = {
  ACTIVE: "default", COMPLETED: "secondary", REVOKED: "destructive", EXPIRED: "outline",
};

function linkState(link: Link): string {
  if (link.accepted_at) return "ACCEPTED";
  if (link.declined_at) return "DECLINED";
  if (link.revoked_at) return "REVOKED";
  return "PENDING";
}

export default function SecureChain() {
  const [containerId, setContainerId] = useState("");
  const [lookup, setLookup] = useState("");
  const [blDigest, setBlDigest] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [toOrg, setToOrg] = useState("");
  const [reason, setReason] = useState("");
  const [gateId, setGateId] = useState("GATE-1");

  const chainQ = trpc.secureChain.getChain.useQuery(
    { containerId: lookup },
    { enabled: /^[A-Z]{4}[0-9]{7}$/.test(lookup), retry: false },
  );
  const chain = chainQ.data as Chain | undefined;

  const auditQ = trpc.secureChain.auditTrail.useQuery(
    { chainId: chain?.chain_id ?? "" },
    { enabled: Boolean(chain?.chain_id), retry: false },
  );

  const releaseQ = trpc.secureChain.releaseAuthorization.useQuery(
    { containerId: lookup },
    { enabled: false, retry: false },
  );

  const utils = trpc.useUtils();
  const refresh = () => {
    utils.secureChain.getChain.invalidate({ containerId: lookup });
    if (chain?.chain_id) utils.secureChain.auditTrail.invalidate({ chainId: chain.chain_id });
  };
  const onError = (error: { message: string }) => toast.error(error.message);
  const onSuccess = (message: string) => () => { toast.success(message); refresh(); };

  const registerBL = trpc.secureChain.registerBLAuthority.useMutation({ onSuccess: onSuccess("B/L release authority registered"), onError });
  const createChain = trpc.secureChain.createChain.useMutation({ onSuccess: onSuccess("Release chain created"), onError });
  const nominate = trpc.secureChain.nominate.useMutation({ onSuccess: onSuccess("Next organisation nominated"), onError });
  const accept = trpc.secureChain.accept.useMutation({ onSuccess: onSuccess("Link accepted"), onError });
  const decline = trpc.secureChain.decline.useMutation({ onSuccess: onSuccess("Link declined — tail returned to nominator"), onError });
  const revoke = trpc.secureChain.revoke.useMutation({ onSuccess: onSuccess("Chain revoked"), onError });
  const consume = trpc.secureChain.consumeRelease.useMutation({ onSuccess: onSuccess("Release token consumed at gate"), onError });

  const pendingLink = chain?.links?.find(l => !l.accepted_at && !l.declined_at && !l.revoked_at);
  const releaseToken = releaseQ.data as { nonce: string; expires_at: string; holder_org: string } | undefined;

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Container className="h-6 w-6" /> Secure Chain</h1>
            <p className="text-muted-foreground">PIN-free, verified-chain digital container release (WP-7)</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
        </div>

        {/* Lookup */}
        <Card>
          <CardHeader>
            <CardTitle>Container lookup</CardTitle>
            <CardDescription>ISO 6346 container number, e.g. MSCU1234567</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input value={containerId} onChange={e => setContainerId(e.target.value.toUpperCase())} placeholder="MSCU1234567" className="max-w-xs" />
            <Button onClick={() => setLookup(containerId)} disabled={!/^[A-Z]{4}[0-9]{7}$/.test(containerId)}>Load chain</Button>
          </CardContent>
        </Card>

        {lookup && chainQ.isLoading && <Skeleton className="h-40 w-full" />}
        {lookup && chainQ.error && (
          <Card><CardContent className="pt-6 text-sm text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> {chainQ.error.message}
          </CardContent></Card>
        )}

        {chain && (
          <>
            {/* Status */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Chain {chain.chain_id.slice(0, 8)}… <Badge variant={STATUS_VARIANT[chain.status]}>{chain.status}</Badge>
                    {chain.velocity_hold && <Badge variant="destructive">VELOCITY HOLD</Badge>}
                  </CardTitle>
                  <CardDescription>
                    Issuer {chain.issuer_org} · B/L digest {chain.bl_digest.slice(0, 16)}… · expires {new Date(chain.expires_at).toLocaleString()}
                  </CardDescription>
                </div>
                {chain.status === "ACTIVE" && (
                  <div className="flex gap-2">
                    <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="revoke reason" className="w-48" />
                    <Button variant="destructive" size="sm" disabled={!reason || revoke.isPending}
                      onClick={() => revoke.mutate({ chainId: chain.chain_id, reason })}>
                      <Ban className="h-4 w-4 mr-1" /> Revoke
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {(chain.links ?? []).map(link => (
                  <div key={link.seq} className="flex items-center justify-between rounded border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Link2 className="h-4 w-4" />
                      <span>#{link.seq} {link.from_org} → {link.to_org}</span>
                      <Badge variant={linkState(link) === "ACCEPTED" ? "default" : linkState(link) === "PENDING" ? "outline" : "destructive"}>
                        {linkState(link)}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-muted-foreground">{link.link_hash.slice(0, 12)}…</code>
                      {linkState(link) === "PENDING" && chain.status === "ACTIVE" && (
                        <>
                          <Button size="sm" variant="outline" disabled={accept.isPending}
                            onClick={() => accept.mutate({ chainId: chain.chain_id, seq: link.seq })}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Accept
                          </Button>
                          <Button size="sm" variant="outline" disabled={!reason || decline.isPending}
                            onClick={() => decline.mutate({ chainId: chain.chain_id, seq: link.seq, reason })}>
                            <XCircle className="h-4 w-4 mr-1" /> Decline
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {chain.status === "ACTIVE" && !pendingLink && (
                  <div className="flex gap-2 pt-2">
                    <Input value={toOrg} onChange={e => setToOrg(e.target.value)} placeholder="next organisation id" className="max-w-xs" />
                    <Button disabled={toOrg.trim().length < 2 || nominate.isPending}
                      onClick={() => nominate.mutate({ chainId: chain.chain_id, toOrg: toOrg.trim() })}>
                      Nominate next holder
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Terminal release */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Terminal release</CardTitle>
                <CardDescription>
                  Single-use, short-TTL, envelope-signed release token — issued only to the verified chain tail.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => releaseQ.refetch()} disabled={releaseQ.isFetching}>
                    {releaseQ.isFetching ? "Checking…" : "Request release authorization"}
                  </Button>
                  {releaseQ.error && <span className="text-sm text-destructive self-center">{releaseQ.error.message}</span>}
                </div>
                {releaseToken && (
                  <div className="rounded border p-3 text-sm space-y-2">
                    <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-green-500" />
                      Release authorized to <b>{releaseToken.holder_org}</b> until {new Date(releaseToken.expires_at).toLocaleString()}
                    </div>
                    <code className="block break-all text-xs">{releaseToken.nonce}</code>
                    <div className="flex gap-2">
                      <Input value={gateId} onChange={e => setGateId(e.target.value)} className="w-32" />
                      <Button size="sm" disabled={consume.isPending}
                        onClick={() => consume.mutate({ nonce: releaseToken.nonce, gateId })}>
                        Consume at gate
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Digest evidence */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><ScrollText className="h-5 w-5" /> Audit evidence</CardTitle>
                <CardDescription>Hash-chained append-only audit ledger — every handoff is auditable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1 text-xs font-mono">
                {auditQ.isLoading && <Skeleton className="h-24 w-full" />}
                {((auditQ.data as { entries?: AuditEntry[] } | undefined)?.entries ?? []).map(entry => (
                  <div key={entry.audit_seq} className="flex justify-between border-b py-1">
                    <span>#{entry.audit_seq} {entry.event_type}</span>
                    <span className="text-muted-foreground">{entry.entry_hash.slice(0, 16)}…</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}

        {/* Create chain */}
        <Card>
          <CardHeader>
            <CardTitle>Open a release chain (shipping line)</CardTitle>
            <CardDescription>Register B/L release authority, then create the chain.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 max-w-lg">
              <Label>B/L digest (SHA-256 hex of the carrier manifest record)</Label>
              <Input value={blDigest} onChange={e => setBlDigest(e.target.value.toLowerCase())} placeholder="9f2c…" />
              <Label>Chain expiry (RFC 3339)</Label>
              <Input value={expiresAt} onChange={e => setExpiresAt(e.target.value)} placeholder="2026-09-30T00:00:00Z" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={!/^[0-9a-f]{64}$/.test(blDigest) || !/^[A-Z]{4}[0-9]{7}$/.test(lookup) || registerBL.isPending}
                onClick={() => registerBL.mutate({ containerId: lookup, blDigest })}>
                Register B/L authority
              </Button>
              <Button disabled={!/^[0-9a-f]{64}$/.test(blDigest) || !expiresAt || !/^[A-Z]{4}[0-9]{7}$/.test(lookup) || createChain.isPending}
                onClick={() => createChain.mutate({
                  containerId: lookup, blDigest, expiresAt,
                  idempotencyKey: `sw-${lookup}-${Date.now()}`,
                })}>
                Create chain
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
