import assert from "node:assert/strict";
import fs from "node:fs";
import * as yaml from "js-yaml";

const workflowPath = new URL("../../.github/workflows/release-drills.yml", import.meta.url);
const workflow = yaml.load(fs.readFileSync(workflowPath, "utf8"));
const jobs = workflow.jobs ?? {};
const labels = ["self-hosted", "linux", "x64", "docker", "singlewindow-ci"];

assert.equal(workflow.name, "Staging Release Drills", "workflow must have the expected name");
assert.ok(workflow.on?.pull_request, "workflow must define a pull_request trigger");
assert.ok(workflow.on?.push, "workflow must define a merge/push trigger");
assert.ok(workflow.on?.workflow_dispatch, "workflow must define an approved manual trigger");
assert.equal(jobs["pr-smoke"]?.if, "github.event_name == 'push' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository)", "smoke drills must run for trusted pushes while excluding untrusted forks");
assert.deepEqual(jobs["pr-smoke"]?.["runs-on"], labels, "PR smoke labels must match the dedicated runner");
assert.deepEqual(jobs["approved-release-drill"]?.["runs-on"], labels, "release labels must match the dedicated runner");
assert.equal(jobs["approved-release-drill"]?.environment, "release-drill-staging", "release drill must require the protected staging environment");
assert.ok(jobs["approved-release-drill"]?.if?.includes("inputs.execute_release_drill"), "release drill must require explicit manual consent");
assert.ok(jobs["pr-smoke"]?.steps?.some((step) => step.name === "Upload release-drill artifacts" && step.if === "always()"), "PR smoke must upload artifacts on failure");
assert.ok(jobs["approved-release-drill"]?.steps?.some((step) => step.name === "Upload release-drill artifacts" && step.if === "always()"), "release drill must upload artifacts on failure");
assert.ok(jobs["pr-smoke"]?.steps?.some((step) => step.run === "node scripts/validate-assurance-manifest.mjs"), "PR smoke must validate assurance manifest structure");
assert.ok(jobs["approved-release-drill"]?.steps?.some((step) => step.run === "node scripts/validate-assurance-manifest.mjs --enforce-release"), "protected release workflow must enforce assurance claims");
assert.ok(jobs["pr-smoke"]?.steps?.some((step) => step.run === "node scripts/validate-no-fabricated-cost-data.mjs"), "PR smoke must reject fabricated cost data");
assert.ok(jobs["approved-release-drill"]?.steps?.some((step) => step.run === "node scripts/validate-no-fabricated-cost-data.mjs"), "protected release workflow must reject fabricated cost data");
assert.ok(jobs["pr-smoke"]?.steps?.some((step) => step.run?.includes("--mode pr-smoke --scenarios RD-1")), "PR smoke must stay limited to RD-1");
assert.ok(jobs["approved-release-drill"]?.steps?.some((step) => step.run?.includes("--mode release --scenarios")), "manual workflow must execute release mode");
console.log("Release-drill workflow structure validated.");
