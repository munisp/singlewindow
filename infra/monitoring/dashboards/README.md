# Grafana Dashboards

The production Grafana dashboard JSON files are located at:
  `infra/monitoring/grafana/dashboards/`

Files:
- `01-overview.json` — Platform overview (declarations/min, clearance times, error rates)
- `02-payments.json` — Mojaloop payment flows and TigerBeetle ledger metrics
- `03-declarations.json` — Declaration lifecycle funnel and lane distribution
- `04-services.json` — Per-microservice latency, error rate, and saturation (RED method)
- `05-kafka.json` — Kafka consumer lag, throughput, and partition health

## Import Instructions
1. Open Grafana at https://grafana.tradegateway.internal
2. Go to Dashboards → Import
3. Upload each JSON file from `infra/monitoring/grafana/dashboards/`
4. Select the Prometheus datasource when prompted
