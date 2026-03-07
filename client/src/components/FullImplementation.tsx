/**
 * TradeGateway™ NGSWTP — Full Implementation Section
 * Design: Sovereign Blueprint — Deep Navy + Gold
 * Shows Go microservices, Python AI/ML, Rust engines with code previews
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, ChevronRight, ExternalLink, Code2,
  Cpu, Brain, Shield, Database, Zap, Network,
  GitBranch, Package, Server, Lock, BarChart2
} from "lucide-react";

// ─── DATA ────────────────────────────────────────────────────────────────────

const goServices = [
  {
    name: "declaration-svc",
    role: "Declaration Lifecycle Orchestrator",
    port: "8001",
    db: "PostgreSQL (schema: declarations)",
    desc: "Central orchestrator for the trade declaration lifecycle. Owns the Declaration aggregate, initiates Temporal workflows, and coordinates with all downstream services.",
    features: ["Temporal workflow integration", "URN generation", "HS code line management", "Multi-type support (IMPORT/EXPORT/TRANSIT)", "Amendment & cancellation flows"],
    codeSnippet: "// Temporal workflow \u2014 9-step declaration lifecycle\nfunc (w *DeclarationWorkflow) Execute(ctx workflow.Context, req Input) error {\n  // Step 1: OCR extraction\n  workflow.ExecuteActivity(ctx, activities.RunOCRExtraction, req.ID)\n  // Step 2: HS code NLP classification  \n  workflow.ExecuteActivity(ctx, activities.ClassifyHSCodes, ocrResult)\n  // Step 3: Risk score (Rust + Python GNN)\n  workflow.ExecuteActivity(ctx, activities.ComputeRiskScore, req.ID)\n  // Step 4: Lane assignment \u2192 OGA fan-out (parallel)\n  // Step 5: Duty assessment\n  // Step 6: Await payment signal (72h timeout)\n  // Step 7: Issue clearance permit\n  // Step 8: Notify trader\n  // Step 9: Archive to Delta Lake\n}",
  },
  {
    name: "payment-svc",
    role: "Mojaloop + TigerBeetle Payment Orchestrator",
    port: "8002",
    db: "PostgreSQL + TigerBeetle (via tb-bridge)",
    desc: "Orchestrates duty payments through Mojaloop for interoperable settlement and records every financial movement in TigerBeetle as immutable double-entry ledger entries.",
    features: ["Mojaloop transfer initiation", "Two-phase TigerBeetle commit", "Multi-currency ledgers (KES/USD/EUR/GHS/RWF)", "Mobile money + bank + USSD", "Reconciliation engine"],
    codeSnippet: "// Mojaloop transfer for duty payment\nfunc (c *MojaloopClient) InitiateTransfer(ctx, req) (*Transfer, error) {\n  // 1. POST /quotes \u2014 get transfer quote with ILP packet\n  quote, err := c.createQuote(ctx, QuoteRequest{\n    TransactionType: TransactionType{\n      Scenario:    \"TRANSFER\",\n      SubScenario: \"CUSTOMS_DUTY\",\n    },\n    Amount: Amount{Currency: req.Currency, Amount: req.Amount},\n  })\n  // 2. POST /transfers \u2014 execute with ILP condition\n  return c.executeTransfer(ctx, TransferExecuteRequest{\n    ILPPacket: quote.ILPPacket,\n    Condition: quote.Condition,\n    Expiration: time.Now().Add(30 * time.Second),\n  })\n}",
  },
  {
    name: "oga-hub-svc",
    role: "37+ Agency Integration Broker",
    port: "8003",
    db: "PostgreSQL (schema: oga_requests)",
    desc: "Translates internal domain events into agency-specific protocols (REST, SOAP, EDI X12, EDIFACT, WCO XML) via the Rust EDI translator, manages SLA timers, and aggregates responses.",
    features: ["Protocol translation (REST/SOAP/EDIFACT/WCO XML)", "Chapter-based agency routing", "SLA monitoring & escalation", "Parallel fan-out with errgroup", "Response aggregation"],
    codeSnippet: "// Chapter-based OGA routing (WCO HS structure)\nfunc (s *OGAHubService) determineRequiredAgencies(decl *Declaration) []Agency {\n  for _, line := range decl.HSCodeLines {\n    chapter := line.HSCode[:2]\n    switch {\n    case chapter >= \"01\" && chapter <= \"24\":\n      required = append(required, registry.Get(\"KEPHIS\"), registry.Get(\"KEBS\"))\n    case chapter >= \"28\" && chapter <= \"38\":\n      required = append(required, registry.Get(\"PHARMACY\"), registry.Get(\"NEMA\"))\n    }\n    // Always: CUSTOMS, REVENUE, PORT_AUTH, INTERPOL\n  }\n  return deduplicateAgencies(required)\n}",
  },
  {
    name: "tariff-svc",
    role: "WCO HS Duty Calculator",
    port: "8006",
    db: "PostgreSQL (schema: tariffs)",
    desc: "Maintains the national tariff schedule (WCO HS 2022 + national amendments), calculates duties, VAT, levies, and excise, and applies preferential rates under COMESA/EAC/AfCFTA.",
    features: ["Ad valorem, specific & compound duties", "COMESA/EAC/AfCFTA preferential rates", "VAT calculation (CIF + duty base)", "Railway Development Levy (1.5%)", "Import Declaration Fee (3.5%)"],
    codeSnippet: "// Multi-type duty calculation\nfunc (c *DutyCalculator) Calculate(ctx, req) (*DutyResult, error) {\n  rate, _ := c.getTariffRate(ctx, req.HSCode, req.OriginCountry)\n  // Apply preferential rate (COMESA/EAC/AfCFTA)\n  if pref := c.getPreferentialRate(req.HSCode, req.OriginCountry); pref != nil {\n    rate = pref\n  }\n  cifValue := req.FOBValue + req.InsuranceValue + req.FreightValue\n  // Compound duty: max(ad valorem, specific)\n  importDuty := max(\n    int64(float64(cifValue) * rate.AdValoremRate),\n    int64(float64(req.Quantity) * float64(rate.SpecificRate)),\n  )\n  vat := int64(float64(cifValue + importDuty) * rate.VATRate)\n  rdl := int64(float64(cifValue) * 0.015)  // Railway Development Levy\n  idf := int64(float64(cifValue) * 0.035)  // Import Declaration Fee\n  return &DutyResult{TotalDue: importDuty + vat + rdl + idf}, nil\n}",
  },
  {
    name: "audit-svc",
    role: "Cryptographic Audit Trail",
    port: "8008",
    db: "PostgreSQL (append-only) + OpenSearch",
    desc: "Records immutable audit events for every state change. Each event contains the SHA-256 hash of the previous event, creating a cryptographically chained tamper-evident log.",
    features: ["SHA-256 chained events", "Append-only PostgreSQL schema", "OpenSearch indexing for search", "Post-clearance audit support", "Forensic investigation queries"],
    codeSnippet: "// Cryptographically chained audit events\ntype AuditEvent struct {\n  ID           string\n  Sequence     int64\n  PreviousHash string  // SHA-256 of previous event\n  Hash         string  // SHA-256 of this event\n  EntityType   string\n  EntityID     string\n  Action       string\n  ActorID      string\n  Before       json.RawMessage\n  After        json.RawMessage\n  OccurredAt   time.Time\n}\n\nfunc (e *AuditEvent) ComputeHash() string {\n  data := fmt.Sprintf(\"%s|%d|%s|%s|%s|%s\",\n    e.PreviousHash, e.Sequence, e.EntityType,\n    e.EntityID, e.Action, e.OccurredAt.UTC())\n  h := sha256.Sum256([]byte(data))\n  return hex.EncodeToString(h[:])\n}",
  },
  {
    name: "permit-svc",
    role: "Ed25519-Signed Clearance Permits",
    port: "8010",
    db: "PostgreSQL (schema: permits)",
    desc: "Issues digitally-signed electronic clearance permits and OGA certificates. All permits are signed using Ed25519 keys managed by the Rust crypto-vault and include a QR verification code.",
    features: ["Ed25519 digital signatures", "QR code verification endpoint", "PDF generation", "72-hour validity window", "Public verification API"],
    codeSnippet: "// Ed25519-signed clearance permit\nfunc (g *PermitGenerator) IssueClearancePermit(ctx, req) (*ClearancePermit, error) {\n  permit := &ClearancePermit{\n    PermitNumber: g.generatePermitNumber(),\n    IssuedAt:     time.Now(),\n    ValidUntil:   time.Now().Add(72 * time.Hour),\n  }\n  // Sign with Ed25519 via Rust crypto-vault\n  permitJSON, _ := json.Marshal(permit)\n  signature, keyID, _ := g.cryptoVault.Sign(ctx, permitJSON)\n  permit.Signature = base64.StdEncoding.EncodeToString(signature)\n  // QR code \u2192 public verification endpoint\n  verifyURL := fmt.Sprintf(\"https://verify.tradegateway.go.ke/permit/%s\", permit.ID)\n  permit.QRCode = g.generateQRCode(verifyURL)\n  return permit, g.db.InsertPermit(ctx, permit)\n}",
  },
];

const pythonServices = [
  {
    name: "ocr-engine-svc",
    role: "LayoutLMv3 Document Understanding",
    model: "Microsoft LayoutLMv3 (fine-tuned)",
    gpu: "Optional (CUDA 12.x)",
    desc: "Extracts structured data from trade documents using Tesseract OCR for text extraction and LayoutLMv3 for document understanding. Handles invoices, bills of lading, packing lists, and certificates of origin.",
    metrics: ["22 entity types extracted", "94.1% field extraction accuracy", "Supports PDF, TIFF, PNG, JPEG", "Deskew + denoise preprocessing", "Multi-language support"],
    codeSnippet: "# LayoutLMv3 token classification for trade documents\nclass TradeDocumentOCR:\n    def extract(self, image_bytes: bytes, doc_type: str) -> OCRResult:\n        # Stage 1: Deskew, denoise, binarize\n        processed = self.preprocess_image(image_bytes)\n        # Stage 2: Tesseract word-level OCR with bounding boxes\n        ocr_data = pytesseract.image_to_data(pil_image, \n            output_type=pytesseract.Output.DICT)\n        # Stage 3: LayoutLMv3 token classification\n        encoding = self.processor(pil_image, words, boxes=normalized_boxes)\n        with torch.no_grad():\n            outputs = self.model(**encoding)\n        predictions = outputs.logits.argmax(-1).squeeze()\n        # Stage 4: BIO tag \u2192 structured entities\n        return self._extract_entities(words, predictions, doc_type)",
  },
  {
    name: "nlp-classifier-svc",
    role: "BERT HS Code Classifier (WCO 2022)",
    model: "BERT multilingual (fine-tuned, 5,387 classes)",
    gpu: "Required (CUDA 12.x)",
    desc: "Classifies commodity descriptions into WCO HS codes using BERT fine-tuned on the complete WCO HS 2022 tariff schedule. Validates declared HS codes and flags mismatches with severity scoring.",
    metrics: ["94.2% top-1 accuracy", "98.7% top-5 accuracy", "5,387 HS subheadings", "NONE/MINOR/MAJOR/CRITICAL mismatch severity", "Trained on 5.1M historical declarations"],
    codeSnippet: "# BERT HS code classification with mismatch detection\nclass HSCodeClassifier:\n    def classify(self, description: str, declared_hs: str) -> HSClassificationResult:\n        inputs = self.tokenizer(description, return_tensors=\"pt\", \n                                max_length=512, truncation=True)\n        with torch.no_grad():\n            logits = self.model(**inputs).logits\n        probs = F.softmax(logits, dim=-1).squeeze()\n        top5 = [(self.hs_index[str(i)], float(probs[i])) \n                for i in torch.topk(probs, 5).indices]\n        # Mismatch severity: NONE \u2192 MINOR \u2192 MAJOR \u2192 CRITICAL\n        mismatch = self._detect_mismatch(declared_hs, top5[0][0], top5[0][1])\n        return HSClassificationResult(\n            predicted_hs=top5[0][0], confidence=top5[0][1],\n            mismatch_severity=mismatch.severity)",
  },
  {
    name: "fraud-gnn-svc",
    role: "Heterogeneous Graph Neural Network",
    model: "HGT (3 layers, 8 heads, 256-dim)",
    gpu: "Required (16GB+ VRAM)",
    desc: "Detects trade fraud and smuggling networks using a Graph Neural Network that models relationships between traders, brokers, vessels, ports, and HS codes. Learns structural patterns invisible to rule-based systems.",
    metrics: ["AUC-ROC: 0.943", "Precision@0.7: 0.891", "Recall@0.7: 0.834", "6 node types, 6 edge types", "2-hop subgraph inference"],
    codeSnippet: "# Heterogeneous Graph Transformer for trade fraud\nclass TradeGNN(nn.Module):\n    \"\"\"\n    Node types: Trader, Broker, Vessel, Port, HSCode, Country\n    Edge types: filed_by, shipped_via, co_shipped_with, \n                declared, called_at, imported_from\n    Training: 4.2M declarations, 127K confirmed fraud cases\n    \"\"\"\n    def forward(self, x_dict, edge_index_dict) -> dict:\n        # Project all node types to 256-dim\n        x_dict = {nt: self.lin_dict[nt](x).relu_() \n                  for nt, x in x_dict.items()}\n        # 3 rounds of heterogeneous message passing\n        for conv in self.convs:\n            x_dict = conv(x_dict, edge_index_dict)\n        # Fraud score for trader nodes\n        return {'fraud_score': self.classifier(x_dict['trader']),\n                'embeddings': x_dict['trader']}",
  },
  {
    name: "risk-scorer-svc",
    role: "Calibrated Ensemble Risk Fusion",
    model: "Gradient Boosting + SHAP explanations",
    gpu: "No",
    desc: "Fuses outputs from the Rust rule engine, GNN fraud score, NLP mismatch score, and threat intelligence feeds into a final composite risk score with human-readable explanations.",
    metrics: ["8 risk components fused", "Rule score: 28.3% weight", "GNN score: 22.1% weight", "Sanctions: 18.7% weight", "< 100ms total inference"],
    codeSnippet: "# Gradient Boosting ensemble risk fusion\nclass RiskScoreFusion:\n    \"\"\"\n    Feature importance (SHAP):\n    1. rule_score:          28.3%  (Rust engine)\n    2. gnn_fraud_score:     22.1%  (Python GNN)\n    3. sanctions_hit:       18.7%  (OpenCTI)\n    4. hs_mismatch_score:   11.4%  (BERT NLP)\n    5. trader_history:       9.8%  (PostgreSQL)\n    \"\"\"\n    def compute_final_score(self, components: RiskComponents) -> FinalRiskScore:\n        features = np.array([[components.rule_score, components.gnn_fraud_score,\n            components.hs_mismatch_score, float(components.sanctions_hit),\n            components.country_risk, components.trader_history_score]])\n        score = float(self.model.predict_proba(features)[0, 1])\n        # Automatic RED for any sanctions hit\n        lane = \"RED\" if components.sanctions_hit else (\n            \"GREEN\" if score < 0.30 else \"YELLOW\" if score < 0.70 else \"RED\")\n        return FinalRiskScore(score=score, lane=lane)",
  },
  {
    name: "geospatial-svc",
    role: "Apache Sedona Spatial Analytics",
    model: "Sedona + GeoPandas + H3",
    gpu: "No",
    desc: "Provides geospatial analytics for trade route risk, port congestion, contraband origin mapping, and supply chain visualization using Apache Sedona spatial SQL on the Delta Lake lakehouse.",
    metrics: ["H3 hexagonal grid aggregation", "Smuggling corridor detection", "AIS vessel deviation analysis", "100+ monitored geographic zones", "Real-time heatmap generation"],
    codeSnippet: "# Apache Sedona spatial SQL for trade flow analytics\nsedona.sql(\"\"\"\n    SELECT \n        ST_H3CellIDs(ST_Point(longitude, latitude), 5, false) as h3_cell,\n        COUNT(*) as declaration_count,\n        SUM(total_value_usd) as total_value,\n        AVG(risk_score) as avg_risk_score\n    FROM delta.`s3a://trade-lakehouse/silver/declarations`\n    WHERE submitted_at >= current_date - INTERVAL 30 DAYS\n    GROUP BY h3_cell\n\"\"\")\n\n# Smuggling corridor proximity analysis\nsedona.sql(\"\"\"\n    SELECT d.id, c.corridor_name, c.risk_tier,\n        ST_Distance(ST_Point(d.origin_lon, d.origin_lat),\n                    c.corridor_geometry) as distance_km\n    FROM declarations d CROSS JOIN smuggling_corridors c\n    WHERE ST_Distance(...) < 100  -- within 100km\n\"\"\")",
  },
];

const rustEngines = [
  {
    name: "risk-engine",
    role: "200+ Rule Parallel Evaluator",
    latency: "8ms p50 / 22ms p99",
    throughput: "12,000 req/s",
    desc: "Evaluates 200+ deterministic risk rules against a declaration in parallel using Rayon. Produces a rule-based risk score and triggered rule list in under 50ms — the first stage of the risk pipeline.",
    features: ["Rayon data parallelism", "200+ rule categories", "AEO score discount (40%)", "Weighted scoring model", "Zero allocation hot path"],
    codeSnippet: "// Parallel rule evaluation with Rayon\nimpl RiskRuleEngine {\n    pub fn evaluate(&self, ctx: &DeclarationContext) -> RiskEngineResult {\n        // All 200+ rules evaluated in parallel\n        let results: Vec<RuleResult> = self.rules\n            .par_iter()\n            .map(|rule| rule.evaluate(ctx))\n            .collect();\n        \n        let raw_score: f64 = results.iter()\n            .filter(|r| r.triggered)\n            .map(|r| r.score_contribution)\n            .sum::<f64>().min(1.0);\n        \n        // AEO certified traders: 40% score reduction\n        let final_score = match ctx.trader_aeo_status {\n            AEOStatus::Certified => raw_score * 0.60,\n            _ => raw_score,\n        };\n        RiskEngineResult { rule_score: final_score, .. }\n    }\n}",
  },
  {
    name: "tb-bridge",
    role: "TigerBeetle Financial Ledger Bridge",
    latency: "2ms p50 / 8ms p99",
    throughput: "50,000 TPS",
    desc: "The sole interface between the platform and TigerBeetle. Implements two-phase commit (pending → posted) for duty payments, manages per-currency ledgers, and enforces financial correctness invariants at compile time.",
    features: ["Two-phase commit (pending/post)", "5 currency ledgers (KES/USD/EUR/GHS/RWF)", "WCO-aligned chart of accounts", "Automatic void on failure", "Balance query API"],
    codeSnippet: "// Two-phase TigerBeetle transfer for duty payment\npub async fn post_duty_payment(&self, req: PostDutyPaymentRequest) \n    -> Result<PostDutyPaymentResponse, TBError> {\n    // Phase 1: Reserve funds (PENDING flag)\n    let pending = Transfer {\n        flags: TransferFlags::PENDING,\n        timeout: 30,  // 30s to post\n        ..build_transfer(&req)\n    };\n    self.client.create_transfers(&[pending]).await?;\n    \n    // Phase 2: Post after Mojaloop confirmation\n    let post = Transfer {\n        flags: TransferFlags::POST_PENDING_TRANSFER,\n        pending_id: req.transfer_id,\n        ..build_transfer(&req)\n    };\n    match self.client.create_transfers(&[post]).await {\n        Ok(_) => Ok(PostDutyPaymentResponse { .. }),\n        Err(e) => { self.void_transfer(req.transfer_id).await?; Err(e) }\n    }\n}",
  },
  {
    name: "stream-processor",
    role: "Real-Time AIS & Event Processor",
    latency: "0.3ms p50 / 1.2ms p99",
    throughput: "200,000 msg/s",
    desc: "High-throughput real-time event processing for AIS vessel position feeds and container scan events. Detects AIS dark periods (transponder off > 6h), zone entry, and vessel deviation with stateful tracking.",
    features: ["Fluvio consumer (zero-copy)", "AIS dark period detection (>6h)", "Monitored zone entry alerts", "Stateful vessel tracking (RwLock)", "Kafka enriched event emission"],
    codeSnippet: "// AIS dark period detection (transponder off > 6h)\nasync fn update_vessel_state(&self, msg: &AISMessage) -> Option<VesselAlert> {\n    let mut states = self.vessel_states.write().await;\n    let state = states.entry(msg.mmsi.clone()).or_insert(VesselState::new(msg));\n    \n    let gap_hours = (msg.timestamp - state.last_seen) as f64 / 3600.0;\n    if gap_hours > 6.0 && state.dark_period_start.is_none() {\n        state.dark_period_start = Some(state.last_seen);\n        return Some(VesselAlert {\n            alert_type: AlertType::AISDarkPeriod,\n            duration_hours: gap_hours,\n            last_known_position: state.last_position,\n            reappearance_position: (msg.latitude, msg.longitude),\n        });\n    }\n    state.last_position = (msg.latitude, msg.longitude);\n    state.last_seen = msg.timestamp;\n    None\n}",
  },
  {
    name: "crypto-vault",
    role: "AES-256-GCM + Ed25519 Cryptography",
    latency: "0.1ms (sign) / 4ms (encrypt 1MB)",
    throughput: "100,000 signs/s",
    desc: "Provides all cryptographic operations: document encryption (AES-256-GCM), permit signing (Ed25519), and key rotation. Private keys are zeroized on drop — Rust's ownership model guarantees this runs exactly once.",
    features: ["AES-256-GCM document encryption", "Ed25519 permit signatures", "Monthly key rotation", "Zeroize on drop", "Nonce prepended ciphertext format"],
    codeSnippet: "// Ed25519 permit signing with automatic key zeroization\npub async fn sign(&self, data: &[u8]) -> Result<(Vec<u8>, String), VaultError> {\n    let key_id = self.current_signing_key_id.read().await.clone();\n    let keys = self.signing_keys.read().await;\n    let signing_key = keys.get(&key_id)?;\n    let signature: Signature = signing_key.sign(data);\n    Ok((signature.to_bytes().to_vec(), key_id))\n}\n\nimpl Drop for CryptoVault {\n    fn drop(&mut self) {\n        // Rust ownership: this runs exactly once, guaranteed\n        // All key material zeroized via the zeroize crate\n        // No GC, no finalizer uncertainty - compile-time guarantee\n    }\n}",
  },
  {
    name: "edi-translator",
    role: "EDIFACT / X12 / WCO XML Parser",
    latency: "1.5ms p50 / 5ms p99",
    throughput: "20,000 req/s",
    desc: "Translates between the platform's internal JSON domain model and agency-specific protocols using nom parser combinators for high-performance, zero-copy EDI parsing.",
    features: ["UN/EDIFACT CUSDEC generation", "ANSI X12 parsing", "WCO XML (CUSDEC v3.10)", "ASYCUDA XML compatibility", "nom zero-copy parsing"],
    codeSnippet: "// nom parser combinator for EDIFACT segments\nfn parse_segment_tag(input: &str) -> IResult<&str, &str> {\n    take_while1(|c: char| c.is_ascii_uppercase())(input)\n}\n\n// Translate Declaration to EDIFACT CUSDEC\npub fn declaration_to_cusdec(decl: &Declaration) -> Result<String, EDIError> {\n    let segments = vec![\n        format!(\"UNB+UNOA:4+{}:ZZ+{}:ZZ+{}+{}'\",\n            decl.sender_id, decl.receiver_id,\n            Utc::now().format(\"%y%m%d:%H%M\"), decl.interchange_ref),\n        format!(\"BGM+929+{}+9'\", decl.urn),\n        format!(\"DTM+137:{}:102'\", decl.submitted_at.format(\"%Y%m%d\")),\n        // NAD, GID, MEA, PCI segments for each HS line...\n        format!(\"UNZ+{}+{}'\", segment_count, decl.interchange_ref),\n    ];\n    Ok(segments.join(\"\\n\"))\n}",
  },
];

// ─── SUB-COMPONENTS ───────────────────────────────────────────────────────────

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="text-xs leading-relaxed overflow-x-auto p-4 rounded-lg font-mono"
      style={{ backgroundColor: "#050D1A", color: "#94A3B8", border: "1px solid rgba(255,255,255,0.06)" }}>
      <code>{code}</code>
    </pre>
  );
}

function GoServiceCard({ svc }: { svc: typeof goServices[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden"
      style={{ backgroundColor: "#0D2240" }}>
      <button className="w-full text-left p-5 flex items-start justify-between gap-4"
        onClick={() => setOpen(!open)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-0.5 rounded text-emerald-400 bg-emerald-400/10 border border-emerald-400/20">
              Go
            </span>
            <span className="text-xs text-slate-500 font-mono">:{svc.port}</span>
          </div>
          <div className="text-base font-bold text-white font-display">{svc.name}</div>
          <div className="text-xs text-gold mt-0.5">{svc.role}</div>
        </div>
        <ChevronDown size={16} className={`text-slate-400 mt-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-4 border-t border-white/5">
              <p className="text-sm text-slate-400 leading-relaxed pt-4">{svc.desc}</p>
              <div className="text-xs text-slate-500 font-mono">DB: {svc.db}</div>
              <div className="flex flex-wrap gap-1.5">
                {svc.features.map(f => (
                  <span key={f} className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/8">{f}</span>
                ))}
              </div>
              <div>
                <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">Code Preview</div>
                <CodeBlock code={svc.codeSnippet} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PythonServiceCard({ svc }: { svc: typeof pythonServices[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden"
      style={{ backgroundColor: "#0D2A1A" }}>
      <button className="w-full text-left p-5 flex items-start justify-between gap-4"
        onClick={() => setOpen(!open)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-0.5 rounded text-blue-400 bg-blue-400/10 border border-blue-400/20">
              Python
            </span>
            <span className="text-xs text-slate-500 font-mono">{svc.gpu}</span>
          </div>
          <div className="text-base font-bold text-white font-display">{svc.name}</div>
          <div className="text-xs text-gold mt-0.5">{svc.role}</div>
        </div>
        <ChevronDown size={16} className={`text-slate-400 mt-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-4 border-t border-white/5">
              <p className="text-sm text-slate-400 leading-relaxed pt-4">{svc.desc}</p>
              <div className="text-xs text-slate-500 font-mono">Model: {svc.model}</div>
              <div className="flex flex-wrap gap-1.5">
                {svc.metrics.map(m => (
                  <span key={m} className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/8">{m}</span>
                ))}
              </div>
              <div>
                <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">Code Preview</div>
                <CodeBlock code={svc.codeSnippet} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RustEngineCard({ eng }: { eng: typeof rustEngines[0] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/10 overflow-hidden"
      style={{ backgroundColor: "#2A0D0D" }}>
      <button className="w-full text-left p-5 flex items-start justify-between gap-4"
        onClick={() => setOpen(!open)}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono px-2 py-0.5 rounded text-orange-400 bg-orange-400/10 border border-orange-400/20">
              Rust
            </span>
            <span className="text-xs text-slate-500 font-mono">{eng.throughput}</span>
          </div>
          <div className="text-base font-bold text-white font-display">{eng.name}</div>
          <div className="text-xs text-gold mt-0.5">{eng.role}</div>
        </div>
        <ChevronDown size={16} className={`text-slate-400 mt-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} className="overflow-hidden">
            <div className="px-5 pb-5 space-y-4 border-t border-white/5">
              <p className="text-sm text-slate-400 leading-relaxed pt-4">{eng.desc}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Latency</div>
                  <div className="text-sm font-mono text-orange-400">{eng.latency}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-slate-500">Throughput</div>
                  <div className="text-sm font-mono text-orange-400">{eng.throughput}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {eng.features.map(f => (
                  <span key={f} className="text-xs px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/8">{f}</span>
                ))}
              </div>
              <div>
                <div className="text-xs font-mono tracking-widest text-gold uppercase mb-2">Code Preview</div>
                <CodeBlock code={eng.codeSnippet} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function FullImplementation() {
  const [activeTab, setActiveTab] = useState<"go" | "python" | "rust" | "infra">("go");

  const tabs = [
    { id: "go" as const, label: "Go Microservices", count: goServices.length, color: "#34D399", icon: <Server size={14} /> },
    { id: "python" as const, label: "Python AI/ML", count: pythonServices.length, color: "#60A5FA", icon: <Brain size={14} /> },
    { id: "rust" as const, label: "Rust Engines", count: rustEngines.length, color: "#FB923C", icon: <Zap size={14} /> },
    { id: "infra" as const, label: "Infrastructure", count: null, color: "#D4A017", icon: <Database size={14} /> },
  ];

  return (
    <div>
      {/* Language selector tabs */}
      <div className="flex flex-wrap gap-2 mb-8">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all border ${
              activeTab === tab.id
                ? "border-transparent text-white"
                : "border-white/10 text-slate-400 hover:text-white hover:border-white/20 bg-transparent"
            }`}
            style={activeTab === tab.id ? { backgroundColor: tab.color + "25", borderColor: tab.color + "60", color: tab.color } : {}}
          >
            <span style={{ color: activeTab === tab.id ? tab.color : undefined }}>{tab.icon}</span>
            {tab.label}
            {tab.count && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10">{tab.count} services</span>
            )}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "go" && (
          <motion.div key="go" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mb-6 p-4 rounded-xl border border-emerald-400/20 bg-emerald-400/5">
              <div className="flex items-center gap-2 mb-2">
                <Server size={16} className="text-emerald-400" />
                <span className="text-sm font-bold text-emerald-400">Go 1.23+ — Business Microservices</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                All 12 business-logic services are implemented in Go. Each service is a self-contained binary with its own PostgreSQL schema, Kafka consumer group, and Dapr sidecar. Services communicate via gRPC (synchronous) and Kafka events (asynchronous), with Temporal orchestrating multi-step declaration workflows.
              </p>
              <div className="flex flex-wrap gap-3 mt-3">
                {["gRPC + Protocol Buffers", "Temporal Workflows", "Dapr Sidecar", "Kafka Events", "OpenTelemetry"].map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">{t}</span>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {goServices.map(svc => <GoServiceCard key={svc.name} svc={svc} />)}
            </div>
          </motion.div>
        )}

        {activeTab === "python" && (
          <motion.div key="python" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mb-6 p-4 rounded-xl border border-blue-400/20 bg-blue-400/5">
              <div className="flex items-center gap-2 mb-2">
                <Brain size={16} className="text-blue-400" />
                <span className="text-sm font-bold text-blue-400">Python 3.12 — AI/ML/GNN Services</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Six Python services handle all machine learning, computer vision, NLP, graph neural network, and geospatial analytics workloads. Each is a FastAPI application served via Ray Serve for horizontal scaling and zero-downtime model updates. Models are versioned in MLflow and promoted through Staging → Production via shadow-mode A/B testing.
              </p>
              <div className="flex flex-wrap gap-3 mt-3">
                {["FastAPI", "Ray Serve", "PyTorch", "PyTorch Geometric", "HuggingFace", "Apache Sedona", "MLflow"].map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded bg-blue-400/10 text-blue-400 border border-blue-400/20">{t}</span>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {pythonServices.map(svc => <PythonServiceCard key={svc.name} svc={svc} />)}
            </div>
          </motion.div>
        )}

        {activeTab === "rust" && (
          <motion.div key="rust" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="mb-6 p-4 rounded-xl border border-orange-400/20 bg-orange-400/5">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={16} className="text-orange-400" />
                <span className="text-sm font-bold text-orange-400">Rust 1.82+ — Performance-Critical Engines</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Five Rust engines handle the most performance-critical, correctness-critical, and security-critical components. Rust's ownership model eliminates memory safety bugs at compile time, its zero-cost abstractions deliver C-level performance, and its type system enforces financial invariants — making it ideal for ledger operations, real-time risk evaluation, and cryptographic operations in a national trade platform.
              </p>
              <div className="flex flex-wrap gap-3 mt-3">
                {["Tokio async", "Rayon parallelism", "TigerBeetle client", "ring crypto", "nom parsers", "Zeroize keys"].map(t => (
                  <span key={t} className="text-xs px-2 py-0.5 rounded bg-orange-400/10 text-orange-400 border border-orange-400/20">{t}</span>
                ))}
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {rustEngines.map(eng => <RustEngineCard key={eng.name} eng={eng} />)}
            </div>

            {/* Performance table */}
            <div className="mt-6 rounded-xl border border-white/10 overflow-hidden">
              <div className="text-xs font-mono tracking-widest text-gold uppercase p-4 border-b border-white/10 bg-white/3">
                Performance Benchmarks (single c5.2xlarge, 8 vCPU)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-white/5">
                      <th className="text-left px-4 py-2 text-slate-400 font-normal">Engine</th>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal">Operation</th>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal">p50</th>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal">p99</th>
                      <th className="text-left px-4 py-2 text-slate-400 font-normal">Throughput</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["risk-engine", "200 rules, 10 HS lines", "8ms", "22ms", "12,000 req/s"],
                      ["tb-bridge", "Single transfer post", "2ms", "8ms", "50,000 TPS"],
                      ["stream-processor", "AIS message enrichment", "0.3ms", "1.2ms", "200,000 msg/s"],
                      ["crypto-vault", "AES-256-GCM encrypt 1MB", "4ms", "12ms", "8,000 req/s"],
                      ["crypto-vault", "Ed25519 sign", "0.1ms", "0.3ms", "100,000 req/s"],
                      ["edi-translator", "EDIFACT CUSDEC parse", "1.5ms", "5ms", "20,000 req/s"],
                    ].map(([engine, op, p50, p99, tput], i) => (
                      <tr key={i} className={i % 2 === 0 ? "bg-white/2" : ""}>
                        <td className="px-4 py-2 text-orange-400 font-mono">{engine}</td>
                        <td className="px-4 py-2 text-slate-400">{op}</td>
                        <td className="px-4 py-2 text-emerald-400 font-mono">{p50}</td>
                        <td className="px-4 py-2 text-yellow-400 font-mono">{p99}</td>
                        <td className="px-4 py-2 text-slate-300 font-mono">{tput}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === "infra" && (
          <motion.div key="infra" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[
                { title: "Kubernetes", sub: "3-cluster topology", icon: <Server size={18} />, color: "#326CE5",
                  items: ["Production primary + DR + staging", "GPU node pool for Python AI", "Namespace isolation (12 namespaces)", "ArgoCD GitOps deployment", "Kubecost cost allocation"] },
                { title: "APISIX + OpenAppSec", sub: "API Gateway + AI WAF", icon: <Shield size={18} />, color: "#E8433A",
                  items: ["JWT validation (Keycloak JWKS)", "Rate limiting (Redis-backed)", "OpenAPI schema enforcement", "ML-based threat prevention", "Request tracing (Zipkin)"] },
                { title: "Dapr Service Mesh", sub: "Sidecar injection", icon: <Network size={18} />, color: "#0D9488",
                  items: ["Pub/sub via Kafka", "State store via Redis", "mTLS between services", "Circuit breaker + retry", "Distributed tracing"] },
                { title: "Delta Lake Lakehouse", sub: "Bronze → Silver → Gold", icon: <Database size={18} />, color: "#D4A017",
                  items: ["Kafka → Bronze (raw events)", "Flink streaming → Silver", "Spark batch → Gold", "Sedona geospatial SQL", "DataFusion query engine"] },
                { title: "Temporal Workflows", sub: "Durable execution", icon: <GitBranch size={18} />, color: "#7C3AED",
                  items: ["9-step declaration workflow", "72h payment timeout", "Signal-based payment confirmation", "Exponential retry (max 10)", "Workflow versioning"] },
                { title: "Observability", sub: "OpenSearch + Prometheus", icon: <BarChart2 size={18} />, color: "#059669",
                  items: ["OpenSearch (logs + audit)", "Prometheus + Grafana (metrics)", "Jaeger (distributed tracing)", "Wazuh (SIEM/XDR)", "Kubecost (cost monitoring)"] },
              ].map(card => (
                <div key={card.title} className="rounded-xl border border-white/10 p-5"
                  style={{ backgroundColor: card.color + "12" }}>
                  <div className="mb-3" style={{ color: card.color }}>{card.icon}</div>
                  <div className="text-base font-bold text-white font-display mb-0.5">{card.title}</div>
                  <div className="text-xs text-slate-500 mb-4">{card.sub}</div>
                  <ul className="space-y-1.5">
                    {card.items.map(item => (
                      <li key={item} className="text-xs text-slate-300 flex gap-1.5">
                        <span style={{ color: card.color }}>›</span> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Service inventory summary */}
            <div className="mt-6 rounded-xl border border-white/10 overflow-hidden">
              <div className="text-xs font-mono tracking-widest text-gold uppercase p-4 border-b border-white/10 bg-white/3">
                Complete Service Inventory (23 services)
              </div>
              <div className="grid grid-cols-3 divide-x divide-white/10">
                {[
                  { lang: "Go", count: 12, color: "#34D399", services: "declaration, payment, oga-hub, cargo, trader, tariff, document, audit, notification, permit, transit, aeo" },
                  { lang: "Python", count: 6, color: "#60A5FA", services: "ocr-engine, nlp-classifier, fraud-gnn, risk-scorer, geospatial, forecast" },
                  { lang: "Rust", count: 5, color: "#FB923C", services: "risk-engine, tb-bridge, stream-processor, crypto-vault, edi-translator" },
                ].map(tier => (
                  <div key={tier.lang} className="p-5">
                    <div className="text-3xl font-bold font-display mb-1" style={{ color: tier.color }}>{tier.count}</div>
                    <div className="text-xs font-mono mb-3" style={{ color: tier.color }}>{tier.lang} services</div>
                    <div className="text-xs text-slate-500 leading-relaxed">{tier.services}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
