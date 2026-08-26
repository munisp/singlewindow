import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import * as yaml from "js-yaml";

const args = new Set(process.argv.slice(2));
const enforceRelease = args.has("--enforce-release");
const manifestPath = path.resolve(process.cwd(), "assurance/feature-claims.yaml");
const allowedStatus = new Set(["verified", "blocked", "incomplete", "retired", "not_applicable"]);
const required = [
  "id", "claim", "authoritative_source", "owner", "component", "entry_points",
  "implementation", "schema_and_migrations", "deployment", "evidence",
  "security_and_audit_requirements", "data_classification", "status",
  "last_verified_revision", "limitations",
];

if (!fs.existsSync(manifestPath)) throw new Error(`assurance manifest missing: ${manifestPath}`);
const manifest = yaml.load(fs.readFileSync(manifestPath, "utf8"));
if (manifest?.version !== 1 || !Array.isArray(manifest.claims) || manifest.claims.length === 0) {
  throw new Error("assurance manifest must have version 1 and a non-empty claims list");
}
const ids = new Set();
const blocked = [];
for (const claim of manifest.claims) {
  for (const field of required) {
    if (!(field in claim)) throw new Error(`claim ${claim?.id ?? "<unknown>"} is missing ${field}`);
  }
  if (!/^SW-[A-Z0-9-]+$/.test(claim.id)) throw new Error(`invalid claim ID: ${claim.id}`);
  if (ids.has(claim.id)) throw new Error(`duplicate claim ID: ${claim.id}`);
  ids.add(claim.id);
  if (!allowedStatus.has(claim.status)) throw new Error(`invalid status for ${claim.id}: ${claim.status}`);
  for (const level of ["unit", "integration", "end_to_end", "fault_injection"]) {
    if (!Array.isArray(claim.evidence?.[level])) throw new Error(`claim ${claim.id} is missing evidence.${level}`);
  }
  if (claim.status === "verified" && (!claim.last_verified_revision || claim.limitations.length > 0)) {
    throw new Error(`verified claim ${claim.id} requires a revision and no remaining limitations`);
  }
  if (claim.status !== "verified") blocked.push(`${claim.id}=${claim.status}`);
}
if (enforceRelease && blocked.length > 0) {
  throw new Error(`release assurance gate blocked by unverified critical claims: ${blocked.join(", ")}`);
}
console.log(`Assurance manifest validated: ${manifest.claims.length} claims; release mode=${enforceRelease}.`);
