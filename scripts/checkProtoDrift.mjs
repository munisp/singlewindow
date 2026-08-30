#!/usr/bin/env node
/**
 * checkProtoDrift.mjs — PRA-038/039 (Phase 9) proto-drift CI check.
 *
 * The repo historically carried THREE divergent definitions of the same gRPC
 * contracts (flat proto/*.proto — authoritative source of the generated
 * proto/<svc>/v1/*.pb.go stubs per scripts/gen-proto.sh — vs the nested
 * proto/<svc>/<svc>.proto tree vs the Node-side services/proto tree). The
 * drift produced real bugs (the Node OGA client loaded declarations.proto and
 * looked up a non-existent OGAService).
 *
 * This check FAILS (exit 1) when any gRPC service NAME is defined in more
 * than one .proto file with diverging RPC sets or diverging message field
 * sets for same-named messages. Identical duplicates are reported as
 * warnings (drift-in-waiting) but do not fail the build.
 *
 * Usage: node scripts/checkProtoDrift.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (entry.endsWith(".proto")) yield full;
  }
}

function stripComments(text) {
  return text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract service → sorted rpc signatures, and message → sorted field sigs. */
function parseProto(text) {
  const clean = stripComments(text);
  const services = new Map();
  const messages = new Map();

  const svcRe = /service\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = svcRe.exec(clean))) {
    const rpcs = [...m[2].matchAll(/rpc\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*returns\s*\(([^)]*)\)/g)]
      .map((r) => `${r[1]}(${r[2].replace(/\s+/g, "")})->(${r[3].replace(/\s+/g, "")})`)
      .sort();
    services.set(m[1], rpcs);
  }

  const msgRe = /message\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  while ((m = msgRe.exec(clean))) {
    const fields = [...m[2].matchAll(/^\s*(?:repeated\s+|optional\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*(\d+)/gm)]
      .map((f) => `${f[2]}:${f[1]}#${f[3]}`)
      .sort();
    messages.set(m[1], fields);
  }

  const pkg = /^\s*package\s+([A-Za-z0-9_.]+)\s*;/m.exec(clean)?.[1] ?? "";
  return { pkg, services, messages };
}

const files = [...walk(ROOT)];
const byService = new Map(); // serviceName -> [{file, rpcs, pkg}]
const byMessage = new Map(); // messageName -> [{file, fields, pkg}]

for (const file of files) {
  const rel = relative(ROOT, file);
  let parsed;
  try {
    parsed = parseProto(readFileSync(file, "utf8"));
  } catch {
    continue;
  }
  for (const [svc, rpcs] of parsed.services) {
    if (!byService.has(svc)) byService.set(svc, []);
    byService.get(svc).push({ file: rel, rpcs, pkg: parsed.pkg });
  }
  for (const [msg, fields] of parsed.messages) {
    if (!byMessage.has(msg)) byMessage.set(msg, []);
    byMessage.get(msg).push({ file: rel, fields, pkg: parsed.pkg });
  }
}

const problems = [];
const warnings = [];

for (const [svc, defs] of byService) {
  if (defs.length < 2) continue;
  const [first, ...rest] = defs;
  const divergent = rest.filter((d) => JSON.stringify(d.rpcs) !== JSON.stringify(first.rpcs));
  if (divergent.length) {
    problems.push(
      `service "${svc}" has DIVERGENT definitions:\n` +
        [first, ...rest]
          .map((d) => `    - ${d.file} (package ${d.pkg}, ${d.rpcs.length} rpcs)`)
          .join("\n")
    );
  } else {
    warnings.push(
      `service "${svc}" is duplicated identically in ${defs.map((d) => d.file).join(", ")}`
    );
  }
}

for (const [msg, defs] of byMessage) {
  if (defs.length < 2) continue;
  // Only compare messages belonging to duplicated services' packages —
  // common names (HealthRequest etc.) across unrelated packages are fine.
  const pkgs = new Set(defs.map((d) => d.pkg));
  if (pkgs.size > 1) continue;
  const [first, ...rest] = defs;
  const divergent = rest.filter((d) => JSON.stringify(d.fields) !== JSON.stringify(first.fields));
  if (divergent.length) {
    problems.push(
      `message "${msg}" (package ${first.pkg}) has DIVERGENT field sets:\n` +
        [first, ...rest].map((d) => `    - ${d.file} (${d.fields.length} fields)`).join("\n")
    );
  }
}

console.log(`[proto-drift] scanned ${files.length} .proto files`);
for (const w of warnings) console.warn(`[proto-drift] WARN: ${w}`);
if (problems.length) {
  console.error(`[proto-drift] FAILED — ${problems.length} divergence(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("[proto-drift] OK — no divergent duplicate service/message definitions.");
