#!/usr/bin/env bash
# ─── train_and_serve.sh ───────────────────────────────────────────────────────
# Full GNN training pipeline entrypoint for the python-ai Docker service.
#
# Stages:
#   1. Wait for FalkorDB and Neo4j to be ready
#   2. Seed the knowledge graph from PostgreSQL (if --seed flag passed)
#   3. Train the GraphSAGE model on historical declarations
#   4. Export model weights to /app/models/
#   5. Start the FastAPI inference server
#
# Usage (inside container):
#   ./train_and_serve.sh --seed          # seed + train + serve
#   ./train_and_serve.sh --train-only    # train + serve (no seed)
#   ./train_and_serve.sh                 # serve only (use existing weights)
#
# Usage (docker compose):
#   docker compose exec python-ai ./train_and_serve.sh --seed

set -euo pipefail

SEED=false
TRAIN_ONLY=false
MODEL_DIR="${MODEL_DIR:-/app/models}"
LOG_DIR="${LOG_DIR:-/app/logs}"
PORT="${PORT:-8099}"

# ── Parse flags ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --seed)       SEED=true ;;
    --train-only) TRAIN_ONLY=true ;;
    --help)
      echo "Usage: $0 [--seed] [--train-only]"
      echo "  --seed        Seed FalkorDB + Neo4j from PostgreSQL before training"
      echo "  --train-only  Train the GNN model without starting the API server"
      exit 0
      ;;
  esac
done

mkdir -p "$MODEL_DIR" "$LOG_DIR"

# ── Colour helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

# ── Wait for a TCP port ───────────────────────────────────────────────────────
wait_for() {
  local host="$1" port="$2" label="$3" retries="${4:-30}" delay="${5:-2}"
  info "Waiting for $label ($host:$port) …"
  for i in $(seq 1 "$retries"); do
    if python3 -c "import socket; s=socket.socket(); s.settimeout(2); s.connect(('$host',$port)); s.close()" 2>/dev/null; then
      info "$label is ready."
      return 0
    fi
    warn "  attempt $i/$retries — retrying in ${delay}s"
    sleep "$delay"
  done
  error "$label did not become ready after $((retries * delay))s. Continuing anyway."
  return 1
}

# ── Stage 1: Wait for dependencies ───────────────────────────────────────────
info "═══ Stage 1: Dependency health checks ═══"
FALKORDB_HOST="${FALKORDB_HOST:-localhost}"
FALKORDB_PORT="${FALKORDB_PORT:-6379}"
NEO4J_BOLT_HOST=$(echo "${NEO4J_URL:-bolt://localhost:7687}" | sed 's|bolt://||' | cut -d: -f1)
NEO4J_BOLT_PORT=$(echo "${NEO4J_URL:-bolt://localhost:7687}" | sed 's|bolt://||' | cut -d: -f2)

wait_for "$FALKORDB_HOST" "$FALKORDB_PORT" "FalkorDB" 30 2 || true
wait_for "$NEO4J_BOLT_HOST" "$NEO4J_BOLT_PORT" "Neo4j" 40 3 || true

# ── Stage 2: Seed the knowledge graph ────────────────────────────────────────
if [ "$SEED" = "true" ]; then
  info "═══ Stage 2: Seeding knowledge graph from PostgreSQL ═══"
  if [ -z "${DATABASE_URL:-}" ]; then
    error "DATABASE_URL is not set — cannot seed. Skipping."
  else
    python3 -m gnn.pg_to_graph_seeder \
      --db-url "$DATABASE_URL" \
      --falkordb-host "$FALKORDB_HOST" \
      --falkordb-port "$FALKORDB_PORT" \
      --neo4j-url "${NEO4J_URL:-bolt://localhost:7687}" \
      --neo4j-user "${NEO4J_USER:-neo4j}" \
      --neo4j-password "${NEO4J_PASSWORD:-ngswtp_neo4j_2026}" \
      2>&1 | tee "$LOG_DIR/seed_$(date +%Y%m%d_%H%M%S).log"
    info "Seeding complete."
  fi
else
  info "═══ Stage 2: Skipping seed (pass --seed to enable) ═══"
fi

# ── Stage 3: Train the GraphSAGE model ───────────────────────────────────────
info "═══ Stage 3: Training GraphSAGE risk model ═══"
WEIGHTS_FILE="$MODEL_DIR/graphsage_risk.pt"

if [ -f "$WEIGHTS_FILE" ] && [ "$SEED" = "false" ]; then
  info "Existing model weights found at $WEIGHTS_FILE — skipping training."
  info "Pass --seed to force a full retrain after re-seeding."
else
  info "Starting GraphSAGE training …"
  python3 -m gnn.gnn_trainer \
    --model-dir "$MODEL_DIR" \
    --epochs 50 \
    --hidden-dim 128 \
    --num-layers 3 \
    --learning-rate 0.001 \
    2>&1 | tee "$LOG_DIR/train_$(date +%Y%m%d_%H%M%S).log"
  info "Training complete. Weights saved to $MODEL_DIR."
fi

# ── Stage 4: Export model metadata ───────────────────────────────────────────
info "═══ Stage 4: Writing model metadata ═══"
cat > "$MODEL_DIR/metadata.json" <<EOF
{
  "model": "GraphSAGE",
  "version": "1.0",
  "trained_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "weights_file": "graphsage_risk.pt",
  "architecture": {
    "hidden_dim": 128,
    "num_layers": 3,
    "aggregator": "mean",
    "output_classes": 3
  },
  "classes": ["green", "yellow", "red"],
  "node_features": ["risk_score", "aeo_status", "trader_type", "declaration_count", "avg_declared_value"],
  "description": "GraphSAGE model for trade declaration risk lane classification. Trained on historical NGSWTP declarations with GNN risk propagation from the Rust engine."
}
EOF
info "Metadata written to $MODEL_DIR/metadata.json"

# ── Stage 5: Start the FastAPI inference server ───────────────────────────────
if [ "$TRAIN_ONLY" = "true" ]; then
  info "═══ --train-only flag set — exiting without starting server ═══"
  exit 0
fi

info "═══ Stage 5: Starting FastAPI inference server on port $PORT ═══"
exec uvicorn main:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --workers 2 \
  --log-level info \
  --access-log
