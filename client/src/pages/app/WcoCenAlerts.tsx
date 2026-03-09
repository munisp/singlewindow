import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  Shield, AlertTriangle, Send, RefreshCw, Globe, Clock,
  CheckCircle, XCircle, Eye, Zap, Activity, Radio
} from "lucide-react";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-yellow-500 text-black",
  low: "bg-blue-500 text-white",
  info: "bg-gray-500 text-white",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  sent: <CheckCircle className="w-4 h-4 text-green-500" />,
  acknowledged: <CheckCircle className="w-4 h-4 text-blue-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
  pending: <Clock className="w-4 h-4 text-yellow-500" />,
};

export default function WcoCenAlerts() {
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterCountry, setFilterCountry] = useState("");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchForm, setDispatchForm] = useState<{
    partnerCode: string;
    alertType: "RISK_PROFILE" | "SEIZURE" | "WANTED_PERSON" | "VESSEL_WATCH" | "GENERAL";
    priority: "LOW" | "MEDIUM" | "HIGH";
    subject: string;
    description: string;
    hsCode: string;
    ucr: string;
    traderRef: string;
  }>({
    partnerCode: "",
    alertType: "GENERAL",
    priority: "MEDIUM",
    subject: "",
    description: "",
    hsCode: "",
    ucr: "",
    traderRef: "",
  });

  const { data: alertsData, isLoading: alertsLoading, refetch: refetchAlerts } =
    trpc.cen.listAlerts.useQuery({});

  const { data: connectionsData } = trpc.cen.getPartners.useQuery({ activeOnly: true });
  const { data: statsData } = trpc.cen.getStats.useQuery();

  const dispatchMutation = trpc.cen.sendAlert.useMutation({
    onSuccess: () => {
      toast.success("CEN alert dispatched successfully");
      setDispatchOpen(false);
      refetchAlerts();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const acknowledgeAlert = trpc.cen.acknowledgeAlert.useMutation({
    onSuccess: () => { toast.success("Alert acknowledged"); refetchAlerts(); },
    onError: (err: any) => toast.error(err.message),
  });

  const handleDispatch = () => {
    if (!dispatchForm.partnerCode || !dispatchForm.subject || !dispatchForm.description) {
      toast.error("Please fill in all required fields");
      return;
    }
    dispatchMutation.mutate({
      partnerCode: dispatchForm.partnerCode,
      alertType: dispatchForm.alertType,
      priority: dispatchForm.priority,
      subject: dispatchForm.subject,
      description: dispatchForm.description,
      hsCode: dispatchForm.hsCode || undefined,
      ucr: dispatchForm.ucr || undefined,
      traderRef: dispatchForm.traderRef || undefined,
    });
  };

  const filteredAlerts = (alertsData?.alerts ?? []).filter((a: any) =>
    !filterCountry || a.targetCountry?.toLowerCase().includes(filterCountry.toLowerCase()) ||
    a.sourceCountry?.toLowerCase().includes(filterCountry.toLowerCase())
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="w-7 h-7 text-red-500" />
              WCO CEN Network
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Customs Enforcement Network — real-time risk alert exchange with partner administrations
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetchAlerts()}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
            <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-red-600 hover:bg-red-700 text-white">
                  <Send className="w-4 h-4 mr-2" />
                  Dispatch Alert
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Dispatch CEN Risk Alert</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Partner Code *</Label>
                      <Input
                        placeholder="e.g. KE, TZ, UG"
                        value={dispatchForm.partnerCode}
                        onChange={e => setDispatchForm(f => ({ ...f, partnerCode: e.target.value.toUpperCase() }))}
                      />
                    </div>
                    <div>
                      <Label>Alert Type</Label>
                      <Select value={dispatchForm.alertType} onValueChange={v => setDispatchForm(f => ({ ...f, alertType: v as any }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="GENERAL">General</SelectItem>
                          <SelectItem value="RISK_PROFILE">Risk Profile</SelectItem>
                          <SelectItem value="SEIZURE">Seizure</SelectItem>
                          <SelectItem value="WANTED_PERSON">Wanted Person</SelectItem>
                          <SelectItem value="VESSEL_WATCH">Vessel Watch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label>Priority</Label>
                    <Select value={dispatchForm.priority} onValueChange={v => setDispatchForm(f => ({ ...f, priority: v as any }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Subject *</Label>
                    <Input
                      placeholder="Brief alert subject"
                      value={dispatchForm.subject}
                      onChange={e => setDispatchForm(f => ({ ...f, subject: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label>Description *</Label>
                    <Textarea
                      placeholder="Detailed alert description..."
                      rows={3}
                      value={dispatchForm.description}
                      onChange={e => setDispatchForm(f => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>HS Code (optional)</Label>
                      <Input
                        placeholder="e.g. 2701.12"
                        value={dispatchForm.hsCode}
                        onChange={e => setDispatchForm(f => ({ ...f, hsCode: e.target.value }))}
                      />
                    </div>
                    <div>
                      <Label>UCR (optional)</Label>
                      <Input
                        placeholder="Unique Consignment Ref"
                        value={dispatchForm.ucr}
                        onChange={e => setDispatchForm(f => ({ ...f, ucr: e.target.value }))}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full bg-red-600 hover:bg-red-700 text-white"
                    onClick={handleDispatch}
                    disabled={dispatchMutation.isPending}
                  >
                    {dispatchMutation.isPending ? "Dispatching..." : "Dispatch Alert"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Alerts Sent (30d)", value: statsData?.sentLast30Days ?? "—", icon: <Send className="w-5 h-5 text-blue-500" />, color: "text-blue-600" },
            { label: "Alerts Received (30d)", value: statsData?.receivedLast30Days ?? "—", icon: <Radio className="w-5 h-5 text-green-500" />, color: "text-green-600" },
            { label: "Active Connections", value: (connectionsData as any)?.partners?.filter((c: any) => c.status === "active").length ?? "—", icon: <Globe className="w-5 h-5 text-purple-500" />, color: "text-purple-600" },
            { label: "Critical Unresolved", value: statsData?.criticalUnresolved ?? "—", icon: <AlertTriangle className="w-5 h-5 text-red-500" />, color: "text-red-600" },
          ].map(stat => (
            <Card key={stat.label}>
              <CardContent className="p-4 flex items-center gap-3">
                {stat.icon}
                <div>
                  <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Alert Feed */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Alert Feed
                  </CardTitle>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Filter by country..."
                      className="h-8 w-36 text-xs"
                      value={filterCountry}
                      onChange={e => setFilterCountry(e.target.value)}
                    />
                    <Select value={filterSeverity} onValueChange={setFilterSeverity}>
                      <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="HIGH">High</SelectItem>
                        <SelectItem value="MEDIUM">Medium</SelectItem>
                        <SelectItem value="LOW">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {alertsLoading ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Loading alerts...</div>
                ) : filteredAlerts.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">
                    <Shield className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No alerts matching current filters
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredAlerts.map((alert: any) => (
                      <div key={alert.id} className="p-4 hover:bg-muted/30 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={`text-xs px-2 py-0 ${SEVERITY_COLORS[alert.severity] ?? "bg-gray-500 text-white"}`}>
                                {alert.severity?.toUpperCase()}
                              </Badge>
                              <span className="text-xs text-muted-foreground font-mono">{alert.alertType?.replace(/_/g, " ")}</span>
                              <span className="text-xs text-muted-foreground">
                                {alert.direction === "outbound" ? "→" : "←"} {alert.targetCountry ?? alert.sourceCountry}
                              </span>
                            </div>
                            <div className="font-medium text-sm truncate">{alert.subject}</div>
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{alert.description}</div>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                              {STATUS_ICONS[alert.status]}
                              <span className="capitalize">{alert.status}</span>
                              <span>·</span>
                              <Clock className="w-3 h-3" />
                              <span>{new Date(alert.createdAt).toLocaleString()}</span>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => toast.info(`Alert ID: ${alert.id}\n${alert.description}`)}
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </Button>
                            {alert.status === "pending" && alert.direction === "inbound" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-green-600"
                                onClick={() => acknowledgeAlert.mutate({ alertId: alert.id })}
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Partner Connections */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  Partner Connections
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!connectionsData || connectionsData.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground text-sm">No connections configured</div>
                ) : (
                  <div className="divide-y divide-border">
                    {(connectionsData as any[]).map((conn: any) => (
                      <div key={conn.countryCode} className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{conn.countryName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{conn.countryCode}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${conn.status === "active" ? "bg-green-500" : conn.status === "degraded" ? "bg-yellow-500" : "bg-red-500"}`} />
                          <span className="text-xs text-muted-foreground capitalize">{conn.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Quick Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm"
                  onClick={() => { setDispatchForm(f => ({ ...f, alertType: "RISK_PROFILE", priority: "HIGH" })); setDispatchOpen(true); }}
                >
                  <AlertTriangle className="w-4 h-4 mr-2 text-red-500" />
                  Dispatch Sanctions Alert
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm"
                  onClick={() => { setDispatchForm(f => ({ ...f, alertType: "SEIZURE", priority: "HIGH" })); setDispatchOpen(true); }}
                >
                  <Shield className="w-4 h-4 mr-2 text-orange-500" />
                  Report Smuggling Attempt
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start text-sm"
                  onClick={() => refetchAlerts()}
                >
                  <RefreshCw className="w-4 h-4 mr-2 text-blue-500" />
                  Sync Inbound Alerts
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
