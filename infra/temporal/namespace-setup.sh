#!/bin/bash
# Initialize Temporal namespace for TradeGateway
# Run once after Temporal server is up

TEMPORAL_HOST="${TEMPORAL_HOST:-temporal-frontend.tradegateway.svc.cluster.local:7233}"

echo "Creating TradeGateway Temporal namespace..."
temporal operator namespace create \
  --address "$TEMPORAL_HOST" \
  --namespace tradegateway \
  --retention 30d \
  --description "TradeGateway NGSWTP declaration clearance workflows"

echo "Registering search attributes..."
temporal operator search-attribute create \
  --address "$TEMPORAL_HOST" \
  --namespace tradegateway \
  --name DeclarationID --type Text \
  --name TraderID --type Text \
  --name RiskScore --type Double \
  --name ClearanceLane --type Keyword \
  --name OGAStatus --type Keyword \
  --name PaymentStatus --type Keyword

echo "Temporal namespace setup complete."
