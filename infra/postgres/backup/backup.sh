#!/usr/bin/env bash
# =============================================================================
# TradeGateway™ NGSWTP — PostgreSQL Production Backup Script
# =============================================================================
# Performs a full logical backup using pg_dump with compression.
# Uploads to S3 and retains the last 30 daily, 12 weekly, 12 monthly backups.
#
# Environment variables required:
#   DATABASE_URL       — postgresql://user:pass@host:5432/tradegateway
#   S3_BACKUP_BUCKET   — s3://tradegateway-backups
#   S3_ENDPOINT        — https://s3.tradegateway.gov (optional, for MinIO)
#   BACKUP_RETENTION_DAYS    — default 30
#   BACKUP_RETENTION_WEEKS   — default 12
#   BACKUP_RETENTION_MONTHS  — default 12
#
# Usage:
#   ./backup.sh [--full|--schema-only|--data-only]
#   ./backup.sh --full          # default: full logical backup
#   ./backup.sh --schema-only   # schema only (for DR schema verification)
#   ./backup.sh --data-only     # data only (for incremental)
# =============================================================================
set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
S3_BACKUP_BUCKET="${S3_BACKUP_BUCKET:?S3_BACKUP_BUCKET is required}"
BACKUP_TYPE="${1:---full}"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
DAY_OF_WEEK=$(date -u +"%u")   # 1=Monday, 7=Sunday
DAY_OF_MONTH=$(date -u +"%d")  # 01-31
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
RETENTION_WEEKS="${BACKUP_RETENTION_WEEKS:-12}"
RETENTION_MONTHS="${BACKUP_RETENTION_MONTHS:-12}"

# Determine backup tier
if [[ "$DAY_OF_MONTH" == "01" ]]; then
  TIER="monthly"
elif [[ "$DAY_OF_WEEK" == "7" ]]; then
  TIER="weekly"
else
  TIER="daily"
fi

BACKUP_FILE="/tmp/tradegateway-${TIER}-${TIMESTAMP}.dump"
S3_KEY="${TIER}/${TIMESTAMP}/tradegateway.dump"

log() { echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*"; }

# ─── Backup ──────────────────────────────────────────────────────────────────
log "Starting ${TIER} backup (type: ${BACKUP_TYPE}) → ${BACKUP_FILE}"

PG_DUMP_OPTS="--format=custom --compress=9 --no-password --verbose"

case "$BACKUP_TYPE" in
  --schema-only) PG_DUMP_OPTS="$PG_DUMP_OPTS --schema-only" ;;
  --data-only)   PG_DUMP_OPTS="$PG_DUMP_OPTS --data-only" ;;
  --full)        ;; # default: full backup
  *) echo "Unknown backup type: $BACKUP_TYPE"; exit 1 ;;
esac

# shellcheck disable=SC2086
pg_dump $PG_DUMP_OPTS --file="$BACKUP_FILE" "$DATABASE_URL"
BACKUP_SIZE=$(du -sh "$BACKUP_FILE" | cut -f1)
log "Backup complete: ${BACKUP_SIZE}"

# ─── Checksum ────────────────────────────────────────────────────────────────
sha256sum "$BACKUP_FILE" > "${BACKUP_FILE}.sha256"
log "SHA-256: $(cat "${BACKUP_FILE}.sha256")"

# ─── Upload to S3 ────────────────────────────────────────────────────────────
S3_OPTS=""
if [[ -n "${S3_ENDPOINT:-}" ]]; then
  S3_OPTS="--endpoint-url ${S3_ENDPOINT}"
fi

log "Uploading to ${S3_BACKUP_BUCKET}/${S3_KEY}"
# shellcheck disable=SC2086
aws s3 cp "$BACKUP_FILE"          "${S3_BACKUP_BUCKET}/${S3_KEY}"          $S3_OPTS
# shellcheck disable=SC2086
aws s3 cp "${BACKUP_FILE}.sha256" "${S3_BACKUP_BUCKET}/${S3_KEY}.sha256"   $S3_OPTS
log "Upload complete"

# ─── Retention Cleanup ───────────────────────────────────────────────────────
log "Applying retention policy: daily=${RETENTION_DAYS}d, weekly=${RETENTION_WEEKS}w, monthly=${RETENTION_MONTHS}m"

prune_old_backups() {
  local tier="$1"
  local keep="$2"
  local unit="$3"  # days, weeks, months

  case "$unit" in
    days)   cutoff=$(date -u -d "${keep} days ago" +"%Y%m%dT") ;;
    weeks)  cutoff=$(date -u -d "$((keep * 7)) days ago" +"%Y%m%dT") ;;
    months) cutoff=$(date -u -d "$((keep * 30)) days ago" +"%Y%m%dT") ;;
  esac

  # shellcheck disable=SC2086
  aws s3 ls "${S3_BACKUP_BUCKET}/${tier}/" $S3_OPTS 2>/dev/null | \
    awk '{print $NF}' | \
    while read -r prefix; do
      ts="${prefix%%/*}"
      if [[ "$ts" < "$cutoff" ]]; then
        log "Pruning old ${tier} backup: ${prefix}"
        # shellcheck disable=SC2086
        aws s3 rm --recursive "${S3_BACKUP_BUCKET}/${tier}/${prefix}" $S3_OPTS
      fi
    done
}

prune_old_backups "daily"   "$RETENTION_DAYS"   "days"
prune_old_backups "weekly"  "$RETENTION_WEEKS"  "weeks"
prune_old_backups "monthly" "$RETENTION_MONTHS" "months"

# ─── Cleanup local temp files ─────────────────────────────────────────────────
rm -f "$BACKUP_FILE" "${BACKUP_FILE}.sha256"
log "Backup job complete. Tier=${TIER}, Size=${BACKUP_SIZE}, S3=${S3_BACKUP_BUCKET}/${S3_KEY}"
