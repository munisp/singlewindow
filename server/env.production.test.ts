import { describe, expect, it } from "vitest";
import { ENV, validateProductionConfig } from "./_core/env";

function validProductionConfig(): typeof ENV {
  return {
    ...ENV,
    databaseUrl: "postgresql://tradegateway:strong-password@postgres.internal/tradegateway",
    cookieSecret: "jwt-secret-for-production-validation",
    apiKeyHashSecret: "api-key-hash-secret-for-production-validation",
    keycloakUrl: "https://keycloak.internal.example",
    keycloakClientSecret: "keycloak-client-secret",
    permifyUrl: "https://permify.internal.example",
    permifyApiKey: "permify-api-key",
    redisUrl: "redis://:strong-password@redis.internal:6379",
    redisPassword: "strong-password",
    mojaloopUrl: "https://sandbox.mojaloop.example",
    temporalAddress: "temporal.internal:7233",
    tigerBeetleAddresses: ["tigerbeetle.internal:3000"],
  };
}

describe("validateProductionConfig", () => {
  it("accepts a configured non-local production dependency set", () => {
    expect(() => validateProductionConfig(validProductionConfig())).not.toThrow();
  });

  it("rejects a missing production payment-provider URL", () => {
    const config = validProductionConfig();
    config.mojaloopUrl = "";
    expect(() => validateProductionConfig(config)).toThrow(/MOJALOOP_URL/);
  });

  it("rejects local-only dependency endpoints in production", () => {
    const config = validProductionConfig();
    config.permifyUrl = "http://localhost:3476";
    expect(() => validateProductionConfig(config)).toThrow(/unsafe local endpoint: PERMIFY_URL/);
  });
});
