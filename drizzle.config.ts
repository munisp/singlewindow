import { defineConfig } from "drizzle-kit";
// Use local PostgreSQL for schema management
const connectionString = process.env.DATABASE_URL?.startsWith("postgresql")
  ? process.env.DATABASE_URL
  : "postgresql://tradegateway:tradegateway_secure_2026@localhost:5432/tradegateway";
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
