/**
 * permifySchema.test.ts — Structural validation of permify/schema.perm
 *
 * Guards against schema/usage drift: routers call assertCan(...) with
 * (entity, permission) pairs that MUST exist in the committed schema.
 * Permify denies unknown permissions, so a missing definition silently
 * breaks the corresponding transition in any live environment
 * (Phase-11 finding: declaration entity lacked `release`/`hold` while
 * declarations.updateStatus asserts exactly those).
 *
 * The parser here is intentionally small but strict: it extracts entity
 * blocks, relation names, and permission definitions, verifies balanced
 * braces, and checks that permission expressions only reference declared
 * relations/permissions on the same entity.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SCHEMA_PATH = path.resolve(__dirname, "..", "permify", "schema.perm");
const ROUTERS_DIR = path.resolve(__dirname, "routers");

interface EntityDef {
  relations: Set<string>;
  permissions: Map<string, string>; // name → expression
}

function stripComments(src: string): string {
  return src
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function parseSchema(src: string): Map<string, EntityDef> {
  const clean = stripComments(src);
  const entities = new Map<string, EntityDef>();
  const entityRe = /entity\s+([a-z_][a-z0-9_]*)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = entityRe.exec(clean)) !== null) {
    const name = m[1];
    // Find matching closing brace
    let depth = 1;
    let i = entityRe.lastIndex;
    const start = i;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
    expect(depth, `entity ${name}: unbalanced braces`).toBe(0);
    const body = clean.slice(start, i - 1);
    const relations = new Set<string>();
    const permissions = new Map<string, string>();
    for (const rel of body.matchAll(/relation\s+([a-z_][a-z0-9_]*)/g)) {
      relations.add(rel[1]);
    }
    for (const perm of body.matchAll(/permission\s+([a-z_][a-z0-9_]*)\s*=\s*([^\n]+)/g)) {
      permissions.set(perm[1], perm[2].trim());
      expect(
        relations.has(perm[1]) === false,
        `entity ${name}: permission ${perm[1]} shadows a relation`
      ).toBe(true);
    }
    entities.set(name, { relations, permissions });
  }
  return entities;
}

describe("permify/schema.perm structural validation", () => {
  const src = fs.readFileSync(SCHEMA_PATH, "utf8");
  const entities = parseSchema(src);

  it("parses at least the 13 documented entities", () => {
    expect(entities.size).toBeGreaterThanOrEqual(13);
    for (const e of ["user", "declaration", "payment", "permit", "aeo_application", "cargo_shipment", "organisation"]) {
      expect(entities.has(e), `missing entity ${e}`).toBe(true);
    }
  });

  it("permission expressions reference only declared relations/permissions", () => {
    for (const [name, def] of entities) {
      for (const [perm, expr] of def.permissions) {
        // Tokens like org.admin resolve through a relation to another
        // entity's permission — only the leading token must be local.
        for (const tok of expr.match(/[a-z_][a-z0-9_.]*/g) ?? []) {
          if (tok === "or" || tok === "and" || tok === "not") continue;
          const head = tok.split(".")[0];
          expect(
            def.relations.has(head) || def.permissions.has(head),
            `entity ${name} permission ${perm}: unknown reference "${tok}"`
          ).toBe(true);
        }
      }
    }
  });

  it("declaration entity defines release and hold (asserted by declarations.updateStatus)", () => {
    const decl = entities.get("declaration");
    expect(decl).toBeDefined();
    expect(decl!.permissions.has("release")).toBe(true);
    expect(decl!.permissions.has("hold")).toBe(true);
    // release/hold must be officer-granted via existing relations (mirror cargo_shipment.release)
    expect(decl!.permissions.get("release")).toContain("customs_officer");
    expect(decl!.permissions.get("hold")).toMatch(/customs_officer|inspector/);
  });

  it("every literal assertCan(ctx, entity, id, permission) in routers exists in the schema", () => {
    const re = /assertCan\(\s*[^,]+,\s*"([a-z_]+)"\s*,\s*[^,]+,\s*"([a-z_]+)"/g;
    const missing: string[] = [];
    for (const file of fs.readdirSync(ROUTERS_DIR)) {
      if (!file.endsWith(".ts")) continue;
      const code = fs.readFileSync(path.join(ROUTERS_DIR, file), "utf8");
      for (const m of code.matchAll(re)) {
        const [, entity, perm] = m;
        const def = entities.get(entity);
        // Entities legitimately resolved outside schema.perm (e.g.
        // kyc_verification, duty_drawback_claim aliases) are skipped only
        // if the entity is absent entirely; a present entity MUST define
        // the permission.
        if (def && !def.permissions.has(perm) && !def.relations.has(perm)) {
          missing.push(`${file}: ${entity}.${perm}`);
        }
      }
    }
    expect(missing, `permissions asserted in code but missing from schema:\n${missing.join("\n")}`).toEqual([]);
  });
});
