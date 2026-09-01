/**
 * tenantRls.test.ts — Phase-11: structural gate for the tenant-plane RLS
 * migration (drizzle/migrations/0064_phase11_tenant_rls.sql).
 *
 * Verifies that every multi-tenant / vault / consent table gets ENABLE +
 * FORCE ROW LEVEL SECURITY and default-deny policies with an explicit
 * platform-admin bypass, and that the migration is registered in the
 * drizzle journal.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIG = fs.readFileSync(
  path.resolve(__dirname, "..", "drizzle", "migrations", "0064_phase11_tenant_rls.sql"),
  "utf8"
);

const TABLES = [
  "tenants",
  "tenant_users",
  "tenant_keycloak_config",
  "tenant_branding",
  "document_vault",
  "document_shares",
  "trade_finance_consent_evidence",
];

describe("0064_phase11_tenant_rls.sql", () => {
  it("is registered in the drizzle migration journal", () => {
    const journal = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "..", "drizzle", "migrations", "meta", "_journal.json"), "utf8")
    );
    expect(journal.entries.some((e: { tag: string }) => e.tag === "0064_phase11_tenant_rls")).toBe(true);
  });

  for (const table of TABLES) {
    it(`enables and forces RLS on ${table}`, () => {
      expect(MIG).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIG).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    });

    it(`defines at least one policy on ${table}`, () => {
      expect(new RegExp(`CREATE POLICY \\w+ ON ${table}\\b`).test(MIG)).toBe(true);
    });
  }

  it("default-denies without context: every policy requires admin, tenant GUC, or ownership", () => {
    // No permissive `USING (true)` backdoors anywhere in the migration.
    expect(/USING\s*\(\s*true\s*\)/i.test(MIG)).toBe(false);
    expect(/WITH CHECK\s*\(\s*true\s*\)/i.test(MIG)).toBe(false);
  });

  it("provides the tenant GUC helper and an explicit platform-admin bypass", () => {
    expect(MIG).toContain("current_app_tenant_id()");
    expect(MIG).toContain("app.current_tenant_id");
    expect(MIG).toContain("is_platform_admin()");
    expect(MIG).toContain("'platform_admin'");
  });

  it("tenant_keycloak_config (realm secrets) has no member-readable policy", () => {
    const kcSection = MIG.slice(MIG.indexOf("TENANT_KEYCLOAK_CONFIG"), MIG.indexOf("TENANT_BRANDING —"));
    // Select must be restricted to platform admin or the tenant-scoped session
    expect(kcSection).toContain("is_platform_admin() OR tenant_id::text = current_app_tenant_id()");
    expect(kcSection).not.toContain("current_app_user_id()"); // never member/user-keyed
  });

  it("consent evidence is append-only (no UPDATE/DELETE policies)", () => {
    const tfce = MIG.slice(MIG.indexOf("TRADE_FINANCE_CONSENT_EVIDENCE"));
    expect(tfce).not.toMatch(/CREATE POLICY \w+ ON trade_finance_consent_evidence\s+FOR (UPDATE|DELETE)/);
  });

  it("documents the NOBYPASSRLS app-role requirement (pattern from 0052)", () => {
    expect(MIG).toContain("NOBYPASSRLS");
  });
});
