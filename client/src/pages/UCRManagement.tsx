/**
 * UCRManagement.tsx — Unique Consignment Reference (UCR) Management Page
 *
 * TradeGateway NGSWTP — Implements the WCO UCR standard for consignment tracking.
 * Allows traders to generate, view, and manage UCRs for their shipments.
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
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, FileText, CheckCircle, Clock, XCircle, Link } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  CREATED: "bg-blue-100 text-blue-800",
  LINKED: "bg-purple-100 text-purple-800",
  ACTIVE: "bg-green-100 text-green-800",
  CLEARED: "bg-emerald-100 text-emerald-800",
  CLOSED: "bg-gray-100 text-gray-800",
  CANCELLED: "bg-red-100 text-red-800",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  CREATED: <Clock className="h-3 w-3" />,
  LINKED: <Link className="h-3 w-3" />,
  ACTIVE: <CheckCircle className="h-3 w-3" />,
  CLEARED: <CheckCircle className="h-3 w-3" />,
  CLOSED: <XCircle className="h-3 w-3" />,
};

export default function UCRManagement() {
  const { toast } = useToast();
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [validateInput, setValidateInput] = useState("");
  const [validationResult, setValidationResult] = useState<Record<string, unknown> | null>(null);

  // Form state
  const [ucrType, setUcrType] = useState<"SINGLE" | "MULTIPLE">("SINGLE");
  const [consigneeRef, setConsigneeRef] = useState("");
  const [portOfEntry, setPortOfEntry] = useState("");

  const { data: ucrList, refetch } = trpc.ucr.listByTrader.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const generateMutation = trpc.ucr.generate.useMutation({
    onSuccess: (data) => {
      toast({ title: "UCR Generated", description: `UCR Number: ${data.ucrNumber}` });
      setIsGenerateOpen(false);
      setConsigneeRef("");
      setPortOfEntry("");
      refetch();
    },
    onError: (err) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const validateQuery = trpc.ucr.validate.useQuery(
    { ucrNumber: validateInput },
    { enabled: false }
  );

  const handleGenerate = () => {
    if (!consigneeRef || !portOfEntry) {
      toast({ title: "Validation Error", description: "Please fill all required fields", variant: "destructive" });
      return;
    }
    generateMutation.mutate({ ucrType, consigneeRef, portOfEntry });
  };

  const handleValidate = async () => {
    if (!validateInput) return;
    const result = await validateQuery.refetch();
    setValidationResult(result.data as Record<string, unknown> ?? null);
  };

  const ucrs = (ucrList as { ucrs?: unknown[] } | undefined)?.ucrs ?? [];

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">UCR Management</h1>
          <p className="text-gray-500 text-sm mt-1">
            Unique Consignment Reference — WCO ISO 15459 compliant tracking identifiers
          </p>
        </div>
        <Dialog open={isGenerateOpen} onOpenChange={setIsGenerateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-green-700 hover:bg-green-800">
              <Plus className="h-4 w-4 mr-2" />
              Generate UCR
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Generate New UCR</DialogTitle>
              <DialogDescription>
                Create a Unique Consignment Reference for your shipment. One UCR per consignment.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>UCR Type</Label>
                <Select value={ucrType} onValueChange={(v) => setUcrType(v as "SINGLE" | "MULTIPLE")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SINGLE">Single UCR (one-off transaction)</SelectItem>
                    <SelectItem value="MULTIPLE">Multiple UCR (related transactions)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Consignee Reference *</Label>
                <Input
                  placeholder="e.g. PO-2026-001234"
                  value={consigneeRef}
                  onChange={(e) => setConsigneeRef(e.target.value)}
                />
              </div>
              <div>
                <Label>Port of Entry *</Label>
                <Select value={portOfEntry} onValueChange={setPortOfEntry}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select port" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NGAPP">Apapa Port, Lagos</SelectItem>
                    <SelectItem value="NGTIN">Tin Can Island Port, Lagos</SelectItem>
                    <SelectItem value="NGKSI">Onne Port, Rivers State</SelectItem>
                    <SelectItem value="NGWAR">Warri Port</SelectItem>
                    <SelectItem value="NGCAL">Calabar Port</SelectItem>
                    <SelectItem value="NGLOS">Lagos Airport (MMIA)</SelectItem>
                    <SelectItem value="NGABV">Abuja Airport</SelectItem>
                    <SelectItem value="NGKNO">Kano Airport</SelectItem>
                    <SelectItem value="NGPHC">Port Harcourt Airport</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                className="w-full bg-green-700 hover:bg-green-800"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? "Generating..." : "Generate UCR"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* UCR Validation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Validate a UCR</CardTitle>
          <CardDescription>Check the validity of any UCR number (public service)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Enter UCR number to validate..."
              value={validateInput}
              onChange={(e) => setValidateInput(e.target.value)}
              className="max-w-sm"
            />
            <Button variant="outline" onClick={handleValidate}>
              <Search className="h-4 w-4 mr-2" />
              Validate
            </Button>
          </div>
          {validationResult && (
            <div className={`mt-3 p-3 rounded-lg text-sm ${(validationResult as { valid?: boolean }).valid ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {(validationResult as { valid?: boolean }).valid ? (
                <span>✓ Valid UCR — Status: {String((validationResult as { status?: unknown }).status)}, Trader ID: {String((validationResult as { traderId?: unknown }).traderId)}</span>
              ) : (
                <span>✗ Invalid UCR — {String((validationResult as { reason?: unknown }).reason)}</span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* UCR List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My UCRs</CardTitle>
          <CardDescription>All consignment references for your shipments</CardDescription>
        </CardHeader>
        <CardContent>
          {ucrs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p>No UCRs generated yet</p>
              <p className="text-sm">Generate your first UCR to start tracking a consignment</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>UCR Number</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Port of Entry</TableHead>
                  <TableHead>Consignee Ref</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ucrs.map((ucr: Record<string, unknown>) => (
                  <TableRow key={String(ucr.id)}>
                    <TableCell className="font-mono text-sm font-semibold">{String(ucr.ucrNumber)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{String(ucr.ucrType)}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[String(ucr.status)] ?? "bg-gray-100 text-gray-800"}`}>
                        {STATUS_ICONS[String(ucr.status)]}
                        {String(ucr.status)}
                      </span>
                    </TableCell>
                    <TableCell>{String(ucr.portOfEntry)}</TableCell>
                    <TableCell className="text-sm text-gray-600">{String(ucr.consigneeRef)}</TableCell>
                    <TableCell className="text-sm text-gray-500">
                      {new Date(String(ucr.createdAt)).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
