/**
 * ASEAN Single Window — G2G Connectivity Admin Panel
 * Displays bilateral connection status for all 10 ASEAN member states,
 * allows sending WCO XML declaration messages, and shows message history.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  RefreshCw, Wifi, WifiOff, AlertTriangle, FileText,
} from "lucide-react";

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

  const connectionsQ = trpc.aseanSw.getConnections.useQuery();
  const messagesQ = trpc.aseanSw.listMessages.useQuery();
  const statsQ = trpc.aseanSw.getStats.useQuery();

  const testMut = trpc.aseanSw.testConnection.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.name}: ${data.latency_ms}ms — ${data.status}`);
      connectionsQ.refetch();
      setPingLoading(null);
    },
    onError: (e) => { toast.error(e.message); setPingLoading(null); },
  });

  const sendMut = trpc.aseanSw.sendMessage.useMutation({
    onSuccess: (data) => {
      toast.success(`Message sent: ${data.message.message_ref} — ${data.message.status}`);
      setShowSendDialog(false);
      messagesQ.refetch();
      statsQ.refetch();
    },
    onError: (e) => toast.error(e.message),
  });

  const connections: MemberState[] = (connectionsQ.data as any)?.connections ?? [];
  const messages: OutboundMessage[] = (messagesQ.data as any)?.messages ?? [];
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
            { label: "Active Connections", value: `${activeCount}/10`, icon: <Wifi className="h-5 w-5 text-emerald-400" /> },
            { label: "Total Messages", value: totalMsgs, icon: <FileText className="h-5 w-5 text-blue-400" /> },
            { label: "Acknowledged", value: ackCount, icon: <CheckCircle2 className="h-5 w-5 text-emerald-400" /> },
            { label: "Failed/Rejected", value: (stats?.by_status?.failed ?? 0) + (stats?.by_status?.rejected ?? 0), icon: <XCircle className="h-5 w-5 text-red-400" /> },
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

        {/* Connection Status Grid */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4" /> Bilateral Connection Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Globe className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>Loading connection status...</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connections.map((c) => (
                  <div key={c.code} className="flex items-center justify-between p-3 rounded-lg bg-muted/20 border border-border">
                    <div className="flex items-center gap-3">
                      {statusIcon(c.status)}
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.protocol} · {c.latency_ms > 0 ? `${c.latency_ms}ms` : "not pinged"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={statusBadge(c.status)}>{c.status}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={c.status === "offline" || pingLoading === c.code}
                        onClick={() => {
                          setPingLoading(c.code);
                          testMut.mutate({ countryCode: c.code });
                        }}
                      >
                        {pingLoading === c.code ? <RefreshCw className="h-3 w-3 animate-spin" /> : "Ping"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Message History */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base">Outbound Message History</CardTitle>
          </CardHeader>
          <CardContent>
            {messages.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No messages sent yet.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Message Ref</TableHead>
                    <TableHead>Destination</TableHead>
                    <TableHead>UCR</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sent At</TableHead>
                    <TableHead>ACK Ref</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-mono text-xs">{m.message_ref}</TableCell>
                      <TableCell>
                        <span className="font-medium">{m.destination_code}</span>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.ucr}</TableCell>
                      <TableCell>{m.message_type}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {msgStatusIcon(m.status)}
                          <Badge variant="outline" className={statusBadge(m.status)}>{m.status}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {m.sent_at ? new Date(m.sent_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{m.ack_reference ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Send Message Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Send WCO XML Declaration Message</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Destination Country</Label>
              <Select value={destCode} onValueChange={setDestCode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {connections.filter(c => c.status !== "offline").map(c => (
                    <SelectItem key={c.code} value={c.code}>{c.code} — {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Message Type</Label>
              <Select value={msgTypeCode} onValueChange={(v) => setMsgTypeCode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="IM">IM — Import</SelectItem>
                  <SelectItem value="EX">EX — Export</SelectItem>
                  <SelectItem value="TR">TR — Transit</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>UCR</Label><Input value={msgUcr} onChange={(e) => setMsgUcr(e.target.value)} placeholder="GH2024UCR001" /></div>
            <div><Label>Trader Name</Label><Input value={msgTrader} onChange={(e) => setMsgTrader(e.target.value)} /></div>
            <div><Label>HS Code</Label><Input value={msgHsCode} onChange={(e) => setMsgHsCode(e.target.value)} placeholder="8471.30" /></div>
            <div><Label>Description</Label><Input value={msgDesc} onChange={(e) => setMsgDesc(e.target.value)} /></div>
            <div><Label>Gross Weight (kg)</Label><Input type="number" value={msgWeight} onChange={(e) => setMsgWeight(e.target.value)} /></div>
            <div><Label>Invoice Value (USD)</Label><Input type="number" value={msgValue} onChange={(e) => setMsgValue(e.target.value)} /></div>
            <div className="col-span-2"><Label>Duty Amount (USD)</Label><Input type="number" value={msgDuty} onChange={(e) => setMsgDuty(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSendDialog(false)}>Cancel</Button>
            <Button onClick={() => sendMut.mutate({
              destinationCode: destCode,
              ucr: msgUcr,
              traderName: msgTrader,
              hsCode: msgHsCode,
              description: msgDesc,
              grossWeightKg: parseFloat(msgWeight) || 0,
              invoiceValue: parseFloat(msgValue) || 0,
              currency: "USD",
              dutyAmount: parseFloat(msgDuty) || 0,
              typeCode: msgTypeCode,
            })} disabled={sendMut.isPending}>
              {sendMut.isPending ? "Sending..." : <><Send className="h-4 w-4 mr-1" /> Send WCO Message</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
