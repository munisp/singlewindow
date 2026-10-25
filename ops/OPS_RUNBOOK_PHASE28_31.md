# Ops Runbook — Phase 28–31 stateOps Rollout

**Scope:** apply migrations 0081–0084 (21 new tables) and provision `PROOF_SIGNING_KEY` in each environment (staging → production).

---

## Step 1 — Apply migrations (per environment)

Migrations are idempotent (`IF NOT EXISTS` throughout), contain **zero seed data**, and are structurally linted (balanced DDL, valid FK chain, drizzle breakpoints intact). Journal entries idx 81–84 are already registered in the repo.

**Preferred (matches repo tooling):**
```bash
export DATABASE_URL="postgres://user:pass@host:5432/dbname"
npx drizzle-kit migrate   # applies all pending journal entries, incl. 0081–0084
```

**Alternative (script, from repo root):**
```bash
export DATABASE_URL="postgres://..."
bash ops/apply_phase28_31_migrations.sh   # preflight + 4 migrations + post-checks
```

**Post-check expectations:**
- `stateops_tables` count = **21**
- Fail-closed check = **0 rows** in `state_licenses`, `fisheries_permits`, `blue_bond_issuances` (anything else means someone seeded — investigate)

## Step 2 — Provision PROOF_SIGNING_KEY

Required by: blue-carbon MRV evidence (Phase 28), training certifications + RECs (Phase 30), blue bonds + impact reports (Phase 31). **Fail-closed:** without it these mutations return 503 by design — this is the correct behaviour, not an outage.

**Generate (per environment — do NOT reuse across envs):**
```bash
openssl rand -hex 32
```

**Set it** in the web service environment (the Node/tRPC server hosting `server/routers/stateOps.ts`) — via your secret manager / env injection, never in the repo or dotfiles committed to git:
- Kubernetes: `kubectl create secret generic proof-signing --from-literal=PROOF_SIGNING_KEY=<hex>` → envFrom in the deployment
- Docker/systemd: environment file outside the repo, referenced by the unit/compose file

**Restart** the web service after setting.

## Step 3 — Smoke verification (per environment)

1. **Fail-closed off-state proof** (before setting the key, optional): call `stateOps.addMrvEvidence` → expect 503 "MRV signing not configured". Confirms fail-closed works.
2. **Happy path** (after key set): issue a test certification via the Training tab, click **Verify** → expect "Valid".
3. **Revenue summary**: open `/app/state-ops` → Revenue tab → all 15 lines render as ₦0 / "No records yet" (empty state, not an error).
4. **Audit trail**: perform any mutation → confirm a row appears in the audit log (Phase 26 global mutation audit).

## Step 4 — Go/no-go for state demos

- [ ] Migrations applied (21/21 tables)
- [ ] `PROOF_SIGNING_KEY` set + service restarted
- [ ] Verify badge shows "Valid" on a test credential
- [ ] Demo data ONLY in a clearly labelled staging tenancy — never production

## Rollback

All tables are new and additive — rollback = `DROP TABLE` the 21 stateOps tables (no existing table was altered). No data dependencies flow the other way.
