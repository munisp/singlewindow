/**
 * env.collision.test.ts — PRA-067 boot-time service-URL collision validation.
 *
 * Two gateway clients resolving to the same host:port for different services
 * is the PRA-067 defect class (miswired clients boot "healthy"). env.ts
 * refuses to boot instead. These tests pin: (a) shipped defaults are
 * collision-free after the SW-CLOSE reconciliation, (b) collisions are
 * detected with both env names + the contested host:port, (c) explicitly
 * configured colliding URLs are refused — never silently rebound,
 * (d) same-service endpoint URLs and empty/unparseable values are exempt.
 */

import { describe, expect, it } from "vitest";
import { ENV, assertNoServiceUrlCollisions } from "./_core/env";

describe("assertNoServiceUrlCollisions (PRA-067)", () => {
  it("accepts the shipped defaults (reconciled, collision-free)", () => {
    expect(() => assertNoServiceUrlCollisions()).not.toThrow();
  });

  it("refuses the pre-fix cenService/hsClassifier collision on 8093 with both names", () => {
    const config = { ...ENV, hsClassifierUrl: "http://localhost:8093" };
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(/Service URL collision/);
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(/localhost:8093/);
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(/CEN_SERVICE_URL/);
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(/HS_CLASSIFIER_URL/);
  });

  it("refuses explicitly-configured colliding URLs (no silent rebind)", () => {
    // An operator who points two services at one host:port gets a loud boot
    // refusal — the gateway never guesses which service should answer.
    const config = {
      ...ENV,
      riskEngineUrl: "https://risk.internal.example:9443",
      gnnRiskUrl: "https://risk.internal.example:9443",
    };
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(
      /risk\.internal\.example:9443 ← RISK_ENGINE_URL, GNN_RISK_URL|risk\.internal\.example:9443 ← GNN_RISK_URL, RISK_ENGINE_URL/
    );
  });

  it("normalizes default ports (http:80 / https:443) when comparing", () => {
    const config = {
      ...ENV,
      ogaServiceUrl: "https://oga.internal.example",
      analyticsServiceUrl: "https://oga.internal.example:443",
    };
    expect(() => assertNoServiceUrlCollisions(config)).toThrow(/OGA_SERVICE_URL/);
  });

  it("skips an unset TARIFF_SERVICE_URL (its own fail-closed path handles it)", () => {
    expect(ENV.tariffServiceUrl).toBe("");
    expect(() => assertNoServiceUrlCollisions()).not.toThrow();
  });

  it("skips unparseable values (rejected by their own validators, not this one)", () => {
    const config = { ...ENV, cenServiceUrl: "not-a-url" };
    expect(() => assertNoServiceUrlCollisions(config)).not.toThrow();
  });

  it("does not flag same-service endpoint URLs sharing one origin (NIMC OAuth endpoints)", () => {
    // All four NIMC endpoints live on api.nimc.gov.ng:443 — one logical
    // service, deliberately exempt from the collision check.
    const config = {
      ...ENV,
      nigeriaIdBaseUrl: "https://id.internal.example",
      nigeriaIdAuthorizationUrl: "https://id.internal.example/oauth/authorize",
      nigeriaIdTokenUrl: "https://id.internal.example/oauth/token",
      nigeriaIdUserInfoUrl: "https://id.internal.example/oauth/userinfo",
    };
    expect(() => assertNoServiceUrlCollisions(config)).not.toThrow();
  });
});
