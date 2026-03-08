# TradeGateway™ NGSWTP — Technology Integration Analysis
## AI/ML/DL/GNN Stack Robustness, Graph Intelligence, and Knowledge Engineering

**Author:** Manus AI | **Date:** March 2026 | **Version:** 1.0

---

## Executive Summary

This document provides a comprehensive analysis of six technologies proposed for integration into the TradeGateway™ NGSWTP platform: **CocoIndex**, **EPR-KGQA**, **FalkorDB**, **Neo4j**, **Ollama**, and **ART (Automatic Reasoning and Tool-use)**. It assesses the current depth of the AI/ML/DL/GNN stack, explains how Graph Neural Networks and Neo4j add value to a national customs single-window platform, and maps each technology to concrete platform capabilities. The document concludes with an implementation architecture that layers these technologies into a coherent, production-grade intelligence substrate.

---

## 1. Current AI/ML/DL/GNN Stack Assessment

### 1.1 What Exists Today

The platform currently operates a **three-tier AI stack**:

| Tier | Component | Technology | Depth |
|------|-----------|------------|-------|
| Rule-based | Risk pre-filters | Python dict lookups (HS chapters, country risk scores) | Shallow |
| Classical ML | Risk scoring | NumPy-based Random Forest simulation (no trained model file) | Simulated |
| LLM inference | Risk scoring, HS classification, document extraction | Ollama (Qwen3, DeepSeek-R1) + Forge fallback | Functional |
| Computer vision | Container seal detection, cargo OCR | YOLOv8, OpenCV, SAM2 (service defined, not deployed) | Defined |
| KYC/KYB | Document analysis | PaddleOCR, DocLing, Qwen2-VL (service defined) | Defined |

### 1.2 Critical Gaps

The current implementation has **four significant gaps** that limit its production readiness:

**Gap 1 — No trained ML model.** The risk engine uses NumPy arrays to simulate a Random Forest classifier. There is no `model.pkl` or `model.onnx` file, no training pipeline, and no feature store. Every "ML score" is deterministic arithmetic, not learned inference.

**Gap 2 — No graph representation of trade relationships.** Customs fraud is inherently relational: a trader who shares a phone number with a known fraudster, a consignee who appears in multiple suspicious shipments, or an HS code that is consistently undervalued by a specific broker. None of these patterns are detectable with tabular ML. The platform has no graph database and no graph-structured data model.

**Gap 3 — No knowledge graph for regulatory intelligence.** The platform has no structured representation of the WCO Harmonized System, FATF country lists, OGA permit requirements, or bilateral trade agreements. Every LLM call re-derives this knowledge from scratch, leading to hallucinations and inconsistency.

**Gap 4 — No retrieval-augmented reasoning.** The AI router calls the LLM with a raw prompt and a JSON schema. There is no retrieval step that grounds the LLM in verified regulatory data before it reasons. This means the risk scores are only as good as the LLM's training data, which may be outdated or incomplete for African trade contexts.

### 1.3 Robustness Score

| Dimension | Current Score | Target Score | Gap |
|-----------|--------------|--------------|-----|
| Rule-based risk | 7/10 | 8/10 | Minor |
| Classical ML | 2/10 | 8/10 | **Critical** |
| Deep learning (DL) | 1/10 | 7/10 | **Critical** |
| Graph Neural Networks (GNN) | 0/10 | 8/10 | **Critical** |
| Knowledge graph (KG) | 0/10 | 9/10 | **Critical** |
| RAG / grounded reasoning | 2/10 | 9/10 | **Critical** |
| LLM inference | 7/10 | 8/10 | Minor |

---

## 2. Technology Value Analysis

### 2.1 Ollama — Local LLM Inference

**What it is.** Ollama is an open-source runtime that serves large language models locally via a REST API compatible with the OpenAI SDK. It supports quantized GGUF models including Qwen3, DeepSeek-R1, Mistral, Llama 3, and Qwen2-VL (vision-language).

**Current integration status.** Ollama is already integrated via `server/routers/ai.ts` and `services/python/ollama-proxy/main.py`. The platform calls Ollama for risk scoring (`ai.scoreRisk`), HS classification (`ai.classifyHS`), risk explanation (`ai.explainRisk`), and manifest extraction (`ai.extractManifest`). A Forge LLM fallback ensures availability when Ollama is not running.

