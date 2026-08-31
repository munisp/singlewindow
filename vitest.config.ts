import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    // PRA-004/PRA-043 (Phase 9): provision the per-run PostgreSQL template
    // database (full drizzle migration chain) before any test file loads;
    // DB-gated suites skip cleanly when PostgreSQL is unavailable.
    globalSetup: ["server/testutils/pgGlobalSetup.ts"],
    include: ["server/**/*.test.ts", "client/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    testTimeout: 60_000, // DB clone + first heavy migration chain
    hookTimeout: 30_000,
    pool: "forks", // process.env.DATABASE_URL isolation between suites
  },
});
