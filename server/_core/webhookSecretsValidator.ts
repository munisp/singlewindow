/**
 * webhookSecretsValidator.ts — B2 FIX
 *
 * Validates that all webhook secrets are set to non-default values in production.
 * Called at server startup. Throws a fatal error if any secret uses a known
 * development placeholder, preventing deployment with insecure defaults.
 *
 * Known dev defaults that must NEVER appear in production:
 *   - "dev-webhook-secret"
 *   - "tradegateway-cep-webhook-secret-dev"
 *   - "tradegateway-oga-webhook-secret-dev"
 *   - "tradegateway-sanctions-webhook-secret-dev"
 */

const DEV_SECRET_PATTERNS = [
  "dev-webhook-secret",
  "tradegateway-cep-webhook-secret-dev",
  "tradegateway-oga-webhook-secret-dev",
  "tradegateway-sanctions-webhook-secret-dev",
  "dev-secret",
  "changeme",
  "secret",
  "password",
  "12345",
];

interface WebhookSecretConfig {
  envVar: string;
  description: string;
}

const WEBHOOK_SECRETS: WebhookSecretConfig[] = [
  { envVar: "MOJALOOP_WEBHOOK_SECRET", description: "Mojaloop ILP payment confirmation webhook" },
  { envVar: "CEP_WEBHOOK_SECRET", description: "Complex Event Processing (CEP) alert webhook" },
  { envVar: "OGA_WEBHOOK_SECRET", description: "Other Government Agency (OGA) decision webhook" },
  { envVar: "SANCTIONS_WEBHOOK_SECRET", description: "Sanctions screening result webhook" },
];

/**
 * Validates all webhook secrets are set and not using known dev defaults.
 * In development (NODE_ENV !== 'production'), this only warns.
 * In production, this throws a fatal Error to prevent startup.
 */
export function validateWebhookSecrets(): void {
  const isProduction = process.env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { envVar, description } of WEBHOOK_SECRETS) {
    const value = process.env[envVar];

    if (!value || value.trim() === "") {
      const msg = `[WebhookSecrets] ${envVar} is not set (${description}). Set a strong random secret.`;
      if (isProduction) errors.push(msg);
      else warnings.push(msg);
      continue;
    }

    const isDevDefault = DEV_SECRET_PATTERNS.some(
      (pattern) => value.toLowerCase().includes(pattern.toLowerCase())
    );

    if (isDevDefault) {
      const msg = `[WebhookSecrets] ${envVar} uses a known dev placeholder value '${value}' (${description}). This is a CRITICAL security vulnerability in production.`;
      if (isProduction) errors.push(msg);
      else warnings.push(`[WARN] ${msg}`);
    }

    if (value.length < 32) {
      const msg = `[WebhookSecrets] ${envVar} is too short (${value.length} chars, minimum 32) for ${description}.`;
      if (isProduction) errors.push(msg);
      else warnings.push(`[WARN] ${msg}`);
    }
  }

  // Log warnings in development
  for (const w of warnings) {
    console.warn(w);
  }

  // Fatal in production
  if (errors.length > 0) {
    const errorMessage = [
      "=== FATAL: Insecure webhook secrets detected in production ===",
      ...errors,
      "Generate strong secrets with: openssl rand -hex 32",
      "Set them as environment variables before starting the server.",
    ].join("\n");
    throw new Error(errorMessage);
  }
}

/**
 * Returns a safe webhook secret for the given env var.
 * In production, throws if the secret is not set or uses a dev default.
 * In development, returns the value (even if it's a dev default) with a warning.
 */
export function getWebhookSecret(envVar: string, devDefault: string): string {
  const value = process.env[envVar];
  const isProduction = process.env.NODE_ENV === "production";

  if (!value || value.trim() === "") {
    if (isProduction) {
      throw new Error(`[WebhookSecrets] ${envVar} must be set in production.`);
    }
    console.warn(`[WebhookSecrets] ${envVar} not set, using dev default. DO NOT use in production.`);
    return devDefault;
  }

  const isDevDefault = DEV_SECRET_PATTERNS.some(
    (pattern) => value.toLowerCase().includes(pattern.toLowerCase())
  );

  if (isDevDefault && isProduction) {
    throw new Error(`[WebhookSecrets] ${envVar} uses a dev placeholder in production. Set a strong secret.`);
  }

  return value;
}
