#!/usr/bin/env bash
# start-rustfs.sh — Starts RustFS (S3-compatible) on port 9000 and creates the bucket.
# Called automatically by `pnpm dev` via concurrently.
set -e
RUSTFS_BIN="${RUSTFS_BIN:-/usr/local/bin/rustfs}"
RUSTFS_DATA="${RUSTFS_DATA:-/home/ubuntu/rustfs-data}"
RUSTFS_PORT="${RUSTFS_PORT:-9000}"
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-tradegateway}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-tradegateway-secret}"
BUCKET="${RUSTFS_BUCKET:-tradegateway-docs}"
if [ ! -f "$RUSTFS_BIN" ]; then
  echo "[rustfs] Binary not found — skipping (run scripts/install-rustfs.sh first)"
  exit 0
fi
mkdir -p "$RUSTFS_DATA"
echo "[rustfs] Starting on :$RUSTFS_PORT"
RUSTFS_ACCESS_KEY="$RUSTFS_ACCESS_KEY" RUSTFS_SECRET_KEY="$RUSTFS_SECRET_KEY" \
  "$RUSTFS_BIN" server --address ":$RUSTFS_PORT" "$RUSTFS_DATA" &
RUSTFS_PID=$!
for i in $(seq 1 15); do
  curl -sf "http://localhost:$RUSTFS_PORT/minio/health/live" > /dev/null 2>&1 && break
  sleep 1
done
echo "[rustfs] Ready (PID $RUSTFS_PID)"
python3 -c "
import boto3, botocore, os
s3=boto3.client('s3',endpoint_url='http://localhost:'+os.environ.get('RUSTFS_PORT','9000'),
  aws_access_key_id=os.environ.get('RUSTFS_ACCESS_KEY','tradegateway'),
  aws_secret_access_key=os.environ.get('RUSTFS_SECRET_KEY','tradegateway-secret'),
  region_name='us-east-1',config=botocore.config.Config(signature_version='s3v4'))
b=os.environ.get('RUSTFS_BUCKET','tradegateway-docs')
try: s3.head_bucket(Bucket=b); print('[rustfs] Bucket exists')
except: s3.create_bucket(Bucket=b); print('[rustfs] Bucket created')
"
wait $RUSTFS_PID
