/**
 * TradeGateway™ NGSWTP — Prometheus Metrics Registry
 *
 * Central registry for all application-level metrics.
 * Exposes a /metrics HTTP endpoint consumed by Prometheus scrape jobs.
 *
 * Naming convention: tradegateway_<subsystem>_<metric>_<unit>
 * Ref: https://prometheus.io/docs/practices/naming/
 */

import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from "prom-client";

// ─── Singleton registry ───────────────────────────────────────────────────────
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (event loop lag, heap, GC, etc.)
collectDefaultMetrics({ register: metricsRegistry, prefix: "tradegateway_node_" });

// ─── Declarations ─────────────────────────────────────────────────────────────
export const declarationsTotal = new Counter({
  name: "tradegateway_declarations_submitted_total",
  help: "Total number of trade declarations submitted",
  labelNames: ["status", "lane", "declaration_type"] as const,
  registers: [metricsRegistry],
});

export const declarationClearanceSeconds = new Histogram({
  name: "tradegateway_declaration_clearance_duration_seconds",
  help: "Time from declaration submission to clearance decision",
  labelNames: ["lane", "declaration_type"] as const,
  buckets: [60, 300, 900, 1800, 3600, 14400, 86400],
  registers: [metricsRegistry],
});

export const declarationsInFlight = new Gauge({
  name: "tradegateway_declarations_in_flight",
  help: "Number of declarations currently awaiting clearance",
  labelNames: ["lane"] as const,
  registers: [metricsRegistry],
});

export const greenLaneRate = new Gauge({
  name: "tradegateway_green_lane_rate_ratio",
  help: "Fraction of declarations assigned green lane (0–1)",
  registers: [metricsRegistry],
});

// ─── Payments / Mojaloop ──────────────────────────────────────────────────────
export const paymentsTotal = new Counter({
  name: "tradegateway_payments_total",
  help: "Total number of payment transactions",
  labelNames: ["status", "channel"] as const,
  registers: [metricsRegistry],
});

export const paymentAmountNaira = new Counter({
  name: "tradegateway_payment_amount_naira_total",
  help: "Cumulative duty revenue collected in NGN",
  labelNames: ["channel"] as const,
  registers: [metricsRegistry],
});

