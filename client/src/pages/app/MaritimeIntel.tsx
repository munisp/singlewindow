import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import {
  Radar, Waves, Wind, Newspaper, ShieldCheck, Ship, Search,
  AlertTriangle, ExternalLink, RefreshCw,
} from "lucide-react";

/**
 * Phase 32 W2 — Maritime Intelligence page.
 *
 * Talks to the `maritimeIntel` tRPC router (backend landing in parallel, W1).
 * The router types are not available to the client yet, so the namespace is
 * accessed via a typed `any` shim and row shapes are defined locally below to
 * match the agreed contract exactly. No data is fabricated: every query
 * degrades to an honest error banner or empty state on failure.
 */

// ─── Local contract types (mirror of the maritimeIntel router contract) ─────

export interface IntelArticle {
  title: string;
  url: string;
  source: string;
  seendate: string;
  tone: number | null;
}

export interface MarineWeather {
  waveHeightM: number | null;
  wavePeriodS: number | null;
  windSpeedKmh: number | null;
  windDirectionDeg: number | null;
}

export interface SanctionMatch {
  name: string;
  schema: string;
  datasets: string[];
  score: number;
}

export interface PortIntelSummary {
  port: string;
  coords: { lat: number; lon: number } | null;
  weather: MarineWeather | null;
  events: { articles: IntelArticle[]; count: number } | null;
  errors: string[];
}

export interface VesselTrackingStatus {
  configured: true;
  provider: string;
  note: string;
}

/** Nigerian ports covered by the maritime-intel summary. */
export const INTEL_PORTS = [
  "Lagos Apapa",
  "Tin Can Island",
  "Onne",
  "Port Harcourt",
  "Calabar",
  "Warri",
  "Lekki",
  "Bonny",
] as const;

