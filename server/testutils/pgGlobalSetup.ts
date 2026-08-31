/**
 * pgGlobalSetup.ts — vitest globalSetup for the DB-gated integration suites
 * (PRA-004 / PRA-043, Phase 9). Provisions the per-run PostgreSQL template
 * database (full drizzle migration chain) and returns the teardown that
 * drops it. See server/testutils/pgTestHarness.ts for the architecture.
 */
import { provisionTemplate } from "./pgTestHarness";

export default async function setup(): Promise<() => Promise<void>> {
  return provisionTemplate();
}
