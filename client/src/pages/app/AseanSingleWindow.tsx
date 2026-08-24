/**
 * ASEAN Single Window — G2G Connectivity Admin Panel
 * Sprint 57: Added Inbound Messages tab, Connectivity Status panel,
 *            ACDD/SSTC/ATIGA document type selector, retry/acknowledge actions.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  Globe, Send, Activity, CheckCircle2, XCircle, Clock,
  RefreshCw, Wifi, WifiOff, AlertTriangle, FileText, ArrowDownToLine,
  ArrowUpFromLine, Signal,
} from "lucide-react";

interface InboundMessage {
  id: string;
  message_ref: string;
  source_code: string;
  message_type: string;
  ucr: string;
  status: string;
  received_at: string;
  ack_reference?: string;
}

const TIER_COLOR: Record<string, string> = {
  excellent: "text-green-400",
  good:      "text-blue-400",
  degraded:  "text-yellow-400",
  poor:      "text-red-400",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface MemberState {
  code: string;
  name: string;
  gateway_url: string;
  protocol: string;
  status: "active" | "maintenance" | "offline";
  latency_ms: number;
  last_ping_at?: string;
}

interface OutboundMessage {
  id: string;
  message_ref: string;
  destination_code: string;
  message_type: string;
  ucr: string;
  status: string;
  sent_at?: string;
  acknowledged_at?: string;
  ack_reference?: string;
  error_message?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AseanSingleWindow() {
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [pingLoading, setPingLoading] = useState<string | null>(null);

  // Send message form
  const [destCode, setDestCode] = useState("SG");
  const [msgUcr, setMsgUcr] = useState("");
  const [msgTrader, setMsgTrader] = useState("");
  const [msgHsCode, setMsgHsCode] = useState("");
  const [msgDesc, setMsgDesc] = useState("");
  const [msgWeight, setMsgWeight] = useState("");
  const [msgValue, setMsgValue] = useState("");
  const [msgDuty, setMsgDuty] = useState("");
  const [msgTypeCode, setMsgTypeCode] = useState<"IM" | "EX" | "TR">("IM");

  const [ackDialogMsg, setAckDialogMsg] = useState<InboundMessage | null>(null);
  const [ackStatus, setAckStatus] = useState<"accepted" | "rejected">("accepted");
  const [ackReason, setAckReason] = useState("");
  const [msgDocType, setMsgDocType] = useState<"ACDD" | "SSTC" | "ATIGA">("ACDD");

  const connectionsQ = trpc.aseanSw.getConnections.useQuery();
  const messagesQ = trpc.aseanSw.listMessages.useQuery();
  const inboundQ = trpc.aseanSw.listInboundMessages.useQuery();
  const statsQ = trpc.aseanSw.getStats.useQuery();
  const connectivityQ = trpc.aseanSw.getConnectivityStatus.useQuery();
  const aseanUnavailable = connectionsQ.isError || messagesQ.isError || inboundQ.isError || statsQ.isError || connectivityQ.isError;

  const testMut = trpc.aseanSw.testConnection.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.name}: ${data.latency_ms}ms — ${data.status}`);
      connectionsQ.refetch();
      setPingLoading(null);
    },
    onError: (e) => { toast.error(e.message); setPingLoading(null); },
  });

  const sendMut = trpc.aseanSw.sendMessage.useMutation({
    onSuccess: () => {
      toast.success("G2G message queued for dispatch");
      setShowSendDialog(false);
      messagesQ.refetch();
      statsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const retryMut = trpc.aseanSw.retryMessage.useMutation({
    onSuccess: () => { toast.success("Message retry queued"); messagesQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const ackMut = trpc.aseanSw.acknowledgeMessage.useMutation({
    onSuccess: () => { toast.success("Message acknowledged"); setAckDialogMsg(null); inboundQ.refetch(); },
    onError: (e) => toast.error(e.message),
  });

  const connections: MemberState[] = (connectionsQ.data as any)?.connections ?? [];
  const messages: OutboundMessage[] = (messagesQ.data as any)?.messages ?? [];
  const inbound: InboundMessage[] = (inboundQ.data as any)?.messages ?? [];
  const connectivity: any[] = (connectivityQ.data as any)?.members ?? [];
  const stats = statsQ.data as any;

  const statusIcon = (s: string) => {
    if (s === "active") return <Wifi className="h-4 w-4 text-emerald-400" />;
    if (s === "maintenance") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
    return <WifiOff className="h-4 w-4 text-red-400" />;
  };

  const statusBadge = (s: string) => {
    if (s === "active" || s === "acknowledged") return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    if (s === "sent" || s === "pending" || s === "maintenance") return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    return "bg-red-500/15 text-red-400 border-red-500/30";
  };

  const msgStatusIcon = (s: string) => {
    if (s === "acknowledged") return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    if (s === "sent" || s === "pending") return <Clock className="h-4 w-4 text-amber-400" />;
    return <XCircle className="h-4 w-4 text-red-400" />;
  };

  const activeCount = connections.filter(c => c.status === "active").length;
  const ackCount = stats?.by_status?.acknowledged ?? 0;
  const totalMsgs = stats?.total ?? 0;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {aseanUnavailable && (
          <p className="text-sm text-amber-700">ASEAN Single Window integration unavailable — empty results are not being treated as healthy.</p>
        )}
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Globe className="h-6 w-6 text-blue-400" />
              ASEAN Single Window
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              G2G bilateral connectivity — WCO XML message exchange with ASEAN member states
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { connectionsQ.refetch(); messagesQ.refetch(); statsQ.refetch(); }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowSendDialog(true)}>
              <Send className="h-4 w-4 mr-1" /> Send Message
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Active Connections", value: aseanUnavailable ? "—" : `${connections.filter(c => c.status === "active").length}/10`, icon: <Wifi className="h-5 w-5 text-emerald-400" /> },
            { label: "Total Messages", value: aseanUnavailable ? "—" : stats?.total ?? "—", icon: <FileText className="h-5 w-5 text-blue-400" /> },
            { label: "Pending Inbound Acks", value: aseanUnavailable ? "—" : inbound.filter(m => m.status === "pending_ack").length, icon: <ArrowDownToLine className="h-5 w-5 text-yellow-400" /> },
            { label: "Failed/Rejected", value: aseanUnavailable ? "—" : (stats?.by_status?.failed ?? 0) + (stats?.by_status?.rejected ?? 0), icon: <XCircle className="h-5 w-5 text-red-400" /> },
          ].map((s) => (
            <Card key={s.label} className="bg-card border-border">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                    <p className="text-2xl font-bold text-foreground mt-1">{s.value}</p>
                  </div>
                  {s.icon}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs: Outbound / Inbound / Connectivity */}
        <Tabs defaultValue="outbound">
          <TabsList>
            <TabsTrigger value="outbound" className="gap-1"><ArrowUpFromLine className="w-3 h-3" /> Outbound</TabsTrigger>
            <TabsTrigger value="inbound" className="gap-1"><ArrowDownToLine className="w-3 h-3" /> Inbound</TabsTrigger>
            <TabsTrigger value="connectivity" className="gap-1"><Signal className="w-3 h-3" /> Connectivity</TabsTrigger>
          </TabsList>

          <TabsContent value="outbound">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Outbound G2G Messages</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Destination</TableHead><TableHead>Doc Type</TableHead><TableHead>UCR</TableHead><TableHead>Status</TableHead><TableHead>Sent At</TableHead><TableHead>Ack Ref</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {aseanUnavailable ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-amber-700 py-8">Outbound message data unavailable.</TableCell></TableRow>
                    ) : messages.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No outbound messages yet</TableCell></TableRow>
                    ) : messages.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.message_ref}</TableCell>
                        <TableCell><Badge variant="outline">{m.destination_code}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{m.message_type ?? "ACDD"}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{m.ucr}</TableCell>
                        <TableCell><Badge variant={m.status === "failed" || m.status === "rejected" ? "destructive" : m.status === "acknowledged" || m.status === "accepted" ? "default" : "secondary"}>{m.status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{m.sent_at ? new Date(m.sent_at).toLocaleString() : "—"}</TableCell>
                        <TableCell className="font-mono text-xs">{m.ack_reference ?? "—"}</TableCell>
                        <TableCell>{m.status === "failed" && <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => retryMut.mutate({ messageId: m.id })} disabled={retryMut.isPending}><RefreshCw className="w-3 h-3" /> Retry</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="inbound">
            <Card className="bg-card border-border">
              <CardHeader><CardTitle className="text-base">Inbound G2G Messages</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Ref</TableHead><TableHead>Source</TableHead><TableHead>Doc Type</TableHead><TableHead>UCR</TableHead><TableHead>Status</TableHead><TableHead>Received At</TableHead><TableHead>Ack Ref</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {aseanUnavailable ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-amber-700 py-8">Inbound message data unavailable.</TableCell></TableRow>
                    ) : inbound.length === 0 ? (
                      <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No inbound messages</TableCell></TableRow>
                    ) : inbound.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs">{m.message_ref}</TableCell>
                        <TableCell><Badge variant="outline">{m.source_code}</Badge></TableCell>
                        <TableCell><Badge variant="secondary">{m.message_type}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{m.ucr}</TableCell>
                        <TableCell><Badge variant={m.status === "rejected" ? "destructive" : m.status === "accepted" ? "default" : "outline"}>{m.status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(m.received_at).toLocaleString()}</TableCell>
                        <TableCell className="font-mono text-xs">{m.ack_reference ?? "—"}</TableCell>
                        <TableCell>{m.status === "pending_ack" && <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => { setAckDialogMsg(m); setAckStatus("accepted"); setAckReason(""); }}><CheckCircle2 className="w-3 h-3" /> Acknowledge</Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="connectivity">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {aseanUnavailable ? (
                <div className="col-span-2 text-center text-amber-700 py-12">Connectivity data unavailable.</div>
              ) : connectivity.length === 0 ? (
                <div className="col-span-2 text-center text-muted-foreground py-12">No connectivity data.</div>
              ) : connectivity.map((m: any) => (
                <Card key={m.code} className="bg-card border-border">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {m.status === "active" ? <Wifi className="w-5 h-5 text-green-400" /> : m.status === "maintenance" ? <AlertTriangle className="w-5 h-5 text-yellow-400" /> : <WifiOff className="w-5 h-5 text-red-400" />}
                      <div>
                        <p className="font-semibold text-foreground">{m.name} <span className="text-muted-foreground text-xs">({m.code})</span></p>
                        <p className="text-xs text-muted-foreground">Latency: {m.latency_ms}ms{m.uptime !== undefined && ` · Uptime: ${m.uptime}%`}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      {m.score !== undefined && <p className={`text-lg font-bold ${TIER_COLOR[m.tier ?? "good"]}`}>{m.score}</p>}
                      {m.tier && <p className={`text-xs capitalize ${TIER_COLOR[m.tier]}`}>{m.tier}</p>}
                      <Button size="sm" variant="ghost" className="mt-1 text-xs gap-1" onClick={() => { setPingLoading(m.code); testMut.mutate({ countryCode: m.code }); }} disabled={pingLoading === m.code}>
                        <Activity className="w-3 h-3" />{pingLoading === m.code ? "Pinging…" : "Ping"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Send Message Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Send G2G Message</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Destination</Label>
              <Select value={destCode} onValueChange={setDestCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["BN","KH","ID","LA","MY","MM","PH","SG","TH","VN"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Document Type</Label>
              <Select value={msgDocType} onValueChange={(v) => setMsgDocType(v as typeof msgDocType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACDD">ACDD — Customs Declaration</SelectItem>
                  <SelectItem value="SSTC">SSTC — Trade Certificate</SelectItem>
                  <SelectItem value="ATIGA">ATIGA — Form D (Origin)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Type Code</Label>
              <Select value={msgTypeCode} onValueChange={(v) => setMsgTypeCode(v as typeof msgTypeCode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IM">IM — Import</SelectItem>
                  <SelectItem value="EX">EX — Export</SelectItem>
                  <SelectItem value="TR">TR — Transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>UCR *</Label><Input value={msgUcr} onChange={(e) => setMsgUcr(e.target.value)} placeholder="UCR-2024-001" /></div>
            <div><Label>Trader Name</Label><Input value={msgTrader} onChange={(e) => setMsgTrader(e.target.value)} /></div>
            <div><Label>HS Code</Label><Input value={msgHsCode} onChange={(e) => setMsgHsCode(e.target.value)} placeholder="8471.30" /></div>
            <div><Label>Description</Label><Input value={msgDesc} onChange={(e) => setMsgDesc(e.target.value)} /></div>
            <div><Label>Weight (kg)</Label><Input type="number" value={msgWeight} onChange={(e) => setMsgWeight(e.target.value)} /></div>
            <div><Label>Invoice Value</Label><Input type="number" value={msgValue} onChange={(e) => setMsgValue(e.target.value)} /></div>
            <div className="col-span-2"><Label>Duty Amount</Label><Input type="number" value={msgDuty} onChange={(e) => setMsgDuty(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>Cancel</Button>
            <Button disabled={!msgUcr || sendMut.isPending} onClick={() => sendMut.mutate({ destinationCode: destCode, messageType: msgDocType, ucr: msgUcr, traderName: msgTrader || undefined, hsCode: msgHsCode || undefined, description: msgDesc || undefined, grossWeightKg: msgWeight ? parseFloat(msgWeight) : undefined, invoiceValue: msgValue ? parseFloat(msgValue) : undefined, dutyAmount: msgDuty ? parseFloat(msgDuty) : undefined, typeCode: msgTypeCode })}>
              {sendMut.isPending ? "Sending…" : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Acknowledge Dialog */}
      {ackDialogMsg && (
        <Dialog open onOpenChange={() => setAckDialogMsg(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Acknowledge Inbound Message</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Message <span className="font-mono font-semibold">{ackDialogMsg.message_ref}</span> from <strong>{ackDialogMsg.source_code}</strong> — {ackDialogMsg.message_type}</p>
              <div>
                <Label>Decision</Label>
                <Select value={ackStatus} onValueChange={(v) => setAckStatus(v as "accepted" | "rejected")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="accepted">Accept</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {ackStatus === "rejected" && <div><Label>Rejection Reason</Label><Input value={ackReason} onChange={(e) => setAckReason(e.target.value)} /></div>}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAckDialogMsg(null)}>Cancel</Button>
              <Button disabled={ackMut.isPending} onClick={() => ackMut.mutate({ messageId: ackDialogMsg.id, status: ackStatus, reason: ackReason || undefined })}>
                {ackMut.isPending ? "Sending…" : "Confirm"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </DashboardLayout>
  );
}
