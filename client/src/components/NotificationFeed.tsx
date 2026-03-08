/**
 * TradeGateway NGSWTP — Real-Time Kafka Notification Feed
 * Design: Sovereign Blueprint — deep navy + gold
 *
 * Slide-in panel showing simulated Kafka events flowing through the platform:
 * declaration.submitted → risk.scored → oga.approved → payment.confirmed → permit.issued
 * Each event shows topic, partition, offset, timestamp, and full JSON payload.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, X, ChevronDown, ChevronUp, Wifi, WifiOff, Trash2, Filter } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface KafkaEvent {
  id: string;
  topic: string;
  partition: number;
  offset: number;
  timestamp: string;
  key: string;
  severity: "info" | "success" | "warning" | "error";
  summary: string;
  payload: Record<string, unknown>;
}

const KAFKA_TOPICS = [
  "declaration.submitted",
  "document.ocr.completed",
  "hs.classification.result",
  "risk.score.computed",
  "oga.request.sent",
  "oga.response.received",
  "payment.quote.created",
  "payment.transfer.initiated",
  "payment.fulfilment.confirmed",
  "permit.issued",
  "audit.event.recorded",
  "notification.sent",
];

const TOPIC_SEVERITY: Record<string, KafkaEvent["severity"]> = {
  "declaration.submitted": "info",
  "document.ocr.completed": "info",
  "hs.classification.result": "info",
  "risk.score.computed": "warning",
  "oga.request.sent": "info",
  "oga.response.received": "success",
  "payment.quote.created": "info",
  "payment.transfer.initiated": "warning",
  "payment.fulfilment.confirmed": "success",
  "permit.issued": "success",
  "audit.event.recorded": "info",
  "notification.sent": "info",
};

const TOPIC_COLORS: Record<KafkaEvent["severity"], string> = {
  info: "border-blue-500/40 bg-blue-500/5",
  success: "border-emerald-500/40 bg-emerald-500/5",
  warning: "border-amber-500/40 bg-amber-500/5",
  error: "border-red-500/40 bg-red-500/5",
};

const TOPIC_BADGE: Record<KafkaEvent["severity"], string> = {
  info: "bg-blue-500/20 text-blue-300",
  success: "bg-emerald-500/20 text-emerald-300",
  warning: "bg-amber-500/20 text-amber-300",
  error: "bg-red-500/20 text-red-300",
};

const SAMPLE_PAYLOADS: Record<string, () => Record<string, unknown>> = {
  "declaration.submitted": () => ({
    urn: `URN-${Date.now().toString(36).toUpperCase()}`,
    trader_id: "TRD-00421",
    trader_name: "Acme Imports Ltd",
    declaration_type: "IM4",
    hs_lines: 3,
    total_value_usd: Math.floor(Math.random() * 50000) + 5000,
    country_of_origin: ["CN", "IN", "DE", "US"][Math.floor(Math.random() * 4)],
    port_of_entry: "MOMBASA",
    submitted_at: new Date().toISOString(),
  }),
  "document.ocr.completed": () => ({
    document_id: `DOC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    model: "LayoutLMv3",
    confidence: (0.87 + Math.random() * 0.12).toFixed(3),
    fields_extracted: 24,
    processing_ms: Math.floor(Math.random() * 800) + 200,
    invoice_number: `INV-${Math.floor(Math.random() * 99999)}`,
    invoice_date: "2026-03-07",
  }),
  "hs.classification.result": () => ({
    hs_code: ["8471.30.00", "6203.42.10", "2710.12.90", "8544.42.90"][Math.floor(Math.random() * 4)],
    description: "Automatic data processing machines",
    confidence: (0.91 + Math.random() * 0.08).toFixed(3),
    model: "BERT-HS-v2.1",
    duty_rate_pct: (Math.random() * 25).toFixed(1),
    vat_rate_pct: "16.0",
    requires_permit: Math.random() > 0.7,
  }),
  "risk.score.computed": () => ({
    declaration_id: `DECL-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    risk_score: Math.floor(Math.random() * 100),
    lane: ["GREEN", "YELLOW", "RED"][Math.floor(Math.random() * 3)],
    engine: "rust-risk-engine v1.4.2",
    rules_evaluated: 200,
    rules_triggered: Math.floor(Math.random() * 12),
    evaluation_ms: Math.floor(Math.random() * 150) + 30,
    top_factors: ["country_risk", "value_threshold", "trader_history"],
  }),
  "oga.request.sent": () => ({
    oga_id: ["CUSTOMS", "AGRICULTURE", "STANDARDS", "IMMIGRATION", "PORT"][Math.floor(Math.random() * 5)],
    request_id: `OGA-REQ-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    protocol: "REST/mTLS",
    timeout_ms: 30000,
    sla_target_ms: 15000,
  }),
  "oga.response.received": () => ({
    oga_id: ["CUSTOMS", "AGRICULTURE", "STANDARDS"][Math.floor(Math.random() * 3)],
    status: Math.random() > 0.1 ? "APPROVED" : "PENDING_INFO",
    response_ms: Math.floor(Math.random() * 8000) + 500,
    conditions: Math.random() > 0.7 ? ["Certificate of Origin required"] : [],
  }),
  "payment.quote.created": () => ({
    quote_id: `ILP-QT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    amount_usd: (Math.random() * 5000 + 100).toFixed(2),
    duty_amount: (Math.random() * 3000 + 50).toFixed(2),
    vat_amount: (Math.random() * 1500 + 20).toFixed(2),
    expiry_seconds: 300,
    mojaloop_connector: "DFSP-CENTRAL-BANK",
  }),
  "payment.transfer.initiated": () => ({
    transfer_id: `ILP-TXF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    condition: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    tigerbeetle_debit_account: "1000000001",
    tigerbeetle_credit_account: "2000000001",
    amount_drops: Math.floor(Math.random() * 1000000),
    state: "RESERVED",
  }),
  "payment.fulfilment.confirmed": () => ({
    transfer_id: `ILP-TXF-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    fulfilment: "XosoiohMA2YZQm_hplc6SvVsBcIEkbu9ZkYpYziLMwA=",
    tigerbeetle_state: "POSTED",
    settlement_ms: Math.floor(Math.random() * 2000) + 500,
    receipt_number: `RCP-${Math.floor(Math.random() * 999999)}`,
  }),
  "permit.issued": () => ({
    permit_id: `PRMT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    urn: `URN-${Date.now().toString(36).toUpperCase()}`,
    signature_algorithm: "Ed25519",
    valid_hours: 72,
    qr_hash: `sha256:${Math.random().toString(36).slice(2, 34)}`,
    issued_by: "TradeGateway NGSWTP",
    clearance_lane: "GREEN",
  }),
  "audit.event.recorded": () => ({
    audit_id: `AUD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    actor: "system",
    action: ["DECLARATION_SUBMITTED", "RISK_SCORED", "PERMIT_ISSUED"][Math.floor(Math.random() * 3)],
    chain_hash: `sha256:${Math.random().toString(36).slice(2, 34)}`,
    prev_hash: `sha256:${Math.random().toString(36).slice(2, 34)}`,
  }),
  "notification.sent": () => ({
    channel: ["SMS", "EMAIL", "WHATSAPP", "PUSH"][Math.floor(Math.random() * 4)],
    recipient: "trader@example.com",
    template: "DECLARATION_STATUS_UPDATE",
    delivered: true,
    provider_msg_id: `MSG-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  }),
};

function generateEvent(topicOverride?: string): KafkaEvent {
  const topic = topicOverride || KAFKA_TOPICS[Math.floor(Math.random() * KAFKA_TOPICS.length)];
  const payloadFn = SAMPLE_PAYLOADS[topic] || (() => ({}));
  return {
    id: Math.random().toString(36).slice(2),
    topic,
    partition: Math.floor(Math.random() * 6),
    offset: Math.floor(Math.random() * 1000000),
    timestamp: new Date().toISOString(),
    key: `key-${Math.random().toString(36).slice(2, 8)}`,
    severity: TOPIC_SEVERITY[topic] || "info",
    summary: topic.replace(/\./g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    payload: payloadFn(),
  };
}

export default function NotificationFeed() {
  const [isOpen, setIsOpen] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [events, setEvents] = useState<KafkaEvent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterTopic, setFilterTopic] = useState<string>("all");
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const addEvent = useCallback((e: KafkaEvent) => {
    setEvents((prev) => [e, ...prev].slice(0, 100));
    if (!isOpen) setUnreadCount((c) => c + 1);
  }, [isOpen]);

  useEffect(() => {
    if (isStreaming) {
      // Seed with a declaration flow
      const flow = [
        "declaration.submitted",
        "document.ocr.completed",
        "hs.classification.result",
        "risk.score.computed",
        "oga.request.sent",
        "oga.response.received",
        "payment.quote.created",
        "payment.transfer.initiated",
        "payment.fulfilment.confirmed",
        "permit.issued",
        "audit.event.recorded",
        "notification.sent",
      ];
      let flowIdx = 0;
      intervalRef.current = setInterval(() => {
        const topic = flowIdx < flow.length ? flow[flowIdx++] : undefined;
        addEvent(generateEvent(topic));
        if (flowIdx >= flow.length) flowIdx = 0;
      }, 1200);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isStreaming, addEvent]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
      if (feedRef.current) feedRef.current.scrollTop = 0;
    }
  }, [isOpen]);

  const filtered = filterTopic === "all" ? events : events.filter((e) => e.topic === filterTopic);

  return (
    <>
      {/* Bell button — fixed bottom-right */}
      <button
        onClick={() => setIsOpen(true)}
        aria-label="Open notification feed"
        className="fixed bottom-24 right-6 z-50 w-12 h-12 rounded-full bg-[#0A1628] border border-[#D4A017]/40 shadow-lg flex items-center justify-center hover:bg-[#D4A017]/10 transition-colors group"
      >
        <Bell className="w-5 h-5 text-[#D4A017]" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {/* Slide-in panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="fixed top-0 right-0 z-[90] h-full w-full max-w-md bg-[#060F1E] border-l border-white/10 shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 flex-shrink-0">
                <div>
                  <div className="font-['Playfair_Display'] text-base font-bold text-[#D4A017]">Kafka Event Stream</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {events.length} events · {KAFKA_TOPICS.length} topics
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsStreaming((s) => !s)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      isStreaming
                        ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                        : "bg-slate-800/60 text-slate-400 border border-white/10 hover:text-white"
                    }`}
                  >
                    {isStreaming ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                    {isStreaming ? "Live" : "Paused"}
                  </button>
                  <button
                    onClick={() => setEvents([])}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-500 hover:text-white transition-colors"
                    aria-label="Clear events"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-white transition-colors"
                    aria-label="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Filter bar */}
              <div className="px-4 py-2.5 border-b border-white/5 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Filter className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                  <select
                    value={filterTopic}
                    onChange={(e) => setFilterTopic(e.target.value)}
                    className="flex-1 bg-slate-800/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#D4A017]/50"
                  >
                    <option value="all">All Topics ({events.length})</option>
                    {KAFKA_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t} ({events.filter((e) => e.topic === t).length})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Event list */}
              <div ref={feedRef} className="flex-1 overflow-y-auto py-3 px-3 space-y-2">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-center">
                    <WifiOff className="w-8 h-8 text-slate-700 mb-3" />
                    <div className="text-slate-500 text-sm">No events yet</div>
                    <div className="text-slate-600 text-xs mt-1">Click "Paused" to start streaming</div>
                  </div>
                ) : (
                  filtered.map((event) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`rounded-lg border p-3 cursor-pointer transition-colors hover:bg-white/3 ${TOPIC_COLORS[event.severity]}`}
                      onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${TOPIC_BADGE[event.severity]}`}>
                              {event.severity}
                            </span>
                            <span className="text-xs font-mono text-slate-300 truncate">{event.topic}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                            <span>P{event.partition}</span>
                            <span className="text-slate-600">·</span>
                            <span>@{event.offset.toLocaleString()}</span>
                            <span className="text-slate-600">·</span>
                            <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                        {expandedId === event.id ? (
                          <ChevronUp className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                        ) : (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
                        )}
                      </div>

                      {/* Expanded payload */}
                      <AnimatePresence>
                        {expandedId === event.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <div className="text-[10px] text-slate-500 mb-1.5 font-mono">KEY: {event.key}</div>
                              <pre className="text-[10px] text-emerald-300 font-mono bg-black/30 rounded-lg p-2.5 overflow-x-auto leading-relaxed">
                                {JSON.stringify(event.payload, null, 2)}
                              </pre>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  ))
                )}
              </div>

              {/* Footer stats */}
              <div className="px-5 py-3 border-t border-white/5 flex-shrink-0">
                <div className="grid grid-cols-3 gap-3 text-center">
                  {(["success", "warning", "info"] as const).map((sev) => (
                    <div key={sev} className="bg-slate-800/40 rounded-lg py-2">
                      <div className={`text-sm font-bold ${sev === "success" ? "text-emerald-400" : sev === "warning" ? "text-amber-400" : "text-blue-400"}`}>
                        {events.filter((e) => e.severity === sev).length}
                      </div>
                      <div className="text-[10px] text-slate-500 capitalize">{sev}</div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