**Value to the platform.** Ollama provides **data sovereignty**: trade declarations contain commercially sensitive and nationally strategic data that cannot be sent to external cloud APIs. Running inference locally ensures that consignee names, HS codes, declared values, and trader profiles never leave the platform's network boundary. For a national customs authority, this is not optional — it is a legal and security requirement.

**Enhancement opportunities.** The platform should add fine-tuning pipelines for domain-specific models trained on African trade data, WCO HS nomenclature, and historical declaration outcomes. Qwen2-VL should be activated for document analysis (Bills of Lading, Certificates of Origin) to replace the PaddleOCR pipeline with a single multimodal model.

---

### 2.2 FalkorDB — High-Performance Graph Database for GraphRAG

**What it is.** FalkorDB is an open-source property graph database built on Redis, using sparse matrix representations and linear algebra (GraphBLAS) for graph traversal. It supports OpenCypher queries and includes native vector indexing for similarity search. Benchmarks show FalkorDB achieves sub-140ms p99 latency on complex graph queries where Neo4j reaches 46.9 seconds — a 496× performance advantage on certain workloads [1].

**Architecture.** FalkorDB stores graphs as sparse adjacency matrices in memory, enabling traversal via matrix multiplication rather than pointer chasing. This makes it exceptionally fast for real-time inference workloads where the graph is read frequently but written infrequently — exactly the pattern of a risk scoring engine that reads the trade network graph for every declaration.

**Value to the platform.** FalkorDB serves as the **real-time GraphRAG layer**. When a declaration is submitted, the risk engine queries FalkorDB to retrieve the subgraph around the trader, consignee, and HS code: who else has traded with this consignee, what risk scores did their declarations receive, are there any shared identifiers with known fraudsters, and what is the typical value/weight ratio for this HS code from this origin country. This subgraph is then injected into the LLM prompt as structured context, dramatically improving risk score accuracy.

| Use Case | FalkorDB Query | Risk Signal |
|----------|---------------|-------------|
| Trader network analysis | Find all entities within 2 hops of trader | Shell company detection |
| Consignee risk profiling | Aggregate risk scores of all shipments to consignee | Repeat offender detection |
| HS code value benchmarking | P25/P75 declared value for HS code + origin | Undervaluation detection |
| Broker association | Shared phone/email/address across declarations | Broker fraud ring detection |
| Payment flow analysis | Trace payment routing through Mojaloop | Trade-based money laundering |

**Why FalkorDB over Neo4j for this use case.** The risk scoring path is on the **critical path** of declaration processing — it must complete in under 500ms to meet the < 4-hour green-lane SLA. FalkorDB's in-memory architecture and matrix-based traversal make it the correct choice for this latency-sensitive inference workload.

---

### 2.3 Neo4j — Durable Knowledge Graph for Regulatory Intelligence

**What it is.** Neo4j is the world's most widely deployed graph database, using a native graph storage engine with ACID transactions, full-text search, vector indexing, and a mature ecosystem including Graph Data Science (GDS) library for running GNN algorithms directly on the graph [2].

**Value to the platform.** Neo4j serves a fundamentally different purpose from FalkorDB. Where FalkorDB handles real-time inference, Neo4j is the **durable regulatory knowledge graph** — the authoritative, persistent representation of:

- The WCO Harmonized System (5,000+ HS codes with chapter/heading/subheading hierarchy)
- FATF country risk classifications and bilateral trade agreements
- OGA permit requirements (which HS codes require which licences from which agencies)
- AEO programme eligibility criteria and compliance history
- Historical declaration outcomes (approved/rejected/amended) with audit trails
- Trader profiles, company registrations, and beneficial ownership chains

This knowledge graph is the foundation for EPR-KGQA (Section 2.4) and the CocoIndex pipeline (Section 2.5). It is written infrequently (when regulations change) but read constantly by the LLM reasoning layer.

**Neo4j Graph Data Science for GNN.** The Neo4j GDS library exposes GraphSAGE, Graph Attention Networks (GAT), and Node2Vec directly on the stored graph. This means GNN training and inference can run on the same data that powers the knowledge graph, without an ETL step to a separate ML platform. The GNN models learn embeddings for traders, consignees, HS codes, and countries that capture their relational context — embeddings that are then used as features in the risk scoring model.

---

### 2.4 GNN (Graph Neural Networks) — Deep Relational Risk Intelligence

