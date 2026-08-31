# Demo Database Seeding

`scripts/seed/` provides a complete, idempotent, environment-gated seeder that
populates **all 162 public tables** with synthetic-but-realistic Nigerian
single-window demo data.

## Safety gates (doctrine)

The seeder **refuses to run** unless every gate passes:

1. `NODE_ENV=production` → **hard exit** (`exit 70`). No override exists.
2. `SEED_DEMO=true` must be set explicitly (otherwise exit 1).
3. `DATABASE_URL` must look local (localhost / loopback / unix socket).
   For a disposable remote demo DB, additionally set `SEED_ALLOW_REMOTE=true`.

Gating logic lives in `scripts/seed/gating.ts` and is unit-tested without a
database in `scripts/seed/seed.test.ts`.

## How to run

```bash
# 1. Provision a local PostgreSQL (any throwaway instance works) and push the schema
export DATABASE_URL='postgresql://postgres@localhost:5432/singlewindow'
pnpm db:push                      # or: drizzle-kit push --force

# 2. Seed (idempotent — safe to re-run at any time)
SEED_DEMO=true pnpm tsx scripts/seed/seed.ts

# 3. Coverage audit — asserts zero unpopulated tables, writes docs/seed-coverage.json
SEED_DEMO=true pnpm tsx scripts/seed/coverage.ts

# 4. PG-free smoke tests (gating + determinism)
pnpm vitest run scripts/seed/seed.test.ts
```

## Idempotency design

- Every generated value is a **pure function of `(table, rowIndex, column)`**
  (fnv1a + mulberry32 in `scripts/seed/deterministic.ts`). Re-running the
  seeder generates byte-identical rows.
- Primary keys are deterministic: serial PKs use per-table id bands
  (`serialId`), UUID PKs use `uuidFromSeed`, natural keys are seeded strings.
- All inserts use `ON CONFLICT DO NOTHING`. A rerun against an already-seeded
  database inserts **0 rows** (verified: run 1 = 9,217 rows, run 2 = 0 rows).

## Data realism

- **Ports**: Apapa, Tin Can Island, Onne, Calabar, Warri, Port Harcourt with
  real UN/LOCODEs; 12 real terminal names.
- **Agencies (OGAs)**: NCS, NPA, NIMASA, NIWA, FIRS, CBN, NEPC, NIS, Port Health.
- **Vessels**: IMO numbers with valid check digits (computed per IMO rules),
  MMSIs with Nigerian MID 657 (9 digits).
- **Commodities**: real HS-2022 chapters/codes traded through Nigerian ports.
- **Money**: NGN amounts stored in kobo.
- All identities are synthetic (names drawn from Nigerian first/last name
  pools, `@example.ng` / agency-domain seed mailboxes).

## Volumes (defaults)

| Domain | Tables | Rows |
|---|---|---|
| Identity & tenants | users, stakeholder_profiles, tenants, tenant_users | 60 / 60 / 5 / 60 |
| Ports & geo | port_locations, geofences, geofence_events | 12 / 12 / 40 |
| Vessels | vessel_tracking_events | 400 (≈40 vessels × 10 reports) |
| Declarations | declarations, declaration_documents, declaration_amendments, declaration_risk_history | 500 / 800 / 60 / 500 |
| OGA permits | oga_permits, oga_permit_events, oga_bulk_actions | 240 / 240 / 12 |
| Payments & ledger | payments, payment_accounts, tigerbeetle_ledger_entries | 450 / 12 / 300 |
| Maritime single window | msw_visits (port calls), msw_declarations, msw_clearances | 40 / 160 / 120 |
| Trade docs | manifests, bills_of_lading, ucrs, lpco_records | 40 / 160 / 120 / 90 |
| Audit & security | audit_events, security_alerts, sanctions_checks | 600 / 60 / 200 |
| All remaining tables | (see `ROW_COUNTS` in `scripts/seed/generate.ts`) | 4–120 each |

Timestamps are spread deterministically over the 90 days before a fixed seed
epoch (2026-01-15), so dashboards show realistic time series.

## KPIs — derived, never fabricated

`scripts/seed/derivedKpis.ts` writes `kpi_targets` rows whose values are
**SQL-computed from the seeded facts** (declaration totals and clearance rate,
confirmed NGN revenue, distinct tracked vessels, port calls, permit/KYC/payment
rates). If a table were empty the KPI would be 0 — nothing is invented.

## Coverage audit

`scripts/seed/coverage.ts` queries `information_schema` for every public base
table, records row counts into `docs/seed-coverage.json`, and fails (exit 1)
if any table is unpopulated without an explicit, justified entry in the
`EXEMPTIONS` map. Current status: **162/162 tables populated, 0 exemptions**.

## Tests

`scripts/seed/seed.test.ts` (vitest, no database required) covers:
production hard-refusal, `SEED_DEMO` requirement, remote-host guard,
local-URL detection, determinism of RNG/UUID/serial-id primitives, byte-identical
row regeneration (the basis of idempotency), topo ordering, IMO check digits
and MMSI structure. 17/17 passing; `tsc --noEmit` reports 0 errors.
