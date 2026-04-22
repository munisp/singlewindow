import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  // Disable Vite's SSR transform for server-side tests — prevents the
  // "__vite_ssr_exportName__ is not defined" ReferenceError that appears
  // when Vite 6+ applies its SSR module wrapper to Node-only test files.
  plugins: [],
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
    testTimeout: 15000,
    // Use forked processes so each test file gets a clean Node.js module
    // registry; this also avoids the Vite SSR transform being applied to
    // CommonJS-style dynamic imports in server code.
    pool: "forks",
    // Instruct Vite to use plain esbuild transforms (not SSR wrappers)
    // when resolving server-side TypeScript in test context.
    server: {
      sourcemap: "inline",
    },
  },
});
