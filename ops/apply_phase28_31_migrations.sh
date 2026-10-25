#!/usr/bin/env bash
# Phase 28–31 stateOps migration runner (idempotent).
# Applies migrations 0081–0084 in order against $DATABASE_URL.
# All DDL uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so
# re-runs are safe. NO seed data is inserted (fail-closed doctrine).
#
# Usage:
#   export DATABASE_URL="postgres://user:pass@host:5432/dbname"
#   ./apply_phase28_31_migrations.sh
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL (postgres://user:pass@host:5432/dbname)}"

MIGRATIONS=(
  drizzle/migrations/0081_phase28_state_ops.sql
  drizzle/migrations/0082_phase29_state_ops_ext.sql
  drizzle/migrations/0083_phase30_state_ops_tier2.sql
  drizzle/migrations/0084_phase31_state_ops_tier3.sql
)

echo "== Preflight: connection check"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "select version();" >/dev/null
echo "   connected."

for f in "${MIGRATIONS[@]}"; do
  echo "== Applying $f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

echo "== Post-check: expected tables"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select count(*) as stateops_tables from information_schema.tables
where table_schema = 'public' and table_name in (
  'state_licenses','state_concessions','aquaculture_estates',
  'blue_carbon_projects','mrv_evidence',
  'fisheries_permits','iuu_penalties','small_craft_registry',
  'dredging_permits','dredging_declarations','water_transport_routes',
  'state_revenue_shares',
  'tourism_operators','tourism_levy_declarations','mariculture_farms',
  'training_academies','training_certifications','renewable_energy_credits',
  'blue_bond_issuances','bond_impact_reports','data_subscriptions'
);
-- expected: 21
SQL

echo "== Fail-closed check: no seed rows should exist in a fresh apply"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
select 'state_licenses' t, count(*) from state_licenses
union all select 'fisheries_permits', count(*) from fisheries_permits
union all select 'blue_bond_issuances', count(*) from blue_bond_issuances;
SQL

echo "DONE. Next: set PROOF_SIGNING_KEY in the app environment and restart the web service."
