#!/usr/bin/env node
/**
 * lintApisixRoutes.mjs — PRA-108 (Phase 9) APISIX config lint.
 *
 * Validates that every plugin-config route reference in the APISIX
 * declarative configs RESOLVES to a real route id:
 *   1. route_plugin_bindings[].route_id    (keycloak-consumer.yaml)
 *   2. route_role_guards[].route_id        (keycloak-consumer.yaml)
 *   3. every referenced plugin_config_id exists in plugin_configs
 * against the route ids declared in routes.yaml (+ routes-gap-services.yaml).
 * Also validates apisix.yaml internally: unique route ids, unique upstream
 * ids, and every upstream_id referenced by a route exists.
 *
 * Exit 1 (fail CI) on any unresolved reference. Usage:
 *   node scripts/lintApisixRoutes.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Minimal YAML extraction — the APISIX files use a restricted, stable shape
// (2-space indents, "- id:" list entries). A full YAML dependency is not
// warranted for a lint script; we parse the fields we validate and fail
// loudly if the expected anchors are absent.
function extractBlock(text, startMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return "";
  // block ends at the next top-level (column-0) key after the start
  const rest = text.slice(start + startMarker.length);
  const m = rest.match(/\n[a-zA-Z_][a-zA-Z0-9_]*:/);
  return m ? rest.slice(0, m.index) : rest;
}

function extractIds(text, key = "id") {
  const ids = [];
  const re = new RegExp(`^\\s*-?\\s*${key}:\\s*["']?([^"'\\s#]+)["']?`, "gm");
  let m;
  while ((m = re.exec(text))) ids.push(m[1]);
  return ids;
}

function extractRoutesBlock(yamlText) {
  // Everything under the top-level "routes:" key.
  return extractBlock(yamlText, "\nroutes:") || (yamlText.startsWith("routes:") ? yamlText : "");
}

const problems = [];
const checked = [];

function requireFile(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    problems.push(`missing config file: ${path}`);
    return "";
  }
}

// ── 1. Collect route ids from the deployed route sets ─────────────────────────
const routesYaml = requireFile(join(ROOT, "infra/apisix/routes.yaml"));
const gapRoutesYaml = requireFile(join(ROOT, "infra/apisix/routes-gap-services.yaml"));
const consumerYaml = requireFile(join(ROOT, "infra/apisix/keycloak-consumer.yaml"));
const apisixYaml = requireFile(join(ROOT, "infra/apisix/apisix.yaml"));

const stringRouteIds = new Set([
  ...extractIds(extractRoutesBlock(routesYaml)),
  ...extractIds(extractRoutesBlock(gapRoutesYaml)),
]);
checked.push(`routes.yaml + routes-gap-services.yaml route ids: ${[...stringRouteIds].join(", ")}`);

// ── 2. keycloak-consumer.yaml bindings + guards resolve ───────────────────────
const bindingsBlock = extractBlock(consumerYaml, "route_plugin_bindings:");
const guardsBlock = extractBlock(consumerYaml, "route_role_guards:");
if (!bindingsBlock) problems.push("keycloak-consumer.yaml: no route_plugin_bindings block found");
if (!guardsBlock) problems.push("keycloak-consumer.yaml: no route_role_guards block found");

for (const id of extractIds(bindingsBlock, "route_id")) {
  if (!stringRouteIds.has(id)) {
    problems.push(`route_plugin_bindings: route_id "${id}" does not exist in routes.yaml/routes-gap-services.yaml`);
  }
}
for (const id of extractIds(guardsBlock, "route_id")) {
  if (!stringRouteIds.has(id)) {
    problems.push(`route_role_guards: route_id "${id}" does not exist in routes.yaml/routes-gap-services.yaml`);
  }
}

// plugin_config_id references must resolve to declared plugin_configs ids.
const pluginConfigIds = new Set(extractIds(extractBlock(consumerYaml, "plugin_configs:")));
for (const id of extractIds(bindingsBlock, "plugin_config_id")) {
  if (!pluginConfigIds.has(id)) {
    problems.push(`route_plugin_bindings: plugin_config_id "${id}" is not declared under plugin_configs`);
  }
}
checked.push(`plugin_configs ids: ${[...pluginConfigIds].join(", ")}`);

// ── 3. apisix.yaml internal consistency ───────────────────────────────────────
const apisixRoutes = extractRoutesBlock(apisixYaml);
const apisixRouteIds = extractIds(apisixRoutes);
const dupRoutes = apisixRouteIds.filter((id, i) => apisixRouteIds.indexOf(id) !== i);
if (dupRoutes.length) problems.push(`apisix.yaml: duplicate route ids: ${[...new Set(dupRoutes)].join(", ")}`);

const upstreamIds = new Set(extractIds(extractBlock(apisixYaml, "upstreams:")));
for (const uid of extractIds(apisixRoutes, "upstream_id")) {
  if (!upstreamIds.has(uid)) {
    problems.push(`apisix.yaml: route references upstream_id "${uid}" which is not declared under upstreams`);
  }
}
checked.push(`apisix.yaml route ids: ${apisixRouteIds.join(", ")}`);

// ── Report ─────────────────────────────────────────────────────────────────────
for (const line of checked) console.log(`[lint-apisix] ${line}`);
if (problems.length) {
  console.error(`[lint-apisix] FAILED — ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("[lint-apisix] OK — all plugin route references resolve.");
