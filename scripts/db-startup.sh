#!/usr/bin/env bash
# db-startup.sh — Bootstrap PostgreSQL for TradeGateway NGSWTP
# Usage: pnpm db:startup
set -e

DB_URL="${DATABASE_URL:-postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway}"
export PGPASSWORD=tradegateway_secure_2026

echo "[db:startup] Starting PostgreSQL..."
sudo pg_ctlcluster 14 main start 2>/dev/null || true
sleep 2

echo "[db:startup] Waiting for PostgreSQL to accept connections..."
for i in $(seq 1 10); do
  pg_isready -h localhost -p 5432 -U tradegateway 2>/dev/null && break
  sleep 1
done

echo "[db:startup] Ensuring database exists..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='tradegateway'" | grep -q 1 || \
  sudo -u postgres createdb -O tradegateway tradegateway

echo "[db:startup] Running migrations..."
DATABASE_URL="$DB_URL" pnpm db:push

echo "[db:startup] Seeding reference data..."
DATABASE_URL="$DB_URL" node scripts/seed-ports.mjs

echo "[db:startup] Done. Database is ready."
