/**
 * Natural Language Financial Query Interface — Sprint 97
 *
 * Allows users to query their financial data using plain English.
 * "Show me all failed payments last month"
 * "What is my total duty paid in Q1 2026?"
 * "List declarations with risk score above 80"
 */
import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Search, Sparkles, Clock, TrendingUp, DollarSign,
  FileText, AlertCircle, Loader2, ChevronRight, Copy, CheckCheck,
  BarChart2, RefreshCw, Download
} from "lucide-react";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";


interface QueryResult {
  question: string;
  explanation: string;
  queryType: string;
  aggregation: string;
  filters: Record<string, any>;
  results: any[];
  summary: Record<string, any>;
  rowCount: number;
  hasAggregation: boolean;
  timestamp: Date;
}

// ── Download helper ───────────────────────────────────────────────────────────
function downloadCSV(results: any[], filename: string) {
  if (!results.length) return;
  const headers = Object.keys(results[0]);
  const csvLines = [
    headers.join(","),
    ...results.map((r) =>
      headers.map((h) => {
        const v = r[h];
        if (v === null || v === undefined) return "";
        const s = v instanceof Date ? v.toISOString() : String(v);
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(",")
    ),
  ];
  const blob = new Blob([csvLines.join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Query type icon ───────────────────────────────────────────────────────────
function QueryTypeIcon({ type }: { type: string }) {
  const icons: Record<string, React.ReactNode> = {
    payments: <DollarSign className="w-4 h-4" />,
    declarations: <FileText className="w-4 h-4" />,
    transactions: <TrendingUp className="w-4 h-4" />,
    duties: <BarChart2 className="w-4 h-4" />,
    clearance_stats: <TrendingUp className="w-4 h-4" />,
  };
  return <>{icons[type] ?? <Search className="w-4 h-4" />}</>;
}

// ── Result table ──────────────────────────────────────────────────────────────
function ResultTable({ results }: { results: any[] }) {
  if (!results.length) return null;
  const headers = Object.keys(results[0]).filter(
    (h) => !["ilpPacket", "condition", "fulfilment", "webhookPayload"].includes(h)
  );
  return (
    <div className="overflow-x-auto rounded border border-[#1E3A5F]/30">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-primary border-b border-[#1E3A5F]/50">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-accent font-semibold whitespace-nowrap">
                {h.replace(/([A-Z])/g, " $1").trim()}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.slice(0, 50).map((row, i) => (
            <tr key={i} className="border-b border-[#1E3A5F]/20 hover:bg-primary/80/10">
              {headers.map((h) => {
                const v = row[h];
                const display = v instanceof Date
                  ? new Date(v).toLocaleString()
                  : v === null || v === undefined ? "—" : String(v);
                return (
                  <td key={h} className="px-3 py-1.5 text-slate-300 whitespace-nowrap max-w-[200px] truncate">
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {results.length > 50 && (
        <div className="px-3 py-2 text-xs text-slate-500 bg-primary/50">
          Showing first 50 of {results.length} results. Download CSV for full data.
        </div>
      )}
    </div>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ summary, queryType }: { summary: Record<string, any>; queryType: string }) {
  const entries = Object.entries(summary).filter(([, v]) => v !== null && v !== undefined);
  if (!entries.length) return null;
  return (
    <div className="flex flex-wrap gap-4 p-4 bg-primary/60 rounded-lg border border-accent/30">
      {entries.map(([key, value]) => (
        <div key={key} className="text-center">
          <div className="text-2xl font-bold text-accent">
            {typeof value === "number" ? value.toLocaleString() : String(value)}
          </div>
          <div className="text-xs text-slate-400 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</div>
        </div>
      ))}
    </div>
  );
}

export default function NLFinancialQuery() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QueryResult[]>([]);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: suggestionsData } = trpc.nlQuery.getSuggestions.useQuery();
  const queryMutation = trpc.nlQuery.query.useMutation({
    onSuccess: (data) => {
      const result: QueryResult = { ...data, timestamp: new Date() };
      setHistory((prev) => [result, ...prev.slice(0, 19)]);
      setQuestion("");
    },
    onError: (err) => {
      toast.error(`Query failed: ${err.message}`);
    },
  });

  const handleSubmit = (q?: string) => {
    const text = q ?? question.trim();
    if (!text) return;
    queryMutation.mutate({ question: text });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const copyQuestion = (q: string, idx: number) => {
    navigator.clipboard.writeText(q);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="min-h-screen bg-[#060E1A] text-slate-100 p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-accent/20 rounded-lg">
            <Sparkles className="w-6 h-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Natural Language Financial Query</h1>
            <p className="text-sm text-slate-400">Ask questions about your trade finance data in plain English</p>
          </div>
        </div>
      </div>

      {/* Query Input */}
      <Card className="bg-primary border-[#1E3A5F]/50 mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder='e.g. "Show me all failed payments last month" or "What is my total duty paid in Q1 2026?"'
                className="pl-10 bg-[#060E1A] border-[#1E3A5F]/50 text-white placeholder:text-slate-500 focus:border-accent/50"
                disabled={queryMutation.isPending}
              />
            </div>
            <Button
              onClick={() => handleSubmit()}
              disabled={!question.trim() || queryMutation.isPending}
              className="bg-accent hover:bg-accent/80 text-primary font-semibold px-6"
            >
              {queryMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Ask</>
              )}
            </Button>
          </div>

          {/* Loading indicator */}
          {queryMutation.isPending && (
            <div className="mt-4 flex items-center gap-3 text-sm text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-accent" />
              <span>Analyzing your question with AI and querying the database...</span>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Suggestions */}
        <div className="lg:col-span-1">
          <Card className="bg-primary border-[#1E3A5F]/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-accent flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Suggested Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(suggestionsData?.suggestions ?? []).map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSubmit(s)}
                  disabled={queryMutation.isPending}
                  className="w-full text-left text-xs text-slate-300 hover:text-white hover:bg-primary/80/30 px-3 py-2 rounded flex items-center gap-2 group transition-colors disabled:opacity-50"
                >
                  <ChevronRight className="w-3 h-3 text-accent flex-shrink-0 group-hover:translate-x-0.5 transition-transform" />
                  <span>{s}</span>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {history.length === 0 && !queryMutation.isPending && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="p-4 bg-primary/80/20 rounded-full mb-4">
                <Search className="w-8 h-8 text-slate-500" />
              </div>
              <p className="text-slate-400 text-sm">Ask a question to see results here</p>
              <p className="text-slate-600 text-xs mt-1">Try one of the suggested questions on the left</p>
            </div>
          )}

          {history.map((result, idx) => (
            <Card key={idx} className="bg-primary border-[#1E3A5F]/50">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-accent border-accent/30 text-xs flex items-center gap-1">
                        <QueryTypeIcon type={result.queryType} />
                        {result.queryType.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" className="text-slate-400 border-slate-600 text-xs">
                        {result.aggregation}
                      </Badge>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {result.timestamp.toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-white">"{result.question}"</p>
                    <p className="text-xs text-slate-400 mt-1">{result.explanation}</p>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-white"
                      onClick={() => copyQuestion(result.question, idx)}
                    >
                      {copiedIdx === idx ? <CheckCheck className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
                    </Button>
                    {result.results.length > 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-white"
                        onClick={() => downloadCSV(result.results, `query-${Date.now()}.csv`)}
                        title="Download CSV"
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 hover:text-white"
                      onClick={() => handleSubmit(result.question)}
                      disabled={queryMutation.isPending}
                      title="Re-run query"
                    >
                      <RefreshCw className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="pt-0 space-y-3">
                {/* Active filters */}
                {Object.keys(result.filters).filter((k) => result.filters[k]).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(result.filters)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <Badge key={k} variant="secondary" className="text-xs bg-primary/80/50 text-slate-300">
                          {k}: {String(v)}
                        </Badge>
                      ))}
                  </div>
                )}

                {/* Aggregation summary */}
                {result.hasAggregation && Object.keys(result.summary).length > 0 && (
                  <SummaryCard summary={result.summary} queryType={result.queryType} />
                )}

                {/* Result table */}
                {result.results.length > 0 && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">{result.rowCount} result{result.rowCount !== 1 ? "s" : ""}</span>
                    </div>
                    <ResultTable results={result.results} />
                  </>
                )}

                {/* No results */}
                {!result.hasAggregation && result.results.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 py-2">
                    <AlertCircle className="w-4 h-4" />
                    No results found for this query.
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
