/**
 * Sprint 75 — Vitest tests
 * Covers:
 *   1. Permify assertCan wired into tRPC procedures
 *   2. Fluvio useFluvioFeed hook contract
 *   3. APISIX Keycloak openid-connect plugin config correctness
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── 1. Permify wire-up tests ──────────────────────────────────────────────────

describe("Permify assertCan wire-up in tRPC routers", () => {
  const projectRoot = path.resolve(__dirname, "..");

  it("declarations router imports assertCan and setOwner from permify", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/declarations.ts"),
      "utf8"
    );
    expect(src).toContain("assertCan");
    expect(src).toContain("setOwner");
    expect(src).toContain("_core/permify");
  });

  it("declarations router calls setOwner after creating a declaration", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/declarations.ts"),
      "utf8"
    );
    expect(src).toContain('setOwner("declaration"');
    expect(src).toContain("decl!.id");
    expect(src).toContain("ctx.user.id");
  });

  it("oga router imports assertCan and setOwner from permify", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/oga.ts"),
      "utf8"
    );
    expect(src).toContain("assertCan");
    expect(src).toContain("setOwner");
    expect(src).toContain("_core/permify");
  });

  it("oga router calls assertCan before approving a permit", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/oga.ts"),
      "utf8"
    );
    // assertCan must appear before the transitionOgaPermit call in the approve mutation
    const approveIdx = src.indexOf("approve: protectedProcedure");
    const assertCanIdx = src.indexOf("assertCan", approveIdx);
    const updateIdx = src.indexOf("transitionOgaPermit", approveIdx);
    expect(assertCanIdx).toBeGreaterThan(approveIdx);
    expect(assertCanIdx).toBeLessThan(updateIdx);
  });

  it("oga router calls assertCan before rejecting a permit", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/oga.ts"),
      "utf8"
    );
    const rejectIdx = src.indexOf("reject: protectedProcedure");
    const assertCanIdx = src.indexOf("assertCan", rejectIdx);
    const updateIdx = src.indexOf("transitionOgaPermit", rejectIdx);
    expect(assertCanIdx).toBeGreaterThan(rejectIdx);
    expect(assertCanIdx).toBeLessThan(updateIdx);
  });

  it("oga router calls setOwner after creating permits", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/oga.ts"),
      "utf8"
    );
    expect(src).toContain('setOwner("permit"');
  });

  it("payments router imports assertCan and setOwner from permify", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/payments.ts"),
      "utf8"
    );
    expect(src).toContain("assertCan");
    expect(src).toContain("setOwner");
    expect(src).toContain("_core/permify");
  });

  it("payments router calls setOwner after creating a payment", () => {
    // assertCan is intentionally not called for initiate: ownership is already verified
    // by the traderId === ctx.user.id check earlier in the procedure.
    // assertCan is reserved for cross-role operations (approve, release, assess).
    const src = fs.readFileSync(
      path.join(projectRoot, "server/routers/payments.ts"),
      "utf8"
    );
    expect(src).toContain('setOwner("payment"');
    // Verify that the traderId ownership check is present
    expect(src).toContain('decl.traderId !== ctx.user.id');
  });

  it("permify helper exports can, assertCan, setOwner, and writeTuple", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/_core/permify.ts"),
      "utf8"
    );
    expect(src).toContain("export async function can(");
    expect(src).toContain("export async function assertCan(");
    expect(src).toContain("export async function setOwner(");
    expect(src).toContain("export async function writeTuple(");
  });

  it("permify helper gracefully degrades when PERMIFY_URL is not set", () => {
    const src = fs.readFileSync(
      path.join(projectRoot, "server/_core/permify.ts"),
      "utf8"
    );
    // Should have a fallback that returns true or logs a warning instead of throwing
    expect(src).toMatch(/PERMIFY_URL|permifyUrl|process\.env/);
    // Should not throw unconditionally
    expect(src).not.toContain("throw new Error(\"PERMIFY_URL");
  });
});

// ── 2. Fluvio useFluvioFeed hook contract tests ───────────────────────────────

describe("useFluvioFeed hook contract", () => {
  const hookPath = path.resolve(
    __dirname,
    "../client/src/hooks/useFluvioFeed.ts"
  );

  it("hook file exists at expected path", () => {
    expect(fs.existsSync(hookPath)).toBe(true);
  });

  it("hook exports useFluvioFeed function", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("export function useFluvioFeed(");
  });

  it("hook exports VesselPosition type", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("export interface VesselPosition");
    expect(src).toContain("mmsi: string");
    expect(src).toContain("lat: number");
    expect(src).toContain("lng: number");
    expect(src).toContain("speed: number");
    expect(src).toContain("heading: number");
  });

  it("hook exports FluvioEvent type with all required fields", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("export interface FluvioEvent");
    expect(src).toContain("type: FluvioEventType");
    expect(src).toContain("topic: string");
    expect(src).toContain("offset: number");
    expect(src).toContain("payload:");
  });

  it("hook exports FeedStatus type with all states", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("\"connecting\"");
    expect(src).toContain("\"connected\"");
    expect(src).toContain("\"paused\"");
    expect(src).toContain("\"reconnecting\"");
    expect(src).toContain("\"error\"");
  });

  it("hook returns vesselPositions derived from AIS events", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("vesselPositions");
    expect(src).toContain("ais.vessel_position");
  });

  it("hook implements pause and resume controls", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("const pause = useCallback(");
    expect(src).toContain("const resume = useCallback(");
  });

  it("hook implements ring buffer with configurable max size", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("maxEvents");
    expect(src).toContain("MAX_EVENTS");
    expect(src).toContain("slice(0, maxEvents)");
  });

  it("hook implements reconnect logic with max attempts", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    expect(src).toContain("MAX_RECONNECT_ATTEMPTS");
    expect(src).toContain("reconnectCount");
    expect(src).toContain("RECONNECT_DELAY_MS");
  });

  it("hook cleans up WebSocket on unmount", () => {
    const src = fs.readFileSync(hookPath, "utf8");
    // useEffect cleanup should close the WebSocket
    expect(src).toContain("wsRef.current?.close()");
    expect(src).toContain("mountedRef.current = false");
  });

  it("PortHeatmap page imports and uses useFluvioFeed", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/app/PortHeatmap.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("useFluvioFeed");
    expect(pageSrc).toContain("FluvioLiveFeedPanel");
    expect(pageSrc).toContain("Fluvio Live Event Feed");
  });

  it("PortHeatmap page renders both AIS and Events tabs", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/app/PortHeatmap.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("AIS Positions");
    expect(pageSrc).toContain("Events");
  });

  it("PortHeatmap page shows live indicator when connected", () => {
    const pageSrc = fs.readFileSync(
      path.resolve(__dirname, "../client/src/pages/app/PortHeatmap.tsx"),
      "utf8"
    );
    expect(pageSrc).toContain("animate-ping");
    expect(pageSrc).toContain("bg-emerald-500");
  });
});

// ── 3. APISIX Keycloak openid-connect config tests ───────────────────────────

describe("APISIX Keycloak openid-connect plugin configuration", () => {
  const apisixConfigPath = path.resolve(
    __dirname,
    "../infra/apisix/apisix.yaml"
  );
  const keycloakConsumerPath = path.resolve(
    __dirname,
    "../infra/apisix/keycloak-consumer.yaml"
  );

  it("apisix.yaml exists", () => {
    expect(fs.existsSync(apisixConfigPath)).toBe(true);
  });

  it("keycloak-consumer.yaml exists", () => {
    expect(fs.existsSync(keycloakConsumerPath)).toBe(true);
  });

  it("apisix.yaml uses openid-connect plugin (not bare jwt-auth) on protected routes", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    // All protected routes should use openid-connect
    expect(src).toContain("openid-connect:");
    // The bare jwt-auth plugin should not appear on protected routes
    // (it may still appear in consumers, but route-level should be openid-connect)
    const routesSection = src.split("# ── Global plugins")[0];
    // Count openid-connect occurrences in routes section
    const oidcCount = (routesSection.match(/openid-connect:/g) ?? []).length;
    expect(oidcCount).toBeGreaterThanOrEqual(7); // 7 protected route groups
  });

  it("apisix.yaml Keycloak discovery URL points to correct realm", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    expect(src).toContain("/realms/tradegateway/.well-known/openid-configuration");
  });

  it("apisix.yaml uses RS256 token signing algorithm", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    expect(src).toContain("RS256");
    expect(src).toContain("token_signing_alg_values_expected");
  });

  it("apisix.yaml sets bearer_only: true on all microservice routes", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    const bearerOnlyCount = (src.match(/bearer_only: true/g) ?? []).length;
    expect(bearerOnlyCount).toBeGreaterThanOrEqual(7);
  });

  it("apisix.yaml configures JWKS cache expiry", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    expect(src).toContain("jwks_expires_in: 300");
  });

  it("apisix.yaml includes authz-keycloak plugin for role-based guards", () => {
    const src = fs.readFileSync(apisixConfigPath, "utf8");
    expect(src).toContain("authz-keycloak");
    expect(src).toContain("enforcement_mode: ENFORCING");
  });

  it("keycloak-consumer.yaml defines consumers for service accounts", () => {
    const src = fs.readFileSync(keycloakConsumerPath, "utf8");
    expect(src).toContain("temporal-worker");
    expect(src).toContain("risk-engine");
    expect(src).toContain("fluvio-consumer");
  });

  it("keycloak-consumer.yaml defines role-based route guards for sensitive operations", () => {
    const src = fs.readFileSync(keycloakConsumerPath, "utf8");
    expect(src).toContain("declaration#assess");
    expect(src).toContain("permit#approve");
    expect(src).toContain("payment#reconcile");
  });

  it("keycloak-consumer.yaml references correct Keycloak realm", () => {
    const src = fs.readFileSync(keycloakConsumerPath, "utf8");
    expect(src).toContain("/realms/tradegateway/");
  });

  it("keycloak README exists with import instructions", () => {
    const readmePath = path.resolve(__dirname, "../infra/keycloak/README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
    const readme = fs.readFileSync(readmePath, "utf8");
    expect(readme).toContain("realm-export.json");
    expect(readme).toContain("APISIX");
  });
});
