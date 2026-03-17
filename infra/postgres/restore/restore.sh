#!/usr/bin/env bash
# =============================================================================
# TradeGateway™ NGSWTP — PostgreSQL Production Restore Script
# =============================================================================
# Restores a pg_dump custom-format backup from S3.
#
# Environment variables required:
#   DATABASE_URL       — postgresql://user:pass@host:5432/tradegateway
#   S3_BACKUP_BUCKET   — s3://tradegateway-backups
#   S3_ENDPOINT        — https://s3.tradegateway.gov (optional)
#
# Usage:
#   ./restore.sh <s3-key>
#   ./restore.sh daily/20260315T030000Z/tradegateway.dump
#   ./restore.sh --latest-daily
#   ./restore.sh --latest-weekly
#   ./restore.sh --latest-monthly
# =============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
S3_KEY="${1:?Provide an S3 key or --latest-daily/--latest-weekly/--latest-monthly}"

S3_OPTS=""
if [[ -n "${S3_ENDPOINT:-}" ]]; then
  S3_OPTS="--endpoint-url ${S3_ENDPOINT}"
fi

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

# ─── Resolve --latest-* shortcuts ────────────────────────────────────────────
resolve_latest() {
  local tier="$1"
  # shellcheck disable=SC2086
  local key
  key=$(aws s3 ls "${S3_BACKUP_BUCKET}/${tier}/" $S3_OPTS 2>/dev/null | \
    sort | tail -1 | awk '{print $NF}')
  if [[ -z "$key" ]]; then
    echo "No ${tier} backups found in ${S3_BACKUP_BUCKET}/${tier}/" >&2
    exit 1
  fi
  echo "${tier}/${key}tradegateway.dump"
}

case "$S3_KEY" in
  --latest-daily)   S3_KEY=$(resolve_latest "daily") ;;
  --latest-weekly)  S3_KEY=$(resolve_latest "weekly") ;;
  --latest-monthly) S3_KEY=$(resolve_latest "monthly") ;;
esac

BACKUP_FILE="/tmp/tradegateway-restore-$(date -u +"%Y%m%dT%H%M%SZ").dump"

# ─── Download from S3 ────────────────────────────────────────────────────────
log "Downloading s3://${S3_BACKUP_BUCKET}/${S3_KEY} → ${BACKUP_FILE}"
# shellcheck disable=SC2086
aws s3 cp "${S3_BACKUP_BUCKET}/${S3_KEY}"          "$BACKUP_FILE"          $S3_OPTS
# shellcheck disable=SC2086
aws s3 cp "${S3_BACKUP_BUCKET}/${S3_KEY}.sha256"   "${BACKUP_FILE}.sha256" $S3_OPTS 2>/dev/null || true

# ─── Verify checksum ─────────────────────────────────────────────────────────
if [[ -f "${BACKUP_FILE}.sha256" ]]; then
  log "Verifying SHA-256 checksum..."
  sha256sum --check "${BACKUP_FILE}.sha256"
  log "Checksum OK"
else
  log "WARNING: No checksum file found — proceeding without verification"
fi

# ─── Safety confirmation ─────────────────────────────────────────────────────
log "WARNING: This will DROP and recreate the tradegateway database."
log "Target: ${DATABASE_URL%%@*}@***"
read -r -p "Type 'RESTORE' to confirm: " CONFIRM
if [[ "$CONFIRM" != "RESTORE" ]]; then
  log "Aborted."
  exit 1
fi

# ─── Drop and recreate the database ──────────────────────────────────────────
# Extract connection params from DATABASE_URL
DB_HOST=$(echo "$DATABASE_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$DATABASE_URL" | sed -E 's|.*:([0-9]+)/.*|\1|')
DB_USER=$(echo "$DATABASE_URL" | sed -E 's|.*://([^:]+):.*|\1|')
DB_NAME=$(echo "$DATABASE_URL" | sed -E 's|.*/([^?]+).*|\1|')
DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

export PGPASSWORD="$DB_PASS"

log "Terminating active connections to ${DB_NAME}..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true

log "Dropping database ${DB_NAME}..."
dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$DB_NAME"

log "Creating database ${DB_NAME}..."
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"

# ─── Restore ─────────────────────────────────────────────────────────────────
log "Restoring from ${BACKUP_FILE}..."
pg_restore \
  --host="$DB_HOST" \
  --port="$DB_PORT" \
  --username="$DB_USER" \
  --dbname="$DB_NAME" \
  --no-password \
  --verbose \
  --jobs=4 \
  "$BACKUP_FILE"

log "Running post-restore verification..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT schemaname, tablename, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 20;"

# ─── Cleanup ─────────────────────────────────────────────────────────────────
rm -f "$BACKUP_FILE" "${BACKUP_FILE}.sha256"
unset PGPASSWORD

log "Restore complete. Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT}"
