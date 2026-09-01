import { useMemo, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { AlertCircle, BarChart2, CreditCard, Layers } from "lucide-react";

function defaultPeriod() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * Marketplace monetization portal (Phase 12): tier catalogue, key→tier
 * binding, per-day usage chart and itemized invoice preview.
 * Fail-closed: all query/mutation errors render explicit alerts/toasts.
 */
export default function MarketplacePortal() {
  const tiers = trpc.marketplace.listTiers.useQuery();
  const keys = trpc.devPortal.listApiKeys.useQuery();
  const [selectedKey, setSelectedKey] = useState<number | null>(null);
  const [tierCode, setTierCode] = useState<string>("builder");
  const [period, setPeriod] = useState(defaultPeriod());

  const series = trpc.marketplace.usageSeries.useQuery(
    { apiKeyId: selectedKey ?? 0, days: 30 },
    { enabled: selectedKey != null }
  );
  const invoice = trpc.marketplace.usageInvoice.useQuery(
    { apiKeyId: selectedKey ?? 0, from: period.from, to: `${period.to}T23:59:59Z` },
    { enabled: selectedKey != null, retry: false }
  );

  const bind = trpc.marketplace.bindMyKeyToTier.useMutation({
    onSuccess: () => { toast.success("Tier binding updated"); keys.refetch(); invoice.refetch(); },
    onError: (err: any) => toast.error(err.message),
  });

  const maxCalls = useMemo(
    () => Math.max(1, ...(series.data ?? []).map((d: any) => d.calls)),
    [series.data]
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">API Marketplace — Plans & Billing</h1>
          <p className="text-muted-foreground">
            Monetization tiers, metered usage and itemized invoices.
          </p>
        </div>

        {tiers.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Tier catalogue unavailable</AlertTitle>
            <AlertDescription>{tiers.error.message}</AlertDescription>
          </Alert>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          {tiers.data?.map((t: any) => (
            <Card key={t.code}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="h-4 w-4" /> {t.name}
                  <Badge variant="outline">{t.code}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div>${t.monthlyFeeUsd}/month</div>
                <div>${t.pricePerCallUsd} per production call</div>
                <div>{t.rateLimitPerMinute} calls/minute</div>
                <div>Quota: {t.monthlyCallQuota == null ? "unmetered" : `${t.monthlyCallQuota.toLocaleString()} calls/month`}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader><CardTitle>Key → tier binding</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground">API key</label>
              <Select value={selectedKey != null ? String(selectedKey) : ""} onValueChange={(v) => setSelectedKey(Number(v))}>
                <SelectTrigger className="w-64"><SelectValue placeholder="Select a key" /></SelectTrigger>
                <SelectContent>
                  {(keys.data as any[] ?? []).map((k: any) => (
                    <SelectItem key={k.id} value={String(k.id)}>{k.name} ({k.keyPrefix}…)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Tier</label>
              <Select value={tierCode} onValueChange={setTierCode}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="builder">Builder</SelectItem>
                  <SelectItem value="enterprise">Enterprise</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={selectedKey == null || bind.isPending}
              onClick={() => selectedKey != null && bind.mutate({ apiKeyId: selectedKey, tierCode: tierCode as any })}
            >
              Bind tier
            </Button>
          </CardContent>
        </Card>

        {selectedKey != null && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BarChart2 className="h-4 w-4" /> Usage — last 30 days</CardTitle>
              </CardHeader>
              <CardContent>
                {series.error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{series.error.message}</AlertDescription>
                  </Alert>
                )}
                {series.data && series.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">No metered usage in the window.</p>
                )}
                <div className="flex items-end gap-1 h-40">
                  {(series.data ?? []).map((d: any) => (
                    <div key={d.day} className="flex flex-col items-center flex-1 min-w-0">
                      <div
                        className="w-full bg-primary/80 rounded-t"
                        style={{ height: `${Math.max(2, (d.calls / maxCalls) * 140)}px` }}
                        title={`${d.day}: ${d.calls} calls (${d.productionCalls} production)`}
                      />
                      <div className="text-[9px] text-muted-foreground rotate-45 origin-left mt-1 truncate w-full">{d.day.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Invoice preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex gap-2 items-end flex-wrap">
                  <div>
                    <label className="text-xs text-muted-foreground">From</label>
                    <Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">To</label>
                    <Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
                  </div>
                  <Button variant="outline" onClick={() => invoice.refetch()}>Refresh</Button>
                </div>

                {invoice.error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Invoice unavailable</AlertTitle>
                    <AlertDescription>{invoice.error.message}</AlertDescription>
                  </Alert>
                )}

                {invoice.data && (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Tier {invoice.data.tier.name} · {invoice.data.totalCalls} calls ({invoice.data.billableCalls} billable)
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left border-b">
                          <th className="py-1">Endpoint</th><th>Method</th><th className="text-right">Calls</th>
                          <th className="text-right">Unit</th><th className="text-right">Amount (USD)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoice.data.lines.map((l: any, i: number) => (
                          <tr key={i} className="border-b">
                            <td className="py-1 font-mono text-xs">{l.endpoint}</td>
                            <td>{l.method}</td>
                            <td className="text-right">{l.calls}</td>
                            <td className="text-right">{l.unitPriceUsd}</td>
                            <td className="text-right">{l.amountUsd}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr><td colSpan={4} className="py-1 text-right">Usage charges</td><td className="text-right">{invoice.data.usageChargesUsd}</td></tr>
                        <tr><td colSpan={4} className="py-1 text-right">Monthly fee</td><td className="text-right">{invoice.data.monthlyFeeUsd}</td></tr>
                        <tr className="font-bold"><td colSpan={4} className="py-1 text-right">Total due</td><td className="text-right">${invoice.data.totalDueUsd}</td></tr>
                      </tfoot>
                    </table>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