export const paymentDurationSeconds = new Histogram({
  name: "tradegateway_payment_duration_seconds",
  help: "End-to-end payment processing latency",
  labelNames: ["channel", "status"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

// ─── Risk Engine ──────────────────────────────────────────────────────────────
export const riskScoringTotal = new Counter({
  name: "tradegateway_risk_scoring_total",
  help: "Total number of risk scoring evaluations",
  labelNames: ["lane", "model_version"] as const,
  registers: [metricsRegistry],
});

export const riskScoringDurationSeconds = new Histogram({
  name: "tradegateway_risk_scoring_duration_seconds",
  help: "Risk scoring model inference latency",
  labelNames: ["model_version"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [metricsRegistry],
});

// ─── OGA Integrations ─────────────────────────────────────────────────────────
export const ogaRequestsTotal = new Counter({
  name: "tradegateway_oga_requests_total",
  help: "Total outbound OGA permit/LPCO requests",
  labelNames: ["oga_code", "request_type", "status"] as const,
  registers: [metricsRegistry],
});

export const ogaResponseSeconds = new Histogram({
  name: "tradegateway_oga_response_duration_seconds",
  help: "OGA API response latency",
  labelNames: ["oga_code", "request_type"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});

// ─── ASEAN Single Window ──────────────────────────────────────────────────────
export const aseanSwMessagesTotal = new Counter({
  name: "tradegateway_asean_sw_messages_total",
  help: "Total ASEAN Single Window cross-border messages",
  labelNames: ["direction", "message_type", "partner_country", "status"] as const,
  registers: [metricsRegistry],
});

export const aseanSwLatencySeconds = new Histogram({
  name: "tradegateway_asean_sw_latency_seconds",
  help: "ASEAN SW message round-trip latency",
  labelNames: ["partner_country", "message_type"] as const,
  buckets: [0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

// ─── WCO CEN ─────────────────────────────────────────────────────────────────
export const cenMessagesTotal = new Counter({
  name: "tradegateway_cen_messages_total",
  help: "Total WCO CEN intelligence messages exchanged",
  labelNames: ["direction", "message_type", "status"] as const,
  registers: [metricsRegistry],
});

// ─── Cargo Tracking ───────────────────────────────────────────────────────────
export const cargoEventsTotal = new Counter({
  name: "tradegateway_cargo_events_total",
  help: "Total cargo tracking events processed",
  labelNames: ["event_type", "transport_mode"] as const,
  registers: [metricsRegistry],
});

export const activeShipments = new Gauge({
  name: "tradegateway_active_shipments",
  help: "Number of shipments currently in transit",
  labelNames: ["transport_mode"] as const,
  registers: [metricsRegistry],
});

// ─── Document Vault ───────────────────────────────────────────────────────────
export const documentUploadsTotal = new Counter({
  name: "tradegateway_document_uploads_total",
  help: "Total documents uploaded to the vault",
  labelNames: ["document_type", "status"] as const,
  registers: [metricsRegistry],
});

export const documentSizeBytes = new Histogram({
  name: "tradegateway_document_size_bytes",
  help: "Distribution of uploaded document sizes",
  labelNames: ["document_type"] as const,
  buckets: [10_000, 100_000, 500_000, 1_000_000, 5_000_000, 16_000_000],
  registers: [metricsRegistry],
});

// ─── KYC / Trader Onboarding ──────────────────────────────────────────────────
export const kycVerificationsTotal = new Counter({
  name: "tradegateway_kyc_verifications_total",
  help: "Total KYC verification attempts",
  labelNames: ["verification_type", "status"] as const,
  registers: [metricsRegistry],
});

export const traderRegistrationsTotal = new Counter({
  name: "tradegateway_trader_registrations_total",
  help: "Total trader registrations submitted",
  labelNames: ["entity_type", "status"] as const,
  registers: [metricsRegistry],
});

// ─── AEO Programme ────────────────────────────────────────────────────────────
export const aeoApplicationsTotal = new Counter({
  name: "tradegateway_aeo_applications_total",
  help: "Total AEO programme applications",
  labelNames: ["status", "aeo_tier"] as const,
  registers: [metricsRegistry],
});

export const aeoActiveCount = new Gauge({
  name: "tradegateway_aeo_active_traders",
  help: "Number of currently active AEO-certified traders",
  labelNames: ["aeo_tier"] as const,
  registers: [metricsRegistry],
});

// ─── Post-Clearance Audit ─────────────────────────────────────────────────────
export const auditCasesTotal = new Counter({
  name: "tradegateway_post_audit_cases_total",
  help: "Total post-clearance audit cases opened",
  labelNames: ["audit_type", "status"] as const,
  registers: [metricsRegistry],
});

export const auditDurationDays = new Histogram({
  name: "tradegateway_post_audit_duration_days",
  help: "Post-clearance audit case resolution time in days",
  labelNames: ["audit_type"] as const,
  buckets: [1, 3, 7, 14, 30, 60, 90],
  registers: [metricsRegistry],
});

// ─── Bonded Warehouse / Free Zone ─────────────────────────────────────────────
export const warehouseOperationsTotal = new Counter({
  name: "tradegateway_warehouse_operations_total",
  help: "Total bonded warehouse operations (in/out/transfer)",
  labelNames: ["operation_type", "warehouse_id"] as const,
  registers: [metricsRegistry],
});

export const freeZoneTransactionsTotal = new Counter({
  name: "tradegateway_free_zone_transactions_total",
  help: "Total free zone transactions processed",
  labelNames: ["transaction_type", "zone_id"] as const,
  registers: [metricsRegistry],
});

// ─── Security / SOC ───────────────────────────────────────────────────────────
export const securityAlertsTotal = new Counter({
  name: "tradegateway_security_alerts_total",
  help: "Total security alerts generated",
  labelNames: ["severity", "alert_type", "source"] as const,
  registers: [metricsRegistry],
});

export const openSecurityIncidents = new Gauge({
  name: "tradegateway_open_security_incidents",
  help: "Number of currently open security incidents",
  labelNames: ["severity"] as const,
  registers: [metricsRegistry],
});

export const wazuhAlertsTotal = new Counter({
  name: "tradegateway_wazuh_alerts_total",
  help: "Total Wazuh SIEM alerts ingested",
  labelNames: ["rule_level", "agent_name"] as const,
  registers: [metricsRegistry],
});

export const threatIntelMatchesTotal = new Counter({
  name: "tradegateway_threat_intel_matches_total",
  help: "Total threat intelligence indicator matches",
  labelNames: ["threat_type", "severity"] as const,
  registers: [metricsRegistry],
});

// ─── Temporal Workflows ───────────────────────────────────────────────────────
export const workflowStartsTotal = new Counter({
  name: "tradegateway_workflow_starts_total",
  help: "Total Temporal workflow executions started",
  labelNames: ["workflow_type"] as const,
  registers: [metricsRegistry],
});

export const workflowCompletionsTotal = new Counter({
  name: "tradegateway_workflow_completions_total",
  help: "Total Temporal workflow executions completed",
  labelNames: ["workflow_type", "status"] as const,
  registers: [metricsRegistry],
});

export const workflowDurationSeconds = new Histogram({
  name: "tradegateway_workflow_duration_seconds",
  help: "Temporal workflow end-to-end execution time",
  labelNames: ["workflow_type"] as const,
  buckets: [1, 5, 30, 300, 1800, 14400, 86400],
  registers: [metricsRegistry],
});

// ─── Kafka / Event Bus ────────────────────────────────────────────────────────
export const kafkaMessagesProducedTotal = new Counter({
  name: "tradegateway_kafka_messages_produced_total",
  help: "Total Kafka messages produced",
  labelNames: ["topic"] as const,
  registers: [metricsRegistry],
});

export const kafkaMessagesConsumedTotal = new Counter({
  name: "tradegateway_kafka_messages_consumed_total",
  help: "Total Kafka messages consumed",
  labelNames: ["topic", "consumer_group"] as const,
  registers: [metricsRegistry],
});

// ─── API Gateway / tRPC ───────────────────────────────────────────────────────
export const trpcRequestsTotal = new Counter({
  name: "tradegateway_trpc_requests_total",
  help: "Total tRPC procedure calls",
  labelNames: ["procedure", "type", "status"] as const,
  registers: [metricsRegistry],
});

export const trpcRequestDurationSeconds = new Histogram({
  name: "tradegateway_trpc_request_duration_seconds",
  help: "tRPC procedure call latency",
  labelNames: ["procedure", "type"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ─── Nigeria ID (NIMC NIN) ────────────────────────────────────────────────────
export const ninVerificationsTotal = new Counter({
  name: "tradegateway_nin_verifications_total",
  help: "Total NIMC NIN verification attempts",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

// ─── Trader Scorecard ─────────────────────────────────────────────────────────
export const scorecardGenerationsTotal = new Counter({
  name: "tradegateway_scorecard_generations_total",
  help: "Total trader scorecard generation requests",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

// ─── Executive Dashboard ──────────────────────────────────────────────────────
export const dashboardQueriesTotal = new Counter({
  name: "tradegateway_dashboard_queries_total",
  help: "Total executive dashboard data queries",
  labelNames: ["query_type", "role"] as const,
  registers: [metricsRegistry],
});

// ─── Duty Drawback ────────────────────────────────────────────────────────────
export const drawbackClaimsTotal = new Counter({
  name: "tradegateway_drawback_claims_total",
  help: "Total duty drawback claims submitted",
  labelNames: ["status"] as const,
  registers: [metricsRegistry],
});

export const drawbackAmountNaira = new Counter({
  name: "tradegateway_drawback_amount_naira_total",
  help: "Total duty drawback amount approved in NGN",
  registers: [metricsRegistry],
});

// ─── Bulk Export ──────────────────────────────────────────────────────────────
export const bulkExportsTotal = new Counter({
  name: "tradegateway_bulk_exports_total",
  help: "Total bulk data export jobs",
  labelNames: ["export_type", "status"] as const,
  registers: [metricsRegistry],
});

export const bulkExportRowsTotal = new Counter({
  name: "tradegateway_bulk_export_rows_total",
  help: "Total rows exported in bulk export jobs",
  labelNames: ["export_type"] as const,
  registers: [metricsRegistry],
});

// ─── SLA Escalation ───────────────────────────────────────────────────────────
export const slaBreachesTotal = new Counter({
  name: "tradegateway_sla_breaches_total",
  help: "Total SLA breaches detected",
  labelNames: ["sla_type", "severity"] as const,
  registers: [metricsRegistry],
});

export const slaEscalationsTotal = new Counter({
  name: "tradegateway_sla_escalations_total",
  help: "Total SLA escalation notifications sent",
  labelNames: ["escalation_level"] as const,
  registers: [metricsRegistry],
});

// ─── Port Congestion ──────────────────────────────────────────────────────────
export const portCongestionLevel = new Gauge({
  name: "tradegateway_port_congestion_level",
  help: "Current port congestion level (0=clear, 1=moderate, 2=severe)",
  labelNames: ["port_code"] as const,
  registers: [metricsRegistry],
});

// ─── CEP (Complex Event Processing) ──────────────────────────────────────────
export const cepEventsProcessedTotal = new Counter({
  name: "tradegateway_cep_events_processed_total",
  help: "Total complex events processed by CEP engine",
  labelNames: ["event_type", "pattern_matched"] as const,
  registers: [metricsRegistry],
});

// ─── Geospatial ───────────────────────────────────────────────────────────────
export const geofenceTriggersTotal = new Counter({
  name: "tradegateway_geofence_triggers_total",
  help: "Total geofence entry/exit events triggered",
  labelNames: ["geofence_type", "direction"] as const,
  registers: [metricsRegistry],
});

// ─── Ledger / TigerBeetle ─────────────────────────────────────────────────────
export const ledgerTransfersTotal = new Counter({
  name: "tradegateway_ledger_transfers_total",
  help: "Total double-entry ledger transfers posted",
  labelNames: ["transfer_type", "status"] as const,
  registers: [metricsRegistry],
});

export const ledgerTransferAmountNaira = new Counter({
  name: "tradegateway_ledger_transfer_amount_naira_total",
  help: "Total amount transferred through the ledger in NGN",
  labelNames: ["transfer_type"] as const,
  registers: [metricsRegistry],
});

// ─── Webhooks ─────────────────────────────────────────────────────────────────
export const webhookDeliveriesTotal = new Counter({
  name: "tradegateway_webhook_deliveries_total",
  help: "Total webhook delivery attempts",
  labelNames: ["event_type", "status"] as const,
  registers: [metricsRegistry],
});

export const webhookDeliveryDurationSeconds = new Histogram({
  name: "tradegateway_webhook_delivery_duration_seconds",
  help: "Webhook delivery HTTP round-trip latency",
  labelNames: ["event_type"] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

/** SW-O2: privileged-action audit append failures — must never be silent. */
export const auditAppendFailuresTotal = new Counter({
  name: "tradegateway_audit_append_failures_total",
  help: "Privileged-action audit append failures (insiderThreat). Any increment is an incident.",
  labelNames: ["event_type"] as const,
  registers: [metricsRegistry],
});
