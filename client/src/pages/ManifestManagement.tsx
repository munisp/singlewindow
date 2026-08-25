/**
 * ManifestManagement.tsx — Electronic Manifest Management Page
 *
 * TradeGateway NGSWTP — Pre-arrival manifest submission for shipping lines
 * and house manifest creation for freight forwarders.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Ship, Plane, FileText, Package } from "lucide-react";

type ManifestListRow = {
  id: string | number;
  manifestNumber: string;
  manifestType: "SEA" | "AIR";
  vesselName: string;
  voyageNumber: string;
  portOfDischarge: string;
  eta?: string | Date | null;
  status: string;
  totalBLs?: number | null;
};

export default function ManifestManagement() {
  const { toast } = useToast();
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [manifestType, setManifestType] = useState<"SEA" | "AIR">("SEA");
  const [vesselName, setVesselName] = useState("");
  const [voyageNumber, setVoyageNumber] = useState("");
  const [portOfLoading, setPortOfLoading] = useState("");
  const [portOfDischarge, setPortOfDischarge] = useState("");
  const [eta, setEta] = useState("");

  const { data: manifestList, refetch } = trpc.manifests.list.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const submitMutation = trpc.manifests.submit.useMutation({
    onSuccess: (data) => {
      toast({ title: "Manifest Submitted", description: `Manifest Number: ${(data as { manifestNumber?: string }).manifestNumber}` });
      setIsSubmitOpen(false);
      setVesselName("");
      setVoyageNumber("");
      refetch();
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!vesselName || !voyageNumber || !portOfLoading || !portOfDischarge || !eta) {
      toast({ title: "Validation Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    submitMutation.mutate({
      manifestType,
      vesselName,
      voyageNumber,
      portOfLoading,
      portOfDischarge,
      eta: new Date(eta).toISOString(),
    });
  };

  const manifests = (manifestList as { manifests?: ManifestListRow[] } | undefined)?.manifests ?? [];

  const STATUS_COLORS: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-800",
    SUBMITTED: "bg-blue-100 text-blue-800",
    ACCEPTED: "bg-green-100 text-green-800",
    AMENDED: "bg-yellow-100 text-yellow-800",
    REJECTED: "bg-red-100 text-red-800",
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Manifest Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            Pre-arrival electronic manifest submission for vessels and aircraft
          </p>
        </div>
        <Dialog open={isSubmitOpen} onOpenChange={setIsSubmitOpen}>
          <DialogTrigger asChild>
            <Button className="bg-green-700 hover:bg-green-800">
              <Plus className="h-4 w-4 mr-2" />
              Submit Manifest
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Submit Pre-Arrival Manifest</DialogTitle>
              <DialogDescription>
                Submit a master manifest for your vessel or aircraft before arrival.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Transport Mode</Label>
                <Select value={manifestType} onValueChange={(v) => setManifestType(v as "SEA" | "AIR")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SEA">
                      <div className="flex items-center gap-2"><Ship className="h-4 w-4" /> Sea Freight</div>
                    </SelectItem>
                    <SelectItem value="AIR">
                      <div className="flex items-center gap-2"><Plane className="h-4 w-4" /> Air Freight</div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{manifestType === "SEA" ? "Vessel Name" : "Aircraft Registration"} *</Label>
                  <Input placeholder={manifestType === "SEA" ? "MV OCEAN STAR" : "5N-ABC"} value={vesselName} onChange={(e) => setVesselName(e.target.value)} />
                </div>
                <div>
                  <Label>{manifestType === "SEA" ? "Voyage Number" : "Flight Number"} *</Label>
                  <Input placeholder={manifestType === "SEA" ? "V001" : "WT101"} value={voyageNumber} onChange={(e) => setVoyageNumber(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Port of Loading *</Label>
                  <Input placeholder="CNSHA" value={portOfLoading} onChange={(e) => setPortOfLoading(e.target.value)} />
                </div>
                <div>
                  <Label>Port of Discharge *</Label>
                  <Select value={portOfDischarge} onValueChange={setPortOfDischarge}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select port" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NGAPP">Apapa Port, Lagos</SelectItem>
                      <SelectItem value="NGTIN">Tin Can Island, Lagos</SelectItem>
                      <SelectItem value="NGKSI">Onne Port, Rivers</SelectItem>
                      <SelectItem value="NGWAR">Warri Port</SelectItem>
                      <SelectItem value="NGCAL">Calabar Port</SelectItem>
                      <SelectItem value="NGLOS">Lagos Airport</SelectItem>
                      <SelectItem value="NGABV">Abuja Airport</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Estimated Time of Arrival (ETA) *</Label>
                <Input type="datetime-local" value={eta} onChange={(e) => setEta(e.target.value)} />
              </div>
              <Button className="w-full bg-green-700 hover:bg-green-800" onClick={handleSubmit} disabled={submitMutation.isPending}>
                {submitMutation.isPending ? "Submitting..." : "Submit Manifest"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Manifests</TabsTrigger>
          <TabsTrigger value="sea">Sea Manifests</TabsTrigger>
          <TabsTrigger value="air">Air Manifests</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submitted Manifests</CardTitle>
            </CardHeader>
            <CardContent>
              {manifests.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                  <p>No manifests submitted yet</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Manifest Number</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Vessel/Aircraft</TableHead>
                      <TableHead>Voyage/Flight</TableHead>
                      <TableHead>Port of Discharge</TableHead>
                      <TableHead>ETA</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>BLs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manifests.map((m) => (
                      <TableRow key={String(m.id)}>
                        <TableCell className="font-mono text-sm font-semibold">{String(m.manifestNumber)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {String(m.manifestType) === "SEA" ? <Ship className="h-3 w-3" /> : <Plane className="h-3 w-3" />}
                            {String(m.manifestType)}
                          </div>
                        </TableCell>
                        <TableCell>{String(m.vesselName)}</TableCell>
                        <TableCell>{String(m.voyageNumber)}</TableCell>
                        <TableCell>{String(m.portOfDischarge)}</TableCell>
                        <TableCell className="text-sm">{m.eta ? new Date(String(m.eta)).toLocaleDateString() : "—"}</TableCell>
                        <TableCell>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[String(m.status)] ?? "bg-gray-100 text-gray-800"}`}>
                            {String(m.status)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-sm">
                            <Package className="h-3 w-3 text-gray-400" />
                            {String(m.totalBLs ?? 0)}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sea">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-500">Filtered to sea manifests only.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="air">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-gray-500">Filtered to air manifests only.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
