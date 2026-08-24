import { Radio, RefreshCw } from "lucide-react";
import { useFluvioFeed } from "@/hooks/useFluvioFeed";

export default function FluvioStreamPanel() {
  const { events, status, sourceStatus, sourceReason, lastUpdated, pause, resume, clearEvents } = useFluvioFeed();
  const unavailable = sourceStatus === "unconfigured" || sourceStatus === "unavailable";

  return (
    <section id="fluvio-stream" className="py-20 bg-[#0D1E35]">
      <div className="max-w-6xl mx-auto px-6">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-1 h-10 bg-[#D4A017] rounded-full" />
            <span className="text-[#D4A017] text-sm font-semibold tracking-widest uppercase">
              Fluvio cargo stream
            </span>
          </div>
          <h2 className="text-4xl font-bold text-white mb-4">Live operational events</h2>
          <p className="text-slate-400 text-lg max-w-3xl">
            This view displays events received from the configured Fluvio source. It does not
            synthesize vessel positions, cargo events, offsets, or processing measurements.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Radio className="w-4 h-4 text-cyan-400" />
            Source status: <span className="font-semibold">{sourceStatus ?? status}</span>
          </div>
          {lastUpdated && (
            <span className="text-xs text-slate-500">
              Last event received {lastUpdated.toLocaleString()}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            <button
              onClick={status === "paused" ? resume : pause}
              className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm"
            >
              {status === "paused" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={clearEvents}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Clear
            </button>
          </div>
        </div>

        {unavailable && (
          <div className="mb-6 rounded-xl border border-red-500/40 bg-red-950/30 p-4 text-red-200">
            Live stream {sourceStatus}: {sourceReason ?? "source status was not provided"}
          </div>
        )}

        <div className="bg-[#0A1628] border border-slate-700/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700/30 flex items-center gap-2">
            <span className="text-sm font-semibold text-white">Received event log</span>
            <span className="ml-auto text-xs text-slate-500">{events.length} events</span>
          </div>
          {events.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              {unavailable ? "No events available because the source is unavailable." : "No events received."}
            </div>
          ) : (
            <div className="font-mono text-xs overflow-y-auto max-h-[420px]">
              {events.map((event) => (
                <pre key={`${event.topic}:${event.partition}:${event.offset}`} className="border-b border-slate-800/30 px-4 py-3 text-slate-300 whitespace-pre-wrap">
                  {JSON.stringify(event, null, 2)}
                </pre>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
