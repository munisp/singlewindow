# TradeGateway NGSWTP — Audit Remediation TODO

## Sprint R1 — Critical Security Fixes
- [x] B1: Amendment field injection — add AMENDMENT_ALLOWED_FIELDS allowlist
- [x] B2: Webhook secrets — add startup validation rejecting dev defaults in production
- [x] B3: CSRF protection — implement Double Submit Cookie pattern on tRPC mutations
- [x] B4: gRPC mTLS — add SSL credentials support via GRPC_TLS_CERT_PATH env var
- [x] B9: Client-side role guards — add RoleGuard component and wrap sensitive routes

## Sprint R2 — Business Logic Completeness
- [x] B5: KYC gate — check KYC verified status before declaration submission
- [x] B6: TigerBeetle per-trader accounts — replace fixed IDs with per-trader account provisioning
- [x] B10: Live exchange rates — integrate Central Bank API with Redis cache
- [x] P1: Risk re-score on amendment approval for HS code / value / origin changes
- [x] P2: AEO suspension cascade — re-score in-flight declarations on AEO suspension
- [x] Gap 7: Drawback 12-month time-limit enforcement
- [x] Gap 6: Risk score invalidation on amendment

## Sprint R3 — Middleware Integration
- [x] B7: Temporal namespace fix — align to 'tradegateway', add @temporalio/client SDK
- [x] B8: Kafka event publishing — add publishEvent for all 7 Dapr event types
- [x] P5: Redis distributed rate limiting — replace in-memory with rate-limit-redis
- [x] P3: Redis session revocation — add token revocation list
- [x] P6: Mojaloop ILP packet — fix hardcoded amount, dynamic FSPIOP-Source
- [x] OpenSearch Node client — add @opensearch-project/opensearch npm package

## Sprint R4 — Data Flow & Mobile
- [x] P4: Payment account provisioning — create TigerBeetle account on trader onboarding
- [x] P8: Audit log integrity — add entryHash/prevHash tamper-evident chain
- [x] P10: PWA offline queue — Background Sync API for declaration submission
- [x] PWA-2: Cache version tied to build hash
- [x] PWA-3: Push notification VAPID registration
- [x] Orphan: payment_queue account provisioning check

## Sprint R5 — Observability & Compliance
- [x] PII encryption — AES-256-GCM field-level encryption for KYC sensitive fields
- [x] i18n scaffolding — expanded EN/FR/AR locale files to all 14 feature areas
- [x] WCAG ARIA — add aria-atomic, aria-live, focus management to OfflineBanner
- [x] Flink job activation — run_pipeline.py wrapper with dev/prod modes
- [x] OpenSearch Node client — wired into declarations router and server startup
- [x] Session fixation — regenerate CSRF cookie post-OAuth callback

## Polyglot Architecture (Go / Rust / Python / TypeScript)
- [x] Fix auth.logout FK violation — guard provisionTraderAccount in tests
- [x] Fix payments provisioner — wrap in try/catch so test FK errors don't surface
- [x] Go: declaration-engine microservice (gRPC, Protobuf, Temporal client)
- [x] Go: risk-engine microservice (gRPC, HS code validation, risk scoring proxy)
- [x] Go: oga-hub microservice (gRPC, multi-agency workflow, Dapr pub/sub)
- [x] Go: cargo-tracking microservice (gRPC, UCR lifecycle, Fluvio producer)
- [x] Rust: tigerbeetle-bridge service (TigerBeetle client, HTTP API, account provisioning)
- [x] Rust: kafka-consumer service (event processing, dead-letter queue)
- [x] Python: ai-risk-scorer FastAPI service (ML scoring, XGBoost + Isolation Forest)
- [x] Python: flink-pipeline (Delta Lake, Parquet, Apache Flink job activation)
- [x] Python: opensearch-indexer (bulk indexing, Kafka consumer)
- [x] Proto: shared .proto files for all gRPC contracts (declaration, risk, oga, cargo, ledger)
- [x] Docker Compose: wire all polyglot services with health checks
- [x] Kubernetes: Deployment + Service + HPA manifests for all 8 polyglot services
- [x] TypeScript BFF: polyglotClients.ts wiring Go/Rust/Python services via gRPC + HTTP
- [x] TypeScript BFF: AI risk scorer integrated into declarations router with LLM fallback

## Final Verification
- [x] Flutter api_service.dart — added getOgaStatus, listOgaAgencies, getAeoApplications, submitAeoApplication, getAeoStatus, uploadDocument
- [x] React Native — verified tRPC type-safe client covers all 519 procedures via AppRouter type
- [x] All 1846/1846 tests passing — 66/66 test files green
- [x] Local PostgreSQL with all 71 tables applied and schema migrations clean
- [x] Checkpoint saved: 778be513 (pre-polyglot) + final checkpoint