const DEFAULT_FEED_QUERY = "port OR maritime OR piracy OR shipping Nigeria";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt(value: number | null | undefined, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toLocaleString()} ${unit}` : "—";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function isNotConfigured(err: any): boolean {
  const msg = String(err?.message ?? "").toLowerCase();
  return msg.includes("not configured") || msg.includes("503") || err?.data?.httpStatus === 503;
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

function NotConfiguredBanner({ message }: { message: string }) {
  return (
    <div className="m-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-center gap-2">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      {message}
    </div>
  );
}

function EmptyState({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="p-8 text-center text-muted-foreground text-sm">
      <div className="mx-auto mb-2 w-8 h-8 opacity-30 flex items-center justify-center">{icon}</div>
      {message}
    </div>
  );
}

// The maritimeIntel router ships with W1; until its types land on the client we
// access the namespace through a shim. Calls match the agreed contract.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const maritimeIntel = (trpc as any).maritimeIntel;

// ─── Article table ──────────────────────────────────────────────────────────

function ArticleTable({ articles }: { articles: IntelArticle[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Seen</TableHead>
          <TableHead>Tone</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {articles.map((a, i) => (
          <TableRow key={`${a.url}-${i}`}>
            <TableCell className="text-xs">
              <a
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-700 hover:underline inline-flex items-center gap-1"
              >
                {a.title}
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </TableCell>
            <TableCell className="text-xs">{a.source}</TableCell>
            <TableCell className="text-xs">{formatDate(a.seendate)}</TableCell>
            <TableCell className="text-xs">{a.tone != null ? a.tone : "—"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function MaritimeIntel() {
  const [port, setPort] = useState<string>("Lagos Apapa");
  const [feedQuery, setFeedQuery] = useState(DEFAULT_FEED_QUERY);
  const [timespanHours, setTimespanHours] = useState("24");
  const [submittedFeed, setSubmittedFeed] = useState<{ query: string; timespanHours: number }>({
    query: DEFAULT_FEED_QUERY,
    timespanHours: 24,
  });
  const [screenName, setScreenName] = useState("");
  const [submittedName, setSubmittedName] = useState("");

  // Queries — every one degrades to an honest error banner / empty state.
  const portSummaryQuery = maritimeIntel.portIntelSummary.useQuery({ port });
  const intelEventsQuery = maritimeIntel.intelEvents.useQuery({
    query: submittedFeed.query,
    timespanHours: submittedFeed.timespanHours,
  });
  const vesselStatusQuery = maritimeIntel.vesselTrackingStatus.useQuery();
  const sanctionsQuery = maritimeIntel.sanctionsScreen.useQuery(
    { name: submittedName },
    { enabled: !!submittedName }
  );

  const summary = portSummaryQuery.data as PortIntelSummary | undefined;
  const feedArticles: IntelArticle[] = (intelEventsQuery.data as any)?.articles ?? [];
  const sanctionMatches: SanctionMatch[] = (sanctionsQuery.data as any)?.matches ?? [];
  const vesselStatus = vesselStatusQuery.data as VesselTrackingStatus | undefined;

  const refetchAll = () => {
    portSummaryQuery.refetch();
    intelEventsQuery.refetch();
    vesselStatusQuery.refetch();
    if (submittedName) sanctionsQuery.refetch();
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Radar className="w-7 h-7 text-sky-600" />
              Maritime Intelligence
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Live OSINT-grade situational awareness for Nigerian coastal operations
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={port} onValueChange={setPort}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Select port" />
              </SelectTrigger>
              <SelectContent>
                {INTEL_PORTS.map(p => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={refetchAll}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Port summary: marine weather + port events */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Waves className="w-4 h-4" />
                Marine Weather — {port}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {portSummaryQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading marine weather...</div>
              ) : portSummaryQuery.error ? (
                <ErrorBanner message={`Marine weather unavailable: ${portSummaryQuery.error.message}`} />
              ) : (
                <>
                  {summary?.errors && summary.errors.length > 0 && (
                    <ErrorBanner message={`Partial data — ${summary.errors.join("; ")}`} />
                  )}
                  <div className="grid grid-cols-2 gap-3 p-4">
                    <div className="rounded border p-3">
                      <div className="text-xs text-muted-foreground">Wave Height</div>
                      <div className="text-lg font-semibold">{fmt(summary?.weather?.waveHeightM, "m")}</div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-xs text-muted-foreground">Wave Period</div>
                      <div className="text-lg font-semibold">{fmt(summary?.weather?.wavePeriodS, "s")}</div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Wind className="w-3 h-3" /> Wind Speed
                      </div>
                      <div className="text-lg font-semibold">{fmt(summary?.weather?.windSpeedKmh, "km/h")}</div>
                    </div>
                    <div className="rounded border p-3">
                      <div className="text-xs text-muted-foreground">Wind Direction</div>
                      <div className="text-lg font-semibold">{fmt(summary?.weather?.windDirectionDeg, "°")}</div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Newspaper className="w-4 h-4" />
                Port Events — {port}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {portSummaryQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Loading port events...</div>
              ) : portSummaryQuery.error ? (
                <ErrorBanner message={`Port events unavailable: ${portSummaryQuery.error.message}`} />
              ) : !summary?.events || summary.events.articles.length === 0 ? (
                <EmptyState icon={<Newspaper className="w-8 h-8" />} message="No recent events" />
              ) : (
                <ArticleTable articles={summary.events.articles} />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Global intel feed */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Newspaper className="w-4 h-4" />
                Global Intel Feed
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Input
                  value={feedQuery}
                  onChange={e => setFeedQuery(e.target.value)}
                  className="w-72 h-8 text-xs"
                  placeholder="Search query"
                />
                <Select value={timespanHours} onValueChange={setTimespanHours}>
                  <SelectTrigger className="w-24 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="24">24h</SelectItem>
                    <SelectItem value="48">48h</SelectItem>
                    <SelectItem value="72">72h</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                  disabled={!feedQuery.trim()}
                  onClick={() => setSubmittedFeed({ query: feedQuery.trim(), timespanHours: parseInt(timespanHours, 10) })}
                >
                  <Search className="w-4 h-4 mr-2" />
                  Search
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {intelEventsQuery.isLoading ? (
              <div className="p-8 text-center text-muted-foreground text-sm">Searching intel feed...</div>
            ) : intelEventsQuery.error ? (
              <ErrorBanner message={`Intel feed unavailable: ${intelEventsQuery.error.message}`} />
            ) : feedArticles.length === 0 ? (
              <EmptyState icon={<Newspaper className="w-8 h-8" />} message="No articles found for this query" />
            ) : (
              <ArticleTable articles={feedArticles} />
            )}
          </CardContent>
        </Card>

        {/* Tools grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Sanctions screening */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Sanctions Screening
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Input
                    value={screenName}
                    onChange={e => setScreenName(e.target.value)}
                    className="w-48 h-8 text-xs"
                    placeholder="Vessel / entity name"
                  />
                  <Button
                    size="sm"
                    className="bg-sky-600 hover:bg-sky-700 text-white"
                    disabled={!screenName.trim()}
                    onClick={() => setSubmittedName(screenName.trim())}
                  >
                    <Search className="w-4 h-4 mr-2" />
                    Screen
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {!submittedName ? (
                <EmptyState icon={<ShieldCheck className="w-8 h-8" />} message="Enter a name to screen against sanctions lists" />
              ) : sanctionsQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Screening {submittedName}...</div>
              ) : sanctionsQuery.error ? (
                isNotConfigured(sanctionsQuery.error) ? (
                  <NotConfiguredBanner message="Not configured — set OPENSANCTIONS_API_KEY" />
                ) : (
                  <ErrorBanner message={`Sanctions screening failed: ${sanctionsQuery.error.message}`} />
                )
              ) : sanctionMatches.length === 0 ? (
                <EmptyState icon={<ShieldCheck className="w-8 h-8" />} message="No matches found" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Datasets</TableHead>
                      <TableHead>Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sanctionMatches.map((m, i) => (
                      <TableRow key={`${m.name}-${i}`}>
                        <TableCell className="text-xs font-medium">{m.name}</TableCell>
                        <TableCell className="text-xs capitalize">{m.schema}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {(m.datasets ?? []).map(d => (
                              <Badge key={d} variant="outline" className="text-xs">{d}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">{m.score != null ? m.score : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* AIS vessel tracking status */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Ship className="w-4 h-4" />
                AIS Vessel Tracking
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {vesselStatusQuery.isLoading ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Checking AIS provider status...</div>
              ) : vesselStatusQuery.error ? (
                isNotConfigured(vesselStatusQuery.error) ? (
                  <div className="p-4">
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                        <AlertTriangle className="w-4 h-4" />
                        Not configured — set AISSTREAM_API_KEY
                      </div>
                      <p className="text-xs text-amber-700 mt-1">
                        AIS vessel tracking requires an aisstream.io API key. Configure AISSTREAM_API_KEY in the environment to enable live vessel positions.
                      </p>
                    </div>
                  </div>
                ) : (
                  <ErrorBanner message={`AIS status check failed: ${vesselStatusQuery.error.message}`} />
                )
              ) : vesselStatus ? (
                <div className="p-4">
                  <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-green-800">
                      <Ship className="w-4 h-4" />
                      Configured — {vesselStatus.provider}
                    </div>
                    {vesselStatus.note && (
                      <p className="text-xs text-green-700 mt-1">{vesselStatus.note}</p>
                    )}
                  </div>
                </div>
              ) : (
                <EmptyState icon={<Ship className="w-8 h-8" />} message="No status returned" />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}