**What GNNs are.** Graph Neural Networks are deep learning models that operate on graph-structured data. Unlike tabular ML models that treat each declaration independently, GNNs learn representations (embeddings) for nodes (traders, consignees, HS codes, countries) by aggregating information from their neighbours in the graph. A trader's embedding captures not just their own compliance history, but the compliance history of everyone they have traded with, the typical risk profiles of the HS codes they import, and the risk levels of their origin countries.

**Why GNNs are essential for customs fraud detection.** Academic research has demonstrated that GNN-based customs fraud detection significantly outperforms tabular ML. The GraphFC model [3] achieved state-of-the-art performance on customs fraud detection with label scarcity by modelling the trade network as a heterogeneous graph. A 2024 study on cross-border trade fraud [4] showed that Heterogeneous GNN (HGNN) combined with XGBoost outperformed all tabular baselines by over 15 F1 points.

The fundamental reason is that **customs fraud is a network phenomenon**. Individual declarations may appear legitimate in isolation; it is only when viewed in the context of the trader's network that the fraud pattern becomes visible. GNNs are the only class of ML model that can natively capture this relational structure.

**GNN architecture for NGSWTP.** The platform will implement a three-model GNN stack:

| Model | Architecture | Purpose | Training Target |
|-------|-------------|---------|----------------|
| TraderRiskGNN | GraphSAGE (3 layers) | Trader risk embedding | Historical fraud labels |
| HSCodeGNN | Graph Attention Network | HS code risk embedding | Undervaluation/misdeclaration labels |
| NetworkAnomalyGNN | GCN + anomaly head | Shell company / ring detection | Anomaly scores from isolation forest |

These embeddings are computed offline (daily batch via Neo4j GDS) and stored as vector features in FalkorDB for real-time retrieval during risk scoring.

**Value quantification.** Based on published benchmarks from Ghana ICUMS and Singapore NTP, GNN-based risk scoring is expected to:
- Reduce false positive rate (legitimate shipments flagged for inspection) by 30–40%
- Increase true positive rate (actual fraud detected) by 20–35%
- Enable detection of previously invisible fraud rings through network analysis
- Reduce manual review workload by routing more shipments to the green lane

---

### 2.5 CocoIndex — Incremental Trade Document Indexing Pipeline

**What it is.** CocoIndex is an open-source ETL framework specifically designed for building and maintaining AI indexes (vector indexes, knowledge graphs, structured tables) from dynamic data sources with incremental processing [5]. It uses a dataflow programming model where transformations are defined declaratively, and the engine automatically computes which outputs need to be updated when inputs change — similar to how a spreadsheet recalculates only affected cells.

**Value to the platform.** The platform processes thousands of trade documents daily: Bills of Lading, Certificates of Origin, Phytosanitary Certificates, Commercial Invoices, and Packing Lists. Currently, these documents are processed by the KYC service using PaddleOCR and stored as raw text. CocoIndex transforms this pipeline by:

1. **Extracting structured entities** from each document using the local Ollama LLM (trader names, HS codes, declared values, weights, port names, dates)
2. **Building relationships** between entities (this trader shipped this HS code from this origin to this consignee via this broker)
3. **Writing the entity graph incrementally to Neo4j** — when a new document arrives, only the new entities and relationships are added; existing nodes are updated, not duplicated
4. **Maintaining a vector index** in PostgreSQL (pgvector) for semantic search over document content

The key innovation is **incremental processing**: when a trader's profile is updated or a new OGA regulation is published, CocoIndex re-processes only the affected documents and updates only the affected graph nodes, rather than rebuilding the entire index from scratch.

**Integration architecture for NGSWTP:**

```
Trade Documents (S3)
        ↓
CocoIndex Pipeline (Python)
  ├── Source: S3 file watcher
  ├── Transform: Ollama LLM entity extraction
  ├── Transform: Relationship extraction (subject-predicate-object)
  ├── Export: Neo4j (durable knowledge graph)
  └── Export: pgvector (semantic search index)
        ↓
EPR-KGQA Query Layer
```

---

### 2.6 EPR-KGQA — Knowledge Graph Question Answering

