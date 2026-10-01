/**
 * Phase 22 — REST surface for device push-token registration.
 *
 *   POST /v1/push-tokens   { token, platform }  — register/refresh a device
 *                          push token for the Bearer-authenticated user.
 *
 * Auth: `Authorization: Bearer <keycloak-jwt>` — verified via
 * sdk.authenticateRequest, the SAME verifier the tRPC context uses
 * (JWKS/RS256 + issuer + audience + active-user check). Invalid/absent
 * tokens → 401 (fail-closed). X-API-Key is NOT accepted here: a push token
 * is bound to a real platform user, not to a marketplace key.
 *
 * The registration runs the exact same code path as the tRPC mutation
 * pushTokens.registerPushToken (registerPushTokenForUser — PG-native upsert
 * on (user_id, platform)); the store is the authoritative push_tokens table.
 * Fail-closed: DB outage → 503, the token is NOT silently dropped.
 */
import type { Express } from "express";
import { sdk } from "../_core/sdk";
import {
  PUSH_TOKEN_PLATFORMS,
  registerPushTokenForUser,
  type PushTokenPlatform,
} from "../routers/pushTokens";

export function registerPushTokensApiRoutes(app: Express): void {
  app.post("/v1/push-tokens", async (req, res) => {
    // ── Bearer-only authentication (fail-closed) ──────────────────────────────
    const authHeader = req.headers.authorization as string | undefined;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing Authorization: Bearer <token> header" });
      return;
    }
    let user: { id: number };
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "Invalid or expired bearer token" });
      return;
    }
    if (!user) {
      res.status(401).json({ error: "Invalid or expired bearer token" });
      return;
    }

    // ── Input validation (same contract as pushTokens.registerPushToken) ──────
    const { token, platform } = (req.body ?? {}) as { token?: unknown; platform?: unknown };
    if (typeof token !== "string" || token.length < 10 || token.length > 512) {
      res.status(400).json({ error: "token must be a string of 10–512 characters" });
      return;
    }
    if (typeof platform !== "string" || !(PUSH_TOKEN_PLATFORMS as readonly string[]).includes(platform)) {
      res.status(400).json({ error: `platform must be one of [${PUSH_TOKEN_PLATFORMS.join(", ")}]` });
      return;
    }

    // ── Register via the shared pushTokens logic ──────────────────────────────
    try {
      const result = await registerPushTokenForUser(user.id, token, platform as PushTokenPlatform);
      res.status(200).json(result);
    } catch (err) {
      res.status(503).json({
        status: "down",
        error: err instanceof Error ? err.message : "Push token registration unavailable",
      });
    }
  });
}
