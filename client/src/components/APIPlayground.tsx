/**
 * APIPlayground Component
 * Design: Sovereign Blueprint — deep navy + gold, Playfair Display headings
 * Interactive OpenAPI 3.1 endpoint browser with mock responses
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, Play, Copy, Check, Code2, Globe, Lock, Zap } from "lucide-react";

// ── Data ──────────────────────────────────────────────────────────────────────

const endpoints = [
  {
    group: "Declaration Engine",
    color: "#00ADD8",
    tag: "Go",
    routes: [
      {
        method: "POST",
        path: "/api/v1/declarations",
        summary: "Submit a new import/export declaration",
        description: "Creates a new declaration, assigns a URN, triggers OCR and risk scoring via Temporal workflow. Returns within 2 seconds with URN and initial status.",
        auth: "Bearer JWT (Keycloak)",
        request: {
          "trader_id": "NG-TIN-0012345678",
          "declaration_type": "IM",
          "goods_items": [
            {
              "hs_code": "8471300000",
              "description": "Laptop Computers HP EliteBook 840 G9",
              "quantity": 100,
              "unit": "PCE",
              "gross_weight_kg": 250.5,
              "invoice_amount_usd": 85000.00,
              "country_of_origin": "CN"
            }
          ],
          "transport": {
            "mode": "SEA",
            "vessel_imo": "IMO9321483",
            "voyage_number": "VOY001",
            "port_of_loading": "CNSHA",
            "port_of_discharge": "NGAPP",
            "eta": "2024-03-16T08:00:00Z"
          },
          "documents": ["doc_invoice_001", "doc_bl_001", "doc_coo_001"]
        },
        response: {
          "urn": "TG-2024-IM-001234",
          "status": "SUBMITTED",
          "workflow_id": "wf_decl_abc123",
          "risk_score": null,
          "lane": null,
          "created_at": "2024-03-15T12:00:00Z",
          "message": "Declaration submitted. OCR and risk scoring in progress."
        },
        latency: "< 2s",
        statusCode: 201
      },
      {
        method: "GET",
        path: "/api/v1/declarations/{urn}",
        summary: "Get declaration status and details",
        description: "Retrieves full declaration state including risk score, lane assignment, OGA approvals, and payment status.",
        auth: "Bearer JWT (Keycloak)",
        request: null,
        response: {
          "urn": "TG-2024-IM-001234",
          "status": "AWAITING_PAYMENT",
          "risk_score": 23,
          "lane": "GREEN",
          "duty_assessment": {
            "import_duty_ngn": 6587500.00,
            "vat_ngn": 10375312.50,
            "total_ngn": 16962812.50,
            "exchange_rate": 1550.00
          },
          "oga_approvals": [
            { "agency": "NAFDAC", "status": "AUTO_APPROVED", "at": "2024-03-15T12:04:22Z" },
            { "agency": "SON", "status": "AUTO_APPROVED", "at": "2024-03-15T12:04:25Z" }
          ],
          "workflow_step": "AWAITING_PAYMENT"
        },
        latency: "< 100ms",
        statusCode: 200
      }
    ]
  },
  {
    group: "Risk Engine",
    color: "#EF4444",
    tag: "Rust + Python",
    routes: [
      {
        method: "POST",
        path: "/api/v1/risk/score",
        summary: "Compute risk score for a declaration",
        description: "Runs 200+ parallel Rust rules + BERT HS classifier + GNN fraud detection. Returns composite score 0–100 and lane assignment within 5 seconds.",
        auth: "Service-to-service mTLS",
        request: {
          "declaration_id": "TG-2024-IM-001234",
          "trader_id": "NG-TIN-0012345678",
          "hs_code": "8471300000",
          "country_of_origin": "CN",
          "invoice_amount_usd": 85000.00,
          "trader_history_months": 36,
          "prior_violations": 0
        },
        response: {
          "risk_score": 23,
          "lane": "GREEN",
          "components": {
            "rule_engine_score": 18,
            "hs_classifier_confidence": 0.97,
            "gnn_fraud_probability": 0.04,
            "trader_history_score": 12,
            "country_risk_score": 25,
            "value_anomaly_score": 10
          },
          "triggered_rules": ["R042_HIGH_VALUE_ELECTRONICS"],
          "sanctions_hit": false,
          "computed_in_ms": 1847
        },
        latency: "< 5s",
        statusCode: 200
      }
    ]
  },
  {
    group: "Payment Gateway",
    color: "#22C55E",
    tag: "Go + Mojaloop",
    routes: [
      {
        method: "POST",
        path: "/api/v1/payments/quote",
        summary: "Get duty payment quote",
        description: "Returns itemised duty breakdown with ILP payment quote. Quote valid for 30 minutes.",
        auth: "Bearer JWT (Keycloak)",
        request: {
          "declaration_urn": "TG-2024-IM-001234",
          "payment_method": "MOBILE_MONEY",
          "currency": "NGN"
        },
        response: {
          "quote_id": "pq_xyz789",
          "expires_at": "2024-03-15T12:30:00Z",
          "line_items": [
            { "type": "IMPORT_DUTY", "rate_pct": 5.0, "amount_ngn": 6587500.00 },
            { "type": "VAT", "rate_pct": 7.5, "amount_ngn": 10375312.50 },
            { "type": "PROCESSING_FEE", "rate_pct": 0.1, "amount_ngn": 165000.00 }
          ],
          "total_ngn": 17127812.50,
          "ilp_condition": "uU0nuZNNPgilLlLX2n2r-sSE7-N6U4DukIj3rOLvzek",
          "payment_channels": ["MTN_MOMO", "AIRTEL_MONEY", "BANK_TRANSFER", "USSD"]
        },
        latency: "< 500ms",
        statusCode: 200
      },
      {
        method: "POST",
        path: "/api/v1/payments/execute",
        summary: "Execute duty payment via Mojaloop",
        description: "Initiates ILP transfer via Mojaloop, reserves funds in TigerBeetle ledger. Triggers permit issuance on fulfilment.",
        auth: "Bearer JWT (Keycloak)",
        request: {
          "quote_id": "pq_xyz789",
          "payment_channel": "MTN_MOMO",
          "payer_msisdn": "+2348012345678"
        },
        response: {
          "payment_id": "pay_abc456",
          "status": "PENDING",
          "transfer_id": "ilp_transfer_001",
          "tigerbeetle_pending_id": "tb_pending_001",
          "message": "Payment initiated. Awaiting Mojaloop fulfilment callback."
        },
        latency: "< 1s",
        statusCode: 202
      }
    ]
  },
  {
    group: "Permit Issuance",
    color: "#A78BFA",
    tag: "Go + Rust",
    routes: [
      {
        method: "GET",
        path: "/api/v1/permits/{permit_id}",
        summary: "Retrieve signed clearance permit",
        description: "Returns Ed25519-signed clearance permit with QR code. Permit is publicly verifiable without authentication.",
        auth: "Public (no auth required)",
        request: null,
        response: {
          "permit_id": "TG-PERMIT-2024-001234",
          "declaration_urn": "TG-2024-IM-001234",
          "issued_at": "2024-03-15T12:45:00Z",
          "expires_at": "2024-03-22T12:45:00Z",
          "trader": "Lagos Trading Company Ltd",
          "goods_description": "Laptop Computers HP EliteBook 840 G9 (100 PCE)",
          "port": "Apapa Container Terminal, Lagos",
          "container": "MSCU1234567",
          "signature": "Ed25519:base64encodedSignatureHere...",
          "public_key_id": "tg-signing-key-2024-q1",
          "qr_code_url": "https://verify.tradegateway.ng/permit/TG-PERMIT-2024-001234",
          "pdf_url": "https://docs.tradegateway.ng/permits/TG-PERMIT-2024-001234.pdf"
        },
        latency: "< 200ms",
        statusCode: 200
      }
    ]
  },
  {
    group: "Cargo Tracking",
    color: "#F59E0B",
    tag: "Go + Rust",
    routes: [
      {
        method: "GET",
        path: "/api/v1/cargo/{container_id}/track",
        summary: "Real-time container tracking",
        description: "Returns current vessel position (AIS), container status, e-seal telemetry, and ETA prediction.",
        auth: "Bearer JWT (Keycloak)",
        request: null,
        response: {
          "container_id": "MSCU1234567",
          "status": "AT_SEA",
          "vessel": {
            "name": "MSC OSCAR",
            "imo": "IMO9321483",
            "position": { "lat": 3.1390, "lon": 101.6869 },
            "speed_knots": 18.4,
            "heading": 270,
            "last_updated": "2024-03-15T11:55:00Z"
          },
          "eta_port": "2024-03-16T08:00:00Z",
          "eta_confidence": 0.91,
          "eseal": {
            "id": "TG-SEAL-2024-001234",
            "status": "INTACT",
            "temperature_c": 22.1,
            "humidity_pct": 45.2,
            "last_ping": "2024-03-15T11:50:00Z"
          },
          "geofence_alerts": []
        },
        latency: "< 300ms",
        statusCode: 200
      }
    ]
  }
];

const methodColors: Record<string, string> = {
  GET: "#22C55E",
  POST: "#3B82F6",
  PUT: "#F59E0B",
  DELETE: "#EF4444",
  PATCH: "#A78BFA"
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function APIPlayground() {
  const [selectedEndpoint, setSelectedEndpoint] = useState<{ group: number; route: number } | null>({ group: 0, route: 0 });
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set([0]));
  const [activeTab, setActiveTab] = useState<"request" | "response">("response");
  const [copied, setCopied] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const toggleGroup = (i: number) => {
    const next = new Set(expandedGroups);
    next.has(i) ? next.delete(i) : next.add(i);
    setExpandedGroups(next);
  };

  const current = selectedEndpoint
    ? endpoints[selectedEndpoint.group].routes[selectedEndpoint.route]
    : null;

  const handleRun = () => {
    setIsRunning(true);
    setHasRun(false);
    setTimeout(() => {
      setIsRunning(false);
      setHasRun(true);
      setActiveTab("response");
    }, 1200);
  };

  const handleCopy = () => {
    if (current) {
      navigator.clipboard.writeText(JSON.stringify(current.response, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section id="api-playground" className="py-20" style={{ background: "#0A1628" }}>
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <Globe className="w-6 h-6" style={{ color: "#D4A017" }} />
            <span className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#D4A017" }}>
              API Reference
            </span>
          </div>
          <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Playfair Display', serif", color: "#F5F0E8" }}>
            Interactive API Playground
          </h2>
          <p className="text-lg max-w-3xl" style={{ color: "#8BA0B8" }}>
            Browse all 47 TradeGateway endpoints with live mock responses. Each endpoint reflects the OpenAPI 3.1 contract
            defined in <code className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(212,160,23,0.15)", color: "#D4A017" }}>api/openapi/tradegateway-api.yaml</code>.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ minHeight: "600px" }}>
          {/* Left: Endpoint List */}
          <div className="lg:col-span-1 rounded-xl border overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="p-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(212,160,23,0.08)" }}>
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#D4A017" }}>Endpoints</div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "560px" }}>
              {endpoints.map((group, gi) => (
                <div key={gi}>
                  <button
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors"
                    onClick={() => toggleGroup(gi)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: group.color }} />
                      <span className="text-sm font-semibold" style={{ color: "#F5F0E8" }}>{group.group}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${group.color}22`, color: group.color }}>{group.tag}</span>
                      {expandedGroups.has(gi) ? <ChevronDown className="w-3 h-3" style={{ color: "#8BA0B8" }} /> : <ChevronRight className="w-3 h-3" style={{ color: "#8BA0B8" }} />}
                    </div>
                  </button>
                  {expandedGroups.has(gi) && group.routes.map((route, ri) => {
                    const isSelected = selectedEndpoint?.group === gi && selectedEndpoint?.route === ri;
                    return (
                      <button
                        key={ri}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors"
                        style={{ background: isSelected ? "rgba(212,160,23,0.12)" : "transparent" }}
                        onClick={() => { setSelectedEndpoint({ group: gi, route: ri }); setHasRun(false); setActiveTab("response"); }}
                      >
                        <span className="text-xs font-bold font-mono w-10 flex-shrink-0" style={{ color: methodColors[route.method] || "#60A5FA" }}>
                          {route.method}
                        </span>
                        <span className="text-xs font-mono truncate" style={{ color: isSelected ? "#F5F0E8" : "#8BA0B8" }}>
                          {route.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Endpoint Detail */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {current ? (
              <>
                {/* Endpoint Header */}
                <div className="rounded-xl border p-5" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold font-mono px-3 py-1 rounded" style={{ background: `${methodColors[current.method] || "#60A5FA"}22`, color: methodColors[current.method] || "#60A5FA" }}>
                        {current.method}
                      </span>
                      <code className="text-sm font-mono" style={{ color: "#F5F0E8" }}>{current.path}</code>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(34,197,94,0.15)", color: "#22C55E" }}>
                        {current.statusCode}
                      </span>
                      <span className="text-xs px-2 py-1 rounded" style={{ background: "rgba(96,165,250,0.15)", color: "#60A5FA" }}>
                        {current.latency}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm mb-3" style={{ color: "#8BA0B8" }}>{current.description}</p>
                  <div className="flex items-center gap-2">
                    <Lock className="w-3 h-3" style={{ color: "#D4A017" }} />
                    <span className="text-xs" style={{ color: "#D4A017" }}>{current.auth}</span>
                  </div>
                </div>

                {/* Request/Response Panel */}
                <div className="rounded-xl border flex-1" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                  {/* Tabs */}
                  <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                    <div className="flex gap-2">
                      {(["request", "response"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTab(tab)}
                          className="px-4 py-1.5 rounded text-xs font-semibold capitalize transition-all"
                          style={{
                            background: activeTab === tab ? "#D4A017" : "transparent",
                            color: activeTab === tab ? "#0A1628" : "#8BA0B8",
                          }}
                        >
                          {tab === "request" ? "Request Body" : hasRun ? "Live Response" : "Mock Response"}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-all"
                        style={{ background: "rgba(255,255,255,0.06)", color: "#8BA0B8" }}
                      >
                        {copied ? <Check className="w-3 h-3" style={{ color: "#22C55E" }} /> : <Copy className="w-3 h-3" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={handleRun}
                        disabled={isRunning}
                        className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-semibold transition-all"
                        style={{
                          background: isRunning ? "rgba(212,160,23,0.5)" : "#D4A017",
                          color: "#0A1628",
                          cursor: isRunning ? "not-allowed" : "pointer"
                        }}
                      >
                        {isRunning ? (
                          <><Zap className="w-3 h-3 animate-pulse" /> Running...</>
                        ) : (
                          <><Play className="w-3 h-3" /> Try it</>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Code Panel */}
                  <div className="p-4 overflow-auto" style={{ maxHeight: "380px" }}>
                    {activeTab === "request" ? (
                      current.request ? (
                        <pre className="text-xs font-mono leading-relaxed" style={{ color: "#93C5FD" }}>
                          {JSON.stringify(current.request, null, 2)}
                        </pre>
                      ) : (
                        <div className="text-sm text-center py-8" style={{ color: "#8BA0B8" }}>
                          No request body — parameters are passed via URL path.
                        </div>
                      )
                    ) : (
                      <div>
                        {hasRun && (
                          <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: "#22C55E" }}>
                            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                            Response received · {current.latency} · HTTP {current.statusCode}
                          </div>
                        )}
                        <pre className="text-xs font-mono leading-relaxed" style={{ color: "#86EFAC" }}>
                          {JSON.stringify(current.response, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full rounded-xl border" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.08)" }}>
                <div className="text-center">
                  <Code2 className="w-12 h-12 mx-auto mb-3" style={{ color: "#8BA0B8" }} />
                  <p style={{ color: "#8BA0B8" }}>Select an endpoint from the left panel</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Endpoints", value: "47" },
            { label: "API Version", value: "v1.0" },
            { label: "Auth Protocol", value: "Keycloak JWT" },
            { label: "Spec Format", value: "OpenAPI 3.1" },
          ].map((s) => (
            <div key={s.label} className="rounded-lg p-3 text-center border" style={{ background: "rgba(255,255,255,0.03)", borderColor: "rgba(255,255,255,0.06)" }}>
              <div className="text-lg font-bold" style={{ color: "#D4A017", fontFamily: "'Playfair Display', serif" }}>{s.value}</div>
              <div className="text-xs" style={{ color: "#8BA0B8" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
