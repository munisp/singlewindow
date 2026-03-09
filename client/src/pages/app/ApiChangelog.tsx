/**
 * API Changelog — Sprint 74
 * Tracks API spec changes over time, shows diffs, and lets developers compare versions.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  GitBranch, Plus, Minus, Edit3, Search, Download,
  Calendar, Tag, ChevronDown, ChevronRight, Clock, Layers
} from "lucide-react";

const CHANGE_TYPE_STYLES: Record<string, string> = {
  added: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  removed: "bg-red-500/10 text-red-400 border-red-500/20",
  modified: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  deprecated: "bg-orange-500/10 text-orange-400 border-orange-500/20",
};

const CHANGE_TYPE_ICONS: Record<string, React.ReactNode> = {
  added: <Plus className="h-3 w-3" />,
  removed: <Minus className="h-3 w-3" />,
  modified: <Edit3 className="h-3 w-3" />,
  deprecated: <Clock className="h-3 w-3" />,
};

function ChangeEntry({ change }: { change: any }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border-b last:border-0">
      <button
        className="w-full text-left p-3 hover:bg-muted/20 flex items-start gap-3"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="mt-0.5">
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={`text-xs py-0 gap-1 ${CHANGE_TYPE_STYLES[change.changeType] ?? ""}`}>
              {CHANGE_TYPE_ICONS[change.changeType]}
              {change.changeType}
            </Badge>
            <span className="font-mono text-xs font-medium">{change.endpoint}</span>
            {change.method && (
              <Badge variant="outline" className="text-xs py-0 font-mono">{change.method.toUpperCase()}</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{change.description}</p>
        </div>
      </button>
      {expanded && change.diff && (
        <div className="mx-3 mb-3 rounded-lg bg-muted/30 p-3 font-mono text-xs overflow-x-auto">
          <pre className="whitespace-pre-wrap">{change.diff}</pre>
        </div>
      )}
    </div>
  );
}

function VersionCard({ entry, isSelected, onClick }: { entry: any; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition-colors ${isSelected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/20"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-sm font-semibold">{entry.version}</span>
        <div className="flex items-center gap-1">
          {entry.breakingChanges > 0 && (
            <Badge variant="outline" className="text-xs py-0 bg-red-500/10 text-red-400 border-red-500/20">
              {entry.breakingChanges} breaking
            </Badge>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{entry.summary}</p>
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(entry.releasedAt).toLocaleDateString()}</span>
        <span className="flex items-center gap-1"><Layers className="h-3 w-3" />{entry.totalChanges} changes</span>
      </div>
    </button>
  );
}

export default function ApiChangelog() {
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [changeTypeFilter, setChangeTypeFilter] = useState<string>("all");

  const { data: versionList, isLoading } = trpc.apiChangelog.versions.useQuery();
  const { data: detail, isLoading: detailLoading } = trpc.apiChangelog.list.useQuery(
    { version: selectedVersion! },
    { enabled: !!selectedVersion }
  );

  const filteredChanges = (detail ?? []).filter((c: any) => {
    const matchesSearch = !searchQuery || c.endpoint?.toLowerCase().includes(searchQuery.toLowerCase()) || c.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = changeTypeFilter === "all" || c.changeType === changeTypeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <DashboardLayout title="API Changelog">
      <div className="space-y-6 max-w-7xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <GitBranch className="h-6 w-6 text-primary" />API Changelog
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Track every API change across versions — added endpoints, breaking changes, deprecations
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
            fetch("/api/openapi.json").then(r => r.blob()).then(b => {
              const a = document.createElement("a"); a.href = URL.createObjectURL(b);
              a.download = "tradegateway-openapi.json"; a.click();
            });
          }}>
            <Download className="h-4 w-4" />Download Spec
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "API Versions", value: versionList?.length ?? "—", icon: Tag, color: "text-primary", bg: "bg-primary/10" },
            { label: "Total Changes", value: versionList?.reduce((a, v) => a + v.totalChanges, 0) ?? "—", icon: Layers, color: "text-blue-400", bg: "bg-blue-500/10" },
            { label: "Breaking Changes", value: versionList?.reduce((a, v) => a + v.breakingChanges, 0) ?? "—", icon: Minus, color: "text-red-400", bg: "bg-red-500/10" },
            { label: "Filtered Changes", value: filteredChanges.length, icon: Plus, color: "text-emerald-400", bg: "bg-emerald-500/10" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <div>
                  <p className="text-2xl font-bold">{value ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Version list */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-muted-foreground">Versions</p>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
              ) : (versionList?.length ?? 0) === 0 ? (
              <div className="p-6 text-center text-muted-foreground border rounded-lg">
                <GitBranch className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No changelog entries yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {(versionList ?? []).map((entry) => (
                  <VersionCard
                    key={entry.version}
                    entry={{ ...entry, id: entry.version, summary: `${entry.totalChanges} changes`, releasedAt: new Date().toISOString() }}
                    isSelected={selectedVersion === entry.version}
                    onClick={() => setSelectedVersion(entry.version)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Change detail */}
          <div className="col-span-2">
            {!selectedVersion ? (
              <div className="h-full flex items-center justify-center text-muted-foreground border rounded-lg p-12">
                <div className="text-center">
                  <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Select a version to view changes</p>
                </div>
              </div>
            ) : (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-mono">{selectedVersion}</CardTitle>
                </div>
                </CardHeader>
                <CardContent className="pt-0">
                  {/* Filters */}
                  <div className="flex gap-2 mb-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        placeholder="Search endpoints..."
                        className="pl-8 h-8 text-xs"
                      />
                    </div>
                    <div className="flex gap-1">
                      {["all", "added", "removed", "modified", "deprecated"].map(type => (
                        <Button
                          key={type}
                          variant={changeTypeFilter === type ? "default" : "outline"}
                          size="sm"
                          className="h-8 text-xs px-2"
                          onClick={() => setChangeTypeFilter(type)}
                        >
                          {type}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {detailLoading ? (
                    <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
                  ) : filteredChanges.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">
                      <p className="text-sm">No changes match your filter</p>
                    </div>
                  ) : (
                    <div className="border rounded-lg divide-y overflow-hidden">
                      {filteredChanges.map((change: any, i: number) => (
                        <ChangeEntry key={i} change={change} />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
