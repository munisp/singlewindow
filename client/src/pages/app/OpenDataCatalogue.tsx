/**
 * Phase 22 — Open Data Catalogue (public trade statistics)
 * UI for the previously orphaned `openData` tRPC router (PRA-014): the ONLY
 * unauthenticated business endpoint — aggregated, anonymized national trade
 * statistics published under CC BY 4.0, IP-rate-limited (60 req/min,
 * fail-closed). No PII, no trader-level data, cleared declarations only.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Globe, FileText, DollarSign, Landmark, MapPin, Ship } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function StatCard({ title, value, icon: Icon, color }: {
  title: string; value: string; icon: React.ComponentType<{ className?: string }>; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
          </div>
          <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}20` }}>
            <span style={{ color }}><Icon className="w-5 h-5" /></span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OpenDataCatalogue() {
  const now = new Date();
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [submitted, setSubmitted] = useState<{ year: number; month: number }>({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  const { data, isLoading, isError, error } = trpc.openData.getPublicTradeData.useQuery(submitted);

  const stats = data?.statistics;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Globe className="w-6 h-6 text-primary" />
            Open Trade Data
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Aggregated, anonymized national trade statistics — {data?.license ?? "CC BY 4.0"}.
            Cleared declarations only; individual transaction data is confidential.
          </p>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Reporting Period</CardTitle></CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setSubmitted({ year: Number(year), month: Number(month) });
              }}
            >
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Year" /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 11 }, (_, i) => 2020 + i).map((y) => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={month} onValueChange={setMonth}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Month" /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="submit">View</Button>
            </form>
          </CardContent>
        </Card>

        {isError ? (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-red-600">
                Failed to load open-data statistics: {error.message}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This endpoint is rate-limited (60 req/min per IP) and fails closed if the limiter is unavailable.
              </p>
            </CardContent>
          </Card>
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[...Array(5)].map((_, i) => (
              <Card key={i}><CardContent className="pt-6 h-24 animate-pulse bg-muted rounded" /></Card>
            ))}
          </div>
        ) : stats ? (
          <>
            <p className="text-sm text-muted-foreground">
              {MONTHS[submitted.month - 1]} {submitted.year} — cleared declarations
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard title="Declarations Cleared" value={stats.totalDeclarations.toLocaleString()} icon={FileText} color="#3B82F6" />
              <StatCard title="Trade Value (USD)" value={stats.totalTradeValueUsd.toLocaleString()} icon={DollarSign} color="#10B981" />
              <StatCard title="Duty Collected (NGN)" value={stats.totalDutyNgn.toLocaleString()} icon={Landmark} color="#8B5CF6" />
              <StatCard title="Origin Countries" value={stats.originCountries.toLocaleString()} icon={MapPin} color="#F59E0B" />
              <StatCard title="Active Ports" value={stats.portsActive.toLocaleString()} icon={Ship} color="#EF4444" />
            </div>
            {stats.totalDeclarations === 0 && (
              <p className="text-sm text-muted-foreground">
                No cleared declarations recorded for this period.
              </p>
            )}
          </>
        ) : null}

        <Card>
          <CardHeader><CardTitle className="text-base">About this dataset</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>Source: {data?.source ?? "Nigeria Customs Service — National Single Window Trade Platform"}</p>
            <p>License: {data?.license ?? "CC BY 4.0"}</p>
            <p>{data?.disclaimer ?? "Aggregated statistics. Individual transaction data is confidential."}</p>
            <p className="text-xs">
              Machine-readable access: <code>GET /api/trpc/openData.getPublicTradeData?input=…</code>{" "}
              (unauthenticated, IP-rate-limited at 60 requests/minute, fail-closed).
            </p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
