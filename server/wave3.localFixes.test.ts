/**
 * Wave-3 local-staging regression tests — fresh-checkout blockers found while
 * running the full stack locally (DEMO_MODE, no Keycloak/Permify/RustFS).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COOKIE_NAME } from "../shared/const";

describe("D4: Permify demo-mode grants are logged no-ops", () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    process.env.NODE_ENV = "development";
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("writeTuple does not call fetch in DEMO_MODE", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("must not be called"));
    vi.stubGlobal("fetch", fetchSpy);
    const { writeTuple, deleteTuple } = await import("./_core/permify");
    await expect(
      writeTuple("declaration", "1", "owner", "user", "1")
    ).resolves.toBeUndefined();
    await expect(
      deleteTuple("declaration", "1", "owner", "user", "1")
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("never bypasses in production even if DEMO_MODE leaks through", async () => {
    process.env.NODE_ENV = "production";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
    vi.stubGlobal("fetch", fetchSpy);
    const { writeTuple } = await import("./_core/permify");
    await writeTuple("declaration", "1", "owner", "user", "1");
    expect(fetchSpy).toHaveBeenCalled(); // real write attempted
    vi.unstubAllGlobals();
  });
});

describe("D2: session cookie name has a single source of truth", () => {
  it("sdk defaults to shared/const COOKIE_NAME", () => {
    const sdk = readFileSync(resolve(__dirname, "_core/sdk.ts"), "utf8");
    expect(sdk).toContain('SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? COOKIE_NAME');
    
    expect(COOKIE_NAME).toBe("app_session_id");
    const demoAuth = readFileSync(resolve(__dirname, "routes/demoAuth.ts"), "utf8");
    expect(demoAuth).toContain("COOKIE_NAME");
  });
});

describe("D7: declaration status-change notifications use valid enum values", () => {
  it("declarations router only emits notification_type enum members", () => {
    const router = readFileSync(resolve(__dirname, "routers/declarations.ts"), "utf8");
    const schema = readFileSync(resolve(__dirname, "../drizzle/schema.ts"), "utf8");
    const enumBlock = schema.match(/notificationTypeEnum = pgEnum\([^)]*\)/s)?.[0] ?? "";
    const m = router.match(/const userNotifType[\s\S]*?;/);
    expect(m).toBeTruthy();
    for (const literal of m![0].matchAll(/"([a-z_]+)"/g)) {
      const v = literal[1];
      if (["cleared", "rejected", "docs_required"].includes(v)) continue; // status comparisons
      expect(enumBlock).toContain(`"${v}"`);
    }
    expect(m![0]).not.toContain('"docs_required" ? "docs_required"');
    expect(m![0]).not.toContain('"status_update"');
  });
});

describe("D1: migration chain is fresh-install safe", () => {
  const mig = (f: string) => readFileSync(resolve(__dirname, "../drizzle/migrations", f), "utf8");

  it("0007 does not default to an enum value added in the same migrate transaction", () => {
    expect(mig("0007_user_notifications_table.sql")).not.toContain("DEFAULT 'general'");
  });

  it("0028/0029 convert tenant_id with USING before adding the FK", () => {
    expect(mig("0028_equal_nightmare.sql")).not.toContain("cost_records_tenant_id_tenants_id_fk");
    const m29 = mig("0029_lying_chronomancer.sql");
    expect(m29).toContain("SET DATA TYPE uuid USING");
    expect(m29).toContain("cost_records_tenant_id_tenants_id_fk");
  });

  it("0052 keeps context helper functions and drops removed legacy tables", () => {
    const m52 = mig("0052_phase6_rls.sql");
    expect(m52).toContain("current_app_role()");
    expect(m52).toContain("current_app_trader_id()");
    for (const t of ["trader_profiles", "cargo_tracking", "sanctions_results"]) {
      expect(m52).not.toMatch(new RegExp(`CREATE POLICY \\w+ ON ${t}\\b`));
    }
  });

  it("0059/0067 are idempotent", () => {
    expect(mig("0059_production_indexes.sql")).toContain("IF EXISTS");
    const m67 = mig("0067_bright_red_shift.sql");
    expect(m67).not.toMatch(/^CREATE TYPE "public"\./m);
    expect(m67).not.toMatch(/ADD COLUMN "(?!\w*" )/m); // all ADD COLUMN carry IF NOT EXISTS
    expect(m67).toContain("ADD VALUE IF NOT EXISTS");
  });
});

describe("D5: demo seed script is valid and idempotent", () => {
  it("uses enum-valid onboarding step and seeds profiles/KYC/tenant", () => {
    const seed = readFileSync(resolve(__dirname, "../scripts/seed-demo-users.sql"), "utf8");
    expect(seed).toContain("'aeo_eligibility'");
    expect(seed).not.toMatch(/current_step\s*=\s*6\b/);
    expect(seed).toContain("INSERT INTO stakeholder_profiles");
    expect(seed).toContain("INSERT INTO kyc_verifications");
    expect(seed).toContain("INSERT INTO tenant_users");
  });
});
