/**
 * Declaration Risk Score Timeline — visualise risk score history for a declaration
 * Sprint 136: Item 6
 */
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const LANE_COLOR: Record<string, string> = {
  green:  "#10B981",
  yellow: "#F59E0B",
  red:    "#EF4444",
};

interface Props {
  declarationId: number;
}

export default function DeclarationRiskTimeline({ declarationId }: Props) {
  const { data, isLoading } = trpc.declarationRiskHistory.getTimeline.useQuery({ declarationId });

  const chartData = (data ?? []).map(r => ({
    time: new Date(r.recordedAt).toLocaleString(),
    score: r.riskScore,
    lane: r.riskLane ?? "unknown",
    triggeredBy: r.triggeredBy,
  })).reverse(); // chronological order

  const latestLane = data?.[0]?.riskLane;
  const latestScore = data?.[0]?.riskScore;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp size={16} className="text-[#D4A017]" />
            Risk Score Timeline
          </CardTitle>
          {latestScore !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold" style={{ color: LANE_COLOR[latestLane ?? ""] ?? "#6B7280" }}>
                {latestScore}
              </span>
              {latestLane && (
                <Badge
                  variant="outline"
                  style={{ borderColor: LANE_COLOR[latestLane] ?? "#6B7280", color: LANE_COLOR[latestLane] ?? "#6B7280" }}
                  className="text-xs uppercase"
                >
                  {latestLane} Lane
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">Loading…</div>
        ) : !data || data.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">
            No risk score history recorded yet.
          </div>
        ) : (
          <>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickFormatter={v => v.split(",")[0]} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ background: "#0A1628", border: "1px solid #1E3A5F", borderRadius: 6, fontSize: 12 }}
                    formatter={(val: number, _name: string, props: any) => [
                      `${val} (${props.payload.lane} lane)`,
                      "Risk Score"
                    ]}
                  />
                  <ReferenceLine y={70} stroke="#EF4444" strokeDasharray="4 4" label={{ value: "Red", fill: "#EF4444", fontSize: 10 }} />
                  <ReferenceLine y={40} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: "Yellow", fill: "#F59E0B", fontSize: 10 }} />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="#D4A017"
                    strokeWidth={2}
                    dot={(props: any) => {
                      const color = LANE_COLOR[props.payload.lane] ?? "#D4A017";
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill={color} stroke={color} />;
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {/* History table */}
            <div className="mt-3 space-y-1.5 max-h-40 overflow-y-auto">
              {data.map(r => (
                <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/40">
                  <span className="text-muted-foreground">{new Date(r.recordedAt).toLocaleString()}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{r.triggeredBy}</span>
                    {r.riskLane && (
                      <span style={{ color: LANE_COLOR[r.riskLane] ?? "#6B7280" }} className="uppercase font-medium">
                        {r.riskLane}
                      </span>
                    )}
                    <span className="font-bold" style={{ color: LANE_COLOR[r.riskLane ?? ""] ?? "#D4A017" }}>
                      {r.riskScore}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
