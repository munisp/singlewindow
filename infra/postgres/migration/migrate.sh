#!/usr/bin/env bash
# =============================================================================
# TradeGateway™ NGSWTP — Database Migration Runner
# =============================================================================
# Runs Drizzle ORM migrations against the target database.
# Designed to run as a Kubernetes Job before each deployment.
#
# Environment variables required:
#   DATABASE_URL  — postgresql://user:pass@host:5432/tradegateway
#
# Usage:
#   ./migrate.sh              # run all pending migrations
#   ./migrate.sh --dry-run    # show pending migrations without applying
#   ./migrate.sh --status     # show migration status
# =============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
MODE="${1:---run}"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

# Navigate to project root (where drizzle.config.ts lives)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
cd "$PROJECT_ROOT"

log "Migration runner starting. Mode: ${MODE}"
log "Database: ${DATABASE_URL%%@*}@***"

case "$MODE" in
  --dry-run)
    log "DRY RUN: Showing pending migrations..."
    pnpm drizzle-kit generate
    log "DRY RUN complete. No changes applied."
    ;;
  --status)
    log "Checking migration status..."
    # Query the drizzle migrations table directly
    psql "$DATABASE_URL" -c \
      "SELECT id, hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 20;" \
      2>/dev/null || echo "No migrations table found (fresh database)"
    ;;
  --run)
    log "Running pending migrations..."
    pnpm drizzle-kit generate
    pnpm drizzle-kit migrate
    log "Migrations complete."

    # Post-migration: run the RLS policies and partitioning scripts
    log "Applying RLS policies..."
    psql "$DATABASE_URL" -f "${SCRIPT_DIR}/../01_rls_policies.sql"
    log "RLS policies applied."

    log "Applying partitioning config..."
    psql "$DATABASE_URL" -f "${SCRIPT_DIR}/../02_partitioning.sql"
    log "Partitioning config applied."

    log "All migrations and post-migration scripts complete."
    ;;
  *)
    echo "Unknown mode: $MODE. Use --run, --dry-run, or --status."
    exit 1
    ;;
esac