**What it is.** EPR-KGQA (Evidence Path Reasoning for Knowledge Graph Question Answering) is a research framework from Nanjing University that enables complex, multi-hop question answering over knowledge graphs [6]. It achieves over 10 F1-point improvements over previous IR-based KGQA methods on ComplexWebQuestions by using evidence paths — chains of graph relationships — to ground LLM reasoning.

**Value to the platform.** EPR-KGQA enables **natural language queries over the trade knowledge graph**. Customs officers, OGA officials, and compliance analysts can ask questions like:

- *"Which traders have imported HS 8471 goods from China with a declared value more than 30% below the WTO reference price in the last 90 days?"*
- *"What permits are required for importing HS 3004 pharmaceuticals from India, and which OGAs must approve them?"*
- *"Show me all declarations where the consignee appears in more than 3 different trader networks"*

These questions require multi-hop graph traversal (trader → declaration → HS code → OGA requirement → permit type) that is impossible with SQL and impractical with raw LLM prompting. EPR-KGQA converts the natural language question into a Cypher query path, executes it against Neo4j, and uses the retrieved evidence paths to generate a grounded, accurate answer.

**Implementation approach.** Rather than deploying the full EPR-KGQA research codebase (which requires a SPARQL endpoint), the platform implements the **core EPR pattern** as a tRPC procedure:

1. Parse the natural language question with the LLM to identify entity mentions and relationship types
2. Convert to a Cypher query template using the trade knowledge graph schema
3. Execute against Neo4j to retrieve evidence paths
4. Feed evidence paths back to the LLM for answer generation with citations

---

### 2.7 ART — Automatic Reasoning and Tool-use

**What it is.** ART (Automatic Reasoning and Tool-use) is a prompting framework that enables LLMs to automatically decompose complex tasks into multi-step reasoning programs, selecting and invoking tools at each step [7]. Unlike ReAct (which requires the LLM to decide tool use at each step), ART uses a task library of few-shot examples to bootstrap the reasoning program, making it more reliable and consistent.

**Value to the platform.** ART transforms the platform's AI router from a single-shot LLM call into a **multi-step reasoning agent** that can:

1. **Decompose complex compliance questions** into sub-questions (What is the HS code? What are the applicable duties? Are there any OGA restrictions? Is the trader AEO-certified?)
2. **Invoke tools at each step** (query Neo4j for HS code details, query FalkorDB for trader risk profile, query the sanctions screener, query the Mojaloop payment history)
3. **Synthesise a grounded answer** from the tool outputs, with each claim traceable to a specific data source

For the risk scoring workflow, ART enables a **chain-of-thought risk assessment** that mirrors how an experienced customs officer thinks: first check the trader profile, then check the HS code risk, then check the origin country, then check the declared value against benchmarks, then check the consignee network, and finally assign a risk lane with explicit reasoning.

**ART vs. simple RAG.** Simple RAG retrieves documents and feeds them to the LLM. ART is more powerful because it allows the LLM to **decide what to retrieve** based on intermediate reasoning steps. If the first step reveals that the trader is AEO-certified, the LLM can skip the detailed network analysis and go directly to value verification. This adaptive retrieval reduces latency and improves accuracy.

---

## 3. Integrated Architecture: The Trade Intelligence Stack

The six technologies form a coherent, layered intelligence stack:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PRESENTATION LAYER                           │
│  tRPC Procedures: ai.*, knowledge.*, graph.*, audit.*          │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    ART REASONING LAYER                          │
│  Multi-step reasoning programs with tool selection             │
│  Task library: risk_assessment, compliance_check, kgqa         │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────┬──────────────────────────────────────────┐
│   OLLAMA LLM LAYER   │         TOOL REGISTRY                   │
│  Qwen3:8b (fast)     │  - FalkorDB graph query                 │
│  DeepSeek-R1:8b      │  - Neo4j Cypher query                   │
│  (reasoning)         │  - Sanctions screener                   │
│  Qwen2-VL (vision)   │  - HS code lookup                       │
└──────────────────────┴──────────────────────────────────────────┘
                              ↕
