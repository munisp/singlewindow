#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = join(here, "compose.yml");
const data = yaml.load(readFileSync(manifest, "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const postgres = data?.services?.postgres;
assert(postgres && typeof postgres === "object", "services.postgres is required");
assert(postgres.image === "postgres:16-alpine", "PostgreSQL 16 Alpine is required for parity with CI");
assert(postgres.environment?.POSTGRES_DB === "${TEST_POSTGRES_DB:-tradegateway_test}", "The isolated test database name is required");
assert(postgres.environment?.POSTGRES_USER === "${TEST_POSTGRES_USER:-tradegateway}", "The isolated test database user is required");
assert(postgres.ports?.includes("${TEST_POSTGRES_PORT:-55432}:5432"), "The non-conflicting test port mapping is required");
assert(postgres.tmpfs?.includes("/var/lib/postgresql/data"), "PostgreSQL test data must be ephemeral");
assert(postgres.healthcheck?.test?.some((entry) => String(entry).includes("pg_isready")), "A PostgreSQL readiness check is required");

console.log(`Validated ${manifest}: PostgreSQL test isolation and readiness controls are present.`);
