# PostgreSQL Test Environment

This directory supplies a **disposable PostgreSQL 16 test database** for SingleWindow test files that execute real Drizzle-backed router paths. It addresses failures such as `DB unavailable` and `Database unavailable` that occur when `DATABASE_URL` is unset or does not point to a reachable PostgreSQL server.

The environment is intentionally separate from `docker-compose.yml`, which is a persistent development/production-oriented stack with different credentials and port defaults. The test database uses port **55432**, the database name `tradegateway_test`, the user `tradegateway`, and an in-memory PostgreSQL data directory. Each default invocation begins from an empty database and removes the container after the test command completes.

## One-command workflow

After installing the repository’s Node dependencies, run the focused previously database-dependent tests:

```bash
scripts/test-with-postgres.sh \
  server/v80.test.ts \
  server/v81.test.ts \
  server/v83.test.ts
```

The wrapper performs four operations in order. It starts `postgres:16-alpine`, waits for `pg_isready`, runs `drizzle-kit push --force` plus `scripts/seed-comprehensive.mjs`, and invokes Vitest with `DATABASE_URL=postgresql://tradegateway:tradegateway@127.0.0.1:55432/tradegateway_test`. It then removes the service and its temporary database state, even when the test command fails.

Run the complete suite with the same isolated database by omitting test paths:

```bash
scripts/test-with-postgres.sh
```

Use `--keep` only while debugging a failure. It retains the container after the test process exits, allowing direct inspection with `docker compose --project-name singlewindow-test-db -f infra/test-environment/compose.yml exec postgres psql -U tradegateway -d tradegateway_test`. Remove it afterwards with:

```bash
docker compose --project-name singlewindow-test-db \
  -f infra/test-environment/compose.yml down --volumes --remove-orphans
```

## Why this fixes the 25 failures

The affected test groups call administrative/read-write router paths directly. For example, Kafka event-log list/retry procedures and workflow-schema upsert/seed procedures require `getDb()` to return a real Drizzle PostgreSQL connection; the application deliberately raises a service error rather than inventing data for these operations. The wrapper exports a `postgresql://` URL before importing Vitest, so `server/db.ts` initializes its lazy pool against the test container rather than selecting its documented no-database fallback.

| Environment | Use case | Trade-off | Cleanup |
| --- | --- | --- | --- |
| `scripts/test-with-postgres.sh` | Repeatable local verification and the dedicated CI runner. | Requires Docker, but recreates an isolated schema and seed every run. | Automatic by default. |
| GitHub Actions PostgreSQL service | Push and pull-request CI. | Requires an online matching self-hosted runner; jobs use service ports at `localhost:5432`. | The CI job removes the service after completion. |
| Full development Compose stack | Manual end-to-end development involving Redis and the application. | Retains state and uses different defaults; it is not ideal for deterministic unit/integration test resets. | Explicit operator-managed teardown. |

## Dedicated-runner networking

The self-hosted runner deployment runs with Linux host networking because GitHub Actions service containers publish their ports on the Docker host. This allows the CI job’s existing `DATABASE_URL=postgresql://tradegateway:tradegateway@localhost:5432/tradegateway_test` to work from within the runner container. The test harness uses `127.0.0.1:55432` locally to avoid colliding with any developer or full-stack PostgreSQL service.

> Do not run this runner or test environment against a production database. The schema push and seed intentionally mutate the configured database, and the runner’s Docker socket and host networking require a dedicated trusted build machine.