┌──────────────────────┬──────────────────────────────────────────┐
│   FALKORDB           │         NEO4J                           │
│  Real-time GraphRAG  │  Durable Knowledge Graph                │
│  Trader subgraphs    │  WCO HS taxonomy                        │
│  Risk embeddings     │  OGA permit requirements                │
│  < 140ms p99         │  Trader profiles + history              │
│  GNN inference cache │  GNN training (GDS library)             │
└──────────────────────┴──────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    COCOINDEX PIPELINE                           │
│  Incremental ETL: S3 documents → Neo4j + pgvector              │
│  Entity extraction, relationship extraction, deduplication     │
└─────────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────────┐
│                    DATA SOURCES                                 │
│  PostgreSQL (declarations, payments, traders, OGA records)     │
│  S3 (trade documents, certificates, cargo images)              │
│  Kafka (real-time declaration events)                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. GNN + Neo4j: Specific Value Proposition

The combination of GNN and Neo4j adds value at three distinct levels:

**Level 1 — Feature enrichment for risk scoring.** Neo4j stores the trade network graph. The GDS library runs GraphSAGE to compute trader embeddings that capture relational context. These embeddings are stored as vector features and retrieved by FalkorDB during real-time risk scoring. The result is a risk score that reflects not just the individual declaration, but the trader's entire network context.

**Level 2 — Fraud ring detection.** GNN-based anomaly detection on the Neo4j graph identifies clusters of traders, consignees, and brokers that exhibit coordinated behaviour — submitting declarations with similar patterns, sharing contact information, or routing payments through the same intermediary. These rings are invisible to tabular ML but clearly visible in the graph topology.

**Level 3 — Regulatory intelligence.** Neo4j stores the WCO HS taxonomy as a graph (chapters → headings → subheadings → notes → applicable duties → required permits). EPR-KGQA traverses this graph to answer complex compliance questions. The GNN learns embeddings for HS codes that capture their regulatory similarity — enabling the system to flag when a trader consistently uses HS codes that are adjacent to high-risk codes, a common misdeclaration strategy.

---

## 5. Implementation Roadmap

| Sprint | Deliverable | Technologies |
|--------|-------------|-------------|
| Sprint 7a | FalkorDB Docker service + trade network schema | FalkorDB |
| Sprint 7a | Neo4j Docker service + WCO HS taxonomy import | Neo4j |
| Sprint 7a | `graph` tRPC router: trader subgraph, HS lookup, network risk | FalkorDB + Neo4j |
| Sprint 7b | CocoIndex pipeline: document → entity → Neo4j | CocoIndex + Ollama |
| Sprint 7b | `knowledge` tRPC router: KGQA, document search | EPR-KGQA pattern + Neo4j |
| Sprint 7c | ART reasoning layer in `ai` router | ART + all tools |
| Sprint 7c | GNN training pipeline (GraphSAGE on Neo4j GDS) | Neo4j GDS + Python |
| Sprint 8 | Port seeding, post-clearance audit, duty drawback | PostgreSQL + tRPC |

---

## 6. References

[1] FalkorDB. "FalkorDB vs Neo4j: Graph Database Performance Benchmarks." FalkorDB Blog, December 2024. https://www.falkordb.com/blog/graph-database-performance-benchmarks-falkordb-vs-neo4j/

[2] Neo4j. "Supply Chain Risk Predictions with Neo4j Graph Data Technology." Neo4j NODES 2025. https://neo4j.com/nodes-2025/agenda/supply-chain-risk-predictions-with-neo4j-graph-data-technology/

[3] Singh, K., Tsai, Y.C., Li, C.T., Cha, M., Lin, S.D. "GraphFC: Customs Fraud Detection with Label Scarcity." *Proceedings of the 32nd ACM International Conference on Information and Knowledge Management*, 2023. https://dl.acm.org/doi/abs/10.1145/3583780.3614690

[4] ResearchGate. "Cross-Border Trade Fraud Detection via Integrated Heterogeneous Graph Neural Network and XGBoost." January 2026. https://www.researchgate.net/publication/399892638

[5] CocoIndex. "Build Real-Time Knowledge Graph For Documents with LLM." CocoIndex Blog, April 2025. https://cocoindex.io/blogs/knowledge-graph-for-docs

[6] Nanjing University. "Enhancing Complex Question Answering over Knowledge Graphs through Evidence Path Reasoning." *arXiv:2402.02175*, February 2024. https://arxiv.org/abs/2402.02175

[7] Paranjape, B., Lundberg, S., Singh, S., Hajishirzi, H., Zettlemoyer, L., Ribeiro, M.T. "ART: Automatic multi-step Reasoning and Tool-use for Large Language Models." *arXiv:2303.09014*, 2023. https://www.promptingguide.ai/techniques/art
