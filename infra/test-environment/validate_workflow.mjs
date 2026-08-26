#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
const workflowPath = join(here, "../../.github/workflows/services.yml");
const workflow = yaml.load(readFileSync(workflowPath, "utf8"));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const pullRequest = workflow.on?.pull_request;
const job = workflow.jobs?.["typescript-check"];
assert(pullRequest, "pull_request trigger is required");
assert(!Object.hasOwn(pullRequest, "paths"), "pull_request must not be path-filtered");
assert(job?.if?.includes("github.event_name == 'pull_request'"), "TypeScript test job must run for every pull request");
assert(!Object.hasOwn(job, "services"), "Workflow must not duplicate the database service managed by the harness");
assert(job?.env?.TEST_COMPOSE_PROJECT?.includes("github.run_id"), "Harness project name must be unique per workflow run");
assert(job?.steps?.some((step) => step.name === "Run disposable PostgreSQL-backed test suite" && step.run === "scripts/test-with-postgres.sh --reporter=verbose"), "Workflow must invoke the disposable PostgreSQL harness");

console.log("Validated services workflow: every PR runs the isolated PostgreSQL harness.");
