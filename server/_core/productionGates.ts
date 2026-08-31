/**
 * productionGates.ts — Phase-6 remediation (SW-24 / SW-O1 / SW-MP-18 / SW-MP13)
 *
 * Demo/test/mocking surfaces must NEVER be reachable in a production deployment:
 *   - DEMO_MODE=true mounts /api/demo-auth which mints full-privilege JWTs for 6
 *     personas (including admin) with no identity proof, and makes the Permify
 *     authorisation wrapper allow-all.
 *   - E2E_TEST_MODE=1 mounts a test-auth route that issues session tokens.
 *   - MICROSERVICE_MOCK_HEALTH=true makes the microservice health dashboard
 *     report fabricated "healthy" states for every service.
 *
 * These flags exist for local development and CI only. When NODE_ENV=production,
 * ANY truthy value for any of them is a hard boot-refusal — a misconfigured
 * production deploy must fail loudly instead of silently exposing backdoors.
 */

/** Values treated as enabling a flag (anything else counts as unset). */
const TRUTHY = new Set(["1", "true", "yes", "on"]);

const PROD_FORBIDDEN_FLAGS: Array<{ envVar: string; description: string }> = [
  { envVar: "DEMO_MODE", description: "demo persona login + Permify allow-all" },
  { envVar: "E2E_TEST_MODE", description: "e2e test-auth token minting" },
  { envVar: "MICROSERVICE_MOCK_HEALTH", description: "fabricated microservice health data" },
];

/**
 * Throws (boot-refusal) when a prod-forbidden demo/test flag is set while
 * NODE_ENV=production. No-op otherwise.
 */
export function assertNoDemoSurfacesInProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  const violations = PROD_FORBIDDEN_FLAGS.filter(({ envVar }) =>
    TRUTHY.has((process.env[envVar] ?? "").trim().toLowerCase())
  );
  if (violations.length > 0) {
    const details = violations
      .map(({ envVar, description }) => `  - ${envVar} (${description})`)
      .join("\n");
    throw new Error(
      "=== FATAL: demo/test surfaces cannot be enabled in production ===\n" +
      `${details}\n` +
      "Unset these environment variables before starting a production server."
    );
  }
}

/**
 * True when demo mode is active (dev/test only — production boot-refuses first).
 * Use this to gate demo-only seeding and demo-only routes.
 */
export function isDemoModeEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    TRUTHY.has((process.env.DEMO_MODE ?? "").trim().toLowerCase())
  );
}
